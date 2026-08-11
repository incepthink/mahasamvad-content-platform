'use client';

// Which chats this browser started.
//
// *** ORDERING ONLY. This is not auth and must never become auth. ***
//
// The same arrangement, for the same reasons, as `dgipr.dlo.mine` in lib/dloDraft.ts: there is
// no login in this product and `chat_threads` has no owner column, so every chat is returned
// by the API and openable by anyone. That is the intended design — the department shares one
// workspace. This list exists purely so an officer's own conversations sort above everyone
// else's in the rail instead of being hunted for. The API never receives it, never reads it
// and never filters on it. Losing it (cleared storage, another machine) costs ordering and
// nothing else: the chat is still in the rail, one group down.
//
// Worth being explicit about, because a chat FEELS private in a way an intake does not: it is
// not. Anyone who can reach the app can read any chat here. The composer hint says so.

const MINE_KEY = 'dgipr.chat.mine';

// Enough for any realistic stretch of work without letting the list grow forever.
const MAX_REMEMBERED = 100;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readMyChatIds(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(MINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function rememberMyChatId(id: string): void {
  if (!isBrowser()) return;
  const next = [id, ...readMyChatIds().filter((known) => known !== id)].slice(
    0,
    MAX_REMEMBERED,
  );
  try {
    window.localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage costs ordering, never access.
  }
}

export function forgetMyChatId(id: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      MINE_KEY,
      JSON.stringify(readMyChatIds().filter((known) => known !== id)),
    );
  } catch {
    // ignore
  }
}
