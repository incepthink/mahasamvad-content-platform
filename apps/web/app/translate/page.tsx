'use client';

// Standalone translation of pasted text OR an uploaded file, in four directions:
// मराठी → इंग्रजी, मराठी → हिंदी, इंग्रजी → मराठी and हिंदी → मराठी.
//
// ONE flow, deliberately. There used to be a second "PDF फाईल" tab running a parallel
// background job (per-page, per-language, its own routes and its own page picker), which
// meant two upload experiences, two page pickers and two shapes of result on one page. Now
// the shared <DocumentIntake> reads any pdf/docx/txt — including a scanned PDF, whose pages
// are picked before a single OCR credit is spent — and drops the text into the same box the
// user could have pasted into. From there everything is the text path: one submit, the name
// check, one translation.
//
// The choice is a DIRECTION, not a target: only four pairs exist, and a source picker beside
// a target picker would offer मराठी → मराठी and इंग्रजी → हिंदी, neither of which the API
// accepts. One row of four pills cannot express an unsupported run.
//
// The two-step submit is the point of the page when the source is MARATHI: submitting first
// runs the name check (TranslationTermsReview) so the user confirms/corrects every proper
// noun's spelling in place, and only then does the translation run — with those names locked
// and saved to the नाव-शब्दकोश for future runs. For Hindi the confirmed names are frozen in
// Devanagari rather than mapped to English.
//
// Going INTO Marathi there is no review step, and that is not a shortcut — it is that the
// question has no content. The card asks "is this Marathi name's English/Hindi spelling
// right?"; here the spelling the output is held to is the dictionary's own `marathi` column,
// already reviewed, and the API enforces it deterministically after translating (see
// translate-article.ts). So the submit goes straight to the translation, and the card is
// replaced by one line saying so.
//
// Nothing is stored — not the text, not the uploaded file (the intake job is in-memory with
// a TTL).
//
// This page imposes NO length limit on the text: translateArticle chunks internally, so a
// long document translates as one long synchronous request. The API's own
// TRANSLATE_TEXT_MAX_CHARS zod cap is still in force server-side, so an over-long text
// surfaces as a request error rather than a local warning.

import { useState } from 'react';
import {
  TEXT_TRANSLATION_PAIRS,
  type PrepareTranslationResponse,
  type TextTranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';
import { DocumentIntake } from '../../components/DocumentIntake';
import { TranslationTermsReview } from '../../components/TranslationTermsReview';

type TranslationResult = Readonly<{
  text: string;
  source: TextTranslationLanguage;
  language: TextTranslationLanguage;
  lockedTermCount: number;
  // Locked names the output could not carry verbatim (always empty for English, whose
  // names are locked in the prompt instead of checked afterwards).
  unpreservedNames: readonly string[];
}>;

// The pill row, in the order the pairs are declared in @dgipr/schemas — so the UI cannot
// offer a direction the API would reject, and adding one is a single edit there plus a
// label here.
const DIRECTION_LABELS: Readonly<Record<string, string>> = {
  'mr>en': STR.translateDirectionMrEn,
  'mr>hi': STR.translateDirectionMrHi,
  'en>mr': STR.translateDirectionEnMr,
  'hi>mr': STR.translateDirectionHiMr,
};

const INPUT_LABELS: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateInputLabelMarathi,
  en: STR.translateInputLabelEnglish,
  hi: STR.translateInputLabelHindi,
};

const OUTPUT_TITLES: Readonly<Record<TextTranslationLanguage, string>> = {
  mr: STR.translateOutputTitleMarathi,
  en: STR.translateOutputTitle,
  hi: STR.translateOutputTitleHindi,
};

const DOWNLOAD_NAMES: Readonly<Record<string, string>> = {
  'mr>en': 'marathi-english-translation.txt',
  'mr>hi': 'marathi-hindi-translation.txt',
  'en>mr': 'english-marathi-translation.txt',
  'hi>mr': 'hindi-marathi-translation.txt',
};

export default function TranslatePage() {
  const [text, setText] = useState('');
  const [source, setSource] = useState<TextTranslationLanguage>('mr');
  const [language, setLanguage] = useState<TextTranslationLanguage>('en');
  // Name-check flow: idle → preparing (extracting names) → review (card shown).
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = submitting || prep !== 'idle' || text.trim().length === 0;
  // The review card only has a question to ask about a MARATHI source (see the header).
  const reviewsNames = source === 'mr';

  // Any change to the text or the direction invalidates a prepared name list and an old
  // result. The direction matters as much as the text: names prepared against Marathi mean
  // nothing once the box is expected to hold English.
  const resetFlow = () => {
    setResult(null);
    setPrep('idle');
    setPrepared(null);
    setError(null);
  };

  // Step 1 on a Marathi source: extract the text's names for review. Failure returns to
  // idle with a Marathi error — never silently translating with unchecked names.
  const startNameCheck = async () => {
    if (disabled) return;
    setPrep('preparing');
    setError(null);
    setResult(null);
    try {
      const res = await prepareTextTranslation(text.trim());
      setPrepared(res.terms);
      setPrep('review');
    } catch {
      setError(STR.namesPrepareError);
      setPrep('idle');
    }
  };

  // Step 2: translate, with the confirmed names locked and saved verified where there were
  // any to confirm. The result carries its own direction so the output card cannot mislabel
  // itself if the pills are changed afterwards (changing them clears the result anyway).
  const runTranslation = async (terms?: TranslationTermInput[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await translateText({
        text: text.trim(),
        sourceLanguage: source,
        language,
        ...(terms ? { terms } : {}),
      });
      setResult({
        text: res.translated,
        source: res.sourceLanguage,
        language: res.language,
        lockedTermCount: res.lockedTermCount,
        unpreservedNames: res.unpreservedNames,
      });
      setPrep('idle');
      setPrepared(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  // The one submit button. A Marathi source stops at the name check first; going INTO
  // Marathi there is nothing to check, so it translates directly.
  const submit = () => {
    if (disabled) return;
    if (reviewsNames) {
      void startNameCheck();
      return;
    }
    setResult(null);
    void runTranslation();
  };

  const copyToClipboard = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.translatePageTitle}</h1>
          <p className="page-sub">{STR.translatePageIntro}</p>
        </div>
      </header>

      <section className="card">
        {/* The label names the SOURCE language, so the box says which language it is
            waiting for rather than leaving the direction pills below to imply it. */}
        <label className="field-label" htmlFor="translate-text">
          {INPUT_LABELS[source]}
        </label>
        <p className="hint">{STR.translateInputHint}</p>
        <textarea
          id="translate-text"
          className="note-input"
          placeholder={STR.translateInputPlaceholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            resetFlow();
          }}
          style={{ marginTop: 10 }}
        />
        <p className="hint char-count">
          {text.length.toLocaleString('en-IN')} {STR.docChars}
        </p>
      </section>

      {/* The document to translate usually arrives as a file, not in the clipboard.
              The shared intake reads pdf/docx/txt and drops the text into the box above,
              where it is edited and translated like anything else — a scanned PDF stops to
              ask which pages are worth OCR'ing before a credit is spent. No character
              budget is passed: this page imposes no length limit on the text, so page
              selection is about OCR spend, not about trimming to fit. */}
      <DocumentIntake
        storageKey="dgipr.translate.document"
        feature="translate"
        accept={['pdf', 'docx', 'txt']}
        onText={(value) => {
          setText(value);
          resetFlow();
        }}
      />

      <section className="card">
        {/* A <p>, not a <span>: .field-label is scoped to <label> and <p>, so a span
            got no weight and no block display and the question ran straight into the
            first button ("…भाषांतर हवे?इंग्रजी"). */}
        <p className="field-label">{STR.translateDirectionLabel}</p>
        <div
          className="lang-toggle"
          role="group"
          aria-label={STR.translateDirectionLabel}
        >
          {TEXT_TRANSLATION_PAIRS.map((pair) => {
            const key = `${pair.source}>${pair.target}`;
            return (
              <button
                key={key}
                type="button"
                className="btn btn-small"
                aria-pressed={
                  source === pair.source && language === pair.target
                }
                disabled={submitting || prep !== 'idle'}
                onClick={() => {
                  setSource(pair.source);
                  setLanguage(pair.target);
                  // A result belongs to the direction it was made in; changing the
                  // direction invalidates it exactly like editing the text does.
                  resetFlow();
                }}
              >
                {DIRECTION_LABELS[key] ?? key}
              </button>
            );
          })}
        </div>

        {/* Said before the submit, not after it: an officer used to a two-step submit
            should know the step is missing on purpose and where the spelling comes from. */}
        {!reviewsNames ? (
          <p className="hint" style={{ marginTop: 10 }}>
            {STR.translateIntoMarathiNames}
          </p>
        ) : null}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled}
          >
            {STR.translateAction}
          </button>
          {prep === 'preparing' ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.namesChecking}
            </span>
          ) : null}
          {submitting ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.translating} {STR.translateMayTakeTime}
            </span>
          ) : null}
        </div>
        {prep === 'review' && prepared ? (
          <TranslationTermsReview
            terms={prepared}
            busy={submitting}
            // The card only ever renders on a Marathi source, where the target is
            // en or hi — which is exactly what its own prop accepts.
            language={language === 'hi' ? 'hi' : 'en'}
            onConfirm={(terms) => void runTranslation(terms)}
            onCancel={() => {
              setPrep('idle');
              setPrepared(null);
            }}
          />
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {result ? (
        <section className="card">
          <h2>{OUTPUT_TITLES[result.language]}</h2>
          {result.unpreservedNames.length > 0 ? (
            <div className="info-callout warn" style={{ marginBottom: 12 }}>
              <p className="field-label">{STR.translateUnpreservedTitle}</p>
              <p className="hint">
                {STR.translateUnpreservedHint}{' '}
                {result.unpreservedNames.join(', ')}
              </p>
            </div>
          ) : null}
          <div className="article-body">{result.text}</div>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button type="button" className="btn" onClick={copyToClipboard}>
              {copied ? STR.copied : STR.copyText}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadBlob(
                  DOWNLOAD_NAMES[`${result.source}>${result.language}`] ??
                    'translation.txt',
                  result.text,
                  'text/plain',
                )
              }
            >
              {STR.downloadTxt}
            </button>
          </div>
          <p className="hint">
            {result.lockedTermCount} {STR.translateLockedTerms}
          </p>
        </section>
      ) : null}
    </main>
  );
}
