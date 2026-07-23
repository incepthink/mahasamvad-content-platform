// Offline preview of the CMO-poster chrome overlay (cmo-header.png full-canvas leader
// lockup + the cmo-photo-frame.png photo frame + poster-footer.png bottom band + the
// code-composited single circle photograph) WITHOUT any model call — for tuning
// src/cmo-geometry.ts, src/cmo-chrome.ts and the frame generator for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:chrome:cmo [poster.png] [photo.png]
//
// The first PNG argument (e.g. a real n8n render) is the poster; the chrome is stamped onto
// it and written as <input>.chrome-preview.png next to it. That mode is also how the CMO
// master template is realigned: stamp the frame onto the current master and re-upload the
// result on /references, so the image the model edits already shows one clean circle.
//
// The second PNG argument is the photograph placed in the circle; without one a hatched
// stand-in is used. Without any poster argument, a stand-in 1280x1600 canvas is used and the
// result goes to content-engine/data/output/cmo-chrome-preview.png. Since the photograph is
// now composited by code (not painted by the model), the placeholder poster no longer paints
// the circles — it just marks the reserved zones.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { overlayCmoChrome } from '../src/cmo-chrome.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

const WIDTH = 1280;
const HEIGHT = 1600;

// Stand-in for an n8n render: a headline + body area below the leader band, and faint
// outlines marking the reserved zones (top ~19% header band, bottom ~8% footer) the CMO
// prompt asks the model to keep clear. The photo circle zone is left as quiet background —
// exactly what the workflow now asks the model to produce there — because the photograph is
// composited by code afterwards.
async function placeholderPoster(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
    <text x="90" y="620" font-family="sans-serif" font-size="60" fill="#1c3f94"
      font-weight="bold">HEADLINE ZONE</text>
    <rect x="80" y="700" width="1120" height="660" rx="20" fill="#f4f8fd"
      stroke="#c4d3e8" stroke-width="3"/>
    <rect x="2" y="2" width="1276" height="304" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
    <rect x="0" y="1472" width="1280" height="128" fill="none"
      stroke="#ff0000" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="12 8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// A hatched square stand-in for the circle photograph, so the composited circle is clearly
// a placed image and its crop/ring can be judged.
async function placeholderPhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <defs>
      <pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="#6f8a5f"/>
        <path d="M0 20 L20 0" stroke="#2f4a24" stroke-width="8"/>
      </pattern>
    </defs>
    <rect width="800" height="800" fill="url(#p)"/>
    <circle cx="400" cy="400" r="120" fill="#f0c063"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [posterPath, photoPath] = args;

  const photo = photoPath
    ? await readFile(resolve(photoPath))
    : await placeholderPhoto();

  let poster: Buffer;
  let outPath: string;
  if (posterPath) {
    const full = resolve(posterPath);
    poster = await readFile(full);
    outPath = full.replace(/\.png$/i, '') + '.chrome-preview.png';
  } else {
    poster = await placeholderPoster();
    await mkdir(DEFAULT_OUT_DIR, { recursive: true });
    outPath = join(DEFAULT_OUT_DIR, 'cmo-chrome-preview.png');
  }

  const png = await overlayCmoChrome(poster, photo);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
