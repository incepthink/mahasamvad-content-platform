'use client';

// The /new-video-workflow rail: every conversation, split into this browser's own and
// everyone else's.
//
// The split is ORDERING ONLY — see lib/newVideoDraft.ts.
//
// Deliberately NOT polled, the useChatThreadList stance: the list only changes when someone
// sends a turn, and the officer who did that is already looking at the page. It refreshes on
// mount and whenever the caller says something changed — a new conversation, a finished turn,
// a deletion.

import { useCallback, useEffect, useState } from 'react';
import type { NewVideoConversationSummary } from '@dgipr/schemas';
import { listNewVideoConversations } from './api';
import { errorMessage } from './errorMessage';
import { readMyVideoConversationIds } from './newVideoDraft';

// Held OUTSIDE the hook, because opening another conversation re-mounts it:
// /new-video-workflow and /new-video-workflow/[id] are separate pages, and two different
// [id]s re-mount too, so the state started at null every time — the rail emptied and flashed
// a spinner over a list that had not changed. The last known rows are seeded into state and
// then revalidated in the background, so the list is only ever replaced by a newer one.
// Module scope, not localStorage: this is a within-tab convenience, and a first load should
// still fetch.
let cachedConversations: NewVideoConversationSummary[] | null = null;
let cachedMyIds: readonly string[] = [];

export function useNewVideoConversationList(): {
  mine: NewVideoConversationSummary[];
  others: NewVideoConversationSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [conversations, setConversations] = useState<
    NewVideoConversationSummary[] | null
  >(cachedConversations);
  const [error, setError] = useState<string | null>(null);
  // Read once per refresh rather than per render — localStorage reads are synchronous.
  const [myIds, setMyIds] = useState<readonly string[]>(cachedMyIds);

  const refresh = useCallback(async () => {
    try {
      const rows = await listNewVideoConversations();
      const ids = readMyVideoConversationIds();
      cachedConversations = rows;
      cachedMyIds = ids;
      setConversations(rows);
      setMyIds(ids);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mineSet = new Set(myIds);
  const rows = conversations ?? [];

  return {
    mine: rows.filter((row) => mineSet.has(row.id)),
    others: rows.filter((row) => !mineSet.has(row.id)),
    loading: conversations === null && error === null,
    error,
    refresh,
  };
}
