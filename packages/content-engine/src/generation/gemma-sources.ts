// The /dlo file lane on a self-hosted vision model: gemma-4-31B-it, served by vLLM on a
// Runpod serverless endpoint.
//
// A TWIN of responses-with-sources.ts, not a branch inside it. Both answer the same question
// — "write this article, and here are the officer's documents" — and both return a plain
// string, which is why generate-article-from-sources.ts can choose between them at one line.
// Everything between differs: that one uploads each file to OpenAI once and references it by
// id as an `input_file` part, chaining on a stateful Responses call; this one has no file
// store to reference, so the bytes themselves travel, as images, on a stateless Chat
// Completions call.
//
// WHY THE BYTES AND NOT AN ID. vLLM has no Files API and no `file` content part at all — the
// server says so itself: `Unsupported chat content part type: 'file'. Supported types:
// audio_embeds, audio_url, image_embeds, image_pil, image_url, input_audio, input_image,
// input_text, output_text, prompt_embeds, refusal, text, thinking, tool_reference,
// video_url`. OpenAI's `input_file` works because OpenAI's PLATFORM converts a PDF before the
// model sees it; that conversion is the product. Here it happens in pdf-raster.ts instead,
// and is not OCR — no model, no spend, no extracted text.
//
// WHAT EACH KIND BECOMES, and why they differ:
//
//   * pdf    — rasterised to overlapping page strips and sent as images. See pdf-raster.ts
//              for why strips rather than whole pages: the model normalises every image to
//              one fixed tile, so a whole A4 page smears and it misread `५०० कोटी` as
//              `४०० कोटी`. This is the accuracy-critical path.
//   * image  — sent as-is. A photograph of a document is already one page of pixels, which
//              is exactly the reason it never needed a page picker either.
//   * docx   — extracted to TEXT locally with mammoth. Free, exact, and no model can misread
//              a character it was handed as text. Rendering it to pixels first would be
//              strictly worse.
//   * txt    — decoded to text. Same reasoning.
//
// So only the two kinds that ARE pixels are treated as pixels. That is not a compromise: a
// DOCX carries its characters, and the whole hazard this module guards against is a model
// guessing at a glyph it can barely see.
//
// ONE ENDPOINT CAN SERVE TWO MODELS. vLLM loads a LoRA adapter beside the base
// (`--enable-lora --lora-modules <name>=<path>`) and routes on the request's `model` field,
// so the DGIPR-voice adapter distilled from the OpenAI teacher and the stock base are both
// reachable at the same URL for no extra cost. Which one answers is a LANE, not a model
// string — see GemmaLane below for why that distinction is load-bearing — and the lane
// that carries it is /dlo's article, because that is the only text the adapter was trained
// to write. Reading names off a page (extract-name-context.ts) stays on the base.
//
// THE TOKEN BUDGET IS REAL AND IS CHECKED. Measured against the deployed endpoint: an image
// costs ~270 prompt tokens whatever its pixel size, and the endpoint is configured to
// MAX_MODEL_LEN=32768. Weights are 62.5 GB against 76 GB of usable A100, so raising that is
// not free — 262,144 would need 43.8 GB of KV cache against ~12 GB available, and would fail
// to allocate. GEMMA_MAX_SOURCE_TILES therefore bounds what one run may attach, and the
// refusal is in Marathi because the officer is the one who must act on it.

import { pathToFileURL } from 'node:url';

import { GEMMA_COST_PROVIDER } from '../cost/pricing.js';
import { recordChatUsage } from '../cost/cost-meter.js';
import { openAiFetch } from '../http/openai-request.js';
import { readChatCompletionStream } from '../http/openai-chat-stream.js';
import { extractDocxText } from '../intake/docx.js';
import {
  rasterizePdf,
  type RasterTile,
  type RasterizeOptions,
} from '../intake/pdf-raster.js';
import {
  buildDloArticleUserPrompt,
  DLO_SOURCE_FILES_MARKER,
} from './dlo-article-prompt.js';
import type { ChatMessage } from './openai-chat.js';

/** Measured against gemma-4-31B-it on 2026-09-20: one image is ~270 prompt tokens, any size. */
export const GEMMA_TOKENS_PER_IMAGE = 270;

/**
 * The most page-strips one run may attach.
 *
 * Derived from the deployed 32,768-token context, not guessed: 8,192 reserved for the
 * article, roughly 6,000 for the specification, the officer's note and their instructions,
 * leaving ~18,500 for pixels — about 68 strips, i.e. ~22 pages at the default 3 strips each.
 * Set below that for headroom. Raise it with the context window, never on its own.
 */
export const DEFAULT_MAX_SOURCE_TILES = 60;

export type SourceDocumentKind = 'pdf' | 'image' | 'docx' | 'txt';

/**
 * One of the officer's uploaded sources, WITH ITS BYTES.
 *
 * The OpenAI lane's SourceFileRef carries a file id instead, because the bytes are already
 * on OpenAI. Here they must travel, so the caller reads them back out of the private
 * dlo-uploads bucket the route archived them to.
 */
export type SourceDocument = Readonly<{
  name: string;
  kind: SourceDocumentKind;
  data: Buffer;
}>;

export type ContentPart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'image_url'; image_url: Readonly<{ url: string }> }>;

/** One wire message: a plain string, or the multimodal parts array when documents ride on it. */
export type GemmaMessage = Readonly<{
  role: string;
  content: string | readonly ContentPart[];
}>;

export class GemmaNotConfiguredError extends Error {
  constructor(variable: string) {
    super(
      `Missing required environment variable ${variable}. Point it at the ` +
        "OpenAI-compatible base of the gemma endpoint, ending in '/v1'.",
    );
    this.name = 'GemmaNotConfiguredError';
  }
}

export class GemmaSourcesTooLargeError extends Error {
  constructor(
    readonly tiles: number,
    readonly maxTiles: number,
  ) {
    super(
      `जोडलेली कागदपत्रे खूप मोठी आहेत — ${tiles} भाग तयार होतात, मर्यादा ${maxTiles} आहे. ` +
        `कृपया कमी पृष्ठे जोडा.`,
    );
    this.name = 'GemmaSourcesTooLargeError';
  }
}

function configuredBaseUrl(): string {
  return process.env.GEMMA_BASE_URL?.trim() ?? '';
}

/** Whether this deployment can serve the gemma lane at all. Never throws — see isQwenConfigured. */
export function isGemmaConfigured(): boolean {
  return configuredBaseUrl() !== '';
}

export function gemmaBaseUrl(): string {
  const value = configuredBaseUrl();
  if (!value) throw new GemmaNotConfiguredError('GEMMA_BASE_URL');
  let clean = value.replace(/\/+$/, '');
  if (clean.includes('api.runpod.ai/v2') && !clean.endsWith('/openai/v1')) {
    clean = clean.replace(/\/openai(\/v1)?$/, '') + '/openai/v1';
  }
  return clean;
}

export function gemmaChatCompletionsUrl(): string {
  return `${gemmaBaseUrl()}/chat/completions`;
}

export function gemmaModelsUrl(): string {
  return `${gemmaBaseUrl()}/models`;
}

/**
 * What this endpoint actually serves, straight from vLLM's own `/v1/models`.
 *
 * The deploy-time answer to "is the adapter loaded?", and the reason it is worth having is
 * the alternative: the first thing that otherwise discovers a missing adapter is an
 * officer's article failing, minutes into a job, behind a canned Marathi sentence. A GET
 * costs nothing and wakes no weights.
 */
export async function listGemmaModels(): Promise<string[]> {
  const response = await openAiFetch(gemmaModelsUrl(), {
    label: 'gemma models',
    apiKey: gemmaApiKey(),
    method: 'GET',
  });
  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown }>;
  };
  return (payload.data ?? [])
    .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
    .filter((id) => id !== '');
}

/**
 * Must match the server's own `--model` exactly: vLLM matches the request's `model` field
 * against what it serves and 404s on anything else, so this is not cosmetic.
 */
export function gemmaModel(): string {
  return process.env.GEMMA_MODEL?.trim() || 'google/gemma-4-31B-it';
}

/**
 * WHICH JOB a gemma call is doing, and therefore which of the endpoint's models answers it.
 *
 * A lane rather than a model string, deliberately. The distinction the fine-tuned adapter
 * draws is between WRITING a DGIPR article in the department's voice and READING something
 * off a page — and that is a fact about the caller's job, not a decision each call site
 * should be re-making. A `model` parameter would put the choice at three call sites, where
 * the name scan would have to actively pass the base model and an omission there would
 * silently route a reading task through a writing adapter it was never trained for. With a
 * lane, the default IS the base, so a caller that says nothing is provably unaffected.
 */
export type GemmaLane = 'default' | 'dlo';

/**
 * The adapter that writes /dlo articles, when one is deployed.
 *
 * Unset ⇒ `gemmaModel()`, so an endpoint serving only the base behaves exactly as it does
 * today and the rollback is deleting one line from the environment. When set it must name a
 * model the endpoint actually serves — with vLLM that is the NAME side of
 * `--lora-modules <name>=<path>`, not a Hugging Face id — because the server 404s on
 * anything else. See modelNotServedHint below, which turns that 404 into a sentence naming
 * this variable.
 */
export function gemmaDloModel(): string {
  return process.env.GEMMA_DLO_MODEL?.trim() || gemmaModel();
}

/** The one place a lane becomes a model id. */
export function gemmaModelFor(lane: GemmaLane = 'default'): string {
  return lane === 'dlo' ? gemmaDloModel() : gemmaModel();
}

/**
 * Runpod's serverless OpenAI route is authenticated with the ACCOUNT key, so unlike the Qwen
 * pod (which serves unauthenticated behind a proxy URL) this is normally required. Still read
 * permissively: a self-hosted gemma behind a private network legitimately has none, and
 * openAiFetch reads an empty key as "send no authorization header".
 */
export function gemmaApiKey(): string {
  return (
    process.env.GEMMA_API_KEY?.trim() ??
    process.env.RUNPOD_API_KEY?.trim() ??
    ''
  );
}

export function gemmaTimeoutMs(): number {
  const configured = Number(process.env.GEMMA_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? Math.floor(configured)
    : 900_000;
}

export function gemmaMaxSourceTiles(): number {
  const configured = Number(process.env.GEMMA_MAX_SOURCE_TILES);
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : DEFAULT_MAX_SOURCE_TILES;
}

function tilesPerPage(): number | undefined {
  const configured = Number(process.env.GEMMA_TILES_PER_PAGE);
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : undefined;
}

function dataUri(buf: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * A Marathi header naming the document a strip came from, so the model can tell two attached
 * sources apart and attribute a fact to the right one. The same `=== स्रोत: … ===` shape the
 * text lane's combineIntakeSources writes, for the same reason.
 */
function tileLabel(name: string, tile: RasterTile): string {
  return tile.tileCount > 1
    ? `=== स्रोत: ${name} · पृष्ठ ${tile.page} (भाग ${tile.tile}/${tile.tileCount}) ===`
    : `=== स्रोत: ${name} · पृष्ठ ${tile.page} ===`;
}

export type PreparedSources = Readonly<{
  parts: readonly ContentPart[];
  imageCount: number;
  /** Per-document failures. Never fatal: one unreadable source must not sink the intake. */
  warnings: readonly string[];
}>;

/**
 * Turns the officer's uploaded sources into content parts this model can actually read.
 *
 * Refuses UP FRONT when the selection would exceed the tile budget, before rendering
 * anything — a document that cannot be used should cost no work.
 */
export async function prepareGemmaSources(
  documents: readonly SourceDocument[],
  options: RasterizeOptions = {},
): Promise<PreparedSources> {
  const parts: ContentPart[] = [];
  const warnings: string[] = [];
  const maxTiles = options.maxTiles ?? gemmaMaxSourceTiles();
  const perPage = options.tilesPerPage ?? tilesPerPage();
  let imageCount = 0;

  for (const document of documents) {
    try {
      switch (document.kind) {
        case 'txt': {
          const text = document.data.toString('utf8').replace(/^\ufeff/, '');
          parts.push({
            type: 'text',
            text: `=== स्रोत: ${document.name} ===\n${text}`,
          });
          break;
        }
        case 'docx': {
          const text = await extractDocxText(document.name, document.data);
          parts.push({
            type: 'text',
            text: `=== स्रोत: ${document.name} ===\n${text}`,
          });
          break;
        }
        case 'image': {
          if (imageCount + 1 > maxTiles) {
            throw new GemmaSourcesTooLargeError(imageCount + 1, maxTiles);
          }
          parts.push({ type: 'text', text: `=== स्रोत: ${document.name} ===` });
          const lower = document.name.toLowerCase();
          const mime =
            lower.endsWith('.jpg') || lower.endsWith('.jpeg')
              ? 'image/jpeg'
              : lower.endsWith('.webp')
                ? 'image/webp'
                : 'image/png';
          parts.push({
            type: 'image_url',
            image_url: { url: dataUri(document.data, mime) },
          });
          imageCount += 1;
          break;
        }
        case 'pdf': {
          const tiles = await rasterizePdf(document.data, {
            ...options,
            ...(perPage !== undefined ? { tilesPerPage: perPage } : {}),
            maxTiles: maxTiles - imageCount,
          });
          if (imageCount + tiles.length > maxTiles) {
            throw new GemmaSourcesTooLargeError(
              imageCount + tiles.length,
              maxTiles,
            );
          }
          for (const tile of tiles) {
            parts.push({ type: 'text', text: tileLabel(document.name, tile) });
            parts.push({
              type: 'image_url',
              image_url: { url: dataUri(tile.png) },
            });
          }
          imageCount += tiles.length;
          break;
        }
      }
    } catch (error) {
      // A budget refusal is the officer's to act on and must reach them; anything else is
      // one source failing, which the run survives (the intake-job stance).
      if (error instanceof GemmaSourcesTooLargeError) throw error;
      warnings.push(
        `${document.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { parts, imageCount, warnings };
}

/**
 * Places the officer's documents in the prompt and removes the transport marker.
 *
 * `buildDloArticleUserPrompt` emits DLO_SOURCE_FILES_MARKER at the position the attachments
 * belong — INSIDE `### SOURCE INFORMATION`, above the reviewed-name and officer-request blocks
 * the officer approved. `buildSourcesRequest` splices the OpenAI file parts in at that offset;
 * this is the same splice for image parts, and it exists for the same reason. Without it the
 * pages land at the TOP of the turn, above every reviewed block, and the literal NUL sentinel
 * reaches the model as text.
 *
 * TWO RULES NOT TO UNDO. The marker is removed whether or not there is anything to put there:
 * a document that fails to prepare leaves `parts` empty while the prompt still carries the
 * marker, and a NUL in the prompt is never correct. And a message with NO marker keeps the
 * established contract — the parts go ahead of the last user turn's text, which is the order
 * the measured reading test used: the model sees the pages, then the instruction about them.
 */
export function buildGemmaMessages(
  messages: readonly ChatMessage[],
  parts: readonly ContentPart[],
): GemmaMessage[] {
  let placedAtMarker = false;
  const out: GemmaMessage[] = messages.map((message) => {
    const markerAt = message.content.indexOf(DLO_SOURCE_FILES_MARKER);
    if (markerAt === -1)
      return { role: message.role, content: message.content };
    if (markerAt !== message.content.lastIndexOf(DLO_SOURCE_FILES_MARKER)) {
      throw new Error('DLO source-file marker may appear only once.');
    }

    const before = message.content.slice(0, markerAt);
    const after = message.content.slice(
      markerAt + DLO_SOURCE_FILES_MARKER.length,
    );
    placedAtMarker = parts.length > 0;
    return {
      role: message.role,
      content: [
        ...(before ? [{ type: 'text' as const, text: before }] : []),
        ...parts,
        ...(after ? [{ type: 'text' as const, text: after }] : []),
      ],
    };
  });

  if (parts.length === 0 || placedAtMarker) return out;

  for (let index = out.length - 1; index >= 0; index -= 1) {
    const message = out[index];
    if (!message || message.role !== 'user') continue;
    out[index] = {
      role: message.role,
      content:
        typeof message.content === 'string'
          ? [...parts, { type: 'text' as const, text: message.content }]
          : [...parts, ...message.content],
    };
    return out;
  }

  // No user turn at all — the parts would otherwise be dropped silently.
  out.push({ role: 'user', content: [...parts] });
  return out;
}

/**
 * Whether a failed call is worth asking the endpoint about.
 *
 * Only a lane that actually overrides the model can have been broken by the override, so a
 * base-model failure is left entirely alone — there GEMMA_DLO_MODEL is not the thing to go
 * and look at, and saying otherwise would send an operator to the wrong place.
 *
 * Pure and exported so the gate is asserted offline; the live half is below.
 */
export function overridesGemmaModel(lane: GemmaLane, model: string): boolean {
  return lane === 'dlo' && model !== gemmaModel();
}

/** The sentence an unserved adapter earns. Pure, so its content is assertable. */
export function missingGemmaModelMessage(
  model: string,
  baseModel: string,
): string {
  return (
    `The gemma endpoint does not serve "${model}", which GEMMA_DLO_MODEL names. ` +
    'Either the adapter is not loaded (vLLM needs --enable-lora and ' +
    '--lora-modules <name>=<path>, and the name must match this value exactly), or the ' +
    'endpoint was recreated without it. Unset GEMMA_DLO_MODEL to write /dlo articles on ' +
    `the base model "${baseModel}" again.`
  );
}

/**
 * Turns a failed DLO-lane call into a sentence naming the variable that caused it — by
 * ASKING the endpoint what it serves, rather than by reading the error.
 *
 * An unserved `model` is the ONE failure this override can introduce and it is TOTAL: every
 * article on the lane fails, and the officer sees a canned Marathi sentence because
 * errorMessage.ts whitelists on Devanagari. So the variable has to be named in the log or it
 * is named nowhere.
 *
 * WHY EVIDENCE AND NOT A STRING MATCH. Measured against the deployed endpoint on
 * 2026-09-20: vLLM's own 404 never arrives. Runpod's serverless OpenAI proxy answers an
 * unrecognised model with a bare `500 {"detail":"internal server error"}` — verified by
 * sending the same request twice, once naming an unloaded adapter (500) and once naming the
 * base (200, warm worker). So a `404`-shaped matcher would have been dead code here, and a
 * `500`-shaped one would misreport a genuine worker crash or OOM as a missing adapter. One
 * cheap GET answers it for certain, on both deployment shapes, and it runs only on a path
 * that has already failed. Best-effort: if the check itself fails, the original error stands
 * rather than being replaced by a guess.
 *
 * Note this lands AFTER openAiFetch's retry ladder — a 500 is retryable, so an unloaded
 * adapter fails slowly as well as opaquely. The `--models` preflight is the real defence;
 * this is the backstop for a deployment that skipped it.
 */
export async function diagnoseGemmaModel(
  error: unknown,
  lane: GemmaLane,
  model: string,
): Promise<Error | null> {
  if (!overridesGemmaModel(lane, model)) return null;
  try {
    const served = await listGemmaModels();
    if (served.includes(model)) return null;
    return new Error(missingGemmaModelMessage(model, gemmaModel()), {
      cause: error,
    });
  } catch {
    return null;
  }
}

/**
 * Writes the article on gemma, with the officer's documents attached as pixels.
 *
 * `messages` is the SAME array the OpenAI lane builds — one specification, one prompt, so a
 * provider swap changes who answers and not what was asked.
 *
 * `lane` names the job, and therefore the model: the DLO lane addresses the fine-tuned
 * adapter when one is deployed, everything else the base. Omitting it is the base, so a
 * caller that has no opinion cannot accidentally acquire one.
 */
export async function respondWithSourcesViaGemma(options: {
  label: string;
  messages: readonly ChatMessage[];
  documents: readonly SourceDocument[];
  maxOutputTokens: number;
  lane?: GemmaLane | undefined;
  timeoutMs?: number | undefined;
  onDelta?: ((chunk: string) => void) | undefined;
  onWarnings?: ((warnings: readonly string[]) => void) | undefined;
}): Promise<string> {
  const prepared = await prepareGemmaSources(options.documents);
  if (prepared.warnings.length > 0) {
    for (const warning of prepared.warnings) {
      console.warn(`[gemma-sources] ${warning}`);
    }
    options.onWarnings?.(prepared.warnings);
  }

  // A system message is supported by this chat template — verified against the live endpoint,
  // which honoured one — so it is NOT folded into the user turn the way older Gemma templates
  // required.
  const messages = buildGemmaMessages(options.messages, prepared.parts);

  const lane = options.lane ?? 'default';
  const model = gemmaModelFor(lane);

  const body = {
    model,
    messages,
    max_tokens: options.maxOutputTokens,
    temperature: 0,
    stream: true,
    stream_options: { include_usage: true },
  };

  let response;
  try {
    response = await openAiFetch(gemmaChatCompletionsUrl(), {
      label: options.label,
      apiKey: gemmaApiKey(),
      body,
      timeoutMs: options.timeoutMs ?? gemmaTimeoutMs(),
    });
  } catch (error) {
    // The override's one total failure, made self-diagnosing.
    throw (await diagnoseGemmaModel(error, lane, model)) ?? error;
  }
  if (!response.body) {
    throw new Error('gemma returned no response body to stream.');
  }

  // The reader hands the answer back through callbacks rather than returning it —
  // `onDelta` is the officer's live view and `onText` is what accumulates. Keeping them
  // separate is what lets a caller with no live view still get the article.
  let text = '';
  const result = await readChatCompletionStream<{
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }>(
    response.body,
    options.onDelta ?? (() => {}),
    (chunk) => {
      text += chunk;
    },
    { label: options.label },
  );

  // Recorded under the model that ACTUALLY answered, not the base: on an endpoint serving
  // both, a usage row naming the base would make the adapter's traffic indistinguishable
  // from the base's — and telling them apart is the whole point of serving them together.
  if (result.usage) {
    recordChatUsage(model, result.usage, GEMMA_COST_PROVIDER);
  }

  // A completion cut off at the ceiling is a partial article, and storing one silently is
  // the failure the Qwen lane already learned to refuse.
  if (result.finishReason === 'length') {
    throw new Error(
      `gemma stopped at the ${options.maxOutputTokens}-token ceiling before finishing the article. ` +
        `Raise GEMMA_MAX_OUTPUT_TOKENS or attach fewer pages.`,
    );
  }

  const article = text.trim();
  if (!article) {
    throw new Error('gemma returned an empty article.');
  }
  return article;
}

// ---------------------------------------------------------------------------
// Free harness: config + source preparation, no network.
//   tsx src/generation/gemma-sources.ts
//
// Plus a deploy-time preflight against the live endpoint — one GET, no spend, no weights
// woken. Run it after loading an adapter and before setting GEMMA_DLO_MODEL:
//   tsx --env-file=../../.env src/generation/gemma-sources.ts --models
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv.includes('--models')
) {
  const served = await listGemmaModels();
  console.log(`${gemmaModelsUrl()} serves ${served.length} model(s):`);
  for (const id of served) console.log(`  - ${id}`);

  const base = gemmaModel();
  const dlo = gemmaDloModel();
  const report = (label: string, id: string): boolean => {
    const ok = served.includes(id);
    console.log(`\n${ok ? 'ok  ' : 'FAIL'} ${label}: "${id}"`);
    return ok;
  };

  let ok = report('base (GEMMA_MODEL)', base);
  if (dlo === base) {
    console.log(
      '\nGEMMA_DLO_MODEL is unset, so /dlo articles are written by the base model. ' +
        'That is the rollback state, and it is a valid one.',
    );
  } else {
    ok = report('/dlo adapter (GEMMA_DLO_MODEL)', dlo) && ok;
    if (!served.includes(dlo)) {
      console.log(
        '  vLLM needs --enable-lora and --lora-modules <name>=<path>, and <name> must ' +
          'equal GEMMA_DLO_MODEL exactly. Until it does, EVERY /dlo article fails.',
      );
    }
  }
  process.exitCode = ok ? 0 : 1;
} else if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };

  const original = {
    base: process.env.GEMMA_BASE_URL,
    model: process.env.GEMMA_MODEL,
    dloModel: process.env.GEMMA_DLO_MODEL,
    tiles: process.env.GEMMA_MAX_SOURCE_TILES,
  };

  delete process.env.GEMMA_BASE_URL;
  check('unset base url reports not configured', !isGemmaConfigured());
  let threw = '';
  try {
    gemmaBaseUrl();
  } catch (error) {
    threw = error instanceof Error ? error.message : '';
  }
  check('and throws naming the variable', threw.includes('GEMMA_BASE_URL'));

  process.env.GEMMA_BASE_URL = 'https://api.runpod.ai/v2/abc/openai/v1/';
  check('configured', isGemmaConfigured());
  check(
    'trailing slash trimmed',
    gemmaChatCompletionsUrl() ===
      'https://api.runpod.ai/v2/abc/openai/v1/chat/completions',
  );
  delete process.env.GEMMA_MODEL;
  check(
    'default model is the served id',
    gemmaModel() === 'google/gemma-4-31B-it',
  );
  process.env.GEMMA_MODEL = '  google/other  ';
  check('model trimmed', gemmaModel() === 'google/other');

  // --- the per-lane model override: the adapter beside the base ---------------------
  // Every way this can be wrong is silent. An override that does not apply leaves the DLO
  // lane on the base while the operator believes it switched; one that applies too widely
  // routes a reading task through a writing adapter; and a stale value survives a rollback.
  process.env.GEMMA_MODEL = 'google/gemma-4-31B-it';
  delete process.env.GEMMA_DLO_MODEL;
  check(
    'unset GEMMA_DLO_MODEL leaves the DLO lane on the base — the rollback',
    gemmaDloModel() === gemmaModel() &&
      gemmaModelFor('dlo') === 'google/gemma-4-31B-it',
  );
  check(
    'and an omitted lane is the base too',
    gemmaModelFor() === 'google/gemma-4-31B-it' &&
      gemmaModelFor('default') === 'google/gemma-4-31B-it',
  );
  process.env.GEMMA_DLO_MODEL = '  dgipr-dlo-v1  ';
  check(
    'set, the DLO lane addresses the adapter',
    gemmaModelFor('dlo') === 'dgipr-dlo-v1',
  );
  check(
    'while every other lane provably stays on the base',
    gemmaModelFor('default') === 'google/gemma-4-31B-it' &&
      gemmaModelFor() === 'google/gemma-4-31B-it' &&
      gemmaModel() === 'google/gemma-4-31B-it',
  );
  process.env.GEMMA_DLO_MODEL = '   ';
  check(
    'a blank value is not a model id, it is unset',
    gemmaModelFor('dlo') === 'google/gemma-4-31B-it',
  );
  delete process.env.GEMMA_DLO_MODEL;

  // An unloaded adapter fails EVERY article on the lane, so the gate that decides whether
  // to go and ask the endpoint about it has to be exactly right in both directions.
  process.env.GEMMA_DLO_MODEL = 'dgipr-dlo-v1';
  check(
    'a DLO failure under an override is worth diagnosing',
    overridesGemmaModel('dlo', 'dgipr-dlo-v1'),
  );
  check(
    'a failure on the BASE model is not — this variable is not the thing to look at',
    !overridesGemmaModel('dlo', 'google/gemma-4-31B-it'),
  );
  check(
    'nor is any failure on a lane that does not override',
    !overridesGemmaModel('default', 'dgipr-dlo-v1'),
  );
  delete process.env.GEMMA_DLO_MODEL;
  check(
    'and with the override rolled back, nothing on any lane is',
    !overridesGemmaModel('dlo', 'google/gemma-4-31B-it') &&
      !overridesGemmaModel('default', 'google/gemma-4-31B-it'),
  );

  const missing = missingGemmaModelMessage(
    'dgipr-dlo-v1',
    'google/gemma-4-31B-it',
  );
  check(
    'the diagnosis names the variable that chose it',
    missing.includes('GEMMA_DLO_MODEL'),
  );
  check(
    'the vLLM flags that load it',
    missing.includes('--enable-lora') && missing.includes('--lora-modules'),
  );
  check(
    'and the rollback, with the base model it returns to',
    missing.includes('Unset GEMMA_DLO_MODEL') &&
      missing.includes('google/gemma-4-31B-it'),
  );

  delete process.env.GEMMA_MAX_SOURCE_TILES;
  check(
    'default tile budget',
    gemmaMaxSourceTiles() === DEFAULT_MAX_SOURCE_TILES,
  );
  process.env.GEMMA_MAX_SOURCE_TILES = '12';
  check('tile budget overridable', gemmaMaxSourceTiles() === 12);

  const run = async (): Promise<void> => {
    const txt = await prepareGemmaSources([
      { name: 'note.txt', kind: 'txt', data: Buffer.from('\ufeff५०० कोटी') },
    ]);
    check('a txt source becomes text, not pixels', txt.imageCount === 0);
    check(
      'its BOM is stripped and digits survive',
      txt.parts.some(
        (p) =>
          p.type === 'text' &&
          p.text.includes('५०० कोटी') &&
          !p.text.includes('\ufeff'),
      ),
    );
    check(
      'and it is labelled with the file name',
      txt.parts.some(
        (p) => p.type === 'text' && p.text.includes('=== स्रोत: note.txt ==='),
      ),
    );

    const image = await prepareGemmaSources([
      { name: 'photo.jpg', kind: 'image', data: Buffer.from('not-a-real-png') },
    ]);
    check('a photograph is one image part', image.imageCount === 1);
    check(
      'carried as a data uri under its own media type',
      image.parts.some(
        (p) =>
          p.type === 'image_url' &&
          p.image_url.url.startsWith('data:image/jpeg;base64,'),
      ),
    );
    const png = await prepareGemmaSources([
      { name: 'scan.PNG', kind: 'image', data: Buffer.from('x') },
    ]);
    check(
      'an unknown or png extension falls back to image/png',
      png.parts.some(
        (p) =>
          p.type === 'image_url' &&
          p.image_url.url.startsWith('data:image/png;base64,'),
      ),
    );

    let budgetThrew = '';
    try {
      await prepareGemmaSources(
        Array.from({ length: 3 }, (_, i) => ({
          name: `p${i}.jpg`,
          kind: 'image' as const,
          data: Buffer.from('x'),
        })),
        { maxTiles: 2 },
      );
    } catch (error) {
      budgetThrew = error instanceof Error ? error.message : '';
    }
    check('over-budget refuses', budgetThrew.includes('मर्यादा'));
    check('and the refusal is Marathi', /[ऀ-ॿ]/.test(budgetThrew));

    const broken = await prepareGemmaSources([
      { name: 'broken.docx', kind: 'docx', data: Buffer.from('not-a-docx') },
    ]);
    check(
      'an unreadable source warns rather than throws',
      broken.warnings.length === 1,
    );
    check(
      'and names the file',
      broken.warnings[0]?.startsWith('broken.docx:') === true,
    );

    // --- the source-file marker: the production prompt's own placement ---------------
    const page: ContentPart = {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    };
    const dloUser = buildDloArticleUserPrompt({
      sourceInformation: 'टिपणी',
      attachedSourceFiles: true,
      heading: 'मथळा',
    });
    const dloMessages = buildGemmaMessages(
      [
        { role: 'system', content: 'Write a DGIPR Maharashtra style article.' },
        { role: 'user', content: dloUser },
      ],
      [page],
    );
    const asText = JSON.stringify(dloMessages);
    check(
      'no NUL sentinel survives into the wire messages',
      !asText.includes('\u0000'),
    );
    check(
      'the system message stays a plain string',
      dloMessages[0]?.content === 'Write a DGIPR Maharashtra style article.',
    );
    const dloParts = dloMessages[1]?.content;
    const dloArray = Array.isArray(dloParts) ? dloParts : [];
    const imageAt = dloArray.findIndex((p) => p.type === 'image_url');
    const headingAt = dloArray.findIndex(
      (p) => p.type === 'text' && p.text.includes('### HEADLINE / ANGLE'),
    );
    const sourceAt = dloArray.findIndex(
      (p) => p.type === 'text' && p.text.includes('### SOURCE INFORMATION'),
    );
    check('the page is spliced at the marker', imageAt > 0);
    check(
      'SOURCE INFORMATION comes before it',
      sourceAt >= 0 && sourceAt < imageAt,
    );
    check('and the reviewed blocks come after it', headingAt > imageAt);

    check(
      'a marker with nothing to place is still removed',
      !JSON.stringify(
        buildGemmaMessages([{ role: 'user', content: dloUser }], []),
      ).includes('\u0000'),
    );

    let twice = '';
    try {
      buildGemmaMessages(
        [
          {
            role: 'user',
            content: `a${DLO_SOURCE_FILES_MARKER}b${DLO_SOURCE_FILES_MARKER}c`,
          },
        ],
        [page],
      );
    } catch (error) {
      twice = error instanceof Error ? error.message : '';
    }
    check('a duplicated marker throws', twice.includes('only once'));

    const noMarker = buildGemmaMessages(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'plain prompt' },
      ],
      [page],
    );
    const tail = noMarker[1]?.content;
    const tailArray = Array.isArray(tail) ? tail : [];
    check(
      'a marker-free prompt keeps the pages-then-text order',
      tailArray[0]?.type === 'image_url' &&
        tailArray[1]?.type === 'text' &&
        tailArray[1].text === 'plain prompt',
    );
    check(
      'and a marker-free prompt with no documents is untouched',
      buildGemmaMessages([{ role: 'user', content: 'plain prompt' }], [])[0]
        ?.content === 'plain prompt',
    );

    if (original.base === undefined) delete process.env.GEMMA_BASE_URL;
    else process.env.GEMMA_BASE_URL = original.base;
    if (original.model === undefined) delete process.env.GEMMA_MODEL;
    else process.env.GEMMA_MODEL = original.model;
    if (original.dloModel === undefined) delete process.env.GEMMA_DLO_MODEL;
    else process.env.GEMMA_DLO_MODEL = original.dloModel;
    if (original.tiles === undefined) delete process.env.GEMMA_MAX_SOURCE_TILES;
    else process.env.GEMMA_MAX_SOURCE_TILES = original.tiles;

    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
      if (!ok) failed++;
    }
    console.log(`\n${checks.length - failed}/${checks.length} passed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  };
  await run();
}
