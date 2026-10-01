'use client';

// The rows under a poster for whatever the officer has marked on it: numbered red marks
// ("change the thing here") with a note each, and lettered blue boxes ("free this space")
// with an optional note and a move/remove toggle. Shared by the social and article poster
// cards so the two cannot drift. The notes are optional when the request goes through the
// edit assistant, which fills a blank one from the conversation; the marks' own send button
// still wants every red mark described.

import type { PosterClearAction } from '@dgipr/schemas';
import { STR } from '../lib/strings';
import { ClearActionToggle, clearActionLabel } from './ClearActionToggle';
// Written in Marathi on an InScript keyboard, which a controlled box can overwrite
// half-formed. See ComposeSafeInput.
import { ComposeSafeInput } from './ComposeSafeInput';
import {
  CLEAR_LETTERS,
  type PosterClearDraft,
  type PosterMarkerDraft,
} from './PosterAnnotator';

export function PosterMarkNotes({
  markers,
  submittedMarkers,
  clearRegions,
  submittedClearRegions,
  onNoteChange,
  onRemoveMarker,
  onClearNoteChange,
  onClearActionChange,
  onRemoveClearRegion,
  disabled = false,
  showReservedWarning = false,
  showClearReservedWarning = false,
}: {
  markers: readonly PosterMarkerDraft[];
  // The last sent round, echoed read-only so the officer can see what they asked for.
  submittedMarkers: readonly PosterMarkerDraft[];
  clearRegions: readonly PosterClearDraft[];
  submittedClearRegions: readonly PosterClearDraft[];
  onNoteChange: (id: number, note: string) => void;
  onRemoveMarker: (id: number) => void;
  onClearNoteChange: (id: number, note: string) => void;
  onClearActionChange: (id: number, action: PosterClearAction) => void;
  onRemoveClearRegion: (id: number) => void;
  disabled?: boolean;
  // A mark sits under the stamped chrome — a soft hint for red marks, a real limitation
  // for blue ones (the chrome is re-stamped after the edit, so that space cannot be freed).
  showReservedWarning?: boolean;
  showClearReservedWarning?: boolean;
}) {
  return (
    <>
      {markers.length > 0 || submittedMarkers.length > 0 ? (
        <div className="marker-notes">
          <p className="hint">
            {markers.length > 0
              ? STR.posterAnnotateHint
              : STR.markersSubmittedHint}
          </p>
          {showReservedWarning && markers.length > 0 ? (
            <p className="hint marker-zone-warning">
              {STR.markerReservedZoneWarning}
            </p>
          ) : null}
          {markers.length === 0
            ? submittedMarkers.map((marker, i) => (
                <div
                  className="marker-note-row marker-note-submitted"
                  key={`s-${marker.id}`}
                >
                  <span className="marker-note-badge" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="marker-note-text">{marker.note}</span>
                </div>
              ))
            : markers.map((marker, i) => (
                <div
                  className="marker-note-row"
                  key={marker.id}
                  // Mark ① is what /learn's coach points at. Inert everywhere else.
                  data-learn={i === 0 ? 'marker-note' : undefined}
                >
                  <span className="marker-note-badge" aria-hidden="true">
                    {i + 1}
                  </span>
                  <ComposeSafeInput
                    type="text"
                    value={marker.note}
                    placeholder={STR.markerNotePlaceholder}
                    aria-label={`${STR.markerLabel} ${i + 1}`}
                    maxLength={500}
                    disabled={disabled}
                    onChange={(next) => onNoteChange(marker.id, next)}
                  />
                  <button
                    type="button"
                    className="marker-note-remove"
                    aria-label={STR.markerRemove}
                    disabled={disabled}
                    onClick={() => onRemoveMarker(marker.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
        </div>
      ) : null}

      {/* The blue "free this space" boxes. Their note is OPTIONAL — an empty one means
          "you decide where that content goes" — so none of these rows can block a send. */}
      {clearRegions.length > 0 || submittedClearRegions.length > 0 ? (
        <div className="marker-notes">
          <p className="hint">
            {clearRegions.length > 0
              ? STR.clearRegionHint
              : STR.clearRegionSubmittedHint}
          </p>
          {showClearReservedWarning && clearRegions.length > 0 ? (
            <p className="hint marker-zone-warning">
              {STR.clearRegionReservedZoneWarning}
            </p>
          ) : null}
          {clearRegions.length === 0
            ? submittedClearRegions.map((c, i) => (
                <div
                  className="marker-note-row marker-note-submitted"
                  key={`sc-${c.id}`}
                >
                  <span
                    className="marker-note-badge clear-badge"
                    aria-hidden="true"
                  >
                    {CLEAR_LETTERS[i] ?? i + 1}
                  </span>
                  <span className="marker-note-text">
                    {clearActionLabel(c.action)}
                    {c.note ? ` — ${c.note}` : ''}
                  </span>
                </div>
              ))
            : clearRegions.map((c, i) => (
                <div key={c.id}>
                  <div className="marker-note-row">
                    <span
                      className="marker-note-badge clear-badge"
                      aria-hidden="true"
                    >
                      {CLEAR_LETTERS[i] ?? i + 1}
                    </span>
                    <ComposeSafeInput
                      type="text"
                      value={c.note}
                      placeholder={STR.clearRegionNotePlaceholder}
                      aria-label={`${STR.clearRegionLabel} ${CLEAR_LETTERS[i] ?? i + 1}`}
                      maxLength={500}
                      disabled={disabled}
                      onChange={(next) => onClearNoteChange(c.id, next)}
                    />
                    <button
                      type="button"
                      className="marker-note-remove"
                      aria-label={STR.clearRegionRemove}
                      disabled={disabled}
                      onClick={() => onRemoveClearRegion(c.id)}
                    >
                      ✕
                    </button>
                  </div>
                  <ClearActionToggle
                    value={c.action}
                    letter={String(CLEAR_LETTERS[i] ?? i + 1)}
                    disabled={disabled}
                    onChange={(action) => onClearActionChange(c.id, action)}
                  />
                </div>
              ))}
        </div>
      ) : null}
    </>
  );
}
