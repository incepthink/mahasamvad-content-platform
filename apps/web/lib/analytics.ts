// Client + presentation helpers for /analytics.
//
// The API sends machine keys and raw numbers; everything an officer reads is decided here and
// in strings.ts. Numerals are Devanagari with Indian grouping (`mr-IN` resolves to both), and
// every date is stated in Asia/Kolkata — the page reports on Indian days, and the API buckets
// on the same boundary.

import {
  ANALYTICS_TIME_ZONE,
  type AnalyticsFeatureKey,
  type AnalyticsRange,
  type AnalyticsServiceKey,
  type Metric,
  type ServiceUnit,
} from '@dgipr/schemas';
import { analyticsDeltaCount, analyticsDeltaLine, STR } from './strings';

// Feature names come from the SIDEBAR strings, not from copies of them: the analytics page
// is a mirror of the sidebar, and a card named differently from the menu item it reports on
// would be its own small lie. Renaming a feature stays a one-line change.
export const ANALYTICS_FEATURE_LABELS: Readonly<
  Record<AnalyticsFeatureKey, string>
> = {
  social: STR.navNew,
  article: STR.navDlo,
  transcribe: STR.navTranscribe,
  translate: STR.navTranslate,
  proofread: STR.navProofread,
  video: STR.navVideo,
};

// Where each card's "तपशील पाहा" goes, and which page the sidebar highlights.
export const ANALYTICS_FEATURE_HREFS: Readonly<
  Record<AnalyticsFeatureKey, string>
> = {
  social: '/',
  article: '/dlo',
  transcribe: '/transcribe',
  translate: '/translate',
  proofread: '/proofread',
  video: '/video',
};

export const ANALYTICS_RANGE_LABELS: Readonly<Record<AnalyticsRange, string>> =
  {
    '7d': STR.analyticsRange7d,
    '30d': STR.analyticsRange30d,
    '90d': STR.analyticsRange90d,
    all: STR.analyticsRangeAll,
  };

const METRIC_LABELS: Readonly<Record<string, string>> = {
  totalOutputs: STR.analyticsMetricTotalOutputs,
  articles: STR.analyticsMetricArticles,
  posters: STR.analyticsMetricPosters,
  captions: STR.analyticsMetricCaptions,
  transcripts: STR.analyticsMetricTranscripts,
  videos: STR.analyticsMetricVideos,
  translations: STR.analyticsMetricTranslations,
  checks: STR.analyticsMetricChecks,
  activeDays: STR.analyticsMetricActiveDays,
  costPerOutput: STR.analyticsMetricCostPerOutput,
  published: STR.analyticsMetricPublished,
  feedbackRounds: STR.analyticsMetricFeedbackRounds,
  failed: STR.analyticsMetricFailed,
  successRate: STR.analyticsMetricSuccessRate,
  intakesStarted: STR.analyticsMetricIntakesStarted,
  intakesReady: STR.analyticsMetricIntakesReady,
  pdfExports: STR.analyticsMetricPdfExports,
  recordings: STR.analyticsMetricRecordings,
  characters: STR.analyticsMetricCharacters,
  estimatedMinutes: STR.analyticsMetricEstimatedMinutes,
  failedFiles: STR.analyticsMetricFailedFiles,
  adHoc: STR.analyticsMetricAdHoc,
  fromGenerations: STR.analyticsMetricFromGenerations,
  issuesFound: STR.analyticsMetricIssuesFound,
  projectsStarted: STR.analyticsMetricProjectsStarted,
};

const SLICE_LABELS: Readonly<Record<string, string>> = {
  twitter: STR.analyticsSliceTwitter,
  facebook: STR.analyticsSliceFacebook,
  articlePoster: STR.analyticsSliceArticlePoster,
  youtubeThumb: STR.analyticsSliceYoutubeThumb,
  news: STR.analyticsSliceNews,
  scheme: STR.analyticsSliceScheme,
  english: STR.analyticsSliceEnglish,
  hindi: STR.analyticsSliceHindi,
  marathi: STR.analyticsSliceMarathi,
  videoNote: STR.analyticsSliceVideoNote,
  videoScript: STR.analyticsSliceVideoScript,
};

// Service rows name a CAPABILITY, not a provider — "ध्वनिलेखन" stays ध्वनिलेखन across a
// Sarvam→ElevenLabs swap, and the provider is a secondary line under it. That is what makes
// the history continuous when a seam is flipped in .env.
const SERVICE_LABELS: Readonly<Record<AnalyticsServiceKey, string>> = {
  text: STR.analyticsServiceText,
  embedding: STR.analyticsServiceEmbedding,
  image: STR.analyticsServiceImage,
  ocr: STR.analyticsServiceOcr,
  stt: STR.analyticsServiceStt,
  tts: STR.analyticsServiceTts,
  clip: STR.analyticsServiceClip,
  translate: STR.analyticsServiceTranslate,
};

const TASK_LABELS: Readonly<Record<string, string>> = {
  audio_transcription: STR.analyticsTaskAudioTranscription,
  youtube_transcription: STR.analyticsTaskYoutubeTranscription,
  audio_youtube_transcription: STR.analyticsTaskAudioYoutubeTranscription,
  document_ocr: STR.analyticsTaskDocumentOcr,
  designation_extraction: STR.analyticsTaskDesignationExtraction,
  article_generation: STR.analyticsTaskArticleGeneration,
  article_revision: STR.analyticsTaskArticleRevision,
  translation_name_extraction: STR.analyticsTaskTranslationNames,
  english_translation: STR.analyticsTaskEnglishTranslation,
  hindi_translation: STR.analyticsTaskHindiTranslation,
  marathi_translation: STR.analyticsTaskMarathiTranslation,
  proofreading: STR.analyticsTaskProofreading,
  social_post_creation: STR.analyticsTaskSocialPost,
  social_caption_creation: STR.analyticsTaskSocialCaption,
  social_caption_revision: STR.analyticsTaskSocialCaptionRevision,
  youtube_thumbnail_creation: STR.analyticsTaskYoutubeThumbnail,
  poster_regeneration: STR.analyticsTaskPosterRegeneration,
  poster_content_revision: STR.analyticsTaskPosterContentRevision,
  poster_image_revision: STR.analyticsTaskPosterImageRevision,
  article_poster_creation: STR.analyticsTaskArticlePoster,
  video_script_creation: STR.analyticsTaskVideoScript,
  video_storyboard_creation: STR.analyticsTaskVideoStoryboard,
  video_storyboard_revision: STR.analyticsTaskVideoStoryboardRevision,
  video_clip_creation: STR.analyticsTaskVideoClips,
  video_scene_reanimation: STR.analyticsTaskVideoSceneRevision,
  video_narration: STR.analyticsTaskVideoNarration,
  legacy_combined: STR.analyticsTaskLegacyCombined,
};

export const taskLabel = (task: string): string => TASK_LABELS[task] ?? task;

// What the units on a service row are counted in. Marathi, and plural — a row always shows
// a total, never a single item.
const SERVICE_UNIT_LABELS: Readonly<Record<ServiceUnit, string>> = {
  calls: STR.analyticsUnitCalls,
  images: STR.analyticsUnitImages,
  pages: STR.analyticsUnitPages,
  minutes: STR.analyticsUnitMinutes,
  chars: STR.analyticsUnitChars,
  clips: STR.analyticsUnitClips,
};

// Providers are proper nouns and stay in Latin script deliberately: "ElevenLabs" is the name
// on the invoice an officer would have to reconcile this page against, and transliterating
// it would make that harder rather than friendlier.
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  sarvam: 'Sarvam AI',
  gemini: 'Google Gemini',
  kling: 'Kling AI',
  veo: 'Google Veo',
};

export const serviceLabel = (key: AnalyticsServiceKey): string =>
  SERVICE_LABELS[key] ?? key;

export const unitLabel = (unit: ServiceUnit): string =>
  SERVICE_UNIT_LABELS[unit] ?? unit;

export const providerLabel = (name: string): string =>
  PROVIDER_LABELS[name] ?? name;

// "१,२४२ कॉल" — the number the row leads with, in its own unit. Minutes keep one decimal
// because a 40-second clip rounding to zero would make a real render look like nothing
// happened; every other unit is a whole count.
export function formatServiceUnits(units: number, unit: ServiceUnit): string {
  const value =
    unit === 'minutes' && units < 10
      ? units.toLocaleString('mr-IN', { maximumFractionDigits: 1 })
      : formatNumber(units);
  return `${value} ${SERVICE_UNIT_LABELS[unit]}`;
}

// Falls back to the raw key rather than to an empty string: an unlabelled number is
// confusing, but a blank row looks like a rendering bug and hides that a metric was added
// without a label.
export const metricLabel = (key: string): string => METRIC_LABELS[key] ?? key;
export const sliceLabel = (key: string): string => SLICE_LABELS[key] ?? key;

// Metrics whose value is derived rather than counted, and which the page marks as such.
export const isEstimatedMetric = (key: string): boolean =>
  key === 'estimatedMinutes';

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('mr-IN');
}

// A metric formatted for display, unit included. `chars` deliberately keeps its full precision
// rather than becoming "12 हजार": these are counted characters, and rounding a count invites
// the question of what was rounded away.
export function formatMetric(metric: Metric): string {
  switch (metric.kind) {
    case 'inr':
      return `₹${formatNumber(metric.value)}`;
    case 'percent':
      return `${formatNumber(metric.value)}%`;
    case 'minutes':
      // Past two hours a minute count stops being legible; hours with one decimal is how
      // long a run of meetings is actually described.
      return metric.value >= 120
        ? `${(metric.value / 60).toFixed(1).replace(/\./g, '.')} तास`
        : `${formatNumber(metric.value)} मिनिटे`;
    case 'chars':
    case 'count':
    default:
      return formatNumber(metric.value);
  }
}

// Above this, a percentage stops informing and starts looking broken; the change is stated as
// an absolute difference instead.
const LARGE_CHANGE_PERCENT = 500;

export type Delta = Readonly<{
  // Rounded percentage change, or null when a percentage would be meaningless.
  percent: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
  // Set instead of `percent` when the change is too large to express as one.
  absolute?: number;
}>;

// Growth against the previous window of equal length. The `new` case matters: going from 0 to
// 40 is not "+∞%" and must not render as one — it is the first period this feature was used,
// which is a different and more interesting statement.
export function deltaOf(metric: Metric): Delta | null {
  if (metric.previous === undefined) return null;
  if (metric.previous === 0) {
    return metric.value === 0
      ? { percent: null, direction: 'flat' }
      : { percent: null, direction: 'new' };
  }
  const change = ((metric.value - metric.previous) / metric.previous) * 100;
  const rounded = Math.round(change);
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  // A percentage off a tiny base is arithmetically true and useless to read: the first month
  // of real use measured 421 against a previous 1, which is "+42,000%" — a number that looks
  // like a bug and invites the audience to distrust the rest of the page. Past the threshold
  // the same fact is stated as a plain difference, which is always meaningful.
  if (Math.abs(rounded) >= LARGE_CHANGE_PERCENT) {
    return {
      percent: null,
      direction,
      absolute: Math.abs(metric.value - metric.previous),
    };
  }
  return { percent: Math.abs(rounded), direction };
}

// One place that turns a delta into words, so the tiles and the feature cards can never
// describe the same change differently.
export function deltaText(delta: Delta): string {
  if (delta.direction === 'new') return STR.analyticsDeltaNew;
  if (delta.direction === 'flat') return STR.analyticsDeltaFlat;
  const direction = delta.direction === 'up' ? 'up' : 'down';
  if (delta.absolute !== undefined) {
    return analyticsDeltaCount(delta.absolute, direction);
  }
  return delta.percent === null
    ? STR.analyticsDeltaFlat
    : analyticsDeltaLine(delta.percent, direction);
}

const DAY_LABEL = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: ANALYTICS_TIME_ZONE,
});

const FULL_DAY_LABEL = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'long',
  timeZone: ANALYTICS_TIME_ZONE,
});

// `date` is a bare IST day (YYYY-MM-DD); pinning the offset stops a UTC container reading it
// as the previous evening.
export function formatDay(date: string, full = false): string {
  const at = new Date(`${date}T12:00:00+05:30`);
  return (full ? FULL_DAY_LABEL : DAY_LABEL).format(at);
}

// The window the page is reporting on, as one readable phrase. `to` is exclusive (the start of
// tomorrow), so the last day shown is the day before it.
export function formatWindow(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(new Date(toIso).getTime() - 86_400_000);
  return `${FULL_DAY_LABEL.format(from)} – ${FULL_DAY_LABEL.format(to)}`;
}
