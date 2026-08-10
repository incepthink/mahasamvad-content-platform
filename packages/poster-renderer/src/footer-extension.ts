// Grow a rendered poster's canvas downward so the stamped branding band lands on pixels the
// image model never painted.
//
// WHY THIS EXISTS.
//
// Until now the footer was composited OVER the finished render, and the only thing keeping the
// officer's last line out from under it was a paragraph of English in the image prompt
// (reserved-zone-rule.ts). That is a request, not a guarantee, and it was being lost: a real
// poster shipped with the closing bullet of a five-point note buried under the navy title pill
// — the sentence simply ends, mid-word, and the whole paid render is thrown away. The prompt
// had already been strengthened once for exactly this failure and it happened again, because
// an image model has no ruler and every other rule in that prompt ("show all of the
// information", "match the reference's density") pushes the other way.
//
// So the band stops being an overlay. `extendCanvasForFooter` adds a strip BELOW the artwork
// and the band is stamped there. Nothing the model paints can be covered, however badly it
// ignores the reserve — the deterministic-guarantee-behind-an-instructed-rule shape this repo
// uses everywhere else (Chromium typesets the Devanagari rather than the prompt asking the
// model to spell it right; lock-scheme-names repairs a truncation the prompt merely requested).
//
// WHAT MAKES IT LOOK LIKE ONE POSTER RATHER THAN A BAR STUCK ON THE END.
//
// The band's artwork is only ~56% opaque across its top 43px (the navy title pill floats in the
// middle of it), so the added strip is visible either side of the pill and has to read as the
// poster's own background continuing. Two cases:
//
//   - The bottom edge is one flat colour, and a flat fill sampled from it is then literally
//     indistinguishable from the poster continuing.
//   - The bottom edge carries a gradient, a photograph or a panel edge. Then the last few rows
//     are stretched down and softened, which continues a gradient and gives a photograph a
//     plausible soft falloff rather than a hard seam.
//
// The SECOND case is now the expected one. The prompt used to ask for a "calm, plain, even
// background" margin at the bottom, which reliably produced a flat band — and too much of one:
// asked for 48px the model painted 82, so a real poster (97b64542) carried 173 dead pixels
// between its last line and its footer and read as letterboxed. reserved-zone-rule.ts now tells
// the design to run off the bottom edge in any colour it likes, so a bottom edge split between
// a dark panel and a photograph is ordinary, and the stretch path is what joins it.
//
// The fill colour is the mean of the bottom rows rather than the single last row: one row can
// carry a stray antialiased pixel from whatever sits above it, and a hairline of the wrong
// colour along the join is exactly the artefact this is trying to avoid.

import sharp from 'sharp';

/** How much of the bottom edge to inspect when deciding flat vs. textured. */
const PROBE_ROWS = 24;
/** How many rows are stretched down when the edge is not flat. */
const EDGE_ROWS = 6;
/**
 * Max per-channel deviation (0-255) across the probe that still counts as "one flat colour".
 * Generous on purpose: JPEG-ish noise and a subtle paper texture should both take the flat
 * path, because a flat fill is the seamless one and stretching adds nothing there.
 */
const FLAT_TOLERANCE = 12;
/** Softening applied to a stretched edge, in sharp's sigma units. */
const STRETCH_BLUR_SIGMA = 3;

export type BottomEdge = Readonly<{
  /** True when the whole probed strip is effectively a single colour. */
  flat: boolean;
  r: number;
  g: number;
  b: number;
}>;

/**
 * Sample the poster's bottom edge: its mean colour, and whether it is flat enough that a
 * plain fill will be invisible. Downscaled before reading, so this is a few thousand pixels
 * regardless of poster size.
 */
export async function readBottomEdge(poster: Buffer): Promise<BottomEdge> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for the footer join.');
  }
  const rows = Math.max(1, Math.min(PROBE_ROWS, meta.height));
  const { data, info } = await sharp(poster)
    .extract({
      left: 0,
      top: meta.height - rows,
      width: meta.width,
      height: rows,
    })
    .resize(64, 8, { fit: 'fill' })
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
  const meanR = sumR / pixels;
  const meanG = sumG / pixels;
  const meanB = sumB / pixels;

  let maxDeviation = 0;
  for (let i = 0; i < data.length; i += channels) {
    const d = Math.max(
      Math.abs((data[i] ?? 0) - meanR),
      Math.abs((data[i + 1] ?? 0) - meanG),
      Math.abs((data[i + 2] ?? 0) - meanB),
    );
    if (d > maxDeviation) maxDeviation = d;
  }

  return {
    flat: maxDeviation <= FLAT_TOLERANCE,
    r: Math.round(meanR),
    g: Math.round(meanG),
    b: Math.round(meanB),
  };
}

/**
 * Return the poster on a canvas `stripHeight` pixels taller, with the new strip filled so it
 * reads as the poster's own background continuing. The caller stamps its band into that strip.
 *
 * Idempotence is the CALLER's job — this function always adds a strip. The chrome overlays
 * decide from the poster's aspect whether they are looking at fresh artwork or at an already
 * finished poster coming back round through a feedback edit.
 */
export async function extendCanvasForFooter(
  poster: Buffer,
  stripHeight: number,
): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for the footer join.');
  }
  const width = meta.width;
  const height = meta.height;
  const strip = Math.max(1, Math.round(stripHeight));
  const edge = await readBottomEdge(poster);

  const fill = edge.flat
    ? await sharp({
        create: {
          width,
          height: strip,
          channels: 4,
          background: { r: edge.r, g: edge.g, b: edge.b, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
    : await sharp(poster)
        .extract({
          left: 0,
          top: height - Math.min(EDGE_ROWS, height),
          width,
          height: Math.min(EDGE_ROWS, height),
        })
        .resize(width, strip, { fit: 'fill', kernel: 'cubic' })
        .blur(STRETCH_BLUR_SIGMA)
        .png()
        .toBuffer();

  return sharp({
    create: {
      width,
      height: height + strip,
      channels: 4,
      background: { r: edge.r, g: edge.g, b: edge.b, alpha: 1 },
    },
  })
    .composite([
      { input: poster, left: 0, top: 0 },
      { input: fill, left: 0, top: height },
    ])
    .png()
    .toBuffer();
}
