'use client';

// Read-only article display + copy/download actions + the article feedback loop.
// Once an English translation exists (Sarvam + glossary lockdict, produced on
// demand) a मराठी ⇆ English toggle appears and copy/download follow the shown
// language; until then a "Translate to English" button starts the job.

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import { requestTranslation, sendArticleFeedback } from '../lib/api';
import { STR } from '../lib/strings';
import { downloadBlob } from '../lib/download';
import { FeedbackBox } from './FeedbackBox';

export function ArticleView({
  detail,
  onFeedbackSent,
}: {
  detail: GenerationDetail;
  onFeedbackSent: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<'mr' | 'en'>('mr');
  const [requesting, setRequesting] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const marathi = detail.article ?? '';
  const english = detail.articleEnglish;
  const hasEnglish = english !== null && english.length > 0;
  const showEnglish = lang === 'en' && hasEnglish;
  const shown = showEnglish ? english! : marathi;
  const langSuffix = showEnglish ? 'en' : 'mr';

  // The translate job runs beside whatever else is in flight and reports itself on
  // the detail payload rather than through status/step, so this stays accurate while
  // the poster is still rendering. A background failure arrives the same way.
  const translating = detail.translating;
  const error = translateError ?? detail.translateError;

  // The article is shown while the poster phase still runs. Article feedback would
  // rewrite the article the poster's copy was derived from (and 409 against the API's
  // isJobRunning guard), so it waits for the job to settle. Translation doesn't — it
  // only reads the finished article — so it is offered right away.
  const jobActive = detail.status === 'running' || detail.status === 'queued';

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const translate = async () => {
    setRequesting(true);
    setTranslateError(null);
    try {
      await requestTranslation(detail.id);
      await onFeedbackSent();
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="card">
      <div className="article-head">
        <h2 style={{ margin: 0 }}>{STR.articleTitle}</h2>
        {hasEnglish ? (
          <div className="lang-toggle" role="group" aria-label="भाषा">
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={lang === 'mr'}
              onClick={() => setLang('mr')}
            >
              {STR.showMarathi}
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={lang === 'en'}
              onClick={() => setLang('en')}
            >
              {STR.showEnglish}
            </button>
          </div>
        ) : null}
      </div>

      <div className="article-body">{shown}</div>

      <div className="btn-row" style={{ marginTop: 18 }}>
        <button type="button" className="btn" onClick={copyToClipboard}>
          {copied ? STR.copied : STR.copyText}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(
              `lekh-${detail.id}-${langSuffix}.txt`,
              shown,
              'text/plain',
            )
          }
        >
          {STR.downloadTxt}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(
              `lekh-${detail.id}-${langSuffix}.md`,
              shown,
              'text/markdown',
            )
          }
        >
          {STR.downloadMd}
        </button>

        {!hasEnglish &&
          (translating ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.translating}
            </span>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={translate}
              disabled={requesting}
            >
              {requesting ? STR.translating : STR.translateToEnglish}
            </button>
          ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

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

      {!jobActive ? (
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
      ) : null}
    </section>
  );
}
