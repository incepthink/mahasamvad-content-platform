'use client';

// Polling hook for one transcription run, cloned from useDloIntake: job state of record is
// the transcriptions row, so a plain 2.5 s poll survives refreshes. Accepts null (nothing
// selected yet) and simply stays idle.
//
// The poll asks for the LEAN row — no transcripts. A meeting recording is tens of thousands
// of characters and a run takes minutes, so shipping the text every 2.5 s would be pure
// waste. The full text is fetched ONCE on each transition into a terminal status.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptionDetail } from '@dgipr/schemas';
import { getTranscription } from './api';
import { errorMessage } from './errorMessage';

const POLL_INTERVAL_MS = 2500;

function isTerminal(status: TranscriptionDetail['status']): boolean {
  return status === 'ready' || status === 'failed';
}

export function useTranscription(id: string | null): {
  detail: TranscriptionDetail | null;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<TranscriptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef<TranscriptionDetail['status'] | null>(null);

  // Selecting a different run restarts from a clean slate — stale detail would otherwise
  // flash the previous run's transcript under the new run's title.
  useEffect(() => {
    setDetail(null);
    setError(null);
    lastStatus.current = null;
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const lean = await getTranscription(id);
      // "Became terminal", not "is terminal": opening a run that finished long ago must
      // still fetch its text once, which it does because lastStatus starts null.
      const settled =
        isTerminal(lean.status) && lastStatus.current !== lean.status;
      lastStatus.current = lean.status;
      if (settled) {
        setDetail(await getTranscription(id, true));
      } else {
        setDetail((prev) => (prev ? mergeKeepingText(prev, lean) : lean));
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  const active = id !== null && (detail === null || !isTerminal(detail.status));

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

// Recordings are attached once at upload and never reordered, so index + name is a safe way
// to carry a lean poll's entries' text forward.
function mergeKeepingText(
  prev: TranscriptionDetail,
  lean: TranscriptionDetail,
): TranscriptionDetail {
  return {
    ...lean,
    combinedText: lean.combinedText ?? prev.combinedText,
    files: lean.files.map((file, index) => {
      const before = prev.files[index];
      if (!before || before.name !== file.name) return file;
      return {
        ...file,
        ...(before.text !== undefined ? { text: before.text } : {}),
      };
    }),
  };
}
