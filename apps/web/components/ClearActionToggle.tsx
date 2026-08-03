'use client';

// The per-box action choice on a blue "free this space" rectangle: move the
// content inside somewhere else on the poster, or delete it outright.
//
// It is its own component because BOTH poster surfaces render clear-space rows —
// PosterImageFeedbackBox (article + YouTube lanes) and SocialPostView (the
// twitter/facebook card) — and they are already near-copies of each other. A
// second inline copy of this control is exactly how the two would come to
// disagree about what the officer chose.
//
// Why the choice is explicit rather than read off the note: the two are opposite
// edits with opposite permissions in the image prompt. 'displace' licenses a
// re-layout of the whole poster (the content has to go somewhere), 'remove'
// forbids moving anything at all. Guessing which one a Marathi note meant would
// buy a wrong paid render.

import type { PosterClearAction } from '@dgipr/schemas';
import { STR } from '../lib/strings';

export function ClearActionToggle({
  value,
  onChange,
  disabled = false,
  letter,
}: {
  value: PosterClearAction;
  onChange: (action: PosterClearAction) => void;
  disabled?: boolean;
  // The box's badge letter, so the group's accessible name says WHICH box this
  // is — several rows are on screen at once and they are otherwise identical.
  letter: string;
}) {
  const options: readonly [PosterClearAction, string][] = [
    ['displace', STR.clearActionDisplace],
    ['remove', STR.clearActionRemove],
  ];
  return (
    <div className="clear-action-row">
      <span className="clear-action-label">{STR.clearActionLabel}</span>
      <div
        className="clear-action-toggle"
        role="group"
        aria-label={`${STR.clearRegionLabel} ${letter} — ${STR.clearActionLabel}`}
      >
        {options.map(([action, label]) => (
          <button
            key={action}
            type="button"
            aria-pressed={value === action}
            disabled={disabled}
            onClick={() => onChange(action)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// The same choice rendered read-only, for the last-sent round echoed under the
// poster. Shown as plain text rather than a disabled toggle: that round is a
// record of what was asked, not a control.
export function clearActionLabel(action: PosterClearAction): string {
  return action === 'remove' ? STR.clearActionRemove : STR.clearActionDisplace;
}
