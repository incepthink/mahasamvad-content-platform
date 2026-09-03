// Pad an image into an exact aspect ratio, so a model that is asked for that ratio has no side
// left to crop.
//
// WHY THIS EXISTS.
//
// The Dynamic Poster lane hands the officer's finished poster to a video model together with a
// prompt naming the output ratio. Its first reported defect was a 4:5 poster coming back as a
// 9:16 clip with ~15% cut off each side — and the prompt was not being ignored. It said, in one
// paragraph, "the output must be 9:16" AND "the full poster visible full-screen and nothing cut
// off", which for a 4:5 source cannot both hold: only 0.5625/0.8 = 70% of its width fits. The
// render obeyed the more concrete half and cropped.
//
// A stronger sentence would not have fixed that, because there was nothing wrong with the
// wording — the geometry was impossible. So the frame is decided HERE instead: the source is
// letterboxed or pillarboxed into the target ratio before it is sent, and the image the model
// receives already IS that ratio with the whole poster inside it. The prompt's two requirements
// then agree. Deterministic-guarantee-behind-an-instructed-rule, the shape this repo uses for
// every rule an image model has repeatedly failed to honour (extendCanvasForFooter for the
// branding band; Chromium typesetting rather than asking a model to spell Devanagari).
//
// NEVER CROPS AND NEVER STRETCHES. Both would defeat the point — the whole promise of the lane
// is that the officer's finished artwork survives intact.
//
// The bars are filled from the poster's own edge rather than with black, using the same probe
// footer-extension.ts uses on the bottom edge: a flat edge takes a solid fill sampled from it,
// which is indistinguishable from the poster continuing, and a textured one gets its last few
// rows stretched and softened, which continues a gradient and gives a photograph a plausible
// falloff. Black bars would read as a mistake; these read as the poster's own ground.

import { pathToFileURL } from 'node:url';
import { aspectRatioLabel, motionAspectRatio } from '@dgipr/schemas';
import sharp from 'sharp';

/** How deep into an edge to look when deciding flat vs. textured. */
const PROBE_DEPTH = 24;
/** How many rows/columns are stretched when the edge is not flat. */
const EDGE_DEPTH = 6;
/**
 * Max per-channel deviation (0-255) across the probe that still counts as one flat colour.
 * Generous on purpose: JPEG noise and a subtle paper texture should both take the flat path,
 * because a flat fill is the seamless one and stretching adds nothing there.
 */
const FLAT_TOLERANCE = 12;
/** Softening applied to a stretched edge, in sharp's sigma units. */
const STRETCH_BLUR_SIGMA = 3;
/**
 * How close the source already has to be for the frame to be left alone. Half a percent — well
 * inside the rounding a resize introduces, and far tighter than anything that shows on screen.
 */
const ASPECT_TOLERANCE = 0.005;

export type AspectFit = Readonly<{
  png: Buffer;
  width: number;
  height: number;
  /** False when the source already had the target ratio and the bytes came back untouched. */
  padded: boolean;
}>;

type Edge = 'top' | 'bottom' | 'left' | 'right';

type EdgeColour = Readonly<{ flat: boolean; r: number; g: number; b: number }>;

function probeRegion(
  edge: Edge,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const vertical = edge === 'top' || edge === 'bottom';
  const depth = Math.max(1, Math.min(PROBE_DEPTH, vertical ? height : width));
  if (edge === 'top') return { left: 0, top: 0, width, height: depth };
  if (edge === 'bottom')
    return { left: 0, top: height - depth, width, height: depth };
  if (edge === 'left') return { left: 0, top: 0, width: depth, height };
  return { left: width - depth, top: 0, width: depth, height };
}

/** Mean colour of one edge, and whether a plain fill sampled from it would be invisible. */
async function readEdge(
  image: Buffer,
  edge: Edge,
  width: number,
  height: number,
): Promise<EdgeColour> {
  const { data, info } = await sharp(image)
    .extract(probeRegion(edge, width, height))
    // Downscaled first, so this is a few thousand pixels whatever the poster's size.
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixels = data.length / channels;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < data.length; i += channels) {
    sumR += data[i] ?? 0;
    sumG += data[i + 1] ?? 0;
    sumB += data[i + 2] ?? 0;
  }
  const r = sumR / pixels;
  const g = sumG / pixels;
  const b = sumB / pixels;

  let maxDeviation = 0;
  for (let i = 0; i < data.length; i += channels) {
    const deviation = Math.max(
      Math.abs((data[i] ?? 0) - r),
      Math.abs((data[i + 1] ?? 0) - g),
      Math.abs((data[i + 2] ?? 0) - b),
    );
    if (deviation > maxDeviation) maxDeviation = deviation;
  }

  return {
    flat: maxDeviation <= FLAT_TOLERANCE,
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
  };
}

/** One bar, sized to fill the gap on `edge`, in the poster's own colours. */
async function buildBar(
  image: Buffer,
  edge: Edge,
  width: number,
  height: number,
  barWidth: number,
  barHeight: number,
): Promise<Buffer> {
  const sampled = await readEdge(image, edge, width, height);
  if (sampled.flat) {
    return sharp({
      create: {
        width: barWidth,
        height: barHeight,
        channels: 4,
        background: { r: sampled.r, g: sampled.g, b: sampled.b, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  const vertical = edge === 'top' || edge === 'bottom';
  const depth = Math.max(1, Math.min(EDGE_DEPTH, vertical ? height : width));
  const region = vertical
    ? {
        left: 0,
        top: edge === 'top' ? 0 : height - depth,
        width,
        height: depth,
      }
    : {
        left: edge === 'left' ? 0 : width - depth,
        top: 0,
        width: depth,
        height,
      };

  return sharp(image)
    .extract(region)
    .resize(barWidth, barHeight, { fit: 'fill' })
    .blur(STRETCH_BLUR_SIGMA)
    .png()
    .toBuffer();
}

/**
 * Return `image` on a canvas of exactly `targetRatio` (width / height), with the original
 * untouched and centred, and any new space filled from the edge it extends.
 *
 * Returns the input bytes unchanged when it is already that shape, which is the common case:
 * the lane's default aspect IS the poster's own, so nothing is padded at all unless the officer
 * asked for a different frame.
 */
export async function fitImageToAspect(
  image: Buffer,
  targetRatio: number,
): Promise<AspectFit> {
  if (!(targetRatio > 0) || !Number.isFinite(targetRatio)) {
    throw new Error(`fitImageToAspect got an unusable ratio: ${targetRatio}`);
  }

  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('fitImageToAspect could not read the image dimensions.');
  }

  const current = width / height;
  if (Math.abs(current - targetRatio) / targetRatio <= ASPECT_TOLERANCE) {
    return { png: image, width, height, padded: false };
  }

  // Wider than the frame ⇒ keep the width and grow upward/downward (letterbox). Narrower ⇒ keep
  // the height and grow sideways (pillarbox). Either way the original's own pixels are never
  // touched, which is the whole point.
  const letterbox = current > targetRatio;
  const canvasWidth = letterbox ? width : Math.round(height * targetRatio);
  const canvasHeight = letterbox ? Math.round(width / targetRatio) : height;
  const padX = Math.max(0, canvasWidth - width);
  const padY = Math.max(0, canvasHeight - height);
  const left = Math.floor(padX / 2);
  const top = Math.floor(padY / 2);

  const overlays: sharp.OverlayOptions[] = [];
  if (letterbox) {
    if (top > 0) {
      overlays.push({
        input: await buildBar(image, 'top', width, height, canvasWidth, top),
        left: 0,
        top: 0,
      });
    }
    const bottom = padY - top;
    if (bottom > 0) {
      overlays.push({
        input: await buildBar(
          image,
          'bottom',
          width,
          height,
          canvasWidth,
          bottom,
        ),
        left: 0,
        top: top + height,
      });
    }
  } else {
    if (left > 0) {
      overlays.push({
        input: await buildBar(image, 'left', width, height, left, canvasHeight),
        left: 0,
        top: 0,
      });
    }
    const right = padX - left;
    if (right > 0) {
      overlays.push({
        input: await buildBar(
          image,
          'right',
          width,
          height,
          right,
          canvasHeight,
        ),
        left: left + width,
        top: 0,
      });
    }
  }

  const png = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    // The bars first, the artwork last: the original must sit on top of anything sampled from
    // it, so a rounding error along a join can never eat a pixel of the poster.
    .composite([...overlays, { input: image, left, top }])
    .png()
    .toBuffer();

  return { png, width: canvasWidth, height: canvasHeight, padded: true };
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/aspect-fit.ts
//
// This is the regression test for the Dynamic Poster's first reported defect — a 4:5 poster
// coming back as a 9:16 clip with ~15% cut off each side. The assertion that matters is the
// last one: the original's pixels are extracted back out of the padded canvas and compared
// byte for byte. Nothing else proves "nothing is cropped"; looking at the picture does not.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  // A stand-in for a DGIPR poster: 1280x1600 (4:5, exactly what the platform renders), with a
  // GRADIENT sky at the top and a FLAT navy strip at the bottom, so both bar branches run.
  const width = 1280;
  const height = 1600;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const footer = y >= height - 90;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (footer) {
        raw[i] = 12;
        raw[i + 1] = 32;
        raw[i + 2] = 84;
      } else {
        // A vertical gradient with horizontal variation, so the top edge is NOT flat.
        raw[i] = 120 + Math.round((x / width) * 60);
        raw[i + 1] = 160 + Math.round((y / height) * 40);
        raw[i + 2] = 220;
      }
    }
  }
  const poster = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();

  const rgb = (buffer: Buffer) =>
    sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  // The label the prompt states. 1280x1600 must read as its familiar name, or the officer's
  // own frame is described to the model as something else.
  check(
    aspectRatioLabel(1280, 1600) === '4:5',
    `1280x1600 should read as 4:5, got ${aspectRatioLabel(1280, 1600)}`,
  );
  check(aspectRatioLabel(1080, 1920) === '9:16', '1080x1920 should read 9:16');
  check(aspectRatioLabel(1920, 1080) === '16:9', '1920x1080 should read 16:9');
  check(aspectRatioLabel(1024, 1024) === '1:1', 'a square should read 1:1');
  // An arbitrary hand-cropped export reduces to nothing useful and must still get a sane name
  // rather than "1237:1600".
  const odd = aspectRatioLabel(1237, 1600);
  const [oddW, oddH] = odd.split(':').map(Number);
  check(
    Math.max(oddW ?? 0, oddH ?? 0) <= 32 &&
      Math.abs((oddW ?? 0) / (oddH ?? 1) - 1237 / 1600) / (1237 / 1600) < 0.02,
    `1237x1600 needs a small, close label; got ${odd}`,
  );

  // The default aspect: the poster's own. Nothing is padded and the bytes come back untouched,
  // which is what makes the common case free.
  const same = await fitImageToAspect(
    poster,
    motionAspectRatio('source', width, height),
  );
  check(!same.padded, 'the poster was padded into its own ratio');
  check(same.png === poster, 'the untouched path re-encoded the poster');

  // 4:5 into 9:16 — the reported case. Letterboxed: the width is kept and height is added.
  const portrait = await fitImageToAspect(
    poster,
    motionAspectRatio('9:16', width, height),
  );
  check(portrait.padded, '4:5 into 9:16 should pad');
  check(
    portrait.width === width,
    `9:16 must keep the poster's full width, got ${portrait.width}`,
  );
  check(
    Math.abs(portrait.width / portrait.height - 9 / 16) < 0.001,
    `9:16 canvas is ${portrait.width}x${portrait.height}`,
  );

  // 4:5 into 16:9 — pillarboxed: the height is kept and width is added.
  const landscape = await fitImageToAspect(
    poster,
    motionAspectRatio('16:9', width, height),
  );
  check(landscape.padded, '4:5 into 16:9 should pad');
  check(
    landscape.height === height,
    `16:9 must keep the poster's full height, got ${landscape.height}`,
  );
  check(
    Math.abs(landscape.width / landscape.height - 16 / 9) < 0.001,
    `16:9 canvas is ${landscape.width}x${landscape.height}`,
  );

  // THE ONE THAT MATTERS. Cut the original's region back out of each padded canvas and compare
  // it to the source pixel for pixel. If a single row or column were lost, this fails — which
  // is exactly the failure the whole file exists to make impossible.
  const source = await rgb(poster);
  for (const [name, fit] of [
    ['9:16', portrait],
    ['16:9', landscape],
  ] as const) {
    const left = Math.floor((fit.width - width) / 2);
    const top = Math.floor((fit.height - height) / 2);
    const inner = await rgb(
      await sharp(fit.png)
        .extract({ left, top, width, height })
        .png()
        .toBuffer(),
    );
    check(
      inner.data.equals(source.data),
      `${name}: the poster's own pixels did not survive padding intact`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `All aspect-fit assertions passed.\n` +
        `  source   ${width}x${height} (${aspectRatioLabel(width, height)}) — untouched\n` +
        `  9:16     ${portrait.width}x${portrait.height} (${aspectRatioLabel(portrait.width, portrait.height)}) — letterboxed, full width kept\n` +
        `  16:9     ${landscape.width}x${landscape.height} (${aspectRatioLabel(landscape.width, landscape.height)}) — pillarboxed, full height kept`,
    );
  }
}
