// Stamp the brand chrome — the महासंवाद logo card (top-left) and the department
// footer band + social-handle strip (full-width bottom) — onto an n8n-rendered
// article poster. The image model keeps text and important subjects out of those
// zones but continues ordinary background colour and imagery through them, so the API
// composites these immutable PNGs after the webhook returns. Applies to BOTH the
// initial render and pixel-feedback edits (feedback re-edits a poster that already
// carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the n8n workflow's
// Build Prompt node (n8n/workflow-exports/article-poster-v1-api.json) and must stay
// in sync with the constants below: at a 1536-wide canvas the composited logo is
// ~342x122 at left 31 / top 13, so it occupies x 31-373, y 13-135 (zone quoted as
// the top-left ~420x180) and the footer is full-width ~111px tall (zone quoted as
// the bottom ~150px). apps/web's ARTICLE_RESERVED_ZONES mirrors the same numbers
// normalized.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// All sizes below are in "base units": pixels on a 696-wide canvas (half of the
// 1392-wide article frame design, the scale article-footer.png was cropped at).
// Everything is multiplied by posterWidth / 696 before compositing, so the chrome
// keeps its designed proportions on any canvas (the n8n path renders 1536x1024).
const ASSET_BASE_WIDTH = 696;
// The logo's designed footprint, measured off article-header-footer.png itself:
// its bounding box there is 155x56 at left 14, top 3. article-logo.png (151x54) is
// that same crop, so rendering it at 155 base units reproduces the official frame's
// proportions — 22.3% of the poster width. (It was previously stamped at 230, a
// third of the width, on the mistaken belief that 230 matched the frame design.)
const LOGO_TARGET_WIDTH = 155;
// Logo offset from the poster's left and top edges. The frame design sits at 14/3;
// the top gets a couple of base units more breathing room because the n8n render is
// a photograph rather than a white frame.
const LOGO_MARGIN_LEFT = 14;
const LOGO_MARGIN_TOP = 6;
// article-footer-new.png was exported on a 6000x3376 transparent canvas; the
// intended footer artwork occupies the bottom 435 pixels.
const ARTICLE_FOOTER_SOURCE_HEIGHT = 435;

export async function loadScaled(
  file: string,
  targetWidth: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const source = await readFile(resolve(ASSETS_DIR, file));
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions of asset ${file}`);
  }
  const width = Math.round(targetWidth);
  const height = Math.round((meta.height / meta.width) * width);
  const data = await sharp(source)
    .resize({ width, height, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { data, width, height };
}

async function loadArticleFooter(
  targetWidth: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const source = sharp(resolve(ASSETS_DIR, 'article-footer-new.png'));
  const meta = await source.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.height < ARTICLE_FOOTER_SOURCE_HEIGHT
  ) {
    throw new Error('Could not read dimensions of article footer asset.');
  }

  const width = Math.round(targetWidth);
  const height = Math.round(
    (ARTICLE_FOOTER_SOURCE_HEIGHT / meta.width) * width,
  );
  const data = await source
    .extract({
      left: 0,
      top: meta.height - ARTICLE_FOOTER_SOURCE_HEIGHT,
      width: meta.width,
      height: ARTICLE_FOOTER_SOURCE_HEIGHT,
    })
    .resize({ width, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { data, width, height };
}

// Composite article-logo.png (top-left) and article-footer-new.png (full-width,
// flush to the bottom edge) onto the poster PNG and return the result as a new
// PNG buffer.
export async function overlayArticleChrome(poster: Buffer): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for chrome overlay.');
  }
  const scale = meta.width / ASSET_BASE_WIDTH;

  const [logo, footer] = await Promise.all([
    loadScaled('article-logo.png', LOGO_TARGET_WIDTH * scale),
    loadArticleFooter(meta.width),
  ]);

  const left = Math.round(LOGO_MARGIN_LEFT * scale);
  const top = Math.round(LOGO_MARGIN_TOP * scale);
  return sharp(poster)
    .composite([
      { input: logo.data, left, top },
      { input: footer.data, left: 0, top: meta.height - footer.height },
    ])
    .png()
    .toBuffer();
}
