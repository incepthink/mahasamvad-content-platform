'use client';

// Owns the click-to-point annotation state for a poster panel (article + twitter).
//
// TWO gestures, each with its own pair of sets:
//   markers      — RED numbered boxes: "change the element here" (needs a note).
//   clearRegions — BLUE lettered boxes: "free this space" so the officer can drop
//                  their own logo/photo in later (the note is OPTIONAL).
//
// Each gesture keeps an editable set (the current round) and a submitted set (the
// last sent round, shown inert through the re-render AND on the new poster —
// regions are normalized 0..1, so the boxes land where the change was applied).
// Both gestures travel in ONE round, so one paid render can carry both.
// Client state only: lost on reload (regions are never persisted server-side).

import { useEffect, useRef, useState } from 'react';
import type {
  FeedbackRegion,
  GenerationDetail,
  PosterClearAction,
} from '@dgipr/schemas';
import type {
  PosterClearDraft,
  PosterMarkerDraft,
} from '../components/PosterAnnotator';

export function usePosterMarkers(
  detail: Pick<GenerationDetail, 'posterUrl' | 'status'>,
) {
  const [markers, setMarkers] = useState<PosterMarkerDraft[]>([]);
  const [submittedMarkers, setSubmittedMarkers] = useState<
    readonly PosterMarkerDraft[] | null
  >(null);
  const [clearRegions, setClearRegions] = useState<PosterClearDraft[]>([]);
  const [submittedClearRegions, setSubmittedClearRegions] = useState<
    readonly PosterClearDraft[] | null
  >(null);
  const nextMarkerId = useRef(1);
  const nextClearId = useRef(1);

  // Editable annotations point at the CURRENT pixels; a new poster (image feedback
  // OR the html-path text/scene feedback) invalidates them. Deliberately does
  // NOT touch the submitted sets — those must survive the version change.
  useEffect(() => {
    setMarkers([]);
    setClearRegions([]);
  }, [detail.posterUrl]);

  // Restore the submitted round into the editable sets on the TRANSITION into
  // 'failed' so the user can resubmit without re-placing. The prevStatus ref
  // keeps it off for rounds submitted while the row was already failed; it
  // can't loop — after one restore both submitted sets are null.
  const prevStatus = useRef(detail.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = detail.status;
    if (detail.status !== 'failed' || prev === 'failed') return;
    if (submittedMarkers) {
      setMarkers([...submittedMarkers]);
      setSubmittedMarkers(null);
    }
    if (submittedClearRegions) {
      setClearRegions([...submittedClearRegions]);
      setSubmittedClearRegions(null);
    }
  }, [detail.status, submittedMarkers, submittedClearRegions]);

  // Placing anything new starts a new round, so BOTH shown rounds go away — the
  // 1..n / A..n numbering must never mix submitted and editable annotations, and
  // the two gestures are submitted together.
  const startRound = () => {
    setSubmittedMarkers(null);
    setSubmittedClearRegions(null);
  };

  const addMarker = (region: FeedbackRegion) => {
    startRound();
    setMarkers((ms) => [
      ...ms,
      { id: nextMarkerId.current++, region, note: '' },
    ]);
  };
  const removeMarker = (id: number) =>
    setMarkers((ms) => ms.filter((m) => m.id !== id));
  const setNote = (id: number, note: string) =>
    setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, note } : m)));

  // 'displace' by default — what this gesture has always meant, and the safer
  // default of the two: it cannot lose information if the officer never looks at
  // the toggle. 'remove' deletes, so it must be chosen deliberately.
  const addClearRegion = (region: FeedbackRegion) => {
    startRound();
    setClearRegions((cs) => [
      ...cs,
      { id: nextClearId.current++, region, note: '', action: 'displace' },
    ]);
  };
  const removeClearRegion = (id: number) =>
    setClearRegions((cs) => cs.filter((c) => c.id !== id));
  const setClearNote = (id: number, note: string) =>
    setClearRegions((cs) => cs.map((c) => (c.id === id ? { ...c, note } : c)));
  const setClearAction = (id: number, action: PosterClearAction) =>
    setClearRegions((cs) => cs.map((c) => (c.id === id ? { ...c, action } : c)));

  // Call after a successful send. Reads both sets from the render the submit
  // started in — safe because the note inputs and annotator are disabled while
  // sending, so neither set can change mid-flight.
  const markSubmitted = () => {
    if (markers.length > 0) setSubmittedMarkers(markers);
    if (clearRegions.length > 0) setSubmittedClearRegions(clearRegions);
    setMarkers([]);
    setClearRegions([]);
  };
  const dismissSubmitted = () => {
    setSubmittedMarkers(null);
    setSubmittedClearRegions(null);
  };

  return {
    markers,
    submittedMarkers: submittedMarkers ?? [],
    addMarker,
    removeMarker,
    setNote,
    clearRegions,
    submittedClearRegions: submittedClearRegions ?? [],
    addClearRegion,
    removeClearRegion,
    setClearNote,
    setClearAction,
    markSubmitted,
    dismissSubmitted,
  };
}
