'use client';

// Global tracker for in-flight generations. Every run started this session is handed
// here (via addTask) and followed in the navbar tasks panel. Twitter/n8n runs live in
// a separate service and can take minutes, so the create page does NOT navigate for
// them — the panel is their surface; article/news runs navigate to their detail page
// but still register a row here as a shortcut.
//
// Session-only: the tracked list lives in memory only (no server hydration), so a
// reload starts with an empty panel. While tracked tasks are non-terminal they are
// polled at the same ~2.5 s cadence as useGeneration until they reach a terminal
// status (their row stays to show the result).

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
import { getGeneration } from './api';

const POLL_INTERVAL_MS = 2500;

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

  const tasks = ids
    .map((id) => details[id])
    .filter((d): d is GenerationDetail => Boolean(d));
  const loadedActive = tasks.filter((d) => isActive(d.status)).length;
  const pendingCount = ids.filter((id) => !details[id]).length;
  const activeCount = loadedActive + pendingCount;
  // v1 allows one active twitter task at a time; gate only on twitter runs so an
  // in-flight article/news run doesn't disable the Twitter card.
  const hasActiveTwitterTask = tasks.some(
    (d) => d.category === 'twitter' && isActive(d.status),
  );
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
