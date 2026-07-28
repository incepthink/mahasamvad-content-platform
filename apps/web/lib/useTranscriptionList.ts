'use client';

// The recent-run list on /transcribe.
//
// Polling follows useDloIntakeList's discipline: 5 s, and ONLY while some run is still
// non-terminal. A list left open after everything has finished costs nothing, and a page
// nobody is working on does not poll at all.
//
// There is no "mine" split here, unlike /dlo: a transcription is one short-lived run with no
// multi-step workspace to resume, so a single newest-first list is the whole story.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptionSummary } from '@dgipr/schemas';
import { listTranscriptions } from './api';

const POLL_INTERVAL_MS = 5000;

export function useTranscriptionList(): {
  items: TranscriptionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<TranscriptionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listTranscriptions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = items ?? [];
  // Cross the idle↔busy boundary only, so the effect does not restart on every poll.
  const busy = rows.some(
    (row) => row.status === 'queued' || row.status === 'running',
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await refreshRef.current();
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy]);

  return {
    items: rows,
    loading: items === null && error === null,
    error,
    refresh,
  };
}
