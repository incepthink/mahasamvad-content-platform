// Request/response schemas + shared helpers for the AI explainer-video API
// (apps/api parsing + apps/web typed fetch wrappers): a user note → per-scene
// Marathi script (gate 1) → storyboard keyframe stills (gate 2) → provider-
// rendered clips stitched into one voiced MP4 + SRT.
//
// AUDIO LEADS, CLIPS FOLLOW: the narration has no whole-video duration cap.
// It is divided into as many scenes as needed, with every newly planned scene
// capped at five seconds. Legacy rows may still contain longer provider-valid
// clips and remain readable.
//
// The per-second tier prices and the SRT builder live HERE, not in
// content-engine: the web renders the pre-spend cost estimate on gate 2 and
// must never import content-engine (openai/pdfjs/sarvam) — the same reasoning
// that put combineIntakeSources and tweetWeightedLength in this package.

import { z } from 'zod';

export const VideoProjectStatusSchema = z.enum([
  'scripting',
  'script_ready',
  'storyboarding',
  'storyboard_ready',
  'animating',
  'completed',
  'failed',
]);
export type VideoProjectStatus = z.infer<typeof VideoProjectStatusSchema>;

// Machine step keys refining the working statuses; the web maps them to Marathi
// progress labels. Order mirrors pipeline order.
export const VideoProjectStepSchema = z.enum([
  'script',
  'stills',
  'animate',
  'narrate',
  'stitch',
  'upload',
  'done',
]);
export type VideoProjectStep = z.infer<typeof VideoProjectStepSchema>;

// Legacy storage values. The duration picker has been removed and neither
// value limits new narration; the column keeps its historical CHECK values so
// existing rows and deployments need no migration.
export const VideoDurationBucketSchema = z.enum(['short', 'long']);
export type VideoDurationBucket = z.infer<typeof VideoDurationBucketSchema>;

// How the narration entered the project. A note is rewritten into a voiceover;
// a script is already-final Marathi narration whose words must survive
// unchanged. In both lanes the narration's natural speaking time decides how
// many five-second scenes the video needs.
export const VideoInputModeSchema = z.enum(['note', 'script']);
export type VideoInputMode = z.infer<typeof VideoInputModeSchema>;

export const VideoOrientationSchema = z.enum(['landscape', 'vertical']);
export type VideoOrientation = z.infer<typeof VideoOrientationSchema>;

// Clip quality tiers. What a tier SELECTS is a provider concern, resolved by
// the adapter: Veo maps it to a model id (env-overridable VEO_MODEL_*), Kling
// 3.0 — one model — maps it to a RESOLUTION. Under KLING_RESOLUTION it selects
// nothing at all, which is why the price table below is flat.
//
// 'lite' survives for legacy rows only; the web picker has not offered it since
// Veo's lite preview turned out to ignore end frames.
export const VideoTierSchema = z.enum(['fast', 'lite', 'standard']);
export type VideoTier = z.infer<typeof VideoTierSchema>;

// Kling 3.0 at 720p with audio off: 6 credits per second (the official rate).
// USD per credit depends on which resource package the account bought, so this
// is CONFIGURED, not discovered — public pay-as-you-go reference points sit at
// $0.075-0.11/s, and 0.1 deliberately errs high.
//
// TO CALIBRATE: kling-client logs the `billing[]` Kling returns on every
// successful render. Compare one against the console's deduction and replace
// this number; there is nothing else to change.
const KLING_720P_USD_PER_SECOND = 0.1;

// USD per second of rendered video, per tier — the single source of truth for
// both the API's cost metering and the web's pre-spend estimates.
//
// FLAT ACROSS TIERS on purpose: with VIDEO_CLIP_PROVIDER=kling and
// KLING_RESOLUTION pinned to 720p there is one model at one resolution, so the
// tier genuinely does not change the price and pretending otherwise would put a
// false number in front of the officer approving the spend at gate 2.
//
// This table is PER-DEPLOYMENT truth: one repo state cannot price a Veo
// deployment and a Kling one at once, and that was already the contract when
// the numbers were Veo's (standard 0.40 / fast 0.15 / lite 0.08 — restore those
// alongside VIDEO_CLIP_PROVIDER=veo). The web reads it directly, so keeping it
// a single table is what stops the displayed estimate and the recorded
// video_projects.cost_usd from drifting apart.
export const VIDEO_TIER_PRICE_PER_SECOND_USD: Readonly<
  Record<VideoTier, number>
> = {
  standard: KLING_720P_USD_PER_SECOND,
  fast: KLING_720P_USD_PER_SECOND,
  lite: KLING_720P_USD_PER_SECOND,
};

// A storyboard must contain at least one scene. There is deliberately no
// maximum: longer narration creates more five-second scenes.
export const VIDEO_SCENE_LIMIT: Readonly<{ min: number }> = { min: 1 };

// Newly planned scene windows are whole seconds from 3 through 5. Kling can
// technically render as long as 15 seconds, but the product intentionally uses
// shorter scenes and creates more of them. The provider maximum remains the
// schema ceiling solely so historical 6-15 second rows continue to parse.
export const VIDEO_CLIP_MIN_SECONDS = 3;
export const VIDEO_SCENE_MAX_SECONDS = 5;
export const VIDEO_CLIP_MAX_SECONDS = 15;

// There is no script-duration ceiling in either input lane. A narration's
// length determines its scene count, and gate 2 prices that real count before
// any clip is rendered.

// How far a real voice measurement may exceed its estimate before the narrate
// phase attempts to shorten wording to the already-created scene capacity.
export const VIDEO_NARRATION_FIT_TOLERANCE = 1.15;

// One second inside the five-second scene ceiling, so ceil() still lands at or
// below five after a rewrite.
export const VIDEO_SCENE_REWRITE_TARGET_SECONDS = 4;

// Stored scene duration. New windows are capped by VIDEO_SCENE_MAX_SECONDS,
// while the wider provider maximum keeps legacy 6-15 second rows readable
// (WINDOW FREEZE keeps their rendered clips valid).
export const VideoSceneDurationSchema = z
  .number()
  .int()
  .min(VIDEO_CLIP_MIN_SECONDS)
  .max(VIDEO_CLIP_MAX_SECONDS);
export type VideoSceneDuration = z.infer<typeof VideoSceneDurationSchema>;

// THE duration derivation — one function shared by the runner (measured WAV),
// the route (provisional estimate) and the web (display), so the three can
// never disagree. ceil() guarantees the window is at least the speech, which
// is what makes muxNarration's atempo unreachable on a newly derived scene.
export function clipSecondsForNarration(narrationSeconds: number): number {
  return Math.min(
    VIDEO_SCENE_MAX_SECONDS,
    Math.max(VIDEO_CLIP_MIN_SECONDS, Math.ceil(narrationSeconds)),
  );
}

// Allocate whole-second visual windows beneath one continuous narration track.
// `sceneWeights` are normally the provisional durations the script writer saw.
// Only the TOTAL must contain the WAV; individual visual cuts may occur while a
// sentence continues. Provider bounds remain absolute.
export function allocateVideoSceneDurations(
  sceneWeights: readonly number[],
  totalSeconds: number,
): number[] {
  if (sceneWeights.length === 0) return [];
  const minimum = sceneWeights.length * VIDEO_CLIP_MIN_SECONDS;
  const maximum = sceneWeights.length * VIDEO_SCENE_MAX_SECONDS;
  const total = Math.max(minimum, Math.min(maximum, Math.ceil(totalSeconds)));
  const weights = sceneWeights.map((weight) => Math.max(1, weight));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const durations = sceneWeights.map(() => VIDEO_CLIP_MIN_SECONDS);

  for (let remaining = total - minimum; remaining > 0; remaining -= 1) {
    let pick = -1;
    let largestDeficit = Number.NEGATIVE_INFINITY;
    for (const [index, duration] of durations.entries()) {
      if (duration >= VIDEO_SCENE_MAX_SECONDS) continue;
      const ideal = (total * weights[index]!) / weightTotal;
      const deficit = ideal - duration;
      if (deficit > largestDeficit) {
        largestDeficit = deficit;
        pick = index;
      }
    }
    if (pick === -1) break;
    durations[pick]! += 1;
  }
  return durations;
}

// Spoken-Marathi rate: chars of Devanagari per second of bulbul speech.
//
// MEASURED, not guessed — 2026-07-26, `shubh` on bulbul:v3 at 44.1 kHz, over
// four real narration lines of 72-195 chars: 16.0-17.5 chars/s, mean 16.5.
// The previous value of 32 was ~2x too fast, which is why narration used to
// overrun so badly: at 32 the old 280-char cap "fitted" 8.75s, when in truth
// 280 chars is ~17 SECONDS of speech in an 8s clip. muxNarration's atempo caps
// at 2.0, so the surplus was not sped up — it was TRIMMED, cutting words off the
// end of scenes. Re-measure with the calibration harness if the voice, the model
// or the pace ever changes; do not adjust this by intuition.
//
// THE RATE IS PER-VOICE, SO IT IS CONFIGURABLE (2026-07-31). 16.5 is bulbul's
// number and stays the default; ElevenLabs reads the same Marathi at ~10.9
// chars/s, and the difference is not cosmetic on the READY-SCRIPT lane. There
// the scene count is ceil(estimateNarrationSeconds(script) / 5) and the words
// may never be trimmed or sped up, so a rate that is 50% too fast plans too few
// clips and the narrate gate REFUSES the project after the officer has already
// approved it. Set NARRATION_CHARS_PER_SECOND beside NARRATION_TTS_PROVIDER.
//
// Read from env rather than keyed off the provider because @dgipr/schemas must
// not import content-engine, and the browser (which only shows a create-form
// hint) cannot see server env at all: NEXT_PUBLIC_ is checked first so a
// deployment can keep the hint honest, and an unset browser value falls back to
// the default, where being wrong costs an estimate and never a render — the
// server measures the real WAV.
function readNarrationCharsPerSecond(): number {
  const raw =
    process.env['NEXT_PUBLIC_NARRATION_CHARS_PER_SECOND'] ??
    process.env['NARRATION_CHARS_PER_SECOND'];
  if (raw === undefined || raw.trim() === '') return 16.5;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 16.5;
}

export const DEFAULT_NARRATION_CHARS_PER_SECOND = readNarrationCharsPerSecond();

// The hard per-scene ceiling: five seconds of speech at the configured rate.
// It validates officer edits; generated narration itself has no total ceiling
// and is divided into additional scenes instead.
export const VIDEO_NARRATION_MAX_CHARS = Math.round(
  VIDEO_SCENE_MAX_SECONDS * DEFAULT_NARRATION_CHARS_PER_SECOND,
);

// Spoken Marathi in words/second — the same budget expressed the way a writing
// prompt can actually use it. MEASURED alongside the char rate above (mean 2.29
// over the same four lines; the old 4.5 was the same 2x error). Lives here, not
// in content-engine, because BOTH the scene planner (deciding whether a fact
// fits one scene or needs two) and the script writer (filling a scene) must work
// to the identical number; when they drifted, the planner packed scenes the
// writer could not narrate in time.
// Scaled off the char rate so a configured voice moves BOTH numbers together —
// the two describe one voice, and the drift they were moved here to prevent
// would come straight back if only one of them followed the provider.
export const NARRATION_WORDS_PER_SECOND =
  Math.round(2.3 * (DEFAULT_NARRATION_CHARS_PER_SECOND / 16.5) * 100) / 100;

// The on-screen Marathi key point burned onto a scene (the amount, the
// deadline, the count, the scheme name). A ceiling, not a target: this is one
// readable line in the lower third at 1080p, and a second line would start
// competing with the footage the scene exists to show. The text is typeset by
// Chromium and composited AFTER Veo, so no image or video model ever renders
// Devanagari — the poster path's rule, applied to video.
export const VIDEO_KEY_POINT_MAX_CHARS = 48;

// The project's visual style/setting paragraph. Raised from the script
// generator's old inline 600 because the paragraph now has to carry the SETTING
// (Maharashtra, India; who the people are) as well as the look, and because it
// is officer-editable at gate 1. Lives here so the generator's schema
// (content-engine) and UpdateVideoScriptRequestSchema cannot drift.
export const VIDEO_STYLE_MAX_CHARS = 1200;

// The officer's own direction for one project ("AI प्रॉम्प्ट"), migration 0051.
// A ceiling rather than a target: it is an instruction to the script/storyboard
// model, not a source of facts, and the note beside it is what the article-side
// NOTE_MAX_CHARS bound is for.
export const VIDEO_AI_PROMPT_MAX_CHARS = 2000;

// How many reference pictures may ride with that prompt. They are sent to the
// PLANNING model as extra image parts, so each one is billed as input on every
// planning call — including gate 1's free-to-the-officer re-plan. Four is what a
// reference sheet or a handful of location photographs needs; the browser and
// the create route both enforce it, so a hand-made request cannot spend more.
export const VIDEO_PROMPT_IMAGE_LIMIT = 4;

// The scene's own storyboard label ("Opening — Newborn daughter"): the line the
// review card is titled with, under "दृश्य N". English, like the visual brief it
// belongs with, and stored on the scenes jsonb so it needed no migration.
export const VIDEO_SCENE_LABEL_MAX_CHARS = 120;

// Where the Government of Maharashtra lockup sits on a video frame, as
// fractions of the frame WIDTH, so one number serves 720p, 1080p and 9:16
// alike. It lives here rather than in poster-renderer because BOTH the stitch
// (which burns it into the finished video) and the per-scene review player in
// apps/web (which lays it over the raw clip in CSS) must place it identically,
// and apps/web cannot import poster-renderer — the combineIntakeSources move.
//
// Social posts use a 160px lockup on a 1280px canvas (12.5%). Video is
// deliberately smaller at 9%: it sits over footage rather than over a designed
// poster, and 15% (then 12%) was reported as too large on the finished video.
// Below this the Marathi wordmark under the emblem stops reading at 720p.
export const VIDEO_LOCKUP_WIDTH_RATIO = 0.09;
export const VIDEO_LOCKUP_MARGIN_RATIO = 0.008;

// muxNarration only speeds a segment up past THIS much overrun; anything
// smaller is absorbed by the trim and left at natural pace. Since durations
// are DERIVED from the measured speech (clipSecondsForNarration ceils, so the
// window is never smaller than the narration) this is unreachable on a new
// scene — it survives purely as the backstop for legacy frozen windows, whose
// clips are paid for and must never be invalidated by a narration edit.
export const VIDEO_NARRATION_TEMPO_TOLERANCE = 1.02;

// Estimated spoken seconds for a narration string (fallback + UI hint only —
// measured WAV duration always wins when audio exists).
export function estimateNarrationSeconds(
  text: string,
  charsPerSecond: number = DEFAULT_NARRATION_CHARS_PER_SECOND,
): number {
  const chars = text.trim().length;
  if (chars === 0) return 0;
  return chars / Math.max(1, charsPerSecond);
}

// Script mode preserves every supplied word. Whitespace has no spoken value,
// so this is the only normalization allowed before deterministic scene splits,
// API equality checks and continuous TTS assembly.
export function normalizeVideoNarrationScript(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function isMarathiVideoNarration(text: string): boolean {
  return /[\u0900-\u097f]/.test(text);
}

export const VideoSceneStatusSchema = z.enum([
  'pending',
  'still-rendering',
  'still-ready',
  'animating',
  'done',
  'failed',
]);
export type VideoSceneStatus = z.infer<typeof VideoSceneStatusSchema>;

// One scene as the detail payload ships it. Storage paths are server-side;
// the client gets public URLs.
export const VideoSceneSchema = z.object({
  // Marathi voiceover text for this scene.
  narration: z.string(),
  // The scene's overall visual idea from the planner.
  visualBrief: z.string(),
  // Duration-aware direction added before storyboard rendering: a precise
  // opening state for the still and chronological performance for the clip.
  // Optional for projects created before the motion-director stage.
  openingVisualBrief: z.string().optional(),
  motionBrief: z.string().optional(),
  // English description of how the SAME shot looks at its END — the second
  // reviewed frame, edited from the start frame so setting/people/light hold,
  // which Veo interpolates toward. Absent on legacy (single-frame) scenes.
  endVisualBrief: z.string().optional(),
  // Short Marathi line burned onto this scene's footage after Veo (the amount,
  // the deadline, the count, the scheme name). Absent or empty ⇒ this scene
  // gets no overlay, which is also how an officer turns the feature off.
  keyPoint: z.string().optional(),
  // A picture the officer attached at gate 1 as reference material for THIS
  // scene's start frame ("use this building / this person / this object", named
  // from the दृश्य-वर्णन). Both halves are shipped, unlike every other storage
  // path here: the URL renders the thumbnail, and the PATH is what gate 1 sends
  // back on the save that attaches it, so the round-trip needs no reverse
  // mapping from a public URL to the object it names.
  referenceImageUrl: z.string().optional(),
  referenceImagePath: z.string().optional(),
  durationSeconds: VideoSceneDurationSchema,
  status: VideoSceneStatusSchema,
  // Planner's Marathi one-liner: the information this scene must convey.
  beat: z.string().optional(),
  // The storyboard's short English label for this scene, shown as the card's
  // own title. Absent on scenes planned before it existed.
  sceneLabel: z.string().optional(),
  // Planner's English shot/camera direction ("wide establishing shot, slow
  // push-in") — threaded into the keyframe + Veo motion prompts.
  shotHint: z.string().optional(),
  // Approximate spoken share of this scene slice. For continuous narration it
  // is proportional metadata from the one measured project WAV; legacy rows
  // carry the measured duration of their separate scene WAV.
  narrationSeconds: z.number().optional(),
  // Public URL of the scene's narration WAV (gate-2 audition).
  narrationAudioUrl: z.string().optional(),
  stillUrl: z.string().optional(),
  // Public URL of the scene's END frame (reviewed beside the start frame).
  endStillUrl: z.string().optional(),
  clipUrl: z.string().optional(),
  // True when this scene's clip was animated from an OLDER still than the one
  // shown — the per-scene re-animate affordance keys off it.
  clipStale: z.boolean().optional(),
  error: z.string().optional(),
});
export type VideoScene = z.infer<typeof VideoSceneSchema>;

export const VideoProjectDetailSchema = z.object({
  id: z.string(),
  status: VideoProjectStatusSchema,
  step: VideoProjectStepSchema.nullable(),
  error: z.string().nullable(),
  note: z.string(),
  // Legacy only: the create form asked for a title/angle until 2026-09-02 and
  // rows from before then still carry one (the list cards name themselves from
  // it). `aiPrompt` replaced it as the officer's direction.
  heading: z.string().nullable(),
  // Defaulted so a payload from an API without 0051 — or before this field
  // existed — parses as "no direction" rather than failing the poll.
  aiPrompt: z.string().nullable().default(null),
  // Public URLs of the reference pictures attached to that prompt, so the page
  // can show back what was sent. The PATHS stay server-side: nothing sends them
  // back, unlike a scene's reference image.
  promptImageUrls: z.array(z.string()).default([]),
  inputMode: VideoInputModeSchema,
  durationBucket: VideoDurationBucketSchema,
  orientation: VideoOrientationSchema,
  tier: VideoTierSchema,
  title: z.string().nullable(),
  style: z.string().nullable(),
  referenceTitle: z.string().nullable(),
  referenceUrl: z.string().nullable(),
  scenes: z.array(VideoSceneSchema),
  // Whether the on-screen Marathi key points are burned into the stitch
  // (migration 0047). Defaulted so an older API payload — or a database
  // without 0047 — parses as captions off rather than failing the poll.
  captionsEnabled: z.boolean().default(false),
  videoUrl: z.string().nullable(),
  srtUrl: z.string().nullable(),
  // True when the current video carries Marathi TTS narration (every scene has
  // current narration audio); voiceSpeaker names the Sarvam voice used. Derived
  // server-side from the scenes — not stored as its own column.
  voiced: z.boolean(),
  voiceSpeaker: z.string().nullable(),
  videoVersion: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VideoProjectDetail = z.infer<typeof VideoProjectDetailSchema>;

export const VideoProjectSummarySchema = z.object({
  id: z.string(),
  status: VideoProjectStatusSchema,
  heading: z.string().nullable(),
  title: z.string().nullable(),
  noteExcerpt: z.string(),
  orientation: VideoOrientationSchema,
  tier: VideoTierSchema,
  sceneCount: z.number().int().nonnegative(),
  videoUrl: z.string().nullable(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type VideoProjectSummary = z.infer<typeof VideoProjectSummarySchema>;

// ---------- officer-supplied narration audio (ready-script mode) ----------
//
// A department may hold a voice this pipeline cannot buy — an ElevenLabs plan
// whose free tier has no API access, a studio recording, a presenter reading the
// script themselves. Ready-script mode therefore accepts the finished voiceover
// as a FILE, and everything downstream then treats it exactly as it treats a WAV
// this system synthesized: it is measured, it decides the scene split and the
// clip windows, and it is the single continuous track muxed onto the stitch.
//
// The containers are wider than /dlo's recording list on purpose. That list is
// narrow because Sarvam's STT must auto-detect the codec; here the file is only
// ever DECODED by ffmpeg, which reads all of these — and an officer exporting
// from a TTS product gets whichever of them that product emits.
export const NARRATION_AUDIO_MIME_BY_EXTENSION: Readonly<
  Record<string, string>
> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

export const NARRATION_AUDIO_EXTENSIONS: readonly string[] = Object.keys(
  NARRATION_AUDIO_MIME_BY_EXTENSION,
);

// The picker's `accept`: extensions AND media types, because browsers differ
// over which they honour and offering both is what stops the picker greying out
// a file the server would have taken.
export const NARRATION_AUDIO_ACCEPT: string = [
  ...NARRATION_AUDIO_EXTENSIONS,
  ...new Set(Object.values(NARRATION_AUDIO_MIME_BY_EXTENSION)),
].join(',');

// Extension-driven, never the browser's reported type, which is empty or wrong
// for several of these containers. Null ⇒ not a recording this route accepts.
export function narrationAudioMimeForFileName(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return (
    NARRATION_AUDIO_MIME_BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null
  );
}

// The staleness key an uploaded track is stored under, where a synthesized one
// stores its voice id. It is what tells every later phase "this narration is the
// officer's own": the voice phase must not re-synthesize it, the re-voice route
// must refuse to replace it, and the SAME check works after a restart because it
// lives on the scenes jsonb — no column, no migration. It can never collide with
// a real voice id (`shubh`, a 20-char ElevenLabs id).
export const UPLOADED_NARRATION_VOICE = 'upload';

// There is no video character ceiling and, since 2026-08-12, no duration
// ceiling either: a ready script is checked for being Marathi, and for nothing
// else. Its length decides how many scenes it gets, not whether it is accepted.
export const CreateVideoProjectRequestSchema = z
  .object({
    note: z.string().trim().min(20),
    // The officer's free-text direction, appended to the lane's own task
    // statement. Never a source of facts — the prompt block says so, and the
    // note stays the only authority.
    aiPrompt: z.string().trim().max(VIDEO_AI_PROMPT_MAX_CHARS).optional(),
    inputMode: VideoInputModeSchema.default('note'),
    // Kept only for the existing database column. New clients omit it and the
    // neutral legacy value is persisted without controlling generation.
    durationBucket: VideoDurationBucketSchema.default('short'),
    orientation: VideoOrientationSchema,
    tier: VideoTierSchema,
    // Set by the create route when the request carried a narration file. It
    // only suppresses the char-rate estimate below: with real audio in hand the
    // estimate is not merely imprecise but the wrong measurement entirely, and
    // the route rejects an over-long file against the DECODED duration.
    narrationAudioUploaded: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.inputMode === 'script' && !isMarathiVideoNarration(value.note)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'तयार निवेदन मराठीत असणे आवश्यक आहे.',
      });
    }
    if (value.inputMode !== 'script' && value.narrationAudioUploaded) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['narrationAudioUploaded'],
        message: 'निवेदनाचा ऑडिओ फक्त तयार संहितेसोबत देता येतो.',
      });
    }
  });
export type CreateVideoProjectRequest = z.infer<
  typeof CreateVideoProjectRequestSchema
>;
// What a CLIENT sends. `narrationAudioUploaded` is server-derived — the route
// sets it from whether the request actually carried a file, so a caller stating
// it could only disagree with the bytes — and the defaulted fields are optional
// on the way in.
export type CreateVideoProjectInput = z.input<
  typeof CreateVideoProjectRequestSchema
>;

export const CreateVideoProjectResponseSchema = z.object({ id: z.string() });
export type CreateVideoProjectResponse = z.infer<
  typeof CreateVideoProjectResponseSchema
>;

// Gate 1's save: the reviewed/edited scene list. Narration is capped where the
// script generator caps it (VIDEO_NARRATION_MAX_CHARS — one constant, no
// drift). durationSeconds is accepted for back-compat but IGNORED by the
// route: windows are server-assigned from the measured narration audio.
export const UpdateVideoScriptRequestSchema = z.object({
  // The project's visual style/setting paragraph, editable at gate 1 — the
  // officer's escape hatch when a frame comes back with the wrong setting or
  // the wrong people. Optional: a client that does not send it leaves the
  // stored paragraph alone. CHANGING it invalidates every rendered frame (it
  // is an input to all three prompts), which the route enforces.
  style: z.string().trim().min(1).max(VIDEO_STYLE_MAX_CHARS).optional(),
  scenes: z
    .array(
      z.object({
        // Which entry of the STORED scenes array this card came from, so the
        // route can reconcile by identity instead of by array position. An
        // insert shifts every later card's position, and position-matching then
        // compares each one against its neighbour's briefs, finds them
        // different, and resets a whole storyboard of PAID frames to pending.
        // Omitted for a genuinely new scene; omitted entirely by an older
        // client, which falls back to the positional behaviour unchanged.
        sourceIndex: z.number().int().min(0).optional(),
        // Never blank. An inserted scene carries narration moved out of a
        // neighbour, which is what keeps the joined script byte-identical (so
        // the measured WAV stays current) AND keeps every visual cut aligned
        // with the voice. A blank-narration scene would add visual time that
        // the single continuous narration track has no silence for, pushing
        // every later scene out of step with the words it belongs to.
        narration: z.string().trim().min(1).max(VIDEO_NARRATION_MAX_CHARS),
        // Uncapped, like `openingVisualBrief` below: no provider imposes a
        // limit near the old 600, and Kling's 3072-char prompt cap is absorbed
        // downstream by fitClipPrompt, which sheds the briefs BEFORE the
        // setting/no-talking/no-text rules. A long brief degrades at render
        // time instead of being rejected at save time.
        visualBrief: z.string().trim().min(1),
        // The end-frame description. Optional for back-compat with pre-feature
        // drafts; a scene saved without one renders first-frame-only.
        endVisualBrief: z.string().trim().min(1).optional(),
        // Empty string is meaningful and must survive: it CLEARS the overlay
        // for this scene, so it cannot be min(1) like the briefs.
        keyPoint: z.string().trim().max(VIDEO_KEY_POINT_MAX_CHARS).optional(),
        // The storage path of this scene's reference picture, as returned by
        // the upload route. THREE states, and the difference matters: a path
        // attaches (or replaces) the picture, an empty string REMOVES it, and
        // OMITTING the field leaves whatever is stored alone — which is what
        // stops a client that predates this feature from silently detaching
        // every officer's reference image on an ordinary save.
        referenceImagePath: z.string().trim().optional(),
        durationSeconds: VideoSceneDurationSchema.optional(),
      }),
    )
    // Only a floor. Longer narration may be saved as as many five-second scenes
    // as it needs.
    .min(VIDEO_SCENE_LIMIT.min),
});
export type UpdateVideoScriptRequest = z.infer<
  typeof UpdateVideoScriptRequestSchema
>;

// Gate 1's "AI ने पुन्हा तयार करा": persist the officer's scene split exactly as
// typed, then let the model re-derive every field the pipeline OWNS (visual
// brief, end brief, shot hint, beat, on-screen key point) and re-weight the
// clip windows.
//
// It is a separate schema from the save request above for one load-bearing
// reason: `visualBrief` there is `.min(1)`, and a scene the officer has just
// inserted has NO brief — supplying one is the entire point of pressing this.
// Reusing the save schema would therefore reject exactly the payload the
// feature exists to accept.
//
// Narration keeps its floor and DELIBERATELY NOT the save route's one-clip
// ceiling (2026-08-14). This request neither writes nor rewrites narration —
// it is sent as CONTEXT so the model can describe each scene — so a line over
// VIDEO_NARRATION_MAX_CHARS is not something this call could introduce, and
// rejecting it blocks the one operation on the page that does not touch the
// words. Stored narration legitimately runs past that constant in two ordinary
// cases: the ready-script splitter bounds its chunks by the rate that script
// was MEASURED at, which is higher than the configured rate whenever the
// speaker reads faster than the voice's calibration; and any project written
// before NARRATION_CHARS_PER_SECOND was set for the deployed voice was capped
// against the old, larger ceiling. In both, the officer was left with a raw
// zod `too_big` payload on a button that would not have changed the line
// anyway. The per-clip fit is still guaranteed where it is actually decided —
// windows come from clipSecondsForNarration (clamped to five seconds)
// and the storyboard job measures the real WAV — and the save/submit buttons,
// which DO commit a split, keep the ceiling.
//
// `style` is deliberately absent. The style paragraph is an input to every
// frame prompt, so regenerating it would invalidate every rendered frame; the
// re-plan keeps whatever is stored, and gate 1's textarea remains the way to
// change it.
export const ReplanVideoScriptRequestSchema = z.object({
  scenes: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0).optional(),
        narration: z.string().trim().min(1),
        // Optional, and blank is normal: an existing scene sends its current
        // brief so a failed call leaves something in place, while a new one
        // sends nothing at all.
        visualBrief: z.string().trim().optional(),
        endVisualBrief: z.string().trim().optional(),
        keyPoint: z.string().trim().max(VIDEO_KEY_POINT_MAX_CHARS).optional(),
        // Carried through the re-plan for the same reason the narration is: the
        // reference picture is the officer's own input, not a field the model
        // owns, so re-describing a scene must not detach the photograph the
        // description is meant to be about.
        referenceImagePath: z.string().trim().optional(),
      }),
    )
    .min(VIDEO_SCENE_LIMIT.min),
});
export type ReplanVideoScriptRequest = z.infer<
  typeof ReplanVideoScriptRequestSchema
>;

// One reference picture, stored ahead of the save that attaches it (the chat
// attachment shape). Uploading is a separate call so the file travels while the
// officer is still writing the scene, and the save itself stays an ordinary
// JSON request carrying only the path.
//
// Nothing is attached by uploading: the picture reaches a scene only when the
// returned `path` comes back on a save, which is what makes "जतन करा" mean the
// same thing for this control as for every other field on the card.
export const VideoReferenceImageUploadResponseSchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
});
export type VideoReferenceImageUploadResponse = z.infer<
  typeof VideoReferenceImageUploadResponseSchema
>;

// Per-scene frame regeneration; an edited brief rides along so "change the
// description and redraw" is one call. `frame` picks which frame to redraw
// (default start). Redrawing the START also regenerates the end frame — the
// end is an EDIT of the start, so a new start orphans it; redrawing the END
// alone re-edits from the current start (one image call).
//
// Every brief here is deliberately UNCAPPED. No provider imposes a limit near
// the old 600/1200: they reach the frame models (Gemini / gpt-image) whose text
// budgets are orders of magnitude larger, and the one real budget on the path —
// Kling's 3072-char prompt cap — is already absorbed downstream by
// fitClipPrompt, which sheds the briefs BEFORE the setting/no-talking/no-text
// rules. So a long brief degrades at render time instead of being rejected at
// save time.
export const RegenerateStillRequestSchema = z.object({
  frame: z.enum(['start', 'end']).optional(),
  visualBrief: z.string().trim().min(1).optional(),
  openingVisualBrief: z.string().trim().min(1).optional(),
  endVisualBrief: z.string().trim().min(1).optional(),
});
export type RegenerateStillRequest = z.infer<
  typeof RegenerateStillRequestSchema
>;

// The officer's edit of one scene's motion direction (the director stage's
// motion_brief). It is an input to the CLIP prompt only — no frame is rendered
// from it — so saving one is synchronous, spends nothing and invalidates
// nothing; it takes effect on the next animate / re-animate of that scene.
//
// UNCAPPED, like openingVisualBrief above: the only real budget on this path is
// Kling's 3072-char prompt cap, and fitClipPrompt already absorbs it downstream
// by shedding the briefs BEFORE the setting/no-talking/no-text rules. A long
// direction therefore degrades at render time instead of being rejected at save
// time — and rejecting the officer's own words is the worse of the two.
export const UpdateSceneMotionRequestSchema = z.object({
  motionBrief: z.string().trim().min(1),
});
export type UpdateSceneMotionRequest = z.infer<
  typeof UpdateSceneMotionRequestSchema
>;

// Which scenes THE spend gate should animate. Omitted (the default, and every
// pre-2026-08-21 client) means "the job decides" — it renders every scene whose
// clip is not current and skips the rest, which is what it has always done.
//
// A supplied list is ADDITIVE, never subtractive: the job still renders every
// stale scene, and these indexes are extra scenes the officer chose to re-shoot
// even though their clip is current. It cannot mean "render only these", and
// the web never offers that, because skipping a stale scene would concatenate a
// clip animated from a frame the officer has already replaced — old footage in a
// video they believe they just fixed.
export const StartVideoAnimationRequestSchema = z.object({
  scenes: z.array(z.number().int().min(0)).optional(),
  // The officer's caption choice, taken at gate 2 and persisted on the row
  // before the animate flip. Optional so an older client — which sends only
  // `scenes` — leaves whatever is stored alone rather than silently clearing it.
  captions: z.boolean().optional(),
});
export type StartVideoAnimationRequest = z.infer<
  typeof StartVideoAnimationRequestSchema
>;

// ---------- deterministic timing + SRT ----------
//
// Cue boundaries come from the scenes' own durationSeconds (the clip providers
// return exactly the requested length), so both the on-page timing list and the
// downloaded SRT are derived from one place and always agree with the stitched
// video.

export type SceneTiming = Readonly<{
  startSeconds: number;
  endSeconds: number;
}>;

export function sceneTimings(
  scenes: ReadonlyArray<{ durationSeconds: number }>,
): SceneTiming[] {
  const timings: SceneTiming[] = [];
  let elapsed = 0;
  for (const scene of scenes) {
    timings.push({
      startSeconds: elapsed,
      endSeconds: elapsed + scene.durationSeconds,
    });
    elapsed += scene.durationSeconds;
  }
  return timings;
}

function srtTimestamp(totalSeconds: number): string {
  const ms = Math.round(totalSeconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (value: number, width: number): string =>
    String(value).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

// One cue per scene, text = the narration — ready for Sarvam TTS timing or a
// human voiceover session. Standard SRT: blank-line separated, CRLF-free.
export function buildSrt(
  scenes: ReadonlyArray<{ narration: string; durationSeconds: number }>,
): string {
  const timings = sceneTimings(scenes);
  return scenes
    .map((scene, index) => {
      const timing = timings[index]!;
      return [
        String(index + 1),
        `${srtTimestamp(timing.startSeconds)} --> ${srtTimestamp(timing.endSeconds)}`,
        scene.narration.trim(),
      ].join('\n');
    })
    .join('\n\n')
    .concat('\n');
}

// Pre-spend estimate shown on gate 2 and beside the per-scene re-animate button.
export function estimateVideoRenderCostUsd(
  tier: VideoTier,
  scenes: ReadonlyArray<{ durationSeconds: number }>,
): number {
  const seconds = scenes.reduce(
    (total, scene) => total + scene.durationSeconds,
    0,
  );
  return seconds * VIDEO_TIER_PRICE_PER_SECOND_USD[tier];
}
