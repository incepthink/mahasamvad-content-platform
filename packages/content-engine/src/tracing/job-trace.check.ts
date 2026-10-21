// Free offline check of the live job tracer (Track B). No network beyond 127.0.0.1, no model
// spend, no Braintrust account. Run from packages/content-engine:
//
//   npx tsx src/tracing/job-trace.check.ts
//
// It proves the three "done means" properties that can be proved without a real run:
//   1. Tracing OFF changes nothing: the request bodies a local model server receives and the
//      results callers get are identical with tracing off and on.
//   2. Braintrust UNREACHABLE changes nothing: with the real SDK pointed at a dead address, a
//      traced job still completes with the same result and without a meaningful delay.
//   3. The TREE is right: root → step → model call (prompt, response, usage), guards with their
//      input and output, bytes as Attachments, a follow-up attached to the original root, and
//      no identity fields anywhere.

import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Attachment } from 'braintrust';
import { openAiFetch } from '../http/openai-request.js';
import { applyDesignations } from '../generation/apply-designations.js';
import {
  initJobTracing,
  openJobTrace,
  originalTraceRootId,
  setJobTraceLoggerForTests,
  traceEvent,
  traceFollowUp,
  traceGuard,
  traceModelCall,
  traceSpan,
  traceStep,
} from './job-trace.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? '');
  }
}

// ---------------------------------------------------------------------------
// A local "model server": answers chat completions as JSON or as an SSE stream, and records
// every request body exactly as it arrived.
// ---------------------------------------------------------------------------

const received: string[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => resolve(data));
  });
}

const server = createServer(async (request, response) => {
  const body = await readBody(request);
  received.push(body);
  const parsed = JSON.parse(body) as { stream?: boolean };
  if (parsed.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const piece of ['मुख्य', 'मंत्री ', 'यांनी']) {
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
      );
    }
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`,
    );
    response.end('data: [DONE]\n\n');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      choices: [{ message: { content: 'बातमी तयार.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    }),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const URL_ = `http://127.0.0.1:${port}/v1/chat/completions`;

const MESSAGES = [
  { role: 'system', content: 'तुम्ही शासकीय बातमी लिहिता.' },
  {
    role: 'user',
    content: 'टिपणी: मुख्यमंत्री देवेंद्र फडणवीस यांनी आढावा घेतला.',
  },
];

// The job body every scenario runs: one JSON call, one streamed call, one guard, one byte output.
async function job(): Promise<Record<string, unknown>> {
  traceStep('retrieve');
  const json = await (
    await openAiFetch(URL_, {
      label: 'chat',
      apiKey: 'test',
      body: { model: 'gpt-5.6-sol', messages: MESSAGES },
    })
  ).json();
  traceStep('draft');
  const streamed = await (
    await openAiFetch(URL_, {
      label: 'chat',
      apiKey: 'test',
      body: { model: 'gpt-5.6-sol', messages: MESSAGES, stream: true },
    })
  ).text();
  const designated = applyDesignations('देवेंद्र फडणवीस यांनी आढावा घेतला.', [
    { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' },
  ]);
  const picked = traceGuard('guard: pick', { n: 3 }, () => 3 * 2);
  const decided = await traceSpan('decision: test', async () => 'A', {
    input: { q: 1 },
  });
  const png = await traceModelCall(
    { name: 'gpt-image edit', provider: 'openai', input: { prompt: 'p' } },
    async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]),
    (bytes) => ({ image: bytes }),
  );
  traceEvent('note', { output: { ok: true } });
  return {
    json,
    streamed,
    designated: designated.text,
    picked,
    decided,
    png: [...png],
  };
}

// ---------------------------------------------------------------------------
// A recording logger with the surface job-trace.ts uses.
// ---------------------------------------------------------------------------

type Recorded = {
  id: number;
  parent: number | null;
  args: Record<string, unknown>;
  logs: Record<string, unknown>[];
  ended: boolean;
};
const spans: Recorded[] = [];
let nextId = 0;
function fakeSpan(
  parent: number | null,
  args: Record<string, unknown>,
): unknown {
  const record: Recorded = {
    id: nextId++,
    parent,
    args,
    logs: [],
    ended: false,
  };
  spans.push(record);
  return {
    startSpan: (child: Record<string, unknown>) => fakeSpan(record.id, child),
    log: (event: Record<string, unknown>) => record.logs.push(event),
    end: () => {
      record.ended = true;
    },
  };
}
const fakeLogger = {
  startSpan: (args: Record<string, unknown>) => fakeSpan(null, args),
  flush: async () => undefined,
};

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

// --- 1. OFF -----------------------------------------------------------------------------------
console.log('tracing off');
check(
  'initJobTracing is off without BRAINTRUST_TRACING',
  !initJobTracing(() => undefined),
);
received.length = 0;
const offTrace = openJobTrace({
  feature: 'dlo',
  task: 'article_generation',
  rowKind: 'generation',
  rowId: 'g1',
  original: true,
});
check('openJobTrace is a no-op', offTrace.rootSpanId === '');
const offResult = await offTrace.run(job);
const offBodies = [...received];

// --- 3. ON (recording logger) -----------------------------------------------------------------
console.log('tracing on (recording logger)');
setJobTraceLoggerForTests(fakeLogger);
received.length = 0;
const rowId = '11111111-2222-3333-4444-555555555555';
const onTrace = openJobTrace({
  feature: 'dlo',
  task: 'article_generation',
  rowKind: 'generation',
  rowId,
  original: true,
  input: { note: 'टिपणी', poster: Buffer.from([0xff, 0xd8, 1, 2]) },
  metadata: { generationId: rowId },
});
const onResult = await onTrace.run(job);
onTrace.finish({
  output: { article: onResult.designated },
  metadata: { costUsd: 0.01 },
});
traceFollowUp('generation', rowId, 'officer: poster_download', {
  action: 'poster_download',
  status: 'success',
});
await settle();
const onBodies = [...received];

check(
  'results identical with tracing on and off',
  JSON.stringify(onResult) === JSON.stringify(offResult),
);
check(
  'request bodies byte-identical on and off',
  JSON.stringify(onBodies) === JSON.stringify(offBodies) &&
    onBodies.length === 2,
);

const root = spans.find(
  (s) =>
    s.parent === null &&
    (s.args.parentSpanIds as { parentSpanIds?: unknown[] })?.parentSpanIds
      ?.length === 0,
);
check(
  'root span opened with the deterministic id',
  root?.args.spanId === originalTraceRootId('generation', rowId),
);
check(
  'root metadata marks a live trace',
  (root?.args.event as { metadata?: Record<string, unknown> })?.metadata
    ?.reconstructed === false,
);
check(
  'root input bytes became an Attachment',
  (root?.args.event as { input?: Record<string, unknown> })?.input
    ?.poster instanceof Attachment,
);
check(
  'root closed with output and status',
  root?.ended === true &&
    root.logs.some(
      (l) =>
        (l.metadata as Record<string, unknown>)?.status === 'completed' &&
        l.output,
    ),
);

const steps = spans.filter((s) => String(s.args.name).startsWith('step: '));
check(
  'one span per step, children of the root',
  steps.length === 2 && steps.every((s) => s.parent === root?.id),
);
const llm = spans.filter(
  (s) => s.args.type === 'llm' && String(s.args.name).startsWith('127.0.0.1'),
);
check(
  'two model-call spans, under their steps',
  llm.length === 2 &&
    llm[0]!.parent === steps[0]!.id &&
    llm[1]!.parent === steps[1]!.id,
);
const llmInput = (llm[0]?.args.event as { input?: { messages?: unknown } })
  ?.input;
check(
  'model-call span carries the full prompt',
  JSON.stringify(llmInput?.messages) === JSON.stringify(MESSAGES),
);
const jsonOut = llm[0]?.logs.find((l) => l.output)?.output as
  { content?: string } | undefined;
check(
  'model-call span carries the response',
  jsonOut?.content === 'बातमी तयार.',
);
const streamOut = llm[1]?.logs.find((l) => l.output)?.output as
  { content?: string } | undefined;
check(
  'streamed response re-assembled',
  streamOut?.content === 'मुख्यमंत्री यांनी',
);
check(
  'usage recorded as metrics',
  (llm[0]?.logs.find((l) => l.metrics)?.metrics as Record<string, number>)
    ?.prompt_tokens === 20,
);
check(
  'model-call spans ended',
  llm.every((s) => s.ended),
);

const designation = spans.find(
  (s) => s.args.name === 'guard: applyDesignations',
);
check(
  'applyDesignations traced with its input',
  (designation?.args.event as { input?: { article?: string } })?.input
    ?.article === 'देवेंद्र फडणवीस यांनी आढावा घेतला.',
);
check(
  'applyDesignations traced with its output',
  (designation?.logs[0]?.output as { text?: string })?.text?.startsWith(
    'मुख्यमंत्री देवेंद्र फडणवीस',
  ) === true,
);
const guard = spans.find((s) => s.args.name === 'guard: pick');
check('a guard span records output', guard?.logs[0]?.output === 6);
const image = spans.find((s) => s.args.name === 'gpt-image edit');
check(
  'image output became an Attachment',
  (image?.logs.find((l) => l.output)?.output as { image?: unknown })
    ?.image instanceof Attachment,
);

const follow = spans.find((s) => s.args.name === 'officer: poster_download');
const followParent = follow?.args.parentSpanIds as
  { spanId?: string; rootSpanId?: string } | undefined;
check(
  'follow-up attached to the original root by derived id',
  followParent?.rootSpanId === originalTraceRootId('generation', rowId) &&
    followParent?.spanId === followParent?.rootSpanId,
);

const everything = JSON.stringify(spans.map((s) => [s.args, s.logs]));
check(
  'no identity fields anywhere',
  !/"(ip|deviceId|device_id|userAgent|user_agent)"/.test(everything),
);

// A follow-up job is its own trace, linked both ways.
spans.length = 0;
const followJob = openJobTrace({
  feature: 'dlo',
  task: 'article_revision',
  rowKind: 'generation',
  rowId,
  original: false,
});
followJob.finish({});
const followRoot = spans.find(
  (s) =>
    (s.args.event as { metadata?: Record<string, unknown> })?.metadata?.task ===
    'article_revision',
);
check(
  'follow-up job gets its own root',
  followRoot !== undefined &&
    followRoot.args.spanId !== originalTraceRootId('generation', rowId),
);
check(
  'follow-up job links to the original',
  (followRoot?.args.event as { metadata?: Record<string, unknown> })?.metadata
    ?.originalTraceRootId === originalTraceRootId('generation', rowId),
);
check(
  'original gets a pointer span to the follow-up',
  spans.some((s) => s.args.name === 'follow-up job: article_revision'),
);

// A tracer that throws must not reach the job.
setJobTraceLoggerForTests({
  startSpan: () => {
    throw new Error('braintrust exploded');
  },
  flush: async () => undefined,
});
received.length = 0;
const brokenResult = await openJobTrace({
  feature: 'dlo',
  task: 'article_generation',
  rowKind: 'generation',
  rowId: 'g2',
  original: true,
}).run(job);
check(
  'a throwing logger cannot change the job',
  JSON.stringify(brokenResult) === JSON.stringify(offResult),
);

// --- 2. UNREACHABLE (real SDK, dead address) ---------------------------------------------------
console.log('tracing on, Braintrust unreachable');
setJobTraceLoggerForTests(null);
process.env.BRAINTRUST_TRACING = 'on';
process.env.BRAINTRUST_API_KEY = 'test-key-not-real';
process.env.BRAINTRUST_APP_URL = 'http://127.0.0.1:1';
process.env.BRAINTRUST_TRACE_PROJECT = 'mahasamvad-traces-check';
check(
  'initJobTracing starts with the real SDK',
  initJobTracing(() => undefined),
);
received.length = 0;
const started = Date.now();
const deadResult = await openJobTrace({
  feature: 'dlo',
  task: 'article_generation',
  rowKind: 'generation',
  rowId: 'g3',
  original: true,
}).run(job);
const elapsed = Date.now() - started;
check(
  'job completes with the same result',
  JSON.stringify(deadResult) === JSON.stringify(offResult),
);
check(
  'request bodies unchanged',
  JSON.stringify(received) === JSON.stringify(offBodies),
);
check(`no meaningful delay (${elapsed} ms)`, elapsed < 2_000);

server.close();
console.log(
  failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`,
);
// The real SDK keeps retrying its flush against the dead address in the background; that is the
// behaviour under test, not something to wait for.
process.exit(failures === 0 ? 0 : 1);
