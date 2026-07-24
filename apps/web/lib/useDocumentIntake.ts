'use client';

// Polling hook for one uploaded document (/api/documents). Generalised from
// useTranslateDocument, and it keeps that hook's two hard-won properties:
//
//   - the poll asks for the LEAN detail (no page text). A 20-page document is ~40k
//     characters, and a 10-minute OCR at 2.5 s would otherwise re-ship it hundreds of
//     times.
//   - when the pages land it fetches ONCE with the text included, so the UI has the full
//     document exactly when it needs it and not before.
//
// The trap to respect when editing: 'selecting' and 'ready' are IDLE states. Only
// 'extracting' (and a not-yet-loaded job) belong in `active` — polling an idle job spins
// forever against a payload that will never change on its own.
//
// The job lives in the API's memory, so a 404 is expected after its TTL (or an API
// restart) and is surfaced as `gone` rather than retried forever.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentDetail } from '@dgipr/schemas';
import { getDocumentIntake } from './api';

const POLL_INTERVAL_MS = 2500;

export function useDocumentIntake(id: string | null): {
  detail: DocumentDetail | null;
  error: string | null;
  gone: boolean;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  // Whether the full text of the CURRENT page set has been pulled, so the heavy fetch
  // happens once per read rather than on every poll.
  const fetchedText = useRef(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setGone(false);
    fetchedText.current = false;
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const lean = await getDocumentIntake(id);
      // Back to extracting = a new selection or an OCR re-read, which rebuilds the page
      // list from scratch. Without this the cached text from the first read would be kept
      // forever and the user would stare at the very pages they just rejected.
      if (lean.status === 'extracting') fetchedText.current = false;

      if (!fetchedText.current && lean.pages.length > 0) {
        setDetail(await getDocumentIntake(id, true));
        fetchedText.current = true;
      } else {
        // Keep the text we already hold; only the lean fields can have changed. The server
        // reporting NO pages is not a lean-payload artifact — it means the page list is
        // being rebuilt — so cached pages are dropped with it.
        setDetail((prev) =>
          prev
            ? {
                ...lean,
                pages:
                  prev.pages.length > 0 && lean.pages.length > 0
                    ? prev.pages
                    : lean.pages,
              }
            : lean,
        );
      }
      setError(null);
    } catch (e) {
      const status =
        typeof e === 'object' && e !== null && 'status' in e
          ? (e as { status?: number }).status
          : undefined;
      if (status === 404) setGone(true);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const active =
    id !== null && !gone && (detail === null || detail.status === 'extracting');

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

  return { detail, error, gone, refresh };
}
