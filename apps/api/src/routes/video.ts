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
  VIDEOS_BUCKET,
  listVideoProjects,
  type SupabaseClient,
  type VideoProjectRow,
  type VideoSceneEntry,
} from '@dgipr/database';
import {
  CreateVideoProjectRequestSchema,
  RegenerateStillRequestSchema,
  UpdateVideoScriptRequestSchema,
  clipSecondsForNarration,
  estimateNarrationSeconds,
  type VideoProjectDetail,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import {
  clipProviderApiKeyEnv,
  frameProviderApiKeyEnv,
} from '@dgipr/content-engine';
import {
  isVideoJobRunning,
  startNarrationJob,
  startSceneReanimateJob,
  startSceneStillJob,
  startStoryboardJob,
  startVideoAnimateJob,
  startVideoScriptJob,
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

// Narration needs a Sarvam key (TTS); fail the narrate gate with a setup message
// BEFORE the row is flipped, mirroring clipProviderKeyMissing for animate.
function sarvamKeyPresent(): boolean {
  const key = process.env.SARVAM_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

const BUSY_MESSAGE = 'या प्रकल्पावर आधीच काम सुरू आहे.';
const ANOTHER_ACTIVE_MESSAGE =
  'दुसरा व्हिडिओ प्रकल्प सध्या तयार होत आहे. तो पूर्ण झाल्यावर पुन्हा प्रयत्न करा.';

function toDetail(
  client: SupabaseClient,
  row: VideoProjectRow,
): VideoProjectDetail {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    error: row.error,
    note: row.note,
    heading: row.heading,
    durationBucket: row.durationBucket,
    orientation: row.orientation,
    tier: row.tier,
    title: row.title,
    style: row.style,
    referenceTitle: row.referenceTitle,
    referenceUrl: row.referenceUrl,
    scenes: row.scenes.map((scene) => ({
      narration: scene.narration,
      visualBrief: scene.visualBrief,
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
      ...(scene.narrationAudioPath
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
            endStillUrl: publicUrlIn(
              client,
              VIDEOS_BUCKET,
              scene.endStillPath,
            ),
          }
        : {}),
      ...(scene.clipPath
        ? { clipUrl: publicUrlIn(client, VIDEOS_BUCKET, scene.clipPath) }
        : {}),
      // A clip animated from an older frame (start OR end) than the one on
      // screen — the fix panel's re-animate affordance keys off this.
      ...(scene.clipPath !== undefined &&
      ((scene.stillVersion !== undefined &&
        scene.clipStillVersion !== scene.stillVersion) ||
        (scene.endStillPath !== undefined &&
          scene.clipEndStillVersion !== scene.endStillVersion))
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
  app.post('/video/projects', async (request, reply) => {
    const body = CreateVideoProjectRequestSchema.parse(request.body);
    // One project in a working status at a time: the Veo lane renders serially
    // (low preview rate limits) and the gate must survive refreshes, so it is
    // DB-backed rather than a TasksProvider-style client gate.
    const active = await findActiveVideoProject(client);
    if (active) {
      return reply
        .code(409)
        .send({ error: { message: ANOTHER_ACTIVE_MESSAGE } });
    }
    const row = await insertVideoProject(client, {
      note: body.note,
      heading: body.heading,
      durationBucket: body.durationBucket,
      orientation: body.orientation,
      tier: body.tier,
    });
    startVideoScriptJob(client, row.id);
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
      // server; fail it so the UI stops spinning. Clips already rendered are
      // persisted per scene, so the retry resumes rather than re-billing.
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
      const scenes: VideoSceneEntry[] = body.scenes.map((incoming, index) => {
        const existing = row.scenes[index];
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
          // Provisional: a plausible window from the edited narration's
          // length, so the gate-2 estimate is not wild before anything is
          // synthesized. The voice phase re-derives it from the measured WAV.
          durationSeconds: clipSecondsForNarration(
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

      if (body.visualBrief !== undefined || body.endVisualBrief !== undefined) {
        const scenes = [...row.scenes];
        scenes[index] = {
          ...scene,
          ...(body.visualBrief !== undefined
            ? { visualBrief: body.visualBrief }
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
  // each scene's narration with Sarvam and re-stitch WITH audio. On-demand, from
  // a completed project — Sarvam stays off the Veo critical path, and only the
  // scenes whose cached audio is stale are re-synthesized. Reuses the `animating`
  // status (step 'narrate'), flipped BEFORE the 202 (poll-race rule).
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/narrate',
    async (request, reply) => {
      if (!sarvamKeyPresent()) {
        return reply.code(503).send({
          error: {
            message:
              'निवेदन सेवा अजून जोडलेली नाही (SARVAM_API_KEY). प्रशासकाशी संपर्क साधा.',
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
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'narrate',
        error: null,
      });
      startNarrationJob(client, row.id);
      return reply.code(202).send({ id: row.id });
    },
  );
}
