'use client';

// Polling hook for one generation. Job state of record lives in the API's
// database row, so a plain 2.5 s poll survives page refreshes and reopened tabs.
// Polling runs while the row is queued/running and restarts automatically when a
// mutation (feedback submit) flips it back to running via refresh().

import { useCallback, useEffect, useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { getGeneration } from './api';

const POLL_INTERVAL_MS = 2500;

export function useGeneration(id: string): {
  detail: GenerationDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<GenerationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getGeneration(id);
      setDetail(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const active =
    detail === null ||
    detail.status === 'queued' ||
    detail.status === 'running';

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, active]);

  return { detail, error, refresh };
}
