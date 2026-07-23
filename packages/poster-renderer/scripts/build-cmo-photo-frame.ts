// Generate the CMO photo-frame overlay — assets/cmo-photo-frame.png — from
// assets/cmo-header.png plus the constants in src/cmo-geometry.ts.
//
//   pnpm --filter @dgipr/poster-renderer assets:cmo-frame
//
// The frame is a full-canvas RGBA overlay that is TRANSPARENT inside the ONE big circle
// the layout keeps and OPAQUE over everything else in the photo zone — including the
// smaller lobe, which is filled over so the header's two-lobe cut-out reads as a single
// clean circle — plus the translucent light-blue ring that frames the big circle. Stamping
// it makes the shape of the photo zone deterministic: code composites ONE photograph into
// the big circle (see cmo-chrome.ts) and this frame crops away everything around it.
//
// This replaces the earlier two-asset scheme (cmo-photo-frame-1.png single-circle fallback
// + cmo-photo-frame-2.png two-circle layout), since the second circle was dropped: the image
// model could never paint two circles reliably, so a CMO poster now shows one code-supplied
// photograph. And before that, cmo-omega-ring.png drew only the ring and only ABOVE the
// leader band's bottom edge, leaving the lower half of the photo zone unconstrained.
//
// Two colour rules for the opaque fill, because the photo zone straddles the band line:
//
//   above it  the fill must read as more leader band. The band is a vertical gradient
//             carrying a faded Mantralaya building texture on its left half and flat
//             #0274B3 on its right, so neither a flat fill nor a global average works.
//             Each pixel instead takes the per-channel MEDIAN of the nearest 16 fully
//             opaque header pixels to its left on the same row: that follows the vertical
//             gradient exactly and averages the building's texture away, so the seam
//             against the real band is invisible.
//   below it  flat page white, which is what both the master and the official CMO poster
//             have under the circles.
//
// Circle edges are anti-aliased analytically (a one-pixel coverage ramp) rather than by
// blurring the finished asset, which would have softened the fill's own boundaries too.
//
// One subtlety about the header's own edge: cmo-header.png anti-aliases its cut-out against
// WHITE (its boundary pixels are white with partial alpha), which reads as a soft highlight
// when a photograph sits behind it, but as a pale arc when the fallback frame fills the hole
// with band blue instead. So the above-band fill is grown a couple of pixels INTO the opaque
// band, covering that rim. Over-painting the band with the band's own colour is invisible.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  CMO_ASSET_WIDTH,
  CMO_BAND_BOTTOM,
  CMO_BELOW_BAND_FILL,
  CMO_BIG,
  CMO_RING,
  CMO_SMALL,
} from '../src/cmo-geometry.js';
import type { CmoCircle } from '../src/cmo-geometry.js';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(here, '../assets');
const SOURCE = resolve(ASSETS_DIR, 'cmo-header.png');

// Page white under the band line.
const BODY_FILL = { r: 255, g: 255, b: 255 };
// The leader band's flat right-hand colour, used above the band line when a row offers no
// band pixel to sample (measured off cmo-header.png, where the band right of the cut-out
// is uniform).
const BAND_FLAT = { r: 2, g: 116, b: 179 };
// How many opaque neighbours the band-colour median samples.
const BAND_SAMPLE = 16;
// How far the above-band fill grows past the circles, to bury the light outline the header
// draws around its cut-out.
const CUTOUT_GROW = 3;
// Minimum blue-minus-red for a header pixel to count as leader band when sampling its
// colour. The band runs 110-190 on this measure; the light outline around the cut-out
// (~240,245,249) scores 9 and the leaders' white shirts and yellow saree score at or below
// zero. Without this filter a fill boundary that runs horizontally samples a whole window
// of outline pixels and paints the rim back in the very colour it is meant to cover.
const BAND_BLUENESS = 60;

type Px = { cx: number; cy: number; r: number };

const toPx = (circle: CmoCircle, width: number): Px => ({
  cx: circle.cx * width,
  cy: circle.cy * width,
  r: circle.r * width,
});

// Coverage of a pixel by a filled disc: 1 well inside, 0 well outside, a linear ramp
// across the one-pixel band on the edge.
const inside = (x: number, y: number, c: Px): number => {
  const d = Math.hypot(x + 0.5 - c.cx, y + 0.5 - c.cy);
  return Math.min(1, Math.max(0, c.r - d + 0.5));
};

// Coverage of a pixel by the ring stroked along a circle's edge, same ramp.
const onRing = (x: number, y: number, c: Px, halfThickness: number): number => {
  const d = Math.hypot(x + 0.5 - c.cx, y + 0.5 - c.cy);
  return Math.min(1, Math.max(0, halfThickness - Math.abs(d - c.r) + 0.5));
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function buildFrame(header: {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}): Promise<void> {
  const { data, width: W, height: H, channels: C } = header;
  const scale = W / CMO_ASSET_WIDTH;

  const big = toPx(CMO_BIG, W);
  const small = toPx(CMO_SMALL, W);
  // Only the big circle stays a photo window; the small lobe is filled over.
  const kept: Px[] = [big];

  const bandBottom = CMO_BAND_BOTTOM * W;
  const rectLeft = CMO_BELOW_BAND_FILL.left * W;
  const rectRight = CMO_BELOW_BAND_FILL.right * W;
  const rectBottom = CMO_BELOW_BAND_FILL.bottom * W;
  const halfThickness = CMO_RING.halfThickness * W;

  // Above the band the paintable zone is the header's cut-out — but defined analytically
  // as the union of BOTH circles rather than read from the header's alpha, grown by
  // CUTOUT_GROW. Reading the alpha instead would also catch the band's own anti-aliased
  // bottom edge, which is transparent for the same reason and runs the full width of the
  // canvas, smearing a two-pixel stripe across the leaders.
  const grownUnion: Px[] = [big, small].map((c) => ({
    ...c,
    r: c.r + CUTOUT_GROW,
  }));

  const out = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    // Rolling window of the nearest fully opaque header pixels to the left, used only
    // above the band line. Reset per row: the band's tone is a function of the row.
    const recent: Array<[number, number, number]> = [];

    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * C;
      const headerAlpha = data[src + 3] ?? 0;
      const aboveBand = y <= bandBottom;

      if (aboveBand && headerAlpha >= 250) {
        const r = data[src] ?? 0;
        const g = data[src + 1] ?? 0;
        const b = data[src + 2] ?? 0;
        if (b - r >= BAND_BLUENESS) {
          recent.push([r, g, b]);
          if (recent.length > BAND_SAMPLE) recent.shift();
        }
      }

      // Whether this pixel belongs to the photo zone this frame must paint over: above
      // the band line that is the grown circle union; below it, the fill rectangle.
      let zone = 0;
      if (aboveBand) {
        for (const c of grownUnion) zone = Math.max(zone, inside(x, y, c));
      } else if (x >= rectLeft && x <= rectRight && y <= rectBottom) {
        zone = 1;
      }

      // ...minus whatever a kept circle shows through.
      let keptCoverage = 0;
      for (const c of kept)
        keptCoverage = Math.max(keptCoverage, inside(x, y, c));
      const fillAlpha = zone * (1 - keptCoverage);

      // The ring is stroked on the single big circle.
      const ringCoverage = onRing(x, y, big, halfThickness);
      const ringAlpha = ringCoverage * (CMO_RING.alpha / 255);

      const dst = (y * W + x) * 4;
      const outAlpha = ringAlpha + fillAlpha * (1 - ringAlpha);
      if (outAlpha <= 0) continue;

      let fill = BODY_FILL;
      if (aboveBand) {
        fill = recent.length
          ? {
              r: median(recent.map((p) => p[0])),
              g: median(recent.map((p) => p[1])),
              b: median(recent.map((p) => p[2])),
            }
          : BAND_FLAT;
      }

      const mix = (ring: number, under: number): number =>
        Math.round(
          (ring * ringAlpha + under * fillAlpha * (1 - ringAlpha)) / outAlpha,
        );

      out[dst] = mix(CMO_RING.color.r, fill.r);
      out[dst + 1] = mix(CMO_RING.color.g, fill.g);
      out[dst + 2] = mix(CMO_RING.color.b, fill.b);
      out[dst + 3] = Math.round(outAlpha * 255);
    }
  }

  const file = resolve(ASSETS_DIR, 'cmo-photo-frame.png');
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(file);
  console.log(
    `Wrote ${file} (${W}x${H}, scale ${scale.toFixed(3)}, ${kept.length} photo circle)`,
  );
}

async function main(): Promise<void> {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const header = {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
  await buildFrame(header);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
