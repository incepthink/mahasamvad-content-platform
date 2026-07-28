'use client';

// Ad-hoc proofreading of pasted Marathi/English text. Single synchronous step
// (no review phase like /translate): submit → the API returns only CONFIRMED
// genuine mistakes (grammar/spelling/punctuation/name/style) plus a corrected
// text that is a deterministic patch of the input. Nothing is stored.

import { useEffect, useMemo, useState } from 'react';
import {
  UPLOAD_FILE_MAX_BYTES,
  buildProofreadHighlights,
  type ProofreadHighlight,
  type ProofreadIssue,
  type ProofreadResponse,
} from '@dgipr/schemas';
import { proofreadText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { PROOFREAD_TYPE_LABELS, STR } from '../../lib/strings';
import { DocumentIntake } from '../../components/DocumentIntake';

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

// The corrected article with every patched span marked in place. The officer must be
// able to SEE what the proofreader changed without hunting each excerpt from the list
// above — and must equally be able to switch the marks off and read the finished text
// as plain prose, which is what they will actually publish.
//
// Marks come from @dgipr/schemas' buildProofreadHighlights, which replays the engine's
// own patcher. It returns null if that replay does not reproduce `corrected` byte for
// byte; the text then renders unmarked. The corrected text is authoritative, the marks
// are best-effort — never the other way round.
function CorrectedArticle({
  original,
  corrected,
  issues,
}: {
  original: string;
  corrected: string;
  issues: readonly ProofreadIssue[];
}) {
  const [highlightsOn, setHighlightsOn] = useState(true);
  const [active, setActive] = useState<{ index: number; top: number; left: number } | null>(
    null,
  );

  const marks = useMemo(
    () => buildProofreadHighlights(original, corrected, issues),
    [original, corrected, issues],
  );
  const markedCount = marks?.filter((mark) => mark.kind !== null).length ?? 0;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!marks || markedCount === 0) {
    return <div className="article-body">{corrected}</div>;
  }

  // Anchored to the viewport rather than to the span: a marked span can wrap across
  // lines, which makes it a poor positioning context.
  const open = (index: number, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setActive({
      index,
      top: box.bottom + 8,
      left: Math.min(Math.max(box.left, 12), window.innerWidth - 332),
    });
  };

  const activeMark: ProofreadHighlight | null =
    active !== null ? (marks[active.index] ?? null) : null;

  return (
    <>
      <div className="proofread-highlight-bar">
        <button
          type="button"
          className="btn"
          aria-pressed={highlightsOn}
          onClick={() => {
            setHighlightsOn((on) => !on);
            setActive(null);
          }}
        >
          {highlightsOn
            ? STR.proofreadHighlightHide
            : STR.proofreadHighlightShow}
        </button>
        {highlightsOn ? (
          <div className="proofread-legend">
            <span>
              <span className="proofread-legend-swatch" aria-hidden="true" />
              {STR.proofreadHighlightLegendFix}
            </span>
            <span>
              <span
                className="proofread-legend-swatch proofread-legend-swatch-style"
                aria-hidden="true"
              />
              {STR.proofreadHighlightLegendStyle}
            </span>
          </div>
        ) : null}
      </div>
      {highlightsOn ? (
        <p className="hint">{STR.proofreadHighlightHint}</p>
      ) : null}

      <div className="article-body">
        {highlightsOn
          ? marks.map((mark, index) =>
              mark.kind === null || mark.issue === null ? (
                mark.text
              ) : (
                <span
                  key={index}
                  className={
                    mark.kind === 'style'
                      ? 'proofread-mark proofread-mark-style'
                      : 'proofread-mark'
                  }
                  role="button"
                  tabIndex={0}
                  aria-describedby={
                    active?.index === index ? 'proofread-popover' : undefined
                  }
                  onMouseEnter={(event) => open(index, event.currentTarget)}
                  onMouseLeave={() =>
                    setActive((current) =>
                      current?.index === index ? null : current,
                    )
                  }
                  onFocus={(event) => open(index, event.currentTarget)}
                  onBlur={() =>
                    setActive((current) =>
                      current?.index === index ? null : current,
                    )
                  }
                  onClick={(event) => {
                    if (active?.index === index) setActive(null);
                    else open(index, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    if (active?.index === index) setActive(null);
                    else open(index, event.currentTarget);
                  }}
                >
                  {mark.text}
                </span>
              ),
            )
          : corrected}
      </div>

      {active && activeMark?.issue ? (
        <div
          id="proofread-popover"
          className="proofread-popover"
          role="tooltip"
          style={{ top: active.top, left: active.left }}
        >
          <span
            className={
              activeMark.kind === 'style'
                ? 'chip chip-queued'
                : 'chip chip-failed'
            }
          >
            {PROOFREAD_TYPE_LABELS[activeMark.issue.type]}
          </span>
          <p className="proofread-popover-line">
            <span className="hint">
              {activeMark.kind === 'style'
                ? STR.proofreadSuggestionArrow
                : STR.proofreadHighlightOriginal}
            </span>{' '}
            <span
              className={
                activeMark.kind === 'style'
                  ? 'issue-suggestion'
                  : 'issue-excerpt'
              }
            >
              {activeMark.kind === 'style'
                ? activeMark.issue.suggestion
                : activeMark.issue.excerpt}
            </span>
          </p>
          {activeMark.issue.explanation ? (
            <p className="hint">{activeMark.issue.explanation}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default function ProofreadPage() {
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProofreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const disabled = checking || text.trim().length === 0;

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
        <p className="hint">{text.length.toLocaleString('en-IN')}</p>
      </section>

      {/* The text to check usually exists as a file — a draft press note, a scanned GR.
          Keep the upload inline, like every other document surface in the product. */}
      <DocumentIntake
        storageKey="dgipr.proofread.document"
        maxBytes={UPLOAD_FILE_MAX_BYTES}
        onText={(value) => {
          setText(value);
          setResult(null);
          setError(null);
        }}
      />

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
              <CorrectedArticle
                original={text}
                corrected={result.correctedText}
                issues={result.issues}
              />
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
