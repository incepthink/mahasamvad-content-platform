// Offline template preview — render a poster from an existing *.copy.json WITHOUT calling
// the image model. A placeholder photo stands in for the AI scene, so the HTML/CSS layout,
// Devanagari typesetting and the header/footer frame can be iterated for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview [copy.json] [scene.png] [variant]
//
// Defaults to the karjamukti copy. With no [variant] it renders all three layouts
// (arch/split/bottom), writing <copy>.preview-<variant>.png next to the input; pass a single
// variant name to render just that one.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CopySchema } from '@dgipr/schemas';
import { generatePoster } from '../src/generate-poster.js';
import { POSTER_VARIANTS, type PosterVariant } from '../src/poster-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COPY = resolve(
  here,
  '../../content-engine/data/output/poster-2026-07-03T07-51-35-157Z.copy.json',
);

// A muted field/sky gradient so the photo zone reads as a real image while iterating.
async function placeholderScene(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fd3f4"/>
      <stop offset="0.55" stop-color="#c7e59c"/>
      <stop offset="1" stop-color="#5a8f39"/>
    </linearGradient></defs>
    <rect width="1536" height="1024" fill="url(#g)"/>
    <text x="768" y="540" font-family="sans-serif" font-size="46" fill="#ffffff"
      fill-opacity="0.55" text-anchor="middle">SCENE PLACEHOLDER</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const isVariant = (value: string): value is PosterVariant =>
  (POSTER_VARIANTS as readonly string[]).includes(value);

async function main(): Promise<void> {
  // A trailing arg naming a variant is pulled out; the rest are [copy.json] [scene.png].
  const args = process.argv.slice(2);
  const variantArg = args.find(isVariant);
  const positional = args.filter((a) => a !== variantArg);

  const copyPath = resolve(positional[0] ?? DEFAULT_COPY);
  const scenePath = positional[1];
  const variants: readonly PosterVariant[] = variantArg
    ? [variantArg]
    : POSTER_VARIANTS;

  const copy = CopySchema.parse(JSON.parse(await readFile(copyPath, 'utf8')));
  const sceneImage = scenePath
    ? await readFile(resolve(scenePath))
    : await placeholderScene();

  const base = copyPath.replace(/\.copy\.json$/i, '').split(/[\\/]/).pop();
  console.log(`post_type: ${copy.post_type}`);
  for (const variant of variants) {
    const { png } = await generatePoster({ copy, sceneImage, variant });
    const outPath = join(dirname(copyPath), `${base}.preview-${variant}.png`);
    await writeFile(outPath, png);
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
