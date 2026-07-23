'use client';

// Read-only article display + copy/download actions + the article feedback loop.
// Every translation starts with the in-page name check (TranslationTermsReview):
// "Translate to English" / "Translate to Hindi" first fetches the article's proper
// nouns for the user to confirm/correct, and only the confirmed names — locked — reach
// the Sarvam translation (as English spellings for English, as frozen Devanagari forms
// for Hindi). English and Hindi are stored independently on the row: a मराठी | English |
// हिंदी toggle shows whichever exist, copy/download follow the shown language, and each
// translation has its own re-translate fold running the same name check (a wrong
// spelling noticed late is fixed right here, not on /glossary).

import { useState } from 'react';
import type {
  GenerationDetail,
  PrepareTranslationResponse,
  TranslationLanguage,
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
  const [lang, setLang] = useState<'mr' | TranslationLanguage>('mr');
  // Name-check flow: idle → preparing (extracting names) → review (card shown);
  // confirming covers the translate POST fired from the review card. `pendingLang`
  // is the language that flow will translate into once confirmed.
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [pendingLang, setPendingLang] = useState<TranslationLanguage>('en');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [confirming, setConfirming] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const marathi = detail.article ?? '';
  // Stored translations, keyed the same way as the toggle. A language is "available"
  // only once its text exists, so nothing about the UI changes until one is made.
  const translations: Record<TranslationLanguage, string | null> = {
    en: detail.articleEnglish,
    hi: detail.articleHindi,
  };
  const has = (language: TranslationLanguage) =>
    (translations[language]?.length ?? 0) > 0;
  const shownLang = lang !== 'mr' && has(lang) ? lang : 'mr';
  const shown = shownLang === 'mr' ? marathi : (translations[shownLang] ?? '');

  // The translate job runs beside whatever else is in flight and reports itself on
  // the detail payload rather than through status/step, so this stays accurate while
  // the poster is still rendering. A background failure arrives the same way.
  // Only one translation runs at a time, and `translatingLanguage` names which — so a
  // reload mid-run still puts the spinner on the right button.
  const translating = detail.translating;
  const translatingLang = detail.translatingLanguage;
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

  // Step 1 of translating: fetch the article's names for review. The prepare call is
  // language-independent (the same confirmed rows serve both targets), so only the
  // remembered `pendingLang` differs. On failure the flow returns to idle with a
  // Marathi error — never silently translating with unchecked names.
  const startNameCheck = async (language: TranslationLanguage) => {
    setPendingLang(language);
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

  // Step 2: the user confirmed the names — start the translation with them locked,
  // into whichever language started this check. The job reports itself through
  // detail.translating, so after the refresh the existing spinner takes over.
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    setConfirming(true);
    setTranslateError(null);
    try {
      await requestTranslation(detail.id, pendingLang, terms);
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
  // folds): spinner while extracting, then the review card. Rendered in one place at
  // a time — `pendingLang` decides where, so two folds can't both show it.
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
        language={pendingLang}
        onConfirm={confirmTranslate}
        onCancel={cancelNameCheck}
      />
    ) : null;

  const translatingNote = (language: TranslationLanguage) => (
    <span className="translating-note">
      <span className="spinner" aria-hidden="true" />
      {language === 'hi' ? STR.translatingHindi : STR.translatingEnglish}
    </span>
  );

  // The re-translate fold shown under an existing translation: same name check, run
  // again for that one language.
  const retranslateFold = (language: TranslationLanguage) => (
    <details className="fold" key={language}>
      <summary>
        {language === 'hi' ? STR.retranslateFoldHindi : STR.retranslateFold}
      </summary>
      <div className="fold-body">
        {translating && translatingLang === language ? (
          translatingNote(language)
        ) : prep !== 'idle' && pendingLang === language ? (
          nameCheckBody
        ) : (
          <button
            type="button"
            className="btn btn-small"
            disabled={translating || prep !== 'idle'}
            onClick={() => startNameCheck(language)}
          >
            {STR.namesStartCheck}
          </button>
        )}
      </div>
    </details>
  );

  return (
    <section className="card">
      <div className="article-head">
        <h2 style={{ margin: 0 }}>{STR.articleTitle}</h2>
        {has('en') || has('hi') ? (
          <div className="lang-toggle" role="group" aria-label="भाषा">
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={shownLang === 'mr'}
              onClick={() => setLang('mr')}
            >
              {STR.showMarathi}
            </button>
            {has('en') ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={shownLang === 'en'}
                onClick={() => setLang('en')}
              >
                {STR.showEnglish}
              </button>
            ) : null}
            {has('hi') ? (
              <button
                type="button"
                className="btn btn-small"
                aria-pressed={shownLang === 'hi'}
                onClick={() => setLang('hi')}
              >
                {STR.showHindi}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Names the Hindi translation could not carry verbatim (from the in-process job
          registry, so it appears right after a run and is lost on API restart). Shown
          only while the Hindi text is on screen — it is a prompt to check that output. */}
      {shownLang === 'hi' &&
      detail.translateWarnings &&
      detail.translateWarnings.length > 0 ? (
        <div className="info-callout warn" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.translateUnpreservedTitle}</p>
          <p className="hint">
            {STR.translateUnpreservedHint}{' '}
            {detail.translateWarnings.join(', ')}
          </p>
        </div>
      ) : null}

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
              `lekh-${detail.id}-${shownLang}.txt`,
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
              `lekh-${detail.id}-${shownLang}.md`,
              shown,
              'text/markdown',
            )
          }
        >
          {STR.downloadMd}
        </button>

        {/* One button per language that has no translation yet; the one being
            translated right now shows the spinner in its place. */}
        {(['en', 'hi'] as const).map((language) =>
          has(language) ? null : translating && translatingLang === language ? (
            <span key={language}>{translatingNote(language)}</span>
          ) : prep === 'idle' && !translating ? (
            <button
              key={language}
              type="button"
              className="btn"
              onClick={() => startNameCheck(language)}
            >
              {language === 'hi'
                ? STR.translateToHindi
                : STR.translateToEnglish}
            </button>
          ) : null,
        )}
      </div>

      {/* The name check for a not-yet-made translation sits directly under the
          buttons; for an existing one it lives inside that language's fold below. */}
      {!has(pendingLang) && !translating ? nameCheckBody : null}

      {error ? <p className="form-error">{error}</p> : null}

      {(['en', 'hi'] as const).map((language) =>
        has(language) ? retranslateFold(language) : null,
      )}

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
