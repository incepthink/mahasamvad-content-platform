'use client';

// Standalone Marathi→English/Hindi translation, in two modes.
//
// मजकूर (text): pasted text or a .txt file, translated synchronously. Same two-step flow as
// the generation page: submitting first runs the name check (TranslationTermsReview) so the
// user confirms/corrects every proper noun's English spelling in place, and only then does
// the translation run — with those names locked and saved to the नाव-शब्दकोश for future
// runs. The target language is chosen before translating; for Hindi the same confirmed
// names are frozen in Devanagari rather than mapped to English.
//
// PDF: a whole document, which needs a different shape entirely — minutes of OCR and tens
// of thousands of characters cannot live inside one request — so it runs as a background
// job with page selection. All of that lives in TranslateDocumentPanel.
//
// Neither mode stores anything.

import { useRef, useState } from 'react';
import {
  TRANSLATE_TEXT_MAX_CHARS,
  type PrepareTranslationResponse,
  type TranslationLanguage,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';
import { TranslationTermsReview } from '../../components/TranslationTermsReview';
import { TranslateDocumentPanel } from '../../components/TranslateDocumentPanel';

type TranslationResult = Readonly<{
  text: string;
  language: TranslationLanguage;
  lockedTermCount: number;
  // Locked names the Hindi output could not carry verbatim (empty for English).
  unpreservedNames: readonly string[];
}>;

type TranslateMode = 'text' | 'pdf';

export default function TranslatePage() {
  const [mode, setMode] = useState<TranslateMode>('text');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<TranslationLanguage>('en');
  // Name-check flow: idle → preparing (extracting names) → review (card shown).
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const overLimit = text.length > TRANSLATE_TEXT_MAX_CHARS;
  const disabled =
    submitting || prep !== 'idle' || text.trim().length === 0 || overLimit;

  // Any change to the text invalidates a prepared name list and an old result.
  const resetFlow = () => {
    setResult(null);
    setPrep('idle');
    setPrepared(null);
    setError(null);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setError(STR.txtOnly);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      resetFlow();
    };
    reader.readAsText(file, 'utf-8');
  };

  // Step 1: extract the text's names for review. Failure returns to idle with a
  // Marathi error — never silently translating with unchecked names.
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

  // Step 2: translate with the confirmed names locked (and saved verified). The
  // result carries its own language so the output card can't mislabel itself if the
  // selector is changed afterwards (changing it clears the result anyway).
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await translateText({ text: text.trim(), terms, language });
      setResult({
        text: res.translated,
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

  const copyToClipboard = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="page">
      <h1 className="page-title">{STR.translatePageTitle}</h1>

      <div className="lang-toggle" role="group" style={{ marginBottom: 18 }}>
        {(['text', 'pdf'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="btn btn-small"
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
          >
            {option === 'pdf' ? STR.translateModePdf : STR.translateModeText}
          </button>
        ))}
      </div>

      {mode === 'pdf' ? <TranslateDocumentPanel /> : null}

      {mode === 'text' ? (
        <>
          <section className="card">
            <label className="field-label" htmlFor="translate-text">
              {STR.translateInputLabel}
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
            <p className={overLimit ? 'form-error' : 'hint'}>
              {text.length.toLocaleString('en-IN')} /{' '}
              {TRANSLATE_TEXT_MAX_CHARS.toLocaleString('en-IN')}
              {overLimit ? ` — ${STR.translateOverLimit}` : ''}
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => fileInput.current?.click()}
              >
                {STR.uploadTxt}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,text/plain"
                hidden
                onChange={(event) => onFile(event.target.files?.[0])}
              />
            </div>
          </section>

          <section className="card">
            <span className="field-label">{STR.translateTargetLabel}</span>
            <div className="lang-toggle" role="group" style={{ marginTop: 8 }}>
              {(['en', 'hi'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="btn btn-small"
                  aria-pressed={language === option}
                  disabled={submitting || prep !== 'idle'}
                  onClick={() => {
                    setLanguage(option);
                    // A result belongs to the language it was made in; changing the
                    // target invalidates it exactly like editing the text does.
                    resetFlow();
                  }}
                >
                  {option === 'hi'
                    ? STR.translateTargetHindi
                    : STR.translateTargetEnglish}
                </button>
              ))}
            </div>

            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={startNameCheck}
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
                language={language}
                onConfirm={confirmTranslate}
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
              <h2>
                {result.language === 'hi'
                  ? STR.translateOutputTitleHindi
                  : STR.translateOutputTitle}
              </h2>
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
                      result.language === 'hi'
                        ? 'marathi-hindi-translation.txt'
                        : 'marathi-english-translation.txt',
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
        </>
      ) : null}
    </main>
  );
}
