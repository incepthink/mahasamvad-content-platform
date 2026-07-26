// Shared transport for every Kling REST call in this package (Kling 3.0 clip
// generation). Mirrors gemini-request.ts: a serializing limiter plus
// retry-with-backoff. Do not call fetch against api-singapore.klingai.com
// directly — route it through klingFetch.
//
// Three differences from the Gemini transport, all forced by Kling's API:
//
// - IT REPORTS FAILURE IN-BAND. A perfectly ordinary 200 can carry
//   `{"code": 1234, "message": "..."}`, and `code === 0` is the only success.
//   So this returns the envelope's `data` rather than a Response: the envelope
//   check has to happen in exactly ONE place or every caller re-implements it,
//   and the day one caller forgets, a failed render looks like a successful one
//   with an undefined video url.
// - Retryability is therefore two questions, not one (HTTP status AND the
//   in-band code), and the in-band one defaults to FAIL, not retry — see
//   isRetryableCode.
// - The result MP4 lives on a hotlink-protected CDN, not on the API host, so
//   downloads get their own helper that sends no Authorization header.
//
// Auth is a plain API key (`Authorization: Bearer <key>`). The AK/SK JWT flow
// in Kling's docs is explicitly legacy — the model-specific 3.0 endpoints this
// package calls do not use it, so there is no signing code here on purpose.

const DEFAULT_BASE_URL = 'https://api-singapore.klingai.com';

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

// Kling moved the endpoint off api.klingai.com once already, so the host is an
// .env edit rather than a deploy.
export function klingBaseUrl(): string {
  const raw = process.env.KLING_BASE_URL;
  return raw && raw.trim() !== ''
    ? raw.trim().replace(/\/+$/, '')
    : DEFAULT_BASE_URL;
}

export function klingApiKey(): string {
  const key = process.env.KLING_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'Missing required environment variable KLING_API_KEY. ' +
        'Copy .env.example to .env and fill it in.',
    );
  }
  return key.trim();
}

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

// Same slot-transfer limiter as gemini-request.ts (active++ before resolving the
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
// Kling's concurrency quota is per ACCOUNT and comes from the purchased resource
// package (one slot per video task; query calls consume none), so 1 is the safe
// default — an over-limit rejection costs a full backoff cycle.
let limiter: Limiter | null = null;
function getLimiter(): Limiter {
  limiter ??= createLimiter(readInt('KLING_MAX_CONCURRENCY', 1));
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

// An empty balance or an expired resource package does not clear on the next
// window; retrying one stalls for a full backoff cycle and fails anyway. The
// isQuotaExhausted precedent from the Gemini transport.
function isAccountExhausted(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes('insufficient') ||
    lower.includes('balance') ||
    lower.includes('resource pack') ||
    lower.includes('arrears') ||
    lower.includes('expired') ||
    lower.includes('quota')
  );
}

function isRetryableStatus(status: number, detail: string): boolean {
  if (status === 429) return !isAccountExhausted(detail);
  return status === 408 || status === 409 || status >= 500;
}

// The in-band half, and the one that defaults the OTHER way from the HTTP half.
//
// Kling's docs prescribe exponential backoff (initial delay >= 1s, which
// BASE_BACKOFF_MS already is) for concurrency over-limit, because that error is
// system load rather than a bad request. But they do NOT publish the numeric
// code for it, so this matches the message text — and everything it does not
// recognise FAILS FAST. That direction is deliberate: an unrecognised in-band
// error is far more likely a content-risk rejection than a transient one, and
// retrying that five times buys nothing while risking five bills. Every in-band
// failure is logged with its code verbatim, so the first real over-limit
// response is what tightens this list.
function isRetryableCode(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('concurren') ||
    lower.includes('too many') ||
    lower.includes('rate limit') ||
    lower.includes('task limit') ||
    lower.includes('queue') ||
    lower.includes('busy')
  );
}

// A failed Kling call, thrown as a typed error so a caller can react to a
// SPECIFIC rejection instead of string-matching a message. `detail` is the raw
// response body, where Kling names the offending field — which is how
// kling-client learns that a model rejects a parameter without keeping a
// per-model capability table.
//
// `status` is 200 when the failure was in-band; read `code` to tell the two
// apart. `code` is 0 for a transport-level failure that never produced an
// envelope.
export class KlingRequestError extends Error {
  readonly status: number;
  readonly code: number;
  readonly requestId: string | null;
  readonly detail: string;

  constructor(
    label: string,
    status: number,
    statusText: string,
    detail: string,
    code = 0,
    requestId: string | null = null,
  ) {
    super(
      `Kling ${label} request failed: ${status} ${statusText}` +
        (code !== 0 ? ` (code ${code})` : '') +
        ` — ${detail}`,
    );
    this.name = 'KlingRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.detail = detail;
  }
}

// The envelope every Kling endpoint wraps its payload in.
type KlingEnvelope<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

export type KlingRequest = Readonly<{
  // Used in log lines and thrown messages: `Kling <label> request failed: ...`.
  label: string;
  apiKey: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}>;

// Send a request to a Kling endpoint (path relative to the base URL, e.g.
// `image-to-video/kling-3.0` or `tasks?task_ids=…`), serialized against every
// other Kling call from this process and retried on transient failures.
//
// Resolves with the envelope's `data`, NOT a Response — see the header comment.
export async function klingFetch<T>(
  path: string,
  { label, apiKey, method = 'POST', body }: KlingRequest,
): Promise<T> {
  const attempts = readInt('KLING_MAX_RETRIES', 5) + 1;
  const timeoutMs = readInt('KLING_REQUEST_TIMEOUT_MS', 120_000);
  const url = `${klingBaseUrl()}/${path.replace(/^\//, '')}`;

  return getLimiter()(async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${apiKey}`,
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
          `[kling] ${label} request errored (${String(error)}); ` +
            `retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${attempts})`,
        );
        await sleep(delay);
        continue;
      }

      const raw = await response.text();

      if (!response.ok) {
        if (!isRetryableStatus(response.status, raw) || attempt === attempts) {
          throw new KlingRequestError(
            label,
            response.status,
            response.statusText,
            raw,
          );
        }
        const delay =
          (serverRequestedDelay(response.headers) ?? backoffDelay(attempt)) +
          CLOCK_SKEW_PAD_MS;
        console.warn(
          `[kling] ${label} got ${response.status}; retrying in ${Math.round(delay)}ms ` +
            `(attempt ${attempt + 1}/${attempts})`,
        );
        await sleep(delay);
        continue;
      }

      // 200, but success is `code === 0` — not the status line.
      let envelope: KlingEnvelope<T>;
      try {
        envelope = JSON.parse(raw) as KlingEnvelope<T>;
      } catch {
        throw new KlingRequestError(
          label,
          response.status,
          'unparseable body',
          raw,
        );
      }

      const code = envelope.code ?? 0;
      if (code === 0) {
        if (envelope.data === undefined) {
          throw new KlingRequestError(
            label,
            response.status,
            'no data in envelope',
            raw,
          );
        }
        return envelope.data;
      }

      const message = envelope.message ?? '';
      const requestId = envelope.request_id ?? null;
      // Logged verbatim on EVERY in-band failure: the numeric codes are not in
      // the published spec, so the log is how the retry list above gets tuned.
      console.warn(
        `[kling] ${label} returned code ${code} (${message || 'no message'})` +
          (requestId ? ` request_id=${requestId}` : ''),
      );
      if (!isRetryableCode(message) || attempt === attempts) {
        throw new KlingRequestError(
          label,
          response.status,
          message || 'in-band failure',
          raw,
          code,
          requestId,
        );
      }
      const delay = backoffDelay(attempt) + CLOCK_SKEW_PAD_MS;
      console.warn(
        `[kling] ${label} looks load-related; retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${attempts})`,
      );
      await sleep(delay);
    }

    throw new Error(`Kling ${label} request failed: retries exhausted.`);
  });
}

// Download a generated asset. Kling returns a hotlink-protected CDN url that is
// NOT on the API host and carries no envelope, so this deliberately sends no
// Authorization header (the url is already the credential). Shares the limiter
// and backoff policy so a download cannot outrun the render queue.
export async function klingFetchBinary(
  url: string,
  label: string,
): Promise<Buffer> {
  const attempts = readInt('KLING_MAX_RETRIES', 5) + 1;
  const timeoutMs = readInt('KLING_REQUEST_TIMEOUT_MS', 120_000);

  return getLimiter()(async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt === attempts) throw error;
        const delay = backoffDelay(attempt);
        console.warn(
          `[kling] ${label} errored (${String(error)}); retrying in ` +
            `${Math.round(delay)}ms (attempt ${attempt + 1}/${attempts})`,
        );
        await sleep(delay);
        continue;
      }

      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }

      const detail = await response.text();
      if (!isRetryableStatus(response.status, detail) || attempt === attempts) {
        throw new KlingRequestError(
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
        `[kling] ${label} got ${response.status}; retrying in ${Math.round(delay)}ms ` +
          `(attempt ${attempt + 1}/${attempts})`,
      );
      await sleep(delay);
    }

    throw new Error(`Kling ${label} failed: retries exhausted.`);
  });
}
