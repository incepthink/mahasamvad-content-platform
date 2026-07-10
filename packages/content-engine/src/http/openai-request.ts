// Shared transport for every OpenAI REST call in this package (chat + embeddings).
//
// It exists because a 429 is NOT a failure — it is the server telling us to wait. The
// pipeline issues 8-15 gpt-4o calls per article, several carrying the full note AND the full
// article (~5-8k tokens each), so on a 30,000 TPM org a single generation reliably trips the
// token bucket. Before this module a bare `fetch` threw on the first 429 and killed the run.
//
// Two mechanisms, deliberately kept together:
//
// 1. A serializing limiter (OPENAI_MAX_CONCURRENCY, default 1). Concurrent requests are what
//    turn "slightly over budget" into a hard 429 — notably the Promise.all coverage pair in
//    generate-article.ts, which fires two ~7k-token requests at once. Funnelling all callers
//    through one gate removes the burst without any caller having to know it exists. The slot
//    is held ACROSS retries, so a backing-off request does not let a queued one stampede into
//    the same exhausted bucket.
//
// 2. Retry with backoff, preferring the server's own timing. OpenAI returns the exact wait in
//    `retry-after-ms` / `retry-after` / `x-ratelimit-reset-*`, so we obey that and only fall
//    back to exponential backoff when no header is present.
//
// We do NOT keep a client-side token bucket. Estimating Devanagari token counts locally would
// only be wrong in a new way; with concurrency 1 plus header-driven waits the client already
// paces itself against the server's own accounting.

// Exponential-backoff base and ceiling, used only when the response carries no timing header.
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

// Small pad added to server-supplied waits: their reset clock and ours are not the same clock,
// and retrying one millisecond early just burns an attempt.
const CLOCK_SKEW_PAD_MS = 100;

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

// Admit at most `concurrency` tasks at a time. The slot is transferred directly from the
// releasing task to the next queued one (active++ before resolving), so a caller arriving
// between the release and the queued task's microtask cannot slip past the limit.
function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// Built on first use, not at import time, so `--env-file` / dotenv have run by then.
let limiter: Limiter | null = null;
function getLimiter(): Limiter {
  limiter ??= createLimiter(readInt('OPENAI_MAX_CONCURRENCY', 1));
  return limiter;
}

// Parse a Go-style duration as used by the x-ratelimit-reset-* headers: "834ms", "1.5s",
// "6m0s", "2s500ms". Returns null for anything unrecognised (including a bare number, which
// these headers never emit — `retry-after` handles that case separately).
export function parseDuration(value: string | null): number | null {
  if (value === null) return null;
  const units: Readonly<Record<string, number>> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  };

  let total = 0;
  let matched = false;
  for (const match of value.trim().matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    const [, amount, unit] = match;
    if (amount === undefined || unit === undefined) return null;
    const scale = units[unit];
    const parsed = Number(amount);
    if (scale === undefined || !Number.isFinite(parsed)) return null;
    total += parsed * scale;
    matched = true;
  }
  return matched ? total : null;
}

// The wait OpenAI itself asked for, if it said. `retry-after-ms` is plain milliseconds and
// `retry-after` plain seconds; the reset headers are durations. When a 429 names both a token
// and a request reset we honour the longer — the shorter one is not the limit we tripped.
function serverRequestedDelay(headers: Headers): number | null {
  const retryAfterMs = headers.get('retry-after-ms');
  if (retryAfterMs !== null) {
    const ms = Number(retryAfterMs);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }

  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }

  const resets = [
    parseDuration(headers.get('x-ratelimit-reset-tokens')),
    parseDuration(headers.get('x-ratelimit-reset-requests')),
  ].filter((value): value is number => value !== null);

  return resets.length > 0 ? Math.max(...resets) : null;
}

// Equal jitter: half the capped window plus a random half. Full jitter can return ~0ms and
// hammer an exhausted bucket; no jitter synchronises concurrent retries.
function backoffDelay(attempt: number): number {
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

// A 429 means one of two very different things. `rate_limit_exceeded` is transient and clears
// on its own. `insufficient_quota` is a billing wall: retrying it stalls the pipeline for a
// full backoff cycle and then fails anyway, so we surface it immediately.
function isQuotaExhausted(detail: string): boolean {
  try {
    const parsed = JSON.parse(detail) as { error?: { code?: unknown } };
    if (parsed.error?.code === 'insufficient_quota') return true;
  } catch {
    // Not JSON — fall through to the substring check below.
  }
  return detail.includes('insufficient_quota');
}

function isRetryableStatus(status: number, detail: string): boolean {
  if (status === 429) return !isQuotaExhausted(detail);
  return status === 408 || status === 409 || status >= 500;
}

export type OpenAiRequest = Readonly<{
  // Used in log lines and in the thrown message: `OpenAI <label> request failed: ...`.
  label: string;
  apiKey: string;
  body: unknown;
}>;

// POST a JSON body to an OpenAI endpoint, serialized against every other call from this
// process and retried on transient failures. Resolves with an ok Response (the caller reads
// the body); throws with the same message shape the bare fetch used to throw, so upstream
// error handling — including the best-effort catch blocks in editorial-brief.ts and
// polish-article.ts — behaves exactly as before.
export async function openAiFetch(
  url: string,
  { label, apiKey, body }: OpenAiRequest,
): Promise<Response> {
  const attempts = readInt('OPENAI_MAX_RETRIES', 5) + 1;
  // Serialized calls queue behind one another, so a hung request would stall the whole
  // pipeline rather than just itself. The timeout is the release valve.
  const timeoutMs = readInt('OPENAI_REQUEST_TIMEOUT_MS', 180_000);

  return getLimiter()(async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Network reset, DNS blip, or our own timeout. Nothing reached the model, so a retry
        // is always safe; the last attempt rethrows the original error with its stack.
        if (attempt === attempts) throw error;
        const delay = backoffDelay(attempt);
        console.warn(
          `[openai] ${label} request errored (${String(error)}); ` +
            `retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${attempts})`,
        );
        await sleep(delay);
        continue;
      }

      if (response.ok) return response;

      const detail = await response.text();
      if (!isRetryableStatus(response.status, detail) || attempt === attempts) {
        throw new Error(
          `OpenAI ${label} request failed: ${response.status} ${response.statusText} — ${detail}`,
        );
      }

      const delay =
        (serverRequestedDelay(response.headers) ?? backoffDelay(attempt)) +
        CLOCK_SKEW_PAD_MS;
      console.warn(
        `[openai] ${label} got ${response.status}; retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${attempts})`,
      );
      await sleep(delay);
    }

    // Unreachable: the loop either returns, throws, or sleeps and retries.
    throw new Error(`OpenAI ${label} request failed: retries exhausted.`);
  });
}
