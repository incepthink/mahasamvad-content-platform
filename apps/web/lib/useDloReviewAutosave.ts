'use client';

// Autosave for the /dlo review step, so leaving the page costs nothing already paid for.
//
// What it saves and why it must be a DEBOUNCE rather than a save-on-transition: the pointer
// summary and the prepared names arrive at one moment and could be saved on arrival, but the
// OCR corrections are continuous typing, and losing mid-correction work is precisely what this
// exists to prevent. So: one mechanism, 1200 ms after the last change to anything.
//
// Three rules worth keeping:
//
//   * FLUSH BEFORE GENERATE. `flush()` is awaited by the generate handler, so the blob on the
//     server and the combinedText that becomes the article can never disagree.
//   * FLUSH ON HIDE. pagehide / visibilitychange with keepalive, because closing the tab is
//     the most likely way an officer leaves.
//   * ONLY WHILE READY. Nothing is worth saving before the review step exists, and staying
//     quiet during extract/re-extract keeps officer writes clear of the job's own writes.
//
// Conflict handling is warn-never-lock. The list is shared and there is no login, so two
// officers can open one intake; the blob carries this tab's `writer` id, and reading back a
// different one means someone else saved. We surface that and offer their copy — we never
// overwrite what is on screen, and we never block the save.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DLO_REVIEW_STATE_MAX_CHARS,
  serializeDloReviewState,
  type DloCategory,
  type DloReviewState,
} from '@dgipr/schemas';
import { saveDloReview } from './api';
import { reviewWriterId } from './dloDraft';
import { STR } from './strings';

const DEBOUNCE_MS = 1200;

export type DloReviewSnapshot = Readonly<{
  edits: Readonly<Record<string, string>>;
  excluded: ReadonlySet<string>;
  styleReference: string;
  pointers: DloReviewState['pointers'];
  designations: DloReviewState['designations'];
  category: DloCategory;
  heading: string;
}>;

export function useDloReviewAutosave(
  intakeId: string | null,
  enabled: boolean,
  snapshot: DloReviewSnapshot,
): {
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
  conflict: boolean;
  flush: () => Promise<void>;
  // Called after the officer accepts the server's copy, so the banner clears.
  acknowledgeConflict: () => void;
  // Called when seeding from a fetched blob, so a foreign writer is not mistaken for a conflict
  // on the very first read.
  adoptWriter: (writer: string) => void;
} {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // The last blob we sent, so an unchanged snapshot never re-sends. Comparing serialized JSON
  // is what makes the deterministic `excluded` sort in serializeDloReviewState load-bearing:
  // an unsorted array would differ every render and save forever.
  const lastSentRef = useRef<string | null>(null);
  // Who wrote the state we believe is on the server: whatever we seeded from, then ourselves
  // after each successful save. A PATCH reporting it replaced someone ELSE's blob means a
  // second officer has been editing the same intake since we loaded it.
  const lastSeenWriterRef = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const intakeIdRef = useRef(intakeId);
  intakeIdRef.current = intakeId;

  const build = useCallback((): {
    state: DloReviewState;
    body: string;
  } | null => {
    const current = snapshotRef.current;
    const state = serializeDloReviewState({
      edits: current.edits,
      excluded: current.excluded,
      ...(current.styleReference.trim()
        ? { styleReference: current.styleReference }
        : {}),
      ...(current.pointers ? { pointers: current.pointers } : {}),
      ...(current.designations ? { designations: current.designations } : {}),
      writer: reviewWriterId(),
    });
    // `updatedAt` changes every call, so it is blanked in the comparison key — otherwise
    // nothing would ever look unchanged and the autosave would run forever.
    return { state, body: JSON.stringify({ ...state, updatedAt: '' }) };
  }, []);

  const save = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const id = intakeIdRef.current;
      if (!id || !enabledRef.current) return;
      const built = build();
      if (!built) return;
      if (built.body === lastSentRef.current) return;

      // Checked here rather than only server-side so the officer gets an actionable Marathi
      // message instead of an opaque 400 or a silent 413 at the body limit.
      if (JSON.stringify(built.state).length > DLO_REVIEW_STATE_MAX_CHARS) {
        setSaveError(STR.dloReviewTooLargeToSave);
        return;
      }

      setSaving(true);
      try {
        const result = await saveDloReview(id, {
          reviewState: built.state,
          category: snapshotRef.current.category,
          heading: snapshotRef.current.heading.trim(),
        });
        lastSentRef.current = built.body;
        setSavedAt(result.updatedAt);
        setSaveError(null);
        // We just replaced somebody's blob. If it was not the one we believed was there — our
        // own last save, or whatever we seeded from — a second officer is editing this intake.
        // Warn; never roll back what is on screen, and never block the save.
        if (
          result.previousWriter !== null &&
          result.previousWriter !== lastSeenWriterRef.current
        ) {
          setConflict(true);
        }
        lastSeenWriterRef.current = reviewWriterId();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : STR.dloReviewSaveFailed);
      } finally {
        setSaving(false);
      }
      void options;
    },
    [build],
  );

  // The debounce. Keyed on the serialized snapshot so an idle re-render does not restart it.
  const key = enabled && intakeId ? (build()?.body ?? '') : '';
  useEffect(() => {
    if (!enabled || !intakeId) return;
    const timer = setTimeout(() => void save(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, enabled, intakeId, save]);

  // Closing the tab is the likeliest way an officer leaves mid-correction.
  useEffect(() => {
    if (!enabled || !intakeId) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save({ keepalive: true });
    };
    const onPageHide = () => void save({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled, intakeId, save]);

  const flush = useCallback(async () => {
    await save();
  }, [save]);

  const acknowledgeConflict = useCallback(() => setConflict(false), []);

  // Seeding from a stored blob adopts its identity, so resuming one's own work in a new tab
  // (which mints a new writer id) is not reported as a conflict — only a save that lands
  // between this load and our next save is.
  const adoptWriter = useCallback((writer: string) => {
    lastSeenWriterRef.current = writer;
    lastSentRef.current = null;
    setConflict(false);
  }, []);

  return {
    saving,
    savedAt,
    saveError,
    conflict,
    flush,
    acknowledgeConflict,
    adoptWriter,
  };
}
