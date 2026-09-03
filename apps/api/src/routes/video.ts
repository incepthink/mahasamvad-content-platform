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
  IMAGE_FILE_EXTENSIONS,
  NARRATION_AUDIO_EXTENSIONS,
  RegenerateStillRequestSchema,
  ReplanVideoScriptRequestSchema,
  StartVideoAnimationRequestSchema,
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_FILE_MAX_MB,
  VIDEO_PROMPT_IMAGE_LIMIT,
  UpdateSceneMotionRequestSchema,
  UpdateVideoScriptRequestSchema,
  allocateVideoSceneDurations,
  clipSecondsForNarration,
  estimateNarrationSeconds,
  isImageFileName,
  narrationAudioMimeForFileName,
  normalizeVideoNarrationScript,
  type VideoProjectDetail,
  type VideoProjectSummary,
} from '@dgipr/schemas';
import {
  decodeAudioToWav,
  normalizeReferenceImage,
  renderGovernmentLockup,
  wavDurationSeconds,
} from '@dgipr/poster-renderer';
import {
  clipProviderApiKeyEnv,
  describeVideoScenes,
  frameProviderApiKeyEnv,
  narrationKeyPresent,
  narrationProviderApiKeyEnv,
  type DescribedVideoScene,
} from '@dgipr/content-engine';
import {
  clipNeedsRender,
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

// The lockup PNG served to the review players. Rendered wide enough that the
// browser only ever scales it DOWN (the player is capped at 560px, so a 9%
// lockup is ~50 CSS px, ~100 physical on a 2x screen); the actual on-screen
// size is decided by VIDEO_LOCKUP_WIDTH_RATIO in CSS, not here.
const LOCKUP_PREVIEW_WIDTH = 320;
let lockupPng: Promise<Buffer> | null = null;

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

// One card as it arrives from gate 1. The save route and the re-plan route
// disagree only about whether a blank `visualBrief` is acceptable (it is, for
// a scene the officer has just inserted and is asking the AI to describe), so
// they share this shape with the brief optional and the save route's own
// schema keeps the `.min(1)` that guarantees it.
type IncomingScene = Readonly<{
  sourceIndex?: number | undefined;
  narration: string;
  visualBrief?: string | undefined;
  endVisualBrief?: string | undefined;
  keyPoint?: string | undefined;
  referenceImagePath?: string | undefined;
}>;

// Where this project's reference pictures live. Every submitted path is checked
// against it — the chat `imageUrl` guard, for the same reason: a storage path
// taken from the client is otherwise a standing invitation to point the frame
// model at any object in the bucket, including another project's frames.
function referencePathPrefix(id: string): string {
  return `projects/${id}/references/`;
}

// The pictures attached to the project's AI prompt. A separate prefix from the
// per-scene references above so the two can never be confused by the guard that
// refuses a foreign path — these are never submitted BACK by a client.
function promptImagePathPrefix(id: string): string {
  return `projects/${id}/prompt/`;
}

// What a submitted card's reference picture RESOLVES to, given what is stored.
// Three inputs, three outcomes, and the distinction is the whole reason the
// field is optional rather than always sent:
//   a path      → attach (or replace) it
//   ''          → the officer removed it
//   undefined   → not mentioned, so leave the stored one alone (a client that
//                 predates this feature must not detach every picture it saves)
function nextReferenceImagePath(
  scene: IncomingScene,
  existing: VideoSceneEntry | undefined,
): string | undefined {
  if (scene.referenceImagePath === undefined)
    return existing?.referenceImagePath;
  return scene.referenceImagePath === '' ? undefined : scene.referenceImagePath;
}

// Refuse a payload naming an object this project does not own, BEFORE anything
// is written. Returns the offending path, or null when every card is clean.
function foreignReferencePath(
  id: string,
  scenes: readonly IncomingScene[],
): string | null {
  for (const scene of scenes) {
    const path = scene.referenceImagePath;
    if (path === undefined || path === '') continue;
    if (!path.startsWith(referencePathPrefix(id))) return path;
  }
  return null;
}

// Reconcile the submitted cards against the STORED scenes: which ones keep
// their paid frames, which start over, and what rides along either way.
// Extracted from the script save route (2026-08-14) so the re-plan route
// reuses it rather than growing a second copy of the lineage rules — they are
// the only thing standing between an inserted card and a discarded storyboard.
function reconcileScriptScenes(
  row: VideoProjectRow,
  incoming: readonly IncomingScene[],
  styleChanged: boolean,
): VideoSceneEntry[] {
  return incoming.map((scene, index) => {
    // Identity first, position only as the legacy fallback: an inserted
    // scene shifts every later card, and matching by position would then
    // compare each against its neighbour and discard a storyboard of paid
    // frames. A sourceIndex past the stored array is treated as new.
    const existing =
      scene.sourceIndex === undefined
        ? row.scenes[index]
        : row.scenes[scene.sourceIndex];
    const referenceImagePath = nextReferenceImagePath(scene, existing);
    // Same BOTH briefs, the same reference picture, and an existing still ⇒
    // keep the frames (and their clip lineage); anything else starts over as
    // pending. The end brief counts because the end frame is rendered from it —
    // an edited end brief with a kept frame would show a frame of the old
    // description — and the reference picture counts for exactly the same
    // reason: it is an input to the start-frame prompt, so attaching, replacing
    // or removing one means the frame on screen was drawn against something
    // that is no longer what the officer asked for.
    // The key point is deliberately NOT in this test: it is burned on at
    // stitch time and no frame is rendered from it, so editing one must
    // never throw away a paid frame.
    if (
      !styleChanged &&
      existing &&
      existing.visualBrief === scene.visualBrief &&
      existing.endVisualBrief === scene.endVisualBrief &&
      existing.referenceImagePath === referenceImagePath &&
      existing.stillPath !== undefined
    ) {
      return {
        ...existing,
        narration: scene.narration,
        ...(scene.keyPoint !== undefined ? { keyPoint: scene.keyPoint } : {}),
      };
    }
    // A brief changed (or new scene): the frames start over, but the plan
    // lineage and the narration-audio cache ride along — audio depends
    // only on narration text + voice (narrationIsCurrent re-checks), so
    // dropping it here would re-bill TTS for a pure visual edit.
    return {
      narration: scene.narration,
      visualBrief: scene.visualBrief ?? '',
      ...(scene.endVisualBrief !== undefined
        ? { endVisualBrief: scene.endVisualBrief }
        : {}),
      ...(scene.keyPoint !== undefined
        ? { keyPoint: scene.keyPoint }
        : existing?.keyPoint !== undefined
          ? { keyPoint: existing.keyPoint }
          : {}),
      ...(referenceImagePath !== undefined ? { referenceImagePath } : {}),
      // Preserve the timeline the script writer saw. A genuinely new scene
      // gets a provisional text-derived window, capped at five seconds. The
      // continuous voice phase has no whole-video target.
      durationSeconds:
        existing?.durationSeconds ??
        clipSecondsForNarration(estimateNarrationSeconds(scene.narration)),
      status: 'pending',
      ...(existing?.beat !== undefined ? { beat: existing.beat } : {}),
      ...(existing?.sceneLabel !== undefined
        ? { sceneLabel: existing.sceneLabel }
        : {}),
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
}

// Overwrite one scene's pipeline-owned fields with a freshly planned
// description, keeping its narration and its narration-audio cache.
//
// The load-bearing part is what is DROPPED. `openingVisualBrief` and
// `motionBrief` are derived from `visualBrief` by the storyboard job's
// direction phase, which regenerates them only when they are MISSING — so
// carrying them across a re-plan would silently animate the new frames with
// the old brief's choreography. The frame/clip lineage goes for the ordinary
// reason (it was rendered from a description that no longer exists); at
// `script_ready` none of it is present anyway, so that half is defensive.
// Built as an explicit KEEP list rather than by omitting the derived keys: the
// scene entry has ~28 fields and all but these are either overwritten below or
// deliberately discarded, so listing the survivors is both shorter and the
// thing worth reading. A field added to VideoSceneEntry later is therefore
// dropped by a re-plan until someone decides it should survive one, which is
// the safe direction for a type whose members are mostly render lineage.
function applyDescribedVisuals(
  scene: VideoSceneEntry,
  visual: DescribedVideoScene,
): VideoSceneEntry {
  return {
    // The officer's words, and the audio already measured for them. Narration
    // is not this call's to change, and the TTS cache keys on the joined text
    // (narrationIsCurrent re-checks it), so carrying it costs nothing and
    // dropping it would re-bill a synthesis for a visual edit.
    narration: scene.narration,
    durationSeconds: scene.durationSeconds,
    // The officer's reference picture is theirs, not a field this call owns —
    // re-describing a scene must not detach the photograph the description is
    // supposed to be about. It is already reconciled (attached/replaced/removed)
    // by reconcileScriptScenes before this runs, so `scene` carries the answer.
    ...(scene.referenceImagePath !== undefined
      ? { referenceImagePath: scene.referenceImagePath }
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
    visualBrief: visual.visualBrief,
    // Re-added only when the new plan asks for an end frame: a scene that had
    // one and no longer needs it must lose the field outright, or it animates
    // first-to-last against a description nothing will render.
    ...(visual.endVisualBrief !== undefined
      ? { endVisualBrief: visual.endVisualBrief }
      : {}),
    // Empty is meaningful and is kept as such — that scene gets no overlay.
    keyPoint: visual.keyPoint,
    beat: visual.beat,
    // Dropped rather than kept blank when the model returned none: the card
    // falls back to "दृश्य N", where a stale label from the previous plan would
    // be titling a scene it no longer describes.
    ...(visual.sceneLabel ? { sceneLabel: visual.sceneLabel } : {}),
    shotHint: visual.shotHint,
    status: 'pending',
  };
}

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
//
// Mutates `scenes` in place and reports whether it did, so a caller with its
// own fallback (the re-plan, which estimates from characters when the words
// themselves changed) knows whether one is still needed.
function reweightMeasuredSplit(
  row: VideoProjectRow,
  scenes: VideoSceneEntry[],
): boolean {
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
    !splitChanged ||
    previousJoined !== nextJoined ||
    previousJoined === '' ||
    measuredSeconds <= 0
  ) {
    return false;
  }
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
  return true;
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
  // Reference pictures attached to the AI prompt, already normalised to PNG in
  // the order they were sent. Normalising HERE rather than in the paid script
  // job is the reference-image rule: the officer is standing in front of the
  // form, so an unreadable file is refused now.
  promptImages: Buffer[];
  // A refusal the officer must READ, so it is carried back as a plain Marathi
  // sentence rather than thrown as a ZodError — the shared error handler sends
  // a ZodError's message verbatim, which is a JSON array of issue objects.
  reject: string | null;
}>;

// Collect the create form's fields plus its files: one optional `narration`
// recording (ready-script lane) and up to VIDEO_PROMPT_IMAGE_LIMIT
// `promptImages` pictures. Fields arrive as strings, so the booleans/enums are
// left as-is for the schema and only `aiPrompt` is dropped when empty (an empty
// string would fail nothing but would be stored as a direction nobody typed).
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
  const promptImages: Buffer[] = [];
  let reject: string | null = null;
  // One recording plus the picture allowance. busboy's `files` limit does not
  // reject past the cap — it silently STOPS emitting parts (the /dlo finding) —
  // so the count is checked below as well, where it can be reported.
  const parts = request.parts({
    limits: {
      fileSize: NARRATION_MAX_BYTES,
      files: VIDEO_PROMPT_IMAGE_LIMIT + 1,
    },
  });
  for await (const part of parts) {
    if (part.type === 'field') {
      const value = typeof part.value === 'string' ? part.value : '';
      if (part.fieldname === 'aiPrompt' && value.trim() === '') continue;
      raw[part.fieldname] = value;
      continue;
    }
    if (part.fieldname === 'promptImages') {
      const data = await part.toBuffer();
      if (!isImageFileName(part.filename)) {
        reject = `हे चित्र स्वीकारता येत नाही. ${IMAGE_FILE_EXTENSIONS.join(', ')} पैकी एक द्या.`;
        continue;
      }
      if (promptImages.length >= VIDEO_PROMPT_IMAGE_LIMIT) {
        reject = `AI प्रॉम्प्टसोबत जास्तीत जास्त ${VIDEO_PROMPT_IMAGE_LIMIT} चित्रे देता येतात.`;
        continue;
      }
      try {
        promptImages.push(await normalizeReferenceImage(data));
      } catch {
        reject =
          'यापैकी एक चित्र वाचता आले नाही. दुसऱ्या स्वरूपात (उदा. JPG) पुन्हा द्या.';
      }
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
  return { raw, audio, promptImages, reject };
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
    aiPrompt: row.aiPrompt,
    // URLs, not paths: the page only ever DISPLAYS these, and nothing sends one
    // back — unlike a scene's reference picture, whose path round-trips on the
    // save that attaches it.
    promptImageUrls: row.promptImagePaths.map((path) =>
      publicUrlIn(client, VIDEOS_BUCKET, path),
    ),
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
      // Both halves, unlike every other storage path on this payload. The URL
      // renders the thumbnail on the card; the PATH is what gate 1 sends back
      // on the save that keeps the picture attached, so shipping only the URL
      // would force the client to reverse a public URL into the object it names.
      ...(scene.referenceImagePath
        ? {
            referenceImagePath: scene.referenceImagePath,
            referenceImageUrl: publicUrlIn(
              client,
              VIDEOS_BUCKET,
              scene.referenceImagePath,
            ),
          }
        : {}),
      durationSeconds: scene.durationSeconds,
      status: scene.status,
      ...(scene.beat !== undefined ? { beat: scene.beat } : {}),
      ...(scene.sceneLabel !== undefined
        ? { sceneLabel: scene.sceneLabel }
        : {}),
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
      // A clip animated from an older frame (start OR end), from an end frame
      // the officer has since DELETED, from an older motion brief or at an older
      // window — than what is on screen. The fix panel's re-animate affordance
      // keys off this, and so does gate 2's re-shoot list, which is why it is
      // now the animate job's OWN test rather than a second copy of it: an
      // inline copy here had drifted (it omitted the window check), so a scene
      // the job would re-render could show as current.
      ...(scene.clipPath !== undefined && clipNeedsRender(scene)
        ? { clipStale: true }
        : {}),
      ...(scene.error !== undefined ? { error: scene.error } : {}),
    })),
    captionsEnabled: row.captionsEnabled,
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
      : {
          raw: request.body,
          audio: null,
          promptImages: [] as Buffer[],
          reject: null,
        };
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

    // Decode BEFORE the row exists, so an unreadable recording leaves nothing
    // behind and the officer keeps the create form they are standing on. The
    // decoded duration is no longer a gate (2026-08-12: the two-minute ceiling
    // is gone on both halves of this lane) — it is what plans the scene count,
    // the per-scene char cap and the clip windows.
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
    }

    const row = await insertVideoProject(client, {
      note: body.note,
      ...(body.aiPrompt ? { aiPrompt: body.aiPrompt } : {}),
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
    // The pictures land after the insert because their storage key needs the
    // row id, exactly as the narration track above does. Written to the row
    // before the job starts, since the script job — and gate 1's re-plan, long
    // afterwards — both read them off it.
    if (parsed.promptImages.length > 0) {
      try {
        const paths: string[] = [];
        for (const [index, png] of parsed.promptImages.entries()) {
          const path = `${promptImagePathPrefix(row.id)}${index + 1}.png`;
          await uploadFile(client, VIDEOS_BUCKET, path, png, 'image/png');
          paths.push(path);
        }
        await updateVideoProject(client, row.id, { promptImagePaths: paths });
      } catch (error) {
        // NOT best-effort: silently dropping the pictures would plan the whole
        // storyboard without the references the officer attached it for. The
        // row already exists, so it is failed HERE with a readable reason
        // instead of being left for the orphan reaper, whose message ("the
        // server restarted") would be untrue.
        request.log.error(error);
        await updateVideoProject(client, row.id, {
          status: 'failed',
          step: null,
          error: 'संदर्भ चित्रे जतन करता आली नाहीत.',
        });
        return reply.code(500).send({
          error: {
            message:
              'संदर्भ चित्रे जतन करता आली नाहीत. चित्रांशिवाय किंवा पुन्हा प्रयत्न करा.',
          },
        });
      }
    }
    startVideoScriptJob(client, row.id, uploaded);
    return reply.code(202).send({ id: row.id });
  });

  // The Government of Maharashtra lockup as a transparent PNG, for the
  // per-scene review players to lay over the raw clip in CSS. Scene clips are
  // stored EXACTLY as the provider returned them (the stitch owns the burned-in
  // branding — see validateSceneClip), so this route is what keeps those
  // previews looking like the finished video. Served from the API rather than
  // copied into apps/web/public so renderGovernmentLockup stays the one source
  // of the artwork; rendered once per process, since it never varies.
  app.get('/video/lockup.png', async (_request, reply) => {
    lockupPng ??= renderGovernmentLockup(LOCKUP_PREVIEW_WIDTH, {
      background: 'transparent',
    }).then((raster) => raster.data);
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(await lockupPng);
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
      // Word identity used to be enforced on the WHOLE ready-script lane, which
      // also refused a typo fix — and the words are not actually frozen when the
      // voice is synthesized: the narrate phase keys its cached WAV on the joined
      // SCENE narrations (`continuousNarrationIsCurrent`), not on `row.note`, so
      // an edit simply invalidates the track and it is re-synthesized from the
      // edited text. The guard therefore now covers only the case where the words
      // genuinely cannot change — the narration IS the officer's own recording,
      // which no edit can re-record. That is also what keeps the voice phase's
      // uploaded-narration branch unreachable; without this it would surface as a
      // raw throw at the top of the storyboard job instead of a Marathi refusal.
      //
      // Two things this no longer protects, both acceptable and neither on the
      // normal path: `row.note` keeps the ORIGINAL script, so re-running the gate-0
      // script job discards the edits; and the clip windows were derived from a
      // measured WAV of that original, so a materially longer edit extends them
      // (or, once clips are rendered and windows frozen, is speed-fitted).
      if (row.inputMode === 'script' && narrationIsUploaded(row.scenes)) {
        const submitted = normalizeVideoNarrationScript(
          body.scenes.map((scene) => scene.narration).join(' '),
        );
        const original = normalizeVideoNarrationScript(row.note);
        if (submitted !== original) {
          return reply.code(400).send({
            error: {
              message:
                'तुम्ही दिलेल्या ध्वनिफीतीतील शब्द बदलता येत नाहीत. दृश्य-वर्णन मात्र संपादित करता येईल.',
            },
          });
        }
      }
      // The officer's edited style/setting paragraph. It is an input to EVERY
      // frame prompt, so changing it makes every rendered frame stale — which
      // matters because this route also accepts storyboard_ready, where frames
      // exist. A changed style therefore suppresses reconcileScriptScenes'
      // keep-frames branch entirely and sends every scene back to pending.
      const style = body.style ?? row.style;
      const styleChanged = style !== row.style;

      // Scene count has only the schema's one-scene floor; longer narration may
      // use as many five-second scenes as needed. Incoming durationSeconds is IGNORED:
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
      if (foreignReferencePath(row.id, body.scenes)) {
        return reply.code(400).send({
          error: { message: 'संदर्भ चित्र या प्रकल्पाचे नाही.' },
        });
      }

      const scenes = reconcileScriptScenes(row, body.scenes, styleChanged);
      reweightMeasuredSplit(row, scenes);

      await updateVideoProject(client, row.id, {
        scenes,
        ...(styleChanged ? { style } : {}),
      });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
    },
  );

  // "AI ने पुन्हा तयार करा" — gate 1's re-plan. The officer has re-split the
  // narration (typically by inserting a scene and typing only its निवेदन), and
  // every field the PIPELINE owns is now blank or describes the old split.
  // This persists their split exactly as typed and re-derives the rest:
  // visual brief, end brief, shot hint, beat, on-screen key point, and the clip
  // windows.
  //
  // Four deliberate limits, each of them the thing this could easily have done
  // instead and should not:
  //  - The narration is never sent back by the model and never written here.
  //    The split is the officer's; only its description is ours. On the
  //    ready-script lane that is also the law — the word-identity guard below
  //    is the same one the save route runs.
  //  - `script_ready` ONLY. At gate 2 this would replace briefs that paid
  //    frames were rendered from, discarding a storyboard for a text call.
  //  - The style paragraph is left alone. It feeds every frame prompt, so
  //    regenerating it would invalidate every frame rather than the edited
  //    ones; gate 1's textarea remains the way to change it.
  //  - Synchronous, and the row stays at `script_ready`. Flipping it to
  //    `scripting` would replace the review cards the officer is working in
  //    with a progress bar (the caption-editing rationale) for one text call.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/script/replan',
    async (request, reply) => {
      const body = ReplanVideoScriptRequestSchema.parse(request.body);
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (row.status !== 'script_ready' || isVideoJobRunning(row.id)) {
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
      if (foreignReferencePath(row.id, body.scenes)) {
        return reply.code(400).send({
          error: { message: 'संदर्भ चित्र या प्रकल्पाचे नाही.' },
        });
      }

      // Reconciled first so the audio cache and the plan lineage ride along
      // exactly as they do on a save; the visuals are then overwritten on top.
      const scenes = reconcileScriptScenes(row, body.scenes, false);
      const described = await describeVideoScenes(
        scenes.map((scene) => scene.narration),
        {
          ...(row.aiPrompt ? { aiPrompt: row.aiPrompt } : {}),
          ...(row.promptImagePaths.length > 0
            ? {
                promptImageUrls: row.promptImagePaths.map((path) =>
                  publicUrlIn(client, VIDEOS_BUCKET, path),
                ),
              }
            : {}),
        },
      );
      for (const [index, scene] of scenes.entries()) {
        scenes[index] = applyDescribedVisuals(scene, described.scenes[index]!);
      }

      // Windows, free in all three cases — and which case applies turns on
      // whether a MEASURED timeline still describes this narration.
      //
      //  1. The officer moved words between scenes: the joined script is
      //     byte-identical, so the measured WAV still applies and every share
      //     is re-weighted against that real total.
      //  2. Nothing about the split moved (a plain "try again" on a
      //     description the officer did not like): the stored windows were
      //     measured and are still exactly right, so they are LEFT ALONE.
      //     Re-deriving them here would trade a measurement for an estimate,
      //     which is the one direction this must never move.
      //  3. The words themselves changed (note lane only — the guard above
      //     forbids it otherwise): nothing measured describes them any more,
      //     so each scene falls back to its own character estimate and the
      //     storyboard job's voice phase measures for real before a frame is
      //     bought.
      const measuredTotal = row.scenes.reduce(
        (sum, scene) => sum + (scene.narrationAudioSeconds ?? 0),
        0,
      );
      const measuredStillApplies =
        measuredTotal > 0 &&
        continuousNarrationText(row.scenes) === continuousNarrationText(scenes);
      if (!reweightMeasuredSplit(row, scenes) && !measuredStillApplies) {
        for (const [index, scene] of scenes.entries()) {
          scenes[index] = {
            ...scene,
            durationSeconds: clipSecondsForNarration(
              estimateNarrationSeconds(scene.narration),
            ),
          };
        }
      }

      await updateVideoProject(client, row.id, { scenes });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
    },
  );

  // One reference picture for a scene's start frame, stored and handed back as
  // a path + public URL. Separate from the save (the chat-attachment shape) so
  // the file travels while the officer is still writing the scene, leaving the
  // save an ordinary JSON request that carries only the path.
  //
  // Uploading ATTACHES NOTHING. The picture reaches a scene only when the
  // returned path comes back on a save, which is what makes "बदल जतन करा" mean
  // the same thing for this control as for every other field on the card — and
  // is why the route is not scene-scoped: at gate 1 a card may be one the
  // officer has just inserted, with no stored scene to address.
  //
  // Gate 1 only. This is a spend-shaping input reviewed before any frame is
  // bought; at gate 2 the equivalent action is the redraw fold, which spends.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/reference-image',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      if (row.status !== 'script_ready' || isVideoJobRunning(row.id)) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      const file = await request.file({
        limits: { fileSize: UPLOAD_FILE_MAX_BYTES, files: 1 },
      });
      if (!file) {
        return reply
          .code(400)
          .send({ error: { message: 'कोणतेही चित्र मिळाले नाही.' } });
      }
      // Extension-driven, never the browser's reported type — the audio and the
      // /dlo photograph paths make the same call, and for the same reason.
      if (!isImageFileName(file.filename)) {
        // Drain the part first so busboy is not left mid-stream.
        await file.toBuffer();
        return reply.code(400).send({
          error: {
            message: `हे चित्र स्वीकारता येत नाही. ${IMAGE_FILE_EXTENSIONS.join(', ')} पैकी एक द्या.`,
          },
        });
      }
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (error) {
        if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({
            error: {
              message: `चित्र खूप मोठे आहे. कमाल ${UPLOAD_FILE_MAX_MB} MB.`,
            },
          });
        }
        throw error;
      }
      // Normalised HERE, with the officer standing in front of the form, rather
      // than inside the paid storyboard job: the frame clients send a reference
      // inline as `image/png`, so exactly one representation may reach Storage,
      // and an unreadable file must be refused now rather than hours later.
      let png: Buffer;
      try {
        png = await normalizeReferenceImage(data);
      } catch (error) {
        request.log.error(error);
        return reply.code(400).send({
          error: {
            message:
              'हे चित्र वाचता आले नाही. दुसऱ्या स्वरूपात (उदा. JPG) पुन्हा द्या.',
          },
        });
      }
      // Random object name rather than a scene-indexed one: at gate 1 the cards
      // are still being inserted and reordered, so a name derived from a scene's
      // position would point at the wrong scene the moment one moved.
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const path = `${referencePathPrefix(row.id)}${token}.png`;
      await uploadFile(client, VIDEOS_BUCKET, path, png, 'image/png');
      return {
        name: file.filename,
        path,
        url: publicUrlIn(client, VIDEOS_BUCKET, path),
      };
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

  // One scene's END frame, deleted. Synchronous and free — nothing is rendered
  // and nothing is re-billed; the scene simply returns to the legacy
  // single-frame shape and animates first-frame-only. The stored PNG is left in
  // the bucket (frames are versioned and immutable, exactly as a redrawn frame's
  // predecessor is), so the only thing removed is the row's reference to it.
  //
  // 'completed' and 'failed' are accepted for the same reason the motion route
  // takes them: the fix panel is where an officer learns the ending was wrong.
  // A clip already animated from that frame KEEPS its clipEndStillVersion — the
  // motion-brief lineage trick — so clipIsCurrent (and the detail payload's
  // clipStale) both see that this scene's clip no longer matches what is on
  // screen, and the officer is offered a re-animate instead of the old ending
  // being silently re-shipped.
  app.delete<{ Params: { id: string; index: string } }>(
    '/video/projects/:id/scenes/:index/end-frame',
    async (request, reply) => {
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
      // Idempotent: a scene that already has no end frame is not an error (a
      // double press, or a legacy single-frame scene), it is the requested
      // state.
      if (
        scene.endVisualBrief === undefined &&
        scene.endStillPath === undefined
      ) {
        return toDetail(client, row);
      }
      const scenes = [...row.scenes];
      const kept: {
        -readonly [K in keyof VideoSceneEntry]: VideoSceneEntry[K];
      } = { ...scene };
      delete kept.endVisualBrief;
      delete kept.endStillPath;
      delete kept.endStillVersion;
      // clipEndStillVersion survives as LINEAGE while a clip exists — that
      // mismatch is the whole staleness signal. With no clip it records nothing.
      if (scene.clipPath === undefined) delete kept.clipEndStillVersion;
      scenes[index] = kept;
      await updateVideoProject(client, row.id, { scenes });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
    },
  );

  // One scene's END frame, taken from its OWN START frame — free, synchronous
  // and instant: no image is generated, the row is simply pointed at the start
  // frame's stored PNG as well. This is the officer's answer to "this shot
  // should hold" (and to an end frame that keeps coming back wrong): the clip
  // then interpolates between two identical frames, so the movement inside it
  // is subtle instead of the scene ending somewhere else.
  //
  // It ALIASES the start frame's object rather than copying the bytes, because
  // that is exactly what is being expressed and frame paths are immutable and
  // versioned — nothing ever overwrites or deletes the one it points at. The
  // end version is still bumped, so a clip already animated from a different
  // ending is reported stale (clipIsCurrent) and the officer is offered a
  // re-animate rather than the old ending being silently re-shipped.
  //
  // The end brief is set to the start brief for the same reason: it is the
  // description of the frame now standing at the end, and it is what the clip
  // prompt and any later redraw read. Note the ordinary consequence — redrawing
  // the START frame afterwards renders a NEW end frame from that brief (a start
  // redraw always refreshes the pair), so this button is pressed again if the
  // hold is still wanted.
  app.post<{ Params: { id: string; index: string } }>(
    '/video/projects/:id/scenes/:index/end-frame/from-start',
    async (request, reply) => {
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
      if (scene.stillPath === undefined) {
        return reply.code(409).send({
          error: { message: 'आधी प्रारंभ फ्रेम तयार व्हायला हवी.' },
        });
      }
      const scenes = [...row.scenes];
      scenes[index] = {
        ...scene,
        endVisualBrief: scene.openingVisualBrief ?? scene.visualBrief,
        endStillPath: scene.stillPath,
        endStillVersion: (scene.endStillVersion ?? 0) + 1,
      };
      await updateVideoProject(client, row.id, { scenes });
      const updated = await getVideoProject(client, row.id);
      return toDetail(client, updated!);
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
  app.post<{ Params: { id: string }; Body: unknown }>(
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
      // Extra scenes the officer ticked whose clip is already current. Parsed
      // leniently — an older client sends no body at all — but the indexes
      // themselves are range-checked, since an out-of-range one would silently
      // buy nothing and read as the tick having been ignored.
      const parsed = StartVideoAnimationRequestSchema.safeParse(
        request.body ?? {},
      );
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { message: 'Invalid scene selection.' } });
      }
      const forced = parsed.data.scenes ?? [];
      const outOfRange = forced.find((index) => index >= row.scenes.length);
      if (outOfRange !== undefined) {
        return reply
          .code(400)
          .send({ error: { message: `Scene ${outOfRange + 1} not found.` } });
      }
      // The caption choice is persisted BEFORE the flip and in its own
      // best-effort update: the stitch reads it off the row (a per-scene
      // re-animate and the free restitch carry no request body), and a
      // database without 0047 must cost the toggle rather than the paid run.
      if (
        parsed.data.captions !== undefined &&
        parsed.data.captions !== row.captionsEnabled
      ) {
        try {
          await updateVideoProject(client, row.id, {
            captionsEnabled: parsed.data.captions,
          });
        } catch (error) {
          request.log.warn(
            `[video] could not store the caption choice for ${row.id}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await updateVideoProject(client, row.id, {
        status: 'animating',
        step: 'animate',
        error: null,
      });
      startVideoAnimateJob(client, row.id, forced);
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

  // Send a project back to gate 1 so the officer can rework the SCRIPT — the
  // narration split, the briefs, the key points and the style paragraph — after
  // seeing the frames those inputs produced. The twin of the route above, one
  // gate earlier, and a pure state flip for the same reason: no job runs and
  // nothing is re-rendered, so every frame already in Storage stays on the row
  // and the storyboard job then draws only the scenes an edit sent back to
  // 'pending'. Gate 1's save route already accepts a project carrying frames
  // (that is what reconcileScriptScenes' keep-frames branch is for), so nothing
  // downstream needed a change.
  app.post<{ Params: { id: string } }>(
    '/video/projects/:id/reopen-script',
    async (request, reply) => {
      const row = await getVideoProject(client, request.params.id);
      if (!row) {
        return reply
          .code(404)
          .send({ error: { message: 'Video project not found.' } });
      }
      // storyboard_ready ONLY. Both gates are idle statuses of the SAME active
      // project, so there is no findActiveVideoProject check to make here —
      // unlike the reopen above, which revives a finished or failed one.
      if (row.status !== 'storyboard_ready' || isVideoJobRunning(row.id)) {
        return reply.code(409).send({ error: { message: BUSY_MESSAGE } });
      }
      await updateVideoProject(client, row.id, {
        status: 'script_ready',
        step: null,
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
