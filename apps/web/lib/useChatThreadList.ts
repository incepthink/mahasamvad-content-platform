'use client';

// The rail: every chat, split into this browser's own and everyone else's.
//
// The split is ORDERING ONLY — see lib/chatDraft.ts. Every chat is returned by the API and
// every chat is openable; `mine` exists so an officer does not scan a shared list for their
// own conversation.
//
// Deliberately NOT polled. /dlo and /transcribe poll because a job they started is progressing
// without them; a chat only changes when someone types into it, and the one person who can see
// that happen is already looking at it. The list refreshes when it is mounted and whenever the
// caller says something changed — a new chat, a finished turn, a deletion.

import { useCallback, useEffect, useState } from 'react';
import type { ChatThreadSummary } from '@dgipr/schemas';
import { listChatThreads } from './api';
import { readMyChatIds } from './chatDraft';

// Held OUTSIDE the hook, because opening another chat re-mounts it: /chat and /chat/[id]
// are separate pages, and two different [id]s re-mount too, so the state started at null
// every time — the rail emptied and flashed a spinner over a list that had not changed.
// The last known rows are seeded into state and then revalidated in the background, so the
// list is only ever replaced by a newer one. Module scope, not localStorage: this is a
// within-tab convenience, and a first load should still fetch.
let cachedThreads: ChatThreadSummary[] | null = null;
let cachedMyIds: readonly string[] = [];

export function useChatThreadList(): {
  mine: ChatThreadSummary[];
  others: ChatThreadSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(
    cachedThreads,
  );
  const [error, setError] = useState<string | null>(null);
  // Read once per refresh rather than per render — localStorage reads are synchronous.
  const [myIds, setMyIds] = useState<readonly string[]>(cachedMyIds);

  const refresh = useCallback(async () => {
    try {
      const rows = await listChatThreads();
      const ids = readMyChatIds();
      cachedThreads = rows;
      cachedMyIds = ids;
      setThreads(rows);
      setMyIds(ids);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mineSet = new Set(myIds);
  const rows = threads ?? [];
  // A chat with no messages yet is not in the rail: it is created the moment /chat is opened,
  // and an empty "नवीन चॅट" row appearing for everyone before a word is typed would be noise.
  const started = rows.filter((row) => row.messageCount > 0);

  return {
    mine: started.filter((row) => mineSet.has(row.id)),
    others: started.filter((row) => !mineSet.has(row.id)),
    loading: threads === null && error === null,
    error,
    refresh,
  };
}
