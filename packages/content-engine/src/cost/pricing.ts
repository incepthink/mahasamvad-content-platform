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
  // gpt-5.6 (OpenAI pricing page, captured 2026-07-24). terra is CHAT_MODEL/VISION_MODEL
  // (authoring + judgement), luna is UTILITY_MODEL (mechanical work); sol is the
  // env-overridable step-up. NOTE: on gpt-5 the completion_tokens these are billed
  // against INCLUDE reasoning tokens, so `output` is the price of thinking too — which is
  // why a medium-reasoning run costs visibly more than the gpt-4o it replaced.
  'gpt-5.6-luna': { input: 1.0, cachedInput: 0.1, output: 6.0 },
  'gpt-5.6-terra': { input: 2.5, cachedInput: 0.25, output: 15.0 },
  'gpt-5.6-sol': { input: 5.0, cachedInput: 0.5, output: 30.0 },
  // Retained for the env-only rollback path (OPENAI_CHAT_MODEL=gpt-4o etc.).
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Embeddings have no cached/output dimension; only `input` is used.
  'text-embedding-3-large': { input: 0.13, cachedInput: 0.13, output: 0 },
};

// Unknown / future model ids fall back to the default authoring model so cost is never
// silently $0 — and so an unpriced id errs high rather than low.
const FALLBACK_TEXT_PRICE = TEXT_PRICES_PER_1M['gpt-5.6-terra'] as TextPrice;

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
// a flat price per (size, quality) tier anyway. `kind` maps to the render sizes in use —
// `article` = 1536x1024, `twitter` = 1280x1504 (the artwork; the delivered poster is 1280x1600
// once the branding strip is joined on — see twitter-chrome.ts), `youtube` = 1280x720. The
// twitter figure covered a 1280x1600 render until 2026-08-13 and is left unchanged: it is a
// flat per-tier price and the two sizes sit in the same tier. Values from the cost
// model; youtube is the smallest canvas of the three and priced a touch under `article`,
// whose 1536x1024 is the nearest landscape tier.
export type ImageKind = 'article' | 'twitter' | 'youtube';
export type ImageQuality = 'high' | 'medium' | 'low';

const IMAGE_COST_USD: Readonly<
  Record<ImageKind, Readonly<Record<ImageQuality, number>>>
> = {
  article: { high: 0.25, medium: 0.063, low: 0.016 },
  twitter: { high: 0.25, medium: 0.065, low: 0.017 },
  youtube: { high: 0.2, medium: 0.05, low: 0.013 },
};

export function estimateImageCostUsd(
  kind: ImageKind,
  quality: ImageQuality,
): number {
  return IMAGE_COST_USD[kind][quality];
}

// Gemini image models (the video pipeline's frame provider) bill a FLAT price
// per generated image, with no quality/size tier — so they do not fit the
// (kind, quality) table above and get their own line rather than a fake tier.
// Approximate public price for gemini-3-pro-image-preview at 1K/2K output,
// captured 2026-07-26; edit here if Google changes it or GEMINI_IMAGE_MODEL is
// repointed at a cheaper model.
export const GEMINI_IMAGE_PRICE_USD = 0.134;

export function estimateGeminiImageCostUsd(): number {
  return GEMINI_IMAGE_PRICE_USD;
}

// Video cost is per second of rendered clip, per Veo tier. The price table
// lives in @dgipr/schemas (VIDEO_TIER_PRICE_PER_SECOND_USD) because the web
// renders the pre-spend estimate from the same numbers and cannot import this
// package.
export { VIDEO_TIER_PRICE_PER_SECOND_USD, type VideoTier };

export function estimateVideoCostUsd(tier: VideoTier, seconds: number): number {
  return VIDEO_TIER_PRICE_PER_SECOND_USD[tier] * Math.max(seconds, 0);
}

// Narration TTS, billed per character of input text. Approximate public price for Sarvam
// bulbul captured 2026-07-22; an estimate like the image tiers, edit if pricing changes.
// Narration is short (a few hundred chars/scene), so this is a small line beside the clip
// spend.
//
// DELIBERATELY PROVIDER-AGNOSTIC, and the name says so: `recordTtsCost` applies it whatever
// NARRATION_TTS_PROVIDER is set to, and the deployed provider is ElevenLabs, whose credit
// pricing has never been reconciled against this figure. Naming it after Sarvam made
// /analytics print "ElevenLabs: ₹4.4 per 1,000 characters" — a Sarvam-derived number under
// another vendor's name, which is worse than an openly configured one. Reconcile it against
// the real invoice and edit here; if the two providers ever diverge enough to matter, split
// it per provider the way estimateOcrCostUsd already is.
export const TTS_PRICE_PER_1K_CHARS_USD = 0.05;

/** @deprecated Use TTS_PRICE_PER_1K_CHARS_USD — the rate is not Sarvam-specific. */
export const SARVAM_TTS_PRICE_PER_1K_CHARS_USD = TTS_PRICE_PER_1K_CHARS_USD;

export function estimateTtsCostUsd(characters: number): number {
  return (Math.max(characters, 0) / 1000) * TTS_PRICE_PER_1K_CHARS_USD;
}

// Speech-to-text is billed per HOUR of audio, not per character or token — the
// one dimension in this file that is measured off the media rather than the
// text. Approximate public price for ElevenLabs Scribe, captured 2026-07-31;
// edit here if the rate changes or ELEVENLABS_STT_MODEL is repointed.
//
// Only the ElevenLabs path records into this line. Sarvam's batch STT has never
// been metered (its jobs run outside any cost scope and it returns no usage),
// and inventing a Sarvam figure here would report a cost nobody measured.
export const ELEVENLABS_STT_PRICE_PER_HOUR_USD = 0.4;

export function estimateSttCostUsd(seconds: number): number {
  return (Math.max(seconds, 0) / 3600) * ELEVENLABS_STT_PRICE_PER_HOUR_USD;
}

// Sarvam's translation endpoints (sarvam-chat for English, sarvam-translate:v1 for Hindi),
// billed per character of SOURCE text. `translate-article.ts` has no provider seam — both
// targets are Sarvam — so this is the rate behind every भाषांतर figure on the analytics
// page, and it is CONFIGURED, not discovered: Sarvam returns no usage object, so nothing in
// the product can reconcile it. Read it off the invoice once and edit here.
export const SARVAM_TRANSLATE_PRICE_PER_1K_CHARS_USD = 0.05;

export function estimateTranslateCostUsd(characters: number): number {
  return (
    (Math.max(characters, 0) / 1000) * SARVAM_TRANSLATE_PRICE_PER_1K_CHARS_USD
  );
}

// Reading a scanned PDF's PIXELS, per page. Two providers, two billing shapes, which is why
// this is a per-provider function rather than one constant:
//
//   openai (the rollback — see ocr-provider.ts) bills TOKENS against OPENAI_API_KEY, and
//     openai-doc.ts already runs through chatComplete, so its cost is ALREADY in the text
//     line. Returning 0 here is correct and not a gap: charging the page rate too would
//     double-count it. The page count is still recorded, because "how many pages did the
//     department have read" is the question the analytics card is asking.
//
//   sarvam (the default) bills per page against its own credits and returns no token usage,
//     so this configured page rate is the figure recorded in the OCR task scope.
export const SARVAM_OCR_PRICE_PER_PAGE_USD = 0.008;

//   gemini (what /chat's attachments are read with — see intake/gemini-doc.ts) bills TOKENS
//     against GEMINI_API_KEY, and unlike the OpenAI lane it does NOT run through
//     recordChatUsage — there is no Gemini text price table in this file to run it through.
//     So its cost is a CONFIGURED per-page estimate, and it is exactly that: a page of
//     Devanagari is ~258 input tokens plus whatever it transcribes to. The calibration signal
//     is real and is logged — gemini-doc prints the returned `usageMetadata` on every call —
//     so read a few of those lines against the invoice once and edit this number.
export const GEMINI_OCR_PRICE_PER_PAGE_USD = 0.002;

export function estimateOcrCostUsd(provider: string, pages: number): number {
  const perPage =
    provider === 'sarvam'
      ? SARVAM_OCR_PRICE_PER_PAGE_USD
      : provider === 'gemini'
        ? GEMINI_OCR_PRICE_PER_PAGE_USD
        : 0;
  return Math.max(pages, 0) * perPage;
}
