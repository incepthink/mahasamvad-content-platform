// Assemble the category-labeled fine-tuning dataset (plan step 3).
//
// Turns each (synthetic note -> real article) pair into an OpenAI chat-format training
// example: system (category-conditioned guardrails) + user (the note) + assistant (the
// real article). Holds out a balanced eval slice never shown to training, used in step 6
// to A/B the tuned model. Writes:
//   data/finetune/train.jsonl       — OpenAI supervised fine-tuning input
//   data/finetune/eval-pairs.json   — held-out NotePair[] for the eval harness

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NotePair } from './extract-notes.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '../generation/category-prompt.js';

// Held-out articles per category (never trained). ~10 each leaves ~46/46 for training.
const EVAL_PER_CATEGORY = 10;

type ChatExample = {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
};

export function toChatExample(pair: NotePair): ChatExample {
  return {
    messages: [
      { role: 'system', content: buildSystemPrompt(pair.category) },
      { role: 'user', content: buildUserPrompt(pair.note, pair.category) },
      { role: 'assistant', content: pair.article },
    ],
  };
}

// Deterministic train/eval split: within each category, sort by articleId and hold out
// the last EVAL_PER_CATEGORY as eval, so re-runs are reproducible and balanced.
export function splitTrainEval(pairs: NotePair[]): {
  train: NotePair[];
  evalPairs: NotePair[];
} {
  const train: NotePair[] = [];
  const evalPairs: NotePair[] = [];
  for (const category of ['scheme', 'news'] as const) {
    const ofCat = pairs
      .filter((p) => p.category === category)
      .sort((a, b) => a.articleId - b.articleId);
    const cut = Math.max(0, ofCat.length - EVAL_PER_CATEGORY);
    train.push(...ofCat.slice(0, cut));
    evalPairs.push(...ofCat.slice(cut));
  }
  return { train, evalPairs };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data/finetune',
  );

  const run = async (): Promise<void> => {
    const pairs = JSON.parse(
      await readFile(resolve(dataDir, 'pairs.json'), 'utf8'),
    ) as NotePair[];

    // Guard against empty/degenerate pairs sneaking into the training file.
    const usable = pairs.filter(
      (p) => p.note.trim().length > 0 && p.article.trim().length > 0,
    );
    const dropped = pairs.length - usable.length;

    const { train, evalPairs } = splitTrainEval(usable);
    const jsonl = train
      .map((pair) => JSON.stringify(toChatExample(pair)))
      .join('\n');

    await mkdir(dataDir, { recursive: true });
    await writeFile(resolve(dataDir, 'train.jsonl'), `${jsonl}\n`, 'utf8');
    await writeFile(
      resolve(dataDir, 'eval-pairs.json'),
      JSON.stringify(evalPairs, null, 2),
      'utf8',
    );

    const byCat = (list: NotePair[]) =>
      (['scheme', 'news'] as const)
        .map((c) => `${c}=${list.filter((p) => p.category === c).length}`)
        .join(', ');
    console.log(`Usable pairs: ${usable.length} (dropped ${dropped} empty).`);
    console.log(`  train (${train.length}): ${byCat(train)}`);
    console.log(`  eval  (${evalPairs.length}): ${byCat(evalPairs)}`);
    console.log(`Wrote train.jsonl and eval-pairs.json to ${dataDir}`);
  };

  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
