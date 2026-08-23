'use client';

// One fetch for the whole analytics surface, keyed on the selected range.
//
// Deliberately NOT polled. Every other list in this product polls because it is watching work
// that is currently running; an analytics page is watching a quarter, and a dashboard that
// silently redrew itself mid-sentence during a presentation would be worse than a stale one.
// The range buttons and a reload are the refresh.
//
// It IS cached per range for the life of the tab, because the landing page and all six
// drill-downs read the SAME response: without this, opening a feature card and pressing back
// re-ran the whole aggregation twice, and that request is the entire reason this surface felt
// slow to navigate. A cached range is served synchronously on the first render, so the page
// paints with no loading state at all; past the TTL it is still served immediately and
// revalidated in the background, so a stale number is never shown as a spinner.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalyticsRange, AnalyticsResponse } from '@dgipr/schemas';
import { getAnalytics } from './api';
import { errorMessage } from './errorMessage';

// Long enough that moving between the six cards never refetches, short enough that a range
// left open through a working session does not go stale unnoticed.
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { at: number; data: AnalyticsResponse };

// Module scope, so it survives navigation between /analytics and /analytics/[feature] (each
// is its own route and remounts the hook) but never outlives a reload.
const cache = new Map<AnalyticsRange, CacheEntry>();

export function useAnalytics(range: AnalyticsRange) {
  const cached = cache.get(range);
  const [data, setData] = useState<AnalyticsResponse | null>(
    cached?.data ?? null,
  );
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow request for an abandoned range landing after a fast one for the
  // current range — switching ३० दिवस → ७ दिवस quickly would otherwise show the wrong window.
  const latest = useRef(0);

  const fetchRange = useCallback(
    async (showSpinner: boolean) => {
      const ticket = ++latest.current;
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const next = await getAnalytics(range);
        cache.set(range, { at: Date.now(), data: next });
        if (ticket === latest.current) setData(next);
      } catch (cause) {
        // A failed background revalidation must not replace numbers already on screen with
        // an error banner — the cached window is still a true answer for its own period.
        if (ticket === latest.current && showSpinner) {
          setError(errorMessage(cause));
        }
      } finally {
        if (ticket === latest.current && showSpinner) setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    const entry = cache.get(range);
    if (entry) {
      // Serve it now either way; only go back to the API when it has aged out.
      setData(entry.data);
      setLoading(false);
      setError(null);
      if (Date.now() - entry.at > CACHE_TTL_MS) void fetchRange(false);
      return;
    }
    void fetchRange(true);
  }, [range, fetchRange]);

  // Explicit user action: always re-ask, and show that it is happening.
  const reload = useCallback(() => fetchRange(true), [fetchRange]);

  return { data, loading, error, reload };
}
