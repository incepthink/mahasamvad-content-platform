// Offline preview of the YouTube-thumbnail chrome overlay (the government lockup
// top-right + yt-footer.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/youtube-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:youtube [thumbnail.png]
//
// With a PNG argument (e.g. a real render) the chrome is stamped onto it and written as
// <input>.chrome-preview.png next to it. Without one, a flat 1280x720 stand-in canvas
// (colour bands + reserved-zone guides) is used and the result goes to
// content-engine/data/output/youtube-chrome-preview.png (gitignored).
//
// It also ASSERTS that the stamped chrome stays inside the zones the prompt reserves,
// rather than asking you to look: the lockup must fit in the top-right 130x130 and the
// footer must fit in the bottom 70px. Those two numbers are quoted verbatim to the image
// model in build-youtube-thumbnail-prompt.ts, and a silent drift between them is exactly
// how a caption ends up behind a footer band (the 720p caption bug).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  overlayYoutubeChrome,
  YOUTUBE_THUMBNAIL_HEIGHT,
  YOUTUBE_THUMBNAIL_WIDTH,
} from '../src/youtube-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

// The reserved zones the prompt declares. Keep in sync with
// build-youtube-thumbnail-prompt.ts and src/youtube-chrome.ts.
const RESERVED_LOCKUP = { width: 130, height: 130 };
const RESERVED_FOOTER_HEIGHT = 70;

// Flat landscape stand-in for a thumbnail render: a colour field plus a headline card,
// with faint outlines marking the reserved zones.
async function placeholderThumbnail(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YOUTUBE_THUMBNAIL_WIDTH}" height="${YOUTUBE_THUMBNAIL_HEIGHT}">
    <rect width="${YOUTUBE_THUMBNAIL_WIDTH}" height="${YOUTUBE_THUMBNAIL_HEIGHT}" fill="#d97a12"/>
    <rect x="0" y="0" width="360" height="${YOUTUBE_THUMBNAIL_HEIGHT}" fill="#f3f6fa"/>
    <text x="200" y="360" font-family="sans-serif" font-size="34" fill="#6b7d90"
      text-anchor="middle">PHOTO ZONE</text>
    <rect x="410" y="150" width="800" height="110" rx="55" fill="#ffffff"/>
    <text x="810" y="220" font-family="sans-serif" font-size="46" fill="#123a63"
      text-anchor="middle">HEADLINE ZONE</text>
    <rect x="${YOUTUBE_THUMBNAIL_WIDTH - RESERVED_LOCKUP.width}" y="0"
      width="${RESERVED_LOCKUP.width}" height="${RESERVED_LOCKUP.height}" fill="none"
      stroke="#ff0000" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="${YOUTUBE_THUMBNAIL_HEIGHT - RESERVED_FOOTER_HEIGHT}"
      width="${YOUTUBE_THUMBNAIL_WIDTH}" height="${RESERVED_FOOTER_HEIGHT}" fill="none"
      stroke="#ff0000" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// The chrome must live INSIDE what the prompt reserved. Measured, not eyeballed: stamp
// the chrome on a fully transparent canvas and read back where non-transparent pixels
// actually land.
async function assertZones(): Promise<void> {
  const blank = await sharp({
    create: {
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height: YOUTUBE_THUMBNAIL_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const stamped = await overlayYoutubeChrome(blank);
  const { data, info } = await sharp(stamped)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const footerTop = info.height - RESERVED_FOOTER_HEIGHT;
  const lockupLeft = info.width - RESERVED_LOCKUP.width;
  let strays = 0;
  let lockupPixels = 0;
  let footerPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3] ?? 0;
      if (alpha < 8) continue;
      const inFooter = y >= footerTop;
      const inLockup = y < RESERVED_LOCKUP.height && x >= lockupLeft;
      if (inFooter) footerPixels += 1;
      else if (inLockup) lockupPixels += 1;
      else strays += 1;
    }
  }

  if (strays > 0) {
    throw new Error(
      `${strays} chrome pixel(s) fall OUTSIDE the reserved zones (top-right ${RESERVED_LOCKUP.width}x${RESERVED_LOCKUP.height}, bottom ${RESERVED_FOOTER_HEIGHT}px). ` +
        'Either shrink the overlay in src/youtube-chrome.ts or widen the zones in build-youtube-thumbnail-prompt.ts — and change BOTH.',
    );
  }
  if (lockupPixels === 0) throw new Error('The lockup was not stamped at all.');
  if (footerPixels === 0) throw new Error('The footer was not stamped at all.');
  console.log(
    `zones OK — lockup ${lockupPixels} px inside ${RESERVED_LOCKUP.width}x${RESERVED_LOCKUP.height}, footer ${footerPixels} px inside the bottom ${RESERVED_FOOTER_HEIGHT}px, 0 strays`,
  );
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  let thumbnail: Buffer;
  let outPath: string;
  if (inputPath) {
    const full = resolve(inputPath);
    thumbnail = await readFile(full);
    outPath = full.replace(/\.png$/i, '') + '.chrome-preview.png';
  } else {
    thumbnail = await placeholderThumbnail();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'youtube-chrome-preview.png');
  }

  const png = await overlayYoutubeChrome(thumbnail);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath}`);
  await assertZones();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
