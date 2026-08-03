// Did the "free this space" edit actually free the space?
//
// READ-ONLY, BY DESIGN. This measures the returned poster and reports a number;
// it never writes a pixel. Painting the rectangle over in code was considered and
// rejected: the background behind a freed area is often photographic (the rain
// artwork on a real DGIPR poster), so a sampled fill looks right on flat grounds
// and shows a seam on textured ones — unpredictable in exactly the way an officer
// cannot inspect. The image model owns the pixels; this only tells us whether it
// did as it was told, so the SPACE TO FREE prompt can be calibrated against
// evidence instead of impressions.
//
// It is a log-only diagnostic today. Promoting it to an officer-facing warning is
// a one-line change at the call site — but only once the numbers below have been
// read against real rounds, because a warning that fires wrongly is worse than no
// warning at all.
//
// How it decides: a freed rectangle should look like the background AROUND it. So
// the region's "ink fraction" — pixels far in colour from that area's own dominant
// tone — is compared against the same measure taken on a ring just outside it.
// Comparing against a ring rather than against an absolute threshold is what makes
// it work on a textured background: rain streaks raise both numbers together.

import sharp from 'sharp';

export type ClearRegionRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ClearRegionMeasurement = Readonly<{
  // 0-based, matching the order the rectangles were drawn (badge A, B, …).
  index: number;
  // Fraction of pixels in the rectangle that differ markedly from its dominant tone.
  inkFraction: number;
  // The same measure on a ring just outside it: what "background" looks like here.
  surroundInkFraction: number;
  // False = content clearly remains. Deliberately lenient — see THRESHOLDS below.
  looksCleared: boolean;
}>;

// A pixel counts as "ink" when any channel is this far from the area's dominant
// tone. 48/255 clears JPEG-ish noise and photographic texture but catches type,
// icons and panels.
const INK_DELTA = 48;
// Ring width as a fraction of the poster's shorter side.
const RING_FRACTION = 0.05;
// Content is only reported when the rectangle is BOTH well above its own
// surroundings and above an absolute floor. Both conditions on purpose: the ratio
// alone false-positives on a perfectly flat background (a ring at 0.1% ink makes
// any speck look like a 10x excess), and the floor alone false-positives on busy
// photographic artwork.
const EXCESS_RATIO = 2.5;
const ABSOLUTE_FLOOR = 0.06;
// Sampling stride — every 2nd pixel in each axis. A quarter of the work, and the
// measure is a fraction, so it is unaffected.
const STRIDE = 2;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

type Px = { r: number; g: number; b: number };

// The dominant tone, as a per-channel median over the sample. A median rather than
// a mean because a mean is dragged toward whatever ink is present, which is the
// very thing being measured.
function medianTone(pixels: readonly Px[]): Px {
  const pick = (get: (p: Px) => number): number => {
    const sorted = pixels.map(get).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return { r: pick((p) => p.r), g: pick((p) => p.g), b: pick((p) => p.b) };
}

function inkFraction(pixels: readonly Px[], tone: Px): number {
  if (pixels.length === 0) return 0;
  let ink = 0;
  for (const p of pixels) {
    const d = Math.max(
      Math.abs(p.r - tone.r),
      Math.abs(p.g - tone.g),
      Math.abs(p.b - tone.b),
    );
    if (d >= INK_DELTA) ink += 1;
  }
  return ink / pixels.length;
}

// Collect sampled pixels inside `outer` but outside `inner` (pass no `inner` for
// the whole rect). Coordinates are absolute pixels, already clamped to the canvas.
function collect(
  data: Buffer,
  width: number,
  channels: number,
  outer: { x0: number; y0: number; x1: number; y1: number },
  inner?: { x0: number; y0: number; x1: number; y1: number },
): Px[] {
  const pixels: Px[] = [];
  for (let y = outer.y0; y < outer.y1; y += STRIDE) {
    for (let x = outer.x0; x < outer.x1; x += STRIDE) {
      if (
        inner &&
        x >= inner.x0 &&
        x < inner.x1 &&
        y >= inner.y0 &&
        y < inner.y1
      ) {
        continue;
      }
      const i = (y * width + x) * channels;
      pixels.push({
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
      });
    }
  }
  return pixels;
}

// Measure each normalized (0..1) rectangle on the returned poster. Rectangles are
// clamped to the canvas; a degenerate one reports as cleared rather than throwing,
// since this must never be able to fail a paid round.
export async function measureClearedRegions(
  poster: Buffer,
  regions: readonly ClearRegionRect[],
): Promise<ClearRegionMeasurement[]> {
  if (regions.length === 0) return [];
  const image = sharp(poster).ensureAlpha().raw();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const ring = Math.max(8, Math.round(Math.min(W, H) * RING_FRACTION));

  return regions.map((region, index) => {
    const x0 = clampInt(region.x * W, 0, W);
    const y0 = clampInt(region.y * H, 0, H);
    const x1 = clampInt((region.x + region.width) * W, 0, W);
    const y1 = clampInt((region.y + region.height) * H, 0, H);
    if (x1 - x0 < STRIDE * 2 || y1 - y0 < STRIDE * 2) {
      return {
        index,
        inkFraction: 0,
        surroundInkFraction: 0,
        looksCleared: true,
      };
    }

    const inner = { x0, y0, x1, y1 };
    const outer = {
      x0: clampInt(x0 - ring, 0, W),
      y0: clampInt(y0 - ring, 0, H),
      x1: clampInt(x1 + ring, 0, W),
      y1: clampInt(y1 + ring, 0, H),
    };

    const insidePixels = collect(data, W, channels, inner);
    const ringPixels = collect(data, W, channels, outer, inner);
    // The ring is the reference for BOTH measures: "does the rectangle look like
    // its surroundings" is the question, so measuring the rectangle against its
    // own dominant tone would score a solid coloured panel as perfectly clear.
    const tone = medianTone(ringPixels.length > 0 ? ringPixels : insidePixels);
    const inside = inkFraction(insidePixels, tone);
    const surround = inkFraction(ringPixels, tone);

    return {
      index,
      inkFraction: inside,
      surroundInkFraction: surround,
      looksCleared: !(
        inside >= ABSOLUTE_FLOOR && inside >= surround * EXCESS_RATIO
      ),
    };
  });
}

// One log line per round, for the API job. Never throws.
export function formatClearRegionReport(
  measurements: readonly ClearRegionMeasurement[],
  letters: readonly string[] = ['A', 'B', 'C'],
): string {
  return measurements
    .map(
      (m) =>
        `${letters[m.index] ?? m.index + 1}=${m.looksCleared ? 'cleared' : 'NOT-CLEARED'}` +
        ` (ink ${(m.inkFraction * 100).toFixed(1)}% vs surround ${(m.surroundInkFraction * 100).toFixed(1)}%)`,
    )
    .join(', ');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/clear-region-check.ts            (synthetic, asserts both verdicts)
//   tsx src/clear-region-check.ts <png> <x,y,w,h> [more rects…]   (a real poster)
// Free — pure pixel work, no model call.
if (
  process.argv[1] &&
  import.meta.url ===
    (await import('node:url')).pathToFileURL(process.argv[1]).href
) {
  const [, , file, ...rectArgs] = process.argv;

  const parseRect = (s: string): ClearRegionRect => {
    const [x, y, width, height] = s.split(',').map(Number);
    return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
  };

  if (file) {
    const { readFile } = await import('node:fs/promises');
    const png = await readFile(file);
    const rects = rectArgs.map(parseRect);
    const out = await measureClearedRegions(png, rects);
    console.log(formatClearRegionReport(out));
  } else {
    const failures: string[] = [];
    const W = 800;
    const H = 1000;
    // A textured background (so this is not just a flat-colour test), with a black
    // text-like block sitting in the LEFT half only.
    const noise = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i += 1) {
      const base = 200 + ((i * 7919) % 24); // ±12 of mid-tone: photographic-ish
      noise[i * 3] = base;
      noise[i * 3 + 1] = base + 6;
      noise[i * 3 + 2] = base + 14;
    }
    const textured = await sharp(noise, {
      raw: { width: W, height: H, channels: 3 },
    })
      .png()
      .toBuffer();
    const withBlock = await sharp(textured)
      .composite([
        {
          input: await sharp({
            create: {
              width: 240,
              height: 160,
              channels: 3,
              background: { r: 10, g: 10, b: 10 },
            },
          })
            .png()
            .toBuffer(),
          left: 60,
          top: 400,
        },
      ])
      .png()
      .toBuffer();

    // Rect over the black block ⇒ NOT cleared. Rect on bare texture ⇒ cleared.
    const occupied: ClearRegionRect = {
      x: 60 / W,
      y: 400 / H,
      width: 240 / W,
      height: 160 / H,
    };
    const empty: ClearRegionRect = {
      x: 0.6,
      y: 0.4,
      width: 0.3,
      height: 0.16,
    };
    const measured = await measureClearedRegions(withBlock, [occupied, empty]);
    if (measured[0]?.looksCleared !== false)
      failures.push(
        `a solid block was reported cleared (${JSON.stringify(measured[0])})`,
      );
    if (measured[1]?.looksCleared !== true)
      failures.push(
        `bare textured background was reported NOT cleared (${JSON.stringify(measured[1])})`,
      );

    // The same rectangle on the untouched texture must read cleared — i.e. the
    // texture itself never triggers the check.
    const clean = await measureClearedRegions(textured, [occupied]);
    if (clean[0]?.looksCleared !== true)
      failures.push(
        `texture alone reported NOT cleared (${JSON.stringify(clean[0])})`,
      );

    // Degenerate + out-of-range rectangles must not throw.
    const odd = await measureClearedRegions(textured, [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
    ]);
    if (odd.length !== 2) failures.push('degenerate rectangles were dropped');
    if (odd[0]?.looksCleared !== true)
      failures.push('a zero-size rectangle was reported NOT cleared');
    if ((await measureClearedRegions(textured, [])).length !== 0)
      failures.push('empty region list produced measurements');

    console.log(formatClearRegionReport(measured));
    if (failures.length > 0) {
      console.error(`\n${failures.length} FAILURE(S):`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('All clear-region check assertions passed.');
    }
  }
}
