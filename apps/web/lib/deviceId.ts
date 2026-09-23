'use client';

// This browser's device id, sent to the API as `x-dgipr-device` on every request (and as
// `?device=` on a download link, which cannot carry a header).
//
// *** AN ATTRIBUTION LABEL FOR THE ADMIN LOG. NEVER AUTH. ***
//
// There is no login in this product and there must not be one. The id exists so the hidden
// /activity page can tell two officers on one office IP apart. The API reads it, stores it
// beside the work in `activity_events`, and never grants, filters or refuses anything on it.
// Clearing site data, a private window or a different browser simply makes a "new" device —
// which costs the log a little continuity and nobody any access.
//
// Same module shape as lib/chatDraft.ts: localStorage, an isBrowser guard, and a try/catch so
// a disabled localStorage degrades to a per-tab id rather than to an error.

import { DEVICE_HEADER, DEVICE_QUERY_PARAM, isDeviceId } from '@dgipr/schemas';

const DEVICE_KEY = 'dgipr.device';

let cached: string | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function mintDeviceId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let id = 'd-';
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

/** Null during server rendering — nothing is sent from there anyway. */
export function getDeviceId(): string | null {
  if (!isBrowser()) return null;
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(DEVICE_KEY);
    if (isDeviceId(stored)) {
      cached = stored;
      return cached;
    }
    const minted = mintDeviceId();
    window.localStorage.setItem(DEVICE_KEY, minted);
    cached = minted;
  } catch {
    // Disabled or full localStorage: a per-tab id is still better than none.
    cached = cached ?? mintDeviceId();
  }
  return cached;
}

/** The header object to spread into a fetch's headers. Empty on the server. */
export function deviceHeaders(): Record<string, string> {
  const id = getDeviceId();
  return id ? { [DEVICE_HEADER]: id } : {};
}

/** Append `?device=` (or `&device=`) to a navigation URL. Unchanged on the server. */
export function withDeviceParam(url: string): string {
  const id = getDeviceId();
  if (!id) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${DEVICE_QUERY_PARAM}=${encodeURIComponent(id)}`;
}
