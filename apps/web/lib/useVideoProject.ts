'use client';

// Polling hook for one explainer-video project, cloned from useDloIntake: job
// state of record is the video_projects row, so a plain 2.5 s poll survives
// refreshes. Accepts null (no project chosen yet) and simply stays idle.
//
// No lean/heavy (?text=1) split here on purpose: a project's scenes are a few
// KB of narration/brief text plus URLs — nothing like the DLO transcripts that
// forced that split — so the poll just ships the whole detail.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoProjectDetail } from '@dgipr/schemas';
import { getVideoProject } from './api';

const POLL_INTERVAL_MS = 2500;

// The working statuses; the two gates + completed/failed are idle and stop the
// poll (a gate waits on the USER, not the server).
function isWorking(status: VideoProjectDetail['status']): boolean {
  return (
    status === 'scripting' ||
    status === 'storyboarding' ||
    status === 'animating'
  );
}

export function useVideoProject(id: string | null): {
  detail: VideoProjectDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<VideoProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(id);

  // A new project id restarts from a clean slate (stale detail would otherwise
  // flash the previous project's state).
  useEffect(() => {
    idRef.current = id;
    setDetail(null);
    setError(null);
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getVideoProject(id);
      if (idRef.current !== id) return;
      setDetail(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const active = id !== null && (detail === null || isWorking(detail.status));

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
