// Stamp the brand chrome — the महासंवाद logo card (top-left) and the department
// footer band + social-handle strip (full-width bottom) — onto an n8n-rendered
// article poster. The image model is prompted to leave those zones as plain
// background (it can't render the Devanagari lockups crisply), so the API
// composites these immutable PNGs after the webhook returns. Applies to BOTH the
// initial render and pixel-feedback edits (feedback re-edits a poster that already
// carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the n8n workflow's
// Build Prompt node (n8n/workflow-exports/article-poster-v1-api.json) and must stay
// in sync with the constants below: at a 1536-wide canvas the composited logo is
// ~507x181 at a ~35px margin (zone quoted as the top-left ~560x220) and the footer
// is full-width ~148px tall (zone quoted as the bottom ~150px).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

// All sizes below are in "base units": pixels on a 696-wide canvas (half of the
// 1392-wide article frame design, the scale article-footer.png was cropped at).
// Everything is multiplied by posterWidth / 696 before compositing, so the chrome
// keeps its designed proportions on any canvas (the n8n path renders 1536x1024).
const ASSET_BASE_WIDTH = 696;
// The article-logo.png card is edge-to-edge content but larger than the logo's
// designed footprint; 230 matches the logo width in article-header-footer.png.
const LOGO_TARGET_WIDTH = 230;
// Logo offset from the poster's top-left corner.
const LOGO_MARGIN = 16;

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

// Composite article-logo.png (top-left) and poster-footer.png (full-width, flush to
// the bottom edge) onto the poster PNG and return the result as a new PNG buffer.
export async function overlayArticleChrome(poster: Buffer): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for chrome overlay.');
  }
  const scale = meta.width / ASSET_BASE_WIDTH;

  const [logo, footer] = await Promise.all([
    loadScaled('article-logo.png', LOGO_TARGET_WIDTH * scale),
    loadScaled('poster-footer.png', meta.width),
  ]);

  const margin = Math.round(LOGO_MARGIN * scale);
  return sharp(poster)
    .composite([
      { input: logo.data, left: margin, top: margin },
      { input: footer.data, left: 0, top: meta.height - footer.height },
    ])
    .png()
    .toBuffer();
}
