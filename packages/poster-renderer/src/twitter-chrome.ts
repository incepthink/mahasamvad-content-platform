// Stamp the brand chrome — the Government of Maharashtra emblem lockup
// (poster-logo.png, top-right) and the department footer band + social-handle
// strip (poster-footer.png, full-width bottom) — onto an n8n-rendered twitter
// poster. Mirrors article-chrome.ts: the social-post-v2-api prompts erase the
// master's chrome and reserve these zones, and the API composites these immutable
// PNGs after the webhook returns. Applies to BOTH the initial render and
// pixel-feedback edits (feedback re-edits a poster that already carries the
// chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the n8n workflow's
// Build Image Prompt and Build Feedback Prompt nodes
// (n8n/workflow-exports/social-post-v2-api.json) and must stay in sync with the
// constants below: at the 1280x1600 canvas the composited emblem is ~150x137 at a
// ~20px margin from the top-right corner (zone quoted as the top-right ~220x180)
// and the footer is full-width ~123px tall (zone quoted as the bottom ~130px).

import sharp from 'sharp';
import { loadScaled } from './article-chrome.js';

// Base units are pixels on the twitter canvas itself: masters and n8n renders are
// always 1280x1600 (MASTER_DIMENSIONS in content-engine), so the scale factor is
// normally 1 — it only kicks in if the model ever returns another width.
const ASSET_BASE_WIDTH = 1280;
// Matches the emblem block width in the poster-header-footer.png frame design
// (the poster-logo.png asset is 166px wide edge-to-edge).
const LOGO_TARGET_WIDTH = 150;
// Emblem offset from the poster's top and right edges.
const LOGO_MARGIN = 20;

// Composite poster-logo.png (top-right) and poster-footer.png (full-width, flush
// to the bottom edge) onto the poster PNG and return the result as a new PNG
// buffer.
export async function overlayTwitterChrome(poster: Buffer): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for chrome overlay.');
  }
  const scale = meta.width / ASSET_BASE_WIDTH;

  const [logo, footer] = await Promise.all([
    loadScaled('poster-logo.png', LOGO_TARGET_WIDTH * scale),
    loadScaled('poster-footer.png', meta.width),
  ]);

  const margin = Math.round(LOGO_MARGIN * scale);
  return sharp(poster)
    .composite([
      { input: logo.data, left: meta.width - logo.width - margin, top: margin },
      { input: footer.data, left: 0, top: meta.height - footer.height },
    ])
    .png()
    .toBuffer();
}
