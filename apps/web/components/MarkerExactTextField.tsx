'use client';

// «हा मजकूर असा हवा» under a red mark: the EXACT text the marked spot must read — a wrong
// digit («९» for «१»), a broken jodakshar. Optional. When filled, that mark is corrected on an
// enlarged crop of its own against a typeset picture of this text, instead of by repainting the
// whole poster, and its note may be left empty. Shared by the poster cards and the carousel
// slide box so the field reads the same everywhere.

import { POSTER_EXACT_TEXT_MAX_CHARS } from '@dgipr/schemas';
import { STR } from '../lib/strings';
// Written in Marathi on an InScript keyboard, which a controlled box can overwrite
// half-formed. See ComposeSafeInput.
import { ComposeSafeInput } from './ComposeSafeInput';
import type { PosterMarkerDraft } from './PosterAnnotator';

export function MarkerExactTextField({
  number,
  value,
  disabled = false,
  onChange,
}: {
  // The mark's badge number, for the accessible name.
  number: number;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="marker-exact-row">
      <span className="marker-exact-label" aria-hidden="true">
        {STR.markerExactTextLabel}
      </span>
      <ComposeSafeInput
        type="text"
        value={value}
        placeholder={STR.markerExactTextPlaceholder}
        aria-label={`${STR.markerLabel} ${number} — ${STR.markerExactTextLabel}`}
        maxLength={POSTER_EXACT_TEXT_MAX_CHARS}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

/** A sent mark as the officer wrote it: the note, and the exact text it asked for. */
export function markerSummary(marker: PosterMarkerDraft): string {
  const exact = marker.exactText.trim();
  if (!exact) return marker.note;
  return marker.note.trim() ? `${marker.note} → «${exact}»` : `→ «${exact}»`;
}

/** A mark can be sent when it says what to change: a note, or the exact text. */
export function markerIsDescribed(marker: PosterMarkerDraft): boolean {
  return marker.note.trim().length >= 3 || marker.exactText.trim().length > 0;
}
