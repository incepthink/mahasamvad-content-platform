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

// Built on first use, not at import time, so `--env-file` / dotenv have run.
let limiter: Limiter | null = null;
function getLimiter(): Limiter {
  limiter ??= createLimiter(readInt('GEMINI_MAX_CONCURRENCY', 1));
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

export type GeminiRequest = Readonly<{
  // Used in log lines and thrown messages: `Gemini <label> request failed: ...`.
  label: string;
  apiKey: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}>;

// Send a request to a Gemini endpoint (path relative to /v1beta, or an absolute
// https URL for file downloads that return a redirect target), serialized against
// every other Gemini call from this process and retried on transient failures.
// Resolves with an ok Response (the caller reads the body).
export async function geminiFetch(
  path: string,
  { label, apiKey, method = 'POST', body }: GeminiRequest,
): Promise<Response> {
  const attempts = readInt('GEMINI_MAX_RETRIES', 5) + 1;
  const timeoutMs = readInt('GEMINI_REQUEST_TIMEOUT_MS', 120_000);
  const url = path.startsWith('https://')
    ? path
    : `${BASE_URL}/${path.replace(/^\//, '')}`;

  return getLimiter()(async () => {
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
