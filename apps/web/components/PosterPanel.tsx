'use client';

// Poster display + download + manual text edit + the two-choice feedback loop
// ("मजकूर सुधारा" cheap re-render vs "चित्र बदला" new background image).

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { posterDownloadUrl, sendPosterFeedback, updatePosterCopy } from '../lib/api';
import { STR } from '../lib/strings';
import { CopyEditForm } from './CopyEditForm';
import { FeedbackBox } from './FeedbackBox';

export function PosterPanel({
  detail,
  onChanged,
  busy = false,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // True while the server is re-rendering the poster (driven by detail.step).
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<'copy' | 'scene'>('copy');
  // Bridges the gap before the first poll reports `running`, and covers the
  // fully-synchronous manual copy edit (status never leaves `completed`).
  const [pending, setPending] = useState(false);

  if (!detail.posterUrl || !detail.copy) return null;

  const showSpinner = busy || pending;

  return (
    <section className="card">
      <h2>{STR.posterTitle}</h2>
      <div className="poster-layout">
        <div className="poster-frame">
          <img
            src={detail.posterUrl}
            alt={STR.posterTitle}
            className="poster-image"
          />
          {showSpinner ? (
            <div className="poster-loading" aria-live="polite" aria-busy="true">
              <span className="spinner spinner-lg" />
            </div>
          ) : null}
        </div>
        <div>
          <div className="btn-row">
            <a
              className="btn btn-primary"
              href={posterDownloadUrl(detail.id)}
            >
              {STR.downloadPoster}
            </a>
            <button
              type="button"
              className="btn"
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? STR.closeEditCopy : STR.editCopy}
            </button>
          </div>

          {editing ? (
            <div style={{ marginTop: 18 }}>
              <CopyEditForm
                copy={detail.copy}
                onSave={async (copy) => {
                  setPending(true);
                  try {
                    await updatePosterCopy(detail.id, copy);
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              />
            </div>
          ) : null}

          <div style={{ marginTop: 18 }}>
            <FeedbackBox
              title={STR.posterFeedbackTitle}
              onSubmit={async (feedback) => {
                setPending(true);
                try {
                  await sendPosterFeedback(detail.id, { target, feedback });
                  await onChanged();
                } finally {
                  // After onChanged the server reports `running`, so the `busy`
                  // prop keeps the spinner up through the async job.
                  setPending(false);
                }
              }}
            >
              <div className="segmented">
                <button
                  type="button"
                  className="output-option"
                  aria-pressed={target === 'copy'}
                  onClick={() => setTarget('copy')}
                >
                  <span className="name">{STR.posterFeedbackTargetCopy}</span>
                  <span className="desc">{STR.posterFeedbackTargetCopyDesc}</span>
                </button>
                <button
                  type="button"
                  className="output-option"
                  aria-pressed={target === 'scene'}
                  onClick={() => setTarget('scene')}
                >
                  <span className="name">{STR.posterFeedbackTargetScene}</span>
                  <span className="desc">{STR.posterFeedbackTargetSceneDesc}</span>
                </button>
              </div>
            </FeedbackBox>
          </div>
        </div>
      </div>
    </section>
  );
}
