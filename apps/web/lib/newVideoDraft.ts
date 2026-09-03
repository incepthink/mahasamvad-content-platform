'use client';

// Which video conversations this browser started.
//
// *** ORDERING ONLY. This is not auth and must never become auth. ***
//
// The same arrangement, for the same reasons, as `dgipr.chat.mine` in lib/chatDraft.ts and
// `dgipr.dlo.mine` in lib/dloDraft.ts: there is no login in this product and
// `new_video_conversations` has no owner column, so every conversation is returned by the API
// and openable by anyone. That is the intended design — the department shares one workspace.
// This list exists purely so an officer's own conversations sort above everyone else's in the
// rail instead of being hunted for. The API never receives it, never reads it and never
// filters on it. Losing it (cleared storage, another machine) costs ordering and nothing
// else: the conversation is still in the rail, one group down.

const MINE_KEY = 'dgipr.nvw.mine';

// Enough for any realistic stretch of work without letting the list grow forever.
const MAX_REMEMBERED = 100;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function readMyVideoConversationIds(): string[] {
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

export function rememberMyVideoConversationId(id: string): void {
  if (!isBrowser()) return;
  const next = [
    id,
    ...readMyVideoConversationIds().filter((known) => known !== id),
  ].slice(0, MAX_REMEMBERED);
  try {
    window.localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage costs ordering, never access.
  }
}

export function forgetMyVideoConversationId(id: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      MINE_KEY,
      JSON.stringify(
        readMyVideoConversationIds().filter((known) => known !== id),
      ),
    );
  } catch {
    // ignore
  }
}
