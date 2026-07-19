// Offline preview of the numbered feedback markers WITHOUT any model call — for
// tuning the stroke/badge constants in src/feedback-marker.ts for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:markers [poster.png]
//
// With a PNG argument (e.g. a real render) the markers are stamped onto it and
// written as <input>.markers-preview.png next to it. Without one, two stand-in
// canvases at the real poster sizes (article 1536x1024, twitter 1280x1600) are
// used and the results go to content-engine/data/output/ (gitignored). Sample
// regions cover the cases that matter: mid-canvas box, edge-clamped box, and a
// small click-default box.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  annotateFeedbackRegions,
  type NormalizedRegion,
} from '../src/feedback-marker.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = resolve(here, '../../content-engine/data/output');

const SAMPLE_REGIONS: readonly NormalizedRegion[] = [
  { x: 0.1, y: 0.3, width: 0.28, height: 0.22 }, // mid-canvas drag box
  { x: 0.9, y: 0.0, width: 0.1, height: 0.12 }, // corner box → clamping + badge pull-in
  { x: 0.55, y: 0.62, width: 0.16, height: 0.16 }, // click-default box
];

async function placeholderPoster(width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#bcd9ef"/>
    <rect width="${Math.round(width * 0.42)}" height="${height}" fill="#e8762d"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (inputPath) {
    const full = resolve(inputPath);
    const poster = await readFile(full);
    const outPath = full.replace(/\.png$/i, '') + '.markers-preview.png';
    await writeFile(outPath, await annotateFeedbackRegions(poster, SAMPLE_REGIONS));
    console.log(`Wrote ${outPath}`);
    return;
  }

  await mkdir(DEFAULT_OUT_DIR, { recursive: true });
  for (const [name, width, height] of [
    ['article', 1536, 1024],
    ['twitter', 1280, 1600],
  ] as const) {
    const poster = await placeholderPoster(width, height);
    const outPath = join(DEFAULT_OUT_DIR, `feedback-markers-${name}.png`);
    await writeFile(outPath, await annotateFeedbackRegions(poster, SAMPLE_REGIONS));
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
