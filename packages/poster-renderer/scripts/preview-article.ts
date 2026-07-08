// Offline preview for the LANDSCAPE article image — render from an existing *.copy.json
// WITHOUT calling the image model. A placeholder photo stands in for the AI scene, so the
// HTML/CSS layout, Devanagari typesetting and the article-header-footer.png frame can be
// iterated for free.
//
//   pnpm --filter @dgipr/poster-renderer poster:preview:article [copy.json] [scene.png]
//
// Defaults to the karjamukti copy. Writes <copy>.preview-article.png next to the input.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CopySchema } from '@dgipr/schemas';
import { generateArticlePoster } from '../src/generate-article-poster.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COPY = resolve(
  here,
  '../../content-engine/data/output/poster-2026-07-03T07-51-35-157Z.copy.json',
);

// A muted field/sky gradient (landscape) so the photo zone reads as a real image while
// iterating. Subject-right is faked with a darker blob on the right.
async function placeholderScene(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fd3f4"/>
      <stop offset="0.55" stop-color="#c7e59c"/>
      <stop offset="1" stop-color="#5a8f39"/>
    </linearGradient></defs>
    <rect width="1536" height="1024" fill="url(#g)"/>
    <ellipse cx="1180" cy="620" rx="230" ry="360" fill="#4a6b2c" fill-opacity="0.55"/>
    <text x="1180" y="520" font-family="sans-serif" font-size="40" fill="#ffffff"
      fill-opacity="0.6" text-anchor="middle">SCENE PLACEHOLDER</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const copyPath = resolve(args[0] ?? DEFAULT_COPY);
  const scenePath = args[1];

  const copy = CopySchema.parse(JSON.parse(await readFile(copyPath, 'utf8')));
  const sceneImage = scenePath
    ? await readFile(resolve(scenePath))
    : await placeholderScene();

  const base = copyPath.replace(/\.copy\.json$/i, '').split(/[\\/]/).pop();
  console.log(`post_type: ${copy.post_type}`);

  const { png } = await generateArticlePoster({ copy, sceneImage });
  const outPath = join(dirname(copyPath), `${base}.preview-article.png`);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
