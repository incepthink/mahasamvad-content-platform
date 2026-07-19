'use client';

// Feedback fold for pixel-level (n8n) poster edits: per-marker note inputs for
// the numbered marks placed on the poster via PosterAnnotator, plus an optional
// overall note. Purpose-built rather than extending the shared FeedbackBox —
// the marker rows and the either/or validation (notes OR overall text) don't
// fit its single-textarea contract. Opening the fold activates the annotator.

import { useState } from 'react';
import type {
  PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';
import type { PosterMarkerDraft } from './PosterAnnotator';

export function PosterImageFeedbackBox({
  markers,
  onNoteChange,
  onRemoveMarker,
  onOpenChange,
  onSubmit,
  disabled = false,
  showReservedWarning = false,
  submittedMarkers = [],
}: {
  markers: readonly PosterMarkerDraft[];
  onNoteChange: (id: number, note: string) => void;
  onRemoveMarker: (id: number) => void;
  // <details> open state — the parent uses it to arm the poster annotator.
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: PosterImageFeedbackRequest) => Promise<void>;
  disabled?: boolean;
  // A marker's center sits under the article chrome (logo/footer) — soft hint
  // only, never blocks: the interpreter reads the nearest editable intent.
  showReservedWarning?: boolean;
  // The last sent round, echoed read-only so the user can see what they asked.
  submittedMarkers?: readonly PosterMarkerDraft[];
}) {
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (disabled || sending) return;
    const trimmed = feedback.trim();
    if (markers.length === 0 && trimmed.length < 3) {
      setError(STR.feedbackTooShort);
      return;
    }
    if (markers.some((m) => m.note.trim().length < 3)) {
      setError(STR.markerNoteTooShort);
      return;
    }
    // The schema wants absent keys, not '' / [] (min lengths reject those).
    const payload: PosterImageFeedbackRequest = {
      ...(trimmed.length >= 3 ? { feedback: trimmed } : {}),
      ...(markers.length > 0
        ? {
            annotations: markers.map((m) => ({
              region: m.region,
              note: m.note.trim(),
            })),
          }
        : {}),
    };
    setSending(true);
    setError(null);
    try {
      await onSubmit(payload);
      setFeedback('');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSending(false);
    }
  };

  return (
    <details
      className="fold"
      aria-disabled={disabled}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      <summary>{STR.posterImageFeedbackTitle}</summary>
      <div className="fold-body">
        <p className="hint">{STR.posterAnnotateHint}</p>
        {submittedMarkers.length > 0 && markers.length === 0 ? (
          <>
            <p className="hint">{STR.markersSubmittedHint}</p>
            {submittedMarkers.map((marker, i) => (
              <div
                className="marker-note-row marker-note-submitted"
                key={`s-${marker.id}`}
              >
                <span className="marker-note-badge" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="marker-note-text">{marker.note}</span>
              </div>
            ))}
          </>
        ) : null}
        {showReservedWarning ? (
          <p className="hint marker-zone-warning">
            {STR.markerReservedZoneWarning}
          </p>
        ) : null}
        {markers.map((marker, i) => (
          <div className="marker-note-row" key={marker.id}>
            <span className="marker-note-badge" aria-hidden="true">
              {i + 1}
            </span>
            <input
              type="text"
              value={marker.note}
              placeholder={STR.markerNotePlaceholder}
              aria-label={`${STR.markerLabel} ${i + 1}`}
              maxLength={500}
              disabled={disabled || sending}
              onChange={(e) => onNoteChange(marker.id, e.target.value)}
            />
            <button
              type="button"
              className="marker-note-remove"
              aria-label={STR.markerRemove}
              disabled={disabled || sending}
              onClick={() => onRemoveMarker(marker.id)}
            >
              ✕
            </button>
          </div>
        ))}
        {STR.chipsPosterImage.length > 0 ? (
          <div className="suggestion-row">
            <span className="suggestion-label">
              {STR.feedbackSuggestionsLabel}
            </span>
            {STR.chipsPosterImage.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-chip"
                disabled={disabled || sending}
                onClick={() => {
                  setFeedback(suggestion);
                  setError(null);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={
            markers.length > 0
              ? STR.posterOverallNotePlaceholder
              : STR.feedbackPlaceholder
          }
          rows={3}
          disabled={disabled || sending}
          style={{ marginTop: 10 }}
        />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled || sending}
          >
            {sending ? STR.sendingFeedback : STR.sendFeedback}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}
