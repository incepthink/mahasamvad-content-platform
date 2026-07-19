'use client';

// Standalone Marathi→English translation of pasted text. Same two-step flow as the
// generation page: submitting first runs the name check (TranslationTermsReview) so
// the user confirms/corrects every proper noun's English spelling in place, and only
// then does the translation run — with those spellings locked and saved to the
// नाव-शब्दकोश for future runs.

import { useRef, useState } from 'react';
import {
  TRANSLATE_TEXT_MAX_CHARS,
  type PrepareTranslationResponse,
  type TranslationTermInput,
} from '@dgipr/schemas';
import { prepareTextTranslation, translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';
import { TranslationTermsReview } from '../../components/TranslationTermsReview';

type TranslationResult = Readonly<{
  english: string;
  lockedTermCount: number;
}>;

export default function TranslatePage() {
  const [text, setText] = useState('');
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

  // Step 2: translate with the confirmed spellings locked (and saved verified).
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await translateText({ text: text.trim(), terms });
      setResult({
        english: res.english,
        lockedTermCount: res.lockedTermCount,
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
    await navigator.clipboard.writeText(result.english);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="page">
      <h1 className="page-title">{STR.translatePageTitle}</h1>

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
        <div className="btn-row">
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
          <h2>{STR.translateOutputTitle}</h2>
          <div className="article-body">{result.english}</div>
          <div className="btn-row" style={{ marginTop: 18 }}>
            <button type="button" className="btn" onClick={copyToClipboard}>
              {copied ? STR.copied : STR.copyText}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadBlob(
                  'marathi-english-translation.txt',
                  result.english,
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
