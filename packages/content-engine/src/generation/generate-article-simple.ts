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
//
// WHICH SPECIFICATION writes the article is a second, independent env line,
// ARTICLE_PROMPT_VARIANT (see articlePromptVariant below):
//
//   standard (default) — simple-article-prompt.ts, the full DGIPR specification.
//   minimal            — minimal-article-prompt.ts: five sentences, no structure guidance. The
//                        exemplars are the specification.
//
// Since simple-v4 the two have converged in substance: `standard` also states no editorial
// rules, only "follow the reference's style and structure, take facts from the supplied
// sections". BOTH now receive the verified name dictionary as data (`names`). What still
// differs is packaging — `standard` keeps the labelled officer-approved blocks
// (<DESIGNATIONS>, <REQUIRED_FACTS>, <ATTRIBUTED_STATEMENTS>) and their Marathi task rules,
// `minimal` renders the same information as plain lists.
//
// NEITHER states a word target: since simple-v3 the standard specification dropped its count and
// range too. And since simple-v5 / minimal-v2 both say the same thing about length in the same
// terms — take style and structure from the exemplars but NOT their length, be as detailed as the
// source supports, longer only when the extra length explains something. That parity is
// deliberate: a difference in length policy would swamp the packaging difference the two
// variants exist to measure. There is no length knob; styleReferenceMaxChars() in
// select-style-reference.ts still bounds an EXEMPLAR (as a genre filter), not the output.
//
// Everything outside the prompt is identical between the two: the same reference selection, the
// same model, the same deterministic applyDesignations pass. That is what makes them comparable.

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
  chatCompleteStream,
} from './openai-chat.js';
import {
  selectStyleReference,
  type StyleReference,
} from './select-style-reference.js';
import {
  SIMPLE_ARTICLE_PROMPT_VERSION,
  buildSimpleArticleMessages,
} from './simple-article-prompt.js';
import {
  MINIMAL_ARTICLE_PROMPT_VERSION,
  buildMinimalArticleMessages,
  type ArticleNameEntry,
} from './minimal-article-prompt.js';

// Which editorial specification writes the article. 'standard' (the unset default) is the full
// DGIPR specification in simple-article-prompt.ts. 'minimal' is the experiment: five sentences,
// no word target, no structure guidance — the style comes from the exemplars alone. Read here
// rather than in the runner because this is a prompt detail, not a pipeline choice, and the
// paid CLI harness below must honour it too.
export type ArticlePromptVariant = 'standard' | 'minimal';

export function articlePromptVariant(): ArticlePromptVariant {
  return process.env.ARTICLE_PROMPT_VARIANT?.trim().toLowerCase() === 'minimal'
    ? 'minimal'
    : 'standard';
}

// Only two phases now, and both are existing GenerationStepSchema values, so the progress UI
// needed no schema change: retrieve → draft → done.
export type SimpleArticlePhase = 'retrieve' | 'draft';

export type SimpleGenerateArticleOptions = Readonly<{
  onProgress?: (phase: SimpleArticlePhase) => void;
  // Show the article being written instead of a spinner. Supplying this switches the one
  // draft call to the streaming transport, which hands over each piece of the answer as it
  // arrives; omitting it leaves the call byte-for-byte as it was.
  //
  // What arrives here is the RAW draft, before splitContent and before applyDesignations —
  // neither of which can run on half an article. So this is display only: the returned
  // `article` remains the authoritative text, and a consumer must replace what it showed
  // with it rather than keep the concatenated deltas. In practice the two differ only where
  // a designation was inserted, which is exactly the difference that matters.
  onDelta?: ((chunk: string) => void) | undefined;
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
  // Verified glossary rows whose Marathi form occurs in the note, put in front of the model as
  // a spelling authority. Read by BOTH prompt variants since simple-v4. The caller fetches them
  // (findGlossaryTermsInText); content-engine does not depend on @dgipr/database.
  names?: readonly ArticleNameEntry[] | undefined;
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
  // How many complete exemplars the prompt actually received. The calibration signal for
  // ARTICLE_STYLE_REFERENCE_COUNT — without it a 1-vs-3 A/B is unattributable after the fact.
  articleCount: number;
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
  const variant = articlePromptVariant();
  const promptInputs = {
    category,
    sourceInformation: note,
    // Every accepted exemplar, each WITH its headline — the pattern the specification asks
    // the model to learn lives in the headline, and for a long time only the bodies were sent.
    styleReferences: styleReference.articles,
    editorialDirection: options?.heading,
    designations,
    statements,
    includeFacts: selectedFacts,
    excludeFacts: options?.excludeFacts,
    // The verified dictionary. Read by BOTH variants since simple-v4 — the standard
    // specification no longer states name rules either, so it hands over the spellings
    // themselves exactly as the minimal one does.
    names: options?.names,
    location: options?.location,
    date: options?.date,
  } as const;

  const messages =
    variant === 'minimal'
      ? buildMinimalArticleMessages(promptInputs)
      : buildSimpleArticleMessages(promptInputs);
  const callOptions = {
    model: ARTICLE_MODEL,
    maxTokens: ARTICLE_BODY_MAX_TOKENS,
    reasoningEffort: articleReasoningEffort(),
  } as const;

  const onDelta = options?.onDelta;
  const raw = onDelta
    ? await chatCompleteStream(messages, { ...callOptions, onDelta })
    : await chatComplete(messages, callOptions);

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

  // Which specification produced this article. Persisted below, so a good or bad output is
  // attributable to the prompt rather than to a memory of which env line was set that day.
  const promptVersion =
    variant === 'minimal'
      ? MINIMAL_ARTICLE_PROMPT_VERSION
      : SIMPLE_ARTICLE_PROMPT_VERSION;

  console.log(
    `[simple-article] ${category} | model=${ARTICLE_MODEL} effort=${articleReasoningEffort()} | ` +
      `style-ref=${styleReference.source}x${styleReference.articles.length} | ` +
      `prompt=${promptVersion}${
        variant === 'minimal' ? ` names=${(options?.names ?? []).length}` : ''
      } | ${article.length} chars | ` +
      `${article.trim().split(/\s+/u).length} words`,
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
      promptVersion,
      articleCount: styleReference.articles.length,
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
      console.log(
        `\n=== variant: ${articlePromptVariant()} (${result.styleReferenceMeta.promptVersion}) ===`,
      );
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
