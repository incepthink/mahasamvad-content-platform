// Exact-text red-box edits: cut the marked text out of the poster, enlarge it, let the image
// model repaint ONLY that crop, then put it back.
//
// WHY A CROP. A misprinted digit or a broken jodakshar is a few pixels tall inside a 1280x1600
// poster. Asked to repaint the whole canvas, the model sees a tiny glyph in a busy design and
// draws the same wrong shape again. Enlarged to ~1024px, the same text is a few LARGE glyphs —
// and everything outside the crop stays pixel-identical, so no other text on the poster can be
// re-spelled by accident. A crop is also a smaller request than the whole poster.
//
// Three pure-ish steps, all sharp:
//   planExactTextCrop  — the padded, aspect-bounded crop rectangle and the size to edit it at
//   extractCrop        — that rectangle, resized to the edit size
//   compositeCropPatch — the edited crop resized back and laid in with a feathered edge
//
// The feather lives in the PADDING only: the officer's own box is fully opaque, so the
// corrected text is never half-blended with the old one.
//
// Free harness: `npx tsx src/crop-region.ts`.

import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

import type { NormalizedRegion } from './feedback-marker.js';

export type PixelRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type CropPlan = Readonly<{
  // The rectangle cut out of the poster, in the poster's own pixels.
  rect: PixelRect;
  // The officer's marked box inside `rect`, in the poster's pixels (clamped to the image).
  inner: PixelRect;
  // The size the crop is sent to the image model at: multiples of 16, ~1M pixels, aspect <= 3.
  editWidth: number;
  editHeight: number;
}>;

// Padding on each side, as a fraction of the marked box's own size — context for the model to
// match the font, colour and background — with a floor so a tiny box still gets some.
const PAD_FRACTION = 0.4;
const MIN_PAD_PX = 24;
// gpt-image refuses an aspect ratio beyond 3:1, and a one-line headline box is often 15:1.
// The crop's short side is GROWN to fit (more context), never the text squashed.
const MAX_ASPECT = 3;
// ~1024x1024 worth of pixels whatever the shape. A pixel budget rather than a long edge,
// because a 3:1 crop at a 1024 long edge would fall below the model's minimum pixel count.
const TARGET_PIXELS = 1024 * 1024;
// How much of each side's padding the feather may use. The rest stays opaque, so the seam
// is laid in edited background, not on the text.
const FEATHER_SHARE = 0.7;

function round16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16);
}

/**
 * The crop for one exact-text marker on an image of `imageWidth` x `imageHeight`. The region is
 * the normalized box the officer drew (0..1 of the finished poster).
 */
export function planExactTextCrop(
  imageWidth: number,
  imageHeight: number,
  region: NormalizedRegion,
): CropPlan {
  const ix0 = clamp(Math.round(region.x * imageWidth), 0, imageWidth - 1);
  const iy0 = clamp(Math.round(region.y * imageHeight), 0, imageHeight - 1);
  const ix1 = clamp(
    Math.round((region.x + region.width) * imageWidth),
    ix0 + 1,
    imageWidth,
  );
  const iy1 = clamp(
    Math.round((region.y + region.height) * imageHeight),
    iy0 + 1,
    imageHeight,
  );
  const inner: PixelRect = {
    left: ix0,
    top: iy0,
    width: ix1 - ix0,
    height: iy1 - iy0,
  };

  const padX = Math.max(MIN_PAD_PX, inner.width * PAD_FRACTION);
  const padY = Math.max(MIN_PAD_PX, inner.height * PAD_FRACTION);
  let w = inner.width + 2 * padX;
  let h = inner.height + 2 * padY;
  if (w / h > MAX_ASPECT) h = w / MAX_ASPECT;
  if (h / w > MAX_ASPECT) w = h / MAX_ASPECT;
  w = Math.min(imageWidth, Math.round(w));
  h = Math.min(imageHeight, Math.round(h));

  // Centred on the marked box, then shifted (not shrunk) back inside the image.
  const cx = inner.left + inner.width / 2;
  const cy = inner.top + inner.height / 2;
  const left = clamp(Math.round(cx - w / 2), 0, imageWidth - w);
  const top = clamp(Math.round(cy - h / 2), 0, imageHeight - h);
  const rect: PixelRect = { left, top, width: w, height: h };

  const aspect = clamp(w / h, 1 / MAX_ASPECT, MAX_ASPECT);
  const editWidth = round16(Math.sqrt(TARGET_PIXELS * aspect));
  const editHeight = round16(Math.sqrt(TARGET_PIXELS / aspect));
  return { rect, inner, editWidth, editHeight };
}

/** Pixel size of a PNG — so a caller with no image library can map regions onto it. */
export async function imageSize(
  png: Buffer,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height)
    throw new Error('Cannot read the image size.');
  return { width: meta.width, height: meta.height };
}

/** The crop, cut out of `png` and resized to the plan's edit size. */
export async function extractCrop(
  png: Buffer,
  plan: CropPlan,
): Promise<Buffer> {
  return sharp(png)
    .extract(plan.rect)
    .resize(plan.editWidth, plan.editHeight, {
      fit: 'fill',
      kernel: 'lanczos3',
    })
    .removeAlpha()
    .png()
    .toBuffer();
}

/**
 * The feathered alpha for a crop of `rect` laid back into an image of `imageWidth` x
 * `imageHeight`: 255 over the officer's box and beyond, ramping to 0 at each crop edge across
 * part of that side's padding. A side that touches the image edge has nothing beyond it to
 * blend with, so it is opaque to the edge.
 */
export function featherMask(
  plan: CropPlan,
  imageWidth: number,
  imageHeight: number,
): Buffer {
  const { rect, inner } = plan;
  const sides = {
    left: rect.left === 0 ? 0 : (inner.left - rect.left) * FEATHER_SHARE,
    right:
      rect.left + rect.width >= imageWidth
        ? 0
        : (rect.left + rect.width - (inner.left + inner.width)) * FEATHER_SHARE,
    top: rect.top === 0 ? 0 : (inner.top - rect.top) * FEATHER_SHARE,
    bottom:
      rect.top + rect.height >= imageHeight
        ? 0
        : (rect.top + rect.height - (inner.top + inner.height)) * FEATHER_SHARE,
  };
  const ramp = (distance: number, feather: number): number =>
    feather <= 0 ? 1 : clamp(distance / feather, 0, 1);

  const xs = new Float32Array(rect.width);
  for (let x = 0; x < rect.width; x += 1) {
    const d = x + 0.5;
    xs[x] = Math.min(ramp(d, sides.left), ramp(rect.width - d, sides.right));
  }
  const mask = Buffer.alloc(rect.width * rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    const d = y + 0.5;
    const fy = Math.min(
      ramp(d, sides.top),
      ramp(rect.height - d, sides.bottom),
    );
    for (let x = 0; x < rect.width; x += 1) {
      // MIN of the two axes: 1 only where both are deep inside, 0 along any feathered edge.
      mask[y * rect.width + x] = Math.round(Math.min(xs[x]!, fy) * 255);
    }
  }
  return mask;
}

/**
 * Lay an edited crop (any size; it is resized back to the plan's rectangle) into `base` — the
 * same image the plan was made on — with the feathered edge. Every pixel outside `plan.rect`
 * is untouched.
 */
export async function compositeCropPatch(
  base: Buffer,
  patchPng: Buffer,
  plan: CropPlan,
): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('Cannot read the base image.');
  const { rect } = plan;
  if (rect.left + rect.width > width || rect.top + rect.height > height) {
    throw new Error('The crop plan does not fit this image.');
  }

  const mask = featherMask(plan, width, height);
  const rgb = await sharp(patchPng)
    .resize(rect.width, rect.height, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer();
  // RGB + the mask joined as raw bytes. Joining onto a decoded PNG pipeline returns a
  // three-channel image with the alpha silently dropped (source-overlay.ts's finding).
  const rgba = Buffer.alloc(rect.width * rect.height * 4);
  for (let i = 0; i < rect.width * rect.height; i += 1) {
    rgba[i * 4] = rgb[i * 3]!;
    rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
    rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
    rgba[i * 4 + 3] = mask[i]!;
  }
  const overlay = await sharp(rgba, {
    raw: { width: rect.width, height: rect.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: overlay, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- free harness ---------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) failures.push(label);
    else console.log(`ok  ${label}`);
  };

  const W = 1280;
  const H = 1600;

  // A one-line headline box: 15:1 — the aspect must be bounded and the size legal.
  const wide = planExactTextCrop(W, H, {
    x: 0.1,
    y: 0.2,
    width: 0.75,
    height: 0.04,
  });
  check(
    wide.rect.width / wide.rect.height <= MAX_ASPECT + 0.01,
    `wide box crop aspect <= 3 (${wide.rect.width}x${wide.rect.height})`,
  );
  check(
    wide.editWidth % 16 === 0 && wide.editHeight % 16 === 0,
    `edit size divisible by 16 (${wide.editWidth}x${wide.editHeight})`,
  );
  check(
    wide.editWidth * wide.editHeight >= 655_360,
    'edit size above the model minimum pixel count',
  );
  check(
    wide.editWidth / wide.editHeight <= MAX_ASPECT + 0.05,
    'edit size aspect <= 3',
  );
  const inside = (p: CropPlan) =>
    p.rect.left <= p.inner.left &&
    p.rect.top <= p.inner.top &&
    p.rect.left + p.rect.width >= p.inner.left + p.inner.width &&
    p.rect.top + p.rect.height >= p.inner.top + p.inner.height;
  check(inside(wide), 'crop contains the marked box');

  // A tiny box in the corner: shifted inside the image, padding floor applied.
  const corner = planExactTextCrop(W, H, {
    x: 0.97,
    y: 0.0,
    width: 0.03,
    height: 0.02,
  });
  check(
    corner.rect.left + corner.rect.width <= W && corner.rect.top >= 0,
    'corner crop stays inside the image',
  );
  check(inside(corner), 'corner crop contains the marked box');

  const mask = featherMask(wide, W, H);
  const at = (x: number, y: number) => mask[y * wide.rect.width + x]!;
  const ix = wide.inner.left - wide.rect.left;
  const iy = wide.inner.top - wide.rect.top;
  let innerOpaque = true;
  for (let y = iy; y < iy + wide.inner.height; y += 1) {
    for (let x = ix; x < ix + wide.inner.width; x += 1) {
      if (at(x, y) !== 255) innerOpaque = false;
    }
  }
  check(innerOpaque, 'the marked box is fully opaque (no blend over the text)');
  check(
    at(Math.floor(wide.rect.width / 2), 0) < 20,
    'feathered to ~0 at the top edge',
  );
  // The wide crop reaches the image's own edge: nothing beyond it, so no feather there.
  check(
    wide.rect.left === 0 && at(0, Math.floor(wide.rect.height / 2)) === 255,
    'a side on the image edge is opaque to the edge',
  );
  const mid = planExactTextCrop(W, H, {
    x: 0.4,
    y: 0.5,
    width: 0.2,
    height: 0.04,
  });
  const midMask = featherMask(mid, W, H);
  check(
    midMask[Math.floor(mid.rect.height / 2) * mid.rect.width]! < 20,
    'feathered to ~0 at an interior left edge',
  );

  // Composite: outside the crop must be pixel-identical; inside the box must be the patch.
  const base = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 30, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
  const patch = await sharp({
    create: {
      width: wide.editWidth,
      height: wide.editHeight,
      channels: 3,
      background: { r: 250, g: 10, b: 10 },
    },
  })
    .png()
    .toBuffer();
  const cut = await extractCrop(base, wide);
  const cutMeta = await sharp(cut).metadata();
  check(
    cutMeta.width === wide.editWidth && cutMeta.height === wide.editHeight,
    'extractCrop returns the edit size',
  );
  const out = await compositeCropPatch(base, patch, wide);
  const outRaw = await sharp(out).removeAlpha().raw().toBuffer();
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return [outRaw[i]!, outRaw[i + 1]!, outRaw[i + 2]!];
  };
  let outsideSame = true;
  for (let y = 0; y < H; y += 7) {
    for (let x = 0; x < W; x += 7) {
      const r = wide.rect;
      if (
        x >= r.left &&
        x < r.left + r.width &&
        y >= r.top &&
        y < r.top + r.height
      )
        continue;
      const [a, b, c] = px(x, y);
      if (a !== 30 || b !== 120 || c !== 200) outsideSame = false;
    }
  }
  check(outsideSame, 'pixels outside the crop are identical');
  const [r0, g0] = px(
    wide.inner.left + Math.floor(wide.inner.width / 2),
    wide.inner.top + Math.floor(wide.inner.height / 2),
  );
  check(r0 === 250 && g0 === 10, 'the marked box carries the patch');

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll crop-region checks passed.');
  }
}
