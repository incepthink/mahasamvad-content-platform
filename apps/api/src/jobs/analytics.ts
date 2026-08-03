// Department usage analytics: turn the rows the product already writes into the payload
// behind /analytics. Sequencing and arithmetic only — no model calls, no rendering — so this
// sits in jobs/ and the route stays thin (AGENTS.md).
//
// THREE DECISIONS THAT SHAPE EVERYTHING HERE:
//
// 1. There is no auth and no owner column anywhere in this phase, so these are DEPARTMENT-WIDE
//    totals per feature. Nothing here counts, infers or approximates individual people, and
//    nothing should be added that does — `dgipr.dlo.mine` is localStorage ordering, never
//    identity (see lib/dloDraft.ts).
//
// 2. The two generation lanes are told apart by `dlo_intake_id`, not by category. A run
//    created on क्रिएटिव्ह आणि सोशल has none; a run generated from a /dlo intake has one.
//    That matches how an officer thinks about the sidebar and needed no new column. It is
//    also why `news`/`scheme` runs appear under BOTH features: a poster made from a pasted
//    article on the media room is creative work, while the same category reached through
//    /dlo is the article lane.
//
// 3. Every figure is derived, never stored. There is no analytics rollup table to fall out of
//    date, and no backfill was needed — the four source tables have been recording this since
//    the day each feature shipped. Only the three event-backed features (0043) start at
//    deploy day, which the payload flags with `eventBacked` rather than reporting as zero.

import {
  countGenerationTexts,
  listGenerationsForAnalytics,
  listIntakesForAnalytics,
  listRevisionsForAnalytics,
  listTranscriptionsForAnalytics,
  listUsageEvents,
  listVideoProjectsForAnalytics,
  serviceFromAction,
  taskFromAction,
  type AnalyticsCostBreakdown,
  type AnalyticsGenerationRow,
  type AnalyticsVideoRow,
  type SupabaseClient,
  type UsageEventRow,
} from '@dgipr/database';
import {
  clipProviderName,
  frameProviderName,
  narrationProviderName,
  ocrProviderName,
  sttProviderName,
  ELEVENLABS_STT_PRICE_PER_HOUR_USD,
  SARVAM_OCR_PRICE_PER_PAGE_USD,
  SARVAM_TRANSLATE_PRICE_PER_1K_CHARS_USD,
  TTS_PRICE_PER_1K_CHARS_USD,
} from '@dgipr/content-engine';
import {
  ANALYTICS_RANGE_DAYS,
  ANALYTICS_TIME_ZONE,
  AnalyticsServiceKeySchema,
  usdToInr,
  VIDEO_TOTAL_SECONDS,
  type AnalyticsBreakdown,
  type AnalyticsDay,
  type AnalyticsFeature,
  type AnalyticsRange,
  type AnalyticsRate,
  type AnalyticsResponse,
  type AnalyticsService,
  type AnalyticsServiceKey,
  type Metric,
  type ServiceUnit,
} from '@dgipr/schemas';

// Categories, as strings rather than through isSocialCategory(): these rows come back from a
// lean select typed as plain text, and an unrecognised value must be counted somewhere rather
// than crash the page.
const SOCIAL_CATEGORIES = ['twitter', 'facebook'] as const;
const ARTICLE_CATEGORIES = ['news', 'scheme'] as const;

// Measured Marathi speaking rate (see the video narration calibration in AGENTS.md — 16.5
// characters a second for bulbul). Used ONLY to turn a transcript's character count into an
// approximate recorded duration, which is labelled as an estimate on the page. It errs short
// of natural speech, which is the safe direction for a number shown to a department head.
const TRANSCRIPT_CHARS_PER_SECOND = 16.5;

// How many days of trend the chart carries when the range is `all`. An unbounded daily series
// would grow forever and render as hairlines; the page says which window the chart covers.
const ALL_RANGE_TREND_DAYS = 90;

// Task events begin with this deployment. Rows created before it stay visible as one
// explicitly-labelled combined history row; newer rows are explained only by exact task
// events, preventing their column totals from being counted a second time.
const TASK_TRACKING_STARTED_AT = Date.parse('2026-08-02T00:00:00+05:30');

// ---------------------------------------------------------------------------
// Time windows. Every boundary is an Indian midnight.
// ---------------------------------------------------------------------------

// The container runs in UTC, so bucketing on the raw timestamp files an 01:30 IST run under
// the previous day — the trap the article PDF's date line already hit. `en-CA` is used purely
// because it formats as YYYY-MM-DD.
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function istDay(iso: string): string {
  return DAY_FORMATTER.format(new Date(iso));
}

// IST is a fixed +05:30 with no daylight saving, so a day's start is exact arithmetic rather
// than a timezone library.
function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

function addDays(day: string, delta: number): string {
  const date = istDayStart(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return istDay(date.toISOString());
}

export type AnalyticsWindow = Readonly<{
  from: string;
  to: string;
  previousFrom: string | null;
  previousTo: string | null;
  // Inclusive IST day strings covered by the trend chart.
  trendDays: string[];
}>;

// `to` is the start of TOMORROW so today's work is included — a dashboard that silently
// stopped at midnight would make every morning look like a collapse.
export function resolveWindow(
  range: AnalyticsRange,
  now = new Date(),
): AnalyticsWindow {
  const today = istDay(now.toISOString());
  const end = addDays(today, 1);
  const days = ANALYTICS_RANGE_DAYS[range];

  if (range === 'all') {
    // Far enough back to precede the first row of the project; there is no previous period to
    // compare an all-time total against, hence the nulls.
    const start = '2024-01-01';
    const trendStart = addDays(end, -ALL_RANGE_TREND_DAYS);
    return {
      from: istDayStart(start).toISOString(),
      to: istDayStart(end).toISOString(),
      previousFrom: null,
      previousTo: null,
      trendDays: enumerateDays(trendStart, end),
    };
  }

  const start = addDays(end, -days);
  const prevStart = addDays(start, -days);
  return {
    from: istDayStart(start).toISOString(),
    to: istDayStart(end).toISOString(),
    previousFrom: istDayStart(prevStart).toISOString(),
    previousTo: istDayStart(start).toISOString(),
    trendDays: enumerateDays(start, end),
  };
}

// Half-open [start, end). Quiet days are present as zeroes: a chart that omits them overstates
// how consistently the platform is used.
function enumerateDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) {
    days.push(day);
    if (days.length > 400) break;
  }
  return days;
}

// ---------------------------------------------------------------------------
// Per-window collection
// ---------------------------------------------------------------------------

type WindowData = Readonly<{
  generations: AnalyticsGenerationRow[];
  revisions: Array<{ generationId: string; target: string; createdAt: string }>;
  intakes: Array<{ status: string; createdAt: string }>;
  transcriptions: Array<{
    status: string;
    fileCount: number;
    failedCount: number;
    charCount: number;
    createdAt: string;
  }>;
  videos: AnalyticsVideoRow[];
  events: UsageEventRow[];
  eventsAvailable: boolean;
  texts: {
    socialCaptions: number;
    articlesWritten: number;
    translatedEnglish: number;
    translatedHindi: number;
  };
}>;

async function collect(
  client: SupabaseClient,
  from: string,
  to: string,
): Promise<WindowData> {
  // usage_events is the one table that may legitimately not exist yet (an un-applied 0043),
  // so its failure degrades to "not tracked" while everything else still reports. Every other
  // read is allowed to throw: a broken generations query must surface as an error, not as a
  // quiet zero that reads like the department stopped working.
  // usage_events rides in the SAME Promise.all rather than being awaited after it: it is
  // independent of every other read, and awaiting it separately added a whole round trip to
  // each window for no reason. Its degrade-to-empty branch moves into the promise.
  const [
    generations,
    revisions,
    intakes,
    transcriptions,
    videos,
    texts,
    eventsResult,
  ] = await Promise.all([
    listGenerationsForAnalytics(client, from, to),
    listRevisionsForAnalytics(client, from, to),
    listIntakesForAnalytics(client, from, to),
    listTranscriptionsForAnalytics(client, from, to),
    listVideoProjectsForAnalytics(client, from, to),
    countGenerationTexts(
      client,
      from,
      to,
      SOCIAL_CATEGORIES,
      ARTICLE_CATEGORIES,
    ),
    listUsageEvents(client, from, to).then(
      (rows): { events: UsageEventRow[]; available: boolean } => ({
        events: rows,
        available: true,
      }),
      (error: unknown) => {
        console.warn(
          `[analytics] usage_events unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { events: [] as UsageEventRow[], available: false };
      },
    ),
  ]);

  const events = eventsResult.events;
  const eventsAvailable = eventsResult.available;

  return {
    generations,
    revisions,
    intakes,
    transcriptions,
    videos,
    events,
    eventsAvailable,
    texts,
  };
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

// The media-room lane: everything not generated from a /dlo intake.
const isCreative = (row: AnalyticsGenerationRow) => row.dloIntakeId === null;
const isFromIntake = (row: AnalyticsGenerationRow) => row.dloIntakeId !== null;

const countEvents = (
  events: readonly UsageEventRow[],
  feature: string,
  action?: string,
) =>
  events.filter(
    (event) =>
      event.feature === feature && (!action || event.action === action),
  ).length;

const sumEvents = (
  events: readonly UsageEventRow[],
  feature: string,
  field: 'charCount' | 'count',
  action?: string,
) =>
  events
    .filter(
      (event) =>
        event.feature === feature && (!action || event.action === action),
    )
    .reduce((total, event) => total + event[field], 0);

type Counts = Readonly<{
  posters: number;
  captions: number;
  articles: number;
  transcripts: number;
  videos: number;
  translations: number;
  proofreads: number;
  total: number;
}>;

// What the department PRODUCED in a window. Deliberately counts artifacts rather than runs:
// one run can deliver a poster and a caption, and both are things a communications team
// needed. Nothing is double-counted — a poster, its caption and its translation are three
// distinct deliverables, and each is counted exactly once.
function countOutputs(data: WindowData): Counts {
  const posters = data.generations.filter(
    (row) => isCreative(row) && row.posterPath !== null,
  ).length;
  const captions = data.texts.socialCaptions;
  const articles = data.generations.filter(
    (row) => isFromIntake(row) && row.status === 'completed',
  ).length;
  const transcripts = data.transcriptions.filter(
    (row) => row.status === 'ready',
  ).length;
  const videos = data.videos.filter((row) => row.status === 'completed').length;
  // Generation translations come from the columns; ad-hoc /translate work has no row and is
  // counted from usage_events.
  const translations =
    data.texts.translatedEnglish +
    data.texts.translatedHindi +
    countEvents(data.events, 'translate', 'translate_text');
  const proofreads = countEvents(data.events, 'proofread', 'check');
  return {
    posters,
    captions,
    articles,
    transcripts,
    videos,
    translations,
    proofreads,
    total:
      posters +
      captions +
      articles +
      transcripts +
      videos +
      translations +
      proofreads,
  };
}

// Which feature a given day's work belongs to, for the stacked trend. This counts COMPLETED
// runs rather than artifacts: the chart answers "was the platform used that day", and a
// per-artifact stack would let one busy run out-tower a day when five officers each made one.
function buildDaily(days: readonly string[], data: WindowData): AnalyticsDay[] {
  const empty = () => ({
    social: 0,
    article: 0,
    transcribe: 0,
    translate: 0,
    proofread: 0,
    video: 0,
  });
  const byDay = new Map<string, ReturnType<typeof empty>>();
  for (const day of days) byDay.set(day, empty());

  const bump = (iso: string, key: keyof ReturnType<typeof empty>) => {
    const bucket = byDay.get(istDay(iso));
    if (bucket) bucket[key] += 1;
  };

  for (const row of data.generations) {
    if (row.status !== 'completed') continue;
    bump(row.createdAt, isFromIntake(row) ? 'article' : 'social');
  }
  for (const row of data.transcriptions) {
    if (row.status === 'ready') bump(row.createdAt, 'transcribe');
  }
  for (const row of data.videos) {
    if (row.status === 'completed') bump(row.createdAt, 'video');
  }
  for (const event of data.events) {
    if (event.feature === 'translate' && event.action === 'translate_text') {
      bump(event.createdAt, 'translate');
    }
    if (event.feature === 'proofread' && event.action === 'check') {
      bump(event.createdAt, 'proofread');
    }
  }

  return days.map((date) => ({ date, ...byDay.get(date)! }));
}

function metric(
  key: string,
  value: number,
  kind: Metric['kind'],
  previous?: number,
): Metric {
  return previous === undefined
    ? { key, value, kind }
    : { key, value, kind, previous };
}

// Drops empty slices so a card never renders a row of zeroes, but keeps order.
function breakdown(
  entries: ReadonlyArray<readonly [string, number]>,
): AnalyticsBreakdown[] {
  return entries
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, value }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Services — which paid external API each feature ran on.
// ---------------------------------------------------------------------------
//
// TWO SOURCES, AND WHICH ONE APPLIES IS A PROPERTY OF THE TABLE, NOT A PREFERENCE:
//
//   COLUMN-BACKED. `generations.cost_breakdown` records chat calls + image renders and
//     `video_projects.cost_breakdown` adds clip seconds + TTS characters. Those rows have
//     been written since each feature shipped, so reading them gives FULL history — the
//     text and image lines were right the day this card was built, with no backfill.
//
//   EVENT-BACKED. Everything else — OCR pages, STT minutes, Sarvam translation, and the
//     text spend of the two routes that persist nothing (/proofread, ad-hoc /translate) —
//     has no column anywhere and is counted from usage_events (0043). Those rows begin at
//     instrumentation deploy day, which is why AnalyticsService carries `eventBacked`: the
//     page says so rather than letting a young number look like disuse.
//
// A capability is NEVER read from both. jobs/service-usage.ts writes only the complement of
// what each table records, and the two halves are merged below without overlapping.

// Rupees are the presentation unit everywhere on this page; the services table is the one
// place a fraction of a cent matters, so the conversion happens once here and is rounded to
// paise rather than to rupees.
const inr = (usd: number) => Math.round(usdToInr(usd) * 100) / 100;

type ServiceAccumulator = {
  task: string;
  key: AnalyticsServiceKey;
  provider: string;
  model: string;
  calls: number;
  units: number;
  costUsd: number;
  eventBacked: boolean;
  costEstimated: boolean;
  legacy: boolean;
};

type ServiceMap = Map<string, ServiceAccumulator>;

function bumpService(
  map: ServiceMap,
  task: string,
  key: AnalyticsServiceKey,
  entry: Readonly<{
    provider: string;
    model: string;
    calls: number;
    units: number;
    costUsd: number;
    eventBacked: boolean;
    costEstimated: boolean;
    legacy: boolean;
  }>,
): void {
  // OpenAI OCR produces a token-metered chat bucket plus a page-count bucket. They are one
  // user operation, so model is not part of that one map key and the two halves become one
  // readable row (actual model calls + pages + token cost).
  const mapModel = task === 'document_ocr' && key === 'ocr' ? '' : entry.model;
  const mapKey = [task, key, entry.provider, mapModel].join('\u0000');
  const current = map.get(mapKey);
  if (!current) {
    map.set(mapKey, { task, key, ...entry });
    return;
  }
  current.calls += entry.calls;
  current.units += entry.units;
  current.costUsd += entry.costUsd;
  // A window can span a provider swap. The row keeps the FIRST provider it saw rather than
  // inventing a combined label, and `eventBacked`/`costEstimated` are sticky-true: if any
  // part of a figure is young or estimated, the whole figure is, and the page must say so.
  current.eventBacked ||= entry.eventBacked;
  current.costEstimated ||= entry.costEstimated;
  current.legacy ||= entry.legacy;
  if (current.provider === '' && entry.provider !== '') {
    current.provider = entry.provider;
  }
  if (current.model === '' && entry.model !== '') {
    current.model = entry.model;
  }
}

// The column half: fold a run's stored breakdown into the map. `includeVideo` is what tells
// a video project's clip and TTS lines apart from a generation's, which has neither.
function foldCostBreakdown(
  map: ServiceMap,
  rows: ReadonlyArray<{ costBreakdown: AnalyticsCostBreakdown | null }>,
  includeVideo: boolean,
  includeImage: boolean,
  imageProvider: string,
  clipProvider: string,
  ttsProvider: string,
): void {
  for (const row of rows) {
    const detail = row.costBreakdown;
    if (!detail) continue;
    const base = {
      eventBacked: false,
      costEstimated: false,
      legacy: true,
      model: '',
    };
    if ((detail.chatCalls ?? 0) > 0) {
      bumpService(map, 'legacy_combined', 'text', {
        ...base,
        provider: 'openai',
        calls: detail.chatCalls ?? 0,
        units: detail.chatCalls ?? 0,
        costUsd: detail.textCostUsd ?? 0,
      });
    }
    if (includeImage && (detail.imageCount ?? 0) > 0) {
      bumpService(map, 'legacy_combined', 'image', {
        ...base,
        provider: imageProvider,
        calls: detail.imageCount ?? 0,
        units: detail.imageCount ?? 0,
        // A render is billed at a fixed per-tier price rather than measured, so this is an
        // estimate in the same sense the rate table is — and it has always been one.
        costEstimated: true,
        eventBacked: false,
        costUsd: detail.imageCostUsd ?? 0,
      });
    }
    if (!includeVideo) continue;
    if ((detail.videoSeconds ?? 0) > 0) {
      bumpService(map, 'legacy_combined', 'clip', {
        ...base,
        provider: clipProvider,
        calls: 1,
        units: detail.videoSeconds ?? 0,
        costEstimated: true,
        costUsd: detail.videoCostUsd ?? 0,
      });
    }
    if ((detail.ttsCharacters ?? 0) > 0) {
      bumpService(map, 'legacy_combined', 'tts', {
        ...base,
        provider: ttsProvider,
        calls: 1,
        units: detail.ttsCharacters ?? 0,
        costEstimated: true,
        costUsd: detail.ttsCostUsd ?? 0,
      });
    }
  }
}

// The event half. Every service event carries the provider that served it and the USD the
// call site metered or estimated — recomputing either here would re-price old runs against
// today's config, which is exactly what a historical report must not do.
function foldServiceEvents(
  map: ServiceMap,
  events: readonly UsageEventRow[],
  feature: string,
): void {
  for (const event of events) {
    if (event.feature !== feature) continue;
    const service = serviceFromAction(event.action);
    if (!service) continue;
    const parsed = AnalyticsServiceKeySchema.safeParse(service);
    if (!parsed.success) continue;
    const provider =
      typeof event.detail.provider === 'string' ? event.detail.provider : '';
    const costUsd =
      typeof event.detail.costUsd === 'number' ? event.detail.costUsd : 0;
    bumpService(map, 'legacy_combined', parsed.data, {
      provider,
      model: '',
      calls: event.count,
      units: event.charCount,
      costUsd,
      eventBacked: true,
      // Only `text` is measured from a returned token count; every other capability is
      // priced from a configured per-unit rate.
      costEstimated: parsed.data !== 'text',
      legacy: true,
    });
  }
}

// Exact post-deployment task rows. The action is the user-facing operation; the service,
// provider and model are dimensions captured at the actual call site.
function foldTaskEvents(
  map: ServiceMap,
  events: readonly UsageEventRow[],
  feature: string,
): void {
  for (const event of events) {
    if (event.feature !== feature) continue;
    const task = taskFromAction(event.action);
    if (!task) continue;
    const parsed = AnalyticsServiceKeySchema.safeParse(event.detail.service);
    if (!parsed.success) continue;
    // The chat call used to read an OpenAI OCR page is part of OCR, not generic text
    // generation. Re-keying it here joins it to the companion page-count event above.
    const service =
      task === 'document_ocr' && parsed.data === 'text'
        ? ('ocr' as const)
        : parsed.data;
    bumpService(map, task, service, {
      provider:
        typeof event.detail.provider === 'string' ? event.detail.provider : '',
      model: typeof event.detail.model === 'string' ? event.detail.model : '',
      calls: event.count,
      units:
        task === 'document_ocr' && parsed.data === 'text' ? 0 : event.charCount,
      costUsd:
        typeof event.detail.costUsd === 'number' ? event.detail.costUsd : 0,
      eventBacked: true,
      costEstimated: event.detail.costEstimated === true,
      legacy: false,
    });
  }
}

// What each capability's `units` means, and how the raw figure is presented. Audio is stored
// in SECONDS because that is what the provider measures, and shown in MINUTES because that
// is what a department head reads.
const SERVICE_UNITS: Readonly<Record<AnalyticsServiceKey, ServiceUnit>> = {
  text: 'calls',
  embedding: 'calls',
  image: 'images',
  ocr: 'pages',
  stt: 'minutes',
  tts: 'chars',
  clip: 'minutes',
  translate: 'chars',
};

// Fixed display order, so a feature's card does not reshuffle between two ranges just
// because one service happened to be busier. Roughly most-used first.
const SERVICE_ORDER: readonly AnalyticsServiceKey[] = [
  'stt',
  'ocr',
  'text',
  'embedding',
  'translate',
  'image',
  'tts',
  'clip',
];

const TASK_ORDER = [
  'audio_transcription',
  'youtube_transcription',
  'audio_youtube_transcription',
  'document_ocr',
  'designation_extraction',
  'article_generation',
  'article_revision',
  'translation_name_extraction',
  'english_translation',
  'hindi_translation',
  'proofreading',
  'social_post_creation',
  'social_caption_creation',
  'social_caption_revision',
  'youtube_thumbnail_creation',
  'poster_regeneration',
  'poster_content_revision',
  'poster_image_revision',
  'article_poster_creation',
  'video_script_creation',
  'video_storyboard_creation',
  'video_storyboard_revision',
  'video_clip_creation',
  'video_scene_reanimation',
  'video_narration',
  'legacy_combined',
] as const;

function taskPosition(task: string): number {
  const index = TASK_ORDER.indexOf(task as (typeof TASK_ORDER)[number]);
  return index < 0 ? TASK_ORDER.length : index;
}

function toServices(map: ServiceMap): AnalyticsService[] {
  const entries = [...map.values()].sort((a, b) => {
    const byTask = taskPosition(a.task) - taskPosition(b.task);
    if (byTask !== 0) return byTask;
    return SERVICE_ORDER.indexOf(a.key) - SERVICE_ORDER.indexOf(b.key);
  });
  const out: AnalyticsService[] = [];
  for (const entry of entries) {
    if (entry.calls <= 0 && entry.units <= 0) continue;
    const key = entry.key;
    const unit = SERVICE_UNITS[key];
    // Seconds → minutes at the presentation boundary only; the stored figure stays exact so
    // a short clip is never rounded out of existence in the sum.
    const units =
      unit === 'minutes'
        ? Math.round((entry.units / 60) * 10) / 10
        : Math.round(entry.units);
    out.push({
      task: entry.task,
      key,
      provider: entry.provider,
      model: entry.model,
      calls: entry.calls,
      units,
      unit,
      costInr: inr(entry.costUsd),
      costEstimated: entry.costEstimated,
      eventBacked: entry.eventBacked,
      legacy: entry.legacy,
    });
  }
  return out;
}

// The rates behind every estimated figure, converted once and printed on the page. A
// configured rate nobody can see is a number nobody can check.
function buildRates(): AnalyticsRate[] {
  return [
    {
      key: 'stt',
      provider: sttProviderName(),
      inrPerUnit:
        Math.round(usdToInr(ELEVENLABS_STT_PRICE_PER_HOUR_USD) * 100) / 100,
      per: 60,
      unit: 'minutes',
    },
    {
      key: 'tts',
      provider: narrationProviderName(),
      inrPerUnit: Math.round(usdToInr(TTS_PRICE_PER_1K_CHARS_USD) * 100) / 100,
      per: 1000,
      unit: 'chars',
    },
    {
      key: 'translate',
      provider: 'sarvam',
      inrPerUnit:
        Math.round(usdToInr(SARVAM_TRANSLATE_PRICE_PER_1K_CHARS_USD) * 100) /
        100,
      per: 1000,
      unit: 'chars',
    },
    // Only meaningful on a Sarvam deployment; the OpenAI OCR path bills tokens, which are
    // already in the text line, so its page rate is genuinely zero rather than unknown.
    ...(ocrProviderName() === 'sarvam'
      ? [
          {
            key: 'ocr' as const,
            provider: 'sarvam',
            inrPerUnit:
              Math.round(usdToInr(SARVAM_OCR_PRICE_PER_PAGE_USD) * 100) / 100,
            per: 1,
            unit: 'pages' as const,
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function buildFeatures(
  current: WindowData,
  previous: WindowData | null,
): AnalyticsFeature[] {
  const now = countOutputs(current);
  const before = previous ? countOutputs(previous) : null;

  // Provider names come from the LIVE config, not from a hardcoded list, so flipping
  // STT_PROVIDER or VIDEO_CLIP_PROVIDER in .env changes what this page says with no code
  // edit. They label column-backed rows only; an event carries the provider that actually
  // served it, which is what keeps a window spanning a swap honest.
  const posterImageProvider = 'openai';
  const frameImageProvider = frameProviderName();
  const clips = clipProviderName();
  const tts = narrationProviderName();

  // One service map per feature, filled from whichever half applies to that feature's table.
  const servicesFor = (
    feature: string,
    rows: ReadonlyArray<{
      costBreakdown: AnalyticsCostBreakdown | null;
      createdAt: string;
    }>,
    includeVideo: boolean,
    includeImage: boolean,
    imageProvider: string,
  ): AnalyticsService[] => {
    const map: ServiceMap = new Map();
    const hasTaskEvents = current.events.some(
      (event) => event.feature === feature && taskFromAction(event.action),
    );
    foldCostBreakdown(
      map,
      rows.filter(
        (row) =>
          Date.parse(row.createdAt) < TASK_TRACKING_STARTED_AT ||
          !current.eventsAvailable ||
          !hasTaskEvents,
      ),
      includeVideo,
      includeImage,
      imageProvider,
      clips,
      tts,
    );
    foldServiceEvents(map, current.events, feature);
    foldTaskEvents(map, current.events, feature);
    return toServices(map);
  };

  // A feature with no cost column reports the sum of its own service rows instead of null.
  // Null is still the answer when it ran nothing measurable — "not measured" and "₹0" mean
  // different things, and only the first is honest about a service we cannot price.
  const serviceCostInr = (services: readonly AnalyticsService[]) => {
    if (services.length === 0) return null;
    const total = services.reduce(
      (sum, service) => sum + (service.costInr ?? 0),
      0,
    );
    return round2(total);
  };

  // --- क्रिएटिव्ह आणि सोशल -------------------------------------------------
  const creative = current.generations.filter(isCreative);
  const creativeCost = creative.reduce((total, row) => total + row.costUsd, 0);
  const posterRevisions = current.revisions.filter(
    (revision) =>
      revision.target === 'poster_copy' ||
      revision.target === 'poster_scene' ||
      revision.target === 'poster_image' ||
      revision.target === 'manual_copy',
  ).length;
  const social: AnalyticsFeature = {
    key: 'social',
    headline: metric('posters', now.posters, 'count', before?.posters),
    stats: [
      metric('captions', now.captions, 'count', before?.captions),
      metric(
        'published',
        creative.filter((row) => row.publishedAt !== null).length,
        'count',
      ),
      metric('feedbackRounds', posterRevisions, 'count'),
    ],
    breakdown: breakdown([
      ['twitter', countPosters(creative, 'twitter')],
      ['facebook', countPosters(creative, 'facebook')],
      [
        'articlePoster',
        countPosters(creative, 'news') + countPosters(creative, 'scheme'),
      ],
      ['youtubeThumb', countPosters(creative, 'youtube')],
    ]),
    services: servicesFor('social', creative, false, true, posterImageProvider),
    costInr: round2(usdToInr(creativeCost)),
    costPerOutputInr:
      now.posters + now.captions > 0
        ? round2(usdToInr(creativeCost) / (now.posters + now.captions))
        : null,
    eventBacked: false,
  };

  // --- लेख / बातमी ---------------------------------------------------------
  const fromIntake = current.generations.filter(isFromIntake);
  const articleServices = servicesFor(
    'article',
    fromIntake,
    false,
    // /dlo is article-only in the current UI. A poster later attached elsewhere must not
    // make this workflow claim it generated an image.
    false,
    posterImageProvider,
  );
  const articleCost = serviceCostInr(articleServices);
  const article: AnalyticsFeature = {
    key: 'article',
    headline: metric('articles', now.articles, 'count', before?.articles),
    stats: [
      metric(
        'intakesStarted',
        current.intakes.length,
        'count',
        previous?.intakes.length,
      ),
      metric(
        'intakesReady',
        current.intakes.filter((row) => row.status === 'ready').length,
        'count',
      ),
      metric(
        'translations',
        current.texts.translatedEnglish + current.texts.translatedHindi,
        'count',
      ),
      metric(
        'pdfExports',
        countEvents(current.events, 'article', 'article_pdf'),
        'count',
      ),
      metric(
        'feedbackRounds',
        current.revisions.filter((revision) => revision.target === 'article')
          .length,
        'count',
      ),
    ],
    breakdown: breakdown([
      ['news', fromIntake.filter((row) => row.category === 'news').length],
      ['scheme', fromIntake.filter((row) => row.category === 'scheme').length],
    ]),
    // OCR pages and STT minutes reach this card as events (dlo_intakes has no cost column);
    // the article's own chat calls come from the generation rows' breakdown.
    services: articleServices,
    costInr: articleCost,
    costPerOutputInr:
      articleCost !== null && now.articles > 0
        ? round2(articleCost / now.articles)
        : null,
    eventBacked: false,
  };

  // --- ध्वनिलेखन -----------------------------------------------------------
  const chars = current.transcriptions.reduce(
    (total, row) => total + row.charCount,
    0,
  );
  const transcribeServices = servicesFor(
    'transcribe',
    [],
    false,
    false,
    posterImageProvider,
  );
  const transcribeCost = serviceCostInr(transcribeServices);
  const transcribe: AnalyticsFeature = {
    key: 'transcribe',
    headline: metric(
      'transcripts',
      now.transcripts,
      'count',
      before?.transcripts,
    ),
    stats: [
      metric(
        'recordings',
        current.transcriptions.reduce((total, row) => total + row.fileCount, 0),
        'count',
      ),
      metric('characters', chars, 'chars'),
      // Approximate, and labelled so on the page. Sarvam is not asked for a duration and no
      // audio length is stored, so this is derived from the measured speaking rate.
      metric(
        'estimatedMinutes',
        Math.round(chars / TRANSCRIPT_CHARS_PER_SECOND / 60),
        'minutes',
      ),
      metric(
        'failedFiles',
        current.transcriptions.reduce(
          (total, row) => total + row.failedCount,
          0,
        ),
        'count',
      ),
    ],
    breakdown: [],
    // Entirely event-backed: `transcriptions` has no cost column, so the service rows below
    // are the only record of what this page's STT cost.
    services: transcribeServices,
    costInr: transcribeCost,
    costPerOutputInr:
      transcribeCost !== null && now.transcripts > 0
        ? round2(transcribeCost / now.transcripts)
        : null,
    eventBacked: false,
  };

  // --- भाषांतर -------------------------------------------------------------
  const adHocTranslations = countEvents(
    current.events,
    'translate',
    'translate_text',
  );
  const translateServices = servicesFor(
    'translate',
    [],
    false,
    false,
    posterImageProvider,
  );
  const translateCost = serviceCostInr(translateServices);
  const translate: AnalyticsFeature = {
    key: 'translate',
    headline: metric(
      'translations',
      now.translations,
      'count',
      before?.translations,
    ),
    stats: [
      metric(
        'characters',
        sumEvents(current.events, 'translate', 'charCount', 'translate_text'),
        'chars',
      ),
      metric('adHoc', adHocTranslations, 'count'),
      metric(
        'fromGenerations',
        current.texts.translatedEnglish + current.texts.translatedHindi,
        'count',
      ),
    ],
    breakdown: breakdown([
      [
        'english',
        current.texts.translatedEnglish +
          countDetail(current.events, 'translate', 'language', 'en'),
      ],
      [
        'hindi',
        current.texts.translatedHindi +
          countDetail(current.events, 'translate', 'language', 'hi'),
      ],
    ]),
    services: translateServices,
    costInr: translateCost,
    costPerOutputInr:
      translateCost !== null && now.translations > 0
        ? round2(translateCost / now.translations)
        : null,
    // The ad-hoc half has no row of its own and is counted from usage_events.
    eventBacked: true,
  };

  // --- मुद्रितशोधन ---------------------------------------------------------
  const proofreadServices = servicesFor(
    'proofread',
    [],
    false,
    false,
    posterImageProvider,
  );
  const proofreadCost = serviceCostInr(proofreadServices);
  const proofread: AnalyticsFeature = {
    key: 'proofread',
    headline: metric('checks', now.proofreads, 'count', before?.proofreads),
    stats: [
      metric(
        'characters',
        sumEvents(current.events, 'proofread', 'charCount', 'check'),
        'chars',
      ),
      metric(
        'issuesFound',
        sumEvents(current.events, 'proofread', 'count', 'check'),
        'count',
      ),
    ],
    breakdown: breakdown([
      ['marathi', countDetail(current.events, 'proofread', 'language', 'mr')],
      ['english', countDetail(current.events, 'proofread', 'language', 'en')],
    ]),
    services: proofreadServices,
    costInr: proofreadCost,
    costPerOutputInr:
      proofreadCost !== null && now.proofreads > 0
        ? round2(proofreadCost / now.proofreads)
        : null,
    eventBacked: true,
  };

  // --- व्हिडिओ -------------------------------------------------------------
  const videoCost = current.videos.reduce(
    (total, row) => total + row.costUsd,
    0,
  );
  // Exact rendered seconds would mean pulling every project's `scenes` jsonb (which carries
  // all narration), so the planned total is used instead — the two agree within a second.
  const seconds = current.videos
    .filter((row) => row.status === 'completed')
    .reduce(
      (total, row) =>
        total +
        (VIDEO_TOTAL_SECONDS[row.durationBucket as 'short' | 'long'] ?? 0),
      0,
    );
  const video: AnalyticsFeature = {
    key: 'video',
    headline: metric('videos', now.videos, 'count', before?.videos),
    stats: [
      metric('projectsStarted', current.videos.length, 'count'),
      metric(
        'estimatedMinutes',
        Math.round((seconds / 60) * 10) / 10,
        'minutes',
      ),
    ],
    breakdown: breakdown([
      [
        'short',
        current.videos.filter((row) => row.durationBucket === 'short').length,
      ],
      [
        'long',
        current.videos.filter((row) => row.durationBucket === 'long').length,
      ],
    ]),
    // The only feature whose table records clip seconds and TTS characters of its own, so
    // `includeVideo` is true here and nowhere else. Frames use the video lane's own image
    // provider, which is a different .env knob from the poster path's.
    services: servicesFor(
      'video',
      current.videos,
      true,
      true,
      frameImageProvider,
    ),
    costInr: round2(usdToInr(videoCost)),
    costPerOutputInr:
      now.videos > 0 ? round2(usdToInr(videoCost) / now.videos) : null,
    eventBacked: false,
  };

  return [social, article, transcribe, translate, proofread, video];
}

function countPosters(
  rows: readonly AnalyticsGenerationRow[],
  category: string,
): number {
  return rows.filter(
    (row) => row.category === category && row.posterPath !== null,
  ).length;
}

function countDetail(
  events: readonly UsageEventRow[],
  feature: string,
  field: string,
  value: string,
): number {
  return events.filter(
    (event) => event.feature === feature && event.detail[field] === value,
  ).length;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildAnalytics(
  client: SupabaseClient,
  range: AnalyticsRange,
): Promise<AnalyticsResponse> {
  const window = resolveWindow(range);
  // The two windows are independent, so they run together: awaiting the comparison window
  // after the current one doubled the wall clock of every request on this page for nothing.
  const [current, previous] = await Promise.all([
    collect(client, window.from, window.to),
    window.previousFrom && window.previousTo
      ? collect(client, window.previousFrom, window.previousTo)
      : Promise.resolve(null),
  ]);

  const now = countOutputs(current);
  const before = previous ? countOutputs(previous) : null;
  const daily = buildDaily(window.trendDays, current);

  const activeDays = daily.filter(
    (day) =>
      day.social +
        day.article +
        day.transcribe +
        day.translate +
        day.proofread +
        day.video >
      0,
  ).length;

  // No average-cost tile: spend is reported per feature on the cards below, where the
  // service rows that make it up sit beside it. A single blended ₹-per-output figure
  // across posters, articles and videos averaged things that are not comparable.
  const headline: Metric[] = [
    metric('totalOutputs', now.total, 'count', before?.total),
    metric('articles', now.articles, 'count', before?.articles),
    metric('posters', now.posters, 'count', before?.posters),
    metric('transcripts', now.transcripts, 'count', before?.transcripts),
    metric('activeDays', activeDays, 'count'),
  ];

  return {
    range,
    from: window.from,
    to: window.to,
    previousFrom: window.previousFrom,
    previousTo: window.previousTo,
    generatedAt: new Date().toISOString(),
    headline,
    daily,
    features: buildFeatures(current, previous),
    rates: buildRates(),
    eventsAvailable: current.eventsAvailable,
  };
}
