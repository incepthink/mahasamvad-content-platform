import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QWEN_CHAT_SYSTEM_INSTRUCTION,
  QWEN_DEFAULT_MODEL,
  buildQwenMessages,
  buildQwenRequestBody,
  createThinkingStripper,
  fitTurnsToBudget,
  qwenChatCompletionsUrl,
  qwenMaxInputChars,
  qwenModel,
  streamQwenChatReply,
  preflightQwen,
  qwenModelsUrl,
  type QwenChatLifecycleEvent,
  type QwenChatReply,
} from './qwen-chat.js';
import { textOf, type MiscChatTurn } from './misc-chat.js';
import {
  createCostAccumulator,
  runInCostScope,
  runInCostTask,
  totalCostUsd,
  type CostAccumulator,
  type CostTaskUsage,
} from '../cost/cost-meter.js';
import { QWEN_COST_PROVIDER, priceText } from '../cost/pricing.js';
import {
  QWEN_USER_MESSAGES,
  classifyQwenFailure,
  isQwenChatError,
  type QwenChatError,
  type QwenErrorKind,
} from './qwen-errors.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const QWEN_ENV = [
  'QWEN_BASE_URL',
  'QWEN_API_KEY',
  'QWEN_MODEL',
  'QWEN_TIMEOUT_MS',
  'QWEN_PREFLIGHT_TIMEOUT_MS',
  'QWEN_MAX_OUTPUT_TOKENS',
  'QWEN_MAX_INPUT_CHARS',
] as const;

const BASE = 'https://pod-8000.proxy.runpod.net/v1';

function setEnv(values: Readonly<Record<string, string | undefined>>): void {
  for (const name of QWEN_ENV) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentFrame(content: string): string {
  return frame({ choices: [{ delta: { content } }] });
}

function reasoningFrame(reasoning: string): string {
  return frame({ choices: [{ delta: { reasoning_content: reasoning } }] });
}

function finishFrame(reason: string): string {
  return frame({ choices: [{ delta: {}, finish_reason: reason }] });
}

function usageFrame(): string {
  return frame({
    choices: [],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  });
}

type Captured = Readonly<{ url: string; init: RequestInit }>;

// How the stubbed pod answers the reachability probe. The default is a healthy pod serving
// exactly the model the client asks for; a test that is about the probe overrides it.
type PodHealth = Readonly<{
  status?: number;
  // Raw body, so a test can hand back the proxy's HTML error page as easily as JSON.
  body?: string;
  // A pod that is switched off: the connection never completes and undici reports a
  // TypeError rather than a response. This is the provider's ORDINARY state.
  throws?: Error;
}>;

// How the stubbed pod answers the completion request, for the failures that only the
// answer call can produce (vLLM refuses an over-long prompt with a 400 and its own wording).
type PodCompletion = Readonly<{ status: number; body: string }>;

type StubOptions = Readonly<{
  health?: PodHealth;
  completion?: PodCompletion;
}>;

const HEALTHY_POD: PodHealth = {
  status: 200,
  body: JSON.stringify({
    object: 'list',
    data: [{ id: 'Qwen/Qwen3.8-27B', object: 'model', max_model_len: 40_960 }],
  }),
};

// A stubbed global fetch handing back one SSE body, plus an answer for the /models probe
// every turn now makes first. It records what the transport was asked to send, which is the
// only place the wire request is visible without a running pod — the two calls are recorded
// SEPARATELY so `captured[0]` still means "the completion request" in every existing test.
function stubFetch(
  chunks: readonly string[],
  { health = HEALTHY_POD, completion }: StubOptions = {},
): {
  captured: Captured[];
  preflights: Captured[];
  restore: () => void;
} {
  const captured: Captured[] = [];
  const preflights: Captured[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/models')) {
      preflights.push({ url: href, init });
      if (health.throws !== undefined) return Promise.reject(health.throws);
      const status = health.status ?? 200;
      const body = health.body ?? HEALTHY_POD.body;
      return Promise.resolve(new Response(body ?? '', { status }));
    }
    captured.push({ url: href, init });
    if (completion !== undefined) {
      return Promise.resolve(
        new Response(completion.body, { status: completion.status }),
      );
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;
  return {
    captured,
    preflights,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

type Run = Readonly<{
  reply: QwenChatReply;
  deltas: string[];
  reasoning: string[];
  lifecycle: QwenChatLifecycleEvent[];
  captured: Captured[];
  preflights: Captured[];
}>;

async function run(
  chunks: readonly string[],
  turns: readonly MiscChatTurn[] = [{ role: 'user', content: 'नमस्कार' }],
): Promise<Run> {
  const { captured, preflights, restore } = stubFetch(chunks);
  const deltas: string[] = [];
  const reasoning: string[] = [];
  const lifecycle: QwenChatLifecycleEvent[] = [];
  try {
    const reply = await streamQwenChatReply({
      turns,
      onDelta: (chunk) => deltas.push(chunk),
      onReasoning: (chunk) => reasoning.push(chunk),
      onLifecycle: (event) => lifecycle.push(event),
    });
    return { reply, deltas, reasoning, lifecycle, captured, preflights };
  } finally {
    restore();
  }
}

// `run`, but against a pod answering the probe in some particular way. Separate rather than
// an extra parameter on `run` so the twenty tests that do not care about the probe read
// exactly as they did before it existed.
async function runWithHealth(
  chunks: readonly string[],
  health: PodHealth,
  turns: readonly MiscChatTurn[] = [{ role: 'user', content: 'नमस्कार' }],
): Promise<Run> {
  const { captured, preflights, restore } = stubFetch(chunks, { health });
  const deltas: string[] = [];
  const reasoning: string[] = [];
  const lifecycle: QwenChatLifecycleEvent[] = [];
  try {
    const reply = await streamQwenChatReply({
      turns,
      onDelta: (chunk) => deltas.push(chunk),
      onReasoning: (chunk) => reasoning.push(chunk),
      onLifecycle: (event) => lifecycle.push(event),
    });
    return { reply, deltas, reasoning, lifecycle, captured, preflights };
  } finally {
    restore();
  }
}

async function runExpectingFailure(
  chunks: readonly string[],
  options?: StubOptions,
): Promise<{
  error: QwenChatError;
  deltas: string[];
  captured: Captured[];
  preflights: Captured[];
}> {
  const { captured, preflights, restore } = stubFetch(chunks, options);
  const deltas: string[] = [];
  let error: unknown = null;
  try {
    await streamQwenChatReply({
      turns: [{ role: 'user', content: 'नमस्कार' }],
      onDelta: (chunk) => deltas.push(chunk),
    });
  } catch (thrown) {
    error = thrown;
  } finally {
    restore();
  }
  // EVERY failure on this path is typed. That is the contract step 7's route relies on: it
  // reads a Marathi sentence off the error instead of pattern-matching a message.
  assert.ok(
    isQwenChatError(error),
    `expected a QwenChatError, got ${String(error)}`,
  );
  return { error, deltas, captured, preflights };
}

// ---------------------------------------------------------------------------
// Configuration and the wire request
// ---------------------------------------------------------------------------

test('the model defaults to the exact string the pod serves', () => {
  // vLLM matches the `model` field against its own --model argument and 404s on anything
  // else, so this default is load-bearing rather than cosmetic.
  assert.equal(QWEN_DEFAULT_MODEL, 'Qwen/Qwen3.8-27B');
  setEnv({ QWEN_BASE_URL: BASE });
  assert.equal(qwenModel(), 'Qwen/Qwen3.8-27B');
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MODEL: 'Qwen/Other' });
  assert.equal(qwenModel(), 'Qwen/Other');
  setEnv({});
});

test('a missing base URL fails by name, before anything is sent', () => {
  setEnv({});
  assert.throws(() => qwenChatCompletionsUrl(), /QWEN_BASE_URL/);
  // A trailing slash on the configured base must not produce a doubled path.
  setEnv({ QWEN_BASE_URL: `${BASE}/` });
  assert.equal(qwenChatCompletionsUrl(), `${BASE}/chat/completions`);
  setEnv({});
});

test('the request asks for a stream, its usage, and room for thinking', () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const body = buildQwenRequestBody([{ role: 'user', content: 'नमस्कार' }]);
  assert.equal(body.model, 'Qwen/Qwen3.8-27B');
  assert.equal(body.stream, true);
  // Without include_usage a streamed completion reports no usage at all, and every Qwen
  // turn would be invisible to the cost meter.
  assert.deepEqual(body.stream_options, { include_usage: true });
  // max_tokens covers thinking AND the answer, so the configured answer budget carries the
  // headroom on top — the gpt-5 max_completion_tokens trap, one provider over.
  assert.equal(body.max_tokens, 8_192 + 16_384);

  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_OUTPUT_TOKENS: '4096' });
  assert.equal(buildQwenRequestBody([]).max_tokens, 4_096 + 16_384);
  setEnv({});
});

test('the system brief claims no tool this provider does not have', () => {
  assert.match(
    QWEN_CHAT_SYSTEM_INSTRUCTION,
    /general-purpose AI chat assistant/,
  );
  assert.match(QWEN_CHAT_SYSTEM_INSTRUCTION, /Match the language/);
  assert.match(QWEN_CHAT_SYSTEM_INSTRUCTION, /never invent facts/);
  // The regression that matters: told to search an index it does not have, a model reports
  // having read a document it never saw.
  assert.doesNotMatch(QWEN_CHAT_SYSTEM_INSTRUCTION, /file_search/);
  assert.match(QWEN_CHAT_SYSTEM_INSTRUCTION, /cannot see images/);
});

test('an attachment this provider cannot read leaves no trace in the transcript', () => {
  const messages = buildQwenMessages([
    {
      role: 'user',
      content: 'हे वाचा',
      attachments: [
        { kind: 'document', name: 'note.docx', text: 'शासन निर्णय' },
        { kind: 'audio', name: 'meeting.mp3', text: 'बैठकीचा मजकूर' },
        // Neither of these carries extracted text: an image is a content part on the
        // OpenAI lane and a PDF is behind File Search, so both must simply be absent here.
        { kind: 'image', name: 'poster.png', imageUrl: 'https://x/poster.png' },
        { kind: 'document', name: 'gr.pdf', documentFileId: 'file-gr' },
      ],
    },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[1]?.role, 'user');
  const text = messages[1]?.content ?? '';
  assert.match(text, /हे वाचा/);
  assert.match(text, /--- note\.docx ---\nशासन निर्णय/);
  assert.match(text, /--- meeting\.mp3 ---\nबैठकीचा मजकूर/);
  assert.doesNotMatch(text, /poster\.png/);
  assert.doesNotMatch(text, /gr\.pdf/);
  assert.doesNotMatch(text, /file-gr/);
});

// ---------------------------------------------------------------------------
// The thinking stripper, in isolation
// ---------------------------------------------------------------------------

function strip(chunks: readonly string[]): { answer: string; think: string } {
  let answer = '';
  let think = '';
  const stripper = createThinkingStripper(
    (chunk) => {
      answer += chunk;
    },
    (chunk) => {
      think += chunk;
    },
  );
  for (const chunk of chunks) stripper.push(chunk);
  stripper.flush();
  return { answer, think };
}

test('a think tag is stripped however it is split across frames', () => {
  const whole = '<think>मी विचार करतो</think>उत्तर';
  // Every possible split point, which is the only honest way to test a boundary rule: the
  // tags will arrive cut in whichever place the server happened to flush.
  for (let at = 0; at <= whole.length; at++) {
    assert.deepEqual(
      strip([whole.slice(0, at), whole.slice(at)]),
      { answer: 'उत्तर', think: 'मी विचार करतो' },
      `split at ${at}`,
    );
  }
  // And one character at a time, the worst case.
  assert.deepEqual(strip([...whole]), {
    answer: 'उत्तर',
    think: 'मी विचार करतो',
  });
});

test('the stripper handles several blocks, leading text and an unfinished stream', () => {
  assert.deepEqual(strip(['before<think>a</think>mid<think>b</think>end']), {
    answer: 'beforemidend',
    think: 'ab',
  });
  // A stream that ends inside a block: the remainder was thinking and is delivered as such,
  // never appended to the answer.
  assert.deepEqual(strip(['answer<think>cut off']), {
    answer: 'answer',
    think: 'cut off',
  });
  // A tail that never becomes a tag is ordinary text and must be flushed, not swallowed.
  assert.deepEqual(strip(['done <thi']), { answer: 'done <thi', think: '' });
  assert.deepEqual(strip(['a < b and 3 <thin']), {
    answer: 'a < b and 3 <thin',
    think: '',
  });
  // vLLM can omit the opening marker while retaining the close marker.
  assert.deepEqual(strip(['private reasoning</think>answer']), {
    answer: 'answer',
    think: 'private reasoning',
  });
});

test('an opening-less thinking block is stripped across every frame boundary', () => {
  const whole = 'private reasoning</think>answer';
  for (let at = 0; at <= whole.length; at++) {
    assert.deepEqual(strip([whole.slice(0, at), whole.slice(at)]), {
      answer: 'answer',
      think: 'private reasoning',
    });
  }
});

// ---------------------------------------------------------------------------
// Both wire shapes of thinking, end to end
// ---------------------------------------------------------------------------

test('reasoning_content is reported separately and never enters the answer', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { reply, deltas, reasoning } = await run([
    reasoningFrame('प्रथम '),
    reasoningFrame('विचार'),
    contentFrame('नम'),
    contentFrame('स्कार!'),
    finishFrame('stop'),
    usageFrame(),
    'data: [DONE]\n\n',
  ]);
  assert.equal(reply.text, 'नमस्कार!');
  assert.equal(reply.model, 'Qwen/Qwen3.8-27B');
  // Deltas reach the browser one at a time; one joined delta means the officer waited out
  // the whole answer behind a spinner.
  assert.deepEqual(deltas, ['नम', 'स्कार!']);
  assert.deepEqual(reasoning, ['प्रथम ', 'विचार']);
  setEnv({});
});

test('inline <think> is stripped even when the tags arrive split across frames', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { reply, deltas, reasoning } = await run([
    contentFrame('<thi'),
    contentFrame('nk>आधी '),
    contentFrame('विचार</thi'),
    contentFrame('nk>नमस्कार!'),
    finishFrame('stop'),
    usageFrame(),
    'data: [DONE]\n\n',
  ]);
  assert.equal(reply.text, 'नमस्कार!');
  // Nothing of the block, and neither half of either tag, may reach the officer's view.
  assert.equal(deltas.join(''), 'नमस्कार!');
  assert.ok(!deltas.some((chunk) => chunk.includes('<')));
  assert.equal(reasoning.join(''), 'आधी विचार');
  setEnv({});
});

test('an SSE frame split mid-JSON is still read once and in full', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const whole = contentFrame('अखंड');
  const { reply } = await run([
    whole.slice(0, 18),
    whole.slice(18),
    finishFrame('stop'),
    'data: [DONE]\n\n',
  ]);
  assert.equal(reply.text, 'अखंड');
  setEnv({});
});

// ---------------------------------------------------------------------------
// The empty-answer trap
// ---------------------------------------------------------------------------

test('an answer lost to the thinking budget says so, and names the knob', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error, deltas } = await runExpectingFailure([
    contentFrame('<think>अजून विचार करतो आहे'),
    finishFrame('length'),
    usageFrame(),
    'data: [DONE]\n\n',
  ]);
  assert.match(error.message, /finish_reason: length/);
  assert.match(error.message, /QWEN_MAX_OUTPUT_TOKENS/);
  // The diagnostic that separates "the model said nothing" from "the model thought and ran
  // out of budget": without it the reader goes looking for a dead pod.
  assert.match(error.message, /characters of thinking and no answer/);
  assert.deepEqual(deltas, []);
  setEnv({});
});

test('an empty completion with no thinking reports the empty stream', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error } = await runExpectingFailure([
    finishFrame('stop'),
    'data: [DONE]\n\n',
  ]);
  assert.match(error.message, /Qwen chat response contained no content/);
  assert.match(error.message, /finish_reason: stop/);
  assert.match(error.message, /Nothing arrived on the stream/);
  assert.doesNotMatch(error.message, /QWEN_MAX_OUTPUT_TOKENS/);
  setEnv({});
});

// ---------------------------------------------------------------------------
// Authorization, which this pod may not have
// ---------------------------------------------------------------------------

test('no key means no authorization header, not an empty bearer', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { captured } = await run([contentFrame('ok'), 'data: [DONE]\n\n']);
  const headers = (captured[0]?.init.headers ?? {}) as Record<string, string>;
  assert.equal(headers.authorization, undefined);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(captured[0]?.url, `${BASE}/chat/completions`);

  setEnv({ QWEN_BASE_URL: BASE, QWEN_API_KEY: 'sk-pod' });
  const keyed = await run([contentFrame('ok'), 'data: [DONE]\n\n']);
  const keyedHeaders = (keyed.captured[0]?.init.headers ?? {}) as Record<
    string,
    string
  >;
  assert.equal(keyedHeaders.authorization, 'Bearer sk-pod');
  setEnv({});
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test('a turn reports started, completed and committed', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { lifecycle } = await run([
    contentFrame('उत्तर'),
    finishFrame('stop'),
    usageFrame(),
    'data: [DONE]\n\n',
  ]);
  assert.deepEqual(
    lifecycle.map((event) => event.phase),
    ['request_started', 'response_completed', 'response_committed'],
  );
  assert.equal(lifecycle[2]?.answerChars, 'उत्तर'.length);
  assert.equal(lifecycle[2]?.status, 'stop');
  // There is no response id to carry, and never writing one is what keeps an OpenAI turn
  // after a Qwen turn replaying the transcript rather than chaining past it.
  assert.equal(lifecycle[2]?.responseId, undefined);
  setEnv({});
});

// ---------------------------------------------------------------------------
// The context budget
// ---------------------------------------------------------------------------

const SYSTEM_CHARS = QWEN_CHAT_SYSTEM_INSTRUCTION.length;

// The derived default with nothing configured: (assumed 40,960-token window minus the
// 8,192 + 16,384 the request already reserves for the answer and its thinking) x 1.2.
const DERIVED_BUDGET = Math.floor((40_960 - 24_576) * 1.2);

function turnOf(
  role: 'user' | 'assistant',
  label: string,
  chars: number,
): MiscChatTurn {
  return {
    role,
    content: label + 'क'.repeat(Math.max(0, chars - label.length)),
  };
}

function labels(turns: readonly MiscChatTurn[]): string[] {
  return turns.map((turn) => turn.content.slice(0, 2));
}

test('the input budget is derived from what the output budget already reserved', () => {
  setEnv({ QWEN_BASE_URL: BASE });
  assert.equal(qwenMaxInputChars(), DERIVED_BUDGET);
  // The coupling is the whole reason it is derived rather than picked: `max_tokens` is taken
  // out of --max-model-len before the prompt is measured, so raising the answer budget has to
  // shrink this one. Two independently chosen constants would overflow the window silently.
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_OUTPUT_TOKENS: '8192' });
  assert.equal(qwenMaxInputChars(), Math.floor((40_960 - 24_576) * 1.2));
  setEnv({});
});

test('an explicit budget wins, and an unusable one falls back to the derivation', () => {
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '120000' });
  assert.equal(qwenMaxInputChars(), 120_000);
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: 'plenty' });
  assert.equal(qwenMaxInputChars(), DERIVED_BUDGET);
  // Below the floor the system instruction plus a usable head of the newest turn needs.
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '500' });
  assert.equal(qwenMaxInputChars(), DERIVED_BUDGET);
  setEnv({});
});

test('a conversation inside the budget is sent exactly as it was', () => {
  const turns = [
    turnOf('user', 'q1', 100),
    turnOf('assistant', 'a1', 100),
    turnOf('user', 'q2', 100),
  ];
  const fit = fitTurnsToBudget(turns, 50_000);
  // The same objects, not copies: nothing is rewritten when nothing needs to be.
  assert.equal(fit.turns[0], turns[0]);
  assert.equal(fit.turns[1], turns[1]);
  assert.equal(fit.turns[2], turns[2]);
  assert.deepEqual(fit.report, {
    budgetChars: 50_000,
    chars: SYSTEM_CHARS + 300,
    turnsSent: 3,
    turnsDropped: 0,
    truncatedChars: 0,
  });
});

test('turns are dropped oldest first, and what is left keeps its order', () => {
  const turns = [
    turnOf('user', 'q1', 1_000),
    turnOf('assistant', 'a1', 1_000),
    turnOf('user', 'q2', 1_000),
    turnOf('assistant', 'a2', 1_000),
    turnOf('user', 'q3', 1_000),
  ];
  const budget = SYSTEM_CHARS + 3_200;
  const fit = fitTurnsToBudget(turns, budget);
  assert.deepEqual(labels(fit.turns), ['q2', 'a2', 'q3']);
  assert.equal(fit.report.turnsSent, 3);
  assert.equal(fit.report.turnsDropped, 2);
  assert.equal(fit.report.truncatedChars, 0);
  // The invariant this whole section exists to hold.
  assert.ok(fit.report.chars <= budget);
});

test('the trimmed transcript never opens on an answer with no question', () => {
  const turns = [
    turnOf('user', 'q1', 1_000),
    turnOf('assistant', 'a1', 1_000),
    turnOf('user', 'q2', 1_000),
    turnOf('assistant', 'a2', 1_000),
    turnOf('user', 'q3', 1_000),
  ];
  // Room for four, which by size alone would begin on a1 — an answer the model would read as
  // something it had asserted unprompted. The orphan goes, and its question is NOT restored
  // in the freed space, which would be the same defect the other way round.
  const fit = fitTurnsToBudget(turns, SYSTEM_CHARS + 4_200);
  assert.deepEqual(labels(fit.turns), ['q2', 'a2', 'q3']);
  assert.equal(fit.report.turnsSent, 3);
  assert.equal(fit.report.turnsDropped, 2);
});

test('the newest turn is never dropped, only cut, and it keeps its head', () => {
  const turns = [
    turnOf('user', 'q1', 5_000),
    turnOf('assistant', 'a1', 5_000),
    turnOf('user', 'q2', 20_000),
  ];
  const budget = SYSTEM_CHARS + 6_000;
  const fit = fitTurnsToBudget(turns, budget);
  assert.equal(fit.turns.length, 1);
  const only = fit.turns[0];
  assert.equal(only?.role, 'user');
  // textOf puts the officer's own words first, so a head-keep never loses the question.
  assert.ok(only?.content.startsWith('q2'));
  // Marked, not silent: the model has to be able to say the material is incomplete.
  assert.match(only?.content ?? '', /TRUNCATED/);
  assert.ok(fit.report.truncatedChars > 0);
  assert.equal(fit.report.turnsSent, 1);
  assert.equal(fit.report.turnsDropped, 2);
  assert.ok(fit.report.chars <= budget);
});

test('a cut never lands on a dependent vowel sign', () => {
  // 'का' is क plus the matra ा, two code units, so one of these two budgets necessarily puts
  // the cut between them. A matra separated from its consonant renders as a stray mark.
  const long: MiscChatTurn = { role: 'user', content: 'का'.repeat(20_000) };
  for (const extra of [0, 1]) {
    const fit = fitTurnsToBudget([long], SYSTEM_CHARS + 5_000 + extra);
    const head = (fit.turns[0]?.content ?? '').replace(
      /\n\n\[TRUNCATED[\s\S]*$/,
      '',
    );
    assert.ok(head.length > 0);
    assert.ok(head.endsWith('क'), 'the cut left a matra hanging off nothing');
  }
});

test('what is measured is what is sent, attachments included', () => {
  const withDoc: MiscChatTurn = {
    role: 'user',
    content: 'हे बघा',
    attachments: [
      { kind: 'document', name: 'gr.docx', text: 'श'.repeat(9_000) },
    ],
  };
  const newest = turnOf('user', 'q2', 100);
  // Its stored `content` is six characters and would fit many times over. What actually
  // travels is 9,000 characters of DOCX transcript, and budgeting the column would miss the
  // one thing most likely to overrun the window.
  const fit = fitTurnsToBudget([withDoc, newest], SYSTEM_CHARS + 5_000);
  assert.equal(fit.turns.length, 1);
  assert.equal(fit.turns[0], newest);
  assert.equal(fit.report.turnsDropped, 1);
});

test('the system instruction is counted against the budget', () => {
  const fit = fitTurnsToBudget([turnOf('user', 'q1', 3_500)], 4_000);
  // 3,500 characters fit 4,000 on their own; they do not once the instruction that goes above
  // them is counted. That the turn is cut at all is the proof it was.
  assert.ok(fit.report.truncatedChars > 0);
  assert.ok(fit.report.chars > SYSTEM_CHARS);
  assert.ok(fit.report.chars <= 4_000);
});

test('a cut turn stays an honest turn', () => {
  const fit = fitTurnsToBudget(
    [
      {
        role: 'user',
        content: 'q',
        attachments: [
          { kind: 'document', name: 'gr.docx', text: 'श'.repeat(20_000) },
        ],
      },
    ],
    SYSTEM_CHARS + 5_000,
  );
  const only = fit.turns[0] as MiscChatTurn;
  // No attachments left on it, so the fitted turn's textOf IS the string that was measured:
  // nothing can regrow between the budget and the wire.
  assert.equal(only.attachments, undefined);
  assert.equal(textOf(only), only.content);
  assert.equal(SYSTEM_CHARS + textOf(only).length, fit.report.chars);
});

test('the trimmed transcript is what reaches the pod, and the log says so', async () => {
  setEnv({
    QWEN_BASE_URL: BASE,
    QWEN_MAX_INPUT_CHARS: String(SYSTEM_CHARS + 4_200),
  });
  const { captured, lifecycle } = await run(
    [contentFrame('ठीक'), 'data: [DONE]\n\n'],
    [
      turnOf('user', 'q1', 1_000),
      turnOf('assistant', 'a1', 1_000),
      turnOf('user', 'q2', 1_000),
      turnOf('assistant', 'a2', 1_000),
      turnOf('user', 'q3', 1_000),
    ],
  );
  const body = JSON.parse(String(captured[0]?.init.body)) as {
    messages: { role: string; content: string }[];
  };
  assert.equal(body.messages.length, 4);
  assert.equal(body.messages[0]?.role, 'system');
  assert.deepEqual(
    body.messages.slice(1).map((message) => message.content.slice(0, 2)),
    ['q2', 'a2', 'q3'],
  );
  // The report rides request_started, so a conversation this provider shortened is visible in
  // the API log before an officer reports that the chat "forgot" something.
  assert.equal(lifecycle[0]?.phase, 'request_started');
  assert.equal(lifecycle[0]?.context?.turnsSent, 3);
  assert.equal(lifecycle[0]?.context?.turnsDropped, 2);
  assert.equal(lifecycle[0]?.context?.truncatedChars, 0);
  setEnv({});
});

// ---------------------------------------------------------------------------
// The reachability preflight
// ---------------------------------------------------------------------------

test('every turn probes /models first, as a GET with no body', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { captured, preflights } = await run([
    contentFrame('ठीक'),
    'data: [DONE]\n\n',
  ]);
  assert.equal(preflights.length, 1);
  assert.equal(preflights[0]?.url, `${BASE}/models`);
  assert.equal(preflights[0]?.init.method, 'GET');
  assert.equal(preflights[0]?.init.body, undefined);
  // And it did not replace the answer request, only precede it.
  assert.equal(captured.length, 1);
  assert.equal(qwenModelsUrl(), `${BASE}/models`);
  setEnv({});
});

test('a stopped pod fails as unreachable, before the transcript is sent', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  // undici reports a refused connection as a TypeError whose message says nothing useful.
  const dead = new TypeError('fetch failed');
  const { error, captured, preflights } = await runExpectingFailure(
    [contentFrame('never')],
    { health: { throws: dead } },
  );
  assert.equal(error.kind, 'unreachable');
  assert.equal(error.userMessage, QWEN_USER_MESSAGES.unreachable);
  // THE POINT OF THE WHOLE STEP: the officer's turn never reached the wire, so nothing
  // waited out QWEN_TIMEOUT_MS to discover what one GET already knew.
  assert.equal(captured.length, 0);
  // And the probe did not retry. A box that is off will still be off in a second, and each
  // attempt would spend its whole clock in front of someone who is watching.
  assert.equal(preflights.length, 1);
  setEnv({});
});

test('a gateway page from the proxy is unreachable, not a mystery', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error, captured, preflights } = await runExpectingFailure(
    [contentFrame('never')],
    { health: { status: 502, body: '<html><body>Bad Gateway</body></html>' } },
  );
  assert.equal(error.kind, 'unreachable');
  assert.equal(captured.length, 0);
  // 502 is on the transport's retryable list, so this also proves maxRetries: 0 reached it:
  // the default ladder would have made six of these, each on its own clock.
  assert.equal(preflights.length, 1);
  setEnv({});
});

test('a 200 that is not JSON is unreachable: something else is answering', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error } = await runExpectingFailure([contentFrame('never')], {
    health: { status: 200, body: '<html>runpod login</html>' },
  });
  assert.equal(error.kind, 'unreachable');
  assert.match(error.message, /not JSON/);
  setEnv({});
});

test('a pod serving a different model is named, and nothing is sent', async () => {
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MODEL: 'Qwen/Qwen3.8-27B' });
  const { error, captured } = await runExpectingFailure(
    [contentFrame('never')],
    {
      health: {
        status: 200,
        body: JSON.stringify({
          data: [{ id: 'meta-llama/Llama-3-8B', max_model_len: 8_192 }],
        }),
      },
    },
  );
  assert.equal(error.kind, 'modelMissing');
  assert.equal(error.userMessage, QWEN_USER_MESSAGES.modelMissing);
  // The developer message has to carry what IS served, or the operator has no next move.
  assert.match(error.message, /meta-llama\/Llama-3-8B/);
  assert.match(error.message, /QWEN_MODEL/);
  assert.equal(captured.length, 0);
  setEnv({});
});

test('an unrecognised model list does NOT refuse a working pod', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  // The probe exists to catch a dead box quickly, not to become a new way for a live one to
  // be turned away over a response shape we happen not to recognise.
  for (const body of ['{}', '{"data":[]}', '{"data":[{"object":"model"}]}']) {
    const { reply, preflights } = await runWithHealth(
      [contentFrame('ठीक'), 'data: [DONE]\n\n'],
      { status: 200, body },
    );
    assert.equal(reply.text, 'ठीक');
    assert.equal(preflights.length, 1);
  }
  setEnv({});
});

test("the pod's own max_model_len replaces the assumed window", async () => {
  // 40,960 is a GUESS (Qwen3's native length), and with the default 24,576 reserved for the
  // answer it leaves only ~19,660 characters of history. A pod that really serves 131,072
  // should get the history it can hold, measured on this very request.
  setEnv({ QWEN_BASE_URL: BASE });
  const assumed = qwenMaxInputChars();
  assert.ok(
    assumed < 20_000,
    `expected the assumed budget to stay bounded, got ${assumed}`,
  );

  const { lifecycle } = await runWithHealth(
    [contentFrame('ठीक'), 'data: [DONE]\n\n'],
    {
      status: 200,
      body: JSON.stringify({
        data: [{ id: QWEN_DEFAULT_MODEL, max_model_len: 131_072 }],
      }),
    },
  );
  assert.equal(lifecycle[0]?.preflight?.maxModelLen, 131_072);
  assert.equal(lifecycle[0]?.preflight?.modelsSeen, 1);
  const observed = lifecycle[0]?.context?.budgetChars ?? 0;
  assert.equal(observed, qwenMaxInputChars(131_072));
  assert.ok(
    observed > 100_000,
    `expected the measured window to widen the budget, got ${observed}`,
  );
  setEnv({});
});

test('a served window is advisory: an explicit budget is never overridden', () => {
  // The knob says something about this deployment that a served field cannot contradict.
  // Silently substituting a different number would make it look broken.
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '6000' });
  assert.equal(qwenMaxInputChars(131_072), 6_000);
  assert.equal(qwenMaxInputChars(8_192), 6_000);
  assert.equal(qwenMaxInputChars(null), 6_000);
  assert.equal(qwenMaxInputChars(), 6_000);
  // Including in the dangerous direction — configured far above what the pod can hold. The
  // value still wins; the disagreement is a warning, and the overflow message is what the
  // officer would then see.
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '400000' });
  assert.equal(qwenMaxInputChars(8_192), 400_000);
  // A value below the floor is not a budget, so the derivation takes over — and then the
  // measurement is used, exactly as it would be with the variable unset.
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '10' });
  const withJunk = qwenMaxInputChars(131_072);
  setEnv({ QWEN_BASE_URL: BASE });
  assert.equal(withJunk, qwenMaxInputChars(131_072));
  assert.ok(withJunk > 100_000, `expected the derived budget, got ${withJunk}`);
  setEnv({});
});

test('a budget the pod cannot hold is honoured, and warned about', () => {
  setEnv({ QWEN_BASE_URL: BASE, QWEN_MAX_INPUT_CHARS: '400000' });
  const warnings: string[] = [];
  const real = console.warn;
  console.warn = (...parts: unknown[]) => warnings.push(parts.join(' '));
  try {
    // Against a MEASURED window: the operator is told their knob does not fit the pod.
    assert.equal(qwenMaxInputChars(8_192), 400_000);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /QWEN_MAX_INPUT_CHARS/);
    assert.match(warnings[0] ?? '', /8192/);
    // Against the ASSUMPTION it stays quiet. Warning off a guess would cry wolf on every
    // turn of a correctly configured deployment whose pod is simply bigger than 40,960 —
    // which is the case the measurement exists to discover.
    warnings.length = 0;
    assert.equal(qwenMaxInputChars(), 400_000);
    assert.equal(qwenMaxInputChars(null), 400_000);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = real;
    setEnv({});
  }
});

test('the answer request retries once, not five times', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  // 503 is retryable, so the count is the whole assertion: the transport's default ladder
  // would have made six attempts here, each able to spend the full QWEN_TIMEOUT_MS in front
  // of an officer watching an empty answer. One covers a genuine blip; the officer's own
  // send button is the better retry beyond that.
  const { error, captured } = await runExpectingFailure([], {
    completion: { status: 503, body: 'service unavailable' },
  });
  assert.equal(captured.length, 2);
  assert.equal(error.kind, 'unreachable');
  setEnv({});
});

test('an unset base URL is a configuration failure, not an internal one', async () => {
  setEnv({});
  await assert.rejects(
    () => preflightQwen(),
    (error: unknown) => {
      assert.ok(isQwenChatError(error));
      assert.equal(error.kind, 'notConfigured');
      assert.match(error.message, /QWEN_BASE_URL/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// The failure taxonomy
// ---------------------------------------------------------------------------

test('an over-long prompt is reported as context, not as a generic failure', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error } = await runExpectingFailure([], {
    completion: {
      status: 400,
      body: JSON.stringify({
        object: 'error',
        message:
          "This model's maximum context length is 40960 tokens. However, you requested " +
          '45000 tokens. Please reduce the length of the messages or completion.',
        type: 'BadRequestError',
        code: 400,
      }),
    },
  });
  assert.equal(error.kind, 'contextOverflow');
  assert.equal(error.userMessage, QWEN_USER_MESSAGES.contextOverflow);
  setEnv({});
});

test('an empty completion is still typed, so the route never has to guess', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { error } = await runExpectingFailure([
    contentFrame('<think>अजून विचार'),
    finishFrame('length'),
    'data: [DONE]\n\n',
  ]);
  assert.equal(error.kind, 'failed');
  assert.equal(error.userMessage, QWEN_USER_MESSAGES.failed);
  // The developer half is unchanged: it still names the knob that caused it.
  assert.match(error.message, /QWEN_MAX_OUTPUT_TOKENS/);
  setEnv({});
});

test('the classifier reads the transport, and is total', () => {
  const kindOf = (error: unknown, fallback?: QwenErrorKind): QwenErrorKind =>
    fallback === undefined
      ? classifyQwenFailure(error).kind
      : classifyQwenFailure(error, fallback).kind;

  // Nothing answered at all, in each of the shapes a runtime produces one.
  assert.equal(kindOf(new TypeError('fetch failed')), 'unreachable');
  assert.equal(
    kindOf(
      Object.assign(new Error('The operation was aborted'), {
        name: 'TimeoutError',
      }),
    ),
    'unreachable',
  );
  assert.equal(
    kindOf(new Error('connect ECONNREFUSED 10.0.0.1:8000')),
    'unreachable',
  );

  // openAiFetch's own message shape. This is the ONE place in the product that reads it,
  // which is the point of the type: the route does not.
  const transport = (status: number, body: string): Error =>
    new Error(`OpenAI qwen chat request failed: ${status} Some Text — ${body}`);
  assert.equal(
    kindOf(transport(404, '{"message":"The model does not exist."}')),
    'modelMissing',
  );
  assert.equal(kindOf(transport(401, 'unauthorized')), 'notConfigured');
  assert.equal(kindOf(transport(403, 'forbidden')), 'notConfigured');
  assert.equal(kindOf(transport(502, 'Bad Gateway')), 'unreachable');
  assert.equal(kindOf(transport(503, 'unavailable')), 'unreachable');
  assert.equal(kindOf(transport(524, 'origin timeout')), 'unreachable');
  assert.equal(kindOf(transport(418, 'teapot')), 'failed');

  // The context wording wins over the status, because a body naming the window is a
  // diagnosis where a status is only a category, and a proxy may rewrite the latter.
  for (const wording of [
    "This model's maximum context length is 40960 tokens.",
    'The prompt is longer than the maximum sequence length.',
    'Please reduce the length of the messages.',
    'requested tokens exceed max_model_len',
  ]) {
    assert.equal(kindOf(transport(400, wording)), 'contextOverflow', wording);
  }

  // The fallback names what an unrecognised failure means in ITS caller's context.
  assert.equal(
    kindOf(new Error('something odd'), 'unreachable'),
    'unreachable',
  );
  assert.equal(kindOf(new Error('something odd')), 'failed');
  assert.equal(kindOf('not even an error'), 'failed');

  // An already-typed error passes through untouched, so wrapping twice cannot relabel it.
  const already = classifyQwenFailure(new TypeError('fetch failed'));
  assert.equal(classifyQwenFailure(already, 'failed'), already);

  // The original is kept as `cause`, so the API log still has the stack.
  assert.ok(
    classifyQwenFailure(new TypeError('fetch failed')).cause instanceof Error,
  );
});

// ---------------------------------------------------------------------------
// The messages an officer actually reads
// ---------------------------------------------------------------------------

// A copy of `isOfficerReadable` from apps/web/lib/errorMessage.ts. Copied rather than
// imported because the direction of that dependency would be backwards — the browser must
// not be a build input of the engine — and asserted here because the consequence of failing
// it is SILENT: the officer is shown a canned "something went wrong" and the diagnosis this
// whole step exists to produce never reaches them. If the whitelist there is tightened, this
// is where the mismatch shows up.
const UNBREAKABLE_TOKEN = /\S{40,}/;
const DEVANAGARI = /[ऀ-ॿ]/;
const LOOKS_LIKE_CODE = new RegExp(
  [
    '[{}\\[\\]]',
    '::',
    ':\\/\\/',
    '\\bat\\s+\\w+\\s*\\(',
    '\\b(?:undefined|null|NaN|Object|TypeError|SyntaxError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|statusCode)\\b',
  ].join('|'),
);

test("every officer message survives the web's whitelist", () => {
  const kinds = Object.keys(QWEN_USER_MESSAGES) as QwenErrorKind[];
  assert.ok(kinds.length >= 5, 'expected a message for every kind');
  for (const kind of kinds) {
    const message = QWEN_USER_MESSAGES[kind];
    const text = message.trim();
    assert.ok(text.length > 0, `${kind}: empty`);
    assert.ok(
      text.length <= 240,
      `${kind}: ${text.length} characters, over the 240 cap`,
    );
    assert.ok(!message.includes('\n'), `${kind}: multi-line`);
    assert.ok(
      DEVANAGARI.test(text),
      `${kind}: no Devanagari, so it is replaced`,
    );
    assert.ok(
      !UNBREAKABLE_TOKEN.test(text),
      `${kind}: carries an unbreakable token`,
    );
    assert.ok(!LOOKS_LIKE_CODE.test(text), `${kind}: reads as machine output`);
    // Every one of them has to name a next move, or it is a status line rather than help.
    assert.match(text, /[।.?!]/, `${kind}: not a sentence`);
  }
});

test('each kind says something different, and a thrown error carries its own', () => {
  const messages = Object.values(QWEN_USER_MESSAGES);
  assert.equal(new Set(messages).size, messages.length);
  const error = classifyQwenFailure(new TypeError('fetch failed'));
  assert.equal(error.userMessage, QWEN_USER_MESSAGES.unreachable);
  assert.equal(error.name, 'QwenChatError');
  assert.ok(error instanceof Error);
  // The developer half is never the officer half: one is English detail, the other Marathi.
  assert.notEqual(error.message, error.userMessage);
});

// ---------------------------------------------------------------------------
// Cost: tokens counted, nothing billed
// ---------------------------------------------------------------------------
//
// The failure these guard against is silent and expensive to believe: priceText's
// unknown-model fallback prices an id it has never seen at gpt-5.6-terra rates, so a pod we
// rent by the hour would write an invented per-turn charge onto chat_messages.cost_usd. The
// assertions run the REAL code path — a cost scope around the real streamQwenChatReply —
// rather than the price table alone, because a correct table wired up wrongly reads the same
// from the outside.

async function runInScope(
  chunks: readonly string[],
  served: string = QWEN_DEFAULT_MODEL,
): Promise<{ acc: CostAccumulator; reply: QwenChatReply }> {
  // The stubbed pod serves whatever model the turn asks for, so these stay tests about
  // PRICING rather than re-testing step 5's preflight.
  const { restore } = stubFetch(chunks, {
    health: {
      status: 200,
      body: JSON.stringify({
        object: 'list',
        data: [{ id: served, object: 'model', max_model_len: 40_960 }],
      }),
    },
  });
  const acc = createCostAccumulator();
  try {
    const reply = await runInCostScope(acc, () =>
      runInCostTask('chat_reply', () =>
        streamQwenChatReply({
          turns: [{ role: 'user', content: 'नमस्कार' }],
          onDelta: () => {},
        }),
      ),
    );
    return { acc, reply };
  } finally {
    restore();
  }
}

const COST_CHUNKS = [
  contentFrame('उत्तर'),
  finishFrame('stop'),
  usageFrame(),
  'data: [DONE]\n\n',
] as const;

test('a Qwen turn counts its tokens and costs nothing', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { acc } = await runInScope(COST_CHUNKS);
  // Counted: how much work went through the pod is a real question.
  assert.equal(acc.chatCalls, 1);
  assert.equal(acc.inputTokens, 11);
  assert.equal(acc.outputTokens, 22);
  // Not billed. At the terra fallback this same usage would have been ~$0.0003 — small, but
  // it is a number the department never spent, and it accumulates one turn at a time.
  assert.equal(acc.textCostUsd, 0);
  assert.equal(totalCostUsd(acc), 0);
  // The route writes cost_usd only when it is > 0, so a zero leaves the column NULL rather
  // than asserting a measured ₹0.
  assert.ok(!(totalCostUsd(acc) > 0));
});

test('the analytics row is filed under qwen, not under openai', async () => {
  setEnv({ QWEN_BASE_URL: BASE });
  const { acc } = await runInScope(COST_CHUNKS);
  const rows = [...acc.taskUsage.values()];
  assert.equal(rows.length, 1);
  const row = rows[0] as CostTaskUsage;
  assert.equal(row.service, 'text');
  // Was hardcoded 'openai' before this step: a self-hosted turn reported as OpenAI's work.
  assert.equal(row.provider, 'qwen');
  assert.equal(row.model, QWEN_DEFAULT_MODEL);
  assert.equal(row.calls, 1);
  assert.equal(row.costUsd, 0);
  // Zero here is the absence of a rate, not a guess at one.
  assert.equal(row.costEstimated, false);
});

test('repointing QWEN_MODEL keeps the turn free', async () => {
  // The whole reason the row is keyed on the provider. vLLM serves whatever --model names,
  // and none of these appear in TEXT_PRICES_PER_1M — under a literal model row every one of
  // them would fall through to the terra fallback.
  for (const model of [
    'Qwen/Qwen3-32B',
    'Qwen/Qwen2.5-72B-Instruct',
    '/workspace/models/qwen3-finetune',
    'some-local-name',
  ]) {
    setEnv({ QWEN_BASE_URL: BASE, QWEN_MODEL: model });
    const { acc } = await runInScope(COST_CHUNKS, model);
    assert.equal(acc.textCostUsd, 0, `${model}: was billed`);
    assert.equal(acc.inputTokens, 11, `${model}: tokens not counted`);
    const row = [...acc.taskUsage.values()][0] as CostTaskUsage;
    assert.equal(row.model, model);
    assert.equal(row.provider, 'qwen');
  }
});

test('priceText zeroes on the provider alone, and still bills OpenAI', () => {
  // Free for any model the pod serves...
  assert.equal(
    priceText('anything-at-all', 1_000_000, 0, 1_000_000, 'qwen'),
    0,
  );
  assert.equal(priceText(QWEN_DEFAULT_MODEL, 500, 100, 900, 'qwen'), 0);
  // ...and unchanged for everyone else. The regression that matters is the opposite one:
  // that this step did not quietly zero the paid lanes.
  assert.equal(priceText('gpt-5.6-terra', 1_000_000, 0, 0, 'openai'), 2.5);
  assert.equal(priceText('gpt-5.6-terra', 0, 0, 1_000_000), 15);
  assert.equal(priceText('gpt-5.6-luna', 1_000_000, 0, 0), 1);
  // The unknown-model fallback is still terra, still erring high — the behaviour this row
  // exists to keep OFF the self-hosted lane, not to remove from the file.
  assert.equal(
    priceText('gpt-9-unreleased', 1_000_000, 0, 0),
    priceText('gpt-5.6-terra', 1_000_000, 0, 0),
  );
  // An unknown PROVIDER is billed, not zeroed: only a named self-hosted one is free, so a
  // typo in a future call site errs high rather than silently reporting free work.
  assert.equal(
    priceText(QWEN_DEFAULT_MODEL, 1_000_000, 0, 0, 'qwenn'),
    priceText('gpt-5.6-terra', 1_000_000, 0, 0),
  );
});

test('the lane passes the same literal the price table is keyed on', () => {
  // The one coupling this design has: a second copy of 'qwen' at the call site would drift
  // silently. Both sides read this constant, and the turn above proves it reaches the row.
  assert.equal(QWEN_COST_PROVIDER, 'qwen');
  assert.equal(priceText('x', 1_000_000, 0, 0, QWEN_COST_PROVIDER), 0);
});
