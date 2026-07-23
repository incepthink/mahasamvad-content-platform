'use client';

// Polling hook for one PDF translation job, modelled on useDloIntake. Two differences,
// both because the payload is a whole document rather than a row:
//
//   - the poll asks for the LEAN detail (no page text). A 20-page document is ~40k
//     characters per language, and a 10-minute OCR at 2.5 s would otherwise re-ship it
//     hundreds of times.
//   - when a phase finishes (pages extracted, translations done) it fetches ONCE with the
//     text included and merges that in, so the UI has the full document exactly when it
//     needs it.
//
// The job lives in the API's memory, so a 404 is expected after its TTL (or an API
// restart) and is surfaced as the server's Marathi message, not retried forever.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslateDocumentDetail } from '@dgipr/schemas';
import { getTranslateDocument } from './api';

const POLL_INTERVAL_MS = 2500;

export function useTranslateDocument(id: string | null): {
  detail: TranslateDocumentDetail | null;
  error: string | null;
  gone: boolean;
  refresh: () => Promise<void>;
} {
  const [detail, setDetail] = useState<TranslateDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  // What we have already pulled the full text for, so the heavy fetch happens once per
  // phase rather than on every poll. `sawTranslating` is what makes a RE-translation of a
  // language already present still refetch: the results array does not grow in that case,
  // so counting entries would never notice the new text.
  const fetchedText = useRef<{ pages: boolean; sawTranslating: boolean }>({
    pages: false,
    sawTranslating: false,
  });

  useEffect(() => {
    setDetail(null);
    setError(null);
    setGone(false);
    fetchedText.current = { pages: false, sawTranslating: false };
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const lean = await getTranslateDocument(id);
      if (lean.status === 'translating')
        fetchedText.current.sawTranslating = true;
      // Back to extracting = the user asked for an OCR re-read, which rebuilds the page
      // list from scratch. Without this the cached text from the first read would be kept
      // forever and the user would stare at the very pages they just rejected.
      if (lean.status === 'extracting') fetchedText.current.pages = false;

      const needsPages = !fetchedText.current.pages && lean.pages.length > 0;
      const needsResults =
        fetchedText.current.sawTranslating &&
        lean.status !== 'translating' &&
        lean.results.length > 0;

      if (needsPages || needsResults) {
        const full = await getTranslateDocument(id, true);
        fetchedText.current = {
          pages: full.pages.length > 0,
          sawTranslating: false,
        };
        setDetail(full);
      } else {
        // Keep the text we already hold; only the lean fields can have changed. The
        // server reporting NO pages is not a lean-payload artifact — it means the page
        // list is being rebuilt — so cached pages are dropped with it.
        setDetail((prev) =>
          prev
            ? {
                ...lean,
                pages:
                  prev.pages.length > 0 && lean.pages.length > 0
                    ? prev.pages
                    : lean.pages,
                results:
                  prev.results.length === lean.results.length
                    ? prev.results
                    : lean.results,
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
    id !== null &&
    !gone &&
    (detail === null ||
      detail.status === 'extracting' ||
      detail.status === 'translating');

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
