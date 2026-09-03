// The Dynamic Poster lane (migration 0052): a finished still poster the officer already has,
// motionised into a short looping clip.
//
// TWO CALLS, IN THIS ORDER, and neither is optional:
//   1. gpt-5.6-sol LOOKS AT THE POSTER and writes the prompt (generateMotionPrompt). The video
//      model never sees the department's intent, only the sentences that come out of here.
//   2. gemini-omni renders the clip from that prompt plus the poster itself.
// Then the MP4 is re-hosted, a GIF is derived from it, and both are written to the row.
//
// It is a `generations` row rather than a table of its own, because it is one of the formats
// the create form offers and the officer expects to find it in history beside the others. So
// it goes through runner.ts's `runJob` like every other generation job: status/step, the cost
// scope, the usage meter and the edit-failure recovery are all inherited rather than
// reimplemented. It lives in its own module only because runner.ts is already 3,000 lines.
//
// THE CHAIN RULE, borrowed verbatim from /new-video-workflow, is what makes the follow-up box
// on the detail page an EDIT rather than a fresh start: `motion_interaction_id` is advanced
// ONLY by a render that actually produced a clip. A failed follow-up leaves it pointing at the
// video the officer can still see, so their next instruction edits that rather than something
// that never existed.
//
// WHAT IS DELIBERATELY NOT HERE: no reference library, no poster copy call, no chrome overlay,
// no caption, no publishing. The officer's poster is finished artwork — it already carries the
// department's branding, and stamping a second lockup onto it would be a defect.

import {
  awaitInteraction,
  createVideoInteraction,
  downloadInteractionVideo,
  generateMotionPrompt,
  interactionErrorMessage,
  interactionOutputOf,
  isTerminalInteractionStatus,
} from '@dgipr/content-engine';
import {
  POSTERS_BUCKET,
  VIDEOS_BUCKET,
  downloadFile,
  getGeneration,
  insertRevision,
  listRevisions,
  updateGeneration,
  uploadFile,
  type GenerationRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  fitImageToAspect,
  mp4ToGif,
  normalizeSourceImage,
} from '@dgipr/poster-renderer';
import {
  DEFAULT_MOTION_ASPECT,
  MotionAspectSchema,
  aspectRatioLabel,
  motionAspectRatio,
} from '@dgipr/schemas';
import type { MotionAspect } from '@dgipr/schemas';
import { armEditRetry, runJob } from './runner.js';

// The shape this run's clip is rendered in (migration 0053). PARSED rather than cast: the
// column is plain text with no CHECK, so a hand-edited row must not put an arbitrary string
// into the prompt as an aspect ratio. Anything unrecognised — including the null every
// pre-0053 row carries — is the portrait default.
function motionAspectOf(row: GenerationRow): MotionAspect {
  const parsed = MotionAspectSchema.safeParse(row.motionAspect);
  return parsed.success ? parsed.data : DEFAULT_MOTION_ASPECT;
}

// THE FRAME, SETTLED IN CODE RATHER THAN ASKED FOR.
//
// The lane's first reported defect was a 4:5 poster returning as a 9:16 clip with ~15% cut off
// each side. The prompt was not being ignored: it demanded that exact ratio AND the whole
// poster on screen, and for a 4:5 source inside a 9:16 frame those cannot both hold — only 70%
// of its width fits. So the poster is padded into the target ratio HERE, before anything is
// sent, and the model receives an image that already IS the requested shape with all of the
// artwork inside it. Nothing is left to crop, and the prompt's two demands stop competing.
//
// On the default aspect ('source') the target IS the poster's own ratio, so this is a no-op
// returning the same bytes — which is the common case and the reason the officer usually sees
// no bars at all.
async function frameSourceForAspect(
  source: Readonly<{ png: Buffer; width: number; height: number }>,
  aspect: MotionAspect,
): Promise<{ png: Buffer; label: string }> {
  const ratio = motionAspectRatio(aspect, source.width, source.height);
  const framed = await fitImageToAspect(source.png, ratio);
  return {
    png: framed.png,
    // Named from the FRAMED image, so the ratio the prompt states and the ratio the model is
    // looking at are the same number by construction.
    label: aspectRatioLabel(framed.width, framed.height),
  };
}

// Versioned per render, because the public buckets are CDN-cached and a reused path serves the
// previous clip for as long as the edge holds it — the rule every poster render here follows.
function motionPath(id: string, version: number): string {
  return `dynamic-posters/${id}/motion-v${version}.mp4`;
}

function motionGifPath(id: string, version: number): string {
  return `dynamic-posters/${id}/motion-v${version}.gif`;
}

// The version this render will write. Derived from the revision log rather than counted on the
// row, so it cannot drift from the history the detail page lists: v1 is the initial render and
// every logged follow-up is the next one.
async function nextMotionVersion(
  client: SupabaseClient,
  id: string,
): Promise<number> {
  const revisions = await listRevisions(client, id);
  return (
    revisions.filter((revision) => revision.target === 'motion').length + 2
  );
}

// One render, initial or follow-up. Returns nothing — everything it produced is on the row.
//
// `previousInteractionId` is what separates the two: null starts a fresh interaction from the
// poster, and an id continues the one that produced the clip currently on screen.
async function renderAndStoreMotion(
  client: SupabaseClient,
  row: GenerationRow,
  input: Readonly<{
    version: number;
    direction: string;
    previousInteractionId: string | null;
  }>,
): Promise<{ motionPath: string; motionGifPath: string | null }> {
  const id = row.id;
  if (!row.sourceImagePath) {
    throw new Error(`Generation ${id} has no uploaded poster.`);
  }

  // Read back from Storage rather than held since the upload: the upload and this render are
  // different requests minutes apart, and a follow-up is a different request again — hours
  // later, on a row this process may never have seen.
  const stored = await downloadFile(
    client,
    POSTERS_BUCKET,
    row.sourceImagePath,
  );
  const source = await normalizeSourceImage(stored);
  // The officer's own choice, off the ROW — so a follow-up, which writes a fresh prompt, cannot
  // silently re-shape a clip they already approved. Null is every run made before the control
  // existed, and those fall back to the poster's own shape, which is the repair they need.
  const framed = await frameSourceForAspect(source, motionAspectOf(row));

  await updateGeneration(client, id, { step: 'motion_prompt' });
  const prompt = await generateMotionPrompt({
    // The FRAMED poster, not the raw one: the prompt writer must describe the image the video
    // model will actually be handed, bars included.
    imagePng: framed.png,
    aspect: framed.label,
    direction: input.direction,
  });
  // Persisted BEFORE the render, so a clip that comes back wrong can be told apart from a
  // prompt that was wrong — and so a failed render still leaves behind what it was asked to do.
  await updateGeneration(client, id, {
    motionPrompt: prompt,
    step: 'motion_render',
  });

  const started = await createVideoInteraction({
    prompt,
    // The poster travels with EVERY turn, follow-ups included. The interaction chain carries
    // the conversation, but the artwork is what must not drift, and re-attaching it costs one
    // inline image against a render measured in minutes.
    images: [{ data: framed.png, mimeType: 'image/png' }],
    previousInteractionId: input.previousInteractionId,
  });
  const interactionId = started.id ?? null;
  if (!interactionId) {
    throw new Error(
      `Gemini accepted the request but returned no interaction id: ${JSON.stringify(started)}`,
    );
  }

  const finished = isTerminalInteractionStatus(started.status ?? 'in_progress')
    ? started
    : await awaitInteraction(interactionId);

  const output = interactionOutputOf(finished);
  const bytes = output.videoUri
    ? await downloadInteractionVideo(output.videoUri)
    : output.videoData
      ? Buffer.from(output.videoData, 'base64')
      : null;
  if (!bytes || bytes.length === 0) {
    // A refusal or a safety block arrives here, and the provider's own words are the useful
    // part — see the /new-video-workflow note on why this one error is not replaced.
    throw new Error(
      interactionErrorMessage(finished) ??
        'Gemini finished the interaction without returning a video.',
    );
  }

  const videoPath = motionPath(id, input.version);
  await uploadFile(client, VIDEOS_BUCKET, videoPath, bytes, 'video/mp4');

  // BEST EFFORT, and deliberately after the MP4 is safely stored. The clip is the paid
  // artifact; the GIF is a convenience copy, and an ffmpeg failure must never cost a render
  // the department has already been billed for.
  let gifPath: string | null = null;
  try {
    const gif = await mp4ToGif(bytes);
    gifPath = motionGifPath(id, input.version);
    await uploadFile(client, VIDEOS_BUCKET, gifPath, gif, 'image/gif');
  } catch (error) {
    gifPath = null;
    console.error(`[job ${id}] GIF conversion failed:`, error);
  }

  await updateGeneration(client, id, {
    motionPath: videoPath,
    motionGifPath: gifPath,
    // THE CHAIN POINT, advanced only now — after a clip exists. See the header.
    motionInteractionId: finished.id ?? interactionId,
  });

  return { motionPath: videoPath, motionGifPath: gifPath };
}

// The initial run: the officer's uploaded poster plus their optional direction.
export function startDynamicPosterJob(
  client: SupabaseClient,
  id: string,
): void {
  runJob(client, id, 'dynamic_poster_creation', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    await renderAndStoreMotion(client, row, {
      version: 1,
      // The note IS the direction on this lane — it is what the create form's AI प्रॉम्प्ट box
      // writes, and an empty one is a complete request.
      direction: row.note,
      previousInteractionId: null,
    });
  });
}

// The AI प्रॉम्प्ट box beside the finished clip. Continues the same Gemini interaction, so
// "make the background darker" edits the video on screen rather than starting again.
export function startMotionFeedbackJob(
  client: SupabaseClient,
  id: string,
  feedback: string,
): void {
  // An EDIT of a run that has already produced something: a failure here must leave the
  // existing clip and every earlier version in place and reportable, not mark the row failed
  // and hide the lot.
  armEditRetry(id, () => startMotionFeedbackJob(client, id, feedback));
  runJob(client, id, 'dynamic_poster_revision', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.motionPath) {
      throw new Error(`Generation ${id} has no clip to revise yet.`);
    }

    await updateGeneration(client, id, {
      status: 'running',
      step: null,
      error: null,
    });

    const version = await nextMotionVersion(client, id);
    const rendered = await renderAndStoreMotion(client, row, {
      version,
      direction: feedback,
      // Read off the ROW, not passed in: a follow-up queued behind another one must continue
      // from whatever that one produced.
      previousInteractionId: row.motionInteractionId,
    });

    // Logged AFTER the render, so a failed follow-up adds no version — the log is the history
    // the detail page lists, and an entry with no object behind it would be a dead thumbnail.
    await insertRevision(client, {
      generationId: id,
      target: 'motion',
      feedback,
      motionPath: rendered.motionPath,
      motionGifPath: rendered.motionGifPath,
    });
  });
}

// Every render this run has produced, oldest→newest, for the detail payload. v1 is the initial
// render (its path is a convention, exactly as poster-v1.png is) and each 'motion' revision is
// the next one; the last entry is always what `motionPath` points at.
export function motionVersionsOf(
  row: GenerationRow,
  revisions: readonly {
    target: string;
    feedback: string | null;
    motionPath: string | null;
    motionGifPath: string | null;
    createdAt: string;
  }[],
): {
  path: string;
  gifPath: string | null;
  direction: string | null;
  createdAt: string;
}[] {
  if (!row.motionPath) return [];
  return [
    {
      path: motionPath(row.id, 1),
      // Only claimed when the FIRST render is also the current one. A pre-GIF row, or one
      // whose conversion failed, would otherwise offer a download that 404s.
      gifPath:
        row.motionGifPath === motionGifPath(row.id, 1)
          ? row.motionGifPath
          : null,
      direction: null,
      createdAt: row.createdAt,
    },
    ...revisions.flatMap((revision) =>
      revision.target === 'motion' && revision.motionPath
        ? [
            {
              path: revision.motionPath,
              gifPath: revision.motionGifPath,
              direction: revision.feedback,
              createdAt: revision.createdAt,
            },
          ]
        : [],
    ),
  ];
}

export { motionPath as dynamicPosterMotionPath };
