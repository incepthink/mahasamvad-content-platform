'use client';

// Completed-state view for a Twitter/n8n run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface). Shows the poster
// + caption with copy / download / regenerate and iterative poster image feedback.

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { posterDownloadUrl, sendPosterImageFeedback } from '../lib/api';
import { STR } from '../lib/strings';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { PosterAnnotator } from './PosterAnnotator';
import { PosterImageFeedbackBox } from './PosterImageFeedbackBox';
import { PosterVersionStrip } from './PosterVersionStrip';

export function SocialPostView({
  detail,
  onRegenerate,
  onChanged,
  busy = false,
}: {
  detail: GenerationDetail;
  onRegenerate: () => Promise<void>;
  onChanged: () => Promise<void>;
  busy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [pending, setPending] = useState(false);
  // Numbered click-to-point markers for pixel feedback (see PosterAnnotator).
  // The last sent round stays on screen inert (usePosterMarkers) so the user
  // can see what they asked for.
  const {
    markers,
    submittedMarkers,
    addMarker,
    removeMarker,
    setNote,
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers(detail);
  const [annotOpen, setAnnotOpen] = useState(false);
  const showSpinner = busy || pending;

  const copyCaption = async () => {
    if (!detail.article) return;
    try {
      await navigator.clipboard.writeText(detail.article);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <section className="card">
      <h2>{STR.posterTitle}</h2>
      <div className="poster-layout">
        {detail.posterUrl ? (
          <div className="poster-frame">
            <img
              src={detail.posterUrl}
              alt={STR.posterTitle}
              className="poster-image"
              draggable={false}
            />
            <PosterAnnotator
              markers={markers}
              onAdd={addMarker}
              onRemove={removeMarker}
              active={annotOpen && !showSpinner}
              disabled={showSpinner}
              submittedMarkers={submittedMarkers}
              onDismissSubmitted={dismissSubmitted}
            />
            {showSpinner ? (
              <div
                className="poster-loading"
                aria-live="polite"
                aria-busy="true"
              >
                <span className="spinner spinner-lg" />
              </div>
            ) : null}
          </div>
        ) : null}
        <div>
          {detail.article ? (
            <p className="social-caption">{detail.article}</p>
          ) : null}
          <div className="btn-row" style={{ marginTop: 18 }}>
            {detail.posterUrl ? (
              <a
                className="btn btn-primary"
                href={posterDownloadUrl(detail.id)}
              >
                {STR.taskDownloadPoster}
              </a>
            ) : null}
            {detail.article ? (
              <button type="button" className="btn" onClick={copyCaption}>
                {copied ? STR.copied : STR.taskCopyCaption}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={regenerating || showSpinner}
              onClick={regenerate}
            >
              {STR.taskRegenerate}
            </button>
          </div>
          {detail.posterUrl ? (
            <div className="poster-feedback">
              <PosterImageFeedbackBox
                markers={markers}
                onNoteChange={setNote}
                onRemoveMarker={removeMarker}
                onOpenChange={setAnnotOpen}
                disabled={showSpinner}
                submittedMarkers={submittedMarkers}
                onSubmit={async (payload) => {
                  setPending(true);
                  try {
                    await sendPosterImageFeedback(detail.id, payload);
                    markSubmitted();
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <PosterVersionStrip detail={detail} />
    </section>
  );
}
