'use client';

// /transcribe's submit card: the one button that starts a run, and whatever stopped it from
// starting.
//
// It sits in its own card BELOW the picker rather than inside it, which is the shape every
// other intake surface on the platform uses (/dlo ends the same way). The picker is then only
// about the files, and the action is where the eye already goes looking for it — at the bottom
// of the form, not buried under the list of recordings.

import { STR } from '../lib/strings';

export function TranscriptionSubmit({
  onSubmit,
  submitting,
  busy,
  error,
}: {
  onSubmit: () => void;
  submitting: boolean;
  // A run of this browser's is still going. Submitting a second is allowed — the API has no
  // concurrency limit — but the button says so, since the result card shows one run at a time.
  busy: boolean;
  error: string | null;
}) {
  return (
    <section className="card card-action">
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={submitting || busy}
        >
          {submitting ? STR.submitting : STR.transcribeSubmit}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
