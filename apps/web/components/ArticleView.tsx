'use client';

// Read-only article display + copy/download actions + the article feedback loop.
// Every translation starts with the in-page name check (TranslationTermsReview):
// "Translate to English" first fetches the article's proper nouns for the user to
// confirm/correct, and only the confirmed spellings — locked — reach the Sarvam
// translation. Once English exists a मराठी ⇆ English toggle appears, copy/download
// follow the shown language, and a fold offers the same name check again for a
// re-translate (a wrong spelling noticed late is fixed right here, not on /glossary).

import { useState } from 'react';
import type {
  GenerationDetail,
  PrepareTranslationResponse,
  TranslationTermInput,
} from '@dgipr/schemas';
import {
  prepareGenerationTranslation,
  requestTranslation,
  sendArticleFeedback,
} from '../lib/api';
import { STR } from '../lib/strings';
import { downloadBlob } from '../lib/download';
import { FeedbackBox } from './FeedbackBox';
import { TranslationTermsReview } from './TranslationTermsReview';

export function ArticleView({
  detail,
  onFeedbackSent,
}: {
  detail: GenerationDetail;
  onFeedbackSent: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [lang, setLang] = useState<'mr' | 'en'>('mr');
  // Name-check flow: idle → preparing (extracting names) → review (card shown);
  // confirming covers the translate POST fired from the review card.
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [confirming, setConfirming] = useState(false);
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

  // Article feedback is offered as soon as the article is on screen — including while
  // the poster still renders. The revision runs beside the poster job and reports
  // itself through detail.articleRevising (like translation), not status/step, so the
  // box only has to reflect that flag: swap to an inline spinner while a revise is in
  // flight, otherwise stay interactive. (A settled-run edit flips status and swaps the
  // whole page to ProgressSteps, unmounting this view, so no gate is needed here.)
  const revising = detail.articleRevising;

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Step 1 of translating: fetch the article's names for review. On failure the
  // flow returns to idle with a Marathi error — never silently translating with
  // unchecked names.
  const startNameCheck = async () => {
    setPrep('preparing');
    setTranslateError(null);
    try {
      const result = await prepareGenerationTranslation(detail.id);
      setPrepared(result.terms);
      setPrep('review');
    } catch {
      setTranslateError(STR.namesPrepareError);
      setPrep('idle');
    }
  };

  // Step 2: the user confirmed the spellings — start the translation with them
  // locked. The job reports itself through detail.translating, so after the
  // refresh the existing spinner takes over.
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    setConfirming(true);
    setTranslateError(null);
    try {
      await requestTranslation(detail.id, terms);
      setPrep('idle');
      setPrepared(null);
      await onFeedbackSent();
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setConfirming(false);
    }
  };

  const cancelNameCheck = () => {
    setPrep('idle');
    setPrepared(null);
  };

  // Shared body for the name-check flow (initial translate and the re-translate
  // fold): spinner while extracting, then the review card.
  const nameCheckBody =
    prep === 'preparing' ? (
      <span className="translating-note">
        <span className="spinner" aria-hidden="true" />
        {STR.namesChecking}
      </span>
    ) : prep === 'review' && prepared ? (
      <TranslationTermsReview
        terms={prepared}
        busy={confirming}
        onConfirm={confirmTranslate}
        onCancel={cancelNameCheck}
      />
    ) : null;

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
          ) : prep === 'idle' ? (
            <button type="button" className="btn" onClick={startNameCheck}>
              {STR.translateToEnglish}
            </button>
          ) : null)}
      </div>

      {!hasEnglish && !translating ? nameCheckBody : null}

      {error ? <p className="form-error">{error}</p> : null}

      {hasEnglish ? (
        <details className="fold">
          <summary>{STR.retranslateFold}</summary>
          <div className="fold-body">
            {translating ? (
              <span className="translating-note">
                <span className="spinner" aria-hidden="true" />
                {STR.translating}
              </span>
            ) : prep === 'idle' ? (
              <button
                type="button"
                className="btn btn-small"
                onClick={startNameCheck}
              >
                {STR.namesStartCheck}
              </button>
            ) : (
              nameCheckBody
            )}
          </div>
        </details>
      ) : null}

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
        {revising ? (
          <span className="translating-note">
            <span className="spinner" aria-hidden="true" />
            {STR.revisingArticle}
          </span>
        ) : (
          <FeedbackBox
            title={STR.articleFeedbackTitle}
            hint={STR.articleFeedbackHint}
            suggestions={STR.chipsArticle}
            onSubmit={async (feedback) => {
              await sendArticleFeedback(detail.id, feedback);
              await onFeedbackSent();
            }}
          />
        )}
        {detail.articleReviseError ? (
          <p className="form-error">{detail.articleReviseError}</p>
        ) : null}
      </div>
    </section>
  );
}
