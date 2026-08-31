'use client';

// The article arriving live, as `useArticleStream` delivers it.
//
// Shared by every surface that watches a run being drafted (/dlo's workspace and a
// generation's own detail page) rather than copied into each: the two must show the same
// thing, and a second copy would drift the moment one of them was tuned.
//
// Purely a VIEW. The row is still the state of record, so this renders nothing when there is
// no live text — a restarted API, a poster-only lane, ARTICLE_STREAMING=0 — and the caller's
// progress steps are exactly what the officer saw before.

import { PenLine } from 'lucide-react';
import { CardTitle } from './CardTitle';
import { MarkdownText } from './MarkdownText';
import { STR } from '../lib/strings';

export function ArticleDraft({ text }: { text: string }) {
  if (!text) return null;

  return (
    <section className="card">
      <div className="article-head">
        <CardTitle icon={PenLine}>{STR.articleStreamingTitle}</CardTitle>
        <span className="translating-note" aria-live="off">
          <span className="spinner" aria-hidden="true" />
          {STR.articleStreamingBadge}
        </span>
      </div>
      {/* Markdown WHILE it streams, not raw text that recompiles at the end — the /chat
          reasoning, and the same parser: it is a pure function of the string so far, so
          there is nothing to keep in sync and a marker caught mid-token (`#`, `**`) is
          momentarily literal and resolves on the next delta. Rendering it raw meant the
          officer read `# शीर्षक` for the whole draft and then watched the finished article
          reflow under them. The write-head caret is now drawn by CSS on the last block
          (.article-body--streaming), since there is no longer one text node to end.

          aria-live="polite" on a token stream would have a screen reader read the article
          several times over, so the region is announced once and read on completion. */}
      <MarkdownText
        text={text}
        className="article-body article-body--streaming"
      />
    </section>
  );
}
