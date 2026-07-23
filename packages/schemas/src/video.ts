// Request/response schemas + shared helpers for the AI explainer-video API
// (apps/api parsing + apps/web typed fetch wrappers): a user note → per-scene
// Marathi script (gate 1) → storyboard keyframe stills (gate 2) → Veo-animated
// clips stitched into one silent MP4 + SRT.
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

// short = ~15-30s (2-4 scenes), long = ~30-60s (4-8 scenes).
export const VideoDurationBucketSchema = z.enum(['short', 'long']);
export type VideoDurationBucket = z.infer<typeof VideoDurationBucketSchema>;

export const VideoOrientationSchema = z.enum(['landscape', 'vertical']);
export type VideoOrientation = z.infer<typeof VideoOrientationSchema>;

// Veo 3.1 quality tiers (model ids are an API-side concern, env-overridable).
export const VideoTierSchema = z.enum(['fast', 'lite', 'standard']);
export type VideoTier = z.infer<typeof VideoTierSchema>;

// USD per second of rendered video, per tier — the single source of truth for
// both the API's cost metering and the web's pre-spend estimates. Approximate
// public Gemini API prices (fetched 2026-07-22); if Google changes prices, edit
// only this table.
export const VIDEO_TIER_PRICE_PER_SECOND_USD: Readonly<
  Record<VideoTier, number>
> = {
  standard: 0.4,
  fast: 0.15,
  lite: 0.08,
};

// Preferred scene counts per duration bucket. Since the AI planner took over
// scene-count selection this is a PREFERENCE hint fed to the planner prompt,
// not a validation rule — the only hard count rule is VIDEO_SCENE_LIMIT.
export const VIDEO_SCENE_BOUNDS: Readonly<
  Record<VideoDurationBucket, Readonly<{ min: number; max: number }>>
> = {
  short: { min: 2, max: 4 },
  long: { min: 4, max: 8 },
};

// The hard scene-count rule (gate-1 save + the web's add/remove buttons).
// 8 scenes × 8s is the ~1 min ceiling the product accepts.
export const VIDEO_SCENE_LIMIT: Readonly<{ min: number; max: number }> = {
  min: 1,
  max: 8,
};

// A scene's Veo clip length. The storyboard job MEASURES each scene's
// synthesized narration and assigns the smallest window that fits (see
// fitSceneDurationSeconds), so clips no longer trail off into dead air.
export const VideoSceneDurationSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
]);
export type VideoSceneDuration = z.infer<typeof VideoSceneDurationSchema>;

// Narration length cap per scene — the single source for BOTH the script
// generator's schema (content-engine) and UpdateVideoScriptRequestSchema, so
// the two can never drift apart. ~280 chars ≈ 8-9s of spoken Marathi.
export const VIDEO_NARRATION_MAX_CHARS = 280;

// A narration up to 8% over a window is played with an imperceptible atempo
// speed-up rather than jumping to the next (2s bigger, dearer) window.
export const VIDEO_FIT_TEMPO_ALLOWANCE = 1.08;

// Spoken-Marathi rate used ONLY when narration audio cannot be measured
// (no SARVAM_API_KEY, or a per-scene TTS failure): chars of Devanagari per
// second of bulbul speech. Env-overridable via VIDEO_NARRATION_CHARS_PER_SECOND
// (API side); calibrate against real WAVs, not intuition — the original
// "20 words ≈ 8s" guess was ~2× slower than the voice actually speaks.
export const DEFAULT_NARRATION_CHARS_PER_SECOND = 32;

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

// The smallest Veo window (4|6|8s) that holds `seconds` of narration, allowing
// the ≤8% atempo speed-up before jumping a bucket. Anything longer than 8s
// clamps to 8 — muxNarration's atempo (cap 2.0) absorbs the residue.
export function fitSceneDurationSeconds(seconds: number): VideoSceneDuration {
  for (const window of [4, 6, 8] as const) {
    if (seconds <= window * VIDEO_FIT_TEMPO_ALLOWANCE) return window;
  }
  return 8;
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
  // Marathi voiceover text for this scene. Carries the information; the
  // visuals stay text-free (video models garble Devanagari).
  narration: z.string(),
  // English visual description for the keyframe/motion prompts. Generic and
  // symbolic — never a specific person/event the note doesn't name.
  visualBrief: z.string(),
  durationSeconds: VideoSceneDurationSchema,
  status: VideoSceneStatusSchema,
  // Planner's Marathi one-liner: the information this scene must convey.
  beat: z.string().optional(),
  // Planner's English shot/camera direction ("wide establishing shot, slow
  // push-in") — threaded into the keyframe + Veo motion prompts.
  shotHint: z.string().optional(),
  // Measured duration of the scene's synthesized narration WAV, when audio
  // exists — what durationSeconds was fitted against.
  narrationSeconds: z.number().optional(),
  // Public URL of the scene's narration WAV (gate-2 audition).
  narrationAudioUrl: z.string().optional(),
  stillUrl: z.string().optional(),
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

// Same note bounds as CreateGenerationRequestSchema — the note is the sole
// factual source here too.
export const CreateVideoProjectRequestSchema = z.object({
  note: z.string().trim().min(20).max(60_000),
  heading: z.string().trim().max(200).optional(),
  durationBucket: VideoDurationBucketSchema,
  orientation: VideoOrientationSchema,
  tier: VideoTierSchema,
});
export type CreateVideoProjectRequest = z.infer<
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
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1).max(VIDEO_NARRATION_MAX_CHARS),
        visualBrief: z.string().trim().min(1).max(600),
        durationSeconds: VideoSceneDurationSchema.optional(),
      }),
    )
    .min(VIDEO_SCENE_LIMIT.min)
    .max(VIDEO_SCENE_LIMIT.max),
});
export type UpdateVideoScriptRequest = z.infer<
  typeof UpdateVideoScriptRequestSchema
>;

// Per-scene still regeneration; an edited brief rides along so "change the
// description and redraw" is one call.
export const RegenerateStillRequestSchema = z.object({
  visualBrief: z.string().trim().min(1).max(600).optional(),
});
export type RegenerateStillRequest = z.infer<
  typeof RegenerateStillRequestSchema
>;

// ---------- deterministic timing + SRT ----------
//
// Cue boundaries come from the scenes' own durationSeconds (Veo returns exactly
// the requested length), so both the on-page timing list and the downloaded SRT
// are derived from one place and always agree with the stitched video.

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
