'use client';

import { useRef, useState } from 'react';
import { TRANSLATE_TEXT_MAX_CHARS } from '@dgipr/schemas';
import { translateText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { STR } from '../../lib/strings';

type TranslationResult = Readonly<{
  english: string;
  lockedTermCount: number;
  minedTermCount: number;
}>;

export default function TranslatePage() {
  const [text, setText] = useState('');
  const [mineTerms, setMineTerms] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const overLimit = text.length > TRANSLATE_TEXT_MAX_CHARS;
  const disabled = submitting || text.trim().length === 0 || overLimit;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setError(STR.txtOnly);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
      setResult(null);
      setError(null);
    };
    reader.readAsText(file, 'utf-8');
  };

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      setResult(await translateText({ text: text.trim(), mineTerms }));
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
            setResult(null);
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
        <label style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input
            type="checkbox"
            checked={mineTerms}
            onChange={(event) => setMineTerms(event.target.checked)}
          />
          <span>{STR.translateMineTerms}</span>
        </label>
      </section>

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled}
          >
            {STR.translateAction}
          </button>
          {submitting ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.translating} {STR.translateMayTakeTime}
            </span>
          ) : null}
        </div>
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
            {mineTerms
              ? ` · ${result.minedTermCount} ${STR.translateMinedTerms}`
              : ''}
          </p>
        </section>
      ) : null}
    </main>
  );
}
