// Price tables for OpenAI usage, used to turn measured token counts (text) and
// fixed render tiers (image) into dollars. Numbers are the official OpenAI prices
// captured in the cost model (docs/../plans/openai-client-call-sites-merry-newt.md,
// fetched 2026-07-10). If OpenAI changes prices, edit only this file.

import {
  VIDEO_TIER_PRICE_PER_SECOND_USD,
  type VideoTier,
} from '@dgipr/schemas';

// USD per 1,000,000 tokens. `input` is billed on the *uncached* portion of the
// prompt; the cached portion (OpenAI returns it in usage.prompt_tokens_details)
// is billed at `cachedInput`. `output` is the completion.
export type TextPrice = Readonly<{
  input: number;
  cachedInput: number;
  output: number;
}>;

export const TEXT_PRICES_PER_1M: Readonly<Record<string, TextPrice>> = {
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Embeddings have no cached/output dimension; only `input` is used.
  'text-embedding-3-large': { input: 0.13, cachedInput: 0.13, output: 0 },
};

// Unknown / future model ids fall back to gpt-4o so cost is never silently $0.
const FALLBACK_TEXT_PRICE = TEXT_PRICES_PER_1M['gpt-4o'] as TextPrice;

// USD for one chat/embedding call given its token usage. OpenAI's prompt_tokens
// already includes the cached tokens, so the uncached portion is (input - cached).
export function priceText(
  model: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number,
): number {
  const price = TEXT_PRICES_PER_1M[model] ?? FALLBACK_TEXT_PRICE;
  const cached = Math.min(Math.max(cachedTokens, 0), inputTokens);
  const uncached = Math.max(inputTokens - cached, 0);
  return (
    (uncached * price.input +
      cached * price.cachedInput +
      Math.max(outputTokens, 0) * price.output) /
    1_000_000
  );
}

// Image cost is a FIXED per-render tier price, not measured: the default poster
// render happens inside n8n (no usage returned) and gpt-image pricing is effectively
// a flat price per (size, quality) tier anyway. `kind` maps to the two render sizes
// in use — `article` = 1536x1024, `twitter` = 1280x1600. Values from the cost model.
export type ImageKind = 'article' | 'twitter';
export type ImageQuality = 'high' | 'medium' | 'low';

const IMAGE_COST_USD: Readonly<
  Record<ImageKind, Readonly<Record<ImageQuality, number>>>
> = {
  article: { high: 0.25, medium: 0.063, low: 0.016 },
  twitter: { high: 0.25, medium: 0.065, low: 0.017 },
};

export function estimateImageCostUsd(
  kind: ImageKind,
  quality: ImageQuality,
): number {
  return IMAGE_COST_USD[kind][quality];
}

// Video cost is per second of rendered clip, per Veo tier. The price table
// lives in @dgipr/schemas (VIDEO_TIER_PRICE_PER_SECOND_USD) because the web
// renders the pre-spend estimate from the same numbers and cannot import this
// package.
export { VIDEO_TIER_PRICE_PER_SECOND_USD, type VideoTier };

export function estimateVideoCostUsd(tier: VideoTier, seconds: number): number {
  return VIDEO_TIER_PRICE_PER_SECOND_USD[tier] * Math.max(seconds, 0);
}

// Sarvam TTS (bulbul) is billed per character of input text. Approximate public
// price captured 2026-07-22; an estimate like the image tiers, edit if Sarvam
// changes pricing. Narration is short (a few hundred chars/scene), so this is a
// small line beside the Veo spend.
export const SARVAM_TTS_PRICE_PER_1K_CHARS_USD = 0.05;

export function estimateTtsCostUsd(characters: number): number {
  return (Math.max(characters, 0) / 1000) * SARVAM_TTS_PRICE_PER_1K_CHARS_USD;
}
