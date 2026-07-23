'use client';

// Polling hook for one DLO intake, cloned from useGeneration: job state of
// record is the dlo_intakes row, so a plain 2.5 s poll survives refreshes.
// Accepts null (no intake submitted yet) and simply stays idle.
//
// The poll asks for the LEAN row — no transcripts, no PDF page text. A meeting
// recording plus a 20-page GR is tens of thousands of characters, and an intake
// runs for minutes, so shipping all of it every 2.5 s would be pure waste. The
// full text is fetched ONCE on each transition into `ready`: "on transition"
// rather than "once ever" is what makes a per-file OCR re-read deliver its new
// pages, since that puts the row back through running → ready.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DloIntakeDetail } from '@dgipr/schemas';
import { getDloIntake } from './api';

const POLL_INTERVAL_MS = 2500;

export function useDloIntake(id: string | null): {
  detail: DloIntakeDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<DloIntakeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef<DloIntakeDetail['status'] | null>(null);

  // A new intake id restarts from a clean slate (stale detail would otherwise
  // flash the previous run's state).
  useEffect(() => {
    setDetail(null);
    setError(null);
    lastStatus.current = null;
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const lean = await getDloIntake(id);
      const becameReady =
        lean.status === 'ready' && lastStatus.current !== 'ready';
      lastStatus.current = lean.status;
      if (becameReady) {
        setDetail(await getDloIntake(id, true));
      } else {
        // Keep the text already held: only the lean fields can have changed, and
        // during a re-read the previous pages stay on screen until the new ones
        // land (the card that is being re-read is disabled meanwhile).
        setDetail((prev) => (prev ? mergeKeepingText(prev, lean) : lean));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

  return { detail, error, refresh };
}

// Files are attached once at upload and never reordered, so index + name is a
// safe way to carry the text of a lean poll's entries forward.
function mergeKeepingText(
  prev: DloIntakeDetail,
  lean: DloIntakeDetail,
): DloIntakeDetail {
  return {
    ...lean,
    combinedText: lean.combinedText ?? prev.combinedText,
    files: lean.files.map((file, index) => {
      const before = prev.files[index];
      if (!before || before.name !== file.name) return file;
      return {
        ...file,
        ...(before.text !== undefined ? { text: before.text } : {}),
        ...(before.pages !== undefined ? { pages: before.pages } : {}),
      };
    }),
  };
}
