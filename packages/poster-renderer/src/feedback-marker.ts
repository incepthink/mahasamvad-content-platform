// Draw the feedback annotations onto a finished poster before it is sent to the
// image model. Two visual languages, deliberately unmistakable for one another:
//
//   RED numbered outline boxes  = "change the element here" (pointing gestures).
//   BLUE lettered boxes with a translucent fill = "free this space" — whatever
//     sits inside is relocated elsewhere in the design and the rectangle is left
//     as plain background for the officer's own logo/photo.
//
// The marks mirror the web annotator's visual language exactly, so what the user
// drew is what the model sees. Pure pixel work: no LLM, no network. The edit
// prompt tells the model these are software annotations to act on and erase.
//
// Badge glyphs are hardcoded vector strokes, NOT SVG <text>: sharp renders SVG
// via librsvg, and <text> silently depends on fonts inside the deploy container.
// That is also why the clear boxes are lettered A/B in Latin rather than अ/ब —
// a Devanagari badge would need a font the container cannot be relied on to have.

import sharp from 'sharp';

export type NormalizedRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const MARKER_COLOR = '#E00000';
const CLEAR_COLOR = '#1A56DB';
// 20% — enough to read as "this area", light enough that the design underneath
// stays visible to the model that has to decide what to relocate.
const CLEAR_FILL = 'rgba(26,86,219,0.20)';
const HALO_COLOR = '#FFFFFF';

// Digit strokes in a 0..100 box, drawn with thick round-capped white lines on
// the badge circle. Covers the marker cap (3) with headroom.
const DIGIT_PATHS: readonly string[] = [
  'M40 28 L54 16 L54 84', // 1
  'M34 32 Q34 14 50 14 Q66 14 66 30 Q66 42 52 54 L34 82 L70 82', // 2
  'M36 24 Q49 12 61 21 Q73 31 56 45 Q75 53 66 70 Q55 86 35 75', // 3
  'M62 84 L62 16 L30 62 L74 62', // 4
];

// Letter strokes in the same 0..100 box, for the clear-space badges. Covers the
// clear-region cap (2) with headroom.
const LETTER_PATHS: readonly string[] = [
  'M20 84 L50 16 L80 84 M32 58 L68 58', // A
  'M32 16 L32 84 M32 16 L58 16 Q76 16 76 33 Q76 50 58 50 L32 50 M32 50 L62 50 Q80 50 80 67 Q80 84 62 84 L32 84', // B
  'M76 28 Q62 14 46 20 Q26 28 26 50 Q26 72 46 80 Q62 86 76 72', // C
];

export const CLEAR_REGION_LETTERS: readonly string[] = ['A', 'B', 'C'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function glyphSvg(
  glyphs: readonly string[],
  n: number,
  cx: number,
  cy: number,
  radius: number,
): string {
  const path = glyphs[n - 1];
  if (!path) throw new Error(`No badge glyph for annotation number ${n}.`);
  // Scale the 100-box glyph to ~1.15x the radius so glyphs fill the badge.
  const size = radius * 1.15;
  const scale = size / 100;
  const offsetX = cx - size / 2;
  const offsetY = cy - size / 2;
  return (
    `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">` +
    `<path d="${path}" fill="none" stroke="${HALO_COLOR}" stroke-width="14" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></g>`
  );
}

// Composite the annotations onto the poster and return a new PNG buffer:
// numbered red marker boxes (1-based, in array order — the same order the notes
// are numbered in) and lettered blue clear-space boxes (A, B — likewise in array
// order). Either list may be empty; with both empty the poster is returned
// untouched, so a plain-text feedback round is byte-for-byte unchanged.
export async function annotateFeedbackRegions(
  poster: Buffer,
  regions: readonly NormalizedRegion[],
  clearRegions: readonly NormalizedRegion[] = [],
): Promise<Buffer> {
  if (regions.length === 0 && clearRegions.length === 0) return poster;

  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for feedback markers.');
  }
  const W = meta.width;
  const H = meta.height;

  const stroke = Math.max(4, Math.round(W * 0.004));
  const halo = stroke + 4;
  const badgeRadius = Math.max(18, Math.round(W * 0.016));
  // Keep strokes fully on-canvas (SVG strokes straddle the path).
  const inset = halo / 2 + 1;

  const shapes: string[] = [];
  const radius = Math.round(W * 0.006);
  const ring = Math.max(3, Math.round(stroke / 2));

  const drawBox = (
    region: NormalizedRegion,
    index: number,
    colour: string,
    fill: string,
    glyphs: readonly string[],
  ) => {
    const left = clamp(region.x * W, inset, W - inset);
    const top = clamp(region.y * H, inset, H - inset);
    const right = clamp((region.x + region.width) * W, inset, W - inset);
    const bottom = clamp((region.y + region.height) * H, inset, H - inset);
    const width = Math.max(right - left, 8);
    const height = Math.max(bottom - top, 8);

    shapes.push(
      `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" ` +
        `fill="none" stroke="${HALO_COLOR}" stroke-width="${halo}"/>`,
      `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" ` +
        `fill="${fill}" stroke="${colour}" stroke-width="${stroke}"/>`,
    );

    // Badge pinned to the box's top-left corner, clamped on-canvas.
    const cx = clamp(left, badgeRadius + ring, W - badgeRadius - ring);
    const cy = clamp(top, badgeRadius + ring, H - badgeRadius - ring);
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${badgeRadius}" fill="${colour}" ` +
        `stroke="${HALO_COLOR}" stroke-width="${ring}"/>`,
      glyphSvg(glyphs, index + 1, cx, cy, badgeRadius),
    );
  };

  regions.forEach((region, i) =>
    drawBox(region, i, MARKER_COLOR, 'none', DIGIT_PATHS),
  );
  // Clear boxes last so a blue rectangle overlapping a red one stays readable as
  // the "free this space" gesture — the more destructive of the two.
  clearRegions.forEach((region, i) =>
    drawBox(region, i, CLEAR_COLOR, CLEAR_FILL, LETTER_PATHS),
  );

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join('')}</svg>`,
  );
  return sharp(poster)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
