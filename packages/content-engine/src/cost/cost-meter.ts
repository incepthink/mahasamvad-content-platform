// Ambient cost meter. All OpenAI *text* traffic funnels through chatComplete
// (and embeddings through embedBatch), so instead of threading a cost object through
// generateArticle/generateCopy/revise-* and the ~15 call sites, we hang an accumulator
// on an AsyncLocalStorage. The runner opens a scope per job (runInCostScope); every
// chat/embedding call inside that scope records its usage into the ambient accumulator,
// and the runner also records the fixed image-render cost. Outside a scope, recording is
// a no-op — the offline scripts (generate:test, finetune) simply don't accumulate.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  estimateGeminiImageCostUsd,
  estimateImageCostUsd,
  estimateOcrCostUsd,
  estimateSttCostUsd,
  estimateTranslateCostUsd,
  estimateTtsCostUsd,
  estimateVideoCostUsd,
  priceText,
  priceGeminiText,
  type ImageKind,
  type ImageQuality,
  type VideoTier,
} from './pricing.js';

// Running totals for one job. Token counts are kept alongside the dollar figures so the
// stored breakdown can be re-priced later and verified against the OpenAI dashboard.
export type CostAccumulator = {
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
  videoSeconds: number;
  videoCostUsd: number;
  ttsCharacters: number;
  ttsCostUsd: number;
  sttSeconds: number;
  sttCostUsd: number;
  // Pages of a scanned PDF read by looking at them. Counted for BOTH OCR providers, but
  // only priced for Sarvam — the OpenAI path's tokens are already in textCostUsd, so adding
  // a page rate on top would double-count it (see estimateOcrCostUsd).
  ocrPages: number;
  ocrCostUsd: number;
  // Source characters sent to Sarvam for translation. Sarvam returns no usage object, so the
  // input length IS the usage, and the price is a configured rate.
  translateChars: number;
  translateCostUsd: number;
  // Exact, task-level usage for /analytics. Totals above remain the persistence/billing
  // contract; these rows explain which CURRENT workflow step produced them. A Map keeps
  // multiple providers/models for one task separate without widening every job table.
  taskUsage: Map<string, CostTaskUsage>;
};

export type CostTaskService =
  'text' | 'embedding' | 'image' | 'ocr' | 'stt' | 'tts' | 'clip' | 'translate';

export type CostTaskUsage = {
  task: string;
  service: CostTaskService;
  provider: string;
  model: string;
  calls: number;
  units: number;
  costUsd: number;
  costEstimated: boolean;
};

type CostContext = Readonly<{
  accumulator: CostAccumulator;
  task?: string;
}>;

const storage = new AsyncLocalStorage<CostContext>();

export function createCostAccumulator(): CostAccumulator {
  return {
    chatCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    textCostUsd: 0,
    imageCount: 0,
    imageCostUsd: 0,
    videoSeconds: 0,
    videoCostUsd: 0,
    ttsCharacters: 0,
    ttsCostUsd: 0,
    sttSeconds: 0,
    sttCostUsd: 0,
    ocrPages: 0,
    ocrCostUsd: 0,
    translateChars: 0,
    translateCostUsd: 0,
    taskUsage: new Map(),
  };
}

// Run `fn` with `acc` as the ambient accumulator. The caller keeps a reference to `acc`
// and can read it after `fn` settles — including in a finally, so a failed job still
// reports the tokens it spent before throwing.
export function runInCostScope<T>(
  acc: CostAccumulator,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ accumulator: acc }, fn);
}

// Name the user-facing workflow step whose external calls are about to run. Nested tasks
// override their parent, so a social-post job can report poster copy, image rendering and
// caption writing separately while sharing the same persisted cost accumulator.
export function runInCostTask<T>(
  task: string,
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore();
  if (!current) return fn();
  return storage.run({ ...current, task }, fn);
}

function bumpTaskUsage(
  service: CostTaskService,
  provider: string,
  model: string,
  calls: number,
  units: number,
  costUsd: number,
  costEstimated: boolean,
): void {
  const context = storage.getStore();
  if (!context?.task) return;
  const key = [context.task, service, provider, model].join('\u0000');
  const current = context.accumulator.taskUsage.get(key);
  if (current) {
    current.calls += calls;
    current.units += units;
    current.costUsd += costUsd;
    current.costEstimated ||= costEstimated;
    return;
  }
  context.accumulator.taskUsage.set(key, {
    task: context.task,
    service,
    provider,
    model,
    calls,
    units,
    costUsd,
    costEstimated,
  });
}

export function totalCostUsd(acc: CostAccumulator): number {
  return (
    acc.textCostUsd +
    acc.imageCostUsd +
    acc.videoCostUsd +
    acc.ttsCostUsd +
    acc.sttCostUsd +
    acc.ocrCostUsd +
    acc.translateCostUsd
  );
}

// Shape of the `usage` object OpenAI returns on a chat completion (fields optional so a
// malformed/omitted usage never throws — cost just under-counts that one call).
export type ChatUsage = Readonly<{
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}>;

// Record one chat completion's usage into the ambient accumulator (no-op outside a scope).
export function recordChatUsage(
  model: string,
  usage: ChatUsage | undefined,
): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const input = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  acc.chatCalls += 1;
  acc.inputTokens += input;
  acc.cachedInputTokens += cached;
  acc.outputTokens += output;
  const costUsd = priceText(model, input, cached, output);
  acc.textCostUsd += costUsd;
  bumpTaskUsage('text', 'openai', model, 1, 1, costUsd, false);
}

export type GeminiChatUsage = Readonly<{
  total_input_tokens?: number | undefined;
  total_cached_tokens?: number | undefined;
  total_output_tokens?: number | undefined;
  total_thought_tokens?: number | undefined;
}>;

export function recordGeminiChatUsage(
  model: string,
  usage: GeminiChatUsage | undefined,
): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const input = usage?.total_input_tokens ?? 0;
  const cached = usage?.total_cached_tokens ?? 0;
  // Google's output price includes thinking tokens, which are reported separately.
  const output =
    (usage?.total_output_tokens ?? 0) + (usage?.total_thought_tokens ?? 0);
  acc.chatCalls += 1;
  acc.inputTokens += input;
  acc.cachedInputTokens += cached;
  acc.outputTokens += output;
  const costUsd = priceGeminiText(input, cached, output);
  acc.textCostUsd += costUsd;
  bumpTaskUsage('text', 'gemini', model, 1, 1, costUsd, false);
}

// Shape of the `usage` object OpenAI returns on an embeddings call.
export type EmbeddingUsage = Readonly<{ prompt_tokens?: number }>;

// Record one embeddings call (input tokens only; negligible but included for exactness).
export function recordEmbeddingUsage(
  model: string,
  usage: EmbeddingUsage | undefined,
): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const input = usage?.prompt_tokens ?? 0;
  acc.chatCalls += 1;
  acc.inputTokens += input;
  const costUsd = priceText(model, input, 0, 0);
  acc.textCostUsd += costUsd;
  bumpTaskUsage('embedding', 'openai', model, 1, 1, costUsd, false);
}

// Record one image render at the given tier. Image usage is not measurable (the default
// render runs inside n8n), so we attribute the fixed tier price from pricing.ts.
export function recordImageCost(kind: ImageKind, quality: ImageQuality): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateImageCostUsd(kind, quality);
  acc.imageCount += 1;
  acc.imageCostUsd += costUsd;
  bumpTaskUsage(
    'image',
    'openai',
    process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
    1,
    1,
    costUsd,
    true,
  );
}

// Record one Gemini (Nano Banana) image render — the video pipeline's frame
// provider when VIDEO_IMAGE_PROVIDER=gemini. Flat per-image price, no tier, so
// it lands in the same imageCount/imageCostUsd line as a gpt-image render and
// the two providers stay comparable on a project's cost breakdown.
export function recordGeminiImageCost(): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateGeminiImageCostUsd();
  acc.imageCount += 1;
  acc.imageCostUsd += costUsd;
  bumpTaskUsage(
    'image',
    'gemini',
    process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview',
    1,
    1,
    costUsd,
    true,
  );
}

// Record one Veo clip render: billed per second of output at the tier price
// (Google returns no usage object; the requested duration IS the usage).
export function recordVideoCost(tier: VideoTier, seconds: number): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateVideoCostUsd(tier, seconds);
  acc.videoSeconds += seconds;
  acc.videoCostUsd += costUsd;
  const provider = (process.env.VIDEO_CLIP_PROVIDER ?? 'kling')
    .trim()
    .toLowerCase();
  bumpTaskUsage('clip', provider, '', 1, seconds, costUsd, true);
}

// Record one Sarvam TTS narration render: billed per character (Sarvam returns
// no usage object; the input length IS the usage).
export function recordTtsCost(characters: number): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateTtsCostUsd(characters);
  acc.ttsCharacters += characters;
  acc.ttsCostUsd += costUsd;
  const provider = (process.env.NARRATION_TTS_PROVIDER ?? 'sarvam')
    .trim()
    .toLowerCase();
  const model =
    provider === 'sarvam'
      ? (process.env.SARVAM_TTS_MODEL ?? 'bulbul:v3')
      : (process.env.ELEVENLABS_MODEL ?? 'eleven_v3');
  bumpTaskUsage('tts', provider, model, 1, characters, costUsd, true);
}

// Record one transcribed recording: billed per second of AUDIO, measured off
// the provider's word timestamps rather than the transcript's length (ElevenLabs
// returns no usage object; the recording's spoken length IS the usage). The
// Sarvam batch path does not call this — see the note in pricing.ts.
export function recordSttCost(seconds: number): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateSttCostUsd(seconds);
  acc.sttSeconds += seconds;
  acc.sttCostUsd += costUsd;
  const provider = (process.env.STT_PROVIDER ?? 'elevenlabs')
    .trim()
    .toLowerCase();
  const model =
    provider === 'elevenlabs'
      ? (process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v1')
      : '';
  bumpTaskUsage('stt', provider, model, 1, seconds, costUsd, true);
}

// Record one paid read of a scanned PDF's pixels. `provider` decides whether a price is
// added at all — the OpenAI path is already billed through recordChatUsage, so it
// contributes pages and nothing else. The PAGES are what the analytics card reports; the
// cost is secondary and, for OpenAI, deliberately zero here.
export function recordOcrCost(provider: string, pages: number): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateOcrCostUsd(provider, pages);
  acc.ocrPages += pages;
  acc.ocrCostUsd += costUsd;
  // OpenAI OCR already contributes one task call per page through recordChatUsage; this
  // companion bucket contributes the page count only. Sarvam has no chat usage object, so
  // its document job is the call as well as the page total.
  bumpTaskUsage(
    'ocr',
    provider,
    '',
    provider === 'openai' ? 0 : 1,
    pages,
    costUsd,
    provider !== 'openai',
  );
}

// Record one Sarvam translation call: billed per character of source text.
export function recordTranslateCost(
  characters: number,
  model = 'sarvam-translate:v1',
): void {
  const context = storage.getStore();
  if (!context) return;
  const acc = context.accumulator;
  const costUsd = estimateTranslateCostUsd(characters);
  acc.translateChars += characters;
  acc.translateCostUsd += costUsd;
  bumpTaskUsage(
    'translate',
    'sarvam',
    model,
    1,
    characters,
    costUsd,
    true,
  );
}
