// Offline preview of the social-poster chrome overlay (poster-logo-new.png top-right +
// footer-new-poster.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/twitter-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:twitter [poster.png]
//
// With a PNG argument (e.g. a real n8n render) the chrome is stamped onto it and
// written as <input>.chrome-preview.png next to it. Without one, a flat 1280x1504
// stand-in ARTWORK canvas (colour bands + reserved-zone guides) is used and the result
// goes to content-engine/data/output/twitter-chrome-preview.png (gitignored).
//
// On the stand-in it is also a REGRESSION TEST for the thing an eyeball is bad at: the
// finished poster must be exactly 1280x1600 (4:5), or officers get a gap down each side of
// their 1080x1350 Canva frame — the defect this sizing exists to fix — and re-stamping must
// not grow it, or every feedback round adds another strip.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  overlayTwitterChrome,
  SOCIAL_ARTWORK_HEIGHT,
  SOCIAL_POSTER_HEIGHT,
} from '../src/twitter-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');
const WIDTH = 1280;

// Flat portrait stand-in for a social render — the ARTWORK the image model is asked for, not
// the finished poster: header band + content card, with faint outlines marking the top-right
// badge reserve (180x170) and the bottom text cushion (16px, at y=1488).
async function placeholderPoster(): Promise<Buffer> {
  const h = SOCIAL_ARTWORK_HEIGHT;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${h}">
    <rect width="${WIDTH}" height="${h}" fill="#eef4fb"/>
    <rect x="0" y="0" width="${WIDTH}" height="320" fill="#1c3f94"/>
    <text x="520" y="180" font-family="sans-serif" font-size="52" fill="#ffffff"
      text-anchor="middle">HEADLINE ZONE</text>
    <rect x="120" y="420" width="1040" height="900" rx="24" fill="#ffffff"
      stroke="#c4d3e8" stroke-width="3"/>
    <rect x="1100" y="0" width="180" height="170" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="${h - 16}" width="${WIDTH}" height="16" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function size(png: Buffer): Promise<string> {
  const meta = await sharp(png).metadata();
  return `${meta.width}x${meta.height}`;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  let poster: Buffer;
  let outPath: string;
  let checkGeometry = false;
  if (inputPath) {
    const full = resolve(inputPath);
    poster = await readFile(full);
    outPath = full.replace(/\.png$/i, '') + '.chrome-preview.png';
  } else {
    poster = await placeholderPoster();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'twitter-chrome-preview.png');
    checkGeometry = true;
  }

  const png = await overlayTwitterChrome(poster);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath} (${await size(poster)} -> ${await size(png)})`);

  if (!checkGeometry) return;
  const failures: string[] = [];
  const finished = `${WIDTH}x${SOCIAL_POSTER_HEIGHT}`;
  if ((await size(png)) !== finished)
    failures.push(
      `finished poster is ${await size(png)}, not ${finished} — a non-4:5 poster leaves a gap in a 1080x1350 frame`,
    );
  // Idempotence: a feedback round re-stamps a finished poster, and this must not append a
  // second strip. Told apart by aspect, so it is worth proving rather than assuming.
  const restamped = await overlayTwitterChrome(png);
  if ((await size(restamped)) !== finished)
    failures.push(
      `re-stamping grew the poster to ${await size(restamped)} — feedback rounds would stack strips`,
    );
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `OK: artwork ${WIDTH}x${SOCIAL_ARTWORK_HEIGHT} -> finished ${finished} (4:5), and re-stamping is a no-op.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
