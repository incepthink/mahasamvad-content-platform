// Persistence for AI explainer-video projects (see
// supabase/migrations/0026_video_projects.sql): a user note → per-scene script
// (gate 1) → storyboard stills (gate 2) → Veo clips stitched into one silent
// MP4 + SRT. Same shape and idioms as dlo-intakes.ts (camelCase rows, patch
// updates set updated_at here); per-scene state lives in the scenes jsonb so
// scene-shape evolution needs no migrations.

import type { SupabaseClient } from '@supabase/supabase-js';

export const VIDEO_PROJECTS_TABLE = 'video_projects';

export type VideoProjectStatus =
  | 'scripting'
  | 'script_ready'
  | 'storyboarding'
  | 'storyboard_ready'
  | 'animating'
  | 'completed'
  | 'failed';
export type VideoProjectStep =
  | 'script'
  | 'stills'
  | 'animate'
  | 'narrate'
  | 'stitch'
  | 'upload'
  | 'done';
export type VideoDurationBucket = 'short' | 'long';
export type VideoOrientation = 'landscape' | 'vertical';
export type VideoTier = 'fast' | 'lite' | 'standard';
export type VideoSceneStatus =
  | 'pending'
  | 'still-rendering'
  | 'still-ready'
  | 'animating'
  | 'done'
  | 'failed';

// One scene's full server-side state, stored inside the scenes jsonb array.
// A clip is persisted here the moment its Veo render lands (with the still
// version it was animated from), so a crashed/retried animate job resumes from
// finished clips instead of re-billing them.
export type VideoSceneEntry = Readonly<{
  narration: string;
  visualBrief: string;
  durationSeconds: 4 | 6 | 8;
  status: VideoSceneStatus;
  // Planner lineage (plan-video-scenes.ts): the Marathi information beat this
  // scene must convey and the English shot/camera hint threaded into the
  // keyframe + Veo prompts. Absent on pre-planner projects.
  beat?: string;
  shotHint?: string;
  stillPath?: string;
  stillVersion?: number;
  clipPath?: string;
  clipVersion?: number;
  // Which stillVersion the clip was animated FROM — the staleness check that
  // decides whether the animate job may skip this scene.
  clipStillVersion?: number;
  // The durationSeconds this clip was RENDERED at. clipIsCurrent also requires
  // it to match the scene's current window (undefined = legacy clip = current),
  // so a window change can never silently desync clip and SRT.
  clipDurationSeconds?: number;
  // Cached Sarvam-TTS narration audio (WAV) for this scene. The staleness key is
  // (narrationAudioText, narrationAudioVoice): the audio is current only when both
  // still match the scene's narration + the active voice, so a re-stitch reuses it
  // without re-billing TTS, and an edited narration / changed voice regenerates it.
  narrationAudioPath?: string;
  narrationAudioVersion?: number;
  narrationAudioText?: string;
  narrationAudioVoice?: string;
  // Measured duration of the cached WAV (RIFF header, at synth time) — what
  // the scene's durationSeconds window was fitted against.
  narrationAudioSeconds?: number;
  // Per-scene (Marathi) failure; does not sink the whole project.
  error?: string;
}>;

// Same additive shape as generations' cost columns (migration 0011).
export type VideoProjectCostBreakdown = Readonly<{
  chatCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  textCostUsd: number;
  imageCount: number;
  imageCostUsd: number;
  videoSeconds: number;
  videoCostUsd: number;
  // Sarvam TTS narration: characters synthesized and their estimated cost.
  ttsCharacters: number;
  ttsCostUsd: number;
}>;

export type VideoProjectRow = Readonly<{
  id: string;
  status: VideoProjectStatus;
  step: VideoProjectStep | null;
  error: string | null;
  note: string;
  heading: string | null;
  durationBucket: VideoDurationBucket;
  orientation: VideoOrientation;
  tier: VideoTier;
  scenes: readonly VideoSceneEntry[];
  title: string | null;
  style: string | null;
  referenceTitle: string | null;
  referenceUrl: string | null;
  videoPath: string | null;
  srtPath: string | null;
  videoVersion: number;
  costUsd: number | null;
  costBreakdown: VideoProjectCostBreakdown | null;
  createdAt: string;
  updatedAt: string;
}>;

type VideoProjectDbRow = {
  id: string;
  status: VideoProjectStatus;
  step: VideoProjectStep | null;
  error: string | null;
  note: string;
  heading: string | null;
  duration_bucket: VideoDurationBucket;
  orientation: VideoOrientation;
  tier: VideoTier;
  scenes: VideoSceneEntry[] | null;
  title: string | null;
  style: string | null;
  reference_title: string | null;
  reference_url: string | null;
  video_path: string | null;
  srt_path: string | null;
  video_version: number;
  cost_usd: number | string | null;
  cost_breakdown: VideoProjectCostBreakdown | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: VideoProjectDbRow): VideoProjectRow {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    error: row.error,
    note: row.note,
    heading: row.heading,
    durationBucket: row.duration_bucket,
    orientation: row.orientation,
    tier: row.tier,
    scenes: row.scenes ?? [],
    title: row.title,
    style: row.style,
    referenceTitle: row.reference_title,
    referenceUrl: row.reference_url,
    videoPath: row.video_path,
    srtPath: row.srt_path,
    videoVersion: row.video_version,
    // numeric comes back as a string from PostgREST.
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    costBreakdown: row.cost_breakdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertVideoProject(
  client: SupabaseClient,
  input: Readonly<{
    note: string;
    heading?: string | undefined;
    durationBucket: VideoDurationBucket;
    orientation: VideoOrientation;
    tier: VideoTier;
  }>,
): Promise<VideoProjectRow> {
  const { data, error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .insert({
      note: input.note,
      heading: input.heading ?? null,
      duration_bucket: input.durationBucket,
      orientation: input.orientation,
      tier: input.tier,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert video project: ${error.message}`);
  }
  return fromDbRow(data as VideoProjectDbRow);
}

// Fields the jobs/routes may update after creation.
export type VideoProjectPatch = Partial<
  Pick<
    VideoProjectRow,
    | 'status'
    | 'step'
    | 'error'
    | 'scenes'
    | 'title'
    | 'style'
    | 'referenceTitle'
    | 'referenceUrl'
    | 'videoPath'
    | 'srtPath'
    | 'videoVersion'
  >
>;

export async function updateVideoProject(
  client: SupabaseClient,
  id: string,
  patch: VideoProjectPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.step !== undefined) row.step = patch.step;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.scenes !== undefined) row.scenes = patch.scenes;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.style !== undefined) row.style = patch.style;
  if (patch.referenceTitle !== undefined)
    row.reference_title = patch.referenceTitle;
  if (patch.referenceUrl !== undefined) row.reference_url = patch.referenceUrl;
  if (patch.videoPath !== undefined) row.video_path = patch.videoPath;
  if (patch.srtPath !== undefined) row.srt_path = patch.srtPath;
  if (patch.videoVersion !== undefined) row.video_version = patch.videoVersion;
  const { error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .update(row)
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to update video project ${id}: ${error.message}`);
  }
}

export async function getVideoProject(
  client: SupabaseClient,
  id: string,
): Promise<VideoProjectRow | null> {
  const { data, error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch video project ${id}: ${error.message}`);
  }
  return data ? fromDbRow(data as VideoProjectDbRow) : null;
}

export async function listVideoProjects(
  client: SupabaseClient,
  limit = 20,
): Promise<VideoProjectRow[]> {
  const { data, error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list video projects: ${error.message}`);
  }
  return (data as VideoProjectDbRow[]).map(fromDbRow);
}

// Any project the create/animate routes must refuse to run beside: the Veo lane
// renders serially (low preview-model rate limits), so one active project at a
// time. DB-backed rather than TasksProvider so the gate survives refreshes.
const ACTIVE_STATUSES: readonly VideoProjectStatus[] = [
  'scripting',
  'storyboarding',
  'animating',
];

export async function findActiveVideoProject(
  client: SupabaseClient,
): Promise<VideoProjectRow | null> {
  const { data, error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .select()
    .in('status', [...ACTIVE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to check active video projects: ${error.message}`);
  }
  return data ? fromDbRow(data as VideoProjectDbRow) : null;
}

export type VideoProjectCostIncrement = Readonly<{
  costUsd: number;
  breakdown: VideoProjectCostBreakdown;
}>;

// Additive cost write, mirroring addGenerationCost: read the current totals and
// add this job's spend, so a project's many jobs (script, stills, animate,
// re-animations) accumulate rather than overwrite. Video jobs are serialized per
// project, so no write-chain is needed here.
export async function addVideoProjectCost(
  client: SupabaseClient,
  id: string,
  increment: VideoProjectCostIncrement,
): Promise<void> {
  const current = await getVideoProject(client, id);
  if (!current) return;
  const previous = current.costBreakdown;
  const breakdown: VideoProjectCostBreakdown = {
    chatCalls: (previous?.chatCalls ?? 0) + increment.breakdown.chatCalls,
    inputTokens: (previous?.inputTokens ?? 0) + increment.breakdown.inputTokens,
    cachedInputTokens:
      (previous?.cachedInputTokens ?? 0) +
      increment.breakdown.cachedInputTokens,
    outputTokens:
      (previous?.outputTokens ?? 0) + increment.breakdown.outputTokens,
    textCostUsd: (previous?.textCostUsd ?? 0) + increment.breakdown.textCostUsd,
    imageCount: (previous?.imageCount ?? 0) + increment.breakdown.imageCount,
    imageCostUsd:
      (previous?.imageCostUsd ?? 0) + increment.breakdown.imageCostUsd,
    videoSeconds:
      (previous?.videoSeconds ?? 0) + increment.breakdown.videoSeconds,
    videoCostUsd:
      (previous?.videoCostUsd ?? 0) + increment.breakdown.videoCostUsd,
    ttsCharacters:
      (previous?.ttsCharacters ?? 0) + increment.breakdown.ttsCharacters,
    ttsCostUsd: (previous?.ttsCostUsd ?? 0) + increment.breakdown.ttsCostUsd,
  };
  const { error } = await client
    .from(VIDEO_PROJECTS_TABLE)
    .update({
      cost_usd: (current.costUsd ?? 0) + increment.costUsd,
      cost_breakdown: breakdown,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    throw new Error(
      `Failed to update video project ${id} cost: ${error.message}`,
    );
  }
}
