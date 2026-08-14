// Request/response schemas + shared helpers for the AI explainer-video API
// (apps/api parsing + apps/web typed fetch wrappers): a user note → per-scene
// Marathi script (gate 1) → storyboard keyframe stills (gate 2) → provider-
// rendered clips stitched into one voiced MP4 + SRT.
//
// AUDIO LEADS, CLIPS FOLLOW (2026-07-26): the narration is authored against the
// project's TOTAL time (VIDEO_TOTAL_SECONDS — 30s or 60s), never against a clip
// window. After TTS measures each scene's WAV, the clip duration is DERIVED
// from the speech (clipSecondsForNarration: clamp(3, 15, ceil(seconds)) — Kling
// takes integer 3-15s). Narration is never trimmed or sped up to fit a clip;
// the clip stretches to fit the speech.
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

// The officer's total-length pick: short = a ~30s video, long = ~1 minute
// (VIDEO_TOTAL_SECONDS maps the values). The column keeps its historical
// 'short'/'long' CHECK values so no migration was needed when the buckets
// became exact totals.
export const VideoDurationBucketSchema = z.enum(['short', 'long']);
export type VideoDurationBucket = z.infer<typeof VideoDurationBucketSchema>;

// How the narration entered the project. A note is rewritten into a fixed
// 30-second voiceover; a script is already-final Marathi narration whose words
// must survive unchanged and whose natural speaking time decides the video.
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

// The NOTE lane's planner range. Duration and story needs decide the result;
// there is no preferred count per time bucket. It is not a ceiling on a stored
// scene list: the READY-SCRIPT lane derives its scene count from how long the
// supplied narration actually speaks (2026-08-12), so a long script legitimately
// produces more scenes than this — see VIDEO_CLIP_MAX_SECONDS below and
// splitReadyVideoScript. The note lane cannot reach it anyway: its budget is
// VIDEO_TOTAL_SECONDS (30/60s), which eight 15-second clips already cover twice
// over.
export const VIDEO_SCENE_LIMIT: Readonly<{ min: number; max: number }> = {
  min: 1,
  max: 8,
};

// Kling 3.0's real clip bounds (whole seconds; kling-client validates the same
// range at pre-flight). The MAX is also the per-scene SPEECH ceiling: a scene
// whose narration measures past 15s is rewritten shorter, because no clip can
// stretch further. Veo cannot do variable lengths (its start+end interpolation
// exists only at 8s), so the veo adapter rejects anything outside {4, 6, 8} —
// variable clips require VIDEO_CLIP_PROVIDER=kling, the deployed default.
export const VIDEO_CLIP_MIN_SECONDS = 3;
export const VIDEO_CLIP_MAX_SECONDS = 15;

// NOTE (2026-08-12): VIDEO_SCRIPT_MAX_SECONDS is DELETED. Ready-script mode had
// a two-minute ceiling — eight clips at 15 seconds each — which was the note
// lane's scene limit leaking onto a lane that has no reason to obey it. A ready
// script's length is the officer's decision, so the scene count is now derived
// from how long the narration speaks and nothing rejects a long one. The spend
// guard is unchanged and is where it belongs: gate 2's explicit confirm, priced
// from the real scene count (VIDEO_TIER_PRICE_PER_SECOND_USD). Do not
// reintroduce a duration cap here without a provider fact to point at.

// The officer-selected TOTAL video length per bucket — the narration's budget.
// A soft target: the narrate phase shortens the worst-offending scenes while
// the measured total overruns it by more than VIDEO_TOTAL_FIT_TOLERANCE, then
// delivers whatever it has (a video a few seconds long beats mutilated speech).
export const VIDEO_TOTAL_SECONDS: Readonly<
  Record<VideoDurationBucket, number>
> = {
  short: 30,
  long: 60,
};

// How far the measured narration total may overrun VIDEO_TOTAL_SECONDS before
// the narrate phase spends shorten calls on the longest scenes.
export const VIDEO_TOTAL_FIT_TOLERANCE = 1.15;

// What a scene that busts the 15s clip ceiling is rewritten toward — 1s inside
// the ceiling so ceil() still lands the derived clip at ≤ 15.
export const VIDEO_SCENE_REWRITE_TARGET_SECONDS = 14;

// A scene's clip length in whole seconds. Was the 4|6|8 Veo union; widened to
// Kling's real 3-15 range when durations became audio-derived. Legacy 4/6/8
// rows all pass (WINDOW FREEZE keeps their rendered clips valid).
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
    VIDEO_CLIP_MAX_SECONDS,
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
  const maximum = sceneWeights.length * VIDEO_CLIP_MAX_SECONDS;
  const total = Math.max(minimum, Math.min(maximum, Math.ceil(totalSeconds)));
  const weights = sceneWeights.map((weight) => Math.max(1, weight));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const durations = sceneWeights.map(() => VIDEO_CLIP_MIN_SECONDS);

  for (let remaining = total - minimum; remaining > 0; remaining -= 1) {
    let pick = -1;
    let largestDeficit = Number.NEGATIVE_INFINITY;
    for (const [index, duration] of durations.entries()) {
      if (duration >= VIDEO_CLIP_MAX_SECONDS) continue;
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
// the scene count is ceil(estimateNarrationSeconds(script) / 15) and the words
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

// The hard per-scene ceiling: the LONGEST clip's worth of speech at the
// measured rate (15s × 16.5 ≈ 248 chars). Feeds BOTH the script generator's
// schema (content-engine) and UpdateVideoScriptRequestSchema, so the two can
// never drift apart. A schema ceiling, not a target — the authoring target is
// the TOTAL budget (videoNarrationBudgetChars); this only rejects a single
// line no clip could ever hold, and the real guarantee is downstream anyway:
// the storyboard job measures the actual WAV and shortens what still overruns.
export const VIDEO_NARRATION_MAX_CHARS = Math.round(
  VIDEO_CLIP_MAX_SECONDS * DEFAULT_NARRATION_CHARS_PER_SECOND,
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

// The whole video's narration budget — what the planner and the script writer
// author toward, and what the narrate phase's total-fit pass enforces with
// real measurements. 30s → ~495 chars / ~69 words; 60s → ~990 / ~138.
export function videoNarrationBudgetChars(bucket: VideoDurationBucket): number {
  return Math.round(
    VIDEO_TOTAL_SECONDS[bucket] * DEFAULT_NARRATION_CHARS_PER_SECOND,
  );
}

export function videoNarrationBudgetWords(bucket: VideoDurationBucket): number {
  return Math.round(VIDEO_TOTAL_SECONDS[bucket] * NARRATION_WORDS_PER_SECOND);
}

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
  durationSeconds: VideoSceneDurationSchema,
  status: VideoSceneStatusSchema,
  // Planner's Marathi one-liner: the information this scene must convey.
  beat: z.string().optional(),
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
  heading: z.string().nullable(),
  inputMode: VideoInputModeSchema,
  durationBucket: VideoDurationBucketSchema,
  orientation: VideoOrientationSchema,
  tier: VideoTierSchema,
  title: z.string().nullable(),
  style: z.string().nullable(),
  referenceTitle: z.string().nullable(),
  referenceUrl: z.string().nullable(),
  scenes: z.array(VideoSceneSchema),
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
    heading: z.string().trim().max(200).optional(),
    inputMode: VideoInputModeSchema.default('note'),
    durationBucket: VideoDurationBucketSchema,
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
        durationSeconds: VideoSceneDurationSchema.optional(),
      }),
    )
    // Only a floor. There WAS a VIDEO_SCENE_LIMIT.max ceiling here, which was
    // the note lane's planner range applied to every stored scene list — it
    // would now reject a ready-script project whose narration legitimately
    // needs more than eight clips. The note lane's own ceiling is enforced
    // where it is a product decision (the planner prompt, and the web's
    // add-scene control), not on a save that must be able to store whatever
    // the split produced.
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
// feature exists to accept. Narration keeps its floor and its one-clip ceiling,
// because those are the officer's own words and the model never touches them.
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
        narration: z.string().trim().min(1).max(VIDEO_NARRATION_MAX_CHARS),
        // Optional, and blank is normal: an existing scene sends its current
        // brief so a failed call leaves something in place, while a new one
        // sends nothing at all.
        visualBrief: z.string().trim().optional(),
        endVisualBrief: z.string().trim().optional(),
        keyPoint: z.string().trim().max(VIDEO_KEY_POINT_MAX_CHARS).optional(),
      }),
    )
    .min(VIDEO_SCENE_LIMIT.min),
});
export type ReplanVideoScriptRequest = z.infer<
  typeof ReplanVideoScriptRequestSchema
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
