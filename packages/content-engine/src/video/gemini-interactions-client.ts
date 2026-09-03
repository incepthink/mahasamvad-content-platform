// Gemini Interactions API — conversational video generation and editing.
//
// This is the model layer behind the /new-video-workflow EXPERIMENT. It is deliberately not
// wired into the production explainer-video pipeline: nothing here plans scenes, writes a
// script, narrates, captions or brands anything. One prompt (plus any reference images) goes
// to one model, one video comes back, and a follow-up edits it through
// `previous_interaction_id`.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: the officer's prompt reaches Gemini VERBATIM.
// The whole point of the experiment is to compare this API's output against the Gemini chat
// app, so a system instruction, a house style, a translation, a rewrite or a negative prompt
// would make the comparison meaningless. `buildInteractionRequest` therefore sends
// `system_instruction` never, and the prompt as a single unmodified text part — asserted in
// gemini-interactions-client.test.ts, including for Marathi, which must survive byte for byte
// (a normalisation pass would silently recompose Devanagari matras).
//
// Raw REST through geminiFetch, the same no-SDK policy as veo-client.ts and
// gemini-image-client.ts: the transport rules (per-lane serialization, retry-after backoff)
// have to be ours either way.
//
// SHAPE OF THE API, from https://ai.google.dev/gemini-api/docs/omni :
//   POST /v1beta/interactions       { model, input, previous_interaction_id?, store, ... }
//   GET  /v1beta/interactions/{id}  -> the same Interaction resource
//   Interaction: { id, object, status, model, steps: [...], errors?: [...] }
//   A generated video arrives inside a `model_output` step as a content part
//   { type: 'video', mime_type: 'video/mp4', uri | data }.
//
// PER-MODEL PARAMS ARE LEARNED, NOT DECLARED — the veo-client doctrine, and it matters more
// here because the model id is a moving preview target. `background` and `response_format`
// are both sent optimistically; a 400 that names either one is cached against the model id
// and the call is retried without it. So a model that cannot do URI delivery falls back to
// inline base64, and one that cannot run in the background is simply awaited.

import { pathToFileURL } from 'node:url';
import { GeminiRequestError, geminiFetch } from '../http/gemini-request.js';

// The experiment's model, per the brief. Overridable because every Gemini preview id in this
// repo has been renamed at least once, and a rename must be an .env edit rather than a deploy.
export const GEMINI_VIDEO_MODEL: string =
  process.env.GEMINI_VIDEO_MODEL?.trim() || 'gemini-omni-1.1-flash';

// How many reference images one turn may carry. A bound on request size, not a model limit:
// every image travels as base64 inside the JSON body.
export const INTERACTION_MAX_IMAGES = 4;

// Per reference image. Base64 inflates by ~4/3, so four at this size is a ~40 MB body — under
// the API's 64 MiB JSON limit with room to spare.
export const INTERACTION_IMAGE_MAX_BYTES = 7 * 1024 * 1024;

// The prompt goes to the model unchanged, so the only cap is a sane request bound.
export const INTERACTION_PROMPT_MAX_CHARS = 20_000;

export const INTERACTION_IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

// Every state the Interaction resource documents. The three non-obvious ones are terminal
// too: `incomplete` and `budget_exceeded` end the run as surely as `failed` does, and
// treating them as "still working" would poll until the wall clock gave up.
export const INTERACTION_STATUSES = [
  'queued',
  'in_progress',
  'requires_action',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'budget_exceeded',
] as const;
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number];

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'in_progress',
]);

export function isTerminalInteractionStatus(status: string): boolean {
  return !PENDING_STATUSES.has(status);
}

export type InteractionImage = Readonly<{
  data: Buffer;
  mimeType: string;
}>;

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image'; data: string; mime_type: string };
export type InteractionInputPart = TextPart | ImagePart;

export type InteractionRequestBody = {
  model: string;
  input: InteractionInputPart[];
  store: boolean;
  background?: boolean;
  previous_interaction_id?: string;
  response_format?: { type: 'video'; delivery: 'uri' };
};

export type BuildInteractionRequestInput = Readonly<{
  prompt: string;
  images?: readonly InteractionImage[];
  // The id of the last interaction that COMPLETED in this conversation. Null/undefined/'' all
  // start a fresh, independent conversation — the model is handed no prior state at all.
  // `| undefined` is explicit because the workspace runs exactOptionalPropertyTypes:
  // a caller holding `string | null | undefined` must be able to pass it straight through.
  previousInteractionId?: string | null | undefined;
  model?: string;
  // Both default true and are dropped by the learned-capability ladder when a model rejects
  // them; the tests drive them explicitly.
  background?: boolean;
  uriDelivery?: boolean;
}>;

export class InteractionRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionRequestError';
  }
}

// Validation lives here, beside the builder, so a nonsense turn is refused BEFORE a paid
// render rather than by the API after one. The route re-states the same limits in Marathi;
// these messages are the developer-facing backstop.
export function buildInteractionRequest({
  prompt,
  images = [],
  previousInteractionId = null,
  model = GEMINI_VIDEO_MODEL,
  background = true,
  uriDelivery = true,
}: BuildInteractionRequestInput): InteractionRequestBody {
  if (prompt.trim() === '') {
    throw new InteractionRequestError('A prompt is required.');
  }
  if (prompt.length > INTERACTION_PROMPT_MAX_CHARS) {
    throw new InteractionRequestError(
      `Prompt is ${prompt.length} characters; the limit is ${INTERACTION_PROMPT_MAX_CHARS}.`,
    );
  }
  if (images.length > INTERACTION_MAX_IMAGES) {
    throw new InteractionRequestError(
      `Up to ${INTERACTION_MAX_IMAGES} reference images per turn; got ${images.length}.`,
    );
  }
  for (const image of images) {
    if (!INTERACTION_IMAGE_MIME_TYPES.includes(image.mimeType)) {
      throw new InteractionRequestError(
        `Unsupported reference image type ${image.mimeType}. ` +
          `Supported: ${INTERACTION_IMAGE_MIME_TYPES.join(', ')}.`,
      );
    }
    if (image.data.length === 0) {
      throw new InteractionRequestError('A reference image was empty.');
    }
    if (image.data.length > INTERACTION_IMAGE_MAX_BYTES) {
      throw new InteractionRequestError(
        `A reference image is ${image.data.length} bytes; the limit is ` +
          `${INTERACTION_IMAGE_MAX_BYTES}.`,
      );
    }
  }

  // Images FIRST, then the text — the order the docs' image-to-video example uses, so the
  // instruction reads as being about the pictures above it.
  const input: InteractionInputPart[] = [
    ...images.map((image): ImagePart => ({
      type: 'image',
      data: image.data.toString('base64'),
      mime_type: image.mimeType,
    })),
    // NOT trimmed, NOT normalised, NOT wrapped in any instruction of ours. This is the line
    // the whole experiment is measuring.
    { type: 'text', text: prompt },
  ];

  return {
    model,
    input,
    // The conversation lives on Gemini's side; without this there is nothing for the next
    // turn's previous_interaction_id to point at.
    store: true,
    ...(background ? { background: true } : {}),
    ...(previousInteractionId
      ? { previous_interaction_id: previousInteractionId }
      : {}),
    // Delivery only. Deliberately no aspect_ratio and no resolution: the brief is to stay on
    // Gemini's own defaults so the output is comparable with the chat app.
    ...(uriDelivery
      ? {
          response_format: { type: 'video' as const, delivery: 'uri' as const },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Reading the response
// ---------------------------------------------------------------------------

type InteractionContentPart = {
  type?: string;
  text?: string;
  uri?: string;
  data?: string;
  mime_type?: string;
};

type InteractionStep = {
  type?: string;
  content?: InteractionContentPart[];
};

export type Interaction = {
  id?: string;
  object?: string;
  status?: string;
  model?: string;
  steps?: InteractionStep[];
  errors?: Array<{ code?: string | number; message?: string }>;
  error?: { code?: string | number; message?: string };
  // The SDK's convenience mirror of the model_output video part. Parsed too, because a
  // preview API earns a reader that accepts both shapes rather than one that silently
  // returns undefined (the veo-client lesson).
  output_video?: { uri?: string; data?: string; mime_type?: string };
};

export type InteractionOutput = Readonly<{
  videoUri: string | null;
  // Base64, as delivered inline when URI delivery is not in play.
  videoData: string | null;
  // Any prose the model returned beside (or instead of) the video — a refusal explains
  // itself here, which is the difference between "it failed" and a message worth reading.
  text: string;
}>;

// Walks every step rather than assuming a position: the docs show `user_input`, `thought` and
// `model_output` steps, and a `thought` step's text must NOT be mistaken for the answer.
export function interactionOutputOf(
  interaction: Interaction,
): InteractionOutput {
  let videoUri: string | null = interaction.output_video?.uri ?? null;
  let videoData: string | null = interaction.output_video?.data ?? null;
  const text: string[] = [];

  for (const step of interaction.steps ?? []) {
    if (step.type === 'user_input' || step.type === 'thought') continue;
    for (const part of step.content ?? []) {
      if (part.type === 'video') {
        if (!videoUri && part.uri) videoUri = part.uri;
        if (!videoData && part.data) videoData = part.data;
        continue;
      }
      // A `thought` part can also appear inside a model_output step; it is the model's
      // reasoning, not its message.
      if (part.type === 'thought') continue;
      if (part.type === 'text' && part.text) text.push(part.text);
    }
  }

  return { videoUri, videoData, text: text.join('\n\n').trim() };
}

// One sentence naming why an interaction did not produce a video. Safety filtering surfaces
// here: the model reports it as a failed/incomplete status with a message, and passing that
// message through is what lets the page say "the prompt was blocked because X" rather than
// "something went wrong".
export function interactionErrorMessage(
  interaction: Interaction,
): string | null {
  const reported = [
    ...(interaction.errors ?? []),
    ...(interaction.error ? [interaction.error] : []),
  ]
    .map(
      (entry) =>
        entry.message ?? (entry.code !== undefined ? String(entry.code) : ''),
    )
    .filter((message) => message !== '');
  if (reported.length > 0) return reported.join('; ');

  const status = interaction.status ?? 'unknown';
  if (status === 'completed') return null;

  // No error object, but a terminal status that is not success. The model's own prose is the
  // best explanation available — an `incomplete` interaction usually says what stopped it.
  const { text } = interactionOutputOf(interaction);
  return text !== ''
    ? `Gemini ended the interaction as "${status}": ${text}`
    : `Gemini ended the interaction as "${status}".`;
}

// ---------------------------------------------------------------------------
// Learned capabilities
// ---------------------------------------------------------------------------

const modelsRejectingBackground = new Set<string>();
const modelsRejectingResponseFormat = new Set<string>();

function rejectsField(error: unknown, ...needles: readonly string[]): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400)
    return false;
  const detail = error.detail.toLowerCase();
  return needles.some((needle) => detail.includes(needle));
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'Missing required environment variable GEMINI_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

export type CreateVideoInteractionInput = Readonly<{
  prompt: string;
  images?: readonly InteractionImage[];
  previousInteractionId?: string | null;
}>;

// Starts the interaction. Returns as soon as the API accepts it — which, with `background`,
// is long before the video exists; the caller then polls getInteraction.
export async function createVideoInteraction(
  input: CreateVideoInteractionInput,
): Promise<Interaction> {
  const apiKey = requireApiKey();
  const model = GEMINI_VIDEO_MODEL;

  for (;;) {
    const body = buildInteractionRequest({
      ...input,
      model,
      background: !modelsRejectingBackground.has(model),
      uriDelivery: !modelsRejectingResponseFormat.has(model),
    });
    try {
      const response = await geminiFetch('interactions', {
        label: 'interactions create',
        apiKey,
        body,
        lane: 'video',
      });
      return (await response.json()) as Interaction;
    } catch (error) {
      // Learned, then retried once per capability — never a per-model table, because the id
      // is env-overridable and a table goes stale the moment it is repointed.
      if (
        body.background !== undefined &&
        rejectsField(error, 'background') &&
        !modelsRejectingBackground.has(model)
      ) {
        console.warn(
          `[gemini-interactions] ${model} rejected \`background\`; awaiting the render inline.`,
        );
        modelsRejectingBackground.add(model);
        continue;
      }
      if (
        body.response_format !== undefined &&
        rejectsField(error, 'response_format', 'delivery') &&
        !modelsRejectingResponseFormat.has(model)
      ) {
        console.warn(
          `[gemini-interactions] ${model} rejected \`response_format\`; falling back to ` +
            'inline video delivery.',
        );
        modelsRejectingResponseFormat.add(model);
        continue;
      }
      throw error;
    }
  }
}

export async function getInteraction(id: string): Promise<Interaction> {
  const response = await geminiFetch(`interactions/${encodeURIComponent(id)}`, {
    label: 'interactions get',
    apiKey: requireApiKey(),
    method: 'GET',
    lane: 'video',
  });
  return (await response.json()) as Interaction;
}

// Polls until the interaction reaches a terminal status. The wall clock is the release
// valve: a stuck interaction must fail this turn, not hang the job forever.
export async function awaitInteraction(
  id: string,
  onProgress?: (elapsedMs: number, status: string) => void,
): Promise<Interaction> {
  const pollIntervalMs = readInt('GEMINI_VIDEO_POLL_INTERVAL_MS', 10_000);
  const timeoutMs = readInt('GEMINI_VIDEO_RENDER_TIMEOUT_MS', 1_800_000);
  const startedAt = Date.now();

  for (;;) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) {
      throw new Error(
        `Gemini video generation timed out after ${Math.round(elapsed / 1000)}s ` +
          `(interaction ${id}). Raise GEMINI_VIDEO_RENDER_TIMEOUT_MS if this is normal.`,
      );
    }
    await sleep(pollIntervalMs);
    const interaction = await getInteraction(id);
    const status = interaction.status ?? 'unknown';
    onProgress?.(Date.now() - startedAt, status);
    if (isTerminalInteractionStatus(status)) return interaction;
  }
}

// The `files/{id}` segment of a generated-video URI, when it has one. URI delivery hands back
// a Files API download link whose object may still be PROCESSING, so the id is what lets the
// download wait for it rather than fetch a file that is not there yet.
export function fileNameFromUri(uri: string): string | null {
  const match = /files\/([^:/?#]+)/.exec(uri);
  return match?.[1] ? `files/${match[1]}` : null;
}

// Downloads the finished MP4 into this process so it can be re-hosted. The Gemini URI is
// authenticated by our API key and is NEVER handed to a browser.
export async function downloadInteractionVideo(uri: string): Promise<Buffer> {
  const apiKey = requireApiKey();
  const fileName = fileNameFromUri(uri);

  if (fileName) {
    // Wait for the file object to become ACTIVE. A download issued while it is PROCESSING
    // either fails or returns nothing useful, and "nothing useful" is the one that would
    // reach the officer as a broken player.
    const pollIntervalMs = readInt('GEMINI_VIDEO_FILE_POLL_INTERVAL_MS', 5_000);
    const timeoutMs = readInt('GEMINI_VIDEO_FILE_TIMEOUT_MS', 600_000);
    const startedAt = Date.now();
    for (;;) {
      const response = await geminiFetch(fileName, {
        label: 'interactions file',
        apiKey,
        method: 'GET',
        lane: 'video',
      });
      const file = (await response.json()) as {
        state?: string;
        error?: { message?: string };
      };
      const state = file.state ?? 'ACTIVE';
      if (state === 'ACTIVE') break;
      if (state === 'FAILED') {
        throw new Error(
          `Gemini could not prepare the generated video: ${
            file.error?.message ?? 'the file entered state FAILED.'
          }`,
        );
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Gemini's generated video was still ${state} after ` +
            `${Math.round((Date.now() - startedAt) / 1000)}s (${fileName}).`,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  const download = await geminiFetch(uri, {
    label: 'interactions download',
    apiKey,
    method: 'GET',
    lane: 'video',
  });
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Gemini video download for ${uri} returned an empty body.`);
  }
  return bytes;
}

// Run directly to prove account access and the whole interaction lifecycle with ONE cheap
// generation before wiring anything (Gemini video spend):
//
//   tsx --env-file=../../.env src/video/gemini-interactions-client.ts "<prompt>"
//
// Writes gemini-interaction.mp4 into the current directory and prints the interaction id, so
// a second run can be given --previous=<id> to prove conversational editing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const previous =
    args.find((arg) => arg.startsWith('--previous='))?.slice(11) ?? null;
  const prompt = args.filter((arg) => !arg.startsWith('--')).join(' ');
  if (prompt.trim() === '') {
    console.error(
      'Usage: tsx --env-file=../../.env src/video/gemini-interactions-client.ts ' +
        '"<prompt>" [--previous=<interaction id>]',
    );
    process.exit(1);
  }
  const { writeFile } = await import('node:fs/promises');
  console.log(
    `[harness] model=${GEMINI_VIDEO_MODEL} previous=${previous ?? '(none)'}`,
  );
  const started = await createVideoInteraction({
    prompt,
    previousInteractionId: previous,
  });
  const id = started.id;
  if (!id) throw new Error(`No interaction id in ${JSON.stringify(started)}`);
  console.log(
    `[harness] interaction ${id} status=${started.status ?? 'unknown'}`,
  );
  const finished = isTerminalInteractionStatus(started.status ?? 'in_progress')
    ? started
    : await awaitInteraction(id, (elapsed, status) =>
        console.log(
          `[harness] ${Math.round(elapsed / 1000)}s status=${status}`,
        ),
      );
  const output = interactionOutputOf(finished);
  if (output.text !== '') console.log(`[harness] model text: ${output.text}`);
  const bytes = output.videoUri
    ? await downloadInteractionVideo(output.videoUri)
    : output.videoData
      ? Buffer.from(output.videoData, 'base64')
      : null;
  if (!bytes) {
    console.error(
      `[harness] no video: ${interactionErrorMessage(finished) ?? 'unknown'}`,
    );
    process.exit(1);
  }
  await writeFile('gemini-interaction.mp4', bytes);
  console.log(
    `[harness] wrote gemini-interaction.mp4 (${bytes.length} bytes). ` +
      `Continue with --previous=${finished.id ?? id}`,
  );
}
