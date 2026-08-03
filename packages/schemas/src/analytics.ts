// Analytics API shapes (apps/api builds them, apps/web parses and renders them).
//
// The payload carries MACHINE KEYS and NUMBERS only — never a Marathi label. Every label on
// the page comes from apps/web/lib/strings.ts, exactly as the generation `step` keys do, so
// the wording of a government-facing screen is changed in one file and never in the API.
//
// One endpoint serves the landing page and all six drill-downs. The drill-down for a feature
// is that feature's own block, so navigating between them re-renders rather than re-fetches
// anything new, and the numbers on the landing page and inside a feature can never disagree.

import { z } from 'zod';

// Windows the page offers. `all` means since the first row exists — the comparison figures
// are absent for it, because there is no previous period to compare against.
export const AnalyticsRangeSchema = z.enum(['7d', '30d', '90d', 'all']);
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

export const ANALYTICS_DEFAULT_RANGE: AnalyticsRange = '30d';

// How many days each range covers. `all` is handled separately (no fixed length).
export const ANALYTICS_RANGE_DAYS: Readonly<Record<AnalyticsRange, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 0,
};

// The six sidebar features analytics reports on. `article` is the लेख / बातमी lane (/dlo →
// a generation), `social` is क्रिएटिव्ह आणि सोशल. The two are told apart by whether the
// generation carries a dlo_intake_id, so no new column was needed to split them.
export const AnalyticsFeatureKeySchema = z.enum([
  'social',
  'article',
  'transcribe',
  'translate',
  'proofread',
  'video',
]);
export type AnalyticsFeatureKey = z.infer<typeof AnalyticsFeatureKeySchema>;

export const ANALYTICS_FEATURE_KEYS = [
  'social',
  'article',
  'transcribe',
  'translate',
  'proofread',
  'video',
] as const satisfies readonly AnalyticsFeatureKey[];

// What a number MEANS, so the web formats it without a lookup table of its own: a count gets
// Devanagari grouping, `inr` gets ₹ and no decimals, `percent` a % sign, `minutes` a rounded
// duration. Formatting rules live in one web helper keyed off this.
export const MetricKindSchema = z.enum([
  'count',
  'chars',
  'inr',
  'percent',
  'minutes',
]);
export type MetricKind = z.infer<typeof MetricKindSchema>;

// `previous` is the same metric over the immediately preceding window of equal length, which
// is what the ↑/↓ delta on the page is computed from. Absent (not zero) when there is nothing
// to compare against — range `all`, or a metric that is a running total rather than a flow.
export const MetricSchema = z.object({
  key: z.string(),
  value: z.number(),
  previous: z.number().optional(),
  kind: MetricKindSchema,
});
export type Metric = z.infer<typeof MetricSchema>;

// A labelled slice of one feature's work: ट्विटर vs फेसबुक posters, English vs Hindi
// translations. Rendered as a small bar list, so it is always parts of `headline`.
export const AnalyticsBreakdownSchema = z.object({
  key: z.string(),
  value: z.number(),
});
export type AnalyticsBreakdown = z.infer<typeof AnalyticsBreakdownSchema>;

// ---------------------------------------------------------------------------
// Services — which paid external APIs a feature actually ran on.
// ---------------------------------------------------------------------------
//
// A CAPABILITY, not a provider and not a model id. `stt` stays `stt` whether the deployment
// is on ElevenLabs Scribe or Sarvam, so flipping STT_PROVIDER changes the `provider` line on
// the row rather than making the row disappear and a new one start from zero. The provider is
// reported alongside because it is read from the live config (see the seams in
// content-engine: sttProviderName, ocrProviderName, narrationProviderName, clipProviderName,
// frameProviderName) — the page follows the .env rather than a hardcoded list.
//
// Deliberately PAID EXTERNAL APIS ONLY. Chromium renders, ffmpeg assembly, PDF text-layer
// reads and embeddings are real work but are either free or local; listing them beside the
// billed rows would pad the card a department head is reading for spend.
export const AnalyticsServiceKeySchema = z.enum([
  'text', // chat/completions — writing, judging, revising
  'embedding', // semantic retrieval used by a current generation workflow
  'image', // poster and storyboard-frame renders
  'ocr', // reading a scanned PDF's pixels
  'stt', // recording → text
  'tts', // narration voiceover
  'clip', // video clip render
  'translate', // Marathi → English/Hindi
]);
export type AnalyticsServiceKey = z.infer<typeof AnalyticsServiceKeySchema>;

// What `units` counts. `calls` is the fallback for a service whose work has no natural unit.
export const ServiceUnitSchema = z.enum([
  'calls',
  'images',
  'pages',
  'minutes',
  'chars',
  'clips',
]);
export type ServiceUnit = z.infer<typeof ServiceUnitSchema>;

export const AnalyticsServiceSchema = z.object({
  // Current user-facing workflow task. `legacy_combined` is the only broad value and is
  // reserved for pre-task-instrumentation history that cannot be split after the fact.
  task: z.string(),
  key: AnalyticsServiceKeySchema,
  // Live config value ('openai', 'elevenlabs', 'kling', 'sarvam', 'gemini'), or '' where the
  // service has no seam to read. Shown as a secondary line, never as the row's identity.
  provider: z.string(),
  // Exact model id when the provider exposes/configures one.
  model: z.string(),
  // How many times the service was invoked in the window.
  calls: z.number(),
  // How much it processed, in `unit`.
  units: z.number(),
  unit: ServiceUnitSchema,
  costInr: z.number().nullable(),
  // True when the ₹ figure comes from ANALYTICS_SERVICE_RATES rather than from a metered
  // per-row charge. The page marks these, because a configured rate can go stale in a way a
  // measured token count cannot.
  costEstimated: z.boolean(),
  // True when this row is counted from usage_events, so it begins at instrumentation deploy
  // day rather than at the department's first use. Metered rows read history from
  // cost_breakdown and are complete.
  eventBacked: z.boolean(),
  // True only for the combined pre-deployment row.
  legacy: z.boolean(),
});
export type AnalyticsService = z.infer<typeof AnalyticsServiceSchema>;

// The per-unit rates behind every `costEstimated` row, sent so the page can print them. A
// configured rate that is not shown is a number nobody can check.
export const AnalyticsRateSchema = z.object({
  key: AnalyticsServiceKeySchema,
  provider: z.string(),
  // Rupees per `per` units (e.g. 1000 chars, 1 page, 1 minute).
  inrPerUnit: z.number(),
  per: z.number(),
  unit: ServiceUnitSchema,
});
export type AnalyticsRate = z.infer<typeof AnalyticsRateSchema>;

export const AnalyticsFeatureSchema = z.object({
  key: AnalyticsFeatureKeySchema,
  // The one number the card shows big: how much this feature produced in the window.
  headline: MetricSchema,
  // Detail for the drill-down, in display order.
  stats: z.array(MetricSchema),
  breakdown: z.array(AnalyticsBreakdownSchema),
  // Which paid external services this feature ran on, in display order. Empty for a feature
  // that spent nothing in the window.
  services: z.array(AnalyticsServiceSchema),
  // AI spend attributable to this feature. Null where none is metered — /translate and
  // /proofread run on Sarvam and short chat calls that are not billed to a row, and
  // reporting ₹0 there would read as "free" rather than as "not measured".
  costInr: z.number().nullable(),
  costPerOutputInr: z.number().nullable(),
  // False when this feature's numbers come only from usage_events (0043) and therefore begin
  // at the day the table was deployed, not at the department's first use. The page says so
  // rather than letting an honest zero look like disuse.
  eventBacked: z.boolean(),
});
export type AnalyticsFeature = z.infer<typeof AnalyticsFeatureSchema>;

// One day of the trend chart. Every feature is present so the stack has no gaps, and days
// with no work are included as zeroes — a chart that omits quiet days overstates consistency.
export const AnalyticsDaySchema = z.object({
  date: z.string(),
  social: z.number(),
  article: z.number(),
  transcribe: z.number(),
  translate: z.number(),
  proofread: z.number(),
  video: z.number(),
});
export type AnalyticsDay = z.infer<typeof AnalyticsDaySchema>;

export const AnalyticsResponseSchema = z.object({
  range: AnalyticsRangeSchema,
  // Half-open [from, to) in ISO 8601, and the equal-length window before it. Sent so the
  // page can state the exact dates it is reporting on rather than implying "now".
  from: z.string(),
  to: z.string(),
  previousFrom: z.string().nullable(),
  previousTo: z.string().nullable(),
  generatedAt: z.string(),
  // The KPI strip, in display order.
  headline: z.array(MetricSchema),
  daily: z.array(AnalyticsDaySchema),
  features: z.array(AnalyticsFeatureSchema),
  // Every rate behind a `costEstimated: true` service row, so the page prints the numbers it
  // used rather than asking the reader to trust them.
  rates: z.array(AnalyticsRateSchema),
  // False when usage_events could not be read at all (an un-applied 0043). The three
  // event-backed features then show as "not tracked yet" instead of as zero.
  eventsAvailable: z.boolean(),
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponseSchema>;

// Costs are metered in USD (generations.cost_usd, video_projects.cost_usd) and presented in
// rupees, because the audience is a state government department. ONE conversion constant,
// stated openly on the page — this is a presentation rate, not a live FX feed, and a page
// that quietly re-rated itself between two meetings would be worse than one that is a few
// percent stale.
export const ANALYTICS_INR_PER_USD = 88;

export function usdToInr(usd: number): number {
  return usd * ANALYTICS_INR_PER_USD;
}

// Reporting timezone. The API container runs in UTC, so bucketing by the raw timestamp puts
// an 01:30 IST run on the previous day — the same trap the article PDF's date line already
// hit. Every day boundary on this page is Indian.
export const ANALYTICS_TIME_ZONE = 'Asia/Kolkata';
