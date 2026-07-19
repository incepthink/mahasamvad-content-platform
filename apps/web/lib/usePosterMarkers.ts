'use client';

// Owns the click-to-point marker state for a poster panel (article + twitter).
// Two sets: `markers` (editable, current round) and `submittedMarkers` (the last
// sent round, shown inert through the re-render AND on the new poster — regions
// are normalized 0..1, so the boxes land where the change was applied). Client
// state only: lost on reload (marker regions are never persisted server-side).

import { useEffect, useRef, useState } from 'react';
import type { FeedbackRegion, GenerationDetail } from '@dgipr/schemas';
import type { PosterMarkerDraft } from '../components/PosterAnnotator';

export function usePosterMarkers(
  detail: Pick<GenerationDetail, 'posterUrl' | 'status'>,
) {
  const [markers, setMarkers] = useState<PosterMarkerDraft[]>([]);
  const [submittedMarkers, setSubmittedMarkers] = useState<
    readonly PosterMarkerDraft[] | null
  >(null);
  const nextMarkerId = useRef(1);

  // Editable markers point at the CURRENT pixels; a new poster (image feedback
  // OR the html-path text/scene feedback) invalidates them. Deliberately does
  // NOT touch submittedMarkers — that set must survive the version change.
  useEffect(() => {
    setMarkers([]);
  }, [detail.posterUrl]);

  // Restore the submitted round into the editable set on the TRANSITION into
  // 'failed' so the user can resubmit without re-placing. The prevStatus ref
  // keeps it off for rounds submitted while the row was already failed; it
  // can't loop — after one restore submittedMarkers is null.
  const prevStatus = useRef(detail.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = detail.status;
    if (detail.status === 'failed' && prev !== 'failed' && submittedMarkers) {
      setMarkers([...submittedMarkers]);
      setSubmittedMarkers(null);
    }
  }, [detail.status, submittedMarkers]);

  const addMarker = (region: FeedbackRegion) => {
    // Placing a new marker starts a new round; the shown previous round goes
    // away so 1..n numbering never mixes submitted and editable markers.
    setSubmittedMarkers(null);
    setMarkers((ms) => [
      ...ms,
      { id: nextMarkerId.current++, region, note: '' },
    ]);
  };
  const removeMarker = (id: number) =>
    setMarkers((ms) => ms.filter((m) => m.id !== id));
  const setNote = (id: number, note: string) =>
    setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, note } : m)));
  // Call after a successful send. Reads `markers` from the render the submit
  // started in — safe because the note inputs and annotator are disabled while
  // sending, so the set cannot change mid-flight.
  const markSubmitted = () => {
    if (markers.length > 0) setSubmittedMarkers(markers);
    setMarkers([]);
  };
  const dismissSubmitted = () => setSubmittedMarkers(null);

  return {
    markers,
    submittedMarkers: submittedMarkers ?? [],
    addMarker,
    removeMarker,
    setNote,
    markSubmitted,
    dismissSubmitted,
  };
}
