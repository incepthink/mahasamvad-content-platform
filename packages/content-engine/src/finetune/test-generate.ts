// Quick end-to-end check of the category-aware generation pipeline (plan step 7).
// Runs the FULL generateArticle path (draft + coverage loop + faithfulness pass) for one
// or both categories on the same note, so we can eyeball that the two voices are distinct,
// plain-paragraph, and faithful. News needs no DB; scheme retrieves a reference (needs
// Supabase env). Run: `tsx --env-file=../../.env src/finetune/test-generate.ts [news|scheme]`

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ArticleCategory } from '../generation/category-prompt.js';
import { generateArticle } from '../generation/generate-article.js';

async function main(): Promise<void> {
  const arg = process.argv[2] as ArticleCategory | undefined;
  const categories: ArticleCategory[] = arg ? [arg] : ['news', 'scheme'];

  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');
  const note = await readFile(
    resolve(dataDir, 'finetune/spike/test-note.txt'),
    'utf8',
  );
  const outDir = resolve(dataDir, 'finetune/generated');
  await mkdir(outDir, { recursive: true });

  for (const category of categories) {
    console.log(`\n\n######## ${category.toUpperCase()} ########`);
    const result = await generateArticle(note, {
      category,
      onProgress: (phase) => console.log(`  [${phase}]`),
    });
    console.log(`\n=== ${category} article ===\n`);
    console.log(result.article);
    await writeFile(resolve(outDir, `${category}.md`), result.article, 'utf8');
  }
  console.log(`\n\nSaved to ${outDir}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
