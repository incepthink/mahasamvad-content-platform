// Stamp the brand chrome onto a rendered YouTube thumbnail: the Government of
// Maharashtra emblem lockup (top-right, the SAME artwork as the social poster —
// renderGovernmentLockup) and yt-footer.png, the department strip that runs the full
// width of the bottom edge.
//
// Mirrors twitter-chrome.ts / article-chrome.ts: the image prompt reserves these zones
// and the API composites these immutable graphics after the render returns, so no image
// model ever paints the emblem or the footer's Devanagari and social handles. Applies to
// the initial render and to pixel-feedback re-renders alike (feedback re-edits a
// thumbnail that already carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in
// content-engine/src/generation/build-youtube-thumbnail-prompt.ts and MUST stay in sync
// with the constants below. At the 1280x720 canvas the lockup is 116x112 at an 8px
// margin from the top-right corner (the prompt reserves 130x130 there), and the footer
// is full-width ~52px tall (the prompt reserves 70px at the bottom). Tune both for free
// with `pnpm --filter @dgipr/poster-renderer poster:preview:chrome:youtube`.
//
// Why smaller than the social lockup: twitter's 160x154 badge is 9.6% of a 1600px-tall
// canvas, while the same badge on a 720px-tall frame would eat 21% of the height. The
// proportion is matched to the FRAME, not copied in pixels.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderGovernmentLockup } from './twitter-chrome.js';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// Base units are pixels on the thumbnail canvas itself: a thumbnail is always rendered
// at 1280x720 (YOUTUBE_THUMBNAIL_DIMENSIONS in content-engine), so the scale factor is
// normally 1 — it only kicks in if the model ever returns another width.
const ASSET_BASE_WIDTH = 1280;
const LOCKUP_WIDTH = 116;
const LOCKUP_MARGIN = 8;

/** The thumbnail canvas every prompt, render and overlay on this lane assumes. */
export const YOUTUBE_THUMBNAIL_WIDTH = 1280;
export const YOUTUBE_THUMBNAIL_HEIGHT = 720;

/**
 * Force a rendered thumbnail to exactly 1280x720, cover-cropping any overshoot.
 *
 * The image model is ASKED for 1280x720 and normally obliges, so this is usually a no-op —
 * it exists because the chrome geometry, the reserved zones quoted in the prompt and the
 * officer's own expectation of a YouTube thumbnail all assume that one frame, and a model
 * that quietly answers in another aspect would otherwise put the footer band at the wrong
 * height with no error anywhere. The 720p caption bug is the precedent: a size mismatch
 * between a fixed overlay and variable footage failed silently and shipped.
 */
export async function fitToYoutubeThumbnail(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read thumbnail dimensions.');
  }
  if (
    meta.width === YOUTUBE_THUMBNAIL_WIDTH &&
    meta.height === YOUTUBE_THUMBNAIL_HEIGHT
  ) {
    return png;
  }
  console.warn(
    `[youtube-chrome] render came back ${meta.width}x${meta.height}; fitting to ${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_THUMBNAIL_HEIGHT}.`,
  );
  return sharp(png)
    .resize({
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height: YOUTUBE_THUMBNAIL_HEIGHT,
      fit: 'cover',
      position: 'centre',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();
}

async function loadYoutubeFooter(
  targetWidth: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const source = sharp(resolve(ASSETS_DIR, 'yt-footer.png'));
  const meta = await source.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read dimensions of the YouTube footer asset.');
  }
  // Unlike footer-new-poster.png, yt-footer.png is the artwork alone (4000x164) with no
  // surrounding transparent canvas, so there is nothing to extract — resize and place it.
  const width = Math.round(targetWidth);
  const height = Math.round((meta.height / meta.width) * width);
  const data = await source
    .resize({ width, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { data, width, height };
}

/**
 * Composite the emblem + Marathi wordmark lockup (top-right) and yt-footer.png
 * (full-width, flush to the bottom edge) onto a thumbnail PNG, returning a new PNG.
 */
export async function overlayYoutubeChrome(thumbnail: Buffer): Promise<Buffer> {
  const meta = await sharp(thumbnail).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read thumbnail dimensions for chrome overlay.');
  }
  const scale = meta.width / ASSET_BASE_WIDTH;

  const [lockup, footer] = await Promise.all([
    renderGovernmentLockup(LOCKUP_WIDTH * scale),
    loadYoutubeFooter(meta.width),
  ]);

  const margin = Math.round(LOCKUP_MARGIN * scale);
  return sharp(thumbnail)
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
