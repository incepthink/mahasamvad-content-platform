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
import { createThinkingStripper } from '../chat/qwen-chat.js';
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

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (Number.isFinite(configured) && configured >= 1) {
    return Math.floor(configured);
  }
  // The pixel budget is fixed by the window, not the tile count: at a larger per-image cost
  // (GEMMA_MAX_SOFT_TOKENS) fewer tiles fit. Unchanged at the default — 60.
  return Math.max(
    1,
    Math.floor(
      (DEFAULT_MAX_SOURCE_TILES * GEMMA_TOKENS_PER_IMAGE) /
        gemmaTokensPerImage(),
    ),
  );
}

function tilesPerPage(): number | undefined {
  const configured = Number(process.env.GEMMA_TILES_PER_PAGE);
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : defaultTilesPerPage();
}

// ---------------------------------------------------------------------------
// Inference settings (2026-09-24). All env-flagged and OFF by default, so an unconfigured
// deployment sends byte-for-byte the request it always has. They exist to be A/B'd with
// finetune/eval-dlo-distillation.ts, not switched on by belief — each one is a documented
// Gemma 4 lever the /dlo lane was not using:
//
//   GEMMA_MAX_SOFT_TOKENS  per-image vision budget (vLLM `mm_processor_kwargs.max_soft_tokens`,
//                          one of 70/140/280/560/1120; the server default is 280). Google
//                          recommends 1120 for OCR and document layout. The Jalna report read
//                          at 280 came back with अबेड for अंबड and घनसावनी for घनसावंगी.
//                          Raising it raises every image's COST in the 32k context, so the
//                          tile defaults below follow it.
//   GEMMA_ENABLE_THINKING  `chat_template_kwargs.enable_thinking` — the reasoning step GPT-5.6
//                          always takes and this lane never did. Budgeted against the window.
//   GEMMA_SAMPLING         `greedy` (temperature 0, today) or `google` (1.0 / 0.95 / 64, the
//                          model card's recommendation). Factual writing may still favour
//                          greedy, which is exactly why it is measured and not assumed.
// ---------------------------------------------------------------------------

export const GEMMA_SOFT_TOKEN_VALUES = [70, 140, 280, 560, 1120] as const;
export type GemmaSoftTokens = (typeof GEMMA_SOFT_TOKEN_VALUES)[number];

/** The per-image vision budget to REQUEST, or null to send nothing (the server's 280). */
export function gemmaMaxSoftTokens(): GemmaSoftTokens | null {
  const raw = process.env.GEMMA_MAX_SOFT_TOKENS?.trim();
  if (!raw) return null;
  const value = Number(raw);
  const match = GEMMA_SOFT_TOKEN_VALUES.find((allowed) => allowed === value);
  if (match === undefined) {
    // Refusing loudly beats sending a value vLLM rejects on every paid /dlo article.
    throw new Error(
      `GEMMA_MAX_SOFT_TOKENS must be one of ${GEMMA_SOFT_TOKEN_VALUES.join(', ')} ` +
        `(got "${raw}"). Unset it to use the server default of 280.`,
    );
  }
  return match;
}

/**
 * What one image costs in the prompt. Measured at the default (270 at 280 soft tokens); at a
 * requested budget the budget itself is taken, which errs high — the safe side of a refusal.
 */
export function gemmaTokensPerImage(): number {
  return gemmaMaxSoftTokens() ?? GEMMA_TOKENS_PER_IMAGE;
}

/**
 * Strips per page when GEMMA_TILES_PER_PAGE is unset. Tiling exists because a whole page
 * squeezed into 280 soft tokens smears (`५०० कोटी` read as `४०० कोटी`); at 1120 a page has four
 * times the pixels to itself and one tile is the starting point, at 560 two. Measure before
 * trusting either — this is a default, not a finding.
 */
function defaultTilesPerPage(): number | undefined {
  const soft = gemmaMaxSoftTokens();
  if (soft === 1120) return 1;
  if (soft === 560) return 2;
  return undefined;
}

/** The deployed endpoint's MAX_MODEL_LEN. */
export function gemmaMaxModelLen(): number {
  return readInt('GEMMA_MAX_MODEL_LEN', 32_768);
}

export function gemmaThinkingEnabled(): boolean {
  const raw = process.env.GEMMA_ENABLE_THINKING?.trim().toLowerCase() ?? '';
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/** The most tokens thinking may take on one call, before the window cuts it down. */
export function gemmaThinkingTokens(): number {
  return readInt('GEMMA_THINKING_TOKENS', 8_192);
}

// Below this, thinking is not worth enabling: a model that runs out of room mid-thought never
// reaches the article, and a truncated article is the one failure a paid run must not have.
const MIN_THINKING_TOKENS = 1_024;
// Slack between the estimate and the window — the estimate is a character ratio, not a tokenizer.
const CONTEXT_SAFETY_TOKENS = 1_024;

export type GemmaSampling = 'greedy' | 'google';

export function gemmaSampling(): GemmaSampling {
  const raw = process.env.GEMMA_SAMPLING?.trim().toLowerCase() || 'greedy';
  if (raw === 'greedy' || raw === 'google') return raw;
  throw new Error(
    `GEMMA_SAMPLING must be "greedy" or "google" (got "${raw}").`,
  );
}

function samplingParams(
  sampling: GemmaSampling,
): Readonly<Record<string, number>> {
  return sampling === 'google'
    ? { temperature: 1.0, top_p: 0.95, top_k: 64 }
    : { temperature: 0 };
}

// Gemma 4's thinking channel as it appears in `content` when the server runs no reasoning
// parser. `skip_special_tokens: false` is what keeps these markers in the text at all —
// without it vLLM drops them and the thought itself lands in the article unmarked.
export const GEMMA_THINK_TAGS = {
  open: '<|channel>',
  close: '<channel|>',
} as const;

// Any other Gemma control token that survives `skip_special_tokens: false`. Devanagari prose
// never contains this shape.
const GEMMA_CONTROL_TOKEN = /<\|[a-z_]+>|<[a-z_]+\|>/gu;

export function scrubGemmaControlTokens(text: string): string {
  return text.replace(GEMMA_CONTROL_TOKEN, '');
}

/**
 * A rough prompt size: ~3.8 characters per token for text (Gemma reads Devanagari at ~3.8, and
 * the specification is English), plus the per-image cost. Only ever used to decide how much
 * thinking fits — vLLM itself is the authority on the window.
 */
export function estimateGemmaPromptTokens(
  messages: readonly GemmaMessage[],
  tokensPerImage = gemmaTokensPerImage(),
): number {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'text') chars += part.text.length;
      else images += 1;
    }
  }
  return Math.ceil(chars / 3.8) + images * tokensPerImage;
}

export type GemmaRequestPlan = Readonly<{
  body: Readonly<Record<string, unknown>>;
  /** Tokens granted to thinking on this call; 0 when it is off or does not fit. */
  thinkingTokens: number;
}>;

/**
 * The Chat Completions body, from the settings above. Pure (bar the env reads) and exported
 * so every combination is asserted offline — the failure modes here are all silent on the
 * wire: a thought leaking into the article, a window overrun that 400s only on long sources.
 */
export function buildGemmaRequestBody(options: {
  model: string;
  messages: readonly GemmaMessage[];
  maxOutputTokens: number;
  stream: boolean;
  thinking?: boolean | undefined;
}): GemmaRequestPlan {
  const images = options.messages.reduce(
    (count, message) =>
      typeof message.content === 'string'
        ? count
        : count +
          message.content.filter((part) => part.type === 'image_url').length,
    0,
  );

  let thinkingTokens = 0;
  if (options.thinking ?? gemmaThinkingEnabled()) {
    const room =
      gemmaMaxModelLen() -
      estimateGemmaPromptTokens(options.messages) -
      options.maxOutputTokens -
      CONTEXT_SAFETY_TOKENS;
    const granted = Math.min(gemmaThinkingTokens(), room);
    if (granted >= MIN_THINKING_TOKENS) thinkingTokens = granted;
  }

  const soft = gemmaMaxSoftTokens();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxOutputTokens + thinkingTokens,
    ...samplingParams(gemmaSampling()),
    ...(thinkingTokens > 0
      ? {
          chat_template_kwargs: { enable_thinking: true },
          skip_special_tokens: false,
        }
      : {}),
    ...(soft !== null && images > 0
      ? { mm_processor_kwargs: { max_soft_tokens: soft } }
      : {}),
    stream: options.stream,
    ...(options.stream ? { stream_options: { include_usage: true } } : {}),
  };
  return { body, thinkingTokens };
}

function lengthMessage(answerTokens: number, thinkingTokens: number): string {
  return thinkingTokens > 0
    ? `gemma stopped at the ${answerTokens + thinkingTokens}-token ceiling ` +
        `(${answerTokens} answer + ${thinkingTokens} thinking) before finishing the article. ` +
        `Lower GEMMA_THINKING_TOKENS, unset GEMMA_ENABLE_THINKING, or attach fewer pages.`
    : `gemma stopped at the ${answerTokens}-token ceiling before finishing the article. ` +
        `Raise GEMMA_MAX_OUTPUT_TOKENS or attach fewer pages.`;
}

/**
 * The answer with any thinking removed, for a whole (non-streamed) reply. With a reasoning
 * parser the content carries no markers and this is the identity; without one it drops the
 * `<|channel>…<channel|>` block.
 */
export function stripGemmaThinking(text: string): string {
  let answer = '';
  const stripper = createThinkingStripper(
    (chunk) => {
      answer += chunk;
    },
    () => {},
    GEMMA_THINK_TAGS,
  );
  stripper.push(text);
  stripper.flush();
  return scrubGemmaControlTokens(answer);
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
  const maxAttempts = readInt('GEMMA_MAX_RETRIES', 5);
  const retryDelayMs = readInt('GEMMA_RETRY_DELAY_MS', 8_000);
  const timeoutMs = options.timeoutMs ?? gemmaTimeoutMs();

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Attempt 1 uses streaming so live tokens are published to the caller.
    // If attempt 1 yields empty text or fails before any tokens arrive (for example,
    // when a serverless RunPod worker is initializing from 0 workers and drops the chunked
    // stream early), subsequent attempts switch to non-streaming, which queues on RunPod
    // until the worker is loaded and ready.
    const isStreaming = attempt === 1;

    const { body, thinkingTokens } = buildGemmaRequestBody({
      model,
      messages,
      maxOutputTokens: options.maxOutputTokens,
      stream: isStreaming,
    });
    const thinking = thinkingTokens > 0;
    if (attempt === 1) {
      console.log(
        `[gemma-sources] ${options.label}: sampling=${gemmaSampling()} ` +
          `thinking=${thinking ? thinkingTokens : 'off'} ` +
          `softTokens=${gemmaMaxSoftTokens() ?? 'default'} images=${prepared.imageCount}`,
      );
    }

    let response: Response;
    try {
      response = await openAiFetch(gemmaChatCompletionsUrl(), {
        label: options.label,
        apiKey: gemmaApiKey(),
        body,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn(
          `[gemma-sources] ${options.label} request errored (${String(error)}); ` +
            `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
        );
        await sleep(retryDelayMs);
        continue;
      }
      throw (await diagnoseGemmaModel(error, lane, model)) ?? error;
    }

    if (isStreaming) {
      if (!response.body) {
        lastError = new Error('gemma returned no response body to stream.');
        if (attempt < maxAttempts) {
          console.warn(
            `[gemma-sources] ${options.label} carried no response body; ` +
              `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw lastError;
      }

      let text = '';
      // With thinking on and no reasoning parser on the server, the thought arrives inline
      // between Gemma's channel markers. Everything goes through the stripper so neither the
      // live draft nor the stored article ever carries it. With thinking off this is the old
      // direct path, untouched.
      const onDelta = options.onDelta ?? (() => {});
      const stripper = thinking
        ? createThinkingStripper(
            (chunk) => {
              text += chunk;
              onDelta(chunk);
            },
            () => {},
            GEMMA_THINK_TAGS,
          )
        : null;
      try {
        const result = await readChatCompletionStream<{
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }>(
          response.body,
          stripper ? () => {} : onDelta,
          (chunk) => {
            if (stripper) stripper.push(chunk);
            else text += chunk;
          },
          {
            label: options.label,
            // A parser-equipped server sends the thought on its own channel, which proves
            // the content that follows is already the answer.
            onReasoning: () => stripper?.separatedReasoning(),
          },
        );
        stripper?.flush();

        if (result.usage) {
          recordChatUsage(model, result.usage, GEMMA_COST_PROVIDER);
        }

        if (result.finishReason === 'length') {
          throw new Error(
            lengthMessage(options.maxOutputTokens, thinkingTokens),
          );
        }
      } catch (streamError) {
        if (text.trim().length > 0) {
          throw streamError;
        }
        lastError = streamError;
        if (attempt < maxAttempts) {
          console.warn(
            `[gemma-sources] ${options.label} stream interrupted (${String(streamError)}); ` +
              `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw streamError;
      }

      const article = (thinking ? scrubGemmaControlTokens(text) : text).trim();
      if (article) {
        return article;
      }

      lastError = new Error('gemma returned an empty article.');
      if (attempt < maxAttempts) {
        console.warn(
          `[gemma-sources] ${options.label} returned empty stream (worker may still be initializing on RunPod); ` +
            `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
        );
        await sleep(retryDelayMs);
        continue;
      }
    } else {
      let payload: {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      try {
        payload = (await response.json()) as typeof payload;
      } catch (jsonError) {
        lastError = jsonError;
        if (attempt < maxAttempts) {
          console.warn(
            `[gemma-sources] ${options.label} failed to parse JSON response (${String(jsonError)}); ` +
              `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw jsonError;
      }

      if (payload.usage) {
        recordChatUsage(model, payload.usage, GEMMA_COST_PROVIDER);
      }

      const choice = payload.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new Error(lengthMessage(options.maxOutputTokens, thinkingTokens));
      }

      const content = choice?.message?.content ?? '';
      const article = (thinking ? stripGemmaThinking(content) : content).trim();
      if (article) {
        options.onDelta?.(article);
        return article;
      }

      lastError = new Error('gemma returned an empty article.');
      if (attempt < maxAttempts) {
        console.warn(
          `[gemma-sources] ${options.label} returned empty content; ` +
            `retrying in ${Math.round(retryDelayMs)}ms (attempt ${attempt + 1}/${maxAttempts})...`,
        );
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  const finalError =
    lastError instanceof Error
      ? lastError
      : new Error('gemma returned an empty article.');
  throw (await diagnoseGemmaModel(finalError, lane, model)) ?? finalError;
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

  // --- Inference settings (2026-09-24). Every one OFF by default: the request must be the
  // one the lane has always sent until an operator opts in.
  {
    const knobs = [
      'GEMMA_MAX_SOFT_TOKENS',
      'GEMMA_ENABLE_THINKING',
      'GEMMA_SAMPLING',
      'GEMMA_THINKING_TOKENS',
      'GEMMA_MAX_MODEL_LEN',
      'GEMMA_TILES_PER_PAGE',
      'GEMMA_MAX_SOURCE_TILES',
    ] as const;
    const saved = Object.fromEntries(knobs.map((k) => [k, process.env[k]]));
    for (const k of knobs) delete process.env[k];

    const textOnly: GemmaMessage[] = [
      { role: 'system', content: 'नियम' },
      { role: 'user', content: 'टिपणी' },
    ];
    const withImage: GemmaMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'टिपणी' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
        ],
      },
    ];
    const plan = (messages: GemmaMessage[], stream = false) =>
      buildGemmaRequestBody({
        model: 'm',
        messages,
        maxOutputTokens: 8192,
        stream,
      });

    const baseline = plan(withImage);
    check(
      'defaults: temperature 0, the caller budget, no thinking, no soft tokens',
      baseline.body.temperature === 0 &&
        baseline.body.max_tokens === 8192 &&
        baseline.thinkingTokens === 0 &&
        !('chat_template_kwargs' in baseline.body) &&
        !('skip_special_tokens' in baseline.body) &&
        !('mm_processor_kwargs' in baseline.body) &&
        !('top_p' in baseline.body),
    );
    check(
      'defaults: the tile rules are unchanged (60 tiles, rasteriser default per page)',
      gemmaMaxSourceTiles() === DEFAULT_MAX_SOURCE_TILES &&
        tilesPerPage() === undefined &&
        gemmaTokensPerImage() === GEMMA_TOKENS_PER_IMAGE,
    );
    check(
      'streaming still asks for usage',
      JSON.stringify(plan(textOnly, true).body.stream_options) ===
        JSON.stringify({ include_usage: true }),
    );

    process.env.GEMMA_MAX_SOFT_TOKENS = '1120';
    const soft = plan(withImage);
    check(
      'soft tokens ride as mm_processor_kwargs when an image is attached',
      JSON.stringify(soft.body.mm_processor_kwargs) ===
        JSON.stringify({ max_soft_tokens: 1120 }),
    );
    check(
      'and are not sent on a text-only call',
      !('mm_processor_kwargs' in plan(textOnly).body),
    );
    check(
      'at 1120 a page is one tile and the tile budget shrinks with the per-image cost',
      tilesPerPage() === 1 &&
        gemmaMaxSourceTiles() ===
          Math.floor((60 * GEMMA_TOKENS_PER_IMAGE) / 1120),
    );
    process.env.GEMMA_TILES_PER_PAGE = '2';
    check('GEMMA_TILES_PER_PAGE still wins', tilesPerPage() === 2);
    delete process.env.GEMMA_TILES_PER_PAGE;
    process.env.GEMMA_MAX_SOFT_TOKENS = '560';
    check('at 560 a page is two tiles', tilesPerPage() === 2);
    process.env.GEMMA_MAX_SOFT_TOKENS = '1000';
    let refused = false;
    try {
      gemmaMaxSoftTokens();
    } catch {
      refused = true;
    }
    check('a soft-token value vLLM would reject is refused up front', refused);
    delete process.env.GEMMA_MAX_SOFT_TOKENS;

    process.env.GEMMA_SAMPLING = 'google';
    const google = plan(textOnly).body;
    check(
      "google sampling is the model card's 1.0 / 0.95 / 64",
      google.temperature === 1 && google.top_p === 0.95 && google.top_k === 64,
    );
    process.env.GEMMA_SAMPLING = 'hot';
    let badSampling = false;
    try {
      plan(textOnly);
    } catch {
      badSampling = true;
    }
    check('an unknown sampling name is refused', badSampling);
    delete process.env.GEMMA_SAMPLING;

    process.env.GEMMA_ENABLE_THINKING = 'true';
    const thought = plan(textOnly);
    check(
      'thinking: template flag on, special tokens kept, budget added on top of the answer',
      thought.thinkingTokens === 8192 &&
        thought.body.max_tokens === 8192 + 8192 &&
        JSON.stringify(thought.body.chat_template_kwargs) ===
          JSON.stringify({ enable_thinking: true }) &&
        thought.body.skip_special_tokens === false,
    );
    const huge: GemmaMessage[] = [
      { role: 'user', content: 'क'.repeat(80_000) },
    ];
    const squeezed = plan(huge);
    check(
      'thinking is cut to what the 32k window leaves',
      squeezed.thinkingTokens > 0 &&
        squeezed.thinkingTokens < 8192 &&
        estimateGemmaPromptTokens(huge) +
          (squeezed.body.max_tokens as number) <=
          gemmaMaxModelLen(),
    );
    const full = plan([{ role: 'user', content: 'क'.repeat(95_000) }]);
    check(
      'and switched off, not truncated, when it cannot fit',
      full.thinkingTokens === 0 &&
        full.body.max_tokens === 8192 &&
        !('chat_template_kwargs' in full.body),
    );
    delete process.env.GEMMA_ENABLE_THINKING;

    check(
      'a parser-less thought block is stripped from a whole reply',
      stripGemmaThinking(
        '<|channel>thought\nthe angle is the GR<channel|># शीर्षक\n\nपरिच्छेद.',
      ) === '# शीर्षक\n\nपरिच्छेद.',
    );
    check(
      'a reply with no markers (a parser-equipped server) is unchanged',
      stripGemmaThinking('# शीर्षक\n\nपरिच्छेद.') === '# शीर्षक\n\nपरिच्छेद.',
    );
    let streamed = '';
    const stripper = createThinkingStripper(
      (chunk) => {
        streamed += chunk;
      },
      () => {},
      GEMMA_THINK_TAGS,
    );
    for (const chunk of ['<|cha', 'nnel>thou', 'ght x<chan', 'nel|>उत्तर', '.'])
      stripper.push(chunk);
    stripper.flush();
    check(
      'a thought split across stream chunks never leaks',
      streamed === 'उत्तर.',
    );
    check(
      'a stray control token is scrubbed',
      scrubGemmaControlTokens('परिच्छेद.<turn|>') === 'परिच्छेद.',
    );

    for (const k of knobs) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

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
