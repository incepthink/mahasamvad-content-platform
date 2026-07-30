// Stamp the brand chrome — the Government of Maharashtra emblem lockup (a clean
// white rounded-square badge with poster-logo-new.png and "महाराष्ट्र शासन",
// top-right) and the department footer band + social-handle strip
// (footer-new-poster.png, full-width bottom) — onto a rendered social poster.
// Mirrors article-chrome.ts: the image prompts erase the master's chrome and reserve
// these zones, and the API composites these immutable graphics after the render
// returns. Applies to BOTH the initial render and pixel-feedback edits (feedback
// re-edits a poster that already carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the n8n workflow's
// prompt builders (content-engine/build-poster-prompt.ts) and must stay in sync
// with the constants below: at the 1280x1600 canvas the tightly-fitted white lockup badge is
// 160x154 at a 6px margin from the top-right corner. The fixed-template prompt
// reserves 180x170 there. The footer is full-width ~91px tall; fixed-template
// mode reserves 120px at the bottom.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadScaled } from './article-chrome.js';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// Base units are pixels on the twitter canvas itself: masters and n8n renders are
// always 1280x1600 (MASTER_DIMENSIONS in content-engine), so the scale factor is
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

// Composite the white emblem + Marathi wordmark lockup (top-right) and
// footer-new-poster.png (full-width, flush to the bottom edge) onto the poster PNG
// and return the result as a new PNG buffer.
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

  const margin = Math.round(LOCKUP_MARGIN * scale);
  return sharp(poster)
    .composite([
      {
        input: lockup.data,
        left: meta.width - lockup.width - margin,
        top: margin,
      },
      { input: footer.data, left: 0, top: meta.height - footer.height },
    ])
    .png()
    .toBuffer();
}
