// Offline preview of the YouTube-thumbnail chrome overlay (the government lockup
// top-right + yt-footer.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/youtube-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:youtube [thumbnail.png]
//
// With a PNG argument (e.g. a real render) the chrome is stamped onto it and written as
// <input>.chrome-preview.png next to it. Without one, a flat 1280x656 ARTWORK stand-in canvas
// (colour bands + the reserved badge corner) is used and the result goes to
// content-engine/data/output/youtube-chrome-preview.png (gitignored).
//
// It ASSERTS three things rather than asking you to look, and the second and third are the
// regression tests for the reported bug — a thumbnail shipping with its own information under
// the department strip:
//
//   1. the lockup fits inside the top-right 130x130 the prompt reserves (that corner IS still a
//      destructive overlay, deliberately — see the header of src/youtube-chrome.ts);
//   2. fresh 1280x656 artwork comes back as a finished 1280x720, i.e. the band was JOINED ON
//      below rather than pasted over, and NOT ONE ROW of the artwork is covered by it;
//   3. re-stamping that finished thumbnail leaves it 1280x720 — a feedback round must not grow
//      it by another strip every time.
//
// A silent drift between the prompt's numbers and these is exactly how a caption ends up
// behind a footer band (the 720p caption bug).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  overlayYoutubeChrome,
  YOUTUBE_ARTWORK_HEIGHT,
  YOUTUBE_THUMBNAIL_HEIGHT,
  YOUTUBE_THUMBNAIL_WIDTH,
} from '../src/youtube-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

// The reserved badge corner the prompt declares. Keep in sync with
// build-youtube-thumbnail-prompt.ts and src/youtube-chrome.ts. There is deliberately no
// reserved FOOTER height any more: the band is joined onto a strip below the artwork, so the
// artwork has nothing to keep clear for it.
const RESERVED_LOCKUP = { width: 130, height: 130 };

// Flat landscape stand-in for a thumbnail render: the 1280x656 ARTWORK canvas the image model
// is actually asked for, with a faint outline marking the reserved badge corner and a band of
// design running right off the bottom edge — which is what the prompt now asks for, and what
// the joined strip has to continue convincingly.
async function placeholderArtwork(): Promise<Buffer> {
  const H = YOUTUBE_ARTWORK_HEIGHT;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${YOUTUBE_THUMBNAIL_WIDTH}" height="${H}">
    <rect width="${YOUTUBE_THUMBNAIL_WIDTH}" height="${H}" fill="#d97a12"/>
    <rect x="0" y="0" width="360" height="${H}" fill="#f3f6fa"/>
    <text x="200" y="330" font-family="sans-serif" font-size="34" fill="#6b7d90"
      text-anchor="middle">PHOTO ZONE</text>
    <rect x="410" y="150" width="800" height="110" rx="55" fill="#ffffff"/>
    <text x="810" y="220" font-family="sans-serif" font-size="46" fill="#123a63"
      text-anchor="middle">HEADLINE ZONE</text>
    <text x="810" y="${H - 24}" font-family="sans-serif" font-size="30" fill="#ffffff"
      text-anchor="middle">LAST LINE OF CONTENT</text>
    <rect x="${YOUTUBE_THUMBNAIL_WIDTH - RESERVED_LOCKUP.width}" y="0"
      width="${RESERVED_LOCKUP.width}" height="${RESERVED_LOCKUP.height}" fill="none"
      stroke="#ff0000" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function dimensions(png: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height)
    throw new Error('Could not read dimensions.');
  return { w: meta.width, h: meta.height };
}

// The badge must live INSIDE what the prompt reserved, and NOTHING may land on the artwork.
// Measured, not eyeballed.
//
// The probe is a flat magenta ARTWORK canvas rather than a transparent one: the strip is filled
// from the artwork's own bottom edge, so a transparent input would come back opaque and every
// pixel would read as chrome. Against a flat colour the test is exact instead — the strip is
// magenta plus the band, and any pixel in the artwork rows that is no longer magenta is
// something the overlay put there.
const PROBE = { r: 255, g: 0, b: 255 };

async function assertZones(): Promise<void> {
  const flat = await sharp({
    create: {
      width: YOUTUBE_THUMBNAIL_WIDTH,
      height: YOUTUBE_ARTWORK_HEIGHT,
      channels: 4,
      background: { ...PROBE, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const stamped = await overlayYoutubeChrome(flat);
  const { data, info } = await sharp(stamped)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    info.width !== YOUTUBE_THUMBNAIL_WIDTH ||
    info.height !== YOUTUBE_THUMBNAIL_HEIGHT
  ) {
    throw new Error(
      `${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_ARTWORK_HEIGHT} artwork came back ` +
        `${info.width}x${info.height}; it must be joined up to exactly ` +
        `${YOUTUBE_THUMBNAIL_WIDTH}x${YOUTUBE_THUMBNAIL_HEIGHT}.`,
    );
  }

  const lockupLeft = info.width - RESERVED_LOCKUP.width;
  let strays = 0;
  let lockupPixels = 0;
  let footerPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const painted =
        Math.abs((data[i] ?? 0) - PROBE.r) > 8 ||
        Math.abs((data[i + 1] ?? 0) - PROBE.g) > 8 ||
        Math.abs((data[i + 2] ?? 0) - PROBE.b) > 8;
      if (!painted) continue;
      // Everything at or below the artwork's last row is on the JOINED STRIP — canvas the
      // model never painted, which is the whole point of the change.
      if (y >= YOUTUBE_ARTWORK_HEIGHT) footerPixels += 1;
      else if (y < RESERVED_LOCKUP.height && x >= lockupLeft) lockupPixels += 1;
      else strays += 1;
    }
  }

  if (strays > 0) {
    throw new Error(
      `${strays} chrome pixel(s) land ON THE ARTWORK, outside the top-right ` +
        `${RESERVED_LOCKUP.width}x${RESERVED_LOCKUP.height} badge corner and outside the joined strip. ` +
        'Either shrink the overlay in src/youtube-chrome.ts or widen the zones in build-youtube-thumbnail-prompt.ts — and change BOTH.',
    );
  }
  if (lockupPixels === 0) throw new Error('The lockup was not stamped at all.');
  if (footerPixels === 0) throw new Error('The footer was not stamped at all.');
  console.log(
    `zones OK — lockup ${lockupPixels} px inside ${RESERVED_LOCKUP.width}x${RESERVED_LOCKUP.height}, ` +
      `footer ${footerPixels} px on the joined strip, 0 px on the artwork`,
  );
}

// A feedback round re-stamps an already-finished thumbnail. It must NOT grow by another strip,
// or a few rounds of officer feedback would turn a 16:9 thumbnail into a tall image YouTube
// crops. overlayYoutubeChrome decides by aspect; this is what proves it.
async function assertIdempotent(): Promise<void> {
  const finished = await overlayYoutubeChrome(await placeholderArtwork());
  const once = await dimensions(finished);
  const twice = await dimensions(await overlayYoutubeChrome(finished));
  if (
    once.w !== YOUTUBE_THUMBNAIL_WIDTH ||
    once.h !== YOUTUBE_THUMBNAIL_HEIGHT ||
    twice.w !== once.w ||
    twice.h !== once.h
  ) {
    throw new Error(
      `re-stamping a finished thumbnail changed it: ${once.w}x${once.h} -> ${twice.w}x${twice.h}. ` +
        'A feedback round must re-stamp the band in place, not join a second strip.',
    );
  }
  console.log(
    `idempotent OK — ${once.w}x${once.h} after one stamp and after two`,
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
    thumbnail = await placeholderArtwork();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'youtube-chrome-preview.png');
  }

  const png = await overlayYoutubeChrome(thumbnail);
  await writeFile(outPath, png);
  const out = await dimensions(png);
  console.log(`Wrote ${outPath} (${out.w}x${out.h})`);
  await assertZones();
  await assertIdempotent();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
