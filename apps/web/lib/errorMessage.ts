'use client';

// ONE place that turns anything thrown anywhere in this app into a sentence an
// officer can act on.
//
// Why this file exists. Every failure path used to end in
// `e instanceof Error ? e.message : STR.genericError`, which puts whatever the
// throw site happened to carry straight on screen. In practice that is four very
// different things, and three of them are unreadable to the people who use this
// product:
//
//   1. A Marathi sentence a route wrote for an officer — the one good case.
//   2. `TypeError: Failed to fetch` — the API restarted, or the box is asleep.
//      English, technical, and (worst of all) it reads as if the officer did
//      something wrong when the only sane response is to press a button again.
//   3. A ZodError message, which is a multi-line JSON array of issue objects.
//      401 characters for a two-field schema; several thousand for a real
//      request body. That is the blob that overflowed the card on a phone.
//   4. An internal English message (`Could not find the 'instructions' column`,
//      `fetch failed`, a storage path, a provider's request id).
//
// So the rule here is a whitelist, never a blacklist: a message is shown to an
// officer only when it LOOKS like it was written for one — Devanagari, short,
// one line, no code punctuation and no unbreakable token. Everything else is
// replaced by a canned Marathi sentence chosen from the HTTP status, which also
// tells the caller whether a retry button is worth offering.

import { ApiRequestError } from './api';
import { STR } from './strings';

export type ErrorKind =
  | 'offline'
  | 'unreachable'
  | 'timeout'
  | 'busy'
  | 'notFound'
  | 'tooLarge'
  | 'rateLimited'
  | 'invalid'
  | 'server'
  | 'unknown';

export interface OfficerError {
  /** A Marathi sentence safe to render in a card. Never a blob, never English. */
  readonly message: string;
  readonly kind: ErrorKind;
  /**
   * Whether pressing a button again could plausibly succeed. False for the cases
   * where retrying the identical request can only fail the identical way (a
   * malformed request, a row that does not exist).
   */
  readonly retryable: boolean;
}

// A message is only shown verbatim when every one of these holds. They are
// deliberately strict: showing a canned sentence where a specific one existed
// costs a little precision, while showing a JSON blob costs the whole screen.
const MAX_SHOWABLE_CHARS = 240;
// A run of 40+ non-space characters is a URL, a storage path, a stack frame or a
// base64 fragment. `overflow-wrap` in the stylesheet keeps it inside the card,
// but it still has no meaning for an officer, so it disqualifies the message.
const UNBREAKABLE_TOKEN = /\S{40,}/;
const DEVANAGARI = /[ऀ-ॿ]/;
// Punctuation and words that only appear in machine output. `://` catches URLs,
// `at name(` catches stack frames, and the brace/bracket class catches JSON —
// which is exactly what a ZodError message is.
const LOOKS_LIKE_CODE = new RegExp(
  [
    '[{}\\[\\]]',
    '::',
    ':\\/\\/',
    '\\bat\\s+\\w+\\s*\\(',
    '\\b(?:undefined|null|NaN|Object|TypeError|SyntaxError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|statusCode)\\b',
  ].join('|'),
);

function isOfficerReadable(message: string): boolean {
  const text = message.trim();
  if (text.length === 0 || text.length > MAX_SHOWABLE_CHARS) return false;
  if (text.includes('\n')) return false;
  if (!DEVANAGARI.test(text)) return false;
  if (UNBREAKABLE_TOKEN.test(text)) return false;
  if (LOOKS_LIKE_CODE.test(text)) return false;
  return true;
}

// A browser reports "the server did not answer" as a TypeError whose text differs
// per engine: Chrome "Failed to fetch", Firefox "NetworkError when attempting to
// fetch resource.", Safari "Load failed". None of them is worth showing, and all
// three mean the same thing to an officer: press the button again.
function isNetworkFailure(caught: unknown): boolean {
  if (!(caught instanceof Error)) return false;
  if (caught.name === 'TypeError') return true;
  return /failed to fetch|networkerror|load failed|network request failed/i.test(
    caught.message,
  );
}

/**
 * True for a request the app itself cancelled — a superseded poll, a component
 * that unmounted, a stream the officer stopped. Never an error to report; call
 * this before setting any error state.
 */
export function isAbortError(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    (caught.name === 'AbortError' || caught.name === 'CanceledError')
  );
}

function kindForStatus(status: number): ErrorKind {
  if (status === 404) return 'notFound';
  if (status === 408) return 'timeout';
  if (status === 409) return 'busy';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'rateLimited';
  if (status === 502 || status === 503 || status === 504) return 'unreachable';
  if (status >= 500) return 'server';
  if (status >= 400) return 'invalid';
  return 'unknown';
}

const CANNED: Record<ErrorKind, { message: string; retryable: boolean }> = {
  offline: { message: STR.errOffline, retryable: true },
  unreachable: { message: STR.errUnreachable, retryable: true },
  timeout: { message: STR.errTimeout, retryable: true },
  busy: { message: STR.errBusy, retryable: false },
  notFound: { message: STR.errNotFound, retryable: false },
  tooLarge: { message: STR.errTooLarge, retryable: false },
  rateLimited: { message: STR.errRateLimited, retryable: true },
  invalid: { message: STR.errInvalid, retryable: false },
  server: { message: STR.errServer, retryable: true },
  unknown: { message: STR.genericError, retryable: true },
};

/**
 * Normalise anything thrown into an officer-facing sentence plus a retry verdict.
 *
 * `fallback` names what this particular action was ("तपासणी अयशस्वी झाली"), and is
 * used only when the thrown value carries no usable message of its own AND its
 * kind is unknown. It never overrides a specific diagnosis: a server restart says
 * so on every screen, in the same words.
 */
export function describeError(
  caught: unknown,
  fallback?: string,
): OfficerError {
  // The browser knows it is offline before any request is made. Checked first
  // because it is the one cause an officer can actually fix themselves.
  if (
    typeof navigator !== 'undefined' &&
    'onLine' in navigator &&
    navigator.onLine === false
  ) {
    return { ...CANNED.offline, kind: 'offline' };
  }

  if (isNetworkFailure(caught)) {
    return { ...CANNED.unreachable, kind: 'unreachable' };
  }

  if (caught instanceof ApiRequestError) {
    const kind = kindForStatus(caught.status);
    // A route's own Marathi sentence is the best text available and outranks the
    // canned one — but only for a 4xx, where the message describes something
    // about the request. A 5xx message is an internal failure by definition.
    if (
      kind !== 'server' &&
      kind !== 'unreachable' &&
      isOfficerReadable(caught.message)
    ) {
      return {
        message: caught.message.trim(),
        kind,
        retryable: CANNED[kind].retryable,
      };
    }
    return { ...CANNED[kind], kind };
  }

  // A schema parse failure on OUR side: the API answered, we could not read it.
  // Almost always a half-deployed API against a newer web build, which settles on
  // a retry once the deploy lands — so it is retryable and deliberately not
  // blamed on the officer.
  if (caught instanceof Error && caught.name === 'ZodError') {
    return { ...CANNED.server, kind: 'server' };
  }

  if (caught instanceof Error) {
    const text = caught.message.trim();

    // A message this file produced EARLIER, handed back as a string. This is the common
    // shape: a catch site calls `errorMessage(e)` and stores the sentence, and the
    // component that renders it much later has no thrown value to describe. Recognising
    // our own canned wording recovers the kind — and therefore the retry verdict — so
    // `<ErrorNotice message={errorMessage(e)} />` shows the same button as
    // `<ErrorNotice error={e} />` would. Without this every stored message came back
    // `unknown`/retryable, which is exactly the "a retry button that cannot help" case
    // the verdict exists to prevent.
    for (const [kind, canned] of Object.entries(CANNED) as [
      ErrorKind,
      (typeof CANNED)[ErrorKind],
    ][]) {
      if (canned.message === text) return { ...canned, kind };
    }

    if (isOfficerReadable(text)) {
      return { message: text, kind: 'unknown', retryable: true };
    }
  }

  return {
    message: fallback ?? CANNED.unknown.message,
    kind: 'unknown',
    retryable: true,
  };
}

/**
 * Drop-in replacement for `e instanceof Error ? e.message : STR.genericError`.
 * Use this at every catch site; use `describeError` where the caller also needs
 * the retry verdict.
 */
export function errorMessage(caught: unknown, fallback?: string): string {
  return describeError(caught, fallback).message;
}

/**
 * The same normalisation for a message the SERVER already stored on a row —
 * `generations.error`, a failed intake file, a video scene. Those are strings,
 * not thrown values, and they reach the UI through a poll rather than a catch, so
 * they never pass through `describeError`. Most were written for an officer; the
 * rest are provider blobs and are replaced.
 */
export function storedErrorMessage(
  stored: string | null | undefined,
  fallback: string,
): string {
  if (!stored) return fallback;
  return isOfficerReadable(stored) ? stored.trim() : fallback;
}
