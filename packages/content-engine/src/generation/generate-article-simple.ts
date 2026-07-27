// The SIMPLIFIED Marathi article generator (ARTICLE_GENERATION_MODE=simple, the default).
//
//   selectStyleReference()  →  1 embedding, and only on the retrieval tier
//   chatComplete()          →  1 call on ARTICLE_MODEL, writing the whole article
//   applyDesignations()     →  0 calls, deterministic
//
// That is the entire pipeline. The full path (generate-article.ts) makes up to fourteen calls,
// several of which re-read and rewrite the finished draft: an editorial brief, a tier audit, a
// bounded coverage-revision loop and a faithfulness repair. Those passes optimise for coverage,
// and two rounds of them reliably flatten an edited article back toward a restatement of the
// note — which is the "mechanical" quality this path exists to remove. The judgement they
// encoded now happens inside one call, which is why that call runs on a higher tier at a
// deliberate reasoning effort (see ARTICLE_MODEL / articleReasoningEffort in openai-chat.ts).
//
// What is NOT dropped, and must not be:
//   - applyDesignations, which is deterministic and is the pipeline's only structural name
//     guarantee, not an AI stage;
//   - every officer-approved input (selected facts, attributed statements, excluded facts,
//     approved designations), all of which reach the prompt;
//   - the note as the sole factual authority, which the runtime specification states directly.
//
// The full pipeline is untouched and one env line away: ARTICLE_GENERATION_MODE=full.

import type { FiveWOneH } from '@dgipr/schemas';
import type { AttributedStatement, SelectedFact } from '@dgipr/schemas';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  applyDesignations,
  type DesignationIssue,
} from './apply-designations.js';
import type { ArticleCategory, DesignationPair } from './category-prompt.js';
import {
  FACT_CHECK_DELIMITER,
  fiveWOneHFromPointers,
  splitContent,
} from './generate-article.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  ARTICLE_MODEL,
  articleReasoningEffort,
  chatComplete,
} from './openai-chat.js';
import {
  selectStyleReference,
  type StyleReference,
} from './select-style-reference.js';
import {
  SIMPLE_ARTICLE_PROMPT_VERSION,
  buildSimpleArticleMessages,
} from './simple-article-prompt.js';

// Only two phases now, and both are existing GenerationStepSchema values, so the progress UI
// needed no schema change: retrieve → draft → done.
export type SimpleArticlePhase = 'retrieve' | 'draft';

export type SimpleGenerateArticleOptions = Readonly<{
  onProgress?: (phase: SimpleArticlePhase) => void;
  category?: ArticleCategory;
  // The officer's editorial angle. Not an independent factual source.
  heading?: string | undefined;
  // The officer's pasted style-reference article (generations.style_reference). Tier 1.
  styleReference?: string | null | undefined;
  // Officer-approved inputs, all threaded into the one prompt.
  excludeFacts?: readonly string[] | undefined;
  includeFacts?: readonly SelectedFact[] | undefined;
  statements?: readonly AttributedStatement[] | undefined;
  designations?: readonly DesignationPair[] | undefined;
  knownDesignations?: readonly string[] | undefined;
  // Used only when they arrive from trusted input; nothing here infers them.
  location?: string | undefined;
  date?: string | undefined;
}>;

// What the run used, persisted to generations.style_reference_meta. Both the calibration signal
// for the retrieval floor and the join key for the future approved-example loop, which needs to
// know which reference tier and which specification produced a given article.
export type StyleReferenceMeta = Readonly<{
  source: StyleReference['source'];
  articleId: number | null;
  title: string | null;
  url: string | null;
  similarity: number | null;
  chars: number;
  mode: 'simple';
  promptVersion: string;
}>;

export type SimpleGeneratedArticle = Readonly<{
  // The article as stored. There is no traceability appendix on this path, so content and
  // article are the same string — the field is kept so callers can treat both results alike.
  content: string;
  article: string;
  // Always null: the appendix was its own full model pass over the finished article, which is
  // exactly the kind of re-analysis this path removes. ArticleView hides the fold when null.
  factCheck: null;
  styleReference: StyleReference;
  styleReferenceMeta: StyleReferenceMeta;
  // The approved pointer inventory reused as a scaffold, or null when there is none. NULL, not
  // an empty scaffold: the detail page gates its card on truthiness, so an all-empty object
  // would render six "टिपणीत नाही" placeholder rows.
  fiveWOneH: FiveWOneH | null;
  designationIssues: readonly DesignationIssue[];
}>;

export async function generateArticleSimple(
  note: string,
  options?: SimpleGenerateArticleOptions,
): Promise<SimpleGeneratedArticle> {
  const onProgress = options?.onProgress ?? (() => {});
  const category = options?.category ?? 'scheme';
  const selectedFacts = options?.includeFacts ?? [];
  const statements = options?.statements ?? [];
  const designations = options?.designations ?? [];

  // Tier 1 officer paste → tier 2 retrieval above the similarity floor → tier 3 none.
  onProgress('retrieve');
  const styleReference = await selectStyleReference({
    note,
    category,
    officerReference: options?.styleReference,
    heading: options?.heading,
    preferAttribution: statements.length > 0,
  });

  onProgress('draft');
  const raw = await chatComplete(
    buildSimpleArticleMessages({
      category,
      sourceInformation: note,
      styleReference: styleReference.text,
      editorialDirection: options?.heading,
      designations,
      statements,
      includeFacts: selectedFacts,
      excludeFacts: options?.excludeFacts,
      location: options?.location,
      date: options?.date,
    }),
    {
      model: ARTICLE_MODEL,
      maxTokens: ARTICLE_BODY_MAX_TOKENS,
      reasoningEffort: articleReasoningEffort(),
    },
  );

  // Defensive: the specification asks for the article alone, but if a draft ever emits the
  // traceability delimiter anyway, keep it out of the stored article — the feedback path
  // re-stitches article + delimiter + factCheck itself and assumes the stored article carries
  // no delimiter of its own.
  const { article: body } = splitContent(raw.trim());
  if (raw.includes(FACT_CHECK_DELIMITER)) {
    console.warn(
      '[simple-article] draft emitted a fact-check delimiter; discarding the appendix half',
    );
  }

  // Deterministic and last, exactly as in the full pipeline: the officer approved "this person
  // is named with this title", and this pass — not the prompt — is the guarantee.
  const designationResult = applyDesignations(body, designations, {
    ...(options?.knownDesignations
      ? { knownDesignations: options.knownDesignations }
      : {}),
  });
  if (designationResult.issues.length > 0) {
    console.warn(
      `[designations] ${designationResult.issues.length} पदनाम लागू करता आले नाही:`,
      designationResult.issues,
    );
  }

  const article = designationResult.text;
  const fiveWOneH =
    selectedFacts.length > 0 ? fiveWOneHFromPointers(selectedFacts) : null;

  console.log(
    `[simple-article] ${category} | model=${ARTICLE_MODEL} effort=${articleReasoningEffort()} | ` +
      `style-ref=${styleReference.source} | ${article.length} chars`,
  );

  return {
    content: article,
    article,
    factCheck: null,
    styleReference,
    styleReferenceMeta: {
      source: styleReference.source,
      articleId: styleReference.articleId,
      title: styleReference.title,
      url: styleReference.url,
      similarity: styleReference.similarity,
      chars: styleReference.chars,
      mode: 'simple',
      promptVersion: SIMPLE_ARTICLE_PROMPT_VERSION,
    },
    fiveWOneH,
    designationIssues: designationResult.issues,
  };
}

// Run directly (PAID — one article on ARTICLE_MODEL plus one embedding):
//   tsx --env-file=../../.env src/generation/generate-article-simple.ts [news|scheme] [--file=note.txt]
// Defaults to data/sample-note.txt, like generate:test. Always prefer --file for a multi-line
// note: npx on Windows truncates a multi-line argv at the first newline.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const category: ArticleCategory = args.includes('news') ? 'news' : 'scheme';
  const fileArg = args.find((arg) => arg.startsWith('--file='))?.slice(7);
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );
  const notePath = fileArg ?? join(dataDir, 'sample-note.txt');

  readFile(notePath, 'utf8')
    .then(async (note) => {
      const started = Date.now();
      const result = await generateArticleSimple(note, {
        category,
        ...(process.env.HEADING?.trim()
          ? { heading: process.env.HEADING.trim() }
          : {}),
        onProgress: (phase) => console.log(`[phase] ${phase}`),
      });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\n=== शैली-संदर्भ (${result.styleReference.source}) ===`);
      console.log(
        result.styleReference.source === 'none'
          ? '(none — generated from the DGIPR rules alone)'
          : `${result.styleReference.title ?? 'officer-supplied'} | similarity=${
              result.styleReference.similarity?.toFixed(3) ?? 'n/a'
            } | ${result.styleReference.chars} chars`,
      );
      console.log('\n=== लेख ===\n');
      console.log(result.article);
      console.log(
        `\n--- ${result.article.trim().split(/\s+/u).length} words | ${seconds}s ---`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
