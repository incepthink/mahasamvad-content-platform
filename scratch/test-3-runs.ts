import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildDloArticleMessages,
  DLO_ARTICLE_PROMPT_VERSION,
} from '../packages/content-engine/src/generation/dlo-article-prompt.js';
import {
  chatComplete,
  ARTICLE_MODEL,
} from '../packages/content-engine/src/generation/openai-chat.js';
import { splitDloPrompt } from '../packages/content-engine/src/finetune/eval-dlo-distillation.js';

async function main() {
  console.log('=== Running 3 DGIPR Editorial Validation Test Runs ===');
  console.log('Prompt Version:', DLO_ARTICLE_PROMPT_VERSION);
  console.log('Model:', ARTICLE_MODEL);

  const evalPath = resolve(
    'packages/content-engine/data/finetune/distill/eval.jsonl',
  );
  const lines = readFileSync(evalPath, 'utf8').trim().split('\n');

  const testIndices = [0, 1, 2]; // Items 1, 2, and 3
  const results = [];

  for (const idx of testIndices) {
    const rawItem = JSON.parse(lines[idx]);
    const userMessage =
      rawItem.messages.find((m: any) => m.role === 'user')?.content || '';

    // Split the user turn to get the original inputs
    const parsed = splitDloPrompt(userMessage);

    console.log(
      `\n------------------------------------------------------------`,
    );
    console.log(`[TEST RUN ${idx + 1}] Processing item ${idx + 1}...`);
    console.log(
      `Source preview: ${parsed.sourceInformation.slice(0, 150).replace(/\n/g, ' ')}...`,
    );

    const messages = buildDloArticleMessages({
      sourceInformation: parsed.sourceInformation,
      designations: parsed.designations,
      heading: parsed.heading || undefined,
      officerInstructions: parsed.officerInstructions || undefined,
    });

    console.log(
      `Calling ${ARTICLE_MODEL} with updated DGIPR leadership prompt...`,
    );
    const startTime = Date.now();
    const response = await chatComplete({
      messages,
      model: ARTICLE_MODEL,
      maxTokens: 3000,
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Completed in ${duration}s.`);

    results.push({
      itemIndex: idx + 1,
      sourcePreview: parsed.sourceInformation.slice(0, 200),
      generatedArticle: response.content,
    });
  }

  writeFileSync(
    'scratch/test-3-runs-output.json',
    JSON.stringify(results, null, 2),
  );
  console.log(
    '\n=== All 3 Test Runs Complete! Output saved to scratch/test-3-runs-output.json ===\n',
  );
}

main().catch((err) => {
  console.error('Error running test runs:', err);
  process.exit(1);
});
