import { z } from 'zod';

// Activity / audit log (/activity, migration 0058): WHO did WHAT, with no login.
//
// "Who" is the caller's IP as the one trusted proxy observed it, plus a browser-scoped device
// id the web app sends on every request. NEITHER IS AUTH. Nothing grants, filters or refuses
// anything on either value — they are attribution labels for an admin reading a log, and a
// device id is cleared by clearing site data.
//
// The payload carries machine keys only; every Marathi label lives in apps/web/lib/strings.ts
// (the analytics rule).

// ---------------------------------------------------------------------------
// Device id
// ---------------------------------------------------------------------------

/** Header every request from apps/web carries. */
export const DEVICE_HEADER = 'x-dgipr-device';

/** Query parameter for a plain navigation (a download link cannot set a header). */
export const DEVICE_QUERY_PARAM = 'device';

const DEVICE_ID_PATTERN = /^d-[a-z0-9]{10,32}$/;

/** Anything else is stored as null: a device id is never trusted as free text. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ActivityFeatureSchema = z.enum([
  'creative',
  'dlo',
  'transcribe',
  'translate',
  'storyboard',
  'video',
  'glossary',
  'chat',
]);
export type ActivityFeature = z.infer<typeof ActivityFeatureSchema>;
export const ACTIVITY_FEATURES = ActivityFeatureSchema.options;

export const ActivityStatusSchema = z.enum([
  'in_progress',
  'success',
  'failed',
]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

// Where a job's key exists, the action IS that key (the `task` a generation job runs under),
// so a finished job can settle the row its route opened without the job knowing about the
// request at all.
export const ActivityActionSchema = z.enum([
  // Generation-family jobs (runJob task keys + the three off-status jobs).
  'article_generation',
  'article_poster_creation',
  'social_post_creation',
  'youtube_thumbnail_creation',
  'dynamic_poster_creation',
  'dynamic_poster_revision',
  'dynamic_poster_crop',
  // Carousel (migration 0059): the run, a one-slide / all-slides redo, a marker round on a slide.
  'carousel_creation',
  'carousel_slide_regeneration',
  'carousel_slide_revision',
  'poster_regeneration',
  'poster_content_revision',
  'poster_image_revision',
  'article_revision',
  'social_caption_creation',
  'social_caption_revision',
  'article_translation',
  // Generation-family, synchronous.
  'caption_edit',
  'poster_copy_edit',
  'publish',
  'poster_download',
  'poster_plain_download',
  'motion_download',
  'article_pdf',
  'reference_upload',
  'reference_enable',
  'reference_disable',
  'reference_delete',
  // /dlo intake.
  'dlo_intake_creation',
  'dlo_extraction',
  'dlo_reextraction',
  // /transcribe.
  'transcription_creation',
  // /translate.
  'text_translation',
  // /video storyboard.
  'video_script_creation',
  'video_script_replan',
  'video_script_edit',
  'video_storyboard',
  'video_still',
  'video_scene_motion_edit',
  'video_end_frame_edit',
  'video_reference_image',
  // /video render + /new-video-workflow.
  'video_animation',
  'video_scene_animation',
  'video_narration',
  'video_stitch',
  'nvw_turn',
  'nvw_character_create',
  'nvw_character_edit',
  'nvw_character_delete',
  'nvw_conversation_delete',
  // Glossary.
  'glossary_create',
  'glossary_edit',
  'glossary_delete',
  // /chat.
  'chat_message',
  'chat_document_attach',
  'chat_image_attach',
  'chat_thread_delete',
]);
export type ActivityAction = z.infer<typeof ActivityActionSchema>;

const ACTIVITY_ACTIONS: ReadonlySet<string> = new Set(
  ActivityActionSchema.options,
);

/** Narrows a job's task key to the vocabulary, so a job only settles keys a route opens. */
export function isActivityAction(value: string): value is ActivityAction {
  return ACTIVITY_ACTIONS.has(value);
}

export const ActivitySubjectKindSchema = z.enum([
  'generation',
  'dlo_intake',
  'new_dlo_intake',
  'transcription',
  'video_project',
  'nvw_turn',
  'nvw_conversation',
  'chat_thread',
  'glossary_term',
  'reference_image',
]);
export type ActivitySubjectKind = z.infer<typeof ActivitySubjectKindSchema>;

export type ActivitySubject = Readonly<{
  kind: ActivitySubjectKind;
  id: string;
}>;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export const ACTIVITY_SUMMARY_MAX_CHARS = 140;

/** Devanagari dependent signs — a cut must never end on one (the lib/fileName.ts rule). */
const TRAILING_COMBINING =
  /[\u0900-\u0903\u093A-\u094D\u0951-\u0957\u0962\u0963\u200C\u200D]+$/;

/**
 * The ONLY way a summary is built, so the ceiling cannot be forgotten at a call site.
 *
 * Takes the first part that is non-empty after whitespace collapse, and cuts it at a word
 * boundary with `…` when it is over the budget. Returns null when every part is empty.
 */
export function activitySummary(
  ...parts: ReadonlyArray<string | null | undefined>
): string | null {
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const text = part.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    return clipSummary(text, ACTIVITY_SUMMARY_MAX_CHARS);
  }
  return null;
}

function clipSummary(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join('');
  const space = head.lastIndexOf(' ');
  // A word boundary only when it keeps most of the budget; one very long word (a URL, a file
  // name with no spaces) is otherwise cut where it stands.
  const cut = space >= Math.floor(max * 0.6) ? head.slice(0, space) : head;
  return `${cut.replace(TRAILING_COMBINING, '').trimEnd()}…`;
}

/** First non-empty line of a longer text — the usual summary source for a note or prompt. */
export function firstLine(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export const ActivityEventSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
  ip: z.string(),
  deviceId: z.string().nullable(),
  userAgent: z.string().nullable(),
  // Strings rather than the enums above: a row written by a newer API must still render on
  // an older page (the label map simply falls back to the key).
  feature: z.string(),
  action: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  subjectKind: z.string().nullable(),
  subjectId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityListResponseSchema = z.object({
  events: z.array(ActivityEventSchema),
  nextCursor: z.string().nullable(),
});
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;

export const ACTIVITY_PAGE_DEFAULT = 50;
export const ACTIVITY_PAGE_MAX = 200;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ActivityQuerySchema = z.object({
  ip: z.string().trim().min(1).max(64).optional(),
  device: z.string().trim().min(1).max(64).optional(),
  feature: ActivityFeatureSchema.optional(),
  status: ActivityStatusSchema.optional(),
  // Calendar days in ANALYTICS_TIME_ZONE, inclusive.
  from: z.string().regex(DATE_PATTERN).optional(),
  to: z.string().regex(DATE_PATTERN).optional(),
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).optional(),
});
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ActivityCountSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
});

export const ActivityBusyIpSchema = z.object({
  ip: z.string(),
  actions: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  lastAt: z.string(),
});

export const ActivitySummaryResponseSchema = z.object({
  day: z.string(),
  activeIps: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  byFeature: z.array(ActivityCountSchema),
  byStatus: z.array(ActivityCountSchema),
  busiestIps: z.array(ActivityBusyIpSchema),
});
export type ActivitySummaryResponse = z.infer<
  typeof ActivitySummaryResponseSchema
>;

// Journey header for one IP or one device.
export const ActivityActorResponseSchema = z.object({
  ip: z.string().nullable(),
  deviceId: z.string().nullable(),
  firstAt: z.string().nullable(),
  lastAt: z.string().nullable(),
  actions: z.number().int().nonnegative(),
  // For an IP: the devices seen from it. For a device: the IPs it came from.
  devices: z.array(
    z.object({
      deviceId: z.string().nullable(),
      userAgent: z.string().nullable(),
      actions: z.number().int().nonnegative(),
      lastAt: z.string(),
    }),
  ),
  ips: z.array(ActivityCountSchema),
});
export type ActivityActorResponse = z.infer<typeof ActivityActorResponseSchema>;

// ---------------------------------------------------------------------------
// Free harness: npx tsx ../schemas/src/activity.ts (from packages/content-engine)
// ---------------------------------------------------------------------------

if (
  typeof process !== 'undefined' &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('schemas/src/activity.ts')
) {
  let failures = 0;
  const check = (name: string, ok: boolean, got?: unknown) => {
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}`}`,
    );
  };

  check('empty → null', activitySummary('', '   ', null, undefined) === null);
  check(
    'first non-empty part wins',
    activitySummary('', ' ab ', 'cd') === 'ab',
  );
  check(
    'whitespace collapses',
    activitySummary('a\n\n  b\tc') === 'a b c',
    activitySummary('a\n\n  b\tc'),
  );
  const long = 'शासकीय '.repeat(40);
  const out = activitySummary(long) ?? '';
  check('cut at 140', Array.from(out).length <= 140, Array.from(out).length);
  check('ends with ellipsis', out.endsWith('…'));
  check('word boundary', !out.includes('शासकी…'), out);
  const matra = 'क'.repeat(20) + 'कि'.repeat(100);
  const cutMatra = activitySummary(matra) ?? '';
  const beforeEllipsis = Array.from(cutMatra).slice(-2, -1)[0] ?? '';
  check('never ends on a matra', !/[ऺ-्]/.test(beforeEllipsis), beforeEllipsis);
  const noSpace = 'x'.repeat(300);
  check(
    'no-space text still capped',
    Array.from(activitySummary(noSpace) ?? '').length === 140,
  );
  check('short unchanged', activitySummary('भारत टॅक्सी') === 'भारत टॅक्सी');
  check('firstLine skips blanks', firstLine('\n\n  हो  \nदुसरी') === 'हो');
  check(
    'firstLine null',
    firstLine(null) === null && firstLine('\n ') === null,
  );
  check('device ok', isDeviceId('d-abcdefghij12'));
  check('device short rejected', !isDeviceId('d-abc'));
  check('device upper rejected', !isDeviceId('d-ABCDEFGHIJ'));
  check('device injection rejected', !isDeviceId('d-abcdefghij12; drop'));
  check('device non-string rejected', !isDeviceId(42));

  console.log(failures === 0 ? '\nall green' : `\n${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}
