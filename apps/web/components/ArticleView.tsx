'use client';

// Read-only article display + copy/download actions + the article feedback loop.

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { sendArticleFeedback } from '../lib/api';
import { STR } from '../lib/strings';
import { FeedbackBox } from './FeedbackBox';

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ArticleView({
  detail,
  onFeedbackSent,
}: {
  detail: GenerationDetail;
  onFeedbackSent: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const article = detail.article ?? '';

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(article);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="card">
      <h2>{STR.articleTitle}</h2>
      <div className="article-body">{article}</div>

      <div className="btn-row" style={{ marginTop: 18 }}>
        <button type="button" className="btn" onClick={copyToClipboard}>
          {copied ? STR.copied : STR.copyText}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(`lekh-${detail.id}.txt`, article, 'text/plain')
          }
        >
          {STR.downloadTxt}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(`lekh-${detail.id}.md`, article, 'text/markdown')
          }
        >
          {STR.downloadMd}
        </button>
      </div>

      {detail.factCheck ? (
        <details className="fold">
          <summary>{STR.factCheckTitle}</summary>
          <div className="fold-body">{detail.factCheck}</div>
        </details>
      ) : null}

      <details className="fold">
        <summary>{STR.noteTitle}</summary>
        <div className="fold-body">{detail.note}</div>
      </details>

      <div style={{ marginTop: 18 }}>
        <FeedbackBox
          title={STR.articleFeedbackTitle}
          hint={STR.articleFeedbackHint}
          onSubmit={async (feedback) => {
            await sendArticleFeedback(detail.id, feedback);
            await onFeedbackSent();
          }}
        />
      </div>
    </section>
  );
}
