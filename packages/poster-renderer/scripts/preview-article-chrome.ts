// Offline preview of the article-poster chrome overlay (article-logo.png top-left +
// poster-footer.png full-width bottom) WITHOUT any model call — for tuning the
// scale/margin constants in src/article-chrome.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome [poster.png]
//
// With a PNG argument (e.g. a real n8n render) the chrome is stamped onto it and
// written as <input>.chrome-preview.png next to it. Without one, a flat 1536x1024
// stand-in canvas (panel blob + reserved-zone guides) is used and the result goes
// to content-engine/data/output/article-chrome-preview.png (gitignored).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { overlayArticleChrome } from '../src/article-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

// Flat landscape stand-in for an n8n render: curved orange headline panel on the
// left, plain sky on the right, with faint outlines marking the reserved zones the
// prompt asks the model to keep clear (top-left ~420x180, bottom ~150px).
async function placeholderPoster(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
    <rect width="1536" height="1024" fill="#bcd9ef"/>
    <path d="M0 0 H640 Q760 512 640 1024 H0 Z" fill="#e8762d"/>
    <text x="320" y="540" font-family="sans-serif" font-size="44" fill="#ffffff"
      text-anchor="middle">HEADLINE PANEL</text>
    <rect x="0" y="0" width="420" height="180" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="874" width="1536" height="150" fill="none"
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
    outPath = join(DEFAULT_OUT_DIR, 'article-chrome-preview.png');
  }

  const png = await overlayArticleChrome(poster);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
