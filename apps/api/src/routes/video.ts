// Explainer-video API routes. Thin handlers only (per AGENTS.md): parse the
// request, persist rows via @dgipr/database, and hand the real work to
// jobs/video-runner. The two user gates (script review, storyboard approval)
// are idle statuses; the routes that leave a gate flip the row into a working
// status BEFORE their 202 (the DLO reextract rule — the client refreshes the
// instant the 202 lands, and a row still reading an idle status would stop its
// poll and sit there).

import type { FastifyInstance } from 'fastify';

import {
  findActiveVideoProject,
  getVideoProject,
  insertVideoProject,
  publicUrlIn,
  updateVideoProject,
  uploadFile,
  VIDEOS_BUCKET,
  listVideoProjects,
  type SupabaseClient,
  type VideoProjectRow,
  type VideoSceneEntry,
} from '@dgipr/database';
import {
  CreateVideoProjectRequestSchema,
  NARRATION_AUDIO_EXTENSIONS,
  RegenerateStillRequestSchema,
  UPLOAD_FILE_MAX_BYTES,
  UpdateSceneMotionRequestSchema,
  UpdateVideoScriptRequestSchema,
  VIDEO_SCRIPT_MAX_SECONDS,
  allocateVideoSceneDurations,
  clipSecondsForNarration,
  estimateNarrationSeconds,
  narrationAudioMimeForFileName,
  normalizeVideoNarrationScript,
  type VideoProjectDetail,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import { decodeAudioToWav, wavDurationSeconds } from '@dgipr/poster-renderer';
import {
  clipProviderApiKeyEnv,
  frameProviderApiKeyEnv,
  narrationKeyPresent,
  narrationProviderApiKeyEnv,
} from '@dgipr/content-engine';
import {
  isVideoJobRunning,
  startNarrationJob,
  startSceneReanimateJob,
  startSceneStillJob,
  startStoryboardJob,
  startVideoAnimateJob,
  startVideoScriptJob,
  startVideoStitchJob,
  continuousNarrationText,
  narrationIsUploaded,
  type UploadedNarration,
} from '../jobs/video-runner.js';

// Clip rendering needs the configured provider's paid API key; without one the
// animate gate must fail with a setup message BEFORE the row is flipped, not
// mid-job (the twitterCredentialsFromEnv pattern). Returns the missing env
// var's NAME so the message can point at it, or null when all is well.
//
// It asks the seam rather than checking GEMINI_API_KEY directly, because the
// animate step and the storyboard step need different keys: frames are already
// rendered by the time this gate runs (VIDEO_IMAGE_PROVIDER, Gemini by
// default), so under VIDEO_CLIP_PROVIDER=kling a box with no Gemini key
// animates perfectly well.
function clipProviderKeyMissing(): string | null {
  const envName = clipProviderApiKeyEnv();
  if (envName === null) return null;
  const key = process.env[envName];
  return typeof key === 'string' && key.trim() !== '' ? null : envName;
}

// Storyboard stills have their own provider and key, independent of the clip
// provider used later by the animate gate.
function frameProviderKeyMissing(): string | null {
  const envName = frameProviderApiKeyEnv();
  if (envName === null) return null;
  const key = process.env[envName];
  return typeof key === 'string' && key.trim() !== '' ? null : envName;
}

function hasEverySceneClip(row: VideoProjectRow): boolean {
  return (
    row.scenes.length > 0 &&
    row.scenes.every((scene) => scene.clipPath !== undefined)
  );
}

// What a scene's status SHOULD be, read off what it actually has in Storage.
// The project-level orphan check below cannot see a scene left mid-render: a
// still/animate job that died after its "now rendering" write leaves that one
// scene claiming to be working while the row itself is back at an idle status,
// and nothing else ever recomputes it — so its card spins forever and the
// officer is told frames are coming that nobody is rendering.
function settledSceneStatus(
  scene: VideoProjectRow['scenes'][number],
): VideoProjectRow['scenes'][number]['status'] {
  if (scene.clipPath !== undefined) return 'done';
  const wantsEndFrame =
    scene.endVisualBrief !== undefined && scene.endVisualBrief !== '';
  if (
    scene.stillPath !== undefined &&
    (!wantsEndFrame || scene.endStillPath !== undefined)
  ) {
    return 'still-ready';
  }
  return 'pending';
}

// Narration needs the configured TTS provider's key; fail the narrate gate with
// a setup message BEFORE the row is flipped, mirroring clipProviderKeyMissing
// for animate. The seam names the key so an ElevenLabs deployment is not asked
// for a Sarvam one.
const sarvamKeyPresent = narrationKeyPresent;

// A voiceover of a two-minute script is a couple of MB as MP3; the ceiling is
// the shared upload cap the /dlo and /transcribe pickers already enforce, so a
// file the browser accepted can never be refused here.
const NARRATION_MAX_BYTES = UPLOAD_FILE_MAX_BYTES;

type MultipartCreate = Readonly<{
  raw: Record<string, unknown>;
  audio: { data: Buffer; extension: string } | null;
  // A refusal the officer must READ, so it is carried back as a plain Marathi
  // sentence rather than thrown as a ZodError — the shared error handler sends
  // a ZodError's message verbatim, which is a JSON array of issue objects.
  reject: string | null;
}>;

// Collect the create form's fields plus its one optional `narration` file.
// Fields arrive as strings, so the two booleans/enums are left as-is for the
// schema and only `heading` is dropped when empty (an empty string would fail
// nothing but would be stored as a heading nobody typed).
async function readMultipartCreate(request: {
  parts: (options?: {
    limits?: { fileSize?: number; files?: number };
  }) => AsyncIterableIterator<
    | { type: 'field'; fieldname: string; value: unknown }
    | {
        type: 'file';
        fieldname: string;
        filename: string;
        toBuffer: () => Promise<Buffer>;
      }
  >;
}): Promise<MultipartCreate> {
  const raw: Record<string, unknown> = {};
  let audio: { data: Buffer; extension: string } | null = null;
  let reject: string | null = null;
  const parts = request.parts({
    limits: { fileSize: NARRATION_MAX_BYTES, files: 1 },
  });
  for await (const part of parts) {
    if (part.type === 'field') {
      const value = typeof part.value === 'string' ? part.value : '';
      if (part.fieldname === 'heading' && value.trim() === '') continue;
      raw[part.fieldname] = value;
      continue;
    }
    if (part.fieldname !== 'narration') {
      await part.toBuffer();
      continue;
    }
    if (narrationAudioMimeForFileName(part.filename) === null) {
      // Drain the part so busboy is not left mid-stream, then refuse by name —
      // but keep reading, or the remaining fields never arrive.
      await part.toBuffer();
      reject = `ही ध्वनिफीत स्वीकारता येत नाही. ${NARRATION_AUDIO_EXTENSIONS.join(', ')} पैकी एक द्या.`;
      continue;
    }
    const dot = part.filename.lastIndexOf('.');
    audio = {
      data: await part.toBuffer(),
      extension: part.filename.slice(dot).toLowerCase(),
    };
  }
  return { raw, audio, reject };
}

const BUSY_MESSAGE = 'या प्रकल्पावर आधीच काम सुरू आहे.';
const ANOTHER_ACTIVE_MESSAGE =
  'दुसरा व्हिडिओ प्रकल्प सध्या तयार होत आहे. तो पूर्ण झाल्यावर पुन्हा प्रयत्न करा.';

function toDetail(
  client: SupabaseClient,
  row: VideoProjectRow,
): VideoProjectDetail {
  const joinedNarration = row.scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join(' ');
  const sharedNarrationPath = row.scenes[0]?.narrationAudioPath;
  const hasContinuousNarration =
    sharedNarrationPath !== undefined &&
    row.scenes.every(
      (scene) =>
        scene.narrationAudioPath === sharedNarrationPath &&
        scene.narrationAudioText === joinedNarration,
    );
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    error: row.error,
    note: row.note,
    heading: row.heading,
    inputMode: row.inputMode,
    durationBucket: row.durationBucket,
    orientation: row.orientation,
    tier: row.tier,
    title: row.title,
    style: row.style,
    referenceTitle: row.referenceTitle,
    referenceUrl: row.referenceUrl,
    scenes: row.scenes.map((scene, index) => ({
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
      status: scene.status,
      ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
      ...(scene.shotHint !== undefined ? { shotHint: scene.shotHint } : {}),
      ...(scene.narrationAudioSeconds !== undefined
        ? { narrationSeconds: scene.narrationAudioSeconds }
        : {}),
      // A continuous project has one shared WAV. Surface its player once on
      // the first card; legacy projects retain one player per scene.
      ...(scene.narrationAudioPath && (!hasContinuousNarration || index === 0)
        ? {
            narrationAudioUrl: publicUrlIn(
              client,
              VIDEOS_BUCKET,
              scene.narrationAudioPath,
            ),
          }
        : {}),
      ...(scene.stillPath
        ? { stillUrl: publicUrlIn(client, VIDEOS_BUCKET, scene.stillPath) }
        : {}),
      ...(scene.endStillPath
        ? {
            endStillUrl: publicUrlIn(client, VIDEOS_BUCKET, scene.endStillPath),
          }
        : {}),
      ...(scene.clipPath
        ? { clipUrl: publicUrlIn(client, VIDEOS_BUCKET, scene.clipPath) }
        : {}),
      // A clip animated from an older frame (start OR end) — or from an older
      // motion brief — than the one on screen; the fix panel's re-animate
      // affordance keys off this.
      ...(scene.clipPath !== undefined &&
      ((scene.stillVersion !== undefined &&
        scene.clipStillVersion !== scene.stillVersion) ||
        (scene.endStillPath !== undefined &&
          scene.clipEndStillVersion !== scene.endStillVersion) ||
        (scene.clipMotionBrief !== undefined &&
          scene.clipMotionBrief !== (scene.motionBrief ?? '')))
        ? { clipStale: true }
        : {}),
      ...(scene.error !== undefined ? { error: scene.error } : {}),
    })),
    videoUrl: row.videoPath
      ? publicUrlIn(client, VIDEOS_BUCKET, row.videoPath)
      : null,
    srtUrl: row.srtPath
      ? publicUrlIn(client, VIDEOS_BUCKET, row.srtPath)
      : null,
    // Voiced ⇔ every scene carries narration audio (the runner muxes it on the
    // last stitch); voiceSpeaker names the Sarvam voice that was used.
    voiced:
      row.scenes.length > 0 &&
      row.scenes.every((scene) => scene.narrationAudioPath !== undefined),
    voiceSpeaker: row.scenes[0]?.narrationAudioVoice ?? null,
    videoVersion: row.videoVersion,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSummary(
  client: SupabaseClient,
  row: VideoProjectRow,
): VideoProjectSummary {
  return {
    id: row.id,
    status: row.status,
    heading: row.heading,
    title: row.title,
    noteExcerpt: row.note.slice(0, 160),
    orientation: row.orientation,
    tier: row.tier,
    sceneCount: row.scenes.length,
    videoUrl: row.videoPath
      ? publicUrlIn(client, VIDEOS_BUCKET, row.videoPath)
      : null,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  };
}

export function registerVideoRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  // JSON, or multipart when the officer supplies their own narration recording
  // (ready-script mode only). The two forms carry the same fields; multipart
  // adds one `narration` file part.
  app.post('/video/projects', async (request, reply) => {
    const parsed = request.isMultipart()
      ? await readMultipartCreate(request)
      : { raw: request.body, audio: null, reject: null };
    if (parsed.reject) {
      return reply.code(400).send({ error: { message: parsed.reject } });
    }
    const body = CreateVideoProjectRequestSchema.parse({
      ...(parsed.raw as Record<string, unknown>),
      narrationAudioUploaded: parsed.audio !== null,
    });
    // One project in a working status at a time: the Veo lane renders serially
    // (low preview rate limits) and the gate must survive refreshes, so it is
    // DB-backed rather than a TasksProvider-style client gate.
    const active = await findActiveVideoProject(client);
    if (active) {
      return reply
        .code(409)
        .send({ error: { message: ANOTHER_ACTIVE_MESSAGE } });
    }

    // Decode + length-check BEFORE the row exists, so a rejected recording
    // leaves nothing behind and the officer keeps the create form they are
    // standing on. This is also the ONLY duration gate that matters for an
    // uploaded track: the char-rate estimate the schema applies to a typed
    // script is not a worse measurement here, it is the wrong one.
    let narrationWav: Buffer | null = null;
    let narrationSeconds = 0;
    if (parsed.audio) {
      try {
        narrationWav = await decodeAudioToWav(
          parsed.audio.data,
          parsed.audio.extension,
        );
      } catch (error) {
        request.log.error(error);
        return reply.code(400).send({
          error: {
            message:
              'निवेदनाची ध्वनिफीत वाचता आली नाही. दुसऱ्या स्वरूपात (उदा. MP3) पुन्हा द्या.',
          },
        });
      }
      narrationSeconds = wavDurationSeconds(narrationWav);
      if (narrationSeconds > VIDEO_SCRIPT_MAX_SECONDS) {
        return reply.code(400).send({
          error: {
            message:
              `दिलेली ध्वनिफीत ${narrationSeconds.toFixed(0)} सेकंदांची आहे आणि ` +
              `कमाल ${VIDEO_SCRIPT_MAX_SECONDS} सेकंदांच्या मर्यादेपेक्षा मोठी आहे.`,
          },
        });
      }
    }

    const row = await insertVideoProject(client, {
      note: body.note,
      heading: body.heading,
      inputMode: body.inputMode,
      durationBucket: body.durationBucket,
      orientation: body.orientation,
      tier: body.tier,
    });

    // The uploaded track lands where a synthesized one would (narration-v1),
    // so nothing downstream — the voice phase's staleness check, the stitch's
    // shared-path detection, the gate-2 audition player — needs to know which
    // it is looking at.
    let uploaded: UploadedNarration | undefined;
    if (narrationWav) {
      const path = `projects/${row.id}/narration-v1.wav`;
      await uploadFile(client, VIDEOS_BUCKET, path, narrationWav, 'audio/wav');
      uploaded = { path, version: 1, seconds: narrationSeconds };
    }
    startVideoScriptJob(client, row.id, uploaded);
    return reply.code(202).send({ id: row.id });
  });

  app.get('/video/projects', async () => {
    const rows = await listVideoProjects(client);
    return rows.map((row) => toSummary(client, row));
  });

  app.get<{ Params: { id: string } }>(
    '/video/projects/:id',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      // Orphan check, same as the generation detail route: a row stuck in a
      // working status whose job is not in this process died with a previous
      // server. Stitching is fully local and every paid input is already in
      // Storage, so resume that step automatically instead of making the
      // officer retry an animation that has already finished.
      const restartInterruptedStitch =
        row.step === 'stitch' &&
        hasEverySceneClip(row) &&
        ((row.status === 'animating' && !isVideoJobRunning(row.id)) ||
          (row.status === 'failed' &&
            row.error === 'Server restarted while this job was running.'));
      if (restartInterruptedStitch) {
        const resumed = {
          ...row,
          status: 'animating' as const,
          step: 'stitch' as const,
          error: null,
        };
        await updateVideoProject(client, row.id, {
          status: resumed.status,
          step: resumed.step,
          error: resumed.error,
        });
        startVideoStitchJob(
          client,
          row.id,
          row.videoPath ? 'completed' : 'failed',
        );
        return toDetail(client, resumed);
      }
      // Other orphaned work cannot be resumed without knowing exactly which
      // external operation completed, so fail it and expose the normal retry.
      if (
        (row.status === 'scripting' ||
          row.status === 'storyboarding' ||
          row.status === 'animating') &&
        !isVideoJobRunning(row.id)
      ) {
        const error = 'Server restarted while this job was running.';
        await updateVideoProject(client, row.id, { status: 'failed', error });
        return toDetail(client, { ...row, status: 'failed', error });
      }
      // The row is idle and nothing is running here, so no scene can still be
      // mid-render. Settle any that claims to be (an orphaned per-scene still or
      // animate job), from what it actually has — otherwise that card keeps a
      // spinner and a "चित्रे तयार होत आहेत…" label indefinitely. A stale `step`
      // is cleared with it, for the same reason.
      if (
        !isVideoJobRunning(row.id) &&
        row.status !== 'scripting' &&
        row.status !== 'storyboarding' &&
        row.status !== 'animating' &&
        row.scenes.some(
          (scene) =>
            scene.status === 'still-rendering' || scene.status === 'animating',
        )
      ) {
        const scenes = row.scenes.map((scene) =>
          scene.status === 'still-rendering' || scene.status === 'animating'
            ? { ...scene, status: settledSceneStatus(scene) }
            : scene,
        );
        await updateVideoProject(client, row.id, { scenes, step: null });
        return toDetail(client, { ...row, scenes, step: null });
      }
      return toDetail(client, row);
    },
  );

  // Gate 1's save: the reviewed/edited scene list, synchronous (no model call).
  // A scene whose visual brief changed goes back to 'pending' — its still (if
  // any) no longer matches what the user asked for, and animate is blocked
  // until every scene has a current still.
  app.put<{ Params: { id: string } }>(
    '/video/projects/:id/script',
    async (request, reply) => {
      const body = UpdateVideoScriptRequestSchema.parse(request.body);
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (
        (row.status !== 'script_ready' && row.status !== 'storyboard_ready') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      if (row.inputMode === 'script') {
        const submitted = normalizeVideoNarrationScript(
          body.scenes.map((scene) => scene.narration).join(' '),
        );
        const original = normalizeVideoNarrationScript(row.note);
        if (submitted !== original) {
          return reply.code(400).send({
            error: {
              message:
                'तयार संहितेतील निवेदन बदलता येत नाही. दृश्य-वर्णन मात्र संपादित करता येईल.',
            },
          });
        }
      }
      // The officer's edited style/setting paragraph. It is an input to EVERY
      // frame prompt, so changing it makes every rendered frame stale — which
      // matters because this route also accepts storyboard_ready, where frames
      // exist. A changed style therefore skips the keep-frames branch below
      // entirely and sends every scene back to pending.
      const style = body.style ?? row.style;
      const styleChanged = style !== row.style;

      // Scene count is governed by the schema's own VIDEO_SCENE_LIMIT bound
      // (the planner's bucket preference is not a validation rule — the
      // officer at gate 1 knows best). Incoming durationSeconds is IGNORED:
      // windows are server-assigned by the storyboard job's voice phase from
      // the measured narration audio.
      // Reject a payload that claims the same stored scene twice: two cards
      // would inherit ONE scene's frames and clip lineage, and the second
      // animate would then reuse a clip rendered for different narration.
      const claimed = new Set<number>();
      for (const scene of body.scenes) {
        if (scene.sourceIndex === undefined) continue;
        if (claimed.has(scene.sourceIndex)) {
          return reply.code(400).send({
            error: { message: 'एकच दृश्य दोनदा पाठवले आहे.' },
          });
        }
        claimed.add(scene.sourceIndex);
      }

      const scenes: VideoSceneEntry[] = body.scenes.map((incoming, index) => {
        // Identity first, position only as the legacy fallback: an inserted
        // scene shifts every later card, and matching by position would then
        // compare each against its neighbour and discard a storyboard of paid
        // frames. A sourceIndex past the stored array is treated as new.
        const existing =
          incoming.sourceIndex === undefined
            ? row.scenes[index]
            : row.scenes[incoming.sourceIndex];
        // Same BOTH briefs + an existing still ⇒ keep the frames (and their
        // clip lineage); anything else starts over as pending. The end brief
        // counts because the end frame is rendered from it — an edited end
        // brief with a kept frame would show a frame of the old description.
        // The key point is deliberately NOT in this test: it is burned on at
        // stitch time and no frame is rendered from it, so editing one must
        // never throw away a paid frame.
        if (
          !styleChanged &&
          existing &&
          existing.visualBrief === incoming.visualBrief &&
          existing.endVisualBrief === incoming.endVisualBrief &&
          existing.stillPath !== undefined
        ) {
          return {
            ...existing,
            narration: incoming.narration,
            ...(incoming.keyPoint !== undefined
              ? { keyPoint: incoming.keyPoint }
              : {}),
          };
        }
        // A brief changed (or new scene): the frames start over, but the plan
        // lineage and the narration-audio cache ride along — audio depends
        // only on narration text + voice (narrationIsCurrent re-checks), so
        // dropping it here would re-bill TTS for a pure visual edit.
        return {
          narration: incoming.narration,
          visualBrief: incoming.visualBrief,
          ...(incoming.endVisualBrief !== undefined
            ? { endVisualBrief: incoming.endVisualBrief }
            : {}),
          ...(incoming.keyPoint !== undefined
            ? { keyPoint: incoming.keyPoint }
            : existing?.keyPoint !== undefined
              ? { keyPoint: existing.keyPoint }
              : {}),
          // Preserve the timeline the script writer saw. A genuinely new scene
          // gets a provisional text-derived weight; the continuous voice phase
          // normalises all weights back to the selected 30/60-second total.
          durationSeconds:
            existing?.durationSeconds ??
            clipSecondsForNarration(
              estimateNarrationSeconds(incoming.narration),
            ),
          status: 'pending',
          ...(existing?.beat !== undefined ? { beat: existing.beat } : {}),
          ...(existing?.shotHint !== undefined
            ? { shotHint: existing.shotHint }
            : {}),
          ...(existing?.narrationAudioPath !== undefined
            ? { narrationAudioPath: existing.narrationAudioPath }
            : {}),
          ...(existing?.narrationAudioVersion !== undefined
            ? { narrationAudioVersion: existing.narrationAudioVersion }
            : {}),
          ...(existing?.narrationAudioText !== undefined
            ? { narrationAudioText: existing.narrationAudioText }
            : {}),
          ...(existing?.narrationAudioVoice !== undefined
            ? { narrationAudioVoice: existing.narrationAudioVoice }
            : {}),
          ...(existing?.narrationAudioSeconds !== undefined
            ? { narrationAudioSeconds: existing.narrationAudioSeconds }
            : {}),
        };
      });

      // Re-splitting the narration across scenes (the officer moving words into
      // an inserted card) leaves the JOINED script byte-identical, so the
      // measured WAV stays current and the voice phase returns early without
      // touching a thing — including the windows. Those windows are where the
      // visual cuts fall against one continuous narration track, so leaving
      // them alone is a silent de-sync: the picture would cut to the new scene
      // while the donor's sentence is still being spoken. Nothing errors.
      //
      // So the split is re-weighted here, against the SAME measured total. The
      // sum is unchanged, which is what keeps every later cut aligned; only the
      // scenes whose share moved get a new window, and clipIsCurrent then
      // invalidates exactly those clips (it compares clipDurationSeconds) so
      // the next animate re-renders the donor and the newcomer and nothing else.
      const previousJoined = continuousNarrationText(row.scenes);
      const nextJoined = continuousNarrationText(scenes);
      const measuredSeconds = row.scenes.reduce(
        (sum, scene) => sum + (scene.narrationAudioSeconds ?? 0),
        0,
      );
      const splitChanged =
        scenes.length !== row.scenes.length ||
        scenes.some(
          (scene, index) => scene.narration !== row.scenes[index]?.narration,
        );
      if (
        splitChanged &&
        previousJoined === nextJoined &&
        previousJoined !== '' &&
        measuredSeconds > 0
      ) {
        const durations = allocateVideoSceneDurations(
          scenes.map((scene) => Math.max(1, scene.narration.trim().length)),
          measuredSeconds,
        );
        const weightTotal = scenes.reduce(
          (sum, scene) => sum + Math.max(1, scene.narration.trim().length),
          0,
        );
        for (const [index, scene] of scenes.entries()) {
          scenes[index] = {
            ...scene,
            durationSeconds: durations[index]!,
            // The card's "निवेदन X.X से." share. Recomputed with the windows or
            // it would keep quoting the donor's pre-split length.
            narrationAudioSeconds:
              (measuredSeconds * Math.max(1, scene.narration.trim().length)) /
              weightTotal,
          };
        }
      }

      await updateVideoProject(client, row.id, {
        scenes,
        ...(styleChanged ? { style } : {}),
      });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
    },
  );

  // "स्टोरीबोर्ड तयार करा" — renders stills for every pending/failed scene.
  // 'failed' is allowed so a project orphaned mid-storyboard (server restart)
  // has a way back; the job only re-renders scenes without a current still.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/storyboard',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (
        (row.status !== 'script_ready' &&
          row.status !== 'storyboard_ready' &&
          row.status !== 'failed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      if (row.scenes.length === 0) {
        return reply
          .code(409)
          .send({ error: { message: 'आधी संहिता तयार व्हायला हवी.' } });
      }
      const needsFrame = row.scenes.some(
        (scene) =>
          scene.stillPath === undefined ||
          (scene.endVisualBrief !== undefined &&
            scene.endVisualBrief !== '' &&
            scene.endStillPath === undefined),
      );
      const missingKey = needsFrame ? frameProviderKeyMissing() : null;
      if (missingKey) {
        return reply.code(503).send({
          error: {
            message: `चित्र सेवा अजून जोडलेली नाही (${missingKey}). प्रशासकाशी संपर्क साधा.`,
          },
        });
      }
      // Flip BEFORE the 202 (poll-race rule). The job's first phase is the
      // TTS voice-and-measure pass, so the step starts at 'narrate'.
      await updateVideoProject(client, row.id, {
        status: 'storyboarding',
        step: 'narrate',
        error: null,
      });
      startStoryboardJob(client, row.id);
      return reply.code(202).send({ id: row.id });
    },
  );

  // One scene's frame, re-drawn (gate-2 loop or the post-render fix panel).
  // Edited briefs ride along so "change the description and redraw" is one
  // call. frame='start' (default) regenerates the PAIR — the end frame is an
  // edit of the start, so a new start orphans the old end; frame='end'
  // re-edits only the end frame from the current start.
  app.post<{ Params: { id: string; index: string } }>(
    '/video/projects/:id/scenes/:index/still',
    async (request, reply) => {
      const body = RegenerateStillRequestSchema.parse(request.body ?? {});
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      const index = Number(request.params.index);
      const scene = Number.isInteger(index) ? row.scenes[index] : undefined;
      if (!scene) {
        return reply.code(404).send({ error: { message: 'Scene not found.' } });
      }
      if (
        (row.status !== 'storyboard_ready' && row.status !== 'completed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const missingKey = frameProviderKeyMissing();
      if (missingKey) {
        return reply.code(503).send({
          error: {
            message: `चित्र सेवा अजून जोडलेली नाही (${missingKey}). प्रशासकाशी संपर्क साधा.`,
          },
        });
      }
      const frame = body.frame ?? 'start';
      if (frame === 'end' && scene.stillPath === undefined) {
        return reply.code(409).send({
          error: { message: 'आधी प्रारंभ फ्रेम तयार व्हायला हवी.' },
        });
      }

      if (
        body.visualBrief !== undefined ||
        body.openingVisualBrief !== undefined ||
        body.endVisualBrief !== undefined
      ) {
        const scenes = [...row.scenes];
        scenes[index] = {
          ...scene,
          ...(body.visualBrief !== undefined
            ? { visualBrief: body.visualBrief }
            : {}),
          ...(body.openingVisualBrief !== undefined
            ? { openingVisualBrief: body.openingVisualBrief }
            : {}),
          ...(body.endVisualBrief !== undefined
            ? { endVisualBrief: body.endVisualBrief }
            : {}),
        };
        await updateVideoProject(client, row.id, { scenes });
      }
      const returnTo = row.status as 'storyboard_ready' | 'completed';
      await updateVideoProject(client, row.id, {
        status: 'storyboarding',
        step: 'stills',
        error: null,
      });
      startSceneStillJob(client, row.id, index, returnTo, frame);
      return reply.code(202).send({ id: row.id });
    },
  );

  // One scene's motion direction, hand-edited. Synchronous and free: the
  // motion brief is an input to the CLIP prompt only (buildClipMotionPrompt) —
  // no frame is rendered from it — so unlike a changed visual brief this does
  // NOT send the scene back to pending or orphan a rendered frame. It takes
  // effect on the next animate / re-animate of that scene, which is why
  // 'completed' is accepted too: the fix panel is where an officer learns the
  // movement was wrong.
  app.put<{ Params: { id: string; index: string } }>(
    '/video/projects/:id/scenes/:index/motion',
    async (request, reply) => {
      const body = UpdateSceneMotionRequestSchema.parse(request.body);
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      const index = Number(request.params.index);
      const scene = Number.isInteger(index) ? row.scenes[index] : undefined;
      if (!scene) {
        return reply.code(404).send({ error: { message: 'Scene not found.' } });
      }
      if (
        (row.status !== 'storyboard_ready' &&
          row.status !== 'completed' &&
          row.status !== 'failed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const scenes = [...row.scenes];
      // If a clip already exists it was rendered from the brief being replaced
      // here, so record that as the clip's lineage before overwriting it. That
      // is what makes clipIsCurrent see the edit: without it the animate job's
      // resume path skips the scene and re-ships the movement the officer just
      // rejected. A scene with no clip needs no lineage — nothing was rendered.
      scenes[index] = {
        ...scene,
        motionBrief: body.motionBrief,
        ...(scene.clipPath !== undefined && scene.clipMotionBrief === undefined
          ? { clipMotionBrief: scene.motionBrief ?? '' }
          : {}),
      };
      await updateVideoProject(client, row.id, { scenes });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
    },
  );

  // THE spend gate: animate every scene from its approved still. Guarded so it
  // can only fire from a fully-stilled storyboard, and resume-aware on retry
  // after a failure (scenes with current clips are skipped by the job).
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/animate',
    async (request, reply) => {
      const missingKey = clipProviderKeyMissing();
      if (missingKey) {
        return reply.code(503).send({
          error: {
            message: `व्हिडिओ सेवा अजून जोडलेली नाही (${missingKey}). प्रशासकाशी संपर्क साधा.`,
          },
        });
      }
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      // 'failed' is allowed so a crashed/partial animate run can resume.
      if (
        (row.status !== 'storyboard_ready' && row.status !== 'failed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const active = await findActiveVideoProject(client);
      if (active && active.id !== row.id) {
        return reply
          .code(409)
          .send({ error: { message: ANOTHER_ACTIVE_MESSAGE } });
      }
      // Every scene needs its start frame; a scene that DECLARED an end frame
      // (has the brief) must also have rendered it — otherwise the officer
      // would be buying a clip whose reviewed ending never existed. A legacy
      // scene without an end brief legitimately animates first-frame-only.
      const notReady = row.scenes.findIndex(
        (scene) =>
          scene.stillPath === undefined ||
          (scene.endVisualBrief !== undefined &&
            scene.endVisualBrief !== '' &&
            scene.endStillPath === undefined),
      );
      if (row.scenes.length === 0 || notReady !== -1) {
        return reply.code(409).send({
          error: {
            message: `दृश्य ${notReady + 1} ची चित्रे अजून तयार नाहीत. आधी स्टोरीबोर्ड पूर्ण करा.`,
          },
        });
      }
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'animate',
        error: null,
      });
      startVideoAnimateJob(client, row.id);
      return reply.code(202).send({ id: row.id });
    },
  );

  // Post-render fix: re-animate ONE scene and restitch. The previous video
  // stays playable throughout; a failure returns the project to completed with
  // the error on the scene.
  app.post<{ Params: { id: string; index: string } }>(
    '/video/projects/:id/scenes/:index/animate',
    async (request, reply) => {
      const missingKey = clipProviderKeyMissing();
      if (missingKey) {
        return reply.code(503).send({
          error: {
            message: `व्हिडिओ सेवा अजून जोडलेली नाही (${missingKey}). प्रशासकाशी संपर्क साधा.`,
          },
        });
      }
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      const index = Number(request.params.index);
      const scene = Number.isInteger(index) ? row.scenes[index] : undefined;
      if (!scene) {
        return reply.code(404).send({ error: { message: 'Scene not found.' } });
      }
      if (row.status !== 'completed' || isVideoJobRunning(row.id)) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      if (scene.stillPath === undefined) {
        return reply.code(409).send({
          error: { message: 'या दृश्याचे चित्र आधी तयार करा.' },
        });
      }
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'animate',
        error: null,
      });
      startSceneReanimateJob(client, row.id, index);
      return reply.code(202).send({ id: row.id });
    },
  );

  // Add (or refresh) the Marathi TTS narration on a finished video: synthesize
  // the complete joined script as one Sarvam performance and re-stitch WITH
  // that continuous track. Reuses the `animating` status (step 'narrate'),
  // flipped BEFORE the 202 (poll-race rule).
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/narrate',
    async (request, reply) => {
      if (!sarvamKeyPresent()) {
        return reply.code(503).send({
          error: {
            message: `निवेदन सेवा अजून जोडलेली नाही (${narrationProviderApiKeyEnv()}). प्रशासकाशी संपर्क साधा.`,
          },
        });
      }
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (row.status !== 'completed' || isVideoJobRunning(row.id)) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      if (!row.videoPath) {
        return reply
          .code(409)
          .send({ error: { message: 'आधी व्हिडिओ तयार व्हायला हवा.' } });
      }
      // This project speaks in the officer's own recording. Re-voicing would
      // silently replace it with a synthesized one — and the free re-stitch
      // (POST /stitch) is what they actually want if the container is bad.
      if (narrationIsUploaded(row.scenes)) {
        return reply.code(409).send({
          error: {
            message:
              'या व्हिडिओसाठी तुम्ही दिलेली ध्वनिफीत वापरली आहे; ती बदलता येणार नाही.',
          },
        });
      }
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'narrate',
        error: null,
      });
      startNarrationJob(client, row.id);
      return reply.code(202).send({ id: row.id });
    },
  );

  // Send a project back to gate 2 so the officer can work on the storyboard
  // again — fix what broke a failed render (most often an over-long motion
  // direction), or revisit a FINISHED video to redraw a frame, re-split the
  // narration or insert a scene. It is a pure state flip: no job runs, nothing
  // is re-rendered, and every clip, frame and narration already in Storage
  // stays on the row, so the resume-aware animate job then renders only the
  // scenes still missing a current clip. The finished video stays on the row
  // too, so a project reopened and left alone is unchanged by the visit.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/reopen-storyboard',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (
        (row.status !== 'failed' && row.status !== 'completed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const active = await findActiveVideoProject(client);
      if (active && active.id !== row.id) {
        return reply
          .code(409)
          .send({ error: { message: ANOTHER_ACTIVE_MESSAGE } });
      }
      if (row.scenes.length === 0) {
        return reply
          .code(409)
          .send({ error: { message: 'आधी स्टोरीबोर्ड तयार व्हायला हवा.' } });
      }
      await updateVideoProject(client, row.id, {
        status: 'storyboard_ready',
        step: 'stills',
        error: null,
      });
      return reply.code(200).send({ id: row.id });
    },
  );

  // Re-run only the free local stitch from the scene clips already in Storage.
  // This is the recovery path for a bad final container: no Kling/Veo render
  // and no Sarvam synthesis is repeated. The runner validates duration/frames
  // before publishing a new immutable video version, so the existing result
  // remains selected unless the replacement is genuinely playable.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/stitch',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (
        (row.status !== 'completed' && row.status !== 'failed') ||
        isVideoJobRunning(row.id)
      ) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const active = await findActiveVideoProject(client);
      if (active && active.id !== row.id) {
        return reply
          .code(409)
          .send({ error: { message: ANOTHER_ACTIVE_MESSAGE } });
      }
      const missingClip = row.scenes.findIndex(
        (scene) => scene.clipPath === undefined,
      );
      if (row.scenes.length === 0 || missingClip !== -1) {
        return reply.code(409).send({
          error: {
            message:
              missingClip === -1
                ? 'जोडण्यासाठी कोणतीही दृश्य क्लिप उपलब्ध नाही.'
                : `दृश्य ${missingClip + 1} ची क्लिप उपलब्ध नाही.`,
          },
        });
      }
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'stitch',
        error: null,
      });
      startVideoStitchJob(
        client,
        row.id,
        row.videoPath ? 'completed' : 'failed',
      );
      return reply.code(202).send({ id: row.id });
    },
  );
}
