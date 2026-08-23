'use client';

// Feedback fold for pixel-level (n8n) poster edits: per-marker note inputs for
// the marks placed on the poster via PosterAnnotator, plus an optional overall
// note. Purpose-built rather than extending the shared FeedbackBox — the marker
// rows and the either/or validation (notes OR overall text) don't fit its
// single-textarea contract. Opening the fold activates the annotator.
//
// Two gestures share the fold, chosen by a pill pair that only decides what the
// NEXT drawn box becomes: red "change the element here" markers, and blue "free
// this space" rectangles whose content the image model relocates so the officer
// can place their own logo or photo there. Both are sent in ONE round, so
// switching pills never discards anything.

import { useState } from 'react';
import type {
  PosterClearAction,
  PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { ClearActionToggle, clearActionLabel } from './ClearActionToggle';
// Marker notes and the overall note are written in Marathi on an InScript keyboard, which a
// controlled box can overwrite half-formed. See ComposeSafeInput.
import { ComposeSafeInput, ComposeSafeTextarea } from './ComposeSafeInput';
import { ErrorNotice } from './ErrorNotice';
import {
  CLEAR_LETTERS,
  type AnnotatorMode,
  type PosterClearDraft,
  type PosterMarkerDraft,
} from './PosterAnnotator';

export function PosterImageFeedbackBox({
  markers,
  onNoteChange,
  onRemoveMarker,
  onOpenChange,
  onSubmit,
  disabled = false,
  showReservedWarning = false,
  submittedMarkers = [],
  mode = 'mark',
  onModeChange,
  clearRegions = [],
  onClearNoteChange,
  onClearActionChange,
  onRemoveClearRegion,
  submittedClearRegions = [],
  showClearReservedWarning = false,
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
  mode?: AnnotatorMode;
  onModeChange?: (mode: AnnotatorMode) => void;
  clearRegions?: readonly PosterClearDraft[];
  onClearNoteChange?: (id: number, note: string) => void;
  onClearActionChange?: (id: number, action: PosterClearAction) => void;
  onRemoveClearRegion?: (id: number) => void;
  submittedClearRegions?: readonly PosterClearDraft[];
  // Unlike the marker warning this one is a real limitation, not a hint: the
  // chrome is re-stamped in code after the edit, so that space cannot be freed.
  showClearReservedWarning?: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (disabled || sending) return;
    const trimmed = feedback.trim();
    if (markers.length === 0 && clearRegions.length === 0 && trimmed.length < 3) {
      setError(STR.feedbackTooShort);
      return;
    }
    if (markers.some((m) => m.note.trim().length < 3)) {
      setError(STR.markerNoteTooShort);
      return;
    }
    // The schema wants absent keys, not '' / [] (min lengths reject those). A
    // clear region's note is genuinely optional — an empty one means "you decide
    // where that content goes" — so it is omitted rather than sent blank.
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
      ...(clearRegions.length > 0
        ? {
            clearRegions: clearRegions.map((c) => ({
              region: c.region,
              action: c.action,
              ...(c.note.trim().length > 0 ? { note: c.note.trim() } : {}),
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
      setError(errorMessage(e));
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
        {onModeChange ? (
          <div className="segmented annot-mode-row">
            <button
              type="button"
              className="output-option"
              aria-pressed={mode === 'mark'}
              disabled={disabled || sending}
              onClick={() => onModeChange('mark')}
            >
              <span className="name">{STR.posterImageFeedbackTitle}</span>
            </button>
            <button
              type="button"
              className="output-option"
              aria-pressed={mode === 'clear'}
              disabled={disabled || sending}
              onClick={() => onModeChange('clear')}
            >
              <span className="name">{STR.iconClearSpace}</span>
            </button>
          </div>
        ) : null}
        <p className="hint">
          {mode === 'clear' ? STR.clearRegionHint : STR.posterAnnotateHint}
        </p>
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
            <ComposeSafeInput
              type="text"
              value={marker.note}
              placeholder={STR.markerNotePlaceholder}
              aria-label={`${STR.markerLabel} ${i + 1}`}
              maxLength={500}
              disabled={disabled || sending}
              onChange={(next) => onNoteChange(marker.id, next)}
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
        {showClearReservedWarning ? (
          <p className="hint marker-zone-warning">
            {STR.clearRegionReservedZoneWarning}
          </p>
        ) : null}
        {/* Blue "free this space" rows. The note is optional here, so none of
            these can block a send — an empty one means "you decide". */}
        {submittedClearRegions.length > 0 && clearRegions.length === 0 ? (
          <>
            <p className="hint">{STR.clearRegionSubmittedHint}</p>
            {submittedClearRegions.map((c, i) => (
              <div
                className="marker-note-row marker-note-submitted"
                key={`sc-${c.id}`}
              >
                <span className="marker-note-badge clear-badge" aria-hidden="true">
                  {CLEAR_LETTERS[i] ?? i + 1}
                </span>
                <span className="marker-note-text">
                  {clearActionLabel(c.action)}
                  {c.note ? ` — ${c.note}` : ''}
                </span>
              </div>
            ))}
          </>
        ) : null}
        {clearRegions.map((c, i) => (
          <div key={`c-${c.id}`}>
            <div className="marker-note-row">
              <span className="marker-note-badge clear-badge" aria-hidden="true">
                {CLEAR_LETTERS[i] ?? i + 1}
              </span>
              <ComposeSafeInput
                type="text"
                value={c.note}
                placeholder={STR.clearRegionNotePlaceholder}
                aria-label={`${STR.clearRegionLabel} ${CLEAR_LETTERS[i] ?? i + 1}`}
                maxLength={500}
                disabled={disabled || sending}
                onChange={(next) => onClearNoteChange?.(c.id, next)}
              />
              <button
                type="button"
                className="marker-note-remove"
                aria-label={STR.clearRegionRemove}
                disabled={disabled || sending}
                onClick={() => onRemoveClearRegion?.(c.id)}
              >
                ✕
              </button>
            </div>
            <ClearActionToggle
              value={c.action}
              letter={String(CLEAR_LETTERS[i] ?? i + 1)}
              disabled={disabled || sending}
              onChange={(action) => onClearActionChange?.(c.id, action)}
            />
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
        <ComposeSafeTextarea
          value={feedback}
          onChange={setFeedback}
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
        {error ? <ErrorNotice message={error} /> : null}
      </div>
    </details>
  );
}
