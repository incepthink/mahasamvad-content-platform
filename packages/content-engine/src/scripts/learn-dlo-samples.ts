// One-off: writes the /learn DLO lesson's sample articles through the REAL article engine.
//
// The lesson never shows a result the product did not make. So the article, and the two
// revisions the practice can show (the article-feedback chips «आणखी थोडक्यात लिहा» and
// «भाषा आणखी सोपी करा»), are produced here once — the /dlo draft call exactly as the runner
// makes it, then reviseArticle exactly as the feedback job does — and the output is copied into
// apps/web/lib/learn/dloSamples.ts by hand.
//
// PAID (one draft + two revisions, cents):
//   tsx --env-file=../../.env src/scripts/learn-dlo-samples.ts --file=note.txt --out=samples.json
//   [--reuse=earlier.json]   keep that file's draft and re-run only the two revisions

import { readFile, writeFile } from 'node:fs/promises';
import { generateArticleSimple } from '../generation/generate-article-simple.js';
import { reviseArticle } from '../generation/revise-article.js';

const FEEDBACK = {
  short: 'आणखी थोडक्यात लिहा',
  simple: 'भाषा आणखी सोपी करा',
} as const;

type Draft = Readonly<{ v1: string; promptVersion: string }>;

async function draftFor(note: string, reuse: string | undefined) {
  if (reuse) return JSON.parse(await readFile(reuse, 'utf8')) as Draft;
  const result = await generateArticleSimple(note, {
    category: 'news',
    promptMode: 'dlo',
    onProgress: (phase) => console.log(`[draft] ${phase}`),
  });
  return {
    v1: result.article,
    promptVersion: result.styleReferenceMeta.promptVersion,
  } satisfies Draft;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const file = arg('file');
  const out = arg('out');
  if (!file || !out) throw new Error('--file= and --out= are required.');
  const note = (await readFile(file, 'utf8')).trim();

  const draft = await draftFor(note, arg('reuse'));
  console.log(`\n=== v1 ===\n${draft.v1}\n`);

  const revisions: Record<string, string> = {};
  for (const [key, feedback] of Object.entries(FEEDBACK)) {
    const revised = await reviseArticle(
      note,
      draft.v1,
      feedback,
      'news',
      undefined,
      [],
      [],
      [],
      [],
      [],
      false,
    );
    revisions[key] = revised.article;
    console.log(`\n=== v2-${key} (${feedback}) ===\n${revised.article}\n`);
  }

  await writeFile(
    out,
    JSON.stringify(
      { note, promptVersion: draft.promptVersion, v1: draft.v1, ...revisions },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`wrote ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
