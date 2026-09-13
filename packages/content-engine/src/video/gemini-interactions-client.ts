// Gemini Interactions API — conversational video generation and editing.
//
// This is the model layer behind the /new-video-workflow EXPERIMENT. It is deliberately not
// wired into the production explainer-video pipeline: nothing here plans scenes, writes a
// script, narrates, captions or brands anything. One prompt (plus any reference images) goes
// to one model, one video comes back, and a follow-up edits it through
// `previous_interaction_id`.
//
// THE PROMPT IS EITHER UNTOUCHED OR EXPLICITLY WRAPPED — never quietly edited.
// This file used to carry one absolute rule: the officer's prompt reaches Gemini VERBATIM,
// because /new-video-workflow existed to compare this API against the Gemini chat app and
// anything of ours would have made that comparison meaningless. That comparison has been run,
// and its finding is that the app's advantage IS the scaffolding — role-tagged reference
// images, a dialogue form that does not burn in subtitles, a voice description re-stated every
// turn. So the rule that kept the comparison fair is the rule that keeps the output worse.
//
// `mode` is that decision, made per call rather than assumed:
//
//   'verbatim'   (the DEFAULT here) — the prompt is the single text part, byte for byte, and a
//                scaffold is REFUSED rather than ignored. Nothing of ours rides along.
//   'scaffolded' — an optional `scaffold` prefix/suffix is composed around that same prompt,
//                which still appears inside the result unchanged.
//
// Two things the mode does NOT mean. It is about what THIS FUNCTION adds, not about what the
// caller was handed: the Dynamic Poster lane's prompt is written by an LLM pass of its own
// (generation/motion-prompt.ts) and is still `verbatim` here, correctly — nothing is added to
// what it composed. And which stance /new-video-workflow takes is that lane's to choose, in
// new-video-prompt-mode.ts, not this file's.
//
// In BOTH modes the officer's own characters survive byte for byte — asserted in
// gemini-interactions-client.test.ts, including for Marathi, where a normalisation pass would
// silently recompose Devanagari matras while looking identical in a terminal.
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
// here because the model id is a moving preview target. `background`, `response_format` and
// the `aspect_ratio` inside it are all sent optimistically; a 400 that names one is cached
// against the model id and the call is retried without it. So a model that cannot do URI
// delivery falls back to inline base64, one that cannot run in the background is simply
// awaited, and one that will not take an aspect ratio renders at its own default.
//
// THE ASPECT RATIO IS A REQUEST FIELD, NOT A SENTENCE. The officer picks the shape of the
// output on the composer and it travels as `response_format.aspect_ratio` — which is how the
// verbatim rule above survives a feature that changes the render: not one character is added
// to the prompt, and nothing is cropped after the fact, so no frame that was paid for is
// discarded to change its shape.

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

// The task Omni is told to perform, per
// https://ai.google.dev/gemini-api/docs/omni . Sent as
// `generation_config.video_config.task`. Without it the task is INFERRED from the request's
// shape, and an inference is exactly what goes wrong here: a turn attaching a picture is read
// as image-to-video — that picture becoming the literal opening frame — when what this lane
// means is reference-to-video, a character to hold steady across the whole clip. Saying it in
// the request is the field half of what new-video-scaffold.ts says in prose.
export const INTERACTION_VIDEO_TASKS = [
  'text_to_video',
  'image_to_video',
  'reference_to_video',
  'edit',
  'extend',
] as const;
export type InteractionVideoTask = (typeof INTERACTION_VIDEO_TASKS)[number];

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image'; data: string; mime_type: string };
export type InteractionInputPart = TextPart | ImagePart;

export type InteractionRequestBody = {
  model: string;
  input: InteractionInputPart[];
  store: boolean;
  background?: boolean;
  previous_interaction_id?: string;
  // `delivery`, `aspect_ratio` and `resolution` are independent: any one alone is a reason to
  // send this object, and the ladder below can drop one without losing the others.
  response_format?: {
    type: 'video';
    delivery?: 'uri';
    aspect_ratio?: string;
    resolution?: string;
  };
  // The only thing this repo ever puts under `generation_config`, which is what lets the
  // learned-capability rung for it be matched on the container's own name.
  generation_config?: {
    video_config: { task: InteractionVideoTask };
  };
};

// Whether this builder may put text of its own around the prompt it was handed. See the
// header: 'verbatim' is the comparison stance and refuses a scaffold outright, so a scaffold
// that arrives under it is a bug reported rather than a rule silently broken.
export type InteractionPromptMode = 'verbatim' | 'scaffolded';

// Text of ours, around the officer's. Kept to a prefix and a suffix on purpose: that is
// enough to carry every scaffolding element the Omni docs call for — the
// `[# References <IMAGE_REF_0>@Image1 ...]` block and a voice description ahead of the
// instruction, the "not literal initial frames" boilerplate and "Keep everything else the
// same." after it — without this file pre-deciding what any of them say. What goes in them is
// the lane's business.
export type InteractionScaffold = Readonly<{
  prefix?: string | null | undefined;
  suffix?: string | null | undefined;
}>;

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
  // The output shape, e.g. '16:9' or '9:16'. Absent/null/'' sends no aspect_ratio at all and
  // the model renders at its own default — which is what every caller that does not offer the
  // choice gets, byte for byte as before this field existed.
  aspectRatio?: string | null | undefined;
  // How big the frame comes back, e.g. '1080p'. Absent/null/'' sends no resolution at all, so
  // a caller that does not ask gets the model's own default exactly as before.
  //
  // It matters here because a video model REPAINTS every pixel it returns: pixels it never
  // rendered are resolution the officer's Devanagari cannot get back, and small card text is
  // where that is lost first. A REQUEST FIELD, not a sentence — the aspect-ratio precedent; a
  // brief demanding a pixel size is the defect the 2026-09-03 milestone removed.
  resolution?: string | null | undefined;
  // Defaults to 'verbatim', so every existing caller is byte-for-byte unchanged and a new one
  // has to ask for scaffolding in as many words.
  mode?: InteractionPromptMode | undefined;
  scaffold?: InteractionScaffold | null | undefined;
  // What the model is told it is doing. OPT-IN: absent/null sends no `generation_config` at
  // all and the task is inferred exactly as it always has been, which is what keeps every
  // existing caller — the Dynamic Poster lane included, where the source image genuinely IS
  // the thing being animated — byte for byte unchanged.
  //
  // IT IS DROPPED ON A FOLLOW-UP, and that is the reason this field cannot simply be set once
  // per conversation: combining a task with `previous_interaction_id` is reported to BREAK
  // EDIT CHAINS, so it belongs to first turns only. Dropped rather than refused because the
  // consequence of the drop is nil — the turn renders as a follow-up always has — where
  // refusing would fail a turn the officer typed over a field they never asked for.
  videoTask?: InteractionVideoTask | null | undefined;
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
  aspectRatio = null,
  resolution = null,
  mode = 'verbatim',
  scaffold = null,
  videoTask = null,
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

  // ONE text part in both modes — the prompt, with anything the lane asked to put around it.
  // The officer's own string is inserted UNTOUCHED: not trimmed, not normalised, not reworded,
  // so it survives here character for character exactly as it did before this mode existed.
  // The blocks are joined by a blank line because that is how the Omni docs separate a
  // reference declaration from the instruction that uses it.
  //
  // Only `prompt` is measured against INTERACTION_PROMPT_MAX_CHARS, above: that cap is the
  // officer-facing limit the route mirrors in Marathi, and a scaffold of ours is not the
  // officer's to shorten.
  const prefix = scaffold?.prefix?.trim() ?? '';
  const suffix = scaffold?.suffix?.trim() ?? '';
  if (mode === 'verbatim' && (prefix !== '' || suffix !== '')) {
    // Refused, not dropped. Silently ignoring it would run a scaffolded turn's prompt
    // through the comparison stance and report the result as if the scaffolding had been
    // tried.
    throw new InteractionRequestError(
      "A scaffold was supplied in verbatim mode. Pass mode: 'scaffolded' to wrap " +
        'the prompt, or drop the scaffold.',
    );
  }
  const text =
    prefix === '' && suffix === ''
      ? prompt
      : [prefix, prompt, suffix].filter((block) => block !== '').join('\n\n');

  // Images FIRST, then the text — the order the docs' image-to-video example uses, so the
  // instruction reads as being about the pictures above it.
  //
  // KEPT ON PURPOSE, and the reasoning is worth not re-deriving. That ordering does signal
  // FIRST-FRAME semantics, which is the opposite of what a character reference wants — but
  // the documented remedy for exactly that misreading is a sentence, not a reordering: the
  // `[# References <IMAGE_REF_n>@ImageN]` block binds each picture to a ROLE by index, and
  // the "should not be used as literal initial frames" boilerplate says so outright. Both
  // now travel (video/new-video-scaffold.ts). Flipping the part order on top of them would
  // change two variables at once in a paid A/B while resting on a guess about how the tags
  // index the parts; if tagging turns out not to be enough, that is the next thing to try,
  // on its own.
  const input: InteractionInputPart[] = [
    ...images.map((image): ImagePart => ({
      type: 'image',
      data: image.data.toString('base64'),
      mime_type: image.mimeType,
    })),
    { type: 'text', text },
  ];

  // Never alongside `previous_interaction_id` — see the field's own note. Enforced here as
  // well as at the call site so the invariant holds for every caller by construction rather
  // than by each one remembering it.
  const task = previousInteractionId ? null : videoTask;

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
    // Delivery, the output shape when the officer picked one, and the frame size when the lane
    // asked for one. Each is independently optional and each is dropped on its own rung below.
    ...(uriDelivery || aspectRatio || resolution
      ? {
          response_format: {
            type: 'video' as const,
            ...(uriDelivery ? { delivery: 'uri' as const } : {}),
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(resolution ? { resolution } : {}),
          },
        }
      : {}),
    // Stated rather than inferred, on a first turn. A field, not a sentence: the prompt is
    // untouched by it, the aspect-ratio precedent above.
    ...(task ? { generation_config: { video_config: { task } } } : {}),
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
const modelsRejectingAspectRatio = new Set<string>();
const modelsRejectingVideoTask = new Set<string>();
const modelsRejectingResolution = new Set<string>();

/** One optional request field this client can learn a given model will not accept. */
export type InteractionCapability =
  'videoTask' | 'background' | 'resolution' | 'aspectRatio' | 'responseFormat';

function rejectsField(error: unknown, ...needles: readonly string[]): boolean {
  if (!(error instanceof GeminiRequestError) || error.status !== 400)
    return false;
  const detail = error.detail.toLowerCase();
  return needles.some((needle) => detail.includes(needle));
}

// THE RUNGS, AND THEIR ORDER IS LOAD-BEARING TWICE OVER.
//
// Each rung is guarded on the BODY'S OWN FIELD, so a false needle match can only ever cost one
// retry that then falls through the rungs below it. `videoTask` is checked first because its
// needles are the narrowest — `generation_config` is the only container this repo sends a task
// inside, so nothing else we put in a body can match them.
//
// `resolution` sits IMMEDIATELY BEFORE `aspectRatio`, and that is not tidiness. A resolution
// rejection can read "unsupported resolution for aspect ratio 9:16", which matches the aspect
// rung's needles as well. With the aspect rung first, such a 400 would drop the ASPECT RATIO and
// keep the resolution — the field that matters discarded, the field that caused it kept. It goes
// first because it is the strictly more optional of the two (the veo-client stance: silence and
// 1080p are improvements, not requirements).
//
// `aspectRatio` in turn sits before `responseFormat` for the same reason: a 400 reading "unknown
// field response_format.aspect_ratio" matches both, and taking the broader rung would drop URI
// delivery along with the ratio for the rest of the process.
const CAPABILITY_RUNGS: readonly Readonly<{
  capability: InteractionCapability;
  sent: (body: InteractionRequestBody) => boolean;
  needles: readonly string[];
}>[] = [
  {
    capability: 'videoTask',
    sent: (body) => body.generation_config !== undefined,
    needles: ['generation_config', 'video_config', 'task'],
  },
  {
    capability: 'background',
    sent: (body) => body.background !== undefined,
    needles: ['background'],
  },
  {
    capability: 'resolution',
    sent: (body) => body.response_format?.resolution !== undefined,
    needles: ['resolution'],
  },
  {
    capability: 'aspectRatio',
    sent: (body) => body.response_format?.aspect_ratio !== undefined,
    needles: ['aspect_ratio', 'aspect ratio'],
  },
  {
    capability: 'responseFormat',
    sent: (body) => body.response_format !== undefined,
    needles: ['response_format', 'delivery'],
  },
];

/**
 * Which optional field this 400 is about — the first rung whose field this body actually carried
 * and whose wording the error matches, skipping anything already learned so the fall-through is
 * preserved. Null means nothing here explains it and the error belongs to the caller.
 *
 * Pure and exported so the ORDER above can be asserted offline, with no key and no network: the
 * ordering bug it guards against fails silently, by dropping the wrong field.
 */
export function rejectedCapability(
  error: unknown,
  body: InteractionRequestBody,
  learned: ReadonlySet<InteractionCapability> = new Set(),
): InteractionCapability | null {
  for (const rung of CAPABILITY_RUNGS) {
    if (learned.has(rung.capability)) continue;
    if (!rung.sent(body)) continue;
    if (rejectsField(error, ...rung.needles)) return rung.capability;
  }
  return null;
}

/** What this model has already been learned to refuse, as one set for the classifier. */
function learnedFor(model: string): ReadonlySet<InteractionCapability> {
  const learned = new Set<InteractionCapability>();
  if (modelsRejectingVideoTask.has(model)) learned.add('videoTask');
  if (modelsRejectingBackground.has(model)) learned.add('background');
  if (modelsRejectingResolution.has(model)) learned.add('resolution');
  if (modelsRejectingAspectRatio.has(model)) learned.add('aspectRatio');
  if (modelsRejectingResponseFormat.has(model)) learned.add('responseFormat');
  return learned;
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
  // The shape the caller wants back. Omitted leaves the model on its own default.
  aspectRatio?: string | null;
  // The frame size the caller wants back, e.g. '1080p'. Omitted leaves the model on its own
  // default, which is what every caller that does not ask for one gets.
  resolution?: string | null;
  // Defaults to 'verbatim' in the builder; a lane that scaffolds passes its own stance and
  // the text to wrap the prompt in.
  mode?: InteractionPromptMode;
  scaffold?: InteractionScaffold | null;
  // What the model is told it is doing, on a FIRST turn only — the builder drops it when a
  // previous interaction is being continued. Omitted leaves the task inferred, as it always
  // was.
  videoTask?: InteractionVideoTask | null;
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
      aspectRatio: modelsRejectingAspectRatio.has(model)
        ? null
        : input.aspectRatio,
      resolution: modelsRejectingResolution.has(model)
        ? null
        : input.resolution,
      videoTask: modelsRejectingVideoTask.has(model) ? null : input.videoTask,
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
      // Learned, then retried once per capability — never a per-model table, because the id is
      // env-overridable and a table goes stale the moment it is repointed. WHICH field a 400 is
      // about, and in what order that is decided, lives in CAPABILITY_RUNGS above with the
      // reasoning beside it.
      const rejected = rejectedCapability(error, body, learnedFor(model));
      if (rejected === 'videoTask') {
        console.warn(
          `[gemini-interactions] ${model} rejected \`generation_config.video_config.task\`; ` +
            'letting the model infer the task.',
        );
        modelsRejectingVideoTask.add(model);
        continue;
      }
      if (rejected === 'background') {
        console.warn(
          `[gemini-interactions] ${model} rejected \`background\`; awaiting the render inline.`,
        );
        modelsRejectingBackground.add(model);
        continue;
      }
      if (rejected === 'resolution') {
        // THE LINE TO LOOK FOR when a Dynamic Poster still comes back small: it says the frame
        // size was asked for and refused, which is a different answer from never asking.
        console.warn(
          `[gemini-interactions] ${model} rejected \`resolution\`; rendering at the model's ` +
            'own default frame size.',
        );
        modelsRejectingResolution.add(model);
        continue;
      }
      if (rejected === 'aspectRatio') {
        console.warn(
          `[gemini-interactions] ${model} rejected \`aspect_ratio\`; rendering at the ` +
            "model's own default shape.",
        );
        modelsRejectingAspectRatio.add(model);
        continue;
      }
      if (rejected === 'responseFormat') {
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
