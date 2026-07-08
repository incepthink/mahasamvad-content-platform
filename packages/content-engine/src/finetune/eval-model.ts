// Evaluate a model on the held-out eval pairs, per category (plan step 6).
//
// For each held-out article we regenerate from its synthetic note with the model under
// test (using the SAME category-conditioned prompt training used), then score two things:
//   1. STYLE — an LLM judge rates how closely the output matches real Mahasamvad <category>
//      voice/structure/formatting/length vs. the true article (1–5).
//   2. FAITHFULNESS — the existing findUnsupportedClaims pass counts invented hard facts.
//
// Run the SAME command twice with different model ids to A/B the baseline vs the tuned
// model. Run: `tsx --env-file=../../.env src/finetune/eval-model.ts <model>`

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chatComplete } from '../generation/openai-chat.js';
import { findUnsupportedClaims } from '../generation/verify-coverage.js';
import type { FinetuneCategory } from './build-corpus.js';
import type { NotePair } from './extract-notes.js';
import {
  CATEGORY_LABEL,
  buildSystemPrompt,
  buildUserPrompt,
} from '../generation/category-prompt.js';

// LLM-judge: score 1–5 how well `candidate` matches Mahasamvad <category> style, using the
// real article as the reference. Judged on structure/tone/formatting/length, NOT facts.
async function gradeStyle(
  category: FinetuneCategory,
  reference: string,
  candidate: string,
): Promise<number> {
  const system = [
    `तुम्ही "${CATEGORY_LABEL[category]}" शैलीचे कठोर परीक्षक आहात. खाली एक खरा महासंवाद`,
    'लेख (संदर्भ) आणि एक तयार केलेला लेख (उमेदवार) आहे. उमेदवार लेख महासंवादच्या याच',
    'श्रेणीच्या शैलीशी — रचना, सूर, सादरीकरण (साधे परिच्छेद, शीर्षक/dateline/byline पद्धत)',
    'व लांबी — किती जुळतो ते १ ते ५ या स्केलवर ठरवा (५ = हुबेहूब संपादकीय शैली).',
    'फक्त तथ्यांची पर्वा करू नका; फक्त शैली तपासा. उत्तरात फक्त एक अंक (१-५) लिहा.',
  ].join('\n');
  const user = [
    '## संदर्भ (खरा लेख):',
    reference,
    '',
    '## उमेदवार (तयार केलेला लेख):',
    candidate,
    '',
    '## गुण (फक्त १-५ पैकी एक अंक):',
  ].join('\n');
  const reply = await chatComplete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0 },
  );
  const match = reply.match(/[1-5१-५]/);
  const map: Record<string, number> = {
    '१': 1, '२': 2, '३': 3, '४': 4, '५': 5,
  };
  const ch = match?.[0] ?? '3';
  return map[ch] ?? (Number(ch) || 3);
}

type Row = {
  category: FinetuneCategory;
  articleId: number;
  style: number;
  inventedFacts: number;
};

async function evaluate(model: string, pairs: NotePair[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [i, pair] of pairs.entries()) {
    const generated = await chatComplete(
      [
        { role: 'system', content: buildSystemPrompt(pair.category) },
        { role: 'user', content: buildUserPrompt(pair.note, pair.category) },
      ],
      { temperature: 0.4, model },
    );
    const [style, unsupported] = await Promise.all([
      gradeStyle(pair.category, pair.article, generated),
      findUnsupportedClaims(generated, pair.note),
    ]);
    rows.push({
      category: pair.category,
      articleId: pair.articleId,
      style,
      inventedFacts: unsupported.length,
    });
    console.log(
      `  [${i + 1}/${pairs.length}] ${pair.category} #${pair.articleId} — style ${style}/5, invented ${unsupported.length}`,
    );
  }
  return rows;
}

function summarize(rows: Row[]): void {
  for (const category of ['scheme', 'news'] as const) {
    const ofCat = rows.filter((r) => r.category === category);
    if (ofCat.length === 0) continue;
    const avg = (f: (r: Row) => number) =>
      (ofCat.reduce((s, r) => s + f(r), 0) / ofCat.length).toFixed(2);
    console.log(
      `  ${category}: avg style ${avg((r) => r.style)}/5, avg invented facts ${avg((r) => r.inventedFacts)} (n=${ofCat.length})`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const model = process.argv[2] ?? 'gpt-4o';
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data/finetune',
  );

  const run = async (): Promise<void> => {
    const pairs = JSON.parse(
      await readFile(resolve(dataDir, 'eval-pairs.json'), 'utf8'),
    ) as NotePair[];
    console.log(`Evaluating model "${model}" on ${pairs.length} held-out pairs…`);
    const rows = await evaluate(model, pairs);
    console.log(`\n=== Summary for ${model} ===`);
    summarize(rows);
    const outPath = resolve(dataDir, `eval-${model.replace(/[^\w.-]/g, '_')}.json`);
    await mkdir(dataDir, { recursive: true });
    await writeFile(outPath, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`\nSaved per-article scores to ${outPath}`);
  };

  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
