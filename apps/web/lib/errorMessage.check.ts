// Assertions for the error normaliser. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/errorMessage.check.ts
//
// (from a workspace that has tsx — packages/content-engine does.)
//
// Every case below is a shape that was ACTUALLY on an officer's screen before this file
// existed, or a Marathi sentence that must survive untouched. The two that prompted the
// harness are the ZodError blob (a JSON array, pretty-printed, which overflowed the card
// on a phone) and `TypeError: Failed to fetch` (an English dev string, shown with no
// button, for a failure whose only fix is a button).
//
// In its own file rather than behind a `--check` flag inside the module, so nothing in the
// Next bundle can ever reach `process` — the referenceSearch.check.ts precedent.

import { ApiRequestError } from './api';
import {
  describeError,
  isAbortError,
  storedErrorMessage,
} from './errorMessage';
import { STR } from './strings';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

function apiError(message: string, status: number): ApiRequestError {
  return new ApiRequestError(message, status);
}

// ---------------------------------------------------------------------------
// 1. The blob. This is the whole reason the file exists.
// ---------------------------------------------------------------------------

// Verbatim ZodError.message for a two-field schema — 401 characters, 26 lines.
const ZOD_BLOB = `[
  {
    "origin": "string",
    "code": "too_small",
    "minimum": 20,
    "inclusive": true,
    "path": [
      "note"
    ],
    "message": "Too small: expected string to have >=20 characters"
  }
]`;

{
  const d = describeError(apiError(ZOD_BLOB, 400));
  check('zod blob is never shown', d.message !== ZOD_BLOB);
  check('zod blob becomes the invalid sentence', d.message === STR.errInvalid);
  check('a malformed request offers no retry', d.retryable === false);
  check('zod blob is one line', !d.message.includes('\n'));
  check('zod blob is short enough for a phone card', d.message.length < 120);
}

{
  // The same blob thrown client-side by `Schema.parse(body)` — a half-deployed API.
  const zodish = new Error(ZOD_BLOB);
  zodish.name = 'ZodError';
  const d = describeError(zodish);
  check('client-side ZodError is a server problem', d.kind === 'server');
  check('client-side ZodError is retryable', d.retryable === true);
  check('client-side ZodError shows no JSON', !d.message.includes('{'));
}

// ---------------------------------------------------------------------------
// 2. The server restarted. Every engine's wording, one answer, always a retry.
// ---------------------------------------------------------------------------

for (const [engine, text] of [
  ['Chrome', 'Failed to fetch'],
  ['Firefox', 'NetworkError when attempting to fetch resource.'],
  ['Safari', 'Load failed'],
] as const) {
  const e = new TypeError(text);
  const d = describeError(e);
  check(`${engine} network failure is diagnosed`, d.kind === 'unreachable');
  check(`${engine} network failure offers a retry`, d.retryable === true);
  check(
    `${engine} network failure is Marathi`,
    d.message === STR.errUnreachable,
  );
  check(
    `${engine} network failure hides the engine text`,
    !d.message.includes(text),
  );
}

for (const status of [500, 502, 503, 504]) {
  const d = describeError(
    apiError('connect ECONNREFUSED 127.0.0.1:3001', status),
  );
  check(`${status} offers a retry`, d.retryable === true);
  check(
    `${status} hides the internal text`,
    !d.message.includes('ECONNREFUSED'),
  );
}

// ---------------------------------------------------------------------------
// 3. A route's own Marathi sentence must survive, exactly.
// ---------------------------------------------------------------------------

{
  const written = 'कृपया किमान २० अक्षरांची टिपणी लिहा.';
  const d = describeError(apiError(written, 400));
  check('a route Marathi 400 is shown verbatim', d.message === written);
  check('a route Marathi 400 offers no retry', d.retryable === false);
}

{
  const written = 'एक काम आधीच सुरू आहे. ते पूर्ण होईपर्यंत थांबा.';
  const d = describeError(apiError(written, 409));
  check('a route Marathi 409 is shown verbatim', d.message === written);
  check('a 409 offers no retry', d.retryable === false);
}

{
  // A 5xx message is an internal failure by definition, even if it happens to be
  // Marathi — so the canned server sentence wins there.
  const d = describeError(apiError('काहीतरी चुकले', 500));
  check('a 5xx never shows its own message', d.message === STR.errServer);
}

// ---------------------------------------------------------------------------
// 4. Internal English and machine text is always replaced.
// ---------------------------------------------------------------------------

const INTERNAL = [
  "Could not find the 'instructions' column of 'generations' in the schema cache",
  'fetch failed',
  'Video stitch was stopped by SIGKILL',
  'ElevenLabs STT failed (400): Failed to download the file from the provided URL',
  'https://storage.example.com/generations/97b64542-abcd/poster-v3.png not found',
  "TypeError: Cannot read properties of undefined (reading 'id')",
];

for (const text of INTERNAL) {
  const d = describeError(apiError(text, 400));
  check(`internal text replaced: ${text.slice(0, 40)}…`, d.message !== text);
  check(
    `replacement is Marathi: ${text.slice(0, 24)}…`,
    /[ऀ-ॿ]/.test(d.message),
  );
}

// ---------------------------------------------------------------------------
// 5. Status → wording and retry verdict.
// ---------------------------------------------------------------------------

const STATUS_CASES: readonly [number, string, boolean][] = [
  [404, STR.errNotFound, false],
  [408, STR.errTimeout, true],
  [409, STR.errBusy, false],
  [413, STR.errTooLarge, false],
  [429, STR.errRateLimited, true],
  [500, STR.errServer, true],
];

for (const [status, message, retryable] of STATUS_CASES) {
  const d = describeError(apiError('Request Entity Too Large', status));
  check(`${status} wording`, d.message === message, `got ${d.message}`);
  check(`${status} retry verdict`, d.retryable === retryable);
}

// ---------------------------------------------------------------------------
// 6. The string round trip. A catch site stores `errorMessage(e)`; the component
//    that renders it much later has only the string — and must still get the
//    right button. Without this every stored message came back retryable.
// ---------------------------------------------------------------------------

{
  const stored = describeError(new TypeError('Failed to fetch')).message;
  const round = describeError(new Error(stored));
  check(
    'round-tripped network failure keeps its kind',
    round.kind === 'unreachable',
  );
  check(
    'round-tripped network failure keeps its retry',
    round.retryable === true,
  );
}

{
  const stored = describeError(apiError('x', 409)).message;
  const round = describeError(new Error(stored));
  check('round-tripped busy stays un-retryable', round.retryable === false);
  check('round-tripped busy keeps its kind', round.kind === 'busy');
}

{
  const stored = describeError(apiError(ZOD_BLOB, 400)).message;
  const round = describeError(new Error(stored));
  check('round-tripped invalid stays un-retryable', round.retryable === false);
}

// ---------------------------------------------------------------------------
// 7. Overflow guards — a message that would push a card off a 390px screen.
// ---------------------------------------------------------------------------

{
  // A single 60-character token: no break opportunity, so it sets the block's
  // minimum width. The stylesheet contains it; this keeps it off the screen.
  const path = 'generations/97b64542aaaabbbbccccddddeeeeffff/poster-v3.png';
  const d = describeError(apiError(`फाईल सापडली नाही: ${path}`, 400));
  check(
    'an unbreakable token disqualifies the message',
    d.message === STR.errInvalid,
  );
}

{
  const long = 'ही एक खूप मोठी चूक आहे. '.repeat(20); // ~480 chars
  const d = describeError(apiError(long, 400));
  check('an over-long message is replaced', d.message === STR.errInvalid);
}

{
  const multiline = 'चूक झाली.\n  at handler (server.js:42)';
  const d = describeError(apiError(multiline, 400));
  check('a multi-line message is replaced', d.message === STR.errInvalid);
}

{
  const withJson = 'रेंडर अयशस्वी: {"code":"moderation_blocked"}';
  const d = describeError(apiError(withJson, 400));
  check('a message carrying JSON is replaced', d.message === STR.errInvalid);
}

// ---------------------------------------------------------------------------
// 8. storedErrorMessage — the same test for a string polled off a row.
// ---------------------------------------------------------------------------

{
  const written = 'ध्वनिमुद्रण वाचता आले नाही.';
  check(
    'a job Marathi message survives',
    storedErrorMessage(written, STR.genericError) === written,
  );
  check(
    'a provider blob is replaced',
    storedErrorMessage(
      '{"error":{"code":"moderation_blocked"}}',
      STR.genericError,
    ) === STR.genericError,
  );
  check(
    'null falls back',
    storedErrorMessage(null, STR.failedHint) === STR.failedHint,
  );
  check(
    'empty falls back',
    storedErrorMessage('   ', STR.failedHint) === STR.failedHint,
  );
}

// ---------------------------------------------------------------------------
// 9. Aborts are not failures.
// ---------------------------------------------------------------------------

{
  const abort = new Error('The user aborted a request.');
  abort.name = 'AbortError';
  check('AbortError is recognised', isAbortError(abort) === true);
  check(
    'a real error is not an abort',
    isAbortError(new Error('boom')) === false,
  );
  check('a non-error is not an abort', isAbortError('boom') === false);
}

// ---------------------------------------------------------------------------
// 10. Nothing thrown at all, and the fallback contract.
// ---------------------------------------------------------------------------

{
  check(
    'undefined uses the fallback',
    describeError(undefined, STR.genLoadFailed).message === STR.genLoadFailed,
  );
  check(
    'a thrown string uses the fallback',
    describeError('boom', STR.genLoadFailed).message === STR.genLoadFailed,
  );
  check(
    'no fallback lands on the generic sentence',
    describeError(undefined).message === STR.genericError,
  );
  // The fallback names the ACTION; a specific diagnosis must outrank it, or a server
  // restart would read as "proofreading failed" on one page and something else on the
  // next, when it is the same failure everywhere.
  check(
    'a diagnosis outranks the fallback',
    describeError(new TypeError('Failed to fetch'), STR.proofreadError)
      .message === STR.errUnreachable,
  );
}

// ---------------------------------------------------------------------------
// 11. Every canned sentence is fit to render.
// ---------------------------------------------------------------------------

const CANNED_STRINGS = [
  STR.errOffline,
  STR.errUnreachable,
  STR.errTimeout,
  STR.errBusy,
  STR.errNotFound,
  STR.errTooLarge,
  STR.errRateLimited,
  STR.errInvalid,
  STR.errServer,
  STR.genericError,
];

for (const text of CANNED_STRINGS) {
  check(`canned is Marathi: ${text.slice(0, 20)}…`, /[ऀ-ॿ]/.test(text));
  check(`canned is one line: ${text.slice(0, 20)}…`, !text.includes('\n'));
  check(`canned fits a phone card: ${text.slice(0, 20)}…`, text.length <= 110);
  check(
    `canned names no machine: ${text.slice(0, 20)}…`,
    !/HTTP|server|API|error|null|undefined|[{}[\]]/i.test(text),
  );
  // A canned sentence must round-trip, or section 6's guarantee is silently broken
  // the next time one of them is reworded.
  check(
    `canned round-trips: ${text.slice(0, 20)}…`,
    describeError(new Error(text)).message === text,
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
