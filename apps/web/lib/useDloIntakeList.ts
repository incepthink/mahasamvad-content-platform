'use client';

// The shared recent-work list behind /dlo, split into this browser's own intakes and
// everyone else's.
//
// The split is ORDERING ONLY — see lib/dloDraft.ts. Every intake is returned by the API and
// every intake is openable; `mine` exists so an officer does not scan a shared list for their
// own row. Nothing here is a permission check.
//
// Polling follows useGenerationThread's discipline: 5 s, and ONLY while one of this browser's
// own runs is still non-terminal. A list left open after everything has finished costs
// nothing, and a page nobody is working on does not poll at all.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DloIntakeSummary } from '@dgipr/schemas';
import { listDloIntakes } from './api';
import { pruneMyIntakeIds, readMyIntakeIds } from './dloDraft';

const POLL_INTERVAL_MS = 5000;

function isActive(status: DloIntakeSummary['status']): boolean {
  return status === 'queued' || status === 'running';
}

export function useDloIntakeList(): {
  mine: DloIntakeSummary[];
  others: DloIntakeSummary[];
  // This browser's own run that is still going, if any — what the resume card shows.
  active: DloIntakeSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [intakes, setIntakes] = useState<DloIntakeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once per refresh rather than per render: localStorage reads are synchronous and this
  // runs on every poll tick.
  const [myIds, setMyIds] = useState<readonly string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const rows = await listDloIntakes();
      setIntakes(rows);
      setMyIds(readMyIntakeIds());
      pruneMyIntakeIds(rows.map((row) => row.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mineSet = new Set(myIds);
  const rows = intakes ?? [];
  const mine = rows.filter((row) => mineSet.has(row.id));
  const others = rows.filter((row) => !mineSet.has(row.id));
  const active = mine.find((row) => isActive(row.status)) ?? null;

  // Cross the idle↔active boundary only, so the effect does not restart on every poll.
  const busy = active !== null;
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
    mine,
    others,
    active,
    loading: intakes === null && error === null,
    error,
    refresh,
  };
}
