// The new /dlo lane's article call: one model call that reads the officer's documents
// DIRECTLY and writes the article, with no text-extraction stage in front of it.
//
// The old lane spent minutes turning a scan into text — one model call per page — so that
// `generateArticleSimple` could be handed a string. Every one of those calls was a
// transcription the officer then had to proof-read before the article could even start. This
// path deletes the stage: the PDF, the DOCX and the photograph are attached to the article
// call itself as `input_file` parts, and the model reads them while it writes.
//
// WHAT IS DELIBERATELY IDENTICAL to the text lane, and must stay so: the prompt. The
// specification, the officer's request, the approved पदनाम pairs, the name dictionary, the
// length rules and the style references are all built by the SAME
// `buildArticleMessagesForReferenceMode`, so a change to how DGIPR articles are written
// reaches both lanes at once. Only where the facts come from differs. The two deterministic
// guarantees that follow the model call — `applyDesignations` and `ensureArticleHeading` —
// are likewise the same functions in the same order, because they are the pipeline's only
// structural promises and a second lane must not quietly opt out of them.
//
// WHAT IS GIVEN UP, stated plainly because it is the real cost of this design: the officer no
// longer sees the source text before the article is written, so nothing catches a misread
// figure. AGENTS.md records that the OCR path misreads Devanagari numerals (a clean rendered
// page returned ७०० कोटी for ५०० कोटी), and reading the file directly does not make that
// impossible — it removes the screen on which it was caught. The name-confirm step covers
// names; amounts, dates and percentages are checked against the attached files by the officer
// reading the finished article. Anything that strengthens this should strengthen it HERE,
// not by reinstating a page-by-page transcription.

import { applyDesignations } from './apply-designations.js';
import { ensureArticleHeading } from './article-heading.js';
import { fitArticleToLength, parseLengthRequest } from './article-length.js';
import {
  FACT_CHECK_DELIMITER,
  fiveWOneHFromPointers,
  splitContent,
} from './generate-article.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  ARTICLE_MODEL,
  articleReasoningEffort,
} from './openai-chat.js';
import {
  NO_STYLE_REFERENCE,
  selectStyleReference,
  type StyleReference,
} from './select-style-reference.js';
import { SIMPLE_ARTICLE_PROMPT_VERSION } from './simple-article-prompt.js';
import { MINIMAL_ARTICLE_PROMPT_VERSION } from './minimal-article-prompt.js';
import {
  NO_REFERENCE_ARTICLE_PROMPT_VERSION,
  articleStyleReferencesEnabled,
  buildArticleMessagesForReferenceMode,
} from './no-reference-article-prompt.js';
import {
  articlePromptVariant,
  type SimpleGenerateArticleOptions,
  type SimpleGeneratedArticle,
} from './generate-article-simple.js';
import type { SourceFileRef } from '../intake/openai-source-files.js';
import {
  respondWithSources,
  sourceInformationBlock,
} from './responses-with-sources.js';
import {
  DLO_ARTICLE_PROMPT_VERSION,
  buildDloArticleMessages,
} from './dlo-article-prompt.js';

export type SourceArticleOptions = SimpleGenerateArticleOptions &
  Readonly<{
    // The uploaded documents and photographs this article is written from. May be empty: an
    // intake can be recordings and typed notes alone, in which case this behaves exactly like
    // the text lane, on the same prompt, through a different transport.
    files?: readonly SourceFileRef[] | undefined;
  }>;

/**
 * Writes one article from the attached sources.
 *
 * Returns the same `SimpleGeneratedArticle` the text lane returns, so every downstream
 * consumer — the runner's row write, ArticleView, the PDF export, translation — needed no
 * change at all.
 */
export async function generateArticleFromSources(
  note: string,
  options?: SourceArticleOptions,
): Promise<SimpleGeneratedArticle> {
  const onProgress = options?.onProgress ?? (() => {});
  const category = options?.category ?? 'news';
  const files = options?.files ?? [];
  const selectedFacts = options?.includeFacts ?? [];
  const statements = options?.statements ?? [];
  const designations = options?.designations ?? [];
  const dloPrompt = options?.promptMode === 'dlo';

  // References stay behind the same flag as the text lane for ordinary source articles. The
  // /dlo prompt is complete as approved and never carries one. The embedding is taken from
  // whatever text the intake has: a run whose sources are entirely files has nothing to match.
  const referencesEnabled =
    !dloPrompt && articleStyleReferencesEnabled() && note.trim().length > 0;
  let styleReference = NO_STYLE_REFERENCE;
  if (referencesEnabled) {
    onProgress('retrieve');
    styleReference = await selectStyleReference({
      note,
      category,
      officerReference: options?.styleReference,
      heading: options?.heading,
      preferAttribution: statements.length > 0,
    });
  }

  onProgress('draft');
  const variant = articlePromptVariant();
  const messages = dloPrompt
    ? buildDloArticleMessages({
        sourceInformation: note,
        designations,
        heading: options?.heading,
        officerInstructions: options?.instructions,
        attachedSourceFiles: files.length > 0,
      })
    : buildArticleMessagesForReferenceMode(
        {
          category,
          sourceInformation: sourceInformationBlock(note, files),
          styleReferences: styleReference.articles,
          editorialDirection: options?.heading,
          officerInstructions: options?.instructions ?? undefined,
          designations,
          statements,
          includeFacts: selectedFacts,
          excludeFacts: options?.excludeFacts,
          names: options?.names,
          location: options?.location,
          date: options?.date,
        },
        variant,
        referencesEnabled,
      );

  const raw = await respondWithSources({
    label: 'article from sources',
    messages,
    files,
    model: ARTICLE_MODEL,
    maxOutputTokens: ARTICLE_BODY_MAX_TOKENS,
    reasoningEffort: articleReasoningEffort(),
  });

  // Defensive, and for the same reason the text lane is: the specification asks for the
  // article alone, but a draft that emits the traceability delimiter anyway must not have it
  // stored — the feedback path re-stitches article + delimiter + factCheck itself.
  const { article: body } = splitContent(raw.trim());
  if (raw.includes(FACT_CHECK_DELIMITER)) {
    console.warn(
      '[source-article] draft emitted a fact-check delimiter; discarding the appendix half',
    );
  }

  // Ordinary source articles measure a requested length and buy ONE rewrite on a miss. /dlo
  // uses only its approved prompt, so a second rewriting prompt must not silently replace its
  // answer. The rewrite RE-ATTACHES the source files: they are what the article's facts came
  // from, and a rewrite that cannot see them is told, in as many words, that those facts are
  // unsupported (see the `files` argument on fitArticleToLength).
  const fit = dloPrompt
    ? { article: body, warning: null }
    : await fitArticleToLength(
        body,
        options?.instructions?.trim()
          ? `${note}\n\n=== OFFICER REQUEST ===\n${options.instructions.trim()}`
          : note,
        parseLengthRequest(options?.instructions) ??
          parseLengthRequest(options?.heading),
        category,
        files,
      );

  const designationResult = applyDesignations(fit.article, designations, {
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

  const article = ensureArticleHeading(
    designationResult.text,
    options?.heading,
  );
  const fiveWOneH =
    selectedFacts.length > 0 ? fiveWOneHFromPointers(selectedFacts) : null;

  const promptVersion = dloPrompt
    ? DLO_ARTICLE_PROMPT_VERSION
    : referencesEnabled
      ? variant === 'minimal'
        ? MINIMAL_ARTICLE_PROMPT_VERSION
        : SIMPLE_ARTICLE_PROMPT_VERSION
      : `${variant}-${NO_REFERENCE_ARTICLE_PROMPT_VERSION}`;

  console.log(
    `[source-article] ${category} | model=${ARTICLE_MODEL} effort=${articleReasoningEffort()} | ` +
      `files=${files.length} note=${note.length} chars | prompt=${promptVersion} | ` +
      `${article.length} chars`,
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
    lengthWarning: fit.warning,
  };
}

export type { StyleReference };
