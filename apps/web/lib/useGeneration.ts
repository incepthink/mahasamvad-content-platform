'use client';

// Polling hook for one generation. Job state of record lives in the API's
// database row, so a plain 2.5 s poll survives page refreshes and reopened tabs.
// Polling runs while the row is queued/running and restarts automatically when a
// mutation (feedback submit) flips it back to running via refresh().

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { getGeneration } from './api';
import { errorMessage } from './errorMessage';

const POLL_INTERVAL_MS = 2500;

// ONE extra read after the row settles.
//
// Two things about a run land AFTER it stops being `active`, because they are background
// passes over work the officer already has: the editorial-learning note (migration 0057) and
// anything else the runner writes to its in-process registries once the job's promise has
// resolved. Polling on for them would keep every finished page awake indefinitely for a field
// that is usually empty; one late read costs a single request and catches them.
//
// It is best-effort ON PURPOSE. If the officer closed the page first the note is missed, and
// the rule is still on the review page — which is where it lives. Do not turn this into a
// second poll to make it certain.
const LATE_REFETCH_MS = 6000;

export function useGeneration(id: string): {
  detail: GenerationDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<GenerationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lateRefetchArmed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getGeneration(id);
      setDetail(next);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  // `translating`, `articleRevising` and `captionRevising` are tracked separately from
  // status: each can run beside the poster render (and on a finished row while it stays
  // 'completed'), so polling has to follow them too, or the translated/revised result
  // never arrives.
  const active =
    detail === null ||
    detail.status === 'queued' ||
    detail.status === 'running' ||
    detail.translating ||
    detail.articleRevising ||
    detail.captionRevising;

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

  // Armed once per settle, and re-armed only when the row goes active again — so a run the
  // officer keeps refining gets one late read per round, and an idle page gets none. The flag
  // is a REF rather than state: setting state here would re-render, and the effect's own
  // refresh() changes `detail`, which would then schedule another read forever.
  useEffect(() => {
    if (active) {
      lateRefetchArmed.current = false;
      return;
    }
    if (lateRefetchArmed.current) return;
    lateRefetchArmed.current = true;
    const timer = setTimeout(() => {
      void refresh();
    }, LATE_REFETCH_MS);
    return () => clearTimeout(timer);
  }, [active, refresh]);

  return { detail, error, refresh };
}
