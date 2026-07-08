'use client';

// Completed-state view for a Twitter/n8n run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface). Shows the poster
// + caption with copy / download / regenerate. No feedback/revise loops in v1.

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { posterDownloadUrl } from '../lib/api';
import { STR } from '../lib/strings';

export function SocialPostView({
  detail,
  onRegenerate,
}: {
  detail: GenerationDetail;
  onRegenerate: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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
            />
          </div>
        ) : null}
        <div>
          {detail.article ? (
            <p className="social-caption">{detail.article}</p>
          ) : null}
          <div className="btn-row" style={{ marginTop: 18 }}>
            {detail.posterUrl ? (
              <a className="btn btn-primary" href={posterDownloadUrl(detail.id)}>
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
              disabled={regenerating}
              onClick={regenerate}
            >
              {STR.taskRegenerate}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
