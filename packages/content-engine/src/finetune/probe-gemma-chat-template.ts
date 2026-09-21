// Phase 0.4 of the Gemma distillation plan: what chat template does the SERVER actually
// apply, and does it keep a `system` role?
//
// WHY THIS IS THE HIGHEST-RISK UNKNOWN. vLLM applies the chat template server-side, and the
// training script must apply the SAME one. If they diverge, they diverge at the token level:
// the loss is computed over one prompt shape and the model is served another. Nothing
// downstream reveals it — the loss curve looks fine, the adapter loads, and the style simply
// does not transfer. It is also unrecoverable without re-running the whole training.
//
// WHAT THIS SETTLES, AND WHAT IT CANNOT.
//
//   * Q1 — system role KEPT or FOLDED into the first user turn — is settled HERE, server-side,
//     with no Python and no model weights. The trick is that `/tokenize` accepts either a
//     `messages` array (it applies the template) or a raw `prompt` (it does not), so the two
//     can be compared as TOKEN IDS. Rendering [{system:S},{user:U}] and comparing it against
//     each candidate folding of S into U identifies the fold and its exact separator, or
//     proves no fold happened. Token ids rather than strings because that is the level at
//     which train and serve have to agree.
//
//   * Q2 — whether the template carries `{% generation %}` markers, which decides whether
//     TRL's `assistant_only_loss` works or a response-template collator is needed — is a
//     property of the TOKENIZER, not of the server, and no OpenAI-compatible endpoint exposes
//     it. So this writes a JSON artifact and `check_chat_template.py` answers it on the
//     training box, comparing its own `apply_chat_template` output against the ids recorded
//     here. What this DOES settle for that fallback is what the assistant turn looks like on
//     both sides, measured — see the finding below.
//
// WHAT IT FOUND, live on 2026-09-20 (`google/gemma-4-31B-it`, max_model_len 32768):
//
//   * The system role is KEPT as its own turn. No folding reproduced its ids.
//   * The template is NOT Gemma 2/3's. It renders `<|turn>role\n … <turn|>\n`, not
//     `<start_of_turn>` / `<end_of_turn>`. Anything written from Gemma-3 memory is wrong here,
//     which is why every marker this file reports is DERIVED from the renderings themselves.
//   * THE GENERATION PROMPT AND A HISTORICAL ASSISTANT TURN DO NOT MATCH. History renders
//     `<|turn>model\n{article}<turn|>\n`, while `add_generation_prompt` appends
//     `<|turn>model\n<|channel>thought\n<channel|>` — an empty `thought` channel the history
//     rendering has no trace of. `chat_template_kwargs: {enable_thinking: false}` changes
//     nothing (byte-identical, 14 tokens). So training on the plain rendered conversation
//     would teach the model to continue a prefix the server never sends. Phase 3 must build
//     each training text from the GENERATION PROMPT instead — see the Q2 section of the
//     output for the exact instruction.
//
// ROUTING, also measured rather than assumed. vLLM serves `/tokenize` and `/detokenize`
// beside `/v1`, not under it, and Runpod's serverless proxy forwards that path unchanged:
// `https://api.runpod.ai/v2/<id>/openai/tokenize` answers 200, while the `/openai/v1/tokenize`
// the plan expected to be needed answers 500. Both are still tried, in that order, because the
// proxy's routing is not ours to depend on. A failure on both is a finding, not a bug: the
// documented fallback is to read the template from the model repo and verify against a local
// vLLM. Note a COLD serverless worker fails the same way as a stopped one — confirm `/v1/models`
// answers before believing a routing verdict.
//
// FREE. `/tokenize` and `/detokenize` run no inference and generate no tokens. On a serverless
// endpoint they do spin the worker up, so the only cost is idle GPU seconds.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { openAiFetch } from '../http/openai-request.js';
import {
  gemmaApiKey,
  gemmaBaseUrl,
  gemmaModel,
  gemmaTimeoutMs,
  isGemmaConfigured,
} from '../generation/gemma-sources.js';

const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/finetune/distill/chat-template-probe.json',
);

// Deliberately unmistakable, and deliberately not Marathi: this probe is about STRUCTURE, and
// a sentinel that cannot occur inside a template's own boilerplate is what makes the analysis
// exact rather than a judgement call.
export const SENTINELS = {
  system: 'ZZSYSTEMZZ',
  user: 'ZZUSERZZ',
  assistant: 'ZZASSISTANTZZ',
} as const;

/**
 * Every separator worth testing between a folded system message and the user turn.
 *
 * Ordered from most to least likely. Gemma 2/3 folded with a blank line; some templates use a
 * single newline and some concatenate bare. If none matches, the system role was KEPT — which
 * is the answer Phase 1's JSONL needs, so the list existing is what makes "kept" a measured
 * conclusion rather than the absence of one.
 */
export const FOLD_SEPARATORS: readonly string[] = ['\n\n', '\n', ' ', ''];

export type TokenizeResult = Readonly<{
  count: number;
  maxModelLen: number | null;
  tokens: readonly number[];
}>;

/**
 * The two places `/tokenize` can live, in the order to try them.
 *
 * vLLM's own layout first (beside `/v1`, which is what qwen-chat.ts already relies on), then
 * under the versioned path, which is the shape a proxy that only forwards `/openai/v1/*`
 * would need.
 */
export function tokenizeUrlCandidates(base: string): readonly string[] {
  const clean = base.replace(/\/+$/, '');
  const beside = clean.replace(/\/v1$/, '');
  const candidates = [`${beside}/tokenize`, `${clean}/tokenize`];
  return [...new Set(candidates)];
}

export function siblingUrl(tokenizeUrl: string, endpoint: string): string {
  return tokenizeUrl.replace(/\/tokenize$/, `/${endpoint}`);
}

function readTokenizeResponse(payload: unknown): TokenizeResult {
  const record =
    payload !== null && typeof payload === 'object'
      ? (payload as Partial<Record<string, unknown>>)
      : {};
  const count = record['count'];
  const tokens = record['tokens'];
  const window = record['max_model_len'];
  if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === 'number')) {
    throw new Error(
      '/tokenize returned no token array. This build may be too old to compare ids; ' +
        'fall back to reading the template from the model repo.',
    );
  }
  return {
    count: typeof count === 'number' ? count : tokens.length,
    maxModelLen: typeof window === 'number' ? window : null,
    tokens: tokens as number[],
  };
}

async function postJson(
  url: string,
  label: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await openAiFetch(url, {
    label,
    apiKey: gemmaApiKey(),
    timeoutMs: gemmaTimeoutMs(),
    maxRetries: 0,
    body,
  });
  return (await response.json()) as unknown;
}

export type ProbeMessage = Readonly<{ role: string; content: string }>;

export async function tokenizeMessages(
  url: string,
  messages: readonly ProbeMessage[],
  addGenerationPrompt: boolean,
): Promise<TokenizeResult> {
  return readTokenizeResponse(
    await postJson(url, 'gemma template tokenize (messages)', {
      model: gemmaModel(),
      messages,
      add_generation_prompt: addGenerationPrompt,
    }),
  );
}

export async function tokenizePrompt(
  url: string,
  prompt: string,
): Promise<TokenizeResult> {
  return readTokenizeResponse(
    await postJson(url, 'gemma template tokenize (prompt)', {
      model: gemmaModel(),
      prompt,
      // The rendered template already carries its own control tokens; letting the tokenizer
      // add a second BOS would make an identical rendering compare as different.
      add_special_tokens: false,
    }),
  );
}

export async function detokenize(
  url: string,
  tokens: readonly number[],
): Promise<string> {
  const payload = await postJson(
    siblingUrl(url, 'detokenize'),
    'gemma template detokenize',
    { model: gemmaModel(), tokens },
  );
  const record =
    payload !== null && typeof payload === 'object'
      ? (payload as Partial<Record<string, unknown>>)
      : {};
  const prompt = record['prompt'];
  if (typeof prompt !== 'string') {
    throw new Error('/detokenize returned no prompt string.');
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Analysis — pure, and what `--check` exercises.
// ---------------------------------------------------------------------------

export function sameTokens(
  a: readonly number[],
  b: readonly number[],
): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export type SystemVerdict = Readonly<{
  kept: boolean;
  /** The separator the system text was folded with, when it was folded. */
  separator: string | null;
  note: string;
}>;

/**
 * Was the system message kept as its own turn, or folded into the first user turn?
 *
 * `withSystemTokens` is [{system},{user}] rendered by the server. Each entry of
 * `foldedCandidates` is [{user: system + sep + user}] rendered by the same server. An exact
 * token-id match identifies the fold; no match at all means the template kept the role.
 */
export function judgeSystemRole(
  withSystemTokens: readonly number[],
  foldedCandidates: readonly Readonly<{
    separator: string;
    tokens: readonly number[];
  }>[],
): SystemVerdict {
  for (const candidate of foldedCandidates) {
    if (sameTokens(withSystemTokens, candidate.tokens)) {
      return {
        kept: false,
        separator: candidate.separator,
        note:
          'The template FOLDS the system message into the first user turn. Phase 1 may still ' +
          'write a chat `system` role in the JSONL — the tokenizer will fold it the same way — ' +
          'but the training script must apply this same template rather than concatenating by hand.',
      };
    }
  }
  return {
    kept: true,
    separator: null,
    note:
      'The template KEEPS the system message as its own turn: no folding reproduced its ids. ' +
      "Phase 1's JSONL `system` role is carried through as a distinct turn, which is what the " +
      'plan needs.',
  };
}

export function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/**
 * What one rendering adds on top of another, given they share a prefix.
 *
 * Every marker this probe reports is DERIVED this way rather than matched against a list of
 * known control tokens. The first draft of this file did the latter and was wrong the moment
 * it met the real server: the served template uses `<|turn>role` / `<turn|>` rather than
 * Gemma 2/3's `<start_of_turn>` / `<end_of_turn>`, so a marker list written from memory
 * matched nothing and silently returned the whole prompt as the "response template". A
 * response template that is one character wrong masks the answer and trains on nothing, so it
 * has to be measured.
 */
export function suffixAfterCommonPrefix(
  rendered: string,
  base: string,
): string {
  return rendered.slice(commonPrefixLength(rendered, base));
}

export type TurnMarkers = Readonly<{
  /** What precedes the assistant's text when the turn is rendered as HISTORY. */
  responseTemplate: string | null;
  /** What the server appends when it is asking the model to WRITE the turn. */
  servingSuffix: string;
  /**
   * Whether the two agree. They must, or the model is trained to continue one prefix and
   * served another — the exact divergence Phase 0.4 exists to catch, and one that shows up
   * nowhere in a loss curve.
   */
  agree: boolean;
}>;

/**
 * The assistant turn as TRAINING would render it, beside the one SERVING actually sends.
 *
 * `promptOnly` is the conversation without the assistant turn and without a generation
 * prompt; `withAssistant` is the same conversation with the answer rendered as history;
 * `generationPrompt` is the same conversation with `add_generation_prompt: true`.
 */
export function compareTurnMarkers(
  withAssistant: string,
  generationPrompt: string,
  promptOnly: string,
): TurnMarkers {
  const servingSuffix = suffixAfterCommonPrefix(generationPrompt, promptOnly);
  const at = withAssistant.indexOf(SENTINELS.assistant);
  if (at === -1) {
    return { responseTemplate: null, servingSuffix, agree: false };
  }
  const start = commonPrefixLength(withAssistant, promptOnly);
  const responseTemplate =
    start <= at ? withAssistant.slice(start, at) : withAssistant.slice(0, at);
  return {
    responseTemplate,
    servingSuffix,
    agree: responseTemplate === servingSuffix,
  };
}

export function describeRendering(rendered: string): string {
  // Control tokens are what carry the structure, so they are shown rather than smoothed away.
  return rendered.replace(/\n/g, '\\n\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string' },
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      [
        'Usage: pnpm finetune:template [--out <file.json>]',
        '',
        "Phase 0.4: reads the SERVER's chat template through vLLM /tokenize and /detokenize.",
        'Runs no inference and generates no tokens; on a serverless endpoint the only cost is',
        'the worker spinning up.',
        '',
        '  --out <file>  where to write the artifact check_chat_template.py compares against',
        '  --check       run the offline harness; touches no network',
      ].join('\n'),
    );
    return;
  }
  if (values.check) {
    runChecks();
    return;
  }

  if (!isGemmaConfigured()) {
    throw new Error(
      'GEMMA_BASE_URL is not set. Point it at the OpenAI-compatible base of the gemma ' +
        "endpoint, ending in '/v1'.",
    );
  }
  const base = gemmaBaseUrl();
  const model = gemmaModel();
  console.log(`model: ${model}`);

  // --- routing ------------------------------------------------------------------
  const candidates = tokenizeUrlCandidates(base);
  let tokenizeUrl: string | null = null;
  const routingNotes: string[] = [];
  for (const candidate of candidates) {
    const shown = candidate.replace(/\/v2\/[^/]+\//, '/v2/<endpoint>/');
    try {
      await tokenizePrompt(candidate, 'probe');
      tokenizeUrl = candidate;
      routingNotes.push(`ok    ${shown}`);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      routingNotes.push(`FAIL  ${shown} — ${message.slice(0, 160)}`);
    }
  }
  console.log('\n=== /tokenize routing ===');
  for (const note of routingNotes) console.log(`  ${note}`);
  if (!tokenizeUrl) {
    throw new Error(
      'Neither /tokenize candidate answered. This is the documented fallback case: read the ' +
        'chat template from the model repo and verify it against a local vLLM instead. Note ' +
        'that a stopped serverless endpoint fails the same way — confirm the worker is up first.',
    );
  }

  // --- Q1: is the system role kept? ---------------------------------------------
  const withSystem: ProbeMessage[] = [
    { role: 'system', content: SENTINELS.system },
    { role: 'user', content: SENTINELS.user },
  ];
  const rendered0 = await tokenizeMessages(tokenizeUrl, withSystem, false);
  const foldedCandidates = [];
  for (const separator of FOLD_SEPARATORS) {
    const folded: ProbeMessage[] = [
      {
        role: 'user',
        content: `${SENTINELS.system}${separator}${SENTINELS.user}`,
      },
    ];
    const result = await tokenizeMessages(tokenizeUrl, folded, false);
    foldedCandidates.push({ separator, tokens: result.tokens });
  }
  const verdict = judgeSystemRole(rendered0.tokens, foldedCandidates);

  // --- the three renderings the marker comparison needs --------------------------
  // All three over the SAME prompt messages, or the shared-prefix arithmetic below compares
  // two different conversations and reports a difference that is not the one being measured.
  const full: ProbeMessage[] = [
    { role: 'system', content: SENTINELS.system },
    { role: 'user', content: SENTINELS.user },
    { role: 'assistant', content: SENTINELS.assistant },
  ];
  const renderedFull = await tokenizeMessages(tokenizeUrl, full, false);
  const text = await detokenize(tokenizeUrl, renderedFull.tokens);
  const promptOnlyText = await detokenize(tokenizeUrl, rendered0.tokens);
  const generationPrompt = await tokenizeMessages(
    tokenizeUrl,
    withSystem,
    true,
  );
  const generationText = await detokenize(tokenizeUrl, generationPrompt.tokens);
  const markers = compareTurnMarkers(text, generationText, promptOnlyText);

  console.log('\n=== Q1: the system role ===');
  console.log(`  kept as its own turn: ${verdict.kept ? 'YES' : 'NO'}`);
  if (!verdict.kept) {
    console.log(
      `  folded with separator: ${JSON.stringify(verdict.separator)}`,
    );
  }
  console.log(`  ${verdict.note}`);

  console.log('\n=== the served rendering (system + user + assistant) ===');
  console.log(describeRendering(text));

  console.log('\n=== with add_generation_prompt (what the server appends) ===');
  console.log(describeRendering(generationText));

  console.log('\n=== Q2 (half): the assistant turn, trained vs served ===');
  console.log(
    `  as HISTORY (what training renders): ${JSON.stringify(markers.responseTemplate)}`,
  );
  console.log(
    `  as a GENERATION PROMPT (what serving sends): ${JSON.stringify(markers.servingSuffix)}`,
  );
  if (markers.agree) {
    console.log(
      '  They AGREE. A completion-only collator can use the history marker as its response',
      '\n  template, and training on the rendered conversation matches what serving sends.',
    );
  } else {
    console.log(
      '  *** THEY DIFFER — this is a train/serve divergence and Phase 3 must handle it. ***',
      '\n  Training on the rendered conversation teaches the model to continue the HISTORY',
      '\n  marker, while the server hands it the GENERATION PROMPT one. Nothing in a loss curve',
      '\n  shows this. The fix is to build each training text as',
      '\n      render(prompt_messages, add_generation_prompt=True) + article + <turn-close>',
      '\n  and mask everything up to and including the generation suffix, so the tokens the',
      '\n  model is trained to continue are byte-identical to the ones it is served.',
    );
  }
  console.log(
    '\n  Whether `{% generation %}` markers exist is a TOKENIZER property no OpenAI-compatible',
    '\n  endpoint exposes. Run check_chat_template.py on the training box against the artifact',
    '\n  below; it also re-renders these exact messages and compares ids byte-for-byte.',
  );

  console.log(
    `\n  max_model_len: ${rendered0.maxModelLen ?? '(not reported)'}`,
  );

  const invocationDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out ? resolve(invocationDir, values.out) : DEFAULT_OUT;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        model,
        maxModelLen: rendered0.maxModelLen,
        sentinels: SENTINELS,
        systemRole: verdict,
        turnMarkers: markers,
        // The comparison the training box re-runs. Messages and ids together, because ids
        // alone cannot be re-derived and messages alone cannot be checked.
        cases: [
          {
            name: 'system+user',
            messages: withSystem,
            addGenerationPrompt: false,
            tokens: rendered0.tokens,
            rendered: promptOnlyText,
          },
          {
            name: 'system+user+assistant',
            messages: full,
            addGenerationPrompt: false,
            tokens: renderedFull.tokens,
            rendered: text,
          },
          {
            name: 'system+user+generation_prompt',
            messages: withSystem,
            addGenerationPrompt: true,
            tokens: generationPrompt.tokens,
            rendered: generationText,
          },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`\nArtifact written: ${out}`);
}

// ---------------------------------------------------------------------------
// Free harness: routing and analysis, no network.
//   npx tsx src/finetune/probe-gemma-chat-template.ts --check
// ---------------------------------------------------------------------------

function runChecks(): void {
  const checks: Array<[string, boolean]> = [];
  const check = (label: string, ok: boolean): void => {
    checks.push([label, ok]);
  };

  const runpod = tokenizeUrlCandidates(
    'https://api.runpod.ai/v2/abc/openai/v1/',
  );
  check(
    "vLLM's own layout is tried first",
    runpod[0] === 'https://api.runpod.ai/v2/abc/openai/tokenize',
  );
  check(
    'and the versioned path second, for a proxy that only routes /v1',
    runpod[1] === 'https://api.runpod.ai/v2/abc/openai/v1/tokenize',
  );
  check(
    'a base with no /v1 yields one candidate, not a duplicate',
    tokenizeUrlCandidates('http://localhost:8000').length === 1,
  );
  check(
    'detokenize is derived from whichever tokenize routed',
    siblingUrl('https://x/openai/tokenize', 'detokenize') ===
      'https://x/openai/detokenize',
  );

  check('identical ids compare equal', sameTokens([1, 2, 3], [1, 2, 3]));
  check('a length difference does not', !sameTokens([1, 2], [1, 2, 3]));
  check('nor does a value difference', !sameTokens([1, 2, 4], [1, 2, 3]));

  const keptVerdict = judgeSystemRole(
    [1, 2, 3],
    [
      { separator: '\n\n', tokens: [9, 9] },
      { separator: '\n', tokens: [8] },
    ],
  );
  check('no folding reproduces the ids ⇒ the role is KEPT', keptVerdict.kept);
  check('and no separator is claimed', keptVerdict.separator === null);

  const foldedVerdict = judgeSystemRole(
    [4, 5, 6],
    [
      { separator: '\n\n', tokens: [9] },
      { separator: '\n', tokens: [4, 5, 6] },
    ],
  );
  check('an exact match ⇒ FOLDED', !foldedVerdict.kept);
  check(
    'and names the separator that reproduced it',
    foldedVerdict.separator === '\n',
  );
  check(
    'the blank-line fold is tried before the single newline',
    FOLD_SEPARATORS[0] === '\n\n' && FOLD_SEPARATORS[1] === '\n',
  );
  check('and a bare concatenation is tried too', FOLD_SEPARATORS.includes(''));

  check(
    'a shared prefix is measured',
    commonPrefixLength('abcd', 'abxx') === 2,
  );
  check('an empty one is zero', commonPrefixLength('a', 'b') === 0);
  check(
    'and the suffix is what one adds over the other',
    suffixAfterCommonPrefix('abcd', 'ab') === 'cd',
  );

  // The REAL served template, verbatim from the live endpoint on 2026-09-20. It uses
  // `<|turn>role` / `<turn|>` rather than Gemma 2/3's `<start_of_turn>` / `<end_of_turn>`,
  // which is exactly why nothing here matches against a list of known control tokens.
  const promptOnly = `<bos><|turn>system\n${SENTINELS.system} <turn|>\n<|turn>user\n${SENTINELS.user}<turn|>\n`;
  const served = promptOnly + `<|turn>model\n<|channel>thought\n<channel|>`;
  const history = promptOnly + `<|turn>model\n${SENTINELS.assistant}<turn|>\n`;
  const real = compareTurnMarkers(history, served, promptOnly);
  check(
    'the history marker is derived, not matched against known tokens',
    real.responseTemplate === '<|turn>model\n',
  );
  check(
    'and so is the serving suffix, thought channel included',
    real.servingSuffix === '<|turn>model\n<|channel>thought\n<channel|>',
  );
  check(
    "the live template's two markers DIFFER — the finding Phase 3 turns on",
    real.agree === false,
  );

  // A template whose generation prompt is just the turn opener: the two must agree.
  const plainServed = promptOnly + '<|turn>model\n';
  const plain = compareTurnMarkers(history, plainServed, promptOnly);
  check('an agreeing template is reported as agreeing', plain.agree === true);

  // ChatML, to prove none of this is Gemma-specific.
  const chatmlPrompt = `<|im_start|>user\n${SENTINELS.user}<|im_end|>\n`;
  const chatml = compareTurnMarkers(
    chatmlPrompt + `<|im_start|>assistant\n${SENTINELS.assistant}<|im_end|>\n`,
    chatmlPrompt + '<|im_start|>assistant\n',
    chatmlPrompt,
  );
  check(
    'it works unchanged on a different control-token family',
    chatml.responseTemplate === '<|im_start|>assistant\n' && chatml.agree,
  );
  check(
    'a rendering with no assistant turn yields null rather than a guess',
    compareTurnMarkers(promptOnly, served, promptOnly).responseTemplate ===
      null,
  );

  check(
    'a tokenize response without a token array is refused',
    (() => {
      try {
        readTokenizeResponse({ count: 7, max_model_len: 32768 });
        return false;
      } catch (error) {
        return (
          error instanceof Error && error.message.includes('no token array')
        );
      }
    })(),
  );
  check(
    'and a well-formed one is read, window included',
    (() => {
      const read = readTokenizeResponse({
        count: 3,
        max_model_len: 32768,
        tokens: [1, 2, 3],
      });
      return read.count === 3 && read.maxModelLen === 32768;
    })(),
  );
  check(
    'a missing window is null, never a default',
    readTokenizeResponse({ tokens: [1] }).maxModelLen === null,
  );

  check(
    'the sentinels cannot collide with template boilerplate',
    Object.values(SENTINELS).every((s) => /^[A-Z]+$/.test(s) && s.length > 6) &&
      new Set(Object.values(SENTINELS)).size === 3,
  );

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Probe failed.');
    process.exitCode = 1;
  });
}
