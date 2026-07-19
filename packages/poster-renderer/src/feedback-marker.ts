// Draw the numbered feedback markers — red outline boxes with a circular number
// badge — onto a finished poster before it is sent to the image model. The marks
// mirror the web annotator's visual language (red box + white halo + red badge),
// so what the user drew is exactly what the model sees. Pure pixel work: no LLM,
// no network. The edit prompt tells the model the markers are software
// annotations to act on and then erase.
//
// Badge digits are hardcoded vector strokes, NOT SVG <text>: sharp renders SVG
// via librsvg, and <text> silently depends on fonts inside the deploy container.

import sharp from 'sharp';

export type NormalizedRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const MARKER_COLOR = '#E00000';
const HALO_COLOR = '#FFFFFF';

// Digit strokes in a 0..100 box, drawn with thick round-capped white lines on
// the badge circle. Covers the marker cap (3) with headroom.
const DIGIT_PATHS: readonly string[] = [
  'M40 28 L54 16 L54 84', // 1
  'M34 32 Q34 14 50 14 Q66 14 66 30 Q66 42 52 54 L34 82 L70 82', // 2
  'M36 24 Q49 12 61 21 Q73 31 56 45 Q75 53 66 70 Q55 86 35 75', // 3
  'M62 84 L62 16 L30 62 L74 62', // 4
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function digitSvg(n: number, cx: number, cy: number, radius: number): string {
  const path = DIGIT_PATHS[n - 1];
  if (!path) throw new Error(`No digit glyph for marker number ${n}.`);
  // Scale the 100-box glyph to ~1.15x the radius so digits fill the badge.
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

// Composite numbered red marker boxes (1-based, in array order — the same order
// the notes are numbered in) onto the poster and return a new PNG buffer.
export async function annotateFeedbackRegions(
  poster: Buffer,
  regions: readonly NormalizedRegion[],
): Promise<Buffer> {
  if (regions.length === 0) return poster;

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
  regions.forEach((region, i) => {
    const left = clamp(region.x * W, inset, W - inset);
    const top = clamp(region.y * H, inset, H - inset);
    const right = clamp((region.x + region.width) * W, inset, W - inset);
    const bottom = clamp((region.y + region.height) * H, inset, H - inset);
    const width = Math.max(right - left, 8);
    const height = Math.max(bottom - top, 8);
    const radius = Math.round(W * 0.006);

    shapes.push(
      `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" ` +
        `fill="none" stroke="${HALO_COLOR}" stroke-width="${halo}"/>`,
      `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" ` +
        `fill="none" stroke="${MARKER_COLOR}" stroke-width="${stroke}"/>`,
    );

    // Number badge pinned to the box's top-left corner, clamped on-canvas.
    const ring = Math.max(3, Math.round(stroke / 2));
    const cx = clamp(left, badgeRadius + ring, W - badgeRadius - ring);
    const cy = clamp(top, badgeRadius + ring, H - badgeRadius - ring);
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${badgeRadius}" fill="${MARKER_COLOR}" ` +
        `stroke="${HALO_COLOR}" stroke-width="${ring}"/>`,
      digitSvg(i + 1, cx, cy, badgeRadius),
    );
  });

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes.join('')}</svg>`,
  );
  return sharp(poster)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
