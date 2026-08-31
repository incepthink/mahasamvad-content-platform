'use client';

// Polls one intake on the new /dlo lane.
//
// Much smaller than `useDloIntake`, and the difference is the whole redesign. That hook
// re-fetches the heavy payload whenever an OCR re-read might have delivered new pages, because
// the old review step renders every transcribed page and the officer edits them. Here there is
// no per-source text to render and nothing to edit, so the poll is the LEAN payload from start
// to finish.
//
// The one heavy fetch is the FIRST one, and it is not for text: `review_state` (0036) ships
// only on `?text=1`, and it is where /dlo's intake form leaves the officer's AI instruction.
// Without it that box would come back empty on the very screen it is meant to be carried to.
// The create route writes it before it answers, so the first poll always has it; every poll
// after that is lean. An intake created without one simply has nothing there.
//
// It stops polling the moment the row leaves a working state. A `ready` intake is waiting on
// the officer, and a `failed` one is not going to change on its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DloIntakeDetail } from '@dgipr/schemas';
import { getDloIntake } from './api';
import { errorMessage } from './errorMessage';

const POLL_MS = 2500;

export type NewDloIntakeState = Readonly<{
  intake: DloIntakeDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}>;

function isWorking(intake: DloIntakeDetail | null): boolean {
  return intake?.status === 'queued' || intake?.status === 'running';
}

export function useNewDloIntake(id: string): NewDloIntakeState {
  const [intake, setIntake] = useState<DloIntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref as well as in state so the interval below can decide whether to keep
  // running without being re-created every time the row changes — a poll that restarts on
  // every tick would drift.
  const working = useRef(true);
  // Whether the one heavy fetch has been made. A ref rather than state for the reason the
  // paid name lookup uses one: this settles in the same commit as the poll that triggers it,
  // so a state flag would let a second request through one render before it took effect.
  const fetchedHeavy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // Lean, except for the first poll that reports the intake ready — see the header.
      const heavy = !fetchedHeavy.current;
      const next = await getDloIntake(id, heavy);
      if (heavy) fetchedHeavy.current = true;
      setIntake(next);
      working.current = isWorking(next);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void refresh();
    const timer = setInterval(() => {
      if (cancelled || !working.current) return;
      void refresh();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  return { intake, loading, error, refresh };
}
