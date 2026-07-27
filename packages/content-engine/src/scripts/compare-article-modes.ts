// Side-by-side evaluation of the two article pipelines on the SAME note. This is the harness
// the flag decision rests on:
//
//   pnpm --filter @dgipr/content-engine article:compare -- --file=note.txt [news|scheme]
//                                                          [--effort=medium|high] [--simple-only]
//
// PAID — it runs one or both real pipelines. Budget roughly $0.05 for simple mode and ~$0.30
// for full mode per note (the measured baseline is ~16 calls / ~275 s / ~$0.29).
//
// It reports four things per mode: wall-clock, chat calls, cost, and article length — and then
// the number that actually matters, the FAITHFULNESS COUNT.
//
// Simple mode deliberately removes the faithfulness REPAIR pass. The obvious worry is that one
// well-prompted call therefore invents more than the old loop used to strip. So the harness
// re-uses findUnsupportedClaims as a read-only JUDGE over both outputs — the same grader the
// full pipeline uses internally, here scoring rather than rewriting. If simple mode's count is
// not materially worse than full mode's, the removal is safe; if it is, that is the evidence to
// act on, and the fix is the prompt rather than restoring the loop.
//
// Both modes are metered inside their own cost scope, so the printed cost is measured from real
// OpenAI usage rather than estimated.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCostAccumulator,
  runInCostScope,
  totalCostUsd,
  type CostAccumulator,
} from '../cost/cost-meter.js';
import type { ArticleCategory } from '../generation/category-prompt.js';
import { generateArticle } from '../generation/generate-article.js';
import { generateArticleSimple } from '../generation/generate-article-simple.js';
import { findUnsupportedClaims } from '../generation/verify-coverage.js';

type ModeResult = Readonly<{
  label: string;
  article: string;
  seconds: number;
  cost: CostAccumulator;
  detail: string;
}>;

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

async function measure(
  label: string,
  run: () => Promise<{ article: string; detail: string }>,
): Promise<ModeResult> {
  const cost = createCostAccumulator();
  const started = Date.now();
  const { article, detail } = await runInCostScope(cost, run);
  return {
    label,
    article,
    seconds: (Date.now() - started) / 1000,
    cost,
    detail,
  };
}

function report(result: ModeResult, unsupported: readonly string[]): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`${result.label}`);
  console.log('='.repeat(72));
  console.log(`  wall clock      ${result.seconds.toFixed(1)} s`);
  console.log(`  chat calls      ${result.cost.chatCalls}`);
  console.log(
    `  tokens          ${result.cost.inputTokens} in / ${result.cost.outputTokens} out`,
  );
  console.log(`  cost            $${totalCostUsd(result.cost).toFixed(4)}`);
  console.log(
    `  length          ${words(result.article)} words / ${result.article.length} chars`,
  );
  console.log(`  style reference ${result.detail}`);
  console.log(
    `  unsupported     ${unsupported.length} claim(s) flagged by the judge`,
  );
  for (const claim of unsupported) console.log(`                  - ${claim}`);
  console.log(`\n${result.article}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const category: ArticleCategory = args.includes('news') ? 'news' : 'scheme';
  const fileArg = args.find((arg) => arg.startsWith('--file='))?.slice(7);
  const effort = args.find((arg) => arg.startsWith('--effort='))?.slice(9);
  const simpleOnly = args.includes('--simple-only');

  // The reasoning effort under test. Set before the generator reads it, so `--effort=high`
  // compares the level that replaced the removed grading passes without an .env edit.
  if (effort) process.env.OPENAI_ARTICLE_REASONING_EFFORT = effort;

  // --file is not optional in spirit: npx on Windows truncates a multi-line argv at the first
  // newline, so passing a note inline silently compares the two pipelines on its headline.
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );
  const notePath = fileArg ?? join(dataDir, 'sample-note.txt');
  const note = await readFile(notePath, 'utf8');

  console.log(
    `note: ${notePath} (${note.length} chars) | category: ${category} | ` +
      `effort: ${process.env.OPENAI_ARTICLE_REASONING_EFFORT ?? 'medium'}`,
  );

  const simple = await measure(
    'SIMPLE — one style reference, one call',
    async () => {
      const result = await generateArticleSimple(note, { category });
      return {
        article: result.article,
        detail: `${result.styleReference.source}${
          result.styleReference.similarity === null
            ? ''
            : ` (similarity ${result.styleReference.similarity.toFixed(3)})`
        }`,
      };
    },
  );

  const full = simpleOnly
    ? null
    : await measure(
        'FULL — brief, coverage loop, faithfulness repair',
        async () => {
          const result = await generateArticle(note, { category });
          return {
            article: result.article,
            detail: result.reference
              ? `retrieval (similarity ${result.reference.similarity.toFixed(3)})`
              : 'none',
          };
        },
      );

  // The judge runs OUTSIDE both cost scopes so grading never inflates either mode's reported
  // cost — it is evaluation, not part of either pipeline.
  console.log('\nrunning the faithfulness judge over both outputs...');
  const simpleUnsupported = await findUnsupportedClaims(simple.article, note);
  const fullUnsupported = full
    ? await findUnsupportedClaims(full.article, note)
    : [];

  report(simple, simpleUnsupported);
  if (full) report(full, fullUnsupported);

  if (full) {
    const speedup = full.seconds / Math.max(simple.seconds, 0.001);
    const saved = totalCostUsd(full.cost) - totalCostUsd(simple.cost);
    console.log('='.repeat(72));
    console.log('VERDICT');
    console.log('='.repeat(72));
    console.log(
      `  ${speedup.toFixed(1)}x faster | $${saved.toFixed(4)} cheaper per article | ` +
        `${full.cost.chatCalls} → ${simple.cost.chatCalls} chat calls`,
    );
    console.log(
      `  unsupported claims: full ${fullUnsupported.length} → simple ${simpleUnsupported.length}` +
        (simpleUnsupported.length > fullUnsupported.length
          ? '   <-- WORSE: tighten the specification before flipping the flag'
          : ''),
    );
    console.log(
      `  length: full ${words(full.article)} → simple ${words(simple.article)} words`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
