// Which model writes the article, and the one place that decides.
//
// The simplified generator makes exactly ONE call to write a whole publication-ready
// Marathi article (generate-article-simple.ts), so the model behind that call IS the
// pipeline's authoring stage. This is the seam for swapping it: neutral messages in,
// dispatched on one env var, read in one place so a deployment cannot half-switch. The
// video path's clip-provider.ts and frame-provider.ts are the precedent, and the reasoning
// is theirs — the two providers differ in who writes, not in what the caller must supply.
//
// TEXT ONLY, and only the DRAFT. Everything else on the article path stays on OpenAI, and
// stays there deliberately:
//
//   * the length-fit rewrite (article-length.ts), which never runs on /dlo's prompt anyway;
//   * article FEEDBACK (revise-article.ts), the officer-in-the-loop path;
//   * translation, poster copy, pointers, designations and every checker.
//
// So a Qwen deployment is a Qwen DRAFT inside the existing pipeline, which is what makes
// this measurable against the OpenAI draft rather than a fork of the product. Widening it
// is a later, separate decision.
//
// generateArticleFromSources (the new-/dlo lane, which hands the model uploaded files
// through the OpenAI Responses API) is NOT routed here and cannot be: this pod serves a
// text model with no file input and no File Search equivalent. Such a run stays on OpenAI
// and the runner says so in the log rather than silently writing from the note alone.
//
// Rollback is deleting ARTICLE_PROVIDER from the environment.

import { pathToFileURL } from 'node:url';

import {
  streamQwenCompletion,
  qwenModel,
  isQwenConfigured,
} from '../chat/qwen-chat.js';
import { QwenChatError } from '../chat/qwen-errors.js';
import {
  ARTICLE_MODEL,
  chatComplete,
  chatCompleteStream,
  type ChatMessage,
  type ReasoningEffort,
} from './openai-chat.js';

export type ArticleProvider = 'openai' | 'qwen';

const ARTICLE_PROVIDERS: readonly ArticleProvider[] = ['openai', 'qwen'];

/**
 * Which provider writes the draft. Default 'openai' — the deployed behaviour, unchanged.
 *
 * Throws on an unrecognised value rather than falling back, the clip-provider rule: a typo
 * in a deployment's .env must not silently keep writing on the model the operator believed
 * they had just switched away from.
 */
export function articleProvider(): ArticleProvider {
  const raw = process.env.ARTICLE_PROVIDER?.trim().toLowerCase();
  if (!raw) return 'openai';
  if (raw === 'openai' || raw === 'qwen') return raw;
  throw new Error(
    'Unknown ARTICLE_PROVIDER "' +
      raw +
      '". Supported: ' +
      ARTICLE_PROVIDERS.join(', ') +
      '.',
  );
}

/** The model id the current provider will actually use. For the log line, and for /dlo. */
export function articleProviderModel(): string {
  return articleProvider() === 'qwen' ? qwenModel() : ARTICLE_MODEL;
}

export type ArticleDraftOptions = Readonly<{
  // Room for the ANSWER, as everywhere else in this package.
  maxTokens: number;
  // OpenAI only. Qwen article drafts explicitly disable thinking through the vLLM template.
  reasoningEffort: ReasoningEffort;
  // Publish the draft as it is written. Both providers stream, so the officer watches the
  // article appear whichever one is answering.
  onDelta?: ((chunk: string) => void) | undefined;
}>;

/**
 * Write the article draft on whichever provider this deployment is configured for.
 *
 * Returns the assistant's complete text in both cases, so the deterministic passes that
 * follow — the length fit, applyDesignations, ensureArticleHeading — are handed the same
 * thing they were handed before and needed no change.
 */
export async function writeArticleDraft(
  messages: readonly ChatMessage[],
  options: ArticleDraftOptions,
): Promise<string> {
  if (articleProvider() === 'qwen') {
    // Certain BEFORE the request, and the one failure on this path that is: an operator who
    // set ARTICLE_PROVIDER but not QWEN_BASE_URL gets the typed 'notConfigured' sentence
    // naming their next move, rather than a generation that fails minutes later against a
    // URL built from an empty string.
    if (!isQwenConfigured()) {
      throw new QwenChatError(
        'notConfigured',
        'ARTICLE_PROVIDER=qwen, but QWEN_BASE_URL is not set. Point it at the ' +
          "OpenAI-compatible base of the Qwen server, ending in '/v1', or unset " +
          'ARTICLE_PROVIDER to write articles on OpenAI.',
      );
    }
    const reply = await streamQwenCompletion({
      messages,
      answerTokens: options.maxTokens,
      enableThinking: false,
      ...(options.onDelta ? { onDelta: options.onDelta } : {}),
      label: 'qwen article',
    });
    return reply.text;
  }

  const callOptions = {
    model: ARTICLE_MODEL,
    maxTokens: options.maxTokens,
    reasoningEffort: options.reasoningEffort,
  } as const;
  return options.onDelta
    ? chatCompleteStream(messages, {
        ...callOptions,
        onDelta: options.onDelta,
      })
    : chatComplete(messages, callOptions);
}

// Free offline check of the dispatch itself — no network, no key, no spend:
//
//   tsx src/generation/article-provider.ts
//
// Which model answers is decided by an env var read in one place, and every way that can be
// wrong is silent. A typo would keep writing on the old model while the operator believed
// they had switched; a Qwen deployment with no base URL would fail minutes into a paid job
// instead of before it; and a missed guard would send an article's system prompt through the
// /chat assistant brief.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };

  const savedProvider = process.env.ARTICLE_PROVIDER;
  const savedBaseUrl = process.env.QWEN_BASE_URL;

  delete process.env.ARTICLE_PROVIDER;
  check('unset defaults to openai', articleProvider() === 'openai');
  check(
    'the default reports the OpenAI article model',
    articleProviderModel() === ARTICLE_MODEL,
  );

  process.env.ARTICLE_PROVIDER = '  QWEN  ';
  check('trimmed and lowercased', articleProvider() === 'qwen');

  process.env.ARTICLE_PROVIDER = 'qwen';
  process.env.QWEN_MODEL = 'Qwen/Test-Model';
  check(
    'qwen reports the pod model, not the OpenAI one',
    articleProviderModel() === 'Qwen/Test-Model',
  );

  process.env.ARTICLE_PROVIDER = 'qwn';
  let typoMessage = '';
  try {
    articleProvider();
  } catch (error) {
    typoMessage = String((error as Error).message ?? error);
  }
  check('a typo throws rather than silently using openai', typoMessage !== '');
  check(
    'and it lists the real options',
    typoMessage.includes('Supported: openai, qwen'),
  );

  // The one failure on this path that is certain before any request, and the one an
  // operator meets first: ARTICLE_PROVIDER set, QWEN_BASE_URL forgotten.
  process.env.ARTICLE_PROVIDER = 'qwen';
  delete process.env.QWEN_BASE_URL;
  let unconfigured: unknown;
  await writeArticleDraft([{ role: 'user', content: 'x' }], {
    maxTokens: 128,
    reasoningEffort: 'low',
  }).catch((error: unknown) => {
    unconfigured = error;
  });
  check(
    'an unconfigured pod fails BEFORE any request',
    unconfigured instanceof QwenChatError,
  );
  check(
    'as the typed notConfigured kind',
    unconfigured instanceof QwenChatError &&
      unconfigured.kind === 'notConfigured',
  );
  check(
    'carrying a Marathi sentence the officer can be shown',
    unconfigured instanceof QwenChatError &&
      /[\u0900-\u097F]/u.test(unconfigured.userMessage),
  );
  check(
    'and an English diagnosis naming the missing variable',
    unconfigured instanceof QwenChatError &&
      unconfigured.message.includes('QWEN_BASE_URL'),
  );

  if (savedProvider === undefined) delete process.env.ARTICLE_PROVIDER;
  else process.env.ARTICLE_PROVIDER = savedProvider;
  if (savedBaseUrl === undefined) delete process.env.QWEN_BASE_URL;
  else process.env.QWEN_BASE_URL = savedBaseUrl;

  console.log(
    failures.length === 0
      ? '\nAll article-provider checks passed.'
      : `\n${failures.length} check(s) FAILED.`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
