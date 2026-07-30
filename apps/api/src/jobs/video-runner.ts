// In-process job runner for explainer-video projects: per-scene script (the video
// tier), storyboard frame PAIRS (a photoreal START frame and an END frame
// EDITED from it, so both live in one shot — rendered through frame-provider.ts,
// Nano Banana by default with gpt-image one env line away), provider clip renders
// (Kling today — SILENT first+last-frame interpolation), ffmpeg stitch, SRT.
// Sequencing and persistence only — script/prompt/provider logic lives in
// @dgipr/content-engine and assembly in @dgipr/poster-renderer (same boundary as
// runner.ts, per AGENTS.md).
//
// AUDIO LEADS, CLIPS FOLLOW: the voice phase joins every reviewed scene slice
// and synthesizes ONE continuous performance. It measures that WAV, assigns
// scene windows beneath it, and later muxes the WAV once across the stitched
// clips. Visual cuts therefore introduce neither silence nor TTS cadence resets.
//
// Job state of record is the video_projects row (status/step/error + per-scene
// status inside the scenes jsonb), so polling clients survive refreshes. The
// in-memory `running` set mirrors runner.ts: double-run guard + restart-orphan
// detection for the detail route.
//
// The animate job is RESUME-AWARE: each scene's clip is uploaded and persisted
// onto the row the moment its render lands (with the still version it was
// animated from), and the render loop skips scenes whose current clip already
// matches their current still. Clip renders are multi-minute and billed per
// second, so a crashed/retried run re-renders only what is actually missing.

import {
  CLIP_NEGATIVE_PROMPT,
  buildClipMotionPrompt,
  buildEndFramePrompt,
  buildKeyframePrompt,
  createCostAccumulator,
  directVideoMotion,
  generateVideoScript,
  planReadyVideoScript,
  renderClip,
  renderFrame,
  runInCostScope,
  shortenContinuousNarration,
  synthesizeMarathiNarration,
  totalCostUsd,
  ttsSpeaker,
  type VeoAspectRatio,
} from '@dgipr/content-engine';
import {
  assembleSilentVideo,
  muxNarration,
  overlayVideoLogo,
  renderCaptionOverlay,
  validateVideoOutput,
  wavDurationSeconds,
  type SceneOverlay,
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
  VIDEO_CLIP_MAX_SECONDS,
  VIDEO_CLIP_MIN_SECONDS,
  VIDEO_TOTAL_FIT_TOLERANCE,
  VIDEO_TOTAL_SECONDS,
  allocateVideoSceneDurations,
  buildSrt,
  estimateNarrationSeconds,
  sceneTimings,
} from '@dgipr/schemas';

const running = new Set<string>();

export function isVideoJobRunning(id: string): boolean {
  return running.has(id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Versioned storage paths in the public videos bucket — CDN-cached, never reuse.
function stillPath(id: string, scene: number, version: number): string {
  return `projects/${id}/scene-${scene}-still-v${version}.png`;
}
function endStillStoragePath(
  id: string,
  scene: number,
  version: number,
): string {
  return `projects/${id}/scene-${scene}-end-still-v${version}.png`;
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
function narrationStoragePath(id: string, version: number): string {
  return `projects/${id}/narration-v${version}.wav`;
}

function aspectOf(row: VideoProjectRow): VeoAspectRatio {
  return row.orientation === 'vertical' ? '9:16' : '16:9';
}

type VersionedAsset = { path: string; data: Buffer; contentType: string };

const MAX_VERSION_PROBES = 25;

function isAlreadyExistsError(error: unknown): boolean {
  return /already exists|duplicate/i.test(errorMessage(error));
}

// Every versioned asset is uploaded BEFORE the row that records its version, so
// any failure in between (an end-frame render, the logo overlay, a crash, an
// aborted request) leaves an ORPHAN at the next version — and the retry then
// computes the same version and dies on `The resource already exists`, which is
// how a storyboard redraw could get permanently stuck. The orphan was never
// written to the row and therefore never served to anyone, so stepping past it
// is safe; overwriting its path is not (the videos bucket is public and
// CDN-cached — see the versioned-path rule above). So probe upward instead.
// The callback rebuilds every path for a version because some writes are a set
// (the video and its .srt share one version and must land together).
async function uploadVersioned(
  client: SupabaseClient,
  firstVersion: number,
  build: (version: number) => VersionedAsset[],
): Promise<number> {
  let version = firstVersion;
  for (let probe = 0; probe < MAX_VERSION_PROBES; probe += 1) {
    try {
      for (const asset of build(version)) {
        await uploadFile(
          client,
          VIDEOS_BUCKET,
          asset.path,
          asset.data,
          asset.contentType,
        );
      }
      return version;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      console.warn(
        `[video] storage already holds v${version} from an earlier failed ` +
          `attempt; writing v${version + 1} instead.`,
      );
      version += 1;
    }
  }
  throw new Error(
    `Could not find a free storage version after ${MAX_VERSION_PROBES} ` +
      `attempts from v${firstVersion}.`,
  );
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
  options: Readonly<{ failureStatus?: 'failed' | 'completed' }> = {},
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
          status: options.failureStatus ?? 'failed',
          ...(options.failureStatus === 'completed' ? { step: 'done' } : {}),
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

    const script =
      row.inputMode === 'script'
        ? await planReadyVideoScript(row.note, {
            heading: row.heading ?? undefined,
          })
        : await generateVideoScript(row.note, {
            durationBucket: row.durationBucket,
            heading: row.heading ?? undefined,
          });

    // The provisional visual timeline the script writer saw. The continuous
    // voice phase measures the real WAV and extends the total only if needed.
    const scenes: VideoSceneEntry[] = script.scenes.map((scene) => ({
      narration: scene.narration,
      visualBrief: scene.visualBrief,
      ...(scene.endVisualBrief !== undefined
        ? { endVisualBrief: scene.endVisualBrief }
        : {}),
      keyPoint: scene.keyPoint,
      durationSeconds: scene.plannedDurationSeconds,
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

// Edit the start frame into the scene's END frame. Editing rather than
// generating fresh is what keeps both frames inside ONE shot — same location,
// people, light — which is what makes the provider's interpolation read as
// motion within the scene instead of a crossfade between two places.
//
// Which model does the editing is frame-provider.ts's business
// (VIDEO_IMAGE_PROVIDER); it returns a frame already at the video's aspect and
// meters its own cost.
async function renderEndFrame(
  row: VideoProjectRow,
  scene: VideoSceneEntry,
  startPng: Buffer,
  endVisualBrief: string,
): Promise<Buffer> {
  return renderFrame({
    prompt: buildEndFramePrompt(
      row.style ?? '',
      endVisualBrief,
      scene.shotHint,
    ),
    aspect: aspectOf(row),
    sourceFramePng: startPng,
  });
}

// Scene 1's approved start frame, attached to every LATER scene's generation so
// the video reads as one production. The shared `style` paragraph was the only
// cross-scene mechanism before this, and words alone let four scenes come back
// as four unrelated worlds — different country, different people, different
// film stock. An image pins what a paragraph cannot.
//
// Best-effort by design: scene 1 itself is the reference (nothing to attach), a
// lone per-scene redraw before scene 1 has rendered finds nothing, and a failed
// download must not cost a storyboard. All three degrade to the old behaviour.
async function loadWorldReference(
  client: SupabaseClient,
  row: VideoProjectRow,
  index: number,
  scenes: readonly VideoSceneEntry[],
): Promise<Buffer | undefined> {
  if (index === 0) return undefined;
  const first = scenes[0];
  if (!first?.stillPath) return undefined;
  try {
    return await downloadFile(client, VIDEOS_BUCKET, first.stillPath);
  } catch (error) {
    console.warn(
      `[video] scene ${index + 1}: could not load scene 1's frame as a world ` +
        `reference (${errorMessage(error)}); rendering from the style ` +
        'paragraph alone.',
    );
    return undefined;
  }
}

// Renders one scene's reviewed frames.
// - 'pair': a fresh START frame, then the END frame edited from it (when the
//   scene has an endVisualBrief — legacy scenes without one stay single-frame).
//   A start redraw therefore ALWAYS refreshes the end frame too: the end
//   derives from the start, and an end frame edited from a start nobody sees
//   any more would be reviewing a ghost.
// - 'end': re-edit only the end frame from the CURRENT start (the cheap half
//   of the redraw loop — one image call, the start untouched).
async function renderSceneFrames(
  client: SupabaseClient,
  row: VideoProjectRow,
  index: number,
  scene: VideoSceneEntry,
  which: 'pair' | 'end',
  scenes: readonly VideoSceneEntry[],
): Promise<VideoSceneEntry> {
  let startPath = scene.stillPath;
  let startVersion = scene.stillVersion;
  let startPng: Buffer;

  if (which === 'pair') {
    const worldReference = await loadWorldReference(client, row, index, scenes);
    const rendered = await renderFrame({
      prompt: buildKeyframePrompt(
        row.style ?? '',
        scene.openingVisualBrief ?? scene.visualBrief,
        scene.shotHint,
        worldReference !== undefined,
      ),
      aspect: aspectOf(row),
      ...(worldReference ? { referenceFramePng: worldReference } : {}),
    });
    startPng = rendered;
    startVersion = await uploadVersioned(
      client,
      (scene.stillVersion ?? 0) + 1,
      (version) => [
        {
          path: stillPath(row.id, index, version),
          data: rendered,
          contentType: 'image/png',
        },
      ],
    );
    startPath = stillPath(row.id, index, startVersion);
  } else {
    if (!scene.stillPath) {
      throw new Error(`दृश्य ${index + 1} चे प्रारंभ चित्र अजून तयार नाही.`);
    }
    startPng = await downloadFile(client, VIDEOS_BUCKET, scene.stillPath);
  }

  let endPath: string | undefined;
  let endVersion: number | undefined;
  if (scene.endVisualBrief !== undefined && scene.endVisualBrief !== '') {
    const croppedEnd = await renderEndFrame(
      row,
      scene,
      startPng,
      scene.endVisualBrief,
    );
    endVersion = await uploadVersioned(
      client,
      (scene.endStillVersion ?? 0) + 1,
      (version) => [
        {
          path: endStillStoragePath(row.id, index, version),
          data: croppedEnd,
          contentType: 'image/png',
        },
      ],
    );
    endPath = endStillStoragePath(row.id, index, endVersion);
  } else if (which === 'end') {
    throw new Error(`दृश्य ${index + 1} ला अंतिम फ्रेमचे वर्णन नाही.`);
  }

  // Built explicitly (dlo-runner's probePdfEntry rule) so a re-render drops the
  // previous attempt's error instead of leaving a stale failure on screen. The
  // clip AND narration-audio lineage ride through untouched — redrawing a frame
  // must not silently drop a voiced project's narration; clip staleness is
  // clipIsCurrent's job (it compares both frames' versions).
  return {
    narration: scene.narration,
    visualBrief: scene.visualBrief,
    ...(scene.openingVisualBrief !== undefined
      ? { openingVisualBrief: scene.openingVisualBrief }
      : {}),
    ...(scene.motionBrief !== undefined
      ? { motionBrief: scene.motionBrief }
      : {}),
    ...(scene.endVisualBrief !== undefined
      ? { endVisualBrief: scene.endVisualBrief }
      : {}),
    ...(scene.keyPoint !== undefined ? { keyPoint: scene.keyPoint } : {}),
    durationSeconds: scene.durationSeconds,
    status: 'still-ready',
    ...(startPath !== undefined ? { stillPath: startPath } : {}),
    ...(startVersion !== undefined ? { stillVersion: startVersion } : {}),
    ...(endPath !== undefined ? { endStillPath: endPath } : {}),
    ...(endVersion !== undefined ? { endStillVersion: endVersion } : {}),
    ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
    ...(scene.shotHint !== undefined ? { shotHint: scene.shotHint } : {}),
    ...(scene.clipPath !== undefined ? { clipPath: scene.clipPath } : {}),
    ...(scene.clipVersion !== undefined
      ? { clipVersion: scene.clipVersion }
      : {}),
    ...(scene.clipStillVersion !== undefined
      ? { clipStillVersion: scene.clipStillVersion }
      : {}),
    ...(scene.clipEndStillVersion !== undefined
      ? { clipEndStillVersion: scene.clipEndStillVersion }
      : {}),
    ...(scene.clipDurationSeconds !== undefined
      ? { clipDurationSeconds: scene.clipDurationSeconds }
      : {}),
    ...(scene.clipMotionBrief !== undefined
      ? { clipMotionBrief: scene.clipMotionBrief }
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

// At most two whole-script rewrites. The first cut is proportional to the
// measured overrun; bounding it matters because each attempt is one text call
// plus one TTS call.
const NARRATION_FIT_ATTEMPTS = 2;

type ContinuousNarrationFit = Readonly<{
  ceilingSeconds: number;
  rewriteTargetSeconds: number;
}>;

function continuousNarrationText(
  scenes: readonly Pick<VideoSceneEntry, 'narration'>[],
): string {
  return scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join(' ');
}

// New continuous projects point every scene at the SAME WAV and carry the
// complete joined script as its staleness key. Legacy projects point at one WAV
// per scene and therefore fail this predicate, but remain stitchable below.
function continuousNarrationIsCurrent(
  scenes: readonly VideoSceneEntry[],
  voice: string,
): boolean {
  const path = scenes[0]?.narrationAudioPath;
  if (!path) return false;
  const text = continuousNarrationText(scenes);
  return scenes.every(
    (scene) =>
      scene.narrationAudioPath === path &&
      scene.narrationAudioText === text &&
      scene.narrationAudioVoice === voice,
  );
}

function narrationWeights(
  scenes: readonly Pick<VideoSceneEntry, 'narration'>[],
): number[] {
  return scenes.map((scene) => Math.max(1, scene.narration.trim().length));
}

async function synthesizeFittedContinuousNarration(
  scenes: readonly VideoSceneEntry[],
  voice: string,
  logPrefix: string,
  fit: ContinuousNarrationFit,
  preserveWords: boolean,
): Promise<{
  narrations: string[];
  wav: Buffer;
  seconds: number;
}> {
  let current = scenes.map((scene) => scene.narration.trim());
  let wav = await synthesizeMarathiNarration(current.join(' '), {
    speaker: voice,
  });
  let seconds = wavDurationSeconds(wav);

  for (
    let attempt = 1;
    !preserveWords && attempt <= NARRATION_FIT_ATTEMPTS;
    attempt++
  ) {
    if (seconds <= fit.ceilingSeconds) break;
    const shorter = await shortenContinuousNarration(
      scenes.map((scene, index) => ({
        narration: current[index]!,
        ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
      })),
      {
        measuredSeconds: seconds,
        targetSeconds: fit.rewriteTargetSeconds,
      },
    );
    if (shorter === null) break;
    const retryWav = await synthesizeMarathiNarration(shorter.join(' '), {
      speaker: voice,
    });
    const retrySeconds = wavDurationSeconds(retryWav);
    console.log(
      `${logPrefix} continuous narration ${seconds.toFixed(2)}s → ${retrySeconds.toFixed(2)}s ` +
        `(attempt ${attempt}/${NARRATION_FIT_ATTEMPTS}, ceiling ${fit.ceilingSeconds}s)`,
    );
    if (retrySeconds >= seconds) break;
    current = shorter;
    wav = retryWav;
    seconds = retrySeconds;
  }

  if (seconds > fit.ceilingSeconds) {
    if (preserveWords) {
      throw new Error(
        `तयार निवेदनाचा प्रत्यक्ष आवाज ${seconds.toFixed(1)} सेकंदांचा आहे आणि उपलब्ध ${fit.ceilingSeconds.toFixed(0)} सेकंदांच्या दृश्य-वेळेपेक्षा मोठा आहे. निवेदन लहान करून नवीन प्रकल्प तयार करा.`,
      );
    }
    console.warn(
      `${logPrefix} continuous narration is still ${seconds.toFixed(2)}s after shortening ` +
        `(ceiling ${fit.ceilingSeconds}s) — the mux may speed it up slightly.`,
    );
  }
  return { narrations: current, wav, seconds };
}

async function storeContinuousNarration(
  client: SupabaseClient,
  id: string,
  scenes: VideoSceneEntry[],
  voice: string,
  fit: ContinuousNarrationFit,
  totalWindowSeconds: number,
  freezeWindows: boolean,
  preserveWords: boolean,
): Promise<void> {
  const fitted = await synthesizeFittedContinuousNarration(
    scenes,
    voice,
    `[video ${id}]`,
    fit,
    preserveWords,
  );
  const version = await uploadVersioned(
    client,
    Math.max(0, ...scenes.map((scene) => scene.narrationAudioVersion ?? 0)) + 1,
    (candidate) => [
      {
        path: narrationStoragePath(id, candidate),
        data: fitted.wav,
        contentType: 'audio/wav',
      },
    ],
  );
  const path = narrationStoragePath(id, version);
  const joinedText = fitted.narrations.join(' ');
  const weights = narrationWeights(
    fitted.narrations.map((narration) => ({ narration })),
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const durations = freezeWindows
    ? scenes.map((scene) => scene.durationSeconds)
    : allocateVideoSceneDurations(
        scenes.map((scene) => scene.durationSeconds),
        Math.max(totalWindowSeconds, fitted.seconds),
      );

  for (const [index, scene] of scenes.entries()) {
    scenes[index] = {
      ...scene,
      narration: fitted.narrations[index]!,
      durationSeconds: durations[index]!,
      narrationAudioPath: path,
      narrationAudioVersion: version,
      narrationAudioText: joinedText,
      narrationAudioVoice: voice,
      // An informational share of the continuous WAV, used by the review UI.
      // It is not a separately synthesized segment and introduces no pause.
      narrationAudioSeconds: (fitted.seconds * weights[index]!) / weightTotal,
    };
  }
}

// Voice-first, but now as ONE performance: write/synthesize the concatenated
// narration, measure it once, then lay the visual cuts beneath that WAV. Scene
// entries remain useful at both review gates, but they never create TTS starts,
// audio padding or silence between clips.
async function ensureNarrationAudio(
  client: SupabaseClient,
  id: string,
  scenes: VideoSceneEntry[],
  totalTarget: number,
  preserveWords: boolean,
): Promise<void> {
  const haveKey = sarvamKeyPresent();
  const voice = ttsSpeaker();
  const freezeWindows = scenes.some((scene) => clipIsCurrent(scene));
  const frozenTotal = scenes.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0,
  );
  const providerCapacity = scenes.length * VIDEO_CLIP_MAX_SECONDS;
  const desiredTotal = freezeWindows ? frozenTotal : totalTarget;

  if (!haveKey) {
    console.warn(
      `[video ${id}] SARVAM_API_KEY not set — the video will render silent.`,
    );
    if (!freezeWindows) {
      const estimated = estimateNarrationSeconds(
        continuousNarrationText(scenes),
      );
      const durations = allocateVideoSceneDurations(
        scenes.map((scene) => scene.durationSeconds),
        Math.max(totalTarget, estimated),
      );
      for (const [index, scene] of scenes.entries()) {
        scenes[index] = { ...scene, durationSeconds: durations[index]! };
      }
      await updateVideoProject(client, id, { scenes });
    }
    return;
  }
  if (continuousNarrationIsCurrent(scenes, voice)) return;

  const ceiling = preserveWords
    ? providerCapacity
    : Math.min(
        providerCapacity,
        freezeWindows ? frozenTotal : totalTarget * VIDEO_TOTAL_FIT_TOLERANCE,
      );
  try {
    await storeContinuousNarration(
      client,
      id,
      scenes,
      voice,
      {
        ceilingSeconds: ceiling,
        rewriteTargetSeconds: Math.max(
          VIDEO_CLIP_MIN_SECONDS,
          Math.min(desiredTotal, ceiling - 0.5),
        ),
      },
      preserveWords ? 0 : desiredTotal,
      freezeWindows,
      preserveWords,
    );
  } catch (error) {
    if (preserveWords) throw error;
    console.warn(
      `[video ${id}] continuous TTS failed (non-fatal); the video will render silent:`,
      error,
    );
    if (!freezeWindows) {
      const durations = allocateVideoSceneDurations(
        scenes.map((scene) => scene.durationSeconds),
        Math.max(
          totalTarget,
          estimateNarrationSeconds(continuousNarrationText(scenes)),
        ),
      );
      for (const [index, scene] of scenes.entries()) {
        scenes[index] = { ...scene, durationSeconds: durations[index]! };
      }
    }
  }
  await updateVideoProject(client, id, { scenes });
}

// The planner supplies the idea; this pass supplies the performance. It runs
// only after TTS has fixed the real clip durations, and only for scenes that do
// not already carry direction so storyboard retries never rewrite or re-bill
// successful work.
async function ensureMotionDirection(
  client: SupabaseClient,
  id: string,
  row: VideoProjectRow,
  scenes: VideoSceneEntry[],
): Promise<void> {
  const missing = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(
      ({ scene }) =>
        !scene.openingVisualBrief?.trim() || !scene.motionBrief?.trim(),
    );
  if (missing.length === 0) return;

  const directions = await directVideoMotion({
    title: row.title,
    style: row.style,
    scenes: missing.map(({ scene }) => ({
      narration: scene.narration,
      ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
      visualBrief: scene.visualBrief,
      ...(scene.endVisualBrief !== undefined
        ? { endVisualBrief: scene.endVisualBrief }
        : {}),
      ...(scene.shotHint !== undefined ? { shotHint: scene.shotHint } : {}),
      durationSeconds: scene.durationSeconds,
    })),
  });

  for (const [directionIndex, { index }] of missing.entries()) {
    const direction = directions[directionIndex];
    if (!direction) {
      throw new Error(`Motion direction missing for scene ${index + 1}.`);
    }
    scenes[index] = {
      ...scenes[index]!,
      openingVisualBrief: direction.openingVisualBrief,
      motionBrief: direction.motionBrief,
      shotHint: direction.shotHint,
    };
  }
  await updateVideoProject(client, id, { scenes });
}

// True once a scene's declared frames actually exist in storage. This — not the
// scene's status — is what decides whether the storyboard job needs to draw
// anything, because `failed` is set by the ANIMATE job too: a Veo failure leaves
// perfectly good frames on the scene, and keying off status meant that pressing
// "स्टोरीबोर्ड तयार करा" after a failed animate silently re-billed two image
// calls per scene and bumped stillVersion to redraw what was already there.
// An explicit redraw still goes through startSceneStillJob, which is unchanged.
function framesArePresent(scene: VideoSceneEntry): boolean {
  const wantsEndFrame =
    scene.endVisualBrief !== undefined && scene.endVisualBrief !== '';
  return (
    scene.stillPath !== undefined &&
    (!wantsEndFrame || scene.endStillPath !== undefined)
  );
}

// Drop a stale per-scene error without writing `error: undefined`, which
// exactOptionalPropertyTypes rejects on an `error?: string` field.
function withoutError(scene: VideoSceneEntry): VideoSceneEntry {
  const { error: _previous, ...rest } = scene;
  void _previous;
  return rest;
}

// Voice phase (TTS + window pinning) first, then a frame PAIR for every scene
// whose frames are actually missing. Per-scene failures stay on their scene —
// the project still reaches storyboard_ready and the card offers a per-scene
// retry — because one flaky image render must not sink the other seven.
export function startStoryboardJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'narrate', error: null });

    const scenes = [...row.scenes];
    await ensureNarrationAudio(
      client,
      id,
      scenes,
      row.inputMode === 'script'
        ? estimateNarrationSeconds(continuousNarrationText(scenes))
        : VIDEO_TOTAL_SECONDS[row.durationBucket],
      row.inputMode === 'script',
    );
    await updateVideoProject(client, id, { step: 'stills' });
    await ensureMotionDirection(client, id, row, scenes);
    for (const [index, scene] of scenes.entries()) {
      if (framesArePresent(scene)) {
        // Frames survived whatever failed last time: adopt them rather than
        // re-buying them, so the run can move straight on to animate.
        if (scene.status !== 'still-ready' && scene.status !== 'done') {
          scenes[index] = { ...withoutError(scene), status: 'still-ready' };
          await updateVideoProject(client, id, { scenes });
        }
        continue;
      }
      scenes[index] = { ...scene, status: 'still-rendering' };
      await updateVideoProject(client, id, { scenes });
      try {
        scenes[index] = await renderSceneFrames(
          client,
          row,
          index,
          scene,
          'pair',
          scenes,
        );
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
// `frame` picks the redraw: 'start' regenerates the whole pair (the end frame
// is edited FROM the start, so a new start orphans the old end); 'end' only
// re-edits the end frame from the current start (one image call).
export function startSceneStillJob(
  client: SupabaseClient,
  id: string,
  index: number,
  returnTo: 'storyboard_ready' | 'completed',
  frame: 'start' | 'end' = 'start',
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
      scenes[index] = await renderSceneFrames(
        client,
        row,
        index,
        scene,
        frame === 'start' ? 'pair' : 'end',
        scenes,
      );
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
  // The end frame drives first+last interpolation. A legacy scene without one
  // (or one whose provider/model rejects the capability — the provider logs
  // and drops it) animates from the start frame alone.
  const endStill = scene.endStillPath
    ? await downloadFile(client, VIDEOS_BUCKET, scene.endStillPath)
    : undefined;
  const rawClip = await renderClip({
    prompt: buildClipMotionPrompt(
      row.style ?? '',
      scene.openingVisualBrief ?? scene.visualBrief,
      scene.shotHint,
      scene.endVisualBrief,
      scene.motionBrief,
    ),
    startFramePng: still,
    ...(endStill ? { endFramePng: endStill } : {}),
    aspectRatio: aspectOf(row),
    // Assigned from this slice's share of the continuous narration timeline.
    // Each provider enforces its real bounds (Kling 3-15, Veo 4|6|8).
    durationSeconds: scene.durationSeconds,
    tier: row.tier,
    // Veo takes this as its negativePrompt field; Kling, which has none, folds
    // it into the prompt text. Either way the caller just supplies the list.
    negativePrompt: CLIP_NEGATIVE_PROMPT,
  });
  const clip = await overlayVideoLogo(rawClip, {
    aspectRatio: aspectOf(row),
    expectedDurationSeconds: scene.durationSeconds,
  });

  const version = await uploadVersioned(
    client,
    (scene.clipVersion ?? 0) + 1,
    (candidate) => [
      {
        path: clipStoragePath(row.id, index, candidate),
        data: clip,
        contentType: 'video/mp4',
      },
    ],
  );
  const path = clipStoragePath(row.id, index, version);

  return {
    ...scene,
    status: 'done',
    clipPath: path,
    clipVersion: version,
    clipStillVersion: scene.stillVersion,
    ...(scene.endStillVersion !== undefined
      ? { clipEndStillVersion: scene.endStillVersion }
      : {}),
    clipDurationSeconds: scene.durationSeconds,
    // The direction this clip actually performs. Recorded so a later hand-edit
    // of the motion brief invalidates it (clipIsCurrent) instead of the resume
    // path skipping the scene and shipping the old movement again.
    clipMotionBrief: scene.motionBrief ?? '',
  };
}

// A scene's clip is current when it was animated from BOTH frames the user is
// looking at AND at the scene's current window (undefined = pre-measure legacy
// clip = current, so old projects aren't re-billed; a scene with no end frame
// skips the end check the same way). Anything else needs a render.
function clipIsCurrent(scene: VideoSceneEntry): boolean {
  return (
    scene.clipPath !== undefined &&
    scene.clipStillVersion !== undefined &&
    scene.clipStillVersion === scene.stillVersion &&
    (scene.endStillPath === undefined ||
      scene.clipEndStillVersion === scene.endStillVersion) &&
    (scene.clipDurationSeconds === undefined ||
      scene.clipDurationSeconds === scene.durationSeconds) &&
    // The motion brief has no frame version behind it, so its lineage is the
    // text itself. undefined = untouched legacy clip = current (no re-bill);
    // the motion-save route records what the clip was rendered from as soon as
    // an officer edits the direction, which is what makes the edit take effect.
    (scene.clipMotionBrief === undefined ||
      scene.clipMotionBrief === (scene.motionBrief ?? ''))
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

function sharedContinuousNarrationPath(
  scenes: readonly VideoSceneEntry[],
): string | null {
  const path = scenes[0]?.narrationAudioPath;
  if (!path) return null;
  const text = continuousNarrationText(scenes);
  return scenes.every(
    (scene) =>
      scene.narrationAudioPath === path && scene.narrationAudioText === text,
  )
    ? path
    : null;
}

// One transparent PNG per scene that has a key point, with the window it is
// visible for. Timings come from sceneTimings — the same function the SRT is
// built from — so a caption, its subtitle cue and its footage can never
// disagree about when a scene starts.
//
// Best-effort per scene: a Chromium failure (or a box with no browser
// installed) costs that overlay, never the stitch. The clips are already
// rendered and billed by this point, and a video without a caption is still the
// video the officer approved.
async function buildCaptionOverlays(
  row: VideoProjectRow,
  scenes: readonly VideoSceneEntry[],
): Promise<SceneOverlay[]> {
  const aspect = aspectOf(row);
  const timings = sceneTimings(
    scenes.map((scene) => ({ durationSeconds: scene.durationSeconds })),
  );
  const overlays: SceneOverlay[] = [];
  for (const [index, scene] of scenes.entries()) {
    const keyPoint = scene.keyPoint?.trim();
    if (!keyPoint) continue;
    const timing = timings[index];
    if (!timing) continue;
    try {
      const png = await renderCaptionOverlay(keyPoint, aspect);
      if (!png) continue;
      overlays.push({
        png,
        startSeconds: timing.startSeconds,
        endSeconds: timing.endSeconds,
      });
    } catch (error) {
      console.warn(
        `[video] scene ${index + 1}: could not render the on-screen key point ` +
          `(${errorMessage(error)}); that scene will play without one.`,
      );
    }
  }
  return overlays;
}

// Stitch every scene's current clip into video-v{n+1}.mp4 + subtitles, and flip
// the row to completed. Shared by the full animate job and the per-scene
// re-animation. New projects mux one shared continuous narration WAV; legacy
// projects with one WAV per scene retain the old segmented assembly path.
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
  // Burned in during the stitch's own encode, BEFORE muxNarration — which
  // copies the video stream and only adds audio, so it needs no knowledge of
  // any of this.
  const project = await requireProject(client, id);
  const overlays = await buildCaptionOverlays(project, scenes);
  const voiced = projectIsVoiced(scenes);
  const expectedVideoSeconds = scenes.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0,
  );
  const continuousPath = sharedContinuousNarrationPath(scenes);
  const segments = voiced
    ? continuousPath
      ? [
          {
            wav: await downloadFile(client, VIDEOS_BUCKET, continuousPath),
            durationSeconds: expectedVideoSeconds,
          },
        ]
      : await Promise.all(
          scenes.map(async (scene) => ({
            wav: await downloadFile(
              client,
              VIDEOS_BUCKET,
              scene.narrationAudioPath!,
            ),
            durationSeconds: scene.durationSeconds,
          })),
        )
    : null;

  // Joining is local and free, so retry it once automatically. More
  // importantly, assembleSilentVideo and muxNarration now fully decode and
  // duration-check their outputs; a 0-second/one-frame MP4 can never advance
  // to upload merely because ffmpeg happened to exit 0.
  let video: Buffer | null = null;
  let lastAssemblyError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const silent = await assembleSilentVideo(clips, overlays, {
        aspectRatio: aspectOf(project),
        expectedClipDurations: scenes.map((scene) => scene.durationSeconds),
      });
      const candidate = segments
        ? await muxNarration(silent, segments)
        : silent;
      await validateVideoOutput(candidate, expectedVideoSeconds, {
        requireAudio: segments !== null,
      });
      video = candidate;
      break;
    } catch (error) {
      lastAssemblyError = error;
      if (attempt < 2) {
        console.warn(
          `[video ${id}] assembly attempt ${attempt} failed; retrying once:`,
          error,
        );
      }
    }
  }
  if (!video) {
    throw new Error(
      `Final video assembly failed validation after 2 attempts: ${errorMessage(
        lastAssemblyError,
      )}`,
    );
  }

  const srt = buildSrt(
    scenes.map((scene) => ({
      narration: scene.narration,
      durationSeconds: scene.durationSeconds,
    })),
  );

  await updateVideoProject(client, id, { step: 'upload' });
  const row = await requireProject(client, id);
  const version = await uploadVersioned(
    client,
    row.videoVersion + 1,
    (candidate) => [
      {
        path: videoStoragePath(id, candidate),
        data: video,
        contentType: 'video/mp4',
      },
      {
        path: srtStoragePath(id, candidate),
        data: Buffer.from(srt, 'utf8'),
        contentType: 'application/x-subrip',
      },
    ],
  );
  const videoPath = videoStoragePath(id, version);
  const srtPath = srtStoragePath(id, version);

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
    await ensureMotionDirection(client, id, row, scenes);
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

// Re-run only the free joining/mux/upload stage from the already-persisted
// scene clips and narration. Used by both the completed-page recovery button
// and restart recovery; no clip provider or TTS call is made. The caller picks
// the failure status: preserve `completed` when an older result exists, or
// return to `failed` when this is the first final assembly.
export function startVideoStitchJob(
  client: SupabaseClient,
  id: string,
  failureStatus: 'failed' | 'completed' = 'completed',
): void {
  runVideoJob(
    client,
    id,
    async () => {
      const row = await requireProject(client, id);
      await stitchAndPersist(client, id, row.scenes);
    },
    { failureStatus },
  );
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
    if (!row.scenes[index]) {
      throw new Error(`Video project ${id} has no scene ${index}.`);
    }
    await updateVideoProject(client, id, { step: 'animate', error: null });

    const scenes = [...row.scenes];
    await ensureMotionDirection(client, id, row, scenes);
    const scene = scenes[index]!;
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

// Synthesize the complete Marathi narration as one performance and re-stitch
// with that uninterrupted track. Existing clips keep their paid-for windows;
// if the full voiceover overruns their combined length, the whole script is
// tightened coherently rather than shortening isolated scenes.
// Runs from a completed project; on success the row returns to completed with a
// narrated video-v{n+1}. Reuses the `animating` status (the route flips it) so no
// migration is needed for a new status value.
export function startNarrationJob(client: SupabaseClient, id: string): void {
  runVideoJob(client, id, async () => {
    const row = await requireProject(client, id);
    await updateVideoProject(client, id, { step: 'narrate', error: null });

    const voice = ttsSpeaker();
    const scenes = [...row.scenes];
    if (!continuousNarrationIsCurrent(scenes, voice)) {
      const frozenTotal = scenes.reduce(
        (sum, scene) => sum + scene.durationSeconds,
        0,
      );
      await storeContinuousNarration(
        client,
        id,
        scenes,
        voice,
        {
          ceilingSeconds: frozenTotal,
          rewriteTargetSeconds: Math.max(
            VIDEO_CLIP_MIN_SECONDS,
            frozenTotal - 0.5,
          ),
        },
        frozenTotal,
        true,
        row.inputMode === 'script',
      );
      await updateVideoProject(client, id, { scenes });
    }

    // Every scene now points at the same current WAV; stitchAndPersist detects
    // the shared path and muxes it once.
    await stitchAndPersist(client, id, scenes);
  });
}
