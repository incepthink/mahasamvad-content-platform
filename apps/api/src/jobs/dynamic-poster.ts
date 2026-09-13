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
// WHAT IS DELIBERATELY NOT HERE: no reference library, no poster copy call, no caption, no
// publishing — and no chrome on a RENDER. The officer's poster is finished artwork; it already
// carries the department's branding, and stamping a second lockup onto it would be a defect.
// The one exception is the hand TRIM, where the officer may ask for it: cutting one panel out
// of a poster leaves that poster's own branding outside the rectangle, so there is nothing left
// to duplicate. See startMotionCropJob.

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
  cropVideoToAspect,
  cropVideoToRect,
  fitImageToAspect,
  mp4ToGif,
  normalizeSourceImage,
  restoreSourceOverClip,
} from '@dgipr/poster-renderer';
import {
  DEFAULT_MOTION_ASPECT,
  MotionAspectSchema,
  MotionRegionSchema,
  aspectRatioLabel,
  isWholeClipCrop,
  motionAspectRatio,
  snapMotionAspect,
} from '@dgipr/schemas';
import type { MotionAspect, MotionCrop, MotionRegion } from '@dgipr/schemas';
import { armEditRetry, runJob } from './runner.js';

// The shape this run's clip is rendered in (migration 0053). PARSED rather than cast: the
// column is plain text with no CHECK, so a hand-edited row must not put an arbitrary string
// into the prompt as an aspect ratio. Anything unrecognised — including the null every
// pre-0053 row carries — is the portrait default.
function motionAspectOf(row: GenerationRow): MotionAspect {
  const parsed = MotionAspectSchema.safeParse(row.motionAspect);
  return parsed.success ? parsed.data : DEFAULT_MOTION_ASPECT;
}

// THE PART OF THE POSTER ALLOWED TO MOVE (migration 0055), or null for "all of it, and put
// none of it back".
//
// PARSED, NOT CAST, and here that matters more than anywhere else on this lane: the rectangle
// is handed to ffmpeg's encode and to a full-frame alpha build, so an arbitrary object in a
// hand-edited row would reach a paid render rather than being refused at the door. Null — every
// other lane, every run made before the control existed, and every officer who simply did not
// mark one — means the restore does not run at all and the clip is stored exactly as it has
// always been. See MotionRegionSchema for why there is no defensible default.
function motionRegionOf(row: GenerationRow): MotionRegion | null {
  if (row.motionRegion === null || row.motionRegion === undefined) return null;
  const parsed = MotionRegionSchema.safeParse(row.motionRegion);
  if (!parsed.success) {
    console.warn(
      `[job ${row.id}] ignoring an unreadable motion_region on the row:`,
      parsed.error.issues,
    );
    return null;
  }
  // A rectangle covering the whole poster marks everything as moving, which leaves nothing to
  // freeze — so it is the same request as no region, and doing it the long way would cost an
  // encode to produce the picture that already came back.
  return isWholeClipCrop(parsed.data) ? null : parsed.data;
}

// HOW BIG THE FRAME COMES BACK, asked for rather than accepted.
//
// A video model REPAINTS every pixel it returns — it does not preserve the officer's Devanagari,
// it redraws it — so the number of pixels it renders is the ceiling on how much of their text can
// survive. This lane had been sending no resolution at all and taking the model's own default,
// which on a 4:5 poster meant a 720-wide render: a ~26px card line arrives at ~15px, and a matra
// at two or three. That is why the headline reads and the small print does not.
//
// A REQUEST FIELD, not a sentence. The brief once carried a pixel size and it was the one thing
// the render could never honour (the 2026-09-03 milestone), so it belongs in the body where the
// learned-capability ladder can drop it if the model refuses — and say so in the log.
//
// Read in ONE place, here, because it is this lane's decision: /new-video-workflow deliberately
// passes nothing and is unchanged. Unset means 1080p, mirroring veo-client's resolutionSetting;
// `default` or `none` sends no resolution at all, which is the one-line rollback to this lane's
// behaviour before today and does not need a code change on a day it is already misbehaving.
function motionResolutionSetting(): string | null {
  const raw = process.env.GEMINI_VIDEO_RESOLUTION?.trim();
  if (raw === undefined || raw === '') return '1080p';
  return raw.toLowerCase() === 'default' || raw.toLowerCase() === 'none'
    ? null
    : raw;
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
): Promise<{
  png: Buffer;
  width: number;
  height: number;
  label: string;
  ratio: number;
  requestLabel: string | null;
}> {
  // THE POSTER'S OWN RATIO, SNAPPED TO A NAME THE WIRE CAN CARRY.
  //
  // Only on 'source', because the two fixed frames already ARE listed labels. A poster designed
  // to a standard frame (1280x1600) snaps to 4:5 exactly, so nothing is padded and the request
  // names the shape the officer designed in. A hand-cropped scan snaps to the nearest listed
  // label and is padded the last percent into it, which is strictly better than either sending
  // `15:19` — one 400 poisons the aspect-ratio rung for every later render in this worker — or
  // sending nothing and letting the model outpaint.
  //
  // NULL is a full answer: a banner or a panorama snaps to nothing, pads to its own ratio and
  // sends no label, which is this lane's behaviour byte for byte before today.
  const snapped =
    aspect === 'source' ? snapMotionAspect(source.width, source.height) : null;
  const ratio = snapped
    ? snapped.ratio
    : motionAspectRatio(aspect, source.width, source.height);
  const framed = await fitImageToAspect(source.png, ratio);
  return {
    png: framed.png,
    // The size of the image the model is actually handed — which is NOT source.width/height
    // whenever normalizeSourceImage bound the long edge, since it returns pre-bound dimensions
    // with bound bytes. Carried out because it is the size everything downstream must measure
    // against.
    width: framed.width,
    height: framed.height,
    // Named from the FRAMED image, so the ratio the prompt states and the ratio the model is
    // looking at are the same number by construction.
    label: aspectRatioLabel(framed.width, framed.height),
    // Carried out so the crop on the way back uses the very number the prompt asked for. See
    // cropRenderedClip below.
    ratio,
    // What goes on the wire, or null for "ask for no particular shape".
    requestLabel: snapped ? snapped.label : aspect === 'source' ? null : aspect,
  };
}

// THE SAME FRAME, TAKEN BACK ON THE WAY OUT.
//
// The padding above settles the shape of the image the model is HANDED, and the prompt tells it
// so in as many words. It renders 9:16 anyway — a real 4:5 poster came back with ~190px of
// invented sky above it and a smeared strip below its footer, the model outpainting the artwork
// to fill a frame it had already been told not to change. So the ratio is measured and cropped
// back rather than requested twice.
//
// BEST EFFORT, exactly like the GIF below and for the same reason: the clip is the paid
// artifact. A framing fix that fails must hand back a badly-framed video, never no video.
//
// AND, WHEN THE OFFICER MARKED A MOVING REGION, THE TEXT IS PUT BACK IN THE SAME PASS.
//
// A video model repaints every pixel it returns — it does not preserve their Devanagari, it
// redraws it — which is legible on a headline and garbled on a 26px card line. That is this
// lane's reported defect and no sentence fixes it; MOTION_BRIEF already asks for the text to be
// left alone. So with a region marked, the clip is reframed, scaled back to the poster's own
// size and the poster itself composited over every frame except that rectangle. See
// restoreSourceOverClip.
async function cropRenderedClip(
  id: string,
  bytes: Buffer,
  ratio: number,
  framed: Readonly<{ png: Buffer; width: number; height: number }>,
  region: MotionRegion | null,
): Promise<Buffer> {
  try {
    const crop =
      region === null
        ? await cropVideoToAspect(bytes, ratio)
        : await restoreSourceOverClip(bytes, ratio, {
            png: framed.png,
            // THE FRAMED SIZE, NEVER normalizeSourceImage's. That function reports the
            // officer's PRE-BOUND dimensions beside bytes whose long edge it capped at 2048, so
            // on a 4000px export the two differ by ~1.95x — a mis-scale that looks perfectly
            // plausible in a thumbnail and is only obvious against the text it was meant to
            // save. The overlay builder re-measures the bytes and refuses a mismatch, but the
            // right number is this one.
            width: framed.width,
            height: framed.height,
            hole: region,
          });
    // UNCONDITIONAL, and this is the line that says whether asking for a resolution worked. It
    // used to speak only when it cropped, so a render that came back at the model's own shape —
    // the case where the officer's text is being lost — logged nothing at all. `source` is what
    // the model returned; the second pair is what was stored.
    console.log(
      `[job ${id}] gemini returned ${crop.source.width}x${crop.source.height}; ` +
        `stored ${crop.width}x${crop.height} (${crop.cropped ? 'cropped' : 'as returned'}` +
        `${region === null ? '' : ', poster restored outside the marked region'}).`,
    );
    return crop.mp4;
  } catch (error) {
    // Named with the byte length, so a clip ffmpeg could not read stays attributable: a
    // truncated download and a clip in an unexpected container fail the same way otherwise.
    //
    // BEST EFFORT ON BOTH BRANCHES, including the restore — this is a correction applied on the
    // way out of a render the department has already been billed for, so a failure hands back a
    // clip whose text is garbled rather than no clip at all. Loud in the log, because a silently
    // un-restored render looks exactly like the defect this phase exists to remove.
    console.error(
      `[job ${id}] clip ${region === null ? 'crop' : 'restore'} failed on ` +
        `${bytes.length} bytes, storing it unchanged:`,
      error,
    );
    return bytes;
  }
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

// One finished clip, written as version N: the MP4 first, then its GIF.
//
// Shared by the two things that produce a version — a model render and the officer's hand trim
// — so both land on the same versioned paths under the same GIF policy. It deliberately does
// NOT touch the row: only the caller knows whether what it just made should also advance the
// Gemini chain point, and a trim must not.
//
// THE GIF IS BEST EFFORT, and deliberately derived after the MP4 is safely stored. The clip is
// the artifact the department paid for; the GIF is a convenience copy, and an ffmpeg failure
// must never cost a render they have already been billed for.
async function storeMotionClip(
  client: SupabaseClient,
  id: string,
  version: number,
  clip: Buffer,
): Promise<{ motionPath: string; motionGifPath: string | null }> {
  const videoPath = motionPath(id, version);
  await uploadFile(client, VIDEOS_BUCKET, videoPath, clip, 'video/mp4');

  let gifPath: string | null = null;
  try {
    // From the stored clip itself, so the two artifacts are always the same picture.
    const gif = await mp4ToGif(clip);
    gifPath = motionGifPath(id, version);
    await uploadFile(client, VIDEOS_BUCKET, gifPath, gif, 'image/gif');
  } catch (error) {
    gifPath = null;
    console.error(`[job ${id}] GIF conversion failed:`, error);
  }

  return { motionPath: videoPath, motionGifPath: gifPath };
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
    // FIELDS, NOT SENTENCES. The prompt already says the frame is to be used as it is and the
    // model outpaints anyway; these are the same two requests made where the API can answer
    // them, and where the ladder can drop either one and log which. Both null send nothing,
    // which is this lane's request exactly as before.
    aspectRatio: framed.requestLabel,
    resolution: motionResolutionSetting(),
    // No `videoTask`, deliberately: this lane's source image genuinely IS the thing being
    // animated, so the inferred task is the right one, and declaring it would put a second
    // variable into a paid comparison.
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

  const clip = await cropRenderedClip(
    id,
    bytes,
    framed.ratio,
    framed,
    // Off the ROW, like the aspect above and for the same reason: a follow-up writes a fresh
    // prompt but must not quietly stop protecting the text the officer already approved.
    motionRegionOf(row),
  );
  const written = await storeMotionClip(client, id, input.version, clip);

  await updateGeneration(client, id, {
    motionPath: written.motionPath,
    motionGifPath: written.motionGifPath,
    // THE CHAIN POINT, advanced only now — after a clip exists. See the header.
    motionInteractionId: finished.id ?? interactionId,
  });

  return written;
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

// Devanagari digits, for the one piece of text this file writes that an officer READS: the
// label under a trimmed version in the strip. Everything else here is a machine key.
function devanagariNumber(value: number): string {
  return String(value).replace(
    /[0-9]/g,
    (digit) => '०१२३४५६७८९'[Number(digit)] ?? digit,
  );
}

// What the version strip shows beside a trimmed version. It has to say something — the strip
// falls back to "पहिली आवृत्ती" on a null direction, which would be plainly wrong here — and
// the share of each side that was kept is the only thing about a trim worth recording: it is
// what tells the officer, weeks later, which of three versions is the close crop.
//
// The branding is named too, when it was stamped: two trims of the same rectangle, one branded
// and one not, are otherwise indistinguishable in a list the officer has to read.
function motionCropLabel(
  crop: MotionCrop,
  options: Readonly<{ chrome: boolean; sourceVersion: number | null }>,
): string {
  const width = devanagariNumber(Math.round(crop.width * 100));
  const height = devanagariNumber(Math.round(crop.height * 100));
  const parts = [`क्रॉप — रुंदी ${width}%, उंची ${height}%`];
  if (options.chrome) parts.push('लोगो व फूटरसह');
  // Only when it is NOT the current clip: on the ordinary trim it would say the obvious, and
  // on a re-cut of an older version it is the one thing the strip cannot otherwise show.
  if (options.sourceVersion !== null) {
    parts.push(`आवृत्ती ${devanagariNumber(options.sourceVersion)} वरून`);
  }
  return parts.join(' · ');
}

// Which stored clip the officer drew their rectangle over.
//
// An INDEX into this run's own version list, never a path off the wire: it can only ever name
// something this run already produced. Out of range is a genuine 4xx and is refused by the
// route, so reaching this with one is a bug rather than an officer's mistake — it throws
// rather than quietly cutting whatever the current clip happens to be, which would hand back
// a trim of the wrong picture.
async function motionSourcePath(
  client: SupabaseClient,
  row: GenerationRow,
  sourceVersion: number | undefined,
): Promise<string> {
  // The row's CURRENT clip. Read off the row rather than the list so a trim queued behind a
  // follow-up cuts whatever that follow-up produced.
  if (sourceVersion === undefined) {
    if (!row.motionPath) {
      throw new Error(`Generation ${row.id} has no clip to crop yet.`);
    }
    return row.motionPath;
  }
  const revisions = await listRevisions(client, row.id);
  const versions = motionVersionsOf(row, revisions);
  const chosen = versions[sourceVersion - 1];
  if (!chosen) {
    throw new Error(
      `Generation ${row.id} has no version ${sourceVersion} to crop.`,
    );
  }
  return chosen.path;
}

// THE HAND TRIM: cut the finished clip down to a rectangle the officer drew over it.
//
// Local ffmpeg and nothing else — no model call, nothing billed — so unlike every other button
// on this card it can be pressed as often as they like. It is still a JOB rather than a
// synchronous route because it downloads, re-encodes, re-derives the GIF and uploads two
// objects: seconds, not milliseconds, and the card already knows how to show a busy row.
//
// IT MAY CUT ANY VERSION, not only the current one: a rectangle is drawn over whatever clip is
// on screen, and the strip lets the officer go back to one. The result is still appended as a
// NEW version — versions here are immutable and the newest is always current — so re-cutting an
// older clip costs nothing that already exists.
//
// AND IT MAY STAMP THE BRANDING, which no other path on this lane does. See the header: a trim
// is the one operation that removes the source poster's own chrome, so what would be a
// duplicate everywhere else is a replacement here. The officer decides, in the crop selector,
// by looking at the preview — and the stamp lands at the very fractions of the frame that
// preview drew them at, or their judgement about the rectangle would have been worthless.
//
// TWO DIFFERENCES FROM A FOLLOW-UP RENDER, both deliberate:
//
//   The crop is NOT best effort. `cropRenderedClip` above swallows a failure because framing is
//   a correction applied to something the department has already paid for; here the trim IS the
//   request, so a failure must be reported rather than quietly handing back the untrimmed clip
//   as though it had been honoured. `armEditRetry` keeps the previous version on screen either
//   way, so the officer loses nothing but the attempt.
//
//   It does NOT advance `motionInteractionId`. The chain point names the model's own last
//   video, and the model knows nothing about a trim performed on our side — so a later AI
//   follow-up legitimately continues from the untrimmed clip and comes back at full frame. That
//   is a property of the conversation, not a bug to route around, and the crop panel says so.
export function startMotionCropJob(
  client: SupabaseClient,
  id: string,
  crop: MotionCrop,
  options: Readonly<{ chrome?: boolean; sourceVersion?: number }> = {},
): void {
  // An EDIT of a run that has already produced something: a failure must leave the existing
  // clip and every earlier version in place and reportable, not mark the row failed and hide
  // the lot.
  armEditRetry(id, () => startMotionCropJob(client, id, crop, options));
  runJob(client, id, 'dynamic_poster_crop', async () => {
    const row = await getGeneration(client, id);
    if (!row) throw new Error(`Generation ${id} not found.`);
    if (!row.motionPath) {
      throw new Error(`Generation ${id} has no clip to crop yet.`);
    }

    await updateGeneration(client, id, {
      status: 'running',
      step: 'motion_crop',
      error: null,
    });

    // WHICHEVER version the officer drew the box over — the current clip unless they had gone
    // back through the strip. Read from Storage here rather than passed in because a trim
    // queued behind a follow-up must resolve against the row as it stands when it runs.
    const sourcePath = await motionSourcePath(
      client,
      row,
      options.sourceVersion,
    );
    const currentClip = await downloadFile(client, VIDEOS_BUCKET, sourcePath);
    const trimmed = await cropVideoToRect(currentClip, crop, {
      // The officer's own answer, taken while they were looking at the preview. Stamping it
      // here rather than leaving the clip bare is what makes the crop selector's overlay a
      // decision instead of a picture: a trim cuts the source poster's own branding away, and
      // the rectangle they chose was chosen against where this lands.
      chrome: options.chrome === true,
    });
    if (!trimmed.cropped) {
      // Unreachable through the route, which refuses a whole-clip selection before starting a
      // job at all. Reported rather than written as an identical version, because a version
      // that changed nothing is noise in a history the officer has to read.
      throw new Error(
        `Generation ${id}: the selection covers the whole clip, so there was nothing to crop.`,
      );
    }
    console.log(
      `[job ${id}] trimmed the clip to ${trimmed.width}x${trimmed.height}.`,
    );

    const version = await nextMotionVersion(client, id);
    const stored = await storeMotionClip(client, id, version, trimmed.mp4);

    await updateGeneration(client, id, {
      motionPath: stored.motionPath,
      motionGifPath: stored.motionGifPath,
    });

    // Logged AFTER the objects exist, so a failed trim adds no version — the log is the history
    // the detail page lists, and an entry with no object behind it would be a dead thumbnail.
    await insertRevision(client, {
      generationId: id,
      target: 'motion',
      feedback: motionCropLabel(crop, {
        chrome: options.chrome === true,
        sourceVersion:
          sourcePath === row.motionPath
            ? null
            : (options.sourceVersion ?? null),
      }),
      motionPath: stored.motionPath,
      motionGifPath: stored.motionGifPath,
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
