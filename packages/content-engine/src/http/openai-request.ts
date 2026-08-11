// Shared transport for every OpenAI REST call in this package (chat + embeddings).
//
// It exists because a 429 is NOT a failure — it is the server telling us to wait. The
// pipeline issues 8-15 calls per article, several carrying the full note AND the full
// article (~5-8k tokens each), so on a 30,000 TPM org a single generation reliably trips the
// token bucket. Before this module a bare `fetch` threw on the first 429 and killed the run.
// gpt-5.6's reasoning tokens count toward the same TPM budget, so the pacing below matters
// more now, not less.
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

// LANES. The default lane is the article/poster pipeline described above and keeps its
// serialized behaviour exactly. The 'ocr' lane exists because PDF reading is a different
// shape of work: one call PER PAGE, each carrying one page's bytes and returning that page's
// text, with no call depending on another. Funnelling a 20-page document through a
// concurrency-1 gate would make the per-page design — chosen because it is the only way page
// identity can be exact by construction — also the slowest way to read a document.
//
// Sharing this transport rather than opening a second one is deliberate: the retry ladder and
// the header-driven waits are the reason this module exists, and an OCR burst is exactly the
// traffic that trips a 429. What a lane changes is HOW MANY may be in flight, never what
// happens when the server pushes back.
//
// Built on first use, not at import time, so `--env-file` / dotenv have run by then.
//
// The 'chat' lane is the general assistant at /chat, and it exists for a reason the other two
// do not share: someone is WATCHING it. A pipeline job that waits ninety seconds for a slot is
// a progress bar moving slightly later; a chat that does is broken. It must not queue behind an
// article generation, and — just as much — an officer's article must not queue behind someone
// else's chat, which is what would happen if chat used the default lane.
//
// Consequence to know before tuning it: chat traffic now contributes to exactly the TPM bursts
// concurrency-1 was chosen to prevent. The retry ladder below absorbs them (that is what it is
// for) and the wait is charged to the chat that caused it, but on a small org expect 429
// warnings to appear here first. CHAT_MAX_CONCURRENCY is the dial; 1 restores strict
// one-at-a-time behaviour within chat while still keeping it out of the pipeline's way.
export type OpenAiLane = 'default' | 'ocr' | 'chat';

const LANE_CONCURRENCY: Readonly<Record<OpenAiLane, [string, number]>> = {
  default: ['OPENAI_MAX_CONCURRENCY', 1],
  ocr: ['OCR_MAX_CONCURRENCY', 4],
  chat: ['CHAT_MAX_CONCURRENCY', 4],
};

const limiters = new Map<OpenAiLane, Limiter>();
function getLimiter(lane: OpenAiLane): Limiter {
  let limiter = limiters.get(lane);
  if (!limiter) {
    const [envName, fallback] = LANE_CONCURRENCY[lane];
    limiter = createLimiter(readInt(envName, fallback));
    limiters.set(lane, limiter);
  }
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
  // Which concurrency lane this call queues in. Omitted = 'default', so every existing
  // caller is unchanged. See OpenAiLane above.
  lane?: OpenAiLane | undefined;
  // Per-call override of the release valve below. Omitted = OPENAI_REQUEST_TIMEOUT_MS. Only
  // the OCR path sets it: its calls are short and independent, so a page that hangs should
  // give up long before an article-length generation would.
  timeoutMs?: number | undefined;
}>;

// POST a JSON body to an OpenAI endpoint, serialized against every other call from this
// process and retried on transient failures. Resolves with an ok Response (the caller reads
// the body); throws with the same message shape the bare fetch used to throw, so upstream
// error handling — including the best-effort catch blocks in editorial-brief.ts and
// polish-article.ts — behaves exactly as before.
export async function openAiFetch(
  url: string,
  { label, apiKey, body, lane, timeoutMs: timeoutOverride }: OpenAiRequest,
): Promise<Response> {
  const attempts = readInt('OPENAI_MAX_RETRIES', 5) + 1;
  // Serialized calls queue behind one another, so a hung request would stall the whole
  // pipeline rather than just itself. The timeout is the release valve. 5 minutes, not the
  // original 3: on gpt-5.6 a full-length Marathi article body at 'medium' reasoning spends
  // real time thinking before the first token, and a timeout here aborts paid work
  // mid-generation — the failure mode this valve is least meant to cause.
  const timeoutMs =
    timeoutOverride !== undefined && timeoutOverride > 0
      ? timeoutOverride
      : readInt('OPENAI_REQUEST_TIMEOUT_MS', 300_000);

  return getLimiter(lane ?? 'default')(async () => {
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
