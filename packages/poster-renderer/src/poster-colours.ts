// Measure what colours a rendered poster ACTUALLY uses.
//
// Why this exists: the social poster pipeline assigns a colour palette per run and states it to
// the image model as exact hex (content-engine/poster-palettes.ts + build-poster-prompt.ts). What
// it could never do is check whether the model complied. gpt-image-2 has a strong "Indian
// government Marathi poster -> saffron on cream" prior, and a prompt is a request, not a
// guarantee — so a rotation could be working perfectly while every shipped poster still came out
// warm, and nothing in the system would know.
//
// This closes the loop deterministically and for free (no model call): downscale the PNG, bucket
// its pixels by hue, and report the ground and the dominant colour block. The caller stores the
// result and feeds it into the NEXT run's avoid set — so the rotation spreads away from what
// actually shipped rather than from what was merely intended. That distinction is the whole
// point: if the model ignores the spec, avoiding intentions achieves nothing.
//
// Deliberately NOT an enforcement gate. A mismatch is logged, never retried — a re-render is
// another paid gpt-image-2 call, and the honest fix for systematic non-compliance is a better
// prompt, not paying twice for the same poster.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

// Coarse hue families. Deliberately matched to the vocabulary of
// content-engine/poster-palettes.ts's PaletteFamily so the two can be compared without a lookup
// table: 'neutral' covers anything too desaturated to have a hue.
export type HueBucket =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'neutral';

export type PosterColours = Readonly<{
  // The page background: the modal light, low-saturation colour. This is the field the user was
  // actually complaining about — "same background colour as well".
  groundHex: string;
  // Whether that ground reads as cream/paper rather than a neutral or cool white. The specific
  // tell for the DGIPR house look.
  groundIsWarm: boolean;
  // The dominant SATURATED colour — the colour block / band / column.
  dominantHex: string;
  // The hue family of that dominant colour.
  hueBucket: HueBucket;
  // Share of the sampled pixels with enough chroma to carry a hue (0..1). A very low value means
  // an almost colourless poster, which makes `hueBucket` weakly supported.
  colourfulness: number;
}>;

// Sample grid. Small on purpose: this is a colour question, not a detail question, and a 64x80
// raster of a 1280x1600 poster is ~5k pixels — instant, and it averages away typography.
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 80;

// Below this CHROMA a pixel has no meaningful hue and counts toward the ground instead.
//
// Chroma (max-min), not HSL saturation. This distinction is the whole accuracy of the measure:
// HSL saturation rates a pale cream #FDF2DC at 0.84 because it is nearly white and barely tinted,
// so a saturation-weighted vote hands the entire cream BACKGROUND of a poster back as its
// "dominant colour", and reports 96% of the pixels as colourful. Chroma rates that same cream at
// 0.13 and a real terracotta block at 0.53, which is what the eye agrees with. Verified against
// eight live posters before this constant was chosen.
const CHROMA_FLOOR = 0.15;
// Above this lightness a low-chroma pixel is background rather than dark text.
const GROUND_LIGHTNESS_FLOOR = 0.62;

type Hsl = Readonly<{ h: number; c: number; l: number }>;

// Hue and lightness from HSL, but `c` is CHROMA (max-min, 0..1) rather than HSL saturation.
function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, c: 0, l };
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, c: d, l };
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

// Hue ranges in degrees. Boundaries chosen so the DGIPR saffron (~28deg) lands in 'orange' and the
// palette library's teals (~186deg) land in 'teal' rather than smearing into 'blue'. `chroma` is
// max-min in 0..1, NOT HSL saturation — see CHROMA_FLOOR.
export function hueBucketOf(hue: number, chroma: number): HueBucket {
  if (chroma < CHROMA_FLOOR) return 'neutral';
  const h = ((hue % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'red'; // magenta/pink read as red at this granularity
}

// Quantise to a 32-level cube so near-identical shades pool into one bin instead of each pixel
// being its own "colour". Fine enough to keep #F7EFE4 and #EEF1F7 apart.
function binKey(r: number, g: number, b: number): number {
  return (Math.floor(r / 8) << 10) | (Math.floor(g / 8) << 5) | Math.floor(b / 8);
}

/**
 * Measure a poster's ground and dominant colour.
 *
 * Pass the poster BEFORE the brand chrome is stamped: the footer band and emblem are fixed
 * colours present on every render, so measuring after them biases every poster identically and
 * would make the comparison across runs meaningless.
 */
export async function measurePosterColours(png: Buffer): Promise<PosterColours> {
  const { data, info } = await sharp(png)
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const total = info.width * info.height;

  // Chromatic pixels vote for the dominant colour, weighted by chroma so a large pale wash cannot
  // outvote a smaller but genuinely coloured block.
  const colourBins = new Map<number, { weight: number; r: number; g: number; b: number; n: number }>();
  // Light, low-chroma pixels vote for the ground, unweighted — the ground is defined by area.
  const groundBins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let chromatic = 0;

  for (let i = 0; i < total; i += 1) {
    const o = i * channels;
    const r = data[o] as number;
    const g = data[o + 1] as number;
    const b = data[o + 2] as number;
    const { c, l } = rgbToHsl(r, g, b);

    if (c >= CHROMA_FLOOR) {
      chromatic += 1;
      const key = binKey(r, g, b);
      const bin = colourBins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0, n: 0 };
      bin.weight += c;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n += 1;
      colourBins.set(key, bin);
    } else if (l >= GROUND_LIGHTNESS_FLOOR) {
      const key = binKey(r, g, b);
      const bin = groundBins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      groundBins.set(key, bin);
    }
  }

  // Ground: the largest light/unsaturated bin. A poster with no such area (a full-bleed
  // photograph) falls back to the overall mean, which is the honest answer for one.
  let groundHex = '#FFFFFF';
  let groundRgb: [number, number, number] = [255, 255, 255];
  let bestGround = 0;
  for (const bin of groundBins.values()) {
    if (bin.n > bestGround) {
      bestGround = bin.n;
      groundRgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
      groundHex = toHex(groundRgb[0], groundRgb[1], groundRgb[2]);
    }
  }
  if (bestGround === 0) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < total; i += 1) {
      const o = i * channels;
      r += data[o] as number;
      g += data[o + 1] as number;
      b += data[o + 2] as number;
    }
    groundRgb = [r / total, g / total, b / total];
    groundHex = toHex(groundRgb[0], groundRgb[1], groundRgb[2]);
  }

  // Dominant: the highest saturation-weighted bin.
  let dominantHex = groundHex;
  let dominantHue = 0;
  let dominantChroma = 0;
  let bestWeight = 0;
  for (const bin of colourBins.values()) {
    if (bin.weight > bestWeight) {
      bestWeight = bin.weight;
      const r = bin.r / bin.n;
      const g = bin.g / bin.n;
      const b = bin.b / bin.n;
      dominantHex = toHex(r, g, b);
      const hsl = rgbToHsl(r, g, b);
      dominantHue = hsl.h;
      dominantChroma = hsl.c;
    }
  }

  // "Warm ground" is the cream/paper tell: a light colour whose red channel leads its blue by a
  // clear margin. #FAF3E6 (the DGIPR cream) is +20; #EEF1F7 (cool porcelain) is -9.
  const groundIsWarm = groundRgb[0] - groundRgb[2] > 8;

  return {
    groundHex,
    groundIsWarm,
    dominantHex,
    hueBucket: bestWeight === 0 ? 'neutral' : hueBucketOf(dominantHue, dominantChroma),
    colourfulness: total === 0 ? 0 : chromatic / total,
  };
}

// --- CLI harness -----------------------------------------------------------
//   pnpm --filter @dgipr/poster-renderer poster:preview:colours <poster.png|url> [more ...]
// Prints the measurement for each poster given (local paths or public poster URLs) and, for a
// set, the hue histogram and how many grounds read as cream/paper. Run it over the last several
// finished posters to see whether they really are the same colour — this is the metric the
// rotation feeds on, so it should agree with the naked eye before it is trusted.
//
// Baseline measured on eight live posters, 2026-07-24, BEFORE the palette/composition rework:
// 5/8 warm cream grounds, and orange+red dominants 5/8 — which is what "they all look the same"
// looks like as a number.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const load = async (source: string): Promise<Buffer> => {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
    return readFile(source);
  };

  if (files.length === 0) {
    console.error(
      'Usage: tsx src/poster-colours.ts <poster.png|url> [more ...]\n' +
        'Measures the ground and dominant colour of each poster.',
    );
    process.exitCode = 1;
  } else {
    const buckets = new Map<HueBucket, number>();
    let warmGrounds = 0;
    for (const file of files) {
      try {
        const measured = await measurePosterColours(await load(file));
        buckets.set(measured.hueBucket, (buckets.get(measured.hueBucket) ?? 0) + 1);
        if (measured.groundIsWarm) warmGrounds += 1;
        console.log(
          `${file}\n` +
            `  ground     ${measured.groundHex}${measured.groundIsWarm ? '  (WARM / cream-paper)' : ''}\n` +
            `  dominant   ${measured.dominantHex}  bucket=${measured.hueBucket}\n` +
            `  colourful  ${(measured.colourfulness * 100).toFixed(1)}%\n`,
        );
      } catch (error) {
        console.error(`${file}: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    }
    if (files.length > 1) {
      console.log('Hue buckets across the set:');
      for (const [bucket, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${bucket.padEnd(8)} ${n}`);
      }
      console.log(`Warm (cream/paper) grounds: ${warmGrounds}/${files.length}`);
      if (buckets.size === 1) {
        console.log('\nEvery poster in this set shares one hue family — no colour variety at all.');
      }
    }
  }
}
