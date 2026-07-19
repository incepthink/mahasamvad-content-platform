'use client';

// Polling hook for one DLO intake, cloned from useGeneration: job state of
// record is the dlo_intakes row, so a plain 2.5 s poll survives refreshes.
// Accepts null (no intake submitted yet) and simply stays idle.

import { useCallback, useEffect, useState } from 'react';
import type { DloIntakeDetail } from '@dgipr/schemas';
import { getDloIntake } from './api';

const POLL_INTERVAL_MS = 2500;

export function useDloIntake(id: string | null): {
  detail: DloIntakeDetail | null;
  error: string | null;
} {
  const [detail, setDetail] = useState<DloIntakeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getDloIntake(id);
      setDetail(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  // A new intake id restarts from a clean slate (stale detail would otherwise
  // flash the previous run's state).
  useEffect(() => {
    setDetail(null);
    setError(null);
  }, [id]);

  const active =
    id !== null &&
    (detail === null ||
      detail.status === 'queued' ||
      detail.status === 'running');

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

  return { detail, error };
}
