'use client';

// Thumbnail strip of every stored poster render for a generation. Renders are
// immutable versioned PNGs, so older versions stay viewable — the strip appears
// once a revision produced a second version.
//
// Clicking a thumbnail SELECTS it: the server moves the row's posterPath onto that existing
// object, so every edit path (image/marker feedback, redesign, publish, download) continues
// from it. That is one column update — nothing is copied, nothing is appended, and the strip
// keeps exactly the same thumbnails, so switching back and forth is free and instant.
//
// Every thumbnail is the SAME control — one button, no per-thumbnail labels or links, and
// each keeps its own fixed name. Selection is shown the way the rest of the app shows it:
// the accent border. A "पाहा" link and a hover "restore" caption were tried and dropped; in
// a dense 120px strip they read as two competing actions on one picture, when the only
// gesture here is "make this one current".

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { restorePosterVersion } from '../lib/api';
import { STR, formatDate } from '../lib/strings';

export function PosterVersionStrip({
  detail,
  onChanged,
  onRestoringChange,
  busy = false,
}: {
  detail: GenerationDetail;
  // Refetch the run so the restored poster becomes the one on screen. Optional so the
  // strip stays usable (view-only) from any caller that has nothing to refresh.
  onChanged?: () => Promise<void>;
  // Raised while a switch is in flight, so the caller can put its existing spinner over
  // the big poster — the picture that has NOT caught up yet. The strip cannot show it
  // itself: the thumbnail is already correct the moment it is pressed (the border moves
  // optimistically), and the wait belongs to the image the officer is watching.
  onRestoringChange?: (restoring: boolean) => void;
  // True while the server is already re-rendering this poster.
  busy?: boolean;
}) {
  // The version being restored (1-based), so only that thumbnail shows the pending state.
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versions = detail.posterVersions;
  if (versions.length < 2) return null;

  const canRestore = !!onChanged && !busy && restoring === null;

  // Which thumbnail wears the border. Matched on the row's CURRENT poster, not on "the last
  // one" — restoring moves the pointer without appending, so the newest render and the
  // selected render are no longer the same thing. `restoring` wins while a click is in
  // flight, so the border moves on press instead of after the round trip.
  const selectedIndex =
    restoring !== null
      ? restoring - 1
      : Math.max(
          0,
          versions.findIndex(
            (version) => version.posterUrl === detail.posterUrl,
          ),
        );

  async function restore(version: number) {
    if (!onChanged) return;
    setRestoring(version);
    setError(null);
    onRestoringChange?.(true);
    try {
      await restorePosterVersion(detail.id, version);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoring(null);
      onRestoringChange?.(false);
    }
  }

  return (
    <div className="poster-versions">
      <h3 className="poster-versions-title">{STR.posterVersionsTitle}</h3>
      {onChanged ? (
        <p className="hint poster-versions-hint">{STR.posterVersionsHint}</p>
      ) : null}
      <div className="poster-versions-strip">
        {versions.map((version, index) => {
          const number = index + 1;
          const isCurrent = index === selectedIndex;
          // A version's name is fixed by its position in the history and never moves —
          // "सद्य" is the border's job, and a label that hopped between thumbnails as the
          // officer switched would make the strip look like it had been rewritten.
          const tag =
            index === 0
              ? STR.posterVersionOriginal
              : `${STR.posterVersionLabel} ${number}`;
          return (
            <button
              key={version.posterUrl}
              type="button"
              className="poster-versions-thumb"
              aria-current={isCurrent ? 'true' : undefined}
              // The selected version is the state, not an action — pressing it would do
              // nothing, so it is disabled rather than rendered as a different thing.
              disabled={isCurrent || !canRestore}
              title={`${tag} · ${formatDate(version.createdAt)}${
                isCurrent ? ` · ${STR.posterVersionCurrent}` : ''
              }`}
              onClick={() => void restore(number)}
            >
              <img src={version.posterUrl} alt={tag} loading="lazy" />
              <span className="poster-versions-tag">{tag}</span>
            </button>
          );
        })}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
