// Cropping a rendered clip: automatically, back to the aspect ratio the officer asked for
// (cropVideoToAspect), and by hand, to a rectangle they drew over it (cropVideoToRect).
//
// WHY THIS EXISTS.
//
// aspect-fit.ts guarantees the shape of the image the video model is HANDED; nothing guaranteed
// the shape of what it hands back. gemini-omni returns 720x1280 (9:16) whatever it is given, so
// a 4:5 poster came back with roughly 190px of invented sky above it and a smeared strip below
// its footer — the model OUTPAINTING the poster to fill a frame nobody could talk it out of.
// The prompt already says the input is exactly the right ratio and forbids re-framing; it is
// ignored, and a stronger sentence has been tried on this lane once already.
//
// So the ratio is taken back deterministically instead of asked for: measure what came back,
// crop the centred rectangle of the requested ratio, keep the audio. Instruct, then guarantee —
// the same move fitImageToAspect makes on the way in.
//
// CENTRED, and that is an assumption rather than a contract. Measured across two real renders
// of the same poster the model outpaints symmetrically, but the artwork's own position drifted
// ~17px between them, so this is right to within a couple of percent rather than exact. It is
// deliberately not tightened by hunting for the poster's edges in the frame: the padding
// fitImageToAspect adds is filled FROM the poster's own edge and is meant to be
// indistinguishable from it, so an edge detector would be looking for a boundary the rest of
// this lane works to hide. If the drift ever bites, the fix is to pad the source to the model's
// native ratio before sending, which makes the rectangle known rather than assumed.
//
// AND THE HAND TRIM. Getting the frame right is not the same as getting the CROP right: a
// department often wants one panel of a poster moving on its own, and no ratio names that
// rectangle. So cropVideoToRect takes the box itself. It shares everything below the decision —
// the probe, the even-pixel rules and the encode — so a hand-trimmed clip is the same kind of
// file as an automatically reframed one, which is what lets both go through mp4ToGif and into
// the same versioned storage path without a second set of rules.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { socialChromeLayers } from '../twitter-chrome.js';
import { resolveFfmpeg } from './assemble.js';
import { buildFrozenSourceOverlay } from './source-overlay.js';

const execFileAsync = promisify(execFile);

const CROP_TIMEOUT_MS = 300_000;
const CROP_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * How close the clip already has to be for it to be returned untouched. Half a percent, matching
 * aspect-fit.ts — well inside the rounding an even-dimension crop introduces, and far tighter
 * than anything visible. Returning the input unchanged also means no second encode of a clip
 * that was already the right shape.
 */
const ASPECT_TOLERANCE = 0.005;

export type VideoCrop = Readonly<{
  mp4: Buffer;
  width: number;
  height: number;
  /** False when the clip already had the target shape and the bytes came back untouched. */
  cropped: boolean;
  /**
   * What came IN — the probed size of the clip before anything here touched it.
   *
   * Reported because on the Dynamic Poster lane it is the one number that says whether the
   * render was asked for at a useful size and got it: a video model repaints every pixel, so
   * pixels it never rendered are resolution the officer's Devanagari cannot get back. Without
   * this, a clip that arrived small and was merely cropped is indistinguishable from one that
   * arrived large — and the lane's logging only ever spoke when it cropped.
   */
  source: { width: number; height: number };
}>;

/**
 * A rectangle as fractions of the clip's own width and height, which is the only way a box
 * drawn over a scaled `<video>` in a browser can name a region of the real frame. `x`/`y` are
 * its top-left corner. The same 0..1 convention FeedbackRegion uses on a poster.
 */
export type NormalizedRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

/** Options for the hand trim. */
export type CropRectOptions = Readonly<{
  /**
   * Burn the DGIPR badge and footer band onto the trimmed frame, where the crop preview showed
   * them. Off by default: a Dynamic Poster is deliberately unbranded, its source being a poster
   * that already carries the department's chrome.
   */
  chrome?: boolean;
}>;

/** A rectangle in real pixels, already even on every side. */
type PixelCrop = Readonly<{
  width: number;
  height: number;
  left: number;
  top: number;
}>;

/** Largest even number at or below n — yuv420p subsamples chroma and rejects odd dimensions. */
function evenDown(n: number): number {
  const floored = Math.max(0, Math.floor(n));
  return floored - (floored % 2);
}

/** An even width or height, never zero. */
function evenSize(n: number): number {
  return Math.max(2, evenDown(n));
}

/** An even offset, which unlike a size legitimately IS zero on the axis that is not cropped. */
function evenOffset(n: number): number {
  return evenDown(n);
}

// Read the video stream's dimensions out of ffmpeg's own metadata log. ffmpeg-static ships no
// ffprobe, so this is the pattern assemble.ts already uses — except that it must THROW rather
// than fall back to a guess: a wrong size here would crop the officer's artwork off centre,
// which is worse than not cropping at all.
async function probeVideoSize(
  path: string,
): Promise<{ width: number; height: number; durationSeconds: number | null }> {
  const { stderr } = await execFileAsync(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { timeout: 60_000, maxBuffer: CROP_MAX_BUFFER },
  );
  const match = String(stderr).match(
    /Stream #.*Video:[^\r\n]*?(\d{2,5})x(\d{2,5})(?:\s|\[|,)/,
  );
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Could not read the clip’s dimensions from ffmpeg.');
  }
  // The container's own duration, off the same log. Only ever used to BOUND a looped still
  // (below), so an unreadable one is not fatal — it costs the bound, never the crop.
  const duration = String(stderr).match(
    /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/,
  );
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 +
      Number(duration[2]) * 60 +
      Number(duration[3])
    : Number.NaN;
  return {
    width,
    height,
    durationSeconds:
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : null,
  };
}

// One still to burn onto every frame of the cropped clip, already placed in its pixels.
type CropOverlay = Readonly<{ path: string; x: number; y: number }>;

// The one place the crop is actually performed, shared by both entry points below so the two
// cannot drift in encode settings — a clip cropped to a ratio on the way out of a render and
// one an officer trimmed by hand afterwards must be the same kind of file.
//
// The overlays are composited IN THE SAME PASS as the crop rather than by a second ffmpeg run
// over the trimmed file. Two encodes would cost a generation of quality for a picture one
// encode can produce, and they are placed against the CROPPED frame, which this is the only
// place that knows the size of.
async function encodeCrop(
  inputPath: string,
  outputPath: string,
  crop: PixelCrop,
  overlays: readonly CropOverlay[] = [],
  clipSeconds: number | null = null,
  scale: Readonly<{ width: number; height: number }> | null = null,
): Promise<Buffer> {
  const inputArgs: string[] = ['-i', inputPath];
  // The base chain: crop, then optionally resize to the size the overlays were built at. The
  // scale lives HERE, inside the one pass, for the same reason the overlays do — a second
  // ffmpeg run would mean decode, scale, ENCODE, decode, overlay, ENCODE, spending two libx264
  // generations over exactly the small Devanagari the resize is being done to save.
  //
  // `lanczos` matches motion-gif.ts's downscale and `setsar=1` matches assemble.ts: a provider
  // clip can carry a non-square sample aspect, and an overlay composited onto a frame whose
  // pixels are not square lands stretched relative to it.
  const resize =
    scale === null
      ? ''
      : `,scale=${scale.width}:${scale.height}:flags=lanczos,setsar=1`;
  const chains: string[] = [
    `[0:v]crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}${resize}[base]`,
  ];
  let stage = 'base';

  // A SCALE MAY NEVER CHANGE THE SHAPE. Stretching a poster by a couple of percent does not
  // read as a bug — it reads as a slightly different typeface — so it would ship, and it would
  // ship on the one lane whose entire promise is the officer's artwork intact. Checked before
  // the exec, so nothing is spent finding out.
  if (scale !== null) {
    const cropRatio = crop.width / crop.height;
    const scaleRatio = scale.width / scale.height;
    if (Math.abs(scaleRatio - cropRatio) / cropRatio > ASPECT_TOLERANCE) {
      throw new Error(
        `Refusing to scale ${crop.width}x${crop.height} to ${scale.width}x${scale.height}: ` +
          `that would stretch the picture (${cropRatio.toFixed(4)} to ${scaleRatio.toFixed(4)}).`,
      );
    }
  }

  for (const [index, overlay] of overlays.entries()) {
    // LOOPED, and that is load-bearing rather than tidy. A PNG handed to ffmpeg as a plain
    // `-i` is a video stream of exactly ONE frame, so `shortest=1` ends the overlay — and
    // therefore the whole graph — after that frame. The audio is mapped separately and copied
    // in full, so the result is a clip of the right duration, with sound, frozen on its first
    // frame: valid, playable, and wrong in the one way nothing here was measuring. `-loop 1`
    // makes the still last, `-t` bounds it (longer than the footage, so `shortest=1` still ends
    // the output on the FOOTAGE), and `-framerate 25` stops it being decoded at 1 fps. This is
    // exactly the input assemble.ts builds for its caption stills, for the same reason.
    inputArgs.push(
      '-framerate',
      '25',
      '-loop',
      '1',
      // Omitted when the container would not say how long it is: an infinite still is ended by
      // `shortest=1` anyway, whereas a `-t` guessed too short would TRUNCATE the officer's clip.
      ...(clipSeconds !== null ? ['-t', clipSeconds.toFixed(3)] : []),
      '-i',
      overlay.path,
    );
    const next = `o${index}`;
    chains.push(
      `[${stage}][${index + 1}:v]overlay=${overlay.x}:${overlay.y}:shortest=1[${next}]`,
    );
    stage = next;
  }

  await execFileAsync(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...inputArgs,
      '-filter_complex',
      chains.join(';'),
      '-map',
      `[${stage}]`,
      // Optional: a provider clip need not carry an audio track, and `-map 0:a` on one that
      // does not is a hard failure rather than a silent skip. With a filter graph in play
      // there is no implicit stream selection left to fall back on.
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      // Copied, not re-encoded: the crop is a video-only operation and the provider's track
      // is the only copy of it.
      '-c:a',
      'copy',
      // Metadata at the front, so the clip starts playing in the browser before it has
      // finished downloading — the same reason assemble.ts sets it.
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { timeout: CROP_TIMEOUT_MS, maxBuffer: CROP_MAX_BUFFER },
  );

  const cropped = await readFile(outputPath);
  if (cropped.length === 0) {
    throw new Error('ffmpeg produced an empty clip.');
  }
  return cropped;
}

/**
 * The department's badge and footer band, written to `dir` and placed against a cropped frame
 * of `width` x `height`, ready to hand to `encodeCrop`.
 *
 * THE PLACEMENT IS THE CROP PREVIEW'S, and it has to stay that way: the officer decides whether
 * a rectangle is the right one by looking at where the branding lands on it, so a stamp that
 * sat anywhere else would make that judgement worthless. Both graphics come from
 * socialChromeLayers, which derives them from the SOCIAL_LOCKUP_* ratios the browser overlay
 * reads out of the same module — the badge inset from the top and right by a fraction of the
 * WIDTH on both axes, the band flush along the bottom at full width.
 *
 * The band is clamped rather than allowed to overhang: a very short trim (a strip along the
 * foot of a poster) can be shorter than the band is tall, and the preview clips it to the
 * selection with `overflow: hidden`, so this crops it to what fits from its own bottom edge.
 */
async function writeChromeOverlays(
  dir: string,
  width: number,
  height: number,
): Promise<CropOverlay[]> {
  const chrome = await socialChromeLayers(width);
  const overlays: CropOverlay[] = [];

  const bandHeight = Math.min(chrome.footer.height, height);
  const footerPath = join(dir, 'chrome-footer.png');
  await writeFile(
    footerPath,
    bandHeight === chrome.footer.height
      ? chrome.footer.png
      : await sharp(chrome.footer.png)
          .extract({
            left: 0,
            top: chrome.footer.height - bandHeight,
            width: chrome.footer.width,
            height: bandHeight,
          })
          .png()
          .toBuffer(),
  );
  overlays.push({ path: footerPath, x: 0, y: height - bandHeight });

  // Only when it fits. A badge wider or taller than the rectangle would be drawn clipped at
  // the frame edge and read as a rendering fault, where the preview simply hides it.
  const logoLeft = width - chrome.logo.width - chrome.margin;
  const logoTop = chrome.margin;
  if (logoLeft >= 0 && logoTop + chrome.logo.height <= height) {
    const logoPath = join(dir, 'chrome-logo.png');
    await writeFile(logoPath, chrome.logo.png);
    overlays.push({ path: logoPath, x: logoLeft, y: logoTop });
  }

  return overlays;
}

/**
 * The centred rectangle of `targetRatio` inside a `width` x `height` frame, even on every side.
 *
 * Shared by the automatic reframe and the source restore below so the two cannot drift: they
 * must take the SAME pixels out of the same clip, or a restore would composite the officer's
 * poster over a differently-framed picture and every frozen pixel would land a few pixels off
 * what the model rendered under it.
 *
 * It crops the dimension that is too generous and never enlarges one that is already short.
 */
function centredCropForRatio(
  width: number,
  height: number,
  targetRatio: number,
): PixelCrop {
  const ratio = width / height;
  const cropWidth =
    ratio > targetRatio ? evenSize(height * targetRatio) : evenSize(width);
  const cropHeight =
    ratio > targetRatio ? evenSize(height) : evenSize(width / targetRatio);
  return {
    width: cropWidth,
    height: cropHeight,
    left: evenOffset((width - cropWidth) / 2),
    top: evenOffset((height - cropHeight) / 2),
  };
}

/**
 * Returns the clip cropped to `targetRatio` (width / height), centred. Throws on an ffmpeg
 * failure — the CALLER decides whether that is fatal; in the Dynamic Poster job it is not,
 * because the MP4 is the paid artifact and a framing fix must never lose a render.
 */
export async function cropVideoToAspect(
  mp4: Buffer,
  targetRatio: number,
): Promise<VideoCrop> {
  if (!(targetRatio > 0) || !Number.isFinite(targetRatio)) {
    throw new Error(`Invalid target aspect ratio: ${targetRatio}`);
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-motion-crop-'));
  try {
    const inputPath = join(dir, 'clip.mp4');
    const outputPath = join(dir, 'cropped.mp4');
    await writeFile(inputPath, mp4);

    const { width, height } = await probeVideoSize(inputPath);
    const ratio = width / height;
    if (Math.abs(ratio - targetRatio) / targetRatio <= ASPECT_TOLERANCE) {
      return {
        mp4,
        width,
        height,
        cropped: false,
        source: { width, height },
      };
    }

    // Crop the dimension that is too generous; NEVER SCALE, and never enlarge one that is
    // already short — the whole promise of this lane is the officer's artwork intact. (The
    // restore below does scale, deliberately and under a stretch guard; this one does not, and
    // that difference is the contract callers rely on.)
    const crop = centredCropForRatio(width, height, targetRatio);

    const cropped = await encodeCrop(inputPath, outputPath, crop);
    return {
      mp4: cropped,
      width: crop.width,
      height: crop.height,
      cropped: true,
      source: { width, height },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A tolerance for the officer's own rectangle, matching FeedbackRegionSchema's: a box dragged
// to the very edge of a scaled `<video>` lands on 1.0000001 as often as on 1, and refusing
// that would be refusing the most ordinary gesture there is.
const RECT_EPSILON = 0.001;

function assertFraction(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Crop ${name} must be a fraction between 0 and 1: ${value}`,
    );
  }
}

/**
 * Returns the clip cropped to an ARBITRARY rectangle the officer drew over it, given as
 * fractions of the clip's own width and height.
 *
 * This is the hand-trim beside `cropVideoToAspect`'s automatic reframe, and the difference in
 * stance matters to the caller: the automatic one is a correction applied on the way out of a
 * paid render and is best-effort there, while this one IS the requested action — if it fails,
 * nothing was done and the caller must say so rather than hand back the untrimmed clip as
 * though the request had been honoured.
 *
 * Nothing is scaled and nothing is padded: the output is exactly the pixels inside the
 * rectangle, so the officer's artwork is never resampled by a trim. The audio track is copied
 * through untouched.
 *
 * With `chrome`, the department's badge and footer band are burned onto the trimmed frame in
 * the same encode, at the fractions of it the crop preview drew them at. That is the officer's
 * own answer to a question only a trim raises: this lane's source is finished artwork that
 * already carries its branding, and cutting one panel out of it leaves that branding outside
 * the rectangle.
 */
export async function cropVideoToRect(
  mp4: Buffer,
  rect: NormalizedRect,
  options: CropRectOptions = {},
): Promise<VideoCrop> {
  assertFraction(rect.x, 'x');
  assertFraction(rect.y, 'y');
  assertFraction(rect.width, 'width');
  assertFraction(rect.height, 'height');
  if (!(rect.width > 0) || !(rect.height > 0)) {
    throw new Error('Crop rectangle has no area.');
  }
  if (
    rect.x + rect.width > 1 + RECT_EPSILON ||
    rect.y + rect.height > 1 + RECT_EPSILON
  ) {
    throw new Error('Crop rectangle falls outside the clip.');
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-motion-trim-'));
  try {
    const inputPath = join(dir, 'clip.mp4');
    const outputPath = join(dir, 'cropped.mp4');
    await writeFile(inputPath, mp4);

    const { width, height, durationSeconds } = await probeVideoSize(inputPath);
    // The frame's own usable extent: yuv420p subsamples chroma, so an odd-sized source (rare,
    // but not impossible from a provider) can only be cropped to the even size inside it.
    const frameWidth = evenSize(width);
    const frameHeight = evenSize(height);

    // Sizes first, then offsets pulled back inside the frame. Doing it in that order is what
    // makes rounding safe: evening a size UP and an offset DOWN can otherwise put the right
    // edge one or two pixels past the source, which ffmpeg rejects outright ("Invalid too big
    // or non positive size for width/height") — and a failed trim after the officer has drawn
    // their box is a defect they cannot work around.
    const cropWidth = Math.min(evenSize(rect.width * width), frameWidth);
    const cropHeight = Math.min(evenSize(rect.height * height), frameHeight);
    const left = Math.min(evenOffset(rect.x * width), frameWidth - cropWidth);
    const top = Math.min(evenOffset(rect.y * height), frameHeight - cropHeight);

    // The whole frame: re-encoding here would cost a generation of quality to produce the same
    // picture. The caller is told nothing happened rather than being handed a silent no-op.
    // Chrome is the exception — stamping it IS a change to the picture, so a full-frame
    // rectangle still has work to do.
    const overlays = options.chrome
      ? await writeChromeOverlays(dir, cropWidth, cropHeight)
      : [];
    if (
      cropWidth === frameWidth &&
      cropHeight === frameHeight &&
      overlays.length === 0
    ) {
      return {
        mp4,
        width,
        height,
        cropped: false,
        source: { width, height },
      };
    }

    const cropped = await encodeCrop(
      inputPath,
      outputPath,
      {
        width: cropWidth,
        height: cropHeight,
        left,
        top,
      },
      overlays,
      // Two seconds of slack, so the still always outlasts the footage and `shortest=1` ends
      // the output on the footage rather than on the still.
      durationSeconds === null ? null : durationSeconds + 2,
    );
    return {
      mp4: cropped,
      width: cropWidth,
      height: cropHeight,
      cropped: true,
      source: { width, height },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * What the officer's own poster looks like and where it is allowed to move, for
 * `restoreSourceOverClip`.
 */
export type FrozenSource = Readonly<{
  /** The poster EXACTLY as it was sent to the model — padded bars and all. */
  png: Buffer;
  /**
   * Its real pixel size.
   *
   * THIS IS `fitImageToAspect`'S OWN WIDTH/HEIGHT, NEVER `normalizeSourceImage`'S. That
   * function deliberately reports the officer's PRE-BOUND dimensions alongside bytes whose long
   * edge it has capped at 2048, so on a 4000px export the two differ by 1.95x — and a 1.95x
   * mis-scale is exactly the kind of error that looks plausible in a thumbnail and is only
   * obvious against the text it was meant to save. `buildFrozenSourceOverlay` re-measures the
   * bytes and throws on a mismatch rather than trusting this.
   */
  width: number;
  height: number;
  /** The part of the poster that may MOVE, as fractions of its own width and height. */
  hole: NormalizedRect;
}>;

/**
 * Returns the clip reframed to `targetRatio`, scaled back up to the poster's own size, with that
 * poster composited over every frame except a feathered hole where the motion shows through.
 *
 * WHY. A video model repaints every pixel it returns, so the officer's Devanagari comes back
 * redrawn rather than preserved — legible on a headline, garbled on a 26px card line. Cropping
 * and asking nicely cannot fix that (see the header); putting their own pixels back can. After
 * this, everything outside the marked rectangle is the officer's own artwork rather than the
 * model's rendering of it — to within one h.264 generation, which is a measured 3 levels out of
 * 255 and is not the same claim as byte equality. See source-overlay.ts.
 *
 * ONE PASS: crop, scale, overlay, encode. See `encodeCrop`.
 *
 * BEST EFFORT AT THE CALL SITE, like `cropVideoToAspect` and unlike `cropVideoToRect`: this is a
 * correction applied on the way out of a paid render, so a failure must hand back the
 * un-restored clip rather than no clip. This function itself throws; the caller swallows.
 */
export async function restoreSourceOverClip(
  mp4: Buffer,
  targetRatio: number,
  source: FrozenSource,
): Promise<VideoCrop> {
  if (!(targetRatio > 0) || !Number.isFinite(targetRatio)) {
    throw new Error(`Invalid target aspect ratio: ${targetRatio}`);
  }

  const dir = await mkdtemp(join(tmpdir(), 'dgipr-motion-restore-'));
  try {
    const inputPath = join(dir, 'clip.mp4');
    const outputPath = join(dir, 'restored.mp4');
    await writeFile(inputPath, mp4);

    const { width, height, durationSeconds } = await probeVideoSize(inputPath);
    const crop = centredCropForRatio(width, height, targetRatio);

    // The output size: the poster's own, evened for yuv420p. Where evening moves it, the
    // POSTER is trimmed by that one row or column rather than resampled to fit — losing a pixel
    // off an edge is nothing, and resizing the whole poster to gain it would resample every
    // glyph on it, which is the exact thing this function exists to avoid.
    const outWidth = evenSize(source.width);
    const outHeight = evenSize(source.height);
    const overlayPng =
      outWidth === source.width && outHeight === source.height
        ? source.png
        : await sharp(source.png)
            .extract({ left: 0, top: 0, width: outWidth, height: outHeight })
            .png()
            .toBuffer();

    const overlayPath = join(dir, 'frozen-source.png');
    await writeFile(
      overlayPath,
      await buildFrozenSourceOverlay(
        overlayPng,
        { width: outWidth, height: outHeight },
        source.hole,
      ),
    );

    // NO NO-OP SHORTCUT HERE, and that is the point rather than an omission. `cropVideoToAspect`
    // returns the input untouched when the ratio already matches — which, now that the render is
    // asked for the right shape, is the NORMAL case. Taking that path with an overlay pending
    // would skip the restore entirely and report success: the officer's text still garbled,
    // nothing in the log, and a job that says it worked. `cropVideoToRect` already refuses the
    // same shortcut whenever it has chrome to stamp, for the same reason.
    const restored = await encodeCrop(
      inputPath,
      outputPath,
      crop,
      // Placed at the origin: the overlay is the full output frame, built at exactly the size
      // the scale produces.
      [{ path: overlayPath, x: 0, y: 0 }],
      // Two seconds of slack so the LOOPED still always outlasts the footage and `shortest=1`
      // ends the output on the footage. Without the loop this is a one-frame stream and the
      // whole graph ends on it — a clip of the right duration, with sound, frozen on frame 1.
      // This file has shipped that bug once; see encodeCrop.
      durationSeconds === null ? null : durationSeconds + 2,
      { width: outWidth, height: outHeight },
    );

    return {
      mp4: restored,
      width: outWidth,
      height: outHeight,
      cropped: true,
      source: { width, height },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/video/crop-video.ts
//
// It builds a real MP4 with the bundled ffmpeg and crops it, because the interesting failures
// here are not in the arithmetic on paper — they are in what ffmpeg accepts. An odd width, or
// an offset that puts the right edge one pixel past the source, is not a rounding wobble: it
// is "Invalid too big or non positive size for width/height" and a job that fails after the
// officer has already drawn their box. So every case below is MEASURED out of the encoded
// file rather than computed, and the fractions are deliberately awkward ones that do not land
// on even pixels by luck.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  // A 4:5 clip at the size this platform actually renders posters, one second long.
  const SOURCE_WIDTH = 1280;
  const SOURCE_HEIGHT = 1600;
  const dir = await mkdtemp(join(tmpdir(), 'dgipr-crop-harness-'));
  const sourcePath = join(dir, 'source.mp4');
  await execFileAsync(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${SOURCE_WIDTH}x${SOURCE_HEIGHT}:rate=25:duration=1`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sourcePath,
    ],
    { timeout: 120_000, maxBuffer: CROP_MAX_BUFFER },
  );
  const source = await readFile(sourcePath);

  // One row of the first frame, as raw pixels. The only way to show that an overlay actually
  // landed rather than that ffmpeg merely accepted the filter graph.
  const sampleRow = async (
    mp4: Buffer,
    at: Readonly<{ fromTop?: number; fromBottom?: number; late?: boolean }>,
  ): Promise<Buffer> => {
    const out = await mkdtemp(join(tmpdir(), 'dgipr-crop-frame-'));
    try {
      const clipPath = join(out, 'clip.mp4');
      const framePath = join(out, 'frame.png');
      await writeFile(clipPath, mp4);
      await execFileAsync(
        resolveFfmpeg(),
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          // `late` seeks past the start, which is what tells a still composited onto EVERY
          // frame from one composited onto the first — the two are identical on frame 1.
          ...(at.late ? ['-ss', '0.6'] : []),
          '-i',
          clipPath,
          '-frames:v',
          '1',
          framePath,
        ],
        { timeout: 60_000, maxBuffer: CROP_MAX_BUFFER },
      );
      const png = await readFile(framePath);
      const meta = await sharp(png).metadata();
      const height = meta.height ?? 0;
      const width = meta.width ?? 0;
      const top =
        at.fromTop !== undefined
          ? Math.min(at.fromTop, Math.max(0, height - 1))
          : Math.max(0, height - (at.fromBottom ?? 1));
      return await sharp(png)
        .extract({ left: 0, top, width, height: 1 })
        .raw()
        .toBuffer();
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  };

  // How many frames actually MOVE in what came back. Size alone cannot tell a cropped clip
  // from one frozen on its first frame, which is exactly the shape the branded trim shipped
  // in when its still was a single un-looped `-i` and `shortest=1` ended the graph on it.
  const countFrames = async (mp4: Buffer): Promise<number> => {
    const out = await mkdtemp(join(tmpdir(), 'dgipr-crop-frames-'));
    try {
      const path = join(out, 'clip.mp4');
      await writeFile(path, mp4);
      const { stdout } = await execFileAsync(
        resolveFfmpeg(),
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-an',
          '-f',
          'null',
          '-',
          '-progress',
          'pipe:1',
          '-nostats',
        ],
        { timeout: 120_000, maxBuffer: CROP_MAX_BUFFER },
      );
      const frames = String(stdout)
        .split(/[\r\n]+/)
        .filter((line) => line.startsWith('frame='))
        .pop();
      return Number(frames?.slice('frame='.length)) || 0;
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  };

  // What ffmpeg actually wrote, which is the only thing that proves a crop is legal.
  const measure = async (mp4: Buffer) => {
    const out = await mkdtemp(join(tmpdir(), 'dgipr-crop-out-'));
    try {
      const path = join(out, 'out.mp4');
      await writeFile(path, mp4);
      return await probeVideoSize(path);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  };

  try {
    // The reported shape of the ask: a panel out of the middle of a poster, on fractions that
    // land nowhere near an even pixel (0.337 x 1280 = 431.36, 0.412 x 1600 = 659.2).
    const panel = await cropVideoToRect(source, {
      x: 0.213,
      y: 0.157,
      width: 0.337,
      height: 0.412,
    });
    check(panel.cropped, 'a middle panel reported itself as uncropped');
    check(
      panel.width % 2 === 0 && panel.height % 2 === 0,
      `crop is not even-sided: ${panel.width}x${panel.height}`,
    );
    check(
      panel.width === 430 && panel.height === 658,
      `expected 430x658 from the panel fractions, got ${panel.width}x${panel.height}`,
    );
    const panelSize = await measure(panel.mp4);
    check(
      panelSize.width === panel.width && panelSize.height === panel.height,
      `the encoded clip is ${panelSize.width}x${panelSize.height}, not the reported ${panel.width}x${panel.height}`,
    );

    // THE ONE THAT WOULD FAIL SILENTLY. A rectangle pinned to the far corner, whose right and
    // bottom edges sit exactly on the frame: evening the size UP and the offset DOWN is what
    // would push it past the source, and ffmpeg refuses that outright.
    const corner = await cropVideoToRect(source, {
      x: 0.667,
      y: 0.667,
      width: 0.333,
      height: 0.333,
    });
    check(corner.cropped, 'the corner rectangle reported itself as uncropped');
    const cornerSize = await measure(corner.mp4);
    check(
      cornerSize.width === corner.width &&
        cornerSize.height === corner.height &&
        cornerSize.width <= SOURCE_WIDTH &&
        cornerSize.height <= SOURCE_HEIGHT,
      `the corner crop encoded as ${cornerSize.width}x${cornerSize.height}`,
    );

    // A thin strip along the foot of a poster — a ticker, the shape MOTION_CROP_MIN_SIDE is
    // deliberately set low enough to allow.
    const strip = await cropVideoToRect(source, {
      x: 0,
      y: 0.92,
      width: 1,
      height: 0.08,
    });
    check(
      strip.cropped && strip.width === SOURCE_WIDTH,
      `a full-width strip should keep the full width, got ${strip.width}x${strip.height}`,
    );

    // The whole frame: no re-encode, and the SAME bytes back rather than a copy of them.
    const whole = await cropVideoToRect(source, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    check(!whole.cropped, 'a whole-frame rectangle was re-encoded');
    check(
      whole.mp4 === source,
      'a whole-frame rectangle did not hand the original bytes straight back',
    );

    // The guards, each of which must refuse BEFORE spending an encode.
    for (const [name, rect] of [
      ['past the right edge', { x: 0.8, y: 0, width: 0.5, height: 0.5 }],
      ['past the bottom edge', { x: 0, y: 0.8, width: 0.5, height: 0.5 }],
      ['no area', { x: 0.1, y: 0.1, width: 0, height: 0.5 }],
      ['not a fraction', { x: -0.1, y: 0, width: 0.5, height: 0.5 }],
      ['not finite', { x: Number.NaN, y: 0, width: 0.5, height: 0.5 }],
    ] as const) {
      let refused = false;
      try {
        await cropVideoToRect(source, rect);
      } catch {
        refused = true;
      }
      check(refused, `a rectangle ${name} was accepted`);
    }

    // THE BRANDED TRIM. The filter graph is the thing worth proving here — a crop plus two
    // overlays plus an optional audio map is where ffmpeg refuses, not in the arithmetic — and
    // that the stamp changes the picture WITHOUT changing its size, since the officer chose the
    // rectangle by where the branding landed inside it.
    const branded = await cropVideoToRect(
      source,
      { x: 0.213, y: 0.157, width: 0.337, height: 0.412 },
      { chrome: true },
    );
    check(branded.cropped, 'the branded trim reported itself as uncropped');
    check(
      branded.width === panel.width && branded.height === panel.height,
      `stamping the chrome changed the frame size: ${branded.width}x${branded.height} vs ${panel.width}x${panel.height}`,
    );
    const brandedSize = await measure(branded.mp4);
    check(
      brandedSize.width === branded.width &&
        brandedSize.height === branded.height,
      `the branded clip encoded as ${brandedSize.width}x${brandedSize.height}`,
    );

    // THE REGRESSION THIS FILE SHIPPED ONCE. The source is 25 frames; a branded trim must
    // still be 25. Before the still was looped it was ONE, and because the audio is mapped
    // and copied separately the officer got a clip of the full duration, with sound, stuck on
    // its first frame — which every size assertion above passes happily.
    const plainFrames = await countFrames(panel.mp4);
    const brandedFrames = await countFrames(branded.mp4);
    check(
      plainFrames >= 20,
      `the unbranded trim decoded only ${plainFrames} frames`,
    );
    check(
      brandedFrames === plainFrames,
      `stamping the chrome froze the clip: ${brandedFrames} frames vs ${plainFrames}`,
    );

    // MEASURED, not assumed. The band runs the full width along the bottom, so the bottom rows
    // of a branded frame must differ from the same rows of the unbranded one — and the top
    // rows, above the badge's own inset, must NOT.
    const [plainFoot, brandedFoot, plainHead, brandedHead] = await Promise.all([
      sampleRow(panel.mp4, { fromBottom: 8 }),
      sampleRow(branded.mp4, { fromBottom: 8 }),
      sampleRow(panel.mp4, { fromTop: 8 }),
      sampleRow(branded.mp4, { fromTop: 8 }),
    ]);
    check(
      !plainFoot.equals(brandedFoot),
      'the footer band did not change the bottom of the frame',
    );
    // The badge sits inset from the top and right by a fraction of the WIDTH, so a row eight
    // pixels down crosses it — this is what proves the lockup is drawn and not merely asked
    // for. (Its being on the RIGHT is placement, and placement is socialChromeLayers'.)
    check(
      !plainHead.equals(brandedHead),
      'the badge did not change the top of the frame',
    );

    // A rectangle SHORTER than the band is tall: the band is cropped to what fits rather than
    // overhanging, which ffmpeg would refuse outright.
    const strip2 = await cropVideoToRect(
      source,
      { x: 0, y: 0.9, width: 1, height: 0.06 },
      { chrome: true },
    );
    const stripSize = await measure(strip2.mp4);
    check(
      strip2.cropped &&
        stripSize.width === strip2.width &&
        stripSize.height === strip2.height,
      `a branded strip shorter than the band encoded as ${stripSize.width}x${stripSize.height}`,
    );

    // And the automatic reframe still behaves, now that it shares the encoder.
    const reframed = await cropVideoToAspect(source, 9 / 16);
    check(
      reframed.cropped &&
        Math.abs(reframed.width / reframed.height - 9 / 16) < 0.01,
      `the 9:16 reframe produced ${reframed.width}x${reframed.height}`,
    );
    const unchanged = await cropVideoToAspect(
      source,
      SOURCE_WIDTH / SOURCE_HEIGHT,
    );
    check(
      !unchanged.cropped && unchanged.mp4 === source,
      'reframing to the clip’s own ratio re-encoded it',
    );

    // WHAT CAME IN, reported on every path including the ones that change nothing. On the
    // Dynamic Poster lane this is the only number that says whether the render was asked for at
    // a useful size and got it — a clip that arrived small and was merely cropped otherwise
    // looks exactly like one that arrived large, and the un-cropped paths used to report nothing
    // at all.
    for (const [name, crop] of [
      ['the 9:16 reframe', reframed],
      ['an unchanged reframe', unchanged],
      ['a middle panel', panel],
      ['a whole-frame rectangle', whole],
    ] as const) {
      check(
        crop.source.width === SOURCE_WIDTH &&
          crop.source.height === SOURCE_HEIGHT,
        `${name} reported the source as ${crop.source.width}x${crop.source.height}`,
      );
    }
    // And it is the SOURCE, not the output: the reframe genuinely changed the size, so these
    // two pairs must differ — otherwise `source` is just the answer echoed back.
    check(
      reframed.width !== reframed.source.width ||
        reframed.height !== reframed.source.height,
      'the reframe reported its own output size as the source',
    );

    // -----------------------------------------------------------------------
    // THE SOURCE RESTORE. The officer's own poster put back over every frame except the part
    // they marked as moving. These are the reason this harness encodes real files: every one of
    // the ways this can be wrong produces a clip that plays perfectly.
    // -----------------------------------------------------------------------

    // A poster stand-in with a hard structure in it, so a row sampled out of a frame either is
    // it or provably is not. Built at the size a real DGIPR poster is.
    const posterPng = await sharp({
      create: {
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        channels: 3,
        background: { r: 220, g: 40, b: 30 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: SOURCE_WIDTH,
              height: 120,
              channels: 3,
              background: { r: 250, g: 250, b: 245 },
            },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 40,
        },
      ])
      .png()
      .toBuffer();

    // The clip that comes back from the model: 9:16, as gemini-omni returns whatever it is
    // given. Reframing it to 4:5 and scaling back up to the poster is the whole journey.
    const renderPath = join(dir, 'render.mp4');
    await execFileAsync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=720x1280:rate=25:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        renderPath,
      ],
      { timeout: 120_000, maxBuffer: CROP_MAX_BUFFER },
    );
    const render = await readFile(renderPath);

    // The photograph area, low in the poster and well clear of its top band.
    const hole = { x: 0.18, y: 0.55, width: 0.64, height: 0.3 };
    const restored = await restoreSourceOverClip(render, 4 / 5, {
      png: posterPng,
      width: SOURCE_WIDTH,
      height: SOURCE_HEIGHT,
      hole,
    });

    // 1. THE SCALE IS EXACT AND DOES NOT STRETCH.
    const restoredSize = await measure(restored.mp4);
    check(
      restoredSize.width === SOURCE_WIDTH &&
        restoredSize.height === SOURCE_HEIGHT,
      `the restored clip encoded as ${restoredSize.width}x${restoredSize.height}, not ${SOURCE_WIDTH}x${SOURCE_HEIGHT}`,
    );
    check(
      Math.abs(
        restoredSize.width / restoredSize.height - SOURCE_WIDTH / SOURCE_HEIGHT,
      ) /
        (SOURCE_WIDTH / SOURCE_HEIGHT) <=
        ASPECT_TOLERANCE,
      'the restore changed the aspect ratio',
    );

    // 2. THE CLIP STILL MOVES. A full-frame overlay is the likeliest thing in this file to
    // freeze a clip on frame 1, and EVERY size assertion above passes when it does.
    const renderFrames = await countFrames(render);
    const restoredFrames = await countFrames(restored.mp4);
    check(
      renderFrames >= 20,
      `the stand-in render decoded only ${renderFrames} frames`,
    );
    check(
      restoredFrames === renderFrames,
      `the restore froze the clip: ${restoredFrames} frames vs ${renderFrames}`,
    );

    // 3 AND 4 TOGETHER ARE WHAT RULE OUT AN INVERTED MASK. Either one alone passes on a mask
    // the wrong way round, which is why neither is allowed to stand on its own.

    // 3. OUTSIDE THE HOLE IS THE OFFICER'S POSTER — to within one video encode, which is the
    // strongest claim this can honestly make and is NOT byte equality.
    //
    // MEASURED, and worth not re-deriving: an h.264 clip at crf 20 in yuv420p is lossy, and the
    // RGB -> YUV 4:2:0 -> RGB round trip alone is, so a frozen pixel comes back within a level
    // or three of the source and never exactly on it. Real numbers off this very clip: a frozen
    // row differs by mean 0.33 and at most 3 out of 255 — invisible — while a row through the
    // hole differs by mean 84 and at most 225. The separation is ~64x, so a threshold anywhere
    // between them distinguishes the two cases unambiguously, and 8 is deliberately far above
    // the noise and far below the signal. Asserting equality here would be asserting something
    // the codec cannot deliver, and the harness would have to be weakened later under pressure.
    const meanDiff = (a: Buffer, b: Buffer): number => {
      const n = Math.min(a.length, b.length);
      let sum = 0;
      for (let i = 0; i < n; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
      return n === 0 ? Number.POSITIVE_INFINITY : sum / n;
    };
    const ENCODE_NOISE = 8;

    const posterRow = await sharp(posterPng)
      .extract({ left: 0, top: 80, width: SOURCE_WIDTH, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const frozenRow = await sampleRow(restored.mp4, { fromTop: 80 });
    const frozenDrift = meanDiff(frozenRow, posterRow);
    check(
      frozenDrift <= ENCODE_NOISE,
      `a row outside the marked region differs from the officer\u2019s poster by ${frozenDrift.toFixed(1)}/255`,
    );
    // And LATE in the clip, not only on frame 1: a still composited once at the start would
    // pass every check above.
    const lateFrozen = await sampleRow(restored.mp4, {
      fromTop: 80,
      late: true,
    });
    const lateDrift = meanDiff(lateFrozen, posterRow);
    check(
      lateDrift <= ENCODE_NOISE,
      `a late frame's frozen row drifted by ${lateDrift.toFixed(1)}/255 — the overlay is not on every frame`,
    );

    // 4. INSIDE THE HOLE IS THE VIDEO. It must differ from the poster — otherwise the mask is
    // inverted and the whole frame is frozen — and the check above proves the same overlay did
    // land elsewhere, so this cannot be passing merely because nothing was composited at all.
    const holeMidY = Math.round((hole.y + hole.height / 2) * SOURCE_HEIGHT);
    const posterHoleRow = await sharp(posterPng)
      .extract({ left: 0, top: holeMidY, width: SOURCE_WIDTH, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const motionRow = await sampleRow(restored.mp4, { fromTop: holeMidY });
    const motionDrift = meanDiff(motionRow, posterHoleRow);
    check(
      motionDrift > ENCODE_NOISE * 4,
      `the marked region differs from the poster by only ${motionDrift.toFixed(1)}/255 — the mask is inverted`,
    );

    // 5. ALIGNMENT. The top-left 8x8 of the restored frame is the poster's own top-left 8x8, so
    // the overlay is placed at the origin rather than centred or offset by the crop.
    const cornerOf = async (mp4: Buffer): Promise<Buffer> => {
      const out = await mkdtemp(join(tmpdir(), 'dgipr-restore-corner-'));
      try {
        const clipPath = join(out, 'clip.mp4');
        const framePath = join(out, 'frame.png');
        await writeFile(clipPath, mp4);
        await execFileAsync(
          resolveFfmpeg(),
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            clipPath,
            '-frames:v',
            '1',
            framePath,
          ],
          { timeout: 60_000, maxBuffer: CROP_MAX_BUFFER },
        );
        return await sharp(await readFile(framePath))
          .extract({ left: 0, top: 0, width: 8, height: 8 })
          .removeAlpha()
          .raw()
          .toBuffer();
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    };
    const posterCorner = await sharp(posterPng)
      .extract({ left: 0, top: 0, width: 8, height: 8 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const cornerDrift = meanDiff(await cornerOf(restored.mp4), posterCorner);
    check(
      cornerDrift <= ENCODE_NOISE,
      `the frame\u2019s top-left 8x8 differs from the poster\u2019s by ${cornerDrift.toFixed(1)}/255 — the overlay is not aligned to the origin`,
    );

    // 6. THE STRETCH GUARD REFUSES BEFORE SPENDING AN ENCODE. A 16:9 crop with a 4:5 poster
    // over it would squash the artwork into the frame, and a 2% squash of Devanagari reads as
    // a font choice rather than a defect — so it would ship.
    let stretchRefused = false;
    try {
      await restoreSourceOverClip(render, 16 / 9, {
        png: posterPng,
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        hole,
      });
    } catch {
      stretchRefused = true;
    }
    check(
      stretchRefused,
      'a restore that would stretch the poster was accepted',
    );

    // AND THE NO-OP SHORTCUT DOES NOT FIRE. Once the render comes back at the ratio that was
    // asked for — the normal case now — cropVideoToAspect hands the input straight back. Taking
    // that path here would skip the restore and report success: the text still garbled, nothing
    // in the log, a job that says it worked.
    const alreadyRight = await restoreSourceOverClip(
      source,
      SOURCE_WIDTH / SOURCE_HEIGHT,
      {
        png: posterPng,
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        hole,
      },
    );
    check(
      alreadyRight.mp4 !== source,
      'a clip already at the right ratio skipped the restore entirely',
    );
    const shortcutRow = await sampleRow(alreadyRight.mp4, { fromTop: 80 });
    const shortcutDrift = meanDiff(shortcutRow, posterRow);
    check(
      shortcutDrift <= ENCODE_NOISE,
      `a clip already at the right ratio came back without the poster over it (${shortcutDrift.toFixed(1)}/255)`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      'All crop assertions passed (measured out of real encoded clips).',
    );
  }
}
