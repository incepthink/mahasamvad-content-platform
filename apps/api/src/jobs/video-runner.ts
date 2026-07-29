// In-process job runner for explainer-video projects: per-scene script (the video
// tier), storyboard frame PAIRS (a photoreal START frame and an END frame
// EDITED from it, so both live in one shot — rendered through frame-provider.ts,
// Nano Banana by default with gpt-image one env line away), provider clip renders
// (Kling today — SILENT first+last-frame interpolation), ffmpeg stitch, SRT.
// Sequencing and persistence only — script/prompt/provider logic lives in
// @dgipr/content-engine and assembly in @dgipr/poster-renderer (same boundary as
// runner.ts, per AGENTS.md).
//
// AUDIO LEADS, CLIPS FOLLOW: the voice phase synthesizes and MEASURES every
// narration first, then DERIVES each scene's clip length from its own speech
// (clipSecondsForNarration). A line is rewritten shorter only when it busts the
// 15s clip ceiling or the project's total-time budget — never to fit a window
// that was chosen for it, and never sped up. See ensureNarrationAudio.
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
  generateVideoScript,
  renderClip,
  renderFrame,
  runInCostScope,
  shortenNarration,
  synthesizeMarathiNarration,
  totalCostUsd,
  ttsSpeaker,
  type VeoAspectRatio,
} from '@dgipr/content-engine';
import {
  assembleSilentVideo,
  muxNarration,
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
  VIDEO_SCENE_REWRITE_TARGET_SECONDS,
  VIDEO_TOTAL_FIT_TOLERANCE,
  VIDEO_TOTAL_SECONDS,
  buildSrt,
  clipSecondsForNarration,
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

    const script = await generateVideoScript(row.note, {
      durationBucket: row.durationBucket,
      heading: row.heading ?? undefined,
    });

    // A PROVISIONAL duration, estimated from the narration's length so gate 1
    // can show a plausible clip length and cost. The storyboard job's voice
    // phase replaces it with one derived from the MEASURED audio.
    const scenes: VideoSceneEntry[] = script.scenes.map((scene) => ({
      narration: scene.narration,
      visualBrief: scene.visualBrief,
      ...(scene.endVisualBrief !== undefined
        ? { endVisualBrief: scene.endVisualBrief }
        : {}),
      keyPoint: scene.keyPoint,
      durationSeconds: clipSecondsForNarration(
        estimateNarrationSeconds(scene.narration),
      ),
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
): Promise<Buffer | undefined> {
  if (index === 0) return undefined;
  const first = row.scenes[0];
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
): Promise<VideoSceneEntry> {
  let startPath = scene.stillPath;
  let startVersion = scene.stillVersion;
  let startPng: Buffer;

  if (which === 'pair') {
    const worldReference = await loadWorldReference(client, row, index);
    startPng = await renderFrame({
      prompt: buildKeyframePrompt(
        row.style ?? '',
        scene.visualBrief,
        scene.shotHint,
        worldReference !== undefined,
      ),
      aspect: aspectOf(row),
      ...(worldReference ? { referenceFramePng: worldReference } : {}),
    });
    startVersion = (scene.stillVersion ?? 0) + 1;
    startPath = stillPath(row.id, index, startVersion);
    await uploadFile(client, VIDEOS_BUCKET, startPath, startPng, 'image/png');
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
    endVersion = (scene.endStillVersion ?? 0) + 1;
    endPath = endStillStoragePath(row.id, index, endVersion);
    await uploadFile(client, VIDEOS_BUCKET, endPath, croppedEnd, 'image/png');
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

// How many times one scene's narration may be rewritten to make it fit. Two is
// enough in practice (the first cut is proportional to the measured overrun),
// and bounding it matters because each attempt is a chat call plus a TTS call.
const NARRATION_FIT_ATTEMPTS = 2;

// How many scenes the TOTAL-budget pass may rewrite. Each is one chat + one TTS
// call (cents), and the total is a soft target — a video running a few seconds
// long is a far better outcome than an unbounded shortening loop.
const TOTAL_FIT_ATTEMPTS = 3;

// What a scene's narration must fit inside, and what to rewrite it toward when
// it does not. The two callers differ: the storyboard voice phase lets the CLIP
// grow to the speech, so its only ceiling is the longest clip Kling renders;
// startNarrationJob runs after the clips are paid for, so each scene's frozen
// window is its ceiling — the old fixed-8s semantics, generalized.
type NarrationFit = Readonly<{
  ceilingSeconds: number;
  rewriteTargetSeconds: number;
}>;

// Synthesize one scene's narration and, if the MEASURED audio overruns the
// caller's ceiling, shorten the line and try again. Returns the (possibly
// rewritten) narration with its audio and duration.
//
// This is the structural half of the no-fast-forward guarantee. The script was
// already written to a budget, but a budget is an estimate: how long a given
// Marathi sentence actually takes depends on the sentence. Only the WAV knows,
// so this measures it and treats a shorter rewrite — not a speed-up — as the
// way to fit. It runs at the TOP of the storyboard job, before a single frame
// or clip is rendered, so a rewrite costs cents and never a paid render.
async function synthesizeFittedNarration(
  narration: string,
  voice: string,
  beat: string | undefined,
  logPrefix: string,
  fit: NarrationFit,
): Promise<{ text: string; wav: Buffer; seconds: number }> {
  let text = narration;
  let wav = await synthesizeMarathiNarration(text, { speaker: voice });
  let seconds = wavDurationSeconds(wav);

  for (let attempt = 1; attempt <= NARRATION_FIT_ATTEMPTS; attempt++) {
    if (seconds <= fit.ceilingSeconds) break;
    const shorter = await shortenNarration(text, {
      measuredSeconds: seconds,
      targetSeconds: fit.rewriteTargetSeconds,
      ...(beat !== undefined ? { beat } : {}),
    });
    // No valid shortening (or the model gave up): keep what we have. The line
    // is slightly long, which the mux can still absorb — losing the scene would
    // be far worse.
    if (shorter === null) break;
    const retryWav = await synthesizeMarathiNarration(shorter, {
      speaker: voice,
    });
    const retrySeconds = wavDurationSeconds(retryWav);
    console.log(
      `${logPrefix} narration ${seconds.toFixed(2)}s → ${retrySeconds.toFixed(2)}s ` +
        `(attempt ${attempt}/${NARRATION_FIT_ATTEMPTS}, ceiling ${fit.ceilingSeconds}s)`,
    );
    // Accept only a genuine improvement: a rewrite that reads faster on paper
    // but slower aloud must not replace a better take.
    if (retrySeconds >= seconds) break;
    text = shorter;
    wav = retryWav;
    seconds = retrySeconds;
  }

  if (seconds > fit.ceilingSeconds) {
    console.warn(
      `${logPrefix} narration still ${seconds.toFixed(2)}s after shortening ` +
        `(ceiling ${fit.ceilingSeconds}s) — the mux may speed it up slightly.`,
    );
  }
  return { text, wav, seconds };
}

// Synthesize + persist one scene's narration audio, returning the updated
// entry. Shared by the voice phase's two shortening passes so the upload,
// version bump and staleness fields are written in exactly one place.
async function storeSceneNarration(
  client: SupabaseClient,
  id: string,
  index: number,
  scene: VideoSceneEntry,
  voice: string,
  fit: NarrationFit,
): Promise<VideoSceneEntry> {
  const fitted = await synthesizeFittedNarration(
    scene.narration,
    voice,
    scene.beat,
    `[video ${id}] scene ${index + 1}`,
    fit,
  );
  const version = (scene.narrationAudioVersion ?? 0) + 1;
  const path = narrationStoragePath(id, index, version);
  await uploadFile(client, VIDEOS_BUCKET, path, fitted.wav, 'audio/wav');
  return {
    ...scene,
    narration: fitted.text,
    narrationAudioPath: path,
    narrationAudioVersion: version,
    narrationAudioText: fitted.text,
    narrationAudioVoice: voice,
    narrationAudioSeconds: fitted.seconds,
  };
}

// A scene's spoken length: measured when audio exists, estimated otherwise.
function narrationSecondsOf(scene: VideoSceneEntry): number {
  return (
    scene.narrationAudioSeconds ?? estimateNarrationSeconds(scene.narration)
  );
}

// What a scene contributes to the finished video's running time. A scene with a
// current clip contributes its FROZEN window regardless of its voice (the clip
// is rendered and paid for); everything else contributes the speech its clip
// will be derived from.
function sceneScreenSeconds(scene: VideoSceneEntry): number {
  return clipIsCurrent(scene)
    ? scene.durationSeconds
    : clipSecondsForNarration(narrationSecondsOf(scene));
}

// Pass B: bring the WHOLE video near its selected total (30s/60s) by rewriting
// the longest scenes, once the per-scene measurements are in.
//
// Only scenes without a current clip are eligible: shortening a frozen scene
// cannot shrink the video (its clip is already rendered at its old window), it
// would only desync that clip from its own narration.
//
// Bounded and best-effort by design — this is a soft target. Every scene
// already fits its OWN clip after pass A, so failing to converge here costs a
// few seconds of running time, not a broken video.
async function fitNarrationToTotal(
  client: SupabaseClient,
  id: string,
  scenes: VideoSceneEntry[],
  totalTarget: number,
  voice: string,
): Promise<void> {
  const budget = totalTarget * VIDEO_TOTAL_FIT_TOLERANCE;
  let total = scenes.reduce((sum, scene) => sum + sceneScreenSeconds(scene), 0);

  for (let attempt = 1; attempt <= TOTAL_FIT_ATTEMPTS; attempt++) {
    if (total <= budget) return;

    // The worst offender: the longest scene we are still allowed to touch.
    let pick = -1;
    for (const [index, scene] of scenes.entries()) {
      if (clipIsCurrent(scene)) continue;
      if (
        pick === -1 ||
        narrationSecondsOf(scene) > narrationSecondsOf(scenes[pick]!)
      ) {
        pick = index;
      }
    }
    if (pick === -1) return; // every scene is frozen — nothing left to shorten.

    const scene = scenes[pick]!;
    const seconds = narrationSecondsOf(scene);
    // Ask this scene for the whole excess, but never below its proportional
    // share of the target — taking it all out of one scene would gut it while
    // the rest stayed long.
    const proportional = seconds * (totalTarget / Math.max(total, 0.1));
    const target = Math.max(
      VIDEO_CLIP_MIN_SECONDS,
      Math.min(seconds - (total - totalTarget), proportional),
    );
    console.log(
      `[video ${id}] total ${total.toFixed(1)}s over the ${totalTarget}s budget — ` +
        `shortening scene ${pick + 1} toward ${target.toFixed(1)}s ` +
        `(attempt ${attempt}/${TOTAL_FIT_ATTEMPTS})`,
    );

    const shorter = await shortenNarration(scene.narration, {
      measuredSeconds: seconds,
      targetSeconds: target,
      ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
    });
    if (shorter === null) return; // no valid rewrite: stop rather than loop.

    try {
      // Re-synthesize through the same helper so the ceiling still applies and
      // the audio/text/version fields stay consistent.
      const updated = await storeSceneNarration(
        client,
        id,
        pick,
        { ...scene, narration: shorter },
        voice,
        {
          ceilingSeconds: VIDEO_CLIP_MAX_SECONDS,
          rewriteTargetSeconds: VIDEO_SCENE_REWRITE_TARGET_SECONDS,
        },
      );
      // Accept only a genuine improvement, the pass-A rule.
      if ((updated.narrationAudioSeconds ?? seconds) >= seconds) return;
      scenes[pick] = updated;
      await updateVideoProject(client, id, { scenes });
    } catch (error) {
      console.warn(
        `[video ${id}] scene ${pick + 1} total-fit TTS failed (non-fatal):`,
        error,
      );
      return;
    }

    total = scenes.reduce((sum, s) => sum + sceneScreenSeconds(s), 0);
  }

  if (total > budget) {
    console.warn(
      `[video ${id}] narration totals ${total.toFixed(1)}s against a ` +
        `${totalTarget}s target after ${TOTAL_FIT_ATTEMPTS} attempts — ` +
        'shipping it long rather than cutting further.',
    );
  }
}

// The TTS-first voice phase (top of the storyboard job), in three passes:
//
//   A. Synthesize each scene's narration (skipping audio that is already
//      current) and MEASURE the real spoken duration from the WAV header,
//      rewriting any line that busts the 15s clip ceiling.
//   B. Bring the whole video near its selected total (30s/60s) by shortening
//      the longest scenes — bounded, best-effort, soft target.
//   C. DERIVE each scene's clip window from its own measured speech.
//
// This is the inversion the whole rework turns on: the window is no longer
// chosen for the narration, it is computed FROM it. Because
// clipSecondsForNarration ceils, the window is never shorter than the speech,
// so muxNarration's atempo cannot fire on a scene derived here.
//
// Rules that keep this safe:
// - WINDOW FREEZE: a scene whose clip is current keeps its window (muxNarration's
//   atempo absorbs small voice drift) — measuring must never silently invalidate
//   a paid clip, including a legacy 4s/6s one.
// - Per-scene TTS failure is NON-FATAL: that scene simply carries no audio yet
//   and the project still reaches gate 2 (un-voiced for that scene; the
//   post-completion narrate button repairs it later).
// - No SARVAM_API_KEY: pass B is skipped (nothing was measured, so a total pass
//   would be guessing), durations derive from the char-rate estimate, and the
//   video ships silent — exactly as before the voice-first flow.
async function ensureNarrationAudio(
  client: SupabaseClient,
  id: string,
  scenes: VideoSceneEntry[],
  totalTarget: number,
): Promise<void> {
  const haveKey = sarvamKeyPresent();
  if (!haveKey) {
    console.warn(
      `[video ${id}] SARVAM_API_KEY not set — the video will render silent.`,
    );
  }
  const voice = ttsSpeaker();

  // Pass A: per-scene synthesis against the clip ceiling.
  for (const [index, scene] of scenes.entries()) {
    if (!haveKey) continue;
    if (!narrationIsCurrent(scene, voice)) {
      try {
        // synthesizeMarathiNarration records TTS cost against the ambient
        // meter. The narration comes back possibly SHORTENED — only if it
        // exceeds what the LONGEST clip could hold, since otherwise the clip
        // simply grows to it. The rewritten text is persisted onto the scene,
        // so the SRT, the gate-2 card and the audio all say the same thing.
        scenes[index] = await storeSceneNarration(
          client,
          id,
          index,
          scene,
          voice,
          {
            ceilingSeconds: VIDEO_CLIP_MAX_SECONDS,
            rewriteTargetSeconds: VIDEO_SCENE_REWRITE_TARGET_SECONDS,
          },
        );
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
    await updateVideoProject(client, id, { scenes });
  }

  // Pass B: the total-time budget, only where there are real measurements.
  if (haveKey) {
    await fitNarrationToTotal(client, id, scenes, totalTarget, voice);
  }

  // Pass C: derive the windows. Frozen scenes keep theirs.
  let changed = false;
  for (const [index, scene] of scenes.entries()) {
    if (clipIsCurrent(scene)) continue;
    const derived = clipSecondsForNarration(narrationSecondsOf(scene));
    if (derived === scene.durationSeconds) continue;
    scenes[index] = { ...scene, durationSeconds: derived };
    changed = true;
  }
  if (changed) await updateVideoProject(client, id, { scenes });
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
      VIDEO_TOTAL_SECONDS[row.durationBucket],
    );
    await updateVideoProject(client, id, { step: 'stills' });
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
  const clip = await renderClip({
    prompt: buildClipMotionPrompt(
      row.style ?? '',
      scene.visualBrief,
      scene.shotHint,
      scene.endVisualBrief,
    ),
    startFramePng: still,
    ...(endStill ? { endFramePng: endStill } : {}),
    aspectRatio: aspectOf(row),
    // Derived from this scene's own measured narration. The seam takes a plain
    // number; each provider enforces its real bounds (Kling 3-15, Veo 4|6|8).
    durationSeconds: scene.durationSeconds,
    tier: row.tier,
    // Veo takes this as its negativePrompt field; Kling, which has none, folds
    // it into the prompt text. Either way the caller just supplies the list.
    negativePrompt: CLIP_NEGATIVE_PROMPT,
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
    ...(scene.endStillVersion !== undefined
      ? { clipEndStillVersion: scene.endStillVersion }
      : {}),
    clipDurationSeconds: scene.durationSeconds,
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
  // Burned in during the stitch's own encode, BEFORE muxNarration — which
  // copies the video stream and only adds audio, so it needs no knowledge of
  // any of this.
  const project = await requireProject(client, id);
  const overlays = await buildCaptionOverlays(project, scenes);
  const voiced = projectIsVoiced(scenes);
  const segments = voiced
    ? await Promise.all(
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
  const expectedVideoSeconds = scenes.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0,
  );
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

// Re-run only the free joining/mux/upload stage from the already-persisted
// scene clips and narration. Used by the completed-page recovery button; no
// clip provider or TTS call is made. On failure the prior completed video stays
// selected and playable, and the row returns to completed with the error.
export function startVideoStitchJob(client: SupabaseClient, id: string): void {
  runVideoJob(
    client,
    id,
    async () => {
      const row = await requireProject(client, id);
      await stitchAndPersist(client, id, row.scenes);
    },
    { failureStatus: 'completed' },
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
      // Same fit-by-shortening rule as the storyboard's voice phase, but here
      // the clips are already rendered and billed, so each scene's window is
      // FROZEN and becomes its own ceiling — the text is the only thing that
      // can move to avoid a sped-up voiceover. (In the storyboard phase the
      // ceiling is the longest clip Kling renders, because the clip is still
      // free to grow.)
      scenes[index] = await storeSceneNarration(
        client,
        id,
        index,
        scene,
        voice,
        {
          ceilingSeconds: scene.durationSeconds,
          rewriteTargetSeconds: Math.max(
            VIDEO_CLIP_MIN_SECONDS,
            scene.durationSeconds - 0.5,
          ),
        },
      );
      await updateVideoProject(client, id, { scenes });
    }

    // Every scene now has current narration audio, so stitchAndPersist muxes it.
    await stitchAndPersist(client, id, scenes);
  });
}
