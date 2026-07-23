'use client';

// Ad-hoc proofreading of pasted Marathi/English text. Single synchronous step
// (no review phase like /translate): submit → the API returns only CONFIRMED
// genuine mistakes (grammar/spelling/punctuation/name/style) plus a corrected
// text that is a deterministic patch of the input. Nothing is stored.

import { useState } from 'react';
import {
  PROOFREAD_TEXT_MAX_CHARS,
  type ProofreadIssue,
  type ProofreadResponse,
} from '@dgipr/schemas';
import { proofreadText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { PROOFREAD_TYPE_LABELS, STR } from '../../lib/strings';

// Display order for error-severity issues; style advisories render separately.
const ERROR_TYPE_ORDER = [
  'grammar',
  'spelling',
  'punctuation',
  'name',
] as const;

function IssueRow({ issue }: { issue: ProofreadIssue }) {
  const chipClass =
    issue.severity === 'error' ? 'chip chip-failed' : 'chip chip-queued';
  return (
    <div className="issue-row">
      <div className="issue-line">
        <span className={chipClass}>{PROOFREAD_TYPE_LABELS[issue.type]}</span>
        <span className="issue-excerpt">{issue.excerpt}</span>
      </div>
      <div className="issue-line">
        <span className="hint">{STR.proofreadSuggestionArrow}</span>
        <span className="issue-suggestion">{issue.suggestion}</span>
      </div>
      {issue.explanation ? <p className="hint">{issue.explanation}</p> : null}
    </div>
  );
}

export default function ProofreadPage() {
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProofreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const overLimit = text.length > PROOFREAD_TEXT_MAX_CHARS;
  const disabled = checking || text.trim().length === 0 || overLimit;

  const submit = async () => {
    if (disabled) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await proofreadText({ text: text.trim() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.proofreadError);
    } finally {
      setChecking(false);
    }
  };

  const copyCorrected = async () => {
    if (!result?.correctedText) return;
    await navigator.clipboard.writeText(result.correctedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const errorIssues = result
    ? [...result.issues]
        .filter((issue) => issue.severity === 'error')
        .sort(
          (a, b) =>
            ERROR_TYPE_ORDER.indexOf(
              a.type as (typeof ERROR_TYPE_ORDER)[number],
            ) -
            ERROR_TYPE_ORDER.indexOf(
              b.type as (typeof ERROR_TYPE_ORDER)[number],
            ),
        )
    : [];
  const styleIssues = result
    ? result.issues.filter((issue) => issue.severity === 'suggestion')
    : [];
  const clean =
    result !== null &&
    result.issues.length === 0 &&
    result.unverifiedNames.length === 0;
  const correctedUnchanged =
    result?.correctedText != null && result.correctedText === text.trim();

  return (
    <main className="page">
      <h1 className="page-title">{STR.proofreadPageTitle}</h1>

      <section className="card">
        <label className="field-label" htmlFor="proofread-text">
          {STR.proofreadInputLabel}
        </label>
        <p className="hint">{STR.proofreadInputHint}</p>
        <textarea
          id="proofread-text"
          className="note-input"
          placeholder={STR.proofreadInputPlaceholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
            setError(null);
          }}
          style={{ marginTop: 10 }}
        />
        <p className={overLimit ? 'form-error' : 'hint'}>
          {text.length.toLocaleString('en-IN')} /{' '}
          {PROOFREAD_TEXT_MAX_CHARS.toLocaleString('en-IN')}
          {overLimit ? ` — ${STR.proofreadOverLimit}` : ''}
        </p>
      </section>

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={disabled}
          >
            {STR.proofreadAction}
          </button>
          {checking ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.proofreadChecking}
            </span>
          ) : null}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      {clean ? (
        <section className="card">
          <p>
            <span className="chip chip-completed">{STR.proofreadNoIssues}</span>
          </p>
        </section>
      ) : null}

      {result && errorIssues.length > 0 ? (
        <section className="card">
          <h2>{STR.proofreadIssuesTitle}</h2>
          {errorIssues.map((issue, index) => (
            <IssueRow key={`${issue.excerpt}-${index}`} issue={issue} />
          ))}
        </section>
      ) : null}

      {result && styleIssues.length > 0 ? (
        <section className="card">
          <h2>{STR.proofreadStyleAdvisoryTitle}</h2>
          <p className="hint">{STR.proofreadStyleAdvisoryHint}</p>
          {styleIssues.map((issue, index) => (
            <IssueRow key={`${issue.excerpt}-${index}`} issue={issue} />
          ))}
        </section>
      ) : null}

      {result && result.unverifiedNames.length > 0 ? (
        <section className="card">
          <h2>{STR.proofreadUnverifiedTitle}</h2>
          <p className="hint">{STR.proofreadUnverifiedHint}</p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            {result.unverifiedNames.map((name) => (
              <span key={name} className="chip chip-queued">
                {name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="card">
          <h2>{STR.proofreadCorrectedTitle}</h2>
          {result.correctedText === null ? (
            <p className="form-error">{STR.proofreadCorrectedUnavailable}</p>
          ) : (
            <>
              {correctedUnchanged ? (
                <p className="hint">{STR.proofreadCorrectedUnchanged}</p>
              ) : null}
              <div className="article-body">{result.correctedText}</div>
              <div className="btn-row" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={copyCorrected}>
                  {copied ? STR.copied : STR.copyText}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    downloadBlob(
                      'proofread-corrected.txt',
                      result.correctedText ?? '',
                      'text/plain',
                    )
                  }
                >
                  {STR.downloadTxt}
                </button>
              </div>
            </>
          )}
          {result.language === 'en' ? (
            <p className="hint" style={{ marginTop: 12 }}>
              {STR.proofreadEnglishStyleNote}
            </p>
          ) : null}
          {result.styleReference ? (
            <p className="hint" style={{ marginTop: 12 }}>
              {STR.proofreadStyleRefNote}{' '}
              <a
                href={result.styleReference.url}
                target="_blank"
                rel="noreferrer"
              >
                {result.styleReference.title}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
