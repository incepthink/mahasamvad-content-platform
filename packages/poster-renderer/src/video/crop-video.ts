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
import { resolveFfmpeg } from './assemble.js';

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
): Promise<{ width: number; height: number }> {
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
  return { width, height };
}

// The one place the crop is actually performed, shared by both entry points below so the two
// cannot drift in encode settings — a clip cropped to a ratio on the way out of a render and
// one an officer trimmed by hand afterwards must be the same kind of file.
async function encodeCrop(
  inputPath: string,
  outputPath: string,
  crop: PixelCrop,
): Promise<Buffer> {
  await execFileAsync(
    resolveFfmpeg(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vf',
      `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}`,
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
      return { mp4, width, height, cropped: false };
    }

    // Crop the dimension that is too generous; never scale, and never enlarge one that is
    // already short — the whole promise of this lane is the officer's artwork intact.
    const cropWidth =
      ratio > targetRatio ? evenSize(height * targetRatio) : evenSize(width);
    const cropHeight =
      ratio > targetRatio ? evenSize(height) : evenSize(width / targetRatio);
    const left = evenOffset((width - cropWidth) / 2);
    const top = evenOffset((height - cropHeight) / 2);

    const cropped = await encodeCrop(inputPath, outputPath, {
      width: cropWidth,
      height: cropHeight,
      left,
      top,
    });
    return {
      mp4: cropped,
      width: cropWidth,
      height: cropHeight,
      cropped: true,
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
 */
export async function cropVideoToRect(
  mp4: Buffer,
  rect: NormalizedRect,
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

    const { width, height } = await probeVideoSize(inputPath);
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
    if (cropWidth === frameWidth && cropHeight === frameHeight) {
      return { mp4, width, height, cropped: false };
    }

    const cropped = await encodeCrop(inputPath, outputPath, {
      width: cropWidth,
      height: cropHeight,
      left,
      top,
    });
    return {
      mp4: cropped,
      width: cropWidth,
      height: cropHeight,
      cropped: true,
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
