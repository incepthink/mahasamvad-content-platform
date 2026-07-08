'use client';

// Global tracker for Twitter/n8n background tasks. Because a social-post run lives
// in a separate service and can take minutes, the create page does NOT navigate on
// submit — it hands the id here and the navbar tasks panel follows the run.
//
// State of record is the server row (matches the platform's "polling clients survive
// refreshes" principle): on mount we hydrate tracked ids from GET /api/generations
// (category === 'twitter'), adopting any active run plus a few recent ones so a
// just-finished result is still visible after a reload. Tracked tasks are polled at
// the same ~2.5 s cadence as useGeneration until they reach a terminal status.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { getGeneration, listGenerations } from './api';

const POLL_INTERVAL_MS = 2500;

// How many already-finished twitter runs to re-adopt on refresh, so the panel still
// shows the most recent result(s) after a reload rather than going empty.
const HYDRATE_RECENT_TERMINAL = 3;

type TasksContextValue = {
  // Loaded task details, newest-first.
  tasks: GenerationDetail[];
  // Non-terminal tracked tasks (running/queued or just-submitted, detail not yet loaded).
  activeCount: number;
  // True while any tracked twitter task is still in flight — disables the create
  // page's Twitter card (v1 allows one active twitter task at a time).
  hasActiveTwitterTask: boolean;
  // Start tracking a run id (called on submit / regenerate). Fetches its detail now.
  addTask: (id: string) => void;
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
};

const TasksContext = createContext<TasksContextValue | null>(null);

function isActive(status: GenerationDetail['status']): boolean {
  return status === 'queued' || status === 'running';
}

export function TasksProvider({ children }: { children: ReactNode }) {
  // Tracked ids, newest-first. `details` is the id → row map; `tasks` is the
  // ordered, loaded projection of the two.
  const [ids, setIds] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, GenerationDetail>>({});
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Refs so the poll loop reads the latest ids/details without re-subscribing.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const detailsRef = useRef(details);
  detailsRef.current = details;

  const upsert = useCallback((detail: GenerationDetail) => {
    setDetails((prev) => ({ ...prev, [detail.id]: detail }));
  }, []);

  const addTask = useCallback(
    (id: string) => {
      setIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
      // Load its detail immediately so the panel shows a row without a poll wait.
      void getGeneration(id).then(upsert).catch(() => {});
    },
    [upsert],
  );

  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => setIsPanelOpen(false), []);

  // Hydrate on mount (refresh-proof): adopt active twitter runs + a few recent ones.
  useEffect(() => {
    let cancelled = false;
    listGenerations()
      .then((all) => {
        if (cancelled) return;
        const twitter = all.filter((s) => s.category === 'twitter');
        const active = twitter.filter((s) => isActive(s.status));
        const terminal = twitter
          .filter((s) => !isActive(s.status))
          .slice(0, HYDRATE_RECENT_TERMINAL);
        const adopt = [...active, ...terminal];
        setIds((prev) => {
          const merged = [...prev];
          for (const s of adopt) if (!merged.includes(s.id)) merged.push(s.id);
          return merged;
        });
        // Summaries lack caption/note/designMode, so fetch each full detail.
        for (const s of adopt) {
          void getGeneration(s.id).then(upsert).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [upsert]);

  const tasks = ids
    .map((id) => details[id])
    .filter((d): d is GenerationDetail => Boolean(d));
  const loadedActive = tasks.filter((d) => isActive(d.status)).length;
  const pendingCount = ids.filter((id) => !details[id]).length;
  const activeCount = loadedActive + pendingCount;
  const hasActiveTwitterTask = activeCount > 0;
  const idle = activeCount === 0;

  // Poll while anything is in flight; stop each task once it reaches a terminal
  // status (its row stays in the panel to show the result).
  useEffect(() => {
    if (idle) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const pollIds = idsRef.current.filter((id) => {
        const d = detailsRef.current[id];
        return !d || isActive(d.status);
      });
      await Promise.all(
        pollIds.map((id) => getGeneration(id).then(upsert).catch(() => {})),
      );
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-run only when we cross the idle↔active boundary (`idle` is stable while a
    // task runs, so this doesn't restart the loop every poll).
  }, [idle, upsert]);

  const value: TasksContextValue = {
    tasks,
    activeCount,
    hasActiveTwitterTask,
    addTask,
    isPanelOpen,
    openPanel,
    closePanel,
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) {
    throw new Error('useTasks must be used within a TasksProvider');
  }
  return ctx;
}
