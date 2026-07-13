'use client';

// Polling hook for a generation's thread (all runs spawned from the same note
// lineage). The strip is auxiliary UI, so it stays cheap and quiet: one fetch on
// mount, a refetch whenever the page's own run changes status, a 5 s poll only
// while some member is still queued/running, and errors swallowed into a no-op
// (the page must never break because the strip couldn't load).

import { useCallback, useEffect, useState } from 'react';
import type { GenerationStatus, ThreadItem } from '@dgipr/schemas';
import { getGenerationThread } from './api';

const POLL_INTERVAL_MS = 5000;

export function useGenerationThread(
  id: string,
  detailStatus: GenerationStatus | null,
): { thread: ThreadItem[]; refresh: () => Promise<void> } {
  const [thread, setThread] = useState<ThreadItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      setThread(await getGenerationThread(id));
    } catch {
      // Auxiliary strip: keep whatever we last had.
    }
  }, [id]);

  // Initial load, plus a refetch when this run's status flips (its own node's
  // chip changed). detailStatus is null until the detail arrives — skipping it
  // avoids a wasted duplicate fetch, since the first non-null value refetches.
  useEffect(() => {
    if (detailStatus === null) return;
    void refresh();
  }, [refresh, detailStatus]);

  const active = thread.some(
    (item) => item.status === 'queued' || item.status === 'running',
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, active]);

  return { thread, refresh };
}
