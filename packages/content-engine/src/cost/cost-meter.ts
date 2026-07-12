// Ambient cost meter. All OpenAI *text* traffic funnels through chatComplete
// (and embeddings through embedBatch), so instead of threading a cost object through
// generateArticle/generateCopy/revise-* and the ~15 call sites, we hang an accumulator
// on an AsyncLocalStorage. The runner opens a scope per job (runInCostScope); every
// chat/embedding call inside that scope records its usage into the ambient accumulator,
// and the runner also records the fixed image-render cost. Outside a scope, recording is
// a no-op — the offline scripts (generate:test, finetune) simply don't accumulate.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  estimateImageCostUsd,
  priceText,
  type ImageKind,
  type ImageQuality,
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
};

const storage = new AsyncLocalStorage<CostAccumulator>();

export function createCostAccumulator(): CostAccumulator {
  return {
    chatCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    textCostUsd: 0,
    imageCount: 0,
    imageCostUsd: 0,
  };
}

// Run `fn` with `acc` as the ambient accumulator. The caller keeps a reference to `acc`
// and can read it after `fn` settles — including in a finally, so a failed job still
// reports the tokens it spent before throwing.
export function runInCostScope<T>(
  acc: CostAccumulator,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(acc, fn);
}

export function totalCostUsd(acc: CostAccumulator): number {
  return acc.textCostUsd + acc.imageCostUsd;
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
  const acc = storage.getStore();
  if (!acc || !usage) return;
  const input = usage.prompt_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  acc.chatCalls += 1;
  acc.inputTokens += input;
  acc.cachedInputTokens += cached;
  acc.outputTokens += output;
  acc.textCostUsd += priceText(model, input, cached, output);
}

// Shape of the `usage` object OpenAI returns on an embeddings call.
export type EmbeddingUsage = Readonly<{ prompt_tokens?: number }>;

// Record one embeddings call (input tokens only; negligible but included for exactness).
export function recordEmbeddingUsage(
  model: string,
  usage: EmbeddingUsage | undefined,
): void {
  const acc = storage.getStore();
  if (!acc || !usage) return;
  const input = usage.prompt_tokens ?? 0;
  acc.chatCalls += 1;
  acc.inputTokens += input;
  acc.textCostUsd += priceText(model, input, 0, 0);
}

// Record one image render at the given tier. Image usage is not measurable (the default
// render runs inside n8n), so we attribute the fixed tier price from pricing.ts.
export function recordImageCost(kind: ImageKind, quality: ImageQuality): void {
  const acc = storage.getStore();
  if (!acc) return;
  acc.imageCount += 1;
  acc.imageCostUsd += estimateImageCostUsd(kind, quality);
}
