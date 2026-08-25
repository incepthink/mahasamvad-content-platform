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
// THE FOOTER IS APPENDED, NOT PASTED OVER (2026-08-25) — the social lane's 2026-08-10 fix,
// brought here because the same failure kept happening: a thumbnail shipped with its own
// information under the department strip. The reserve protecting it could only ever be a
// REQUEST, and an image model has no ruler, while every other rule in that prompt pushes it
// to fill the frame. So the band's height is taken out of the REQUEST rather than off the
// finished image: gpt-image is asked for YOUTUBE_ARTWORK_HEIGHT, a strip is joined below it
// (footer-extension.ts, shared verbatim with the poster lane), the band is stamped THERE, and
// the sum is exactly 1280x720. Nothing the model paints can be covered, however badly it
// ignores the reserve.
//
// It is 656 and not 720 - 52 because gpt-image-2 requires BOTH dimensions divisible by 16
// ("Invalid size '1280x1509'. Width and height must both be divisible by 16." — verified live
// on the social lane, 2026-08-13). So the artwork is 656 (16 x 41) and the strip is the 64px
// remainder, a little taller than the band's own 52px; the extra ~12px is filled by the same
// edge-continuation that makes the join invisible, so it reads as the thumbnail, not padding.
// Any change to either number must keep artwork % 16 === 0 and strip >= band height.
//
// THE BADGE IS STILL A DESTRUCTIVE OVERLAY, deliberately, exactly as on the social lane: an
// appended strip can only ever guarantee an EDGE, and guaranteeing the top-right CORNER would
// mean a full-width band above the artwork — 128px of a 720px frame, a visible change to how
// every thumbnail looks. A corner rarely holds the tail of a sentence; the bottom edge always
// does.
//
// The reserved-zone numbers quoted to the image model live in
// content-engine/src/generation/build-youtube-thumbnail-prompt.ts and MUST stay in sync
// with the constants below. On the 1280x656 artwork canvas the lockup is 116x112 at an 8px
// margin from the top-right corner (the prompt reserves 130x130 there), and the footer band
// is full-width ~52px tall on the joined strip (the prompt asks only that TEXT stop 16px above
// the bottom edge, while the design itself runs off it). Tune both for free with
// `pnpm --filter @dgipr/poster-renderer poster:preview:chrome:youtube`.
//
// Why smaller than the social lockup: twitter's 160x154 badge is 9.6% of a 1600px-tall
// canvas, while the same badge on a 720px-tall frame would eat 21% of the height. The
// proportion is matched to the FRAME, not copied in pixels.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { joinFooterStrip, type FooterJoinSpec } from './footer-extension.js';
import { renderGovernmentLockup } from './twitter-chrome.js';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// Base units are pixels on the thumbnail canvas itself: an initial render is always asked for
// 1280x656 and a feedback edit for 1280x720 (YOUTUBE_ARTWORK_DIMENSIONS /
// YOUTUBE_THUMBNAIL_DIMENSIONS in content-engine), so the scale factor is normally 1 — it only
// kicks in if the model ever returns another width.
const ASSET_BASE_WIDTH = 1280;
const LOCKUP_WIDTH = 116;
const LOCKUP_MARGIN = 8;

/**
 * The finished YouTube thumbnail: 1280x720, a true 16:9, which is what YouTube takes as a
 * custom thumbnail with no letterboxing or crop.
 */
export const YOUTUBE_THUMBNAIL_WIDTH = 1280;
export const YOUTUBE_THUMBNAIL_HEIGHT = 720;

/**
 * The canvas the IMAGE MODEL is asked for — the finished thumbnail minus the strip the
 * branding band is joined onto. Must stay divisible by 16 (gpt-image-2 rejects anything else)
 * and must leave a strip at least as tall as the band. Keep in sync with THUMBNAIL_ZONES.height
 * in content-engine/src/generation/build-youtube-thumbnail-prompt.ts.
 */
export const YOUTUBE_ARTWORK_HEIGHT = 656;

/** The render size to request for YouTube thumbnail artwork, e.g. for editImage. */
export const YOUTUBE_ARTWORK_SIZE = `${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_ARTWORK_HEIGHT}`;

// The two shapes overlayYoutubeChrome has to tell apart: fresh artwork, and a finished
// thumbnail coming back round through a feedback edit. joinFooterStrip owns that decision and
// the strip arithmetic, shared verbatim with the social poster lane.
const YOUTUBE_FOOTER_JOIN: FooterJoinSpec = {
  baseWidth: ASSET_BASE_WIDTH,
  artworkHeight: YOUTUBE_ARTWORK_HEIGHT,
  finishedHeight: YOUTUBE_THUMBNAIL_HEIGHT,
};

/**
 * Snap a render to whichever of this lane's two canonical shapes it is nearest — the
 * 1280x656 ARTWORK an initial render is asked for, or the finished 1280x720 thumbnail a
 * feedback round re-edits — cover-cropping any overshoot.
 *
 * The model is asked for the right one and normally obliges, so this is usually a no-op. It
 * exists because the chrome geometry, the reserved zones quoted in the prompt and the
 * officer's expectation of a 16:9 thumbnail all assume those frames, and a model that quietly
 * answers in another aspect would otherwise be mistaken for the OTHER shape by the footer
 * join — putting the band at the wrong height, or growing the thumbnail by a strip it already
 * has, with no error anywhere. The 720p caption bug is the precedent: a size mismatch between
 * a fixed overlay and variable footage failed silently and shipped.
 *
 * Snapping to the nearest rather than always to 1280x720 is what keeps the two paths honest:
 * cropping a 656-tall artwork up to 720 would throw away the very rows the strip exists to
 * preserve.
 */
export async function fitToYoutubeThumbnail(png: Buffer): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read thumbnail dimensions.');
  }
  const aspect = meta.height / meta.width;
  const artworkAspect = YOUTUBE_ARTWORK_HEIGHT / YOUTUBE_THUMBNAIL_WIDTH;
  const finishedAspect = YOUTUBE_THUMBNAIL_HEIGHT / YOUTUBE_THUMBNAIL_WIDTH;
  const height =
    Math.abs(aspect - finishedAspect) < Math.abs(aspect - artworkAspect)
      ? YOUTUBE_THUMBNAIL_HEIGHT
      : YOUTUBE_ARTWORK_HEIGHT;

  if (meta.width === YOUTUBE_THUMBNAIL_WIDTH && meta.height === height) {
    return png;
  }
  console.warn(
    `[youtube-chrome] render came back ${meta.width}x${meta.height}; fitting to ${YOUTUBE_THUMBNAIL_WIDTH}x${height}.`,
  );
  return sharp(png)
    .resize({
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height,
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
 * Composite the emblem + Marathi wordmark lockup (top-right, OVER the artwork) and
 * yt-footer.png (full-width, on a strip JOINED BELOW the artwork) onto a thumbnail PNG,
 * returning a finished 1280x720 PNG.
 *
 * Handed fresh 1280x656 artwork it grows the canvas and stamps the band on the new strip;
 * handed a finished 1280x720 thumbnail coming back through a feedback edit it re-stamps the
 * band in place, so repeated rounds keep the chrome crisp without the thumbnail growing.
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

  const joined = await joinFooterStrip(
    thumbnail,
    YOUTUBE_FOOTER_JOIN,
    footer.height,
  );

  const margin = Math.round(LOCKUP_MARGIN * scale);
  return sharp(joined.base)
    .composite([
      {
        input: lockup.data,
        left: meta.width - lockup.width - margin,
        top: margin,
      },
      { input: footer.data, left: 0, top: joined.height - footer.height },
    ])
    .png()
    .toBuffer();
}
