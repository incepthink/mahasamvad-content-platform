'use client';

// The /activity page's live feed + the day's KPIs.
//
// The house polling idiom (a `setTimeout` chain with a `cancelled` flag, as in
// useDloIntakeList): every 10 s, but ONLY while the newest page is what is on screen — once
// the admin has pressed "load more" they are reading history, and rows jumping in above them
// would move what they are reading. Also paused while the tab is hidden.
//
// New rows are merged by id rather than the list being replaced, so an in-progress row that
// settles updates in place and a row the admin is looking at never disappears under them.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityEvent, ActivitySummaryResponse } from '@dgipr/schemas';
import {
  getActivityFeed,
  getActivitySummary,
  type ActivityFeedQuery,
} from './api';
import { errorMessage } from './errorMessage';

const POLL_INTERVAL_MS = 10_000;

export type ActivityFilterState = Readonly<{
  ip?: string | undefined;
  device?: string | undefined;
  feature?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}>;

function sortNewestFirst(events: ActivityEvent[]): ActivityEvent[] {
  return events.sort((a, b) =>
    a.createdAt === b.createdAt
      ? b.id.localeCompare(a.id)
      : b.createdAt.localeCompare(a.createdAt),
  );
}

function merge(
  current: readonly ActivityEvent[],
  incoming: readonly ActivityEvent[],
): ActivityEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return sortNewestFirst([...byId.values()]);
}

export function useActivityFeed(filters: ActivityFilterState) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<ActivitySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const ticket = useRef(0);

  const query: ActivityFeedQuery = filters;
  const key = JSON.stringify(query);

  const loadFirst = useCallback(
    async (showSpinner: boolean) => {
      const mine = ++ticket.current;
      if (showSpinner) setLoading(true);
      try {
        const [feed, day] = await Promise.all([
          getActivityFeed(JSON.parse(key) as ActivityFeedQuery),
          getActivitySummary(),
        ]);
        if (mine !== ticket.current) return;
        if (showSpinner) {
          setEvents(feed.events);
          setNextCursor(feed.nextCursor);
          setPages(1);
        } else {
          setEvents((current) => merge(current, feed.events));
        }
        setSummary(day);
        setError(null);
      } catch (cause) {
        if (mine !== ticket.current) return;
        // A failed background refresh keeps what is on screen; only a first load reports.
        if (showSpinner) setError(errorMessage(cause));
      } finally {
        if (mine === ticket.current && showSpinner) setLoading(false);
      }
    },
    [key],
  );

  useEffect(() => {
    void loadFirst(true);
  }, [loadFirst]);

  useEffect(() => {
    if (pages > 1) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || !document.hidden) {
        await loadFirst(false);
      }
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadFirst, pages]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const feed = await getActivityFeed({
        ...(JSON.parse(key) as ActivityFeedQuery),
        cursor: nextCursor,
      });
      setEvents((current) => merge(current, feed.events));
      setNextCursor(feed.nextCursor);
      setPages((count) => count + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [key, nextCursor]);

  const reload = useCallback(() => loadFirst(true), [loadFirst]);

  return {
    events,
    summary,
    loading,
    loadingMore,
    error,
    hasMore: nextCursor !== null,
    live: pages === 1,
    loadMore,
    reload,
  };
}
