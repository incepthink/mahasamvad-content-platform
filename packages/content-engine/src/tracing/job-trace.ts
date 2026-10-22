// Live job traces in Braintrust (error analysis, Track B — docs/evals-error-analysis.md).
//
// ONE USER-FACING JOB = ONE TRACE. A job runner (runJob and its siblings in apps/api) opens a
// trace with openJobTrace and runs the job body inside `trace.run(...)`. Everything the job does
// inside that scope — steps, model calls, decisions, deterministic guards — lands as a child span
// of that trace. The context rides an AsyncLocalStorage exactly like the cost meter's, so it
// follows the JOB (detached `void (async () => …)()`, SSE turns, concurrent feedback jobs), never
// the HTTP request.
//
// THE CONTRACT, in the order it matters:
//   1. NEVER CHANGE THE JOB. Every function here returns exactly what the wrapped code returned,
//      rethrows exactly what it threw, and swallows every error of its own. Nothing here touches
//      a request body: model calls are OBSERVED (a cloned response is read in the background),
//      never rewritten, so a prompt is byte-for-byte the same with tracing on or off.
//   2. NEVER SLOW THE JOB. Logging is synchronous and buffered by the SDK's background logger
//      (asyncFlush); reading a cloned response happens after the caller has its own copy.
//      Braintrust being unreachable costs a log line, never a failed or delayed run.
//   3. OFF UNLESS THE SERVER ASKS. initJobTracing() must be CALLED (apps/api does, at boot) and
//      the env must say so. A harness or offline script that loads the same .env never calls it,
//      so it never traces — that is how test and harness runs stay out of the project.
//   4. NO IDENTITY. Nothing here reads a request; callers pass row data and officer actions only.
//      IP addresses and device ids must never be handed to any function in this file.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Attachment, initLogger, type Logger, type Span } from 'braintrust';
import { setModelCallObserver } from '@dgipr/poster-renderer';
import { stableUuid } from '../evals/trace.js';
import { priceText } from '../cost/pricing.js';

type SpanKind = 'task' | 'llm' | 'tool' | 'function';

type TraceCtx = {
  readonly root: Span;
  readonly rootSpanId: string;
  stepSpan: Span | null;
  stepName: string | null;
  ended: boolean;
};

type Frame = Readonly<{ ctx: TraceCtx; parent: Span | null }>;

const storage = new AsyncLocalStorage<Frame>();

let logger: Logger<true> | null = null;
let projectName: string | null = null;

// Attachments larger than this are replaced by a note saying so — a 200 MB recording is not
// something a reviewer needs inline, and it is not worth the upload.
const MAX_ATTACHMENT_BYTES = Number(
  process.env.BRAINTRUST_TRACE_MAX_ATTACHMENT_BYTES ?? 25 * 1024 * 1024,
);
// A single logged string beyond this is cut, with a note. A whole meeting transcript is ~100k
// characters, so this only ever bites on genuinely pathological payloads.
const MAX_STRING_CHARS = 400_000;

function quietly(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    // Tracing must never surface. One line, so a broken setup is still noticeable in the log.
    console.warn(
      `[trace] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function envOn(value: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test((value ?? '').trim());
}

// THE SDK NEVER RETRIES A FAILED LOGIN. A logger logs in lazily on its first flush, and the
// SDK caches that promise — including a REJECTED one. So one network blip at that moment
// ("fetch failed") makes every later batch from this logger fail the same way and be dropped,
// silently, until the process restarts (seen 2026-10-21: 46 spans dropped, none sent). So the
// login is checked here, and a logger whose login failed is replaced by a fresh one.
const LOGIN_RETRY_MS = 30_000;

function createLogger(apiKey: string): Logger<true> {
  return initLogger({
    projectName: projectName!,
    apiKey,
    asyncFlush: true,
    setCurrent: false,
  });
}

function watchLogin(current: Logger<true>, apiKey: string): void {
  quietly(() => {
    void current.id.catch((error: unknown) => {
      if (logger !== current) return;
      console.warn(
        `[trace] Braintrust login failed (${errorText(error)}); spans are being dropped — retrying in ${LOGIN_RETRY_MS / 1000}s`,
      );
      const timer = setTimeout(() => {
        if (logger !== current) return;
        quietly(() => {
          logger = createLogger(apiKey);
          watchLogin(logger, apiKey);
        });
      }, LOGIN_RETRY_MS);
      timer.unref?.();
    });
  });
}

// Called once by the API process at boot. Returns whether tracing is active. Never throws.
export function initJobTracing(
  log: (line: string) => void = console.log,
): boolean {
  if (logger) return true;
  try {
    const apiKey = process.env.BRAINTRUST_API_KEY?.trim();
    if (!envOn(process.env.BRAINTRUST_TRACING) || !apiKey) {
      log('[trace] Braintrust job tracing is off');
      return false;
    }
    projectName =
      process.env.BRAINTRUST_TRACE_PROJECT?.trim() || 'mahasamvad-traces-dev';
    logger = createLogger(apiKey);
    // Log in now rather than at the first job, so a failure is found and repaired early.
    watchLogin(logger, apiKey);
    setModelCallObserver(observeModelCall);
    log(`[trace] Braintrust job tracing on → project ${projectName}`);
    return true;
  } catch (error) {
    logger = null;
    console.warn('[trace] could not start Braintrust tracing:', error);
    return false;
  }
}

// Test seam for tracing/job-trace.check.ts: install a recording logger (or null to switch
// tracing off again). Never called by the product.
export function setJobTraceLoggerForTests(next: unknown): void {
  logger = next as Logger<true> | null;
  setModelCallObserver(next ? observeModelCall : null);
}

export function jobTracingEnabled(): boolean {
  return logger !== null;
}

// Push buffered spans out — for a graceful shutdown. Never throws.
export async function flushJobTraces(): Promise<void> {
  try {
    await logger?.flush();
  } catch (error) {
    console.warn('[trace] flush failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Making values safe to log: bytes become Attachments, base64 data URLs become Attachments,
// embedding vectors become a count. The VALUE passed in is never mutated — this builds a copy.
// ---------------------------------------------------------------------------

function sniffContentType(bytes: Uint8Array): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return 'application/pdf';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    return b[8] === 0x57 && b[9] === 0x45 ? 'image/webp' : 'audio/wav';
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)
    return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return 'video/webm';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  return 'application/octet-stream';
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

let attachmentCounter = 0;

// Turn bytes into a Braintrust Attachment (or a note when too large). Exported so the API can
// attach a poster it downloaded.
export function traceAttachment(
  bytes: Uint8Array,
  filename?: string,
  contentType?: string,
): unknown {
  const type = contentType ?? sniffContentType(bytes);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return {
      attachmentOmitted: `larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1_048_576)} MB`,
      contentType: type,
      bytes: bytes.byteLength,
    };
  }
  const name =
    filename ?? `file-${++attachmentCounter}.${EXTENSIONS[type] ?? 'bin'}`;
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Attachment({ data, filename: name, contentType: type });
}

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,/i;

function cleanString(value: string, key: string | undefined): unknown {
  const match = DATA_URL.exec(value);
  if (match && value.length > 256) {
    return traceAttachment(
      Buffer.from(value.slice(match[0].length), 'base64'),
      undefined,
      match[1]!.toLowerCase(),
    );
  }
  // A bare base64 image payload (gpt-image's b64_json, Gemini inline_data.data).
  if (
    (key === 'b64_json' || key === 'data') &&
    value.length > 4096 &&
    /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 2048))
  ) {
    return traceAttachment(Buffer.from(value, 'base64'));
  }
  if (value.length > MAX_STRING_CHARS) {
    return `${value.slice(0, MAX_STRING_CHARS)}\n…[trace: ${value.length - MAX_STRING_CHARS} more characters not logged]`;
  }
  return value;
}

export function toTraceValue(value: unknown, key?: string): unknown {
  return clean(value, key, 0, new WeakSet());
}

function clean(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cleanString(value, key);
  if (typeof value !== 'object') return value;
  if (value instanceof Attachment) return value;
  if (value instanceof Uint8Array) return traceAttachment(value);
  if (value instanceof ArrayBuffer)
    return traceAttachment(new Uint8Array(value));
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { blob: value.type || 'binary', bytes: value.size };
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const fields: Record<string, unknown> = {};
    value.forEach((item, name) => {
      fields[name] =
        typeof item === 'string'
          ? cleanString(item, name)
          : { file: (item as File).name ?? 'blob', bytes: item.size };
    });
    return fields;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map)
    return clean(Object.fromEntries(value), key, depth, seen);
  if (value instanceof Set) return clean([...value], key, depth, seen);
  if (depth > 14) return '[trace: nested too deep]';
  if (seen.has(value)) return '[trace: already shown above]';
  seen.add(value);
  // A client, a stream or any other class instance is not data a reviewer can read — and
  // walking one (a database client, say) would log its internals. Name it instead.
  const proto = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && proto !== null && proto !== Object.prototype) {
    return `[${(value as { constructor?: { name?: string } }).constructor?.name ?? 'object'}]`;
  }
  if (Array.isArray(value)) {
    // An embedding vector, or any long run of numbers, is noise to a reviewer.
    if (value.length > 64 && value.every((item) => typeof item === 'number')) {
      return `[${value.length} numbers]`;
    }
    return value.map((item) => clean(item, key, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || typeof item === 'function') continue;
    out[name] = clean(item, name, depth + 1, seen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Opening a job trace.
// ---------------------------------------------------------------------------

export type JobTraceOpen = Readonly<{
  // Sidebar feature, the filter key every Braintrust view uses: creative | dlo | transcribe |
  // translate | proofread | chat | new-video | storyboard | video | references.
  feature: string;
  // What this job is, e.g. 'social_post_creation', 'article_revision'.
  task: string;
  // The row this job works on ('generation' | 'dlo_intake' | 'transcription' | …) and its id.
  rowKind: string;
  rowId: string | null;
  // True only for the job that CREATED the row's first output. That trace gets a deterministic
  // root id, so any later event on the row (a redo, a download, a feedback round) can attach a
  // "what happened next" span to it without the id having been stored anywhere.
  original: boolean;
  // A follow-up job (original: false) whose row's ORIGINAL trace is known to exist: open this
  // job as a child span INSIDE that trace instead of as a trace of its own, so a run and every
  // feedback round, redo and translation on it read as one tree. Only set it when the original
  // was traced — a child of a root that was never logged is invisible in the Braintrust list.
  nestUnderOriginal?: boolean;
  name?: string;
  input?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type JobTrace = Readonly<{
  // Braintrust root span id of this trace ('' when tracing is off).
  rootSpanId: string;
  // Run the job body inside this trace. With tracing off this is exactly `fn()`.
  run<T>(fn: () => Promise<T>): Promise<T>;
  // Replace the root's input — for media resolved in the background after the job started.
  setInput(input: Readonly<Record<string, unknown>>): void;
  // Merge more metadata into the root (settings decided mid-job, warnings, …).
  annotate(metadata: Readonly<Record<string, unknown>>): void;
  // Log the final output and metadata and close the root. Idempotent.
  finish(
    result: Readonly<{
      output?: Readonly<Record<string, unknown>>;
      metadata?: Readonly<Record<string, unknown>>;
      error?: unknown;
    }>,
  ): void;
}>;

const NOOP_TRACE: JobTrace = {
  rootSpanId: '',
  run: (fn) => fn(),
  setInput: () => undefined,
  annotate: () => undefined,
  finish: () => undefined,
};

// The deterministic id of a row's ORIGINAL trace. This is the row-id → trace-id mapping: a
// function, not a table, so it survives restarts and needs no migration.
export function originalTraceRootId(rowKind: string, rowId: string): string {
  return stableUuid(`live:${rowKind}:${rowId}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function openJobTrace(open: JobTraceOpen): JobTrace {
  if (!logger) return NOOP_TRACE;
  try {
    const rowId = open.rowId ?? randomUUID();
    const nested =
      !open.original && open.nestUnderOriginal === true && open.rowId !== null;
    const originalRootId = open.rowId
      ? originalTraceRootId(open.rowKind, open.rowId)
      : null;
    // This job's own span id. For a nested follow-up it is a child of the original root, and
    // the TRACE it belongs to is the original's.
    const spanId = open.original
      ? originalTraceRootId(open.rowKind, rowId)
      : stableUuid(
          `live:${open.rowKind}:${rowId}:${open.task}:${randomUUID()}`,
        );
    const rootSpanId = nested ? originalRootId! : spanId;
    const started = Date.now();
    const root = logger.startSpan({
      name: open.name ?? `${open.feature}: ${open.task}`,
      type: 'task',
      spanId,
      // An empty parent list with an explicit root id makes this span the trace root under an id
      // we chose, rather than one the SDK generated. A nested follow-up instead names the
      // original root as both its parent and its trace.
      parentSpanIds: nested
        ? { spanId: rootSpanId, rootSpanId }
        : { parentSpanIds: [], rootSpanId },
      event: {
        ...(open.original ? { id: `live:${open.rowKind}:${rowId}` } : {}),
        input: toTraceValue(open.input ?? {}),
        metadata: {
          feature: open.feature,
          task: open.task,
          rowKind: open.rowKind,
          ...(open.rowId ? { rowId: open.rowId } : {}),
          reconstructed: false,
          original: open.original,
          ...(nested ? { followUp: true } : {}),
          ...(open.original || !open.rowId
            ? {}
            : {
                originalTraceRootId: originalTraceRootId(
                  open.rowKind,
                  open.rowId,
                ),
              }),
          ...(toTraceValue(open.metadata ?? {}) as Record<string, unknown>),
        },
      },
    });
    const ctx: TraceCtx = {
      root,
      rootSpanId,
      stepSpan: null,
      stepName: null,
      ended: false,
    };

    // A follow-up job that is its own trace is linked both ways: metadata above points at the
    // original, and this span in the original points at the follow-up. A nested one needs no
    // pointer — it IS inside the original.
    if (!open.original && !nested && open.rowId) {
      traceFollowUp(open.rowKind, open.rowId, `follow-up job: ${open.task}`, {
        task: open.task,
        followUpTraceRootId: rootSpanId,
      });
    }

    return {
      rootSpanId,
      run: (fn) => storage.run({ ctx, parent: null }, fn),
      setInput: (input) =>
        quietly(() => {
          if (!ctx.ended) root.log({ input: toTraceValue(input) });
        }),
      annotate: (metadata) =>
        quietly(() =>
          root.log({
            metadata: toTraceValue(metadata) as Record<string, unknown>,
          }),
        ),
      finish: ({ output, metadata, error }) =>
        quietly(() => {
          if (ctx.ended) return;
          ctx.ended = true;
          if (ctx.stepSpan) ctx.stepSpan.end();
          root.log({
            ...(output ? { output: toTraceValue(output) } : {}),
            ...(error !== undefined ? { error: errorText(error) } : {}),
            metadata: {
              ...(toTraceValue(metadata ?? {}) as Record<string, unknown>),
              status: error !== undefined ? 'failed' : 'completed',
              latencyMs: Date.now() - started,
            },
          });
          root.end();
        }),
    };
  } catch (error) {
    console.warn('[trace] could not open a job trace:', error);
    return NOOP_TRACE;
  }
}

// "What happened next": attach a span to a row's ORIGINAL trace from anywhere — a route that
// logged a download, a publish, a hand edit, the start of a feedback round. Action and status
// only; callers must never pass identity. Never throws.
export function traceFollowUp(
  rowKind: string,
  rowId: string,
  name: string,
  output: Readonly<Record<string, unknown>>,
): void {
  if (!logger) return;
  quietly(() => {
    const rootSpanId = originalTraceRootId(rowKind, rowId);
    const span = logger!.startSpan({
      name,
      type: 'function',
      parentSpanIds: { spanId: rootSpanId, rootSpanId },
      event: {
        output: toTraceValue(output),
        metadata: { followUp: true, rowKind, rowId },
      },
    });
    span.end();
  });
}

// ---------------------------------------------------------------------------
// Spans inside a job.
// ---------------------------------------------------------------------------

function parentSpan(frame: Frame): Span {
  return frame.parent ?? frame.ctx.stepSpan ?? frame.ctx.root;
}

// The job moved to a new pipeline step ('retrieve', 'draft', 'copy', 'image', …). Ends the
// previous step span; later spans nest under the new one. No-op outside a trace.
export function traceStep(step: string): void {
  const frame = storage.getStore();
  if (!frame || frame.ctx.ended) return;
  quietly(() => {
    const ctx = frame.ctx;
    if (ctx.stepName === step) return;
    ctx.stepSpan?.end();
    ctx.stepName = step;
    ctx.stepSpan = ctx.root.startSpan({
      name: `step: ${step}`,
      type: 'task',
      event: { metadata: { step } },
    });
  });
}

// Merge metadata into the current job's ROOT span (e.g. "the reference chosen", a warning).
export function traceAnnotateJob(
  metadata: Readonly<Record<string, unknown>>,
): void {
  const frame = storage.getStore();
  if (!frame || frame.ctx.ended) return;
  quietly(() =>
    frame.ctx.root.log({
      metadata: toTraceValue(metadata) as Record<string, unknown>,
    }),
  );
}

type SpanOptions<T> = Readonly<{
  type?: SpanKind;
  input?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
  // What to log as the output. Defaults to the result itself.
  describe?: (result: T) => unknown;
}>;

function startChild(
  frame: Frame,
  name: string,
  type: SpanKind,
  input: unknown,
  metadata?: Readonly<Record<string, unknown>>,
): Span | null {
  try {
    return parentSpan(frame).startSpan({
      name,
      type,
      event: {
        ...(input !== undefined ? { input: toTraceValue(input) } : {}),
        ...(metadata
          ? { metadata: toTraceValue(metadata) as Record<string, unknown> }
          : {}),
      },
    });
  } catch (error) {
    console.warn('[trace] could not start a span:', error);
    return null;
  }
}

// Wrap an async step — a decision (reference selection, design director, interpreter) or any
// other unit worth seeing. Returns fn's result unchanged; rethrows fn's error unchanged.
export async function traceSpan<T>(
  name: string,
  fn: () => Promise<T>,
  options: SpanOptions<T> = {},
): Promise<T> {
  const frame = storage.getStore();
  if (!frame) return fn();
  const span = startChild(
    frame,
    name,
    options.type ?? 'function',
    options.input,
    options.metadata,
  );
  if (!span) return fn();
  const started = Date.now();
  try {
    const result = await storage.run({ ctx: frame.ctx, parent: span }, fn);
    quietly(() =>
      span.log({
        output: toTraceValue(
          options.describe ? options.describe(result) : result,
        ),
        metadata: { latencyMs: Date.now() - started },
      }),
    );
    return result;
  } catch (error) {
    quietly(() =>
      span.log({
        error: errorText(error),
        metadata: { latencyMs: Date.now() - started },
      }),
    );
    throw error;
  } finally {
    quietly(() => span.end());
  }
}

// Synchronous twin for the deterministic guards (applyDesignations, enforceCapacity, …). The
// input is what went in and the output what came out, so a guard that silently dropped or
// rewrote something is visible. `input` may be a thunk, so a guard pays nothing to describe
// itself when no trace is active. Returns fn's result unchanged.
export function traceGuard<T>(
  name: string,
  input: unknown,
  fn: () => T,
  describe?: (result: T) => unknown,
): T {
  const frame = storage.getStore();
  if (!frame) return fn();
  let resolved: unknown;
  try {
    resolved = typeof input === 'function' ? (input as () => unknown)() : input;
  } catch {
    resolved = '[trace: input could not be described]';
  }
  const span = startChild(frame, name, 'function', resolved, { guard: true });
  if (!span) return fn();
  try {
    const result = fn();
    quietly(() =>
      span.log({ output: toTraceValue(describe ? describe(result) : result) }),
    );
    return result;
  } catch (error) {
    quietly(() => span.log({ error: errorText(error) }));
    throw error;
  } finally {
    quietly(() => span.end());
  }
}

// Async guard (fitArticleToLength): same contract, input may be a thunk.
export function traceAsyncGuard<T>(
  name: string,
  input: unknown,
  fn: () => Promise<T>,
  describe?: (result: T) => unknown,
): Promise<T> {
  const frame = storage.getStore();
  if (!frame) return fn();
  let resolved: unknown;
  try {
    resolved = typeof input === 'function' ? (input as () => unknown)() : input;
  } catch {
    resolved = '[trace: input could not be described]';
  }
  return traceSpan(name, fn, {
    input: resolved,
    metadata: { guard: true },
    ...(describe ? { describe } : {}),
  });
}

// An already-finished event (input and output both known) — e.g. a guard whose call site is
// awkward to wrap, or a decision recorded from its result.
export function traceEvent(
  name: string,
  event: Readonly<{
    type?: SpanKind;
    input?: unknown;
    output?: unknown;
    metadata?: Readonly<Record<string, unknown>>;
  }>,
): void {
  const frame = storage.getStore();
  if (!frame) return;
  const span = startChild(
    frame,
    name,
    event.type ?? 'function',
    event.input,
    event.metadata,
  );
  if (!span) return;
  quietly(() => {
    if (event.output !== undefined)
      span.log({ output: toTraceValue(event.output) });
    span.end();
  });
}

// ---------------------------------------------------------------------------
// Model calls.
// ---------------------------------------------------------------------------

// Generic wrapper for a model call that does NOT go through openAiFetch (gpt-image, Gemini,
// Sarvam, ElevenLabs, Kling, Veo). Same contract as traceSpan, typed 'llm'.
export function traceModelCall<T>(
  info: Readonly<{
    name: string;
    provider: string;
    model?: string;
    input: unknown;
  }>,
  fn: () => Promise<T>,
  describe?: (result: T) => unknown,
): Promise<T> {
  return traceSpan(info.name, fn, {
    type: 'llm',
    input: info.input,
    metadata: {
      provider: info.provider,
      ...(info.model ? { model: info.model } : {}),
    },
    ...(describe ? { describe } : {}),
  });
}

// The observer registered with @dgipr/poster-renderer (which cannot import this package).
function observeModelCall<T>(
  info: Readonly<{
    name: string;
    provider: string;
    model: string;
    input: Readonly<Record<string, unknown>>;
  }>,
  run: () => Promise<T>,
  describe: (result: T) => unknown,
): Promise<T> {
  return traceModelCall(info, run, describe);
}

type Usage = Readonly<{
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
}>;

// Read what the model said out of a JSON response (Chat Completions, Responses, embeddings).
function summarizeJson(body: Record<string, unknown>): {
  output: unknown;
  usage?: Usage;
} {
  const usage = body.usage as Usage | undefined;
  const choices = body.choices as
    | Array<{
        message?: { content?: unknown; tool_calls?: unknown };
        finish_reason?: unknown;
      }>
    | undefined;
  if (Array.isArray(choices)) {
    const first = choices[0];
    return {
      output: {
        content: first?.message?.content ?? null,
        ...(first?.message?.tool_calls
          ? { toolCalls: first.message.tool_calls }
          : {}),
        finishReason: first?.finish_reason ?? null,
      },
      ...(usage ? { usage } : {}),
    };
  }
  if (typeof body.output_text === 'string' || Array.isArray(body.output)) {
    const text =
      typeof body.output_text === 'string'
        ? body.output_text
        : (body.output as Array<{ content?: Array<{ text?: string }> }>)
            .flatMap((item) => item.content ?? [])
            .map((part) => part.text ?? '')
            .join('');
    return {
      output: {
        content: text,
        status: body.status ?? null,
        output: body.output,
      },
      ...(usage ? { usage } : {}),
    };
  }
  return { output: body, ...(usage ? { usage } : {}) };
}

// Re-assemble a streamed answer (Chat Completions deltas or Responses events) from SSE text.
function summarizeStream(text: string): { output: unknown; usage?: Usage } {
  let content = '';
  let usage: Usage | undefined;
  let finishReason: unknown = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const event = JSON.parse(payload) as {
        choices?: Array<{
          delta?: { content?: unknown };
          finish_reason?: unknown;
        }>;
        type?: unknown;
        delta?: unknown;
        usage?: Usage;
        response?: { usage?: Usage };
      };
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      if (event.choices?.[0]?.finish_reason)
        finishReason = event.choices[0].finish_reason;
      if (
        event.type === 'response.output_text.delta' &&
        typeof event.delta === 'string'
      ) {
        content += event.delta;
      }
      if (event.usage) usage = event.usage;
      if (event.response?.usage) usage = event.response.usage;
    } catch {
      // A partial or non-JSON frame: nothing to read from it.
    }
  }
  return {
    output: { content, finishReason, streamed: true },
    ...(usage ? { usage } : {}),
  };
}

function providerOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('openai.com')) return 'openai';
    if (host.includes('runpod')) return 'runpod';
    return host;
  } catch {
    return 'unknown';
  }
}

// Observe one openAiFetch call. Called by the transport with the request it is about to send
// and a thunk that sends it. The request is passed through untouched; the response handed back
// is the caller's own — a clone is read in the background for the log.
export async function traceOpenAiHttp(
  request: Readonly<{
    url: string;
    label: string;
    method: string;
    body?: unknown;
    formData?: FormData;
  }>,
  send: () => Promise<Response>,
): Promise<Response> {
  const frame = storage.getStore();
  if (!frame) return send();
  const body = request.body as Record<string, unknown> | undefined;
  const model = typeof body?.model === 'string' ? body.model : undefined;
  const provider = providerOf(request.url);
  const span = startChild(
    frame,
    `${provider} ${request.label}${model ? ` (${model})` : ''}`,
    'llm',
    request.formData ?? body ?? { method: request.method, url: request.url },
    {
      provider,
      ...(model ? { model } : {}),
      endpoint: request.url.replace(/^https?:\/\/[^/]+/, ''),
      method: request.method,
    },
  );
  if (!span) return send();
  const started = Date.now();
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    quietly(() => {
      span.log({
        error: errorText(error),
        metadata: { latencyMs: Date.now() - started },
      });
      span.end();
    });
    throw error;
  }
  let copy: Response | null = null;
  try {
    copy = response.clone();
  } catch {
    copy = null;
  }
  const headersAt = Date.now();
  void (async () => {
    try {
      const text = copy ? await copy.text() : '';
      const streamed =
        (body as { stream?: unknown } | undefined)?.stream === true ||
        (response.headers.get('content-type') ?? '').includes('event-stream');
      let summary: { output: unknown; usage?: Usage };
      if (streamed) summary = summarizeStream(text);
      else {
        try {
          summary = summarizeJson(JSON.parse(text) as Record<string, unknown>);
        } catch {
          summary = { output: text.slice(0, 2000) };
        }
      }
      const usage = summary.usage;
      const input = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
      const cached =
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.input_tokens_details?.cached_tokens ??
        0;
      const output = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
      span.log({
        output: toTraceValue(summary.output),
        metrics: usage
          ? {
              prompt_tokens: input,
              completion_tokens: output,
              tokens: input + output,
            }
          : {},
        metadata: {
          status: response.status,
          latencyMs: Date.now() - started,
          timeToHeadersMs: headersAt - started,
          ...(usage && model && provider === 'openai'
            ? { costUsd: priceText(model, input, cached, output) }
            : {}),
        },
      });
    } catch (error) {
      quietly(() =>
        span.log({ metadata: { traceReadError: errorText(error) } }),
      );
    } finally {
      quietly(() => span.end());
    }
  })();
  return response;
}
