// Offline preview of the twitter-poster chrome overlay (poster-logo.png top-right +
// poster-footer.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/twitter-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:twitter [poster.png]
//
// With a PNG argument (e.g. a real n8n render) the chrome is stamped onto it and
// written as <input>.chrome-preview.png next to it. Without one, a flat 1280x1600
// stand-in canvas (colour bands + reserved-zone guides) is used and the result goes
// to content-engine/data/output/twitter-chrome-preview.png (gitignored).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { overlayTwitterChrome } from '../src/twitter-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

// Flat portrait stand-in for an n8n render: header band + content card, with faint
// outlines marking the reserved zones the prompt asks the model to keep clear
// (top-right ~220x180, bottom ~130px).
async function placeholderPoster(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1600">
    <rect width="1280" height="1600" fill="#eef4fb"/>
    <rect x="0" y="0" width="1280" height="320" fill="#1c3f94"/>
    <text x="520" y="180" font-family="sans-serif" font-size="52" fill="#ffffff"
      text-anchor="middle">HEADLINE ZONE</text>
    <rect x="120" y="420" width="1040" height="900" rx="24" fill="#ffffff"
      stroke="#c4d3e8" stroke-width="3"/>
    <rect x="1060" y="0" width="220" height="180" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="1470" width="1280" height="130" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  let poster: Buffer;
  let outPath: string;
  if (inputPath) {
    const full = resolve(inputPath);
    poster = await readFile(full);
    outPath = full.replace(/\.png$/i, '') + '.chrome-preview.png';
  } else {
    poster = await placeholderPoster();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'twitter-chrome-preview.png');
  }

  const png = await overlayTwitterChrome(poster);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
