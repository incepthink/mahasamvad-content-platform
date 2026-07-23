// In-process job runner for explainer-video projects: per-scene script (gpt-4o),
// storyboard keyframe stills (gpt-image), Veo clip renders, ffmpeg stitch, SRT.
// Sequencing and persistence only — script/prompt/Veo logic lives in
// @dgipr/content-engine and assembly in @dgipr/poster-renderer (same boundary
// as runner.ts, per AGENTS.md).
//
// Job state of record is the video_projects row (status/step/error + per-scene
// status inside the scenes jsonb), so polling clients survive refreshes. The
// in-memory `running` set mirrors runner.ts: double-run guard + restart-orphan
// detection for the detail route.
//
// The animate job is RESUME-AWARE: each scene's clip is uploaded and persisted
// onto the row the moment its Veo render lands (with the still version it was
// animated from), and the render loop skips scenes whose current clip already
// matches their current still. Veo renders are multi-minute and billed per
// second, so a crashed/retried run re-renders only what is actually missing.

import {
  VEO_NEGATIVE_PROMPT,
  buildKeyframePrompt,
  buildVeoMotionPrompt,
  createCostAccumulator,
  generateVeoClip,
  generateVideoScript,
  recordImageCost,
  runInCostScope,
  synthesizeMarathiNarration,
  totalCostUsd,
  ttsSpeaker,
  type ImageQuality,
  type VeoAspectRatio,
  type VeoDurationSeconds,
} from '@dgipr/content-engine';
import {
  assembleSilentVideo,
  cropToAspect,
  generateImage,
  muxNarration,
  wavDurationSeconds,
} from '@dgipr/poster-renderer';
import {
  VIDEOS_BUCKET,
  downloadFile,
  getVideoProject,
  updateVideoProject,
  addVideoProjectCost,
  uploadFile,
  type SupabaseClient,
  type VideoProjectRow,
  type VideoSceneEntry,
} from '@dgipr/database';
import {
  DEFAULT_NARRATION_CHARS_PER_SECOND,
  buildSrt,
  estimateNarrationSeconds,
  fitSceneDurationSeconds,
} from '@dgipr/schemas';

const running = new Set<string>();

export function isVideoJobRunning(id: string): boolean {
  return running.has(id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Same sync rule as runner.ts: used only to attribute the fixed per-render
// still cost; the render size is passed explicitly below.
function imageQuality(): ImageQuality {
  const q = process.env.OPENAI_IMAGE_QUALITY;
  return q === 'high' || q === 'low' ? q : 'medium';
}

// Versioned storage paths in the public videos bucket — CDN-cached, never reuse.
function stillPath(id: string, scene: number, version: number): string {
  return `projects/${id}/scene-${scene}-still-v${version}.png`;
}
function clipStoragePath(id: string, scene: number, version: number): string {
  return `projects/${id}/scene-${scene}-clip-v${version}.mp4`;
}
function videoStoragePath(id: string, version: number): string {
  return `projects/${id}/video-v${version}.mp4`;
}
function srtStoragePath(id: string, version: number): string {
  return `projects/${id}/subtitles-v${version}.srt`;
}
function narrationStoragePath(
  id: string,
  scene: number,
  version: number,
): string {
  return `projects/${id}/scene-${scene}-narration-v${version}.wav`;
}

function aspectOf(row: VideoProjectRow): VeoAspectRatio {
  return row.orientation === 'vertical' ? '9:16' : '16:9';
}

// gpt-image renders 3:2 / 2:3; cropToAspect trims to the Veo aspect afterwards.
function stillRenderSize(row: VideoProjectRow): string {
  return row.orientation === 'vertical' ? '1024x1536' : '1536x1024';
}

// Wrap a job body with the shared bookkeeping: claim the id, run in a cost
// scope, persist an unexpected failure onto the row, always persist the accrued
// cost (additively — a failed job still spent money) and release the id.
// SUCCESS terminal statuses are the job body's own: they differ per job
// (script_ready / storyboard_ready / completed).
function runVideoJob(
  client: SupabaseClient,
  id: string,
  job: () => Promise<void>,
): void {
  running.add(id);
  void (async () => {
    const cost = createCostAccumulator();
    try {
      await runInCostScope(cost, job);
    } catch (error) {
      console.error(`[video ${id}] failed:`, error);
      try {
        await updateVideoProject(client, id, {
          status: 'failed',
          error: errorMessage(error),
        });
      } catch (updateError) {
        console.error(`[video ${id}] could not persist failure:`, updateError);
      }
    } finally {
      try {
        await addVideoProjectCost(client, id, {
          costUsd: totalCostUsd(cost),
          breakdown: {
            chatCalls: cost.chatCalls,
            inputTokens: cost.inputTokens,
            cachedInputTokens: cost.cachedInputTokens,
            outputTokens: cost.outputTokens,
            textCostUsd: cost.textCostUsd,
            imageCount: cost.imageCount,
            imageCostUsd: cost.imageCostUsd,
            videoSeconds: cost.videoSeconds,
            videoCostUsd: cost.videoCostUsd,
            ttsCharacters: cost.ttsCharacters,
            ttsCostUsd: cost.ttsCostUsd,
          },
        });
      } catch (costError) {
        console.error(`[video ${id}] could not persist cost:`, costError);
      }
      running.delete(id);
    }
  })();
}

async function requireProject(
  client: SupabaseClient,
  id: string,
): Promise<VideoProjectRow> {
  const row = await getVideoProject(client, id);
  if (!row) throw new Error(`Video project ${id} not found.`);
  return row;
}

// ---------- gate 1: script ----------

export function startVideoScriptJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'script', error: null });

    const script = await generateVideoScript(row.note, {
      durationBucket: row.durationBucket,
      heading: row.heading ?? undefined,
    });

    // durationSeconds starts at the planner's target and is REFINED by the
    // storyboard job's voice phase, which measures the real narration audio.
    const scenes: VideoSceneEntry[] = script.scenes.map((scene) => ({
      narration: scene.narration,
      visualBrief: scene.visualBrief,
      durationSeconds: scene.targetDurationSeconds,
      status: 'pending',
      beat: scene.beat,
      shotHint: scene.shotHint,
    }));

    await updateVideoProject(client, id, {
      status: 'script_ready',
      step: null,
      error: null,
      title: script.title,
      style: script.style,
      referenceTitle: script.referenceTitle,
      referenceUrl: script.referenceUrl,
      scenes,
    });
  });
}

// ---------- gate 2: storyboard stills ----------

async function renderSceneStill(
  client: SupabaseClient,
  row: VideoProjectRow,
  index: number,
  scene: VideoSceneEntry,
): Promise<VideoSceneEntry> {
  const png = await generateImage(
    buildKeyframePrompt(row.style ?? '', scene.visualBrief, scene.shotHint),
    { size: stillRenderSize(row) },
  );
  recordImageCost('article', imageQuality());
  const cropped = await cropToAspect(png, aspectOf(row));

  const version = (scene.stillVersion ?? 0) + 1;
  const path = stillPath(row.id, index, version);
  await uploadFile(client, VIDEOS_BUCKET, path, cropped, 'image/png');

  // Built explicitly (dlo-runner's probePdfEntry rule) so a re-render drops the
  // previous attempt's error instead of leaving a stale failure on screen. The
  // clip AND narration-audio lineage ride through untouched — redrawing a still
  // must not silently drop a voiced project's narration.
  return {
    narration: scene.narration,
    visualBrief: scene.visualBrief,
    durationSeconds: scene.durationSeconds,
    status: 'still-ready',
    stillPath: path,
    stillVersion: version,
    ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
    ...(scene.shotHint !== undefined ? { shotHint: scene.shotHint } : {}),
    ...(scene.clipPath !== undefined ? { clipPath: scene.clipPath } : {}),
    ...(scene.clipVersion !== undefined
      ? { clipVersion: scene.clipVersion }
      : {}),
    ...(scene.clipStillVersion !== undefined
      ? { clipStillVersion: scene.clipStillVersion }
      : {}),
    ...(scene.clipDurationSeconds !== undefined
      ? { clipDurationSeconds: scene.clipDurationSeconds }
      : {}),
    ...(scene.narrationAudioPath !== undefined
      ? { narrationAudioPath: scene.narrationAudioPath }
      : {}),
    ...(scene.narrationAudioVersion !== undefined
      ? { narrationAudioVersion: scene.narrationAudioVersion }
      : {}),
    ...(scene.narrationAudioText !== undefined
      ? { narrationAudioText: scene.narrationAudioText }
      : {}),
    ...(scene.narrationAudioVoice !== undefined
      ? { narrationAudioVoice: scene.narrationAudioVoice }
      : {}),
    ...(scene.narrationAudioSeconds !== undefined
      ? { narrationAudioSeconds: scene.narrationAudioSeconds }
      : {}),
  };
}

function sarvamKeyPresent(): boolean {
  const key = process.env.SARVAM_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

// Fallback spoken-seconds estimate when narration audio can't be measured
// (no Sarvam key, or a per-scene TTS failure). Env-calibratable because the
// real rate is a property of the bulbul voice, not of this code.
function narrationSecondsFallback(text: string): number {
  const cps = Number(process.env.VIDEO_NARRATION_CHARS_PER_SECOND);
  return estimateNarrationSeconds(
    text,
    Number.isFinite(cps) && cps > 0 ? cps : DEFAULT_NARRATION_CHARS_PER_SECOND,
  );
}

// The TTS-first voice phase (top of the storyboard job): synthesize each
// scene's narration (skipping audio that is already current), MEASURE the real
// spoken duration from the WAV header, and fit the scene's Veo window
// (durationSeconds) to it — so clips stop trailing off into dead air and the
// gate-2 cost estimate prices what will actually be billed.
//
// Rules that keep this safe:
// - WINDOW FREEZE: a scene whose clip is current keeps its window (muxNarration's
//   atempo absorbs small voice drift) — measuring must never silently invalidate
//   a paid Veo clip.
// - Per-scene TTS failure is NON-FATAL: that scene falls back to the char-rate
//   estimate and the project still reaches gate 2 (un-voiced for that scene; the
//   post-completion narrate button repairs it later).
// - No SARVAM_API_KEY: the whole phase degrades to char-rate estimates and the
//   video ships silent, exactly as before the voice-first flow.
async function ensureNarrationAudio(
  client: SupabaseClient,
  id: string,
  scenes: VideoSceneEntry[],
): Promise<void> {
  const haveKey = sarvamKeyPresent();
  if (!haveKey) {
    console.warn(
      `[video ${id}] SARVAM_API_KEY not set — fitting scene windows from the ` +
        'char-rate estimate; the video will render silent.',
    );
  }
  const voice = ttsSpeaker();

  for (const [index, scene] of scenes.entries()) {
    if (haveKey) {
      if (!narrationIsCurrent(scene, voice)) {
        try {
          // synthesizeMarathiNarration records TTS cost against the ambient meter.
          const wav = await synthesizeMarathiNarration(scene.narration, {
            speaker: voice,
          });
          const version = (scene.narrationAudioVersion ?? 0) + 1;
          const path = narrationStoragePath(id, index, version);
          await uploadFile(client, VIDEOS_BUCKET, path, wav, 'audio/wav');
          scenes[index] = {
            ...scene,
            narrationAudioPath: path,
            narrationAudioVersion: version,
            narrationAudioText: scene.narration,
            narrationAudioVoice: voice,
            narrationAudioSeconds: wavDurationSeconds(wav),
          };
        } catch (error) {
          console.warn(
            `[video ${id}] scene ${index + 1} TTS failed (non-fatal):`,
            error,
          );
        }
      } else if (
        scene.narrationAudioSeconds === undefined &&
        scene.narrationAudioPath !== undefined
      ) {
        // Legacy audio synthesized before durations were measured: read the
        // cached WAV instead of re-billing TTS.
        try {
          const wav = await downloadFile(
            client,
            VIDEOS_BUCKET,
            scene.narrationAudioPath,
          );
          scenes[index] = {
            ...scene,
            narrationAudioSeconds: wavDurationSeconds(wav),
          };
        } catch (error) {
          console.warn(
            `[video ${id}] scene ${index + 1} WAV measure failed (non-fatal):`,
            error,
          );
        }
      }
    }

    const current = scenes[index]!;
    if (!clipIsCurrent(current)) {
      const seconds =
        current.narrationAudioSeconds ??
        narrationSecondsFallback(current.narration);
      const fitted = fitSceneDurationSeconds(seconds);
      if (fitted !== current.durationSeconds) {
        scenes[index] = { ...current, durationSeconds: fitted };
      }
    }
    await updateVideoProject(client, id, { scenes });
  }
}

// Voice phase (TTS + measured window fit) first, then a still for every scene
// that lacks a current one (status pending or failed). Per-scene failures stay
// on their scene — the project still reaches storyboard_ready and the card
// offers a per-scene retry — because one flaky image render must not sink the
// other seven.
export function startStoryboardJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'narrate', error: null });

    const scenes = [...row.scenes];
    await ensureNarrationAudio(client, id, scenes);
    await updateVideoProject(client, id, { step: 'stills' });
    for (const [index, scene] of scenes.entries()) {
      if (scene.status !== 'pending' && scene.status !== 'failed') continue;
      scenes[index] = { ...scene, status: 'still-rendering' };
      await updateVideoProject(client, id, { scenes });
      try {
        scenes[index] = await renderSceneStill(client, row, index, scene);
      } catch (error) {
        scenes[index] = {
          ...scene,
          status: 'failed',
          error: `चित्र तयार करता आले नाही: ${errorMessage(error)}`,
        };
      }
      await updateVideoProject(client, id, { scenes });
    }

    await updateVideoProject(client, id, {
      status: 'storyboard_ready',
      step: null,
      error: null,
    });
  });
}

// One scene's still, re-rendered on demand (gate-2 loop, or the post-render fix
// panel). `returnTo` is the idle status the route flipped away from — a
// completed project must come back as completed, with its video untouched.
export function startSceneStillJob(
  client: SupabaseClient,
  id: string,
  index: number,
  returnTo: 'storyboard_ready' | 'completed',
): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    const scene = row.scenes[index];
    if (!scene) throw new Error(`Video project ${id} has no scene ${index}.`);
    await updateVideoProject(client, id, { step: 'stills', error: null });

    const scenes = [...row.scenes];
    scenes[index] = { ...scene, status: 'still-rendering' };
    await updateVideoProject(client, id, { scenes });
    try {
      scenes[index] = await renderSceneStill(client, row, index, scene);
    } catch (error) {
      scenes[index] = {
        ...scene,
        status: 'failed',
        error: `चित्र तयार करता आले नाही: ${errorMessage(error)}`,
      };
    }

    await updateVideoProject(client, id, {
      scenes,
      status: returnTo,
      step: null,
      error: null,
    });
  });
}

// ---------- animate: the spend gate's job ----------

async function renderSceneClip(
  client: SupabaseClient,
  row: VideoProjectRow,
  index: number,
  scene: VideoSceneEntry,
): Promise<VideoSceneEntry> {
  if (!scene.stillPath || scene.stillVersion === undefined) {
    throw new Error(`दृश्य ${index + 1} चे चित्र अजून तयार नाही.`);
  }
  const still = await downloadFile(client, VIDEOS_BUCKET, scene.stillPath);
  const clip = await generateVeoClip({
    prompt: buildVeoMotionPrompt(
      row.style ?? '',
      scene.visualBrief,
      scene.shotHint,
    ),
    imagePng: still,
    aspectRatio: aspectOf(row),
    durationSeconds: scene.durationSeconds as VeoDurationSeconds,
    tier: row.tier,
    negativePrompt: VEO_NEGATIVE_PROMPT,
  });

  const version = (scene.clipVersion ?? 0) + 1;
  const path = clipStoragePath(row.id, index, version);
  await uploadFile(client, VIDEOS_BUCKET, path, clip, 'video/mp4');

  return {
    ...scene,
    status: 'done',
    clipPath: path,
    clipVersion: version,
    clipStillVersion: scene.stillVersion,
    clipDurationSeconds: scene.durationSeconds,
  };
}

// A scene's clip is current when it was animated from the still the user is
// looking at AND at the scene's current window (undefined = pre-measure legacy
// clip = current, so old projects aren't re-billed). Anything else needs a
// render.
function clipIsCurrent(scene: VideoSceneEntry): boolean {
  return (
    scene.clipPath !== undefined &&
    scene.clipStillVersion !== undefined &&
    scene.clipStillVersion === scene.stillVersion &&
    (scene.clipDurationSeconds === undefined ||
      scene.clipDurationSeconds === scene.durationSeconds)
  );
}

// True once every scene carries narration audio — i.e. the project has been
// voiced. Used both to decide whether a (re)stitch should mux the voiceover and
// to surface `voiced` on the detail payload (the route derives it the same way).
function projectIsVoiced(scenes: readonly VideoSceneEntry[]): boolean {
  return (
    scenes.length > 0 &&
    scenes.every((scene) => scene.narrationAudioPath !== undefined)
  );
}

// A scene's narration audio is current when it was synthesized from the scene's
// CURRENT narration text in the CURRENT voice — anything else needs re-synthesis.
function narrationIsCurrent(scene: VideoSceneEntry, voice: string): boolean {
  return (
    scene.narrationAudioPath !== undefined &&
    scene.narrationAudioText === scene.narration &&
    scene.narrationAudioVoice === voice
  );
}

// Stitch every scene's current clip into video-v{n+1}.mp4 + subtitles, and flip
// the row to completed. Shared by the full animate job and the per-scene
// re-animation. If the project is voiced, the cached per-scene narration audio is
// muxed onto the stitched video — so a per-scene re-animate keeps its voiceover
// with no TTS re-billing (audio is cached per scene, unchanged here).
async function stitchAndPersist(
  client: SupabaseClient,
  id: string,
  scenes: readonly VideoSceneEntry[],
): Promise<void> {
  await updateVideoProject(client, id, { step: 'stitch' });
  const clips: Buffer[] = [];
  for (const [index, scene] of scenes.entries()) {
    if (!scene.clipPath) {
      throw new Error(`दृश्य ${index + 1} ची क्लिप तयार नाही.`);
    }
    clips.push(await downloadFile(client, VIDEOS_BUCKET, scene.clipPath));
  }
  const silent = await assembleSilentVideo(clips);

  let video = silent;
  if (projectIsVoiced(scenes)) {
    const segments = await Promise.all(
      scenes.map(async (scene) => ({
        wav: await downloadFile(client, VIDEOS_BUCKET, scene.narrationAudioPath!),
        durationSeconds: scene.durationSeconds,
      })),
    );
    video = await muxNarration(silent, segments);
  }

  const srt = buildSrt(
    scenes.map((scene) => ({
      narration: scene.narration,
      durationSeconds: scene.durationSeconds,
    })),
  );

  await updateVideoProject(client, id, { step: 'upload' });
  const row = await requireProject(client, id);
  const version = row.videoVersion + 1;
  const videoPath = videoStoragePath(id, version);
  const srtPath = srtStoragePath(id, version);
  await uploadFile(client, VIDEOS_BUCKET, videoPath, video, 'video/mp4');
  await uploadFile(
    client,
    VIDEOS_BUCKET,
    srtPath,
    Buffer.from(srt, 'utf8'),
    'application/x-subrip',
  );

  await updateVideoProject(client, id, {
    status: 'completed',
    step: 'done',
    error: null,
    videoPath,
    srtPath,
    videoVersion: version,
  });
}

// Render every scene's clip serially (Veo preview rate limits are low), then
// stitch. A scene's Veo failure STOPS the run — the remaining renders would
// spend real money while the video already cannot stitch — but every clip that
// finished before it is persisted, so the retry re-renders only what's missing.
export function startVideoAnimateJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'animate', error: null });

    const scenes = [...row.scenes];
    for (const [index, scene] of scenes.entries()) {
      if (clipIsCurrent(scene)) {
        if (scene.status !== 'done') {
          scenes[index] = { ...scene, status: 'done' };
          await updateVideoProject(client, id, { scenes });
        }
        continue;
      }
      scenes[index] = { ...scene, status: 'animating' };
      await updateVideoProject(client, id, { scenes });
      try {
        scenes[index] = await renderSceneClip(client, row, index, scene);
      } catch (error) {
        scenes[index] = {
          ...scene,
          status: 'failed',
          error: `दृश्य ${index + 1} चे ॲनिमेशन अयशस्वी: ${errorMessage(error)}`,
        };
        await updateVideoProject(client, id, { scenes });
        throw new Error(
          `दृश्य ${index + 1} चे ॲनिमेशन अयशस्वी झाले. आधी तयार झालेली दृश्ये जतन झाली आहेत — पुन्हा प्रयत्न केल्यास फक्त उरलेली दृश्ये तयार होतील. (${errorMessage(error)})`,
        );
      }
      await updateVideoProject(client, id, { scenes });
    }

    await stitchAndPersist(client, id, scenes);
  });
}

// Post-render fix: re-animate ONE scene from its (possibly re-drawn) still and
// restitch. A render failure marks the scene and returns the project to
// completed — the previous video is untouched and stays playable.
export function startSceneReanimateJob(
  client: SupabaseClient,
  id: string,
  index: number,
): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    const scene = row.scenes[index];
    if (!scene) throw new Error(`Video project ${id} has no scene ${index}.`);
    await updateVideoProject(client, id, { step: 'animate', error: null });

    const scenes = [...row.scenes];
    scenes[index] = { ...scene, status: 'animating' };
    await updateVideoProject(client, id, { scenes });
    try {
      scenes[index] = await renderSceneClip(client, row, index, scene);
    } catch (error) {
      scenes[index] = {
        ...scene,
        status: 'failed',
        error: `दृश्य ${index + 1} चे ॲनिमेशन अयशस्वी: ${errorMessage(error)}`,
      };
      await updateVideoProject(client, id, {
        scenes,
        status: 'completed',
        step: 'done',
      });
      return;
    }
    await updateVideoProject(client, id, { scenes });

    await stitchAndPersist(client, id, scenes);
  });
}

// ---------- narration: Sarvam TTS voiceover on a finished video ----------

// Synthesize each scene's Marathi narration (skipping scenes whose cached audio
// is already current for the chosen voice — so a re-run after a partial failure,
// or a re-narrate with the same voice, costs nothing) and re-stitch WITH audio.
// Runs from a completed project; on success the row returns to completed with a
// narrated video-v{n+1}. Reuses the `animating` status (the route flips it) so no
// migration is needed for a new status value.
export function startNarrationJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'narrate', error: null });

    const voice = ttsSpeaker();
    const scenes = [...row.scenes];
    for (const [index, scene] of scenes.entries()) {
      if (narrationIsCurrent(scene, voice)) continue;
      // synthesizeMarathiNarration records the TTS cost against the ambient meter.
      const wav = await synthesizeMarathiNarration(scene.narration, {
        speaker: voice,
      });
      const version = (scene.narrationAudioVersion ?? 0) + 1;
      const path = narrationStoragePath(id, index, version);
      await uploadFile(client, VIDEOS_BUCKET, path, wav, 'audio/wav');
      // Window stays frozen here (the clip is already rendered and billed);
      // the measured duration is stored for display and future fits only.
      scenes[index] = {
        ...scene,
        narrationAudioPath: path,
        narrationAudioVersion: version,
        narrationAudioText: scene.narration,
        narrationAudioVoice: voice,
        narrationAudioSeconds: wavDurationSeconds(wav),
      };
      await updateVideoProject(client, id, { scenes });
    }

    // Every scene now has current narration audio, so stitchAndPersist muxes it.
    await stitchAndPersist(client, id, scenes);
  });
}
