// Shared transport for every Gemini REST call in this package (Veo video
// generation). Mirrors openai-request.ts: a serializing limiter plus
// retry-with-backoff, because Veo's preview models carry LOW rate limits (a
// handful of concurrent operations) and a 429 is the server saying "wait", not
// a failure. Do not call fetch against generativelanguage.googleapis.com
// directly — route it through geminiFetch.
//
// Differences from the OpenAI transport, on purpose:
// - GET support: Veo is a long-running operation the caller POLLS, and the
//   polls should flow through the same retry/limiter policy as the start call.
// - Google signals rate limits with `retry-after` only (no x-ratelimit-reset-*
//   duration headers), so the server-delay reader is simpler.
// - LANES: Veo's preview endpoints carry low concurrency limits and answer a
//   poll in milliseconds; the image endpoint answers in minutes and is happy
//   with a few in flight. One limiter for both meant every storyboard frame
//   queued behind the Veo setting, so each lane has its own concurrency and
//   its own timeout (see laneConfig).

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
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

// Same slot-transfer limiter as openai-request.ts (active++ before resolving the
// queued task, so nothing slips past between release and resume).
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

// Which pool and which clock a call belongs to. 'default' is Veo (and anything
// unlabelled): low concurrency, a short timeout, because a Veo call either
// starts an operation or polls one and both answer fast. 'image' is Nano
// Banana, where a single frame — especially one carrying an inline reference
// image — routinely runs past two minutes and several can be in flight.
export type GeminiLane = 'default' | 'image';

type LaneConfig = Readonly<{ concurrency: number; timeoutMs: number }>;

function laneConfig(lane: GeminiLane): LaneConfig {
  return lane === 'image'
    ? {
        concurrency: readInt('GEMINI_IMAGE_MAX_CONCURRENCY', 3),
        timeoutMs: readInt('GEMINI_IMAGE_TIMEOUT_MS', 300_000),
      }
    : {
        concurrency: readInt('GEMINI_MAX_CONCURRENCY', 1),
        timeoutMs: readInt('GEMINI_REQUEST_TIMEOUT_MS', 120_000),
      };
}

// Built on first use, not at import time, so `--env-file` / dotenv have run.
const limiters = new Map<GeminiLane, Limiter>();
function getLimiter(lane: GeminiLane, concurrency: number): Limiter {
  let limiter = limiters.get(lane);
  if (!limiter) {
    limiter = createLimiter(concurrency);
    limiters.set(lane, limiter);
  }
  return limiter;
}

function serverRequestedDelay(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }
  return null;
}

function backoffDelay(attempt: number): number {
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

// Gemini's 429 for an exhausted quota (RESOURCE_EXHAUSTED with a quota message)
// clears on the next window for rate limits but not for a billing/daily cap.
// Retrying a daily cap stalls for a full backoff cycle and fails anyway.
function isQuotaExhausted(detail: string): boolean {
  return (
    detail.includes('exceeded your current quota') || detail.includes('billing')
  );
}

function isRetryableStatus(status: number, detail: string): boolean {
  if (status === 429) return !isQuotaExhausted(detail);
  return status === 408 || status === 409 || status >= 500;
}

// A non-ok Gemini response, thrown as a typed error so a caller can react to a
// SPECIFIC rejection instead of string-matching a message. `detail` is the raw
// response body, where Gemini names the offending field — which is how
// veo-client learns that a model rejects a parameter without keeping a
// per-model capability table (the preview ids churn and are env-overridable, so
// such a table goes stale the moment VEO_MODEL_* is repointed).
export class GeminiRequestError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(
    label: string,
    status: number,
    statusText: string,
    detail: string,
  ) {
    super(`Gemini ${label} request failed: ${status} ${statusText} — ${detail}`);
    this.name = 'GeminiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

// Our own clock ran out, not the server's. Kept distinct from
// GeminiRequestError (which carries a status the server sent) because the two
// need OPPOSITE retry policies — see TIMEOUT_ATTEMPTS.
export class GeminiTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly attempts: number;

  constructor(label: string, timeoutMs: number, attempts: number) {
    super(
      `Gemini ${label} request timed out after ${Math.round(timeoutMs / 1000)}s` +
        (attempts > 1 ? ` on each of ${attempts} attempts` : '') +
        '. Raise GEMINI_IMAGE_TIMEOUT_MS (frames) or ' +
        'GEMINI_REQUEST_TIMEOUT_MS (Veo) if this is normal for the model.',
    );
    this.name = 'GeminiTimeoutError';
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
  }
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

// A timeout is NOT retried, and this is the deliberate opposite of how the
// server-sent failures below are treated. Three reasons, in order:
//
// 1. It does not cancel anything. Aborting the socket leaves the model
//    generating; the call is billed and the result thrown away. Every retry is
//    another full charge for an image nobody will see.
// 2. It is not transient. A 429 or a 502 is the server saying "later"; a
//    timeout is this prompt being slower than our clock, which the next
//    identical request will be too.
// 3. It is the one failure a human is sitting and watching. Spending the whole
//    GEMINI_MAX_RETRIES budget on it made a merely-slow frame take
//    retries × timeout to admit defeat — six two-minute attempts was 12½
//    minutes of waiting to be told "it timed out".
//
// So the worst case for one frame is now exactly its lane's timeout: lower
// GEMINI_IMAGE_TIMEOUT_MS to wait less, raise it to fail less. A genuine
// network drop surfaces as a TypeError, not a TimeoutError, and still gets the
// full backoff budget below.
const TIMEOUT_ATTEMPTS = 1;

export type GeminiRequest = Readonly<{
  // Used in log lines and thrown messages: `Gemini <label> request failed: ...`.
  label: string;
  apiKey: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  // Pool + clock this call belongs to. Defaults to Veo's.
  lane?: GeminiLane;
}>;

// Send a request to a Gemini endpoint (path relative to /v1beta, or an absolute
// https URL for file downloads that return a redirect target), serialized against
// every other Gemini call from this process and retried on transient failures.
// Resolves with an ok Response (the caller reads the body).
export async function geminiFetch(
  path: string,
  { label, apiKey, method = 'POST', body, lane = 'default' }: GeminiRequest,
): Promise<Response> {
  const attempts = readInt('GEMINI_MAX_RETRIES', 5) + 1;
  const { concurrency, timeoutMs } = laneConfig(lane);
  const url = path.startsWith('https://')
    ? path
    : `${BASE_URL}/${path.replace(/^\//, '')}`;

  let timeouts = 0;

  return getLimiter(lane, concurrency)(async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            'x-goog-api-key': apiKey,
            ...(body !== undefined
              ? { 'content-type': 'application/json' }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeout(error)) {
          timeouts += 1;
          if (timeouts >= TIMEOUT_ATTEMPTS || attempt === attempts) {
            throw new GeminiTimeoutError(label, timeoutMs, timeouts);
          }
          console.warn(
            `[gemini] ${label} timed out after ${Math.round(timeoutMs / 1000)}s; ` +
              `retrying (attempt ${timeouts + 1}/${TIMEOUT_ATTEMPTS} — the ` +
              'previous attempt may still be generating, and billed)',
          );
          continue;
        }
        if (attempt === attempts) throw error;
        const delay = backoffDelay(attempt);
        console.warn(
          `[gemini] ${label} request errored (${String(error)}); ` +
            `retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${attempts})`,
        );
        await sleep(delay);
        continue;
      }

      if (response.ok) return response;

      const detail = await response.text();
      if (!isRetryableStatus(response.status, detail) || attempt === attempts) {
        throw new GeminiRequestError(
          label,
          response.status,
          response.statusText,
          detail,
        );
      }

      const delay =
        (serverRequestedDelay(response.headers) ?? backoffDelay(attempt)) +
        CLOCK_SKEW_PAD_MS;
      console.warn(
        `[gemini] ${label} got ${response.status}; retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${attempts})`,
      );
      await sleep(delay);
    }

    throw new Error(`Gemini ${label} request failed: retries exhausted.`);
  });
}
