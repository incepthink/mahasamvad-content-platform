// The officer's own poster, turned into a full-frame overlay with a feathered hole in it.
//
// WHY THIS EXISTS.
//
// A video model REPAINTS every pixel of every frame it returns. It does not preserve the
// Devanagari on a poster it is handed; it redraws it — which on a headline is survivable and on
// a 26px card line is not, because a matra is two or three pixels by the time the render has
// been scaled, encoded at crf 20 and quantised into a GIF. That is the whole of the Dynamic
// Poster lane's reported text garbling, and it is not a prompt problem: MOTION_BRIEF already
// says the text must remain unchanged, and crop-video.ts records that a stronger sentence was
// tried on this lane once and ignored.
//
// So the text is not asked for — it is PUT BACK. The poster that was sent is composited over
// every frame of the clip that came back, transparent only where the officer said motion should
// show through. Outside that rectangle the pixels are theirs rather than the model's. This is
// the house move for every rule an image model has repeatedly failed to honour: Chromium
// typesets the posters rather than a model spelling Devanagari; extendCanvasForFooter adds the
// branding band rather than asking for space to be left; fitImageToAspect settles the frame on
// the way in. Instruct, then guarantee.
//
// WHAT "PUT BACK" IS WORTH, EXACTLY — because the tempting claim is wrong.
//
// The pixels composited here are the officer's own, but the frame they land in is then encoded
// as h.264 at crf 20 in yuv420p, and both the codec and the RGB -> YUV 4:2:0 -> RGB round trip
// are lossy. So the result is NOT byte-identical to the upload and cannot be: measured on a real
// encoded clip, a frozen pixel comes back within 3 levels out of 255 of its source, mean 0.33.
// That is invisible, and it is a different thing from exact. What IS exact is the SHAPING: every
// matra, conjunct and anusvara is the officer's own glyph geometry rather than a video model's
// redraw of it, which is the entire difference between legible Devanagari and garbled Devanagari.
// Claim that, not equality.
//
// THE ALPHA CHANNEL IS BUILT AS RAW BYTES AND JOINED, NOT BLURRED AND MASKED.
//
// The obvious route — draw a white rounded rectangle on a black canvas, `.blur()` it, and
// `dest-in` it onto the poster — works, but only if three separate questions are answered
// correctly: whether `.blur()` touches the alpha channel, whether `dest-in` reads luminance or
// alpha, and whether premultiplication is in play. Each of them is a way to ship an INVERTED
// mask, and an inverted mask has two failure modes that both look like success from a distance:
// the whole poster frozen (a clip that plays perfectly and does not move) or nothing restored at
// all (the original defect, unchanged, after a paid render). Writing the bytes removes the
// question entirely — the number in the alpha channel is the number this file computed.
//
// THE RAMP IS SEPARABLE, which is what makes it cheap. The distance from a rectangle is taken
// per-axis: a horizontal factor per column and a vertical factor per row, combined with MAX.
// (Max, not min — inside the hole both are 0 and the overlay must be transparent; directly to
// the left of it the horizontal distance is positive while the vertical one is still 0, and
// that pixel is frozen artwork. Taking the min there would leave the whole band beside the hole
// transparent, which is the inverted mask above wearing a different hat.) Max of two monotone
// ramps is the ramp of the Chebyshev distance, so the feather is square-cornered rather than
// round — invisible at these radii, and O(W+H) of `Math` instead of O(W*H) of `hypot`.

import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/**
 * A rectangle as fractions of the image's own width and height — the same 0..1 convention the
 * officer's crop box, `NormalizedRect` and `FeedbackRegion` all use, and the only one a box
 * drawn over a browser-scaled picture can speak.
 */
export type OverlayHole = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type SourceOverlayOptions = Readonly<{
  /** Feather width in pixels. Omitted ⇒ derived from the frame; see FEATHER_SHARE. */
  feather?: number;
}>;

/**
 * How wide the ramp from motion to frozen artwork is, as a share of the SHORT edge.
 *
 * DERIVED, NOT PICKED. The crop module measured the model's own positional drift across two
 * renders of the same poster at ~17px on a 720x1280 frame; scaled onto a 1280x1600 canvas that
 * is `17 * (1600/900) ≈ 30px`, and `0.025 * 1280 = 32px` covers it. The feather is the only
 * thing standing between that drift and a hard seam along the edge of the hole, so it is sized
 * against the drift rather than against what looks soft.
 */
const FEATHER_SHARE = 0.025;

/** Below this the ramp stops being a ramp. A floor for very small frames. */
const FEATHER_MIN_PX = 8;

/** The classic smoothstep, clamped. 0 at and below 0, 1 at and above 1. */
function smoothstep(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * The officer's poster as a full-size RGBA PNG, opaque everywhere except a feathered hole over
 * `hole`, ready to be composited onto every frame of the clip.
 *
 * `size` must be the real pixel size of `framedPng` and is CHECKED rather than trusted: the one
 * mistake available here is passing the pre-bound dimensions `normalizeSourceImage` reports
 * alongside its bound bytes, which on a 4000px export is a 1.95x error that still looks
 * plausible in a thumbnail. A mismatch throws naming both numbers.
 *
 * Nothing in here resamples or recolours the RGB, so what this function hands back is exact;
 * what survives the ENCODE afterwards is near-exact, and the header says by how much.
 *
 * Alpha is 0 STRICTLY INSIDE the rectangle and ramps up to 255 outside it, so the feather eats
 * only into frozen artwork: the region the officer marked is 100% model motion. Shrinking their
 * rectangle to make room for the ramp would quietly betray the gesture.
 */
export async function buildFrozenSourceOverlay(
  framedPng: Buffer,
  size: Readonly<{ width: number; height: number }>,
  hole: OverlayHole,
  options: SourceOverlayOptions = {},
): Promise<Buffer> {
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Overlay size must be whole pixels: ${width}x${height}`);
  }
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Overlay size has no area: ${width}x${height}`);
  }

  for (const [name, value] of [
    ['x', hole.x],
    ['y', hole.y],
    ['width', hole.width],
    ['height', hole.height],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(
        `Motion region ${name} must be a fraction between 0 and 1: ${value}`,
      );
    }
  }
  if (!(hole.width > 0) || !(hole.height > 0)) {
    throw new Error('Motion region has no area.');
  }
  // The same epsilon the schema allows: a box dragged to the very edge of a scaled video lands
  // on 1.0000001 as often as on 1.
  if (hole.x + hole.width > 1.001 || hole.y + hole.height > 1.001) {
    throw new Error('Motion region falls outside the frame.');
  }

  const meta = await sharp(framedPng).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(
      `The overlay image is ${meta.width}x${meta.height} but was described as ` +
        `${width}x${height}. Pass the size of the image that was actually sent to the ` +
        `model (fitImageToAspect's own width/height), never normalizeSourceImage's ` +
        `pre-bound dimensions.`,
    );
  }

  const feather = Math.max(
    FEATHER_MIN_PX,
    options.feather ?? Math.round(FEATHER_SHARE * Math.min(width, height)),
  );

  // The hole in real pixels. Rounded so the transparent extent lands exactly where a caller can
  // predict it — `round(x * width)` — which is what the harness measures.
  const left = Math.round(hole.x * width);
  const top = Math.round(hole.y * height);
  const right = Math.round((hole.x + hole.width) * width);
  const bottom = Math.round((hole.y + hole.height) * height);

  // Per-axis ramps. `d` is the distance a pixel's CENTRE sits outside the rectangle on that
  // axis, zero anywhere within it.
  const fx = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    const centre = x + 0.5;
    const d = Math.max(left - centre, centre - right, 0);
    fx[x] = smoothstep(d / feather);
  }
  const fy = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    const centre = y + 0.5;
    const d = Math.max(top - centre, centre - bottom, 0);
    fy[y] = smoothstep(d / feather);
  }

  const alpha = Buffer.allocUnsafe(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowFactor = fy[y] ?? 0;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      // MAX — see the header. Min here is an inverted mask in disguise.
      const factor = Math.max(fx[x] ?? 0, rowFactor);
      alpha[row + x] = Math.round(255 * factor);
    }
  }

  // THE RGB IS MATERIALISED BEFORE THE JOIN, AND THAT IS NOT TIDINESS — IT IS THE BUG.
  //
  // The obvious one-liner, `sharp(png).removeAlpha().joinChannel(alpha).png()`, returns a
  // THREE-channel PNG: the joined channel is discarded, with no error and no warning, because
  // sharp resolves joinChannel against the pipeline's input rather than against the output of
  // removeAlpha. Every pixel then reads alpha 255 — the whole poster frozen, a clip that plays
  // perfectly and does not move. Measured, not guessed; it is the first thing this file's
  // harness caught. Decoding to raw RGB first gives joinChannel three real channels to attach a
  // fourth to, and the bytes are copied rather than resampled, so under any fully-opaque pixel
  // they are still the officer's own.
  const rgb = await sharp(framedPng).removeAlpha().raw().toBuffer();
  return await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/video/source-overlay.ts
//
// Pure sharp, sub-second, no ffmpeg. It exists because an inverted mask is the likeliest defect
// in this file and the most expensive to discover: it costs a paid render to see, and it looks
// like a clip that simply did not move — or like the text garbling this whole phase exists to
// remove, unchanged. So the corner and the hole centre are read out of the actual PNG rather
// than reasoned about.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  const WIDTH = 1280;
  const HEIGHT = 1600;

  // A poster stand-in with structure in it, so a colour round trip through
  // removeAlpha/joinChannel would show up rather than being hidden by a flat fill.
  const poster = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: { r: 210, g: 60, b: 40 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: 400,
            height: 300,
            channels: 3,
            background: { r: 12, g: 90, b: 200 },
          },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 120,
      },
    ])
    .png()
    .toBuffer();

  const hole = { x: 0.25, y: 0.4, width: 0.5, height: 0.3 };
  const overlay = await buildFrozenSourceOverlay(
    poster,
    { width: WIDTH, height: HEIGHT },
    hole,
  );

  const raw = await sharp(overlay).ensureAlpha().raw().toBuffer();
  const at = (x: number, y: number) => {
    const i = (y * WIDTH + x) * 4;
    return {
      r: raw[i] ?? -1,
      g: raw[i + 1] ?? -1,
      b: raw[i + 2] ?? -1,
      a: raw[i + 3] ?? -1,
    };
  };

  const meta = await sharp(overlay).metadata();
  check(
    meta.width === WIDTH && meta.height === HEIGHT && meta.channels === 4,
    `the overlay is ${meta.width}x${meta.height} with ${meta.channels} channels`,
  );

  // THE TWO THAT RULE OUT AN INVERTED MASK. Either one alone passes on a mask the wrong way
  // round; only the pair pins the orientation.
  check(at(0, 0).a === 255, `the top-left corner is ${at(0, 0).a}, not opaque`);
  check(
    at(WIDTH - 1, HEIGHT - 1).a === 255,
    `the bottom-right corner is ${at(WIDTH - 1, HEIGHT - 1).a}, not opaque`,
  );
  const centreX = Math.round((hole.x + hole.width / 2) * WIDTH);
  const centreY = Math.round((hole.y + hole.height / 2) * HEIGHT);
  check(
    at(centreX, centreY).a === 0,
    `the hole centre is ${at(centreX, centreY).a}, not transparent`,
  );

  // THE OFFICER'S RECTANGLE IS 100% MOTION, EDGE TO EDGE. The feather is allowed to eat into
  // frozen artwork and never into the region they marked — shrinking their rectangle to make
  // room for the ramp would quietly betray the gesture, and it would do it invisibly, by
  // half-freezing the very thing they asked to move. So every pixel from one declared edge to
  // the other must be fully transparent, not merely the centre.
  //
  // Note what is NOT asserted: that the column just outside is non-zero. A smoothstep is flat
  // where it starts, so the first pixel or two beyond the edge still round to 0 — that is the
  // ramp working, not the rectangle leaking, and asserting otherwise would be asserting a
  // hard edge into a feather that exists precisely to avoid one.
  const holeLeft = Math.round(hole.x * WIDTH);
  const holeTop = Math.round(hole.y * HEIGHT);
  const holeRight = Math.round((hole.x + hole.width) * WIDTH);
  const holeBottom = Math.round((hole.y + hole.height) * HEIGHT);
  let opaqueInside = 0;
  for (let x = holeLeft; x <= holeRight; x += 1) {
    if (at(x, centreY).a !== 0) opaqueInside += 1;
  }
  for (let y = holeTop; y <= holeBottom; y += 1) {
    if (at(centreX, y).a !== 0) opaqueInside += 1;
  }
  check(
    opaqueInside === 0,
    `${opaqueInside} pixel(s) inside the marked rectangle are not fully transparent`,
  );

  // MONOTONE, and never leaving [0,255]. A ramp that overshoots would band; one that is not
  // monotone would show a ring.
  let previous = -1;
  let monotone = true;
  let inRange = true;
  for (let x = holeLeft; x >= 0; x -= 1) {
    const a = at(x, centreY).a;
    if (a < 0 || a > 255) inRange = false;
    if (a < previous) monotone = false;
    previous = a;
  }
  check(monotone, 'the feather is not monotone walking out of the hole');
  check(inRange, 'the feather left the 0..255 range');
  check(
    at(Math.max(0, holeLeft - 80), centreY).a === 255,
    'the feather had not reached fully opaque 80px outside the hole',
  );

  // NO COLOUR ROUND TRIP. Under any fully-opaque pixel the RGB must be the poster's own byte
  // for byte. This is the one place equality IS the right assertion — there is no codec between
  // here and the source, so any drift would be sharp resampling or recolouring rather than the
  // encode, and it would be a defect. (Once the clip is encoded, 3/255 is the honest bar; see
  // crop-video.ts's restore assertions.)
  const sourceRaw = await sharp(poster).removeAlpha().raw().toBuffer();
  let colourDrift = 0;
  for (const [x, y] of [
    [0, 0],
    [150, 200],
    [1279, 1599],
    [640, 60],
  ] as const) {
    const i = (y * WIDTH + x) * 3;
    const px = at(x, y);
    if (
      px.a === 255 &&
      (px.r !== sourceRaw[i] ||
        px.g !== sourceRaw[i + 1] ||
        px.b !== sourceRaw[i + 2])
    ) {
      colourDrift += 1;
    }
  }
  check(
    colourDrift === 0,
    `${colourDrift} opaque sample(s) differ from the source's own RGB`,
  );

  // The guards, each of which must refuse before allocating a frame's worth of alpha.
  for (const [name, bad] of [
    ['no area', { x: 0.1, y: 0.1, width: 0, height: 0.3 }],
    ['past the right edge', { x: 0.8, y: 0, width: 0.5, height: 0.3 }],
    ['past the bottom edge', { x: 0, y: 0.8, width: 0.3, height: 0.5 }],
    ['not a fraction', { x: -0.2, y: 0, width: 0.3, height: 0.3 }],
    ['not finite', { x: Number.NaN, y: 0, width: 0.3, height: 0.3 }],
  ] as const) {
    let refused = false;
    try {
      await buildFrozenSourceOverlay(
        poster,
        { width: WIDTH, height: HEIGHT },
        bad,
      );
    } catch {
      refused = true;
    }
    check(refused, `a region ${name} was accepted`);
  }

  // THE PRE-BOUND DIMENSION MISTAKE, refused loudly rather than mis-scaled.
  let sizeRefused = false;
  try {
    await buildFrozenSourceOverlay(poster, { width: 2560, height: 3200 }, hole);
  } catch {
    sizeRefused = true;
  }
  check(sizeRefused, 'a wrong declared size was accepted');

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      'All source-overlay assertions passed (read out of a real PNG).',
    );
  }
}
