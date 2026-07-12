'use client';

// Placeholder poster card shown while the article is already on screen but the
// poster render (n8n, ~1–2 min) is still in flight. Mirrors PosterPanel's shell;
// the real PosterPanel replaces it automatically once polling delivers posterUrl.

import type { GenerationDetail } from '@dgipr/schemas';
import { STR, STEP_LABELS } from '../lib/strings';

export function PosterSkeleton({ detail }: { detail: GenerationDetail }) {
  // Live label for the poster phase; the tiny pre-'copy' gap (article persisted
  // while step still reads 'faithfulness') falls back to a generic line.
  const label =
    detail.step === 'copy' ||
    detail.step === 'scene' ||
    detail.step === 'render'
      ? STEP_LABELS[detail.step]
      : STR.posterPreparing;

  return (
    <section className="card">
      <h2>{STR.posterTitle}</h2>
      <div className="poster-layout">
        <div className="poster-frame">
          <div className="poster-skeleton" aria-busy="true">
            <span className="spinner spinner-lg" aria-hidden="true" />
          </div>
        </div>
        <p className="translating-note" aria-live="polite">
          {label}
        </p>
      </div>
    </section>
  );
}
