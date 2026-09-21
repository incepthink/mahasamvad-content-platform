// Which model writes the article, and the one place that decides.
//
// The simplified generator makes exactly ONE call to write a whole publication-ready
// Marathi article (generate-article-simple.ts), so the model behind that call IS the
// pipeline's authoring stage. This is the seam for swapping it: neutral messages in,
// dispatched on one env var, read in one place so a deployment cannot half-switch. The
// video path's clip-provider.ts and frame-provider.ts are the precedent, and the reasoning
// is theirs — the two providers differ in who writes, not in what the caller must supply.
//
// ONLY THE DRAFT. Everything else on the article path stays on OpenAI, and stays there
// deliberately:
//
//   * the length-fit rewrite (article-length.ts), which never runs on /dlo's prompt anyway;
//   * article FEEDBACK (revise-article.ts), the officer-in-the-loop path;
//   * translation, poster copy, pointers, designations and every checker.
//
// So a Qwen deployment is a Qwen DRAFT inside the existing pipeline, which is what makes
// this measurable against the OpenAI draft rather than a fork of the product. Widening it
// is a later, separate decision.
//
// WHETHER A PROVIDER CAN READ THE OFFICER'S UPLOADS is the one capability that splits the
// three, and articleProviderReadsSources is where that is answered:
//
//   * openai — reads a PDF through its own platform conversion, as an `input_file` part.
//   * gemma  — a VISION model, so it reads the pages as images; a PDF is rasterised to
//              overlapping strips first (intake/pdf-raster.ts). No OCR stage either way.
//   * qwen   — serves a TEXT model with no file input and no File Search equivalent, so a
//              run carrying files stays on OpenAI and the runner says so in the log rather
//              than silently writing from the note alone.
//
// So `qwen` is a DRAFT swap inside the existing pipeline, while `gemma` also replaces the
// transport the /dlo file lane rests on. generateArticleFromSources branches on the same
// function; see gemma-sources.ts, the twin of responses-with-sources.ts.
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
  GemmaNotConfiguredError,
  gemmaModelFor,
  isGemmaConfigured,
  respondWithSourcesViaGemma,
  type GemmaLane,
} from './gemma-sources.js';
import {
  ARTICLE_MODEL,
  chatComplete,
  chatCompleteStream,
  type ChatMessage,
  type ReasoningEffort,
} from './openai-chat.js';

export type ArticleProvider = 'openai' | 'qwen' | 'gemma';

const ARTICLE_PROVIDERS: readonly ArticleProvider[] = [
  'openai',
  'qwen',
  'gemma',
];

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
  if (raw === 'openai' || raw === 'qwen' || raw === 'gemma') return raw;
  throw new Error(
    'Unknown ARTICLE_PROVIDER "' +
      raw +
      '". Supported: ' +
      ARTICLE_PROVIDERS.join(', ') +
      '.',
  );
}

/**
 * The model id the current provider will actually use. For the log line, and for /dlo.
 *
 * Takes the lane because on gemma the answer genuinely differs by it: the endpoint can serve
 * the DGIPR-voice adapter beside the base, addressed by the request's `model` field. A log
 * line that always named the base would be the only thing an operator has to tell whether
 * the switch took effect, and it would be wrong exactly when it mattered.
 */
export function articleProviderModel(lane: GemmaLane = 'default'): string {
  switch (articleProvider()) {
    case 'qwen':
      return qwenModel();
    case 'gemma':
      return gemmaModelFor(lane);
    default:
      return ARTICLE_MODEL;
  }
}

/**
 * Whether this provider can READ the officer's uploaded documents itself.
 *
 * The one capability that splits the three, and the reason generate-article-from-sources.ts
 * has to ask rather than assume. OpenAI reads a file through its own platform conversion;
 * gemma reads rasterised pages as images (see gemma-sources.ts); the Qwen pod serves a TEXT
 * model and can do neither, so a run carrying files stays on OpenAI and the runner says so.
 */
export function articleProviderReadsSources(): boolean {
  const provider = articleProvider();
  return provider === 'openai' || provider === 'gemma';
}

export type ArticleDraftOptions = Readonly<{
  // Room for the ANSWER, as everywhere else in this package.
  maxTokens: number;
  // OpenAI only. Qwen article drafts explicitly disable thinking through the vLLM template.
  reasoningEffort: ReasoningEffort;
  // Publish the draft as it is written. Both providers stream, so the officer watches the
  // article appear whichever one is answering.
  onDelta?: ((chunk: string) => void) | undefined;
  // WHICH ARTICLE this is, which on gemma decides which of the endpoint's models writes it.
  // Threaded from the generator's own `promptMode` rather than re-derived here: the two must
  // agree, because the adapter was distilled on exactly the prompt that flag selects, and a
  // deployment where the DLO prompt is answered by the base — or worse, the DLO adapter
  // answers an ordinary article it was never trained for — is silent in both directions.
  promptMode?: 'default' | 'dlo' | undefined;
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

  if (articleProvider() === 'gemma') {
    // The same certain-before-the-request guard the Qwen branch makes, for the same reason.
    if (!isGemmaConfigured()) {
      throw new GemmaNotConfiguredError('GEMMA_BASE_URL');
    }
    // No documents: this is the TEXT lane, reached when an intake carries only typed notes
    // and transcripts. The file lane goes through generate-article-from-sources.ts, which
    // calls respondWithSourcesViaGemma with the officer's pages attached. One function
    // serves both so a prompt cannot travel two different ways to the same model.
    //
    // AND THIS IS WHERE MOST /dlo ARTICLES ARE WRITTEN. A notes-only intake — the majority
    // of them, and the majority of what the adapter was distilled from — reaches gemma
    // HERE, not through the file lane. Overriding the model only there would have left this
    // path on the base while the operator believed the whole lane had switched, which is the
    // half-switch this seam exists to prevent.
    return respondWithSourcesViaGemma({
      label: 'gemma article',
      messages,
      documents: [],
      maxOutputTokens: options.maxTokens,
      lane: options.promptMode === 'dlo' ? 'dlo' : 'default',
      ...(options.onDelta ? { onDelta: options.onDelta } : {}),
    });
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

  // gemma: the third provider, and the only one besides OpenAI that can read the officer's
  // uploaded documents. Which of the three can is what generate-article-from-sources.ts
  // branches on, so getting it wrong sends a run's pages to a model that cannot see them.
  const savedGemmaUrl = process.env.GEMMA_BASE_URL;
  process.env.ARTICLE_PROVIDER = '  Gemma  ';
  check(
    'gemma is recognised, trimmed and lowercased',
    articleProvider() === 'gemma',
  );
  delete process.env.GEMMA_MODEL;
  check(
    'and reports the served gemma id',
    articleProviderModel() === 'google/gemma-4-31B-it',
  );
  check('gemma reads its own sources', articleProviderReadsSources());

  // The per-lane adapter. The log line this feeds is the ONLY way an operator can see
  // whether the switch took effect, so it must name the model that actually answered.
  const savedDloModel = process.env.GEMMA_DLO_MODEL;
  delete process.env.GEMMA_DLO_MODEL;
  check(
    'with no adapter deployed both lanes report the base',
    articleProviderModel('dlo') === 'google/gemma-4-31B-it' &&
      articleProviderModel('default') === 'google/gemma-4-31B-it',
  );
  process.env.GEMMA_DLO_MODEL = 'dgipr-dlo-v1';
  check(
    'deployed, the DLO lane reports the adapter',
    articleProviderModel('dlo') === 'dgipr-dlo-v1',
  );
  check(
    'and every other lane still reports the base',
    articleProviderModel('default') === 'google/gemma-4-31B-it' &&
      articleProviderModel() === 'google/gemma-4-31B-it',
  );
  process.env.ARTICLE_PROVIDER = 'openai';
  check(
    'the lane is a gemma concept only — openai ignores it',
    articleProviderModel('dlo') === ARTICLE_MODEL,
  );
  process.env.ARTICLE_PROVIDER = 'qwen';
  check(
    'and so does qwen',
    articleProviderModel('dlo') === articleProviderModel('default'),
  );
  process.env.ARTICLE_PROVIDER = 'gemma';
  if (savedDloModel === undefined) delete process.env.GEMMA_DLO_MODEL;
  else process.env.GEMMA_DLO_MODEL = savedDloModel;

  process.env.ARTICLE_PROVIDER = 'openai';
  check('so does openai', articleProviderReadsSources());
  process.env.ARTICLE_PROVIDER = 'qwen';
  check(
    'qwen does NOT — it serves a text model, so a run with files stays on OpenAI',
    !articleProviderReadsSources(),
  );

  process.env.ARTICLE_PROVIDER = 'gemma';
  delete process.env.GEMMA_BASE_URL;
  let gemmaUnconfigured: unknown;
  try {
    await writeArticleDraft([{ role: 'user', content: 'x' }], {
      maxTokens: 16,
      reasoningEffort: 'low',
    });
  } catch (error) {
    gemmaUnconfigured = error;
  }
  check(
    'an unconfigured gemma fails BEFORE any request',
    gemmaUnconfigured instanceof GemmaNotConfiguredError,
  );
  check(
    'naming the missing variable',
    gemmaUnconfigured instanceof Error &&
      gemmaUnconfigured.message.includes('GEMMA_BASE_URL'),
  );

  if (savedGemmaUrl === undefined) delete process.env.GEMMA_BASE_URL;
  else process.env.GEMMA_BASE_URL = savedGemmaUrl;
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
