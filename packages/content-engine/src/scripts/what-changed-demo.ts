// Standalone DGIPR "What Changed?" carousel demo.
//
// Safe review:
//   pnpm --filter @dgipr/content-engine what-changed:demo "कोयना धरण"
//
// Run the archive search + analysis:
//   pnpm --filter @dgipr/content-engine what-changed:demo "कोयना धरण" --execute

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeTopicProgression,
  selectRelevantArticles,
} from '../what-changed/analyze-topic.js';
import { findTopicArticleCandidates } from '../what-changed/find-topic-articles.js';
import { writeWhatChangedCarousel } from '../what-changed/render-carousel.js';
import type { WhatChangedResult } from '../what-changed/types.js';

type Options = Readonly<{
  subject: string;
  execute: boolean;
  outputDir: string;
}>;

function slug(value: string): string {
  const result = value
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return result || 'topic';
}

function parseOptions(args: string[]): Options {
  const knownFlags = new Set(['--execute', '--output']);
  for (const arg of args.filter((value) => value.startsWith('--'))) {
    const name = arg.split('=', 1)[0] ?? arg;
    if (!knownFlags.has(name)) throw new Error(`Unknown option "${arg}".`);
    if (name === '--output' && !arg.includes('=')) {
      throw new Error(
        '--output ला path द्या, उदा. --output=output/what-changed.',
      );
    }
  }

  const positional = args.filter((value) => !value.startsWith('--'));
  if (positional.length !== 1 || !positional[0]?.trim()) {
    throw new Error(
      'Usage: pnpm --filter @dgipr/content-engine what-changed:demo "<मराठी विषय>" [--execute] [--output=<folder>]',
    );
  }

  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const outputArg = args
    .find((value) => value.startsWith('--output='))
    ?.slice('--output='.length);
  return {
    subject: positional[0].trim(),
    execute: args.includes('--execute'),
    outputDir: resolve(
      outputArg ??
        resolve(packageRoot, 'output', 'what-changed', slug(positional[0])),
    ),
  };
}

function printReview(options: Options): void {
  console.log('WHAT CHANGED? — DEMO REVIEW');
  console.log('===========================');
  console.log(
    JSON.stringify(
      {
        willQueryArchive: options.execute,
        willCallOpenAI: options.execute,
        subject: options.subject,
        source: 'ingested mahasamvad_chunks rows with style_category=news only',
        timeRange: 'all stored dates',
        currentArticle: 'newest directly relevant stored article',
        output: {
          language: 'Marathi',
          font: 'Nirmala UI',
          format: '1080x1350 HTML carousel slides',
          directory: options.outputDir,
        },
        rules: [
          'Every factual card carries source article citations.',
          'Changes and unchanged claims require old + newest evidence.',
          'Conflicts are shown, never silently reconciled.',
          'Next steps are included only when explicitly supported.',
        ],
      },
      null,
      2,
    ),
  );
}

function logProgress(message: string): void {
  console.log(message);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  printReview(options);

  if (!options.execute) {
    console.log('');
    console.log(
      'DRY RUN ONLY — संग्रह किंवा OpenAI ला call केलेला नाही. तयार करण्यासाठी --execute जोडा.',
    );
    return;
  }

  console.log('');
  const search = await findTopicArticleCandidates(options.subject, logProgress);
  if (search.candidates.length === 0) {
    throw new Error(
      `"${options.subject}" या विषयासाठी संग्रहात संभाव्य लेख सापडले नाहीत.`,
    );
  }
  const articles = await selectRelevantArticles(
    options.subject,
    search.candidates,
    logProgress,
  );
  if (articles.length === 0) {
    throw new Error(
      `"${options.subject}" या विषयावर थेट संबंधित संग्रहित लेख सापडले नाहीत.`,
    );
  }
  const analysis = await analyzeTopicProgression(
    options.subject,
    articles,
    logProgress,
  );
  const result: WhatChangedResult = {
    subject: options.subject,
    scannedArticleCount: search.scannedArticleCount,
    candidateCount: search.candidates.length,
    articles,
    latestArticleId: articles.at(-1)!.articleId,
    analysis,
  };

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(
    resolve(options.outputDir, 'analysis.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );
  const rendered = await writeWhatChangedCarousel(result, options.outputDir);

  console.log('');
  console.log(`पूर्ण: ${rendered.slideCount.toLocaleString('mr-IN')} स्लाइड्स`);
  console.log(`HTML: ${rendered.indexPath}`);
  console.log(`पुरावा नोंद: ${resolve(options.outputDir, 'analysis.json')}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
