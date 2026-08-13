// Stamp the brand chrome — the Government of Maharashtra emblem lockup (a clean
// white rounded-square badge with poster-logo-new.png and "महाराष्ट्र शासन",
// top-right) and the department footer band + social-handle strip
// (footer-new-poster.png, full-width bottom) — onto a rendered social poster.
// Mirrors article-chrome.ts: the image prompts erase the master's chrome and reserve
// these zones, and the API composites these immutable graphics after the render
// returns. Applies to BOTH the initial render and pixel-feedback edits (feedback
// re-edits a poster that already carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the prompt builders
// (content-engine/build-poster-prompt.ts) and must stay in sync with the constants below: at
// the 1280x1600 canvas the tightly-fitted white lockup badge is 160x154 at a 6px margin from
// the top-right corner, and the prompt reserves 180x170 there.
//
// THE FOOTER IS APPENDED, NOT PASTED OVER (2026-08-10). The badge is still a destructive
// overlay — it sits in a corner that almost never holds the tail of a sentence — but the
// full-width footer band is now stamped onto a strip ADDED BELOW the artwork
// (footer-extension.ts). The band was burying the last line of long posters, and the reserve
// protecting it could only ever be a request: an image model has no ruler, and the same prompt
// tells it three times over to show every point and match the reference's density. Appending
// makes the failure impossible instead of unlikely. What the prompt asks for at the bottom is
// that the DESIGN run off the edge in whatever colours it uses, with only a 16px cushion below
// the last line of text — see footerAppendedMargin in build-poster-prompt.ts. It asked for a
// calm plain-background margin first, and that produced a poster with 173 flat grey pixels
// above its own footer.
//
// AND THE FINISHED POSTER IS 4:5 AGAIN (2026-08-13). Appending made the delivered file
// 1280x1691 — 1:1.32, no longer the 4:5 the whole product assumes. Officers place these on a
// 1080x1350 Canva canvas, where a taller-than-4:5 image leaves a gap down each side that they
// then close by hand, displacing the design. So the height is taken out of the REQUEST rather
// than off the finished image: the model is asked for SOCIAL_ARTWORK_HEIGHT, the strip is
// joined below it, and the sum is exactly SOCIAL_POSTER_HEIGHT. Cropping the artwork instead
// would have reopened the burying bug this file exists to close, and squashing it distorts.
//
// The artwork height is NOT 1600 - 91. gpt-image-2 requires BOTH dimensions divisible by 16
// ("Invalid size '1280x1509'. Width and height must both be divisible by 16." — verified live
// 2026-08-13, a 400 that arrives in ~1s and would fail the run after the copy call is paid
// for). So the artwork is 1504 (16 x 94) and the appended strip is the 96px remainder, which
// is a little taller than the band's own ~91px: the extra ~5px is filled by the same
// edge-continuation that makes the join invisible, so it reads as the poster, not as padding.
// Any future change to either number must keep artwork % 16 === 0 and strip >= band height.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadScaled } from './article-chrome.js';
import { extendCanvasForFooter } from './footer-extension.js';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// Base units are pixels on the twitter canvas itself: masters are always 1280 wide
// (MASTER_DIMENSIONS in content-engine) and so is every render, so the scale factor is
// normally 1 — it only kicks in if the model ever returns another width.
const ASSET_BASE_WIDTH = 1280;
const LOCKUP_WIDTH = 160;
const LOCKUP_HEIGHT = 154;
const LOCKUP_CORNER_RADIUS = 12;
const LOCKUP_MARGIN = 6;
const EMBLEM_TARGET_WIDTH = 96;
const EMBLEM_TOP = 8;
const LABEL_TOP = 119;
const LABEL_MAX_WIDTH = 154;
const LABEL_FONT_SIZE = 21;
const LABEL = 'महाराष्ट्र शासन';
const LABEL_COLOUR = '#17324d';
// footer-new-poster.png was exported on a 3376x4219 transparent canvas; the
// intended footer artwork occupies the bottom 239 pixels.
const SOCIAL_FOOTER_SOURCE_HEIGHT = 239;

/**
 * The finished DGIPR social poster: 1280x1600, a true 4:5, which is what drops into a
 * 1080x1350 Canva/Instagram/Facebook portrait frame with no gap.
 */
export const SOCIAL_POSTER_HEIGHT = 1600;

/**
 * The canvas the IMAGE MODEL is asked for — the finished poster minus the strip the branding
 * band is joined onto. Must stay divisible by 16 (gpt-image-2 rejects anything else) and must
 * leave a strip at least as tall as the band. Keep in sync with SOCIAL_ZONES.height in
 * content-engine/src/generation/build-poster-prompt.ts, which is what the prompt reserves.
 */
export const SOCIAL_ARTWORK_HEIGHT = 1504;

/** The render size to request for DGIPR social artwork, e.g. for generateImage / n8n. */
export const SOCIAL_ARTWORK_SIZE = `${ASSET_BASE_WIDTH}x${SOCIAL_ARTWORK_HEIGHT}`;

/** How much canvas is added below the artwork. Taller than the band by design — see the header. */
const FOOTER_STRIP_HEIGHT = SOCIAL_POSTER_HEIGHT - SOCIAL_ARTWORK_HEIGHT;

// The two shapes overlayTwitterChrome has to tell apart, as height/width: fresh artwork, and a
// finished poster coming back round through a feedback edit. Both are derived from the
// constants above rather than from the runtime band height, so the finished poster is exactly
// 4:5 whatever the footer asset measures.
const DESIGN_ASPECT = SOCIAL_ARTWORK_HEIGHT / ASSET_BASE_WIDTH;
const FINISHED_ASPECT = SOCIAL_POSTER_HEIGHT / ASSET_BASE_WIDTH;

export type GovernmentLockupRaster = Readonly<{
  data: Buffer;
  width: number;
  height: number;
}>;
type Raster = GovernmentLockupRaster;

// Render the Marathi wordmark through Sharp/Pango with the bundled Devanagari
// font. The emblem remains a high-resolution raster, while the label is freshly
// shaped at the output size so both stay sharp and perfectly centred.
async function renderGovernmentLabel(scale: number): Promise<Raster> {
  const data = await sharp({
    text: {
      text: `<span foreground="${LABEL_COLOUR}">${LABEL}</span>`,
      font: `Mukta SemiBold ${LABEL_FONT_SIZE}`,
      fontfile: resolve(ASSETS_DIR, 'fonts/Mukta-SemiBold.ttf'),
      width: Math.round(LABEL_MAX_WIDTH * scale),
      align: 'centre',
      rgba: true,
      dpi: Math.max(1, Math.round(72 * scale)),
    },
  })
    .png()
    .toBuffer();
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not render the Maharashtra government wordmark.');
  }
  return { data, width: meta.width, height: meta.height };
}

async function buildGovernmentLockup(scale: number): Promise<Raster> {
  const width = Math.round(LOCKUP_WIDTH * scale);
  const height = Math.round(LOCKUP_HEIGHT * scale);
  const stroke = Math.max(1, 1.5 * scale);
  const strokeInset = stroke / 2;
  const cornerRadius = LOCKUP_CORNER_RADIUS * scale;
  const card = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${strokeInset}" y="${strokeInset}"
        width="${width - stroke}" height="${height - stroke}"
        rx="${cornerRadius}" ry="${cornerRadius}"
        fill="#ffffff" stroke="#dce3ea" stroke-width="${stroke}"/>
    </svg>`,
  );
  const [emblem, label] = await Promise.all([
    loadScaled('poster-logo-new.png', EMBLEM_TARGET_WIDTH * scale),
    renderGovernmentLabel(scale),
  ]);

  return {
    data: await sharp(card)
      .composite([
        {
          input: emblem.data,
          left: Math.round((width - emblem.width) / 2),
          top: Math.round(EMBLEM_TOP * scale),
        },
        {
          input: label.data,
          left: Math.round((width - label.width) / 2),
          top: Math.round(LABEL_TOP * scale),
        },
      ])
      .png()
      .toBuffer(),
    width,
    height,
  };
}

// Shared with the explainer-video path so posters and videos always use the
// exact same Maharashtra Government emblem + wordmark artwork. Callers choose
// the target width; the social poster uses 160px on a 1280px canvas, while
// video intentionally asks for a slightly larger proportion.
export async function renderGovernmentLockup(
  targetWidth: number,
): Promise<GovernmentLockupRaster> {
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    throw new Error('Government lockup target width must be positive.');
  }
  return buildGovernmentLockup(targetWidth / LOCKUP_WIDTH);
}

async function loadSocialFooter(targetWidth: number): Promise<Raster> {
  const source = sharp(resolve(ASSETS_DIR, 'footer-new-poster.png'));
  const meta = await source.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.height < SOCIAL_FOOTER_SOURCE_HEIGHT
  ) {
    throw new Error('Could not read dimensions of social footer asset.');
  }

  const width = Math.round(targetWidth);
  const height = Math.round((SOCIAL_FOOTER_SOURCE_HEIGHT / meta.width) * width);
  const data = await source
    .extract({
      left: 0,
      top: meta.height - SOCIAL_FOOTER_SOURCE_HEIGHT,
      width: meta.width,
      height: SOCIAL_FOOTER_SOURCE_HEIGHT,
    })
    .resize({ width, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { data, width, height };
}

// Composite the white emblem + Marathi wordmark lockup into the top-right corner, and
// footer-new-poster.png onto a strip appended below the artwork, returning a new PNG.
//
// IDEMPOTENCE. This runs on initial renders AND on pixel-feedback re-renders, and a feedback
// round edits the poster this function last produced — which already carries its appended
// strip. Extending unconditionally would grow the poster by a strip every round. So the two
// cases are told apart by ASPECT rather than by a flag or a stored dimension: fresh artwork
// comes back at DESIGN_ASPECT (1:1.175), a finished poster at FINISHED_ASPECT (4:5). Aspect
// rather than absolute height because the model is not contractually bound to return 1280
// wide, and everything else in this file already scales off the width it actually got.
export async function overlayTwitterChrome(poster: Buffer): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for chrome overlay.');
  }
  const scale = meta.width / ASSET_BASE_WIDTH;

  const [lockup, footer] = await Promise.all([
    renderGovernmentLockup(LOCKUP_WIDTH * scale),
    loadSocialFooter(meta.width),
  ]);

  const aspect = meta.height / meta.width;
  const alreadyExtended =
    Math.abs(aspect - FINISHED_ASPECT) < Math.abs(aspect - DESIGN_ASPECT);

  // The strip is the remainder that makes the finished poster exactly 4:5, never the band's own
  // height — that is what closes the ~5px the divisible-by-16 artwork leaves over. The max() is
  // a floor, not a policy: a band taller than the remainder would otherwise be cropped.
  const strip = Math.max(
    footer.height,
    Math.round(FOOTER_STRIP_HEIGHT * scale),
  );
  const base = alreadyExtended
    ? poster
    : await extendCanvasForFooter(poster, strip);
  const baseHeight = alreadyExtended ? meta.height : meta.height + strip;

  const margin = Math.round(LOCKUP_MARGIN * scale);
  return sharp(base)
    .composite([
      {
        input: lockup.data,
        left: meta.width - lockup.width - margin,
        top: margin,
      },
      { input: footer.data, left: 0, top: baseHeight - footer.height },
    ])
    .png()
    .toBuffer();
}
