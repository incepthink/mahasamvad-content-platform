'use client';

// Ad-hoc proofreading of pasted Marathi/English text OR an uploaded file. Single
// synchronous step (no review phase like /translate): submit → the API returns only
// CONFIRMED genuine mistakes (grammar/spelling/punctuation/name/style) plus a corrected
// text that is a deterministic patch of the input. Nothing is stored.
//
// The upload runs in LIVE mode (onTextChange), not handoff, and the submit reads an unread
// scan itself — /translate's arrangement, for the same reason. In handoff mode the file's
// text reached this page only when a button INSIDE the upload card was pressed, so a
// scanned PDF took three presses in three different places (निवडलेली पृष्ठे वाचा →
// हा मजकूर वापरा → तपासणी करा) and an officer who pressed only the last one was told to
// write something to check while their document sat there, read and ignored. Now
// तपासणी करा is enough on its own: it triggers the OCR read of the ticked pages if that
// has not happened yet and continues into the check as soon as the text lands. The page
// picker is still the spend gate — no page is read unless it was ticked — the press that
// authorises it has just moved.
//
// The file's text is counted BESIDE the textarea rather than pushed into it, so a pasted
// note and an attached document are two independent sources and either one alone is a
// complete job. Both are joined at submit, and the string actually sent is remembered
// (`checkedText`) because the corrected text and its highlight replay are only meaningful
// against the exact input they were produced from.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  DocumentIntake,
  type DocumentIntakeStatus,
} from '../../components/DocumentIntake';

// Where the upload card remembers its in-flight job. Named once because the remove control
// has to clear it by hand — see clearDocument.
const DOC_STORAGE_KEY = 'dgipr.proofread.document';

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
  // The uploaded file's text, kept BESIDE the textarea rather than pushed into it: the two
  // are independent sources and either one alone is a complete job.
  const [docText, setDocText] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentIntakeStatus>('empty');
  // Bumping this asks the upload card to run its selected-page extraction. A counter rather
  // than a flag so a retry after a failed read is an explicit new request.
  const [readRequest, setReadRequest] = useState(0);
  // The submit is waiting for that read to land before it can check anything.
  const [awaitingRead, setAwaitingRead] = useState(false);
  const readRequestedForSubmitRef = useRef(false);
  // What the upload card last published, so an identical re-publish (a re-render of the
  // card, a poll that changed nothing) cannot throw away a finished check.
  const docTextRef = useRef('');
  // Remounts the upload card to drop a finished document (its own state is internal).
  const [docKey, setDocKey] = useState(0);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProofreadResponse | null>(null);
  // The exact string the current result was produced from. The corrected text is a
  // deterministic patch of it and buildProofreadHighlights replays that patch, so anything
  // else here — the textarea alone, a since-edited value — would mark the wrong words.
  const [checkedText, setCheckedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // What actually gets checked: typed text, uploaded file, or both, in that order.
  // Blank-line separated so a pasted note and an attached document read as two blocks.
  const combinedText = useMemo(
    () => [text.trim(), docText.trim()].filter(Boolean).join('\n\n'),
    [text, docText],
  );

  // The `unread` arm is what keeps a scanned PDF usable: its pages are ticked but nobody has
  // paid to read them yet, so it contributes nothing to combinedText, and reading it and then
  // checking is exactly what startSubmit does. Testing the text alone would leave an officer
  // whose only source is a scan with a dead button and no way forward.
  const canSubmit = combinedText.length > 0 || docStatus === 'unread';
  const busy = checking || awaitingRead;
  const disabled = busy || !canSubmit;

  const resetFlow = () => {
    setResult(null);
    setError(null);
  };

  // Throw the attached file away without checking it. A remount is what clears the card's
  // internal state, and the stored job id has to go with it or the mount effect would
  // re-attach the same file.
  const clearDocument = () => {
    window.sessionStorage.removeItem(DOC_STORAGE_KEY);
    docTextRef.current = '';
    setDocText('');
    setDocStatus('empty');
    setDocKey((n) => n + 1);
    resetFlow();
  };

  const submit = async () => {
    if (combinedText.length === 0) return;
    setChecking(true);
    setError(null);
    setResult(null);
    setCheckedText(combinedText);
    try {
      setResult(await proofreadText({ text: combinedText }));
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.proofreadError);
    } finally {
      setChecking(false);
    }
  };

  // तपासणी करा, pressed. An attached scan whose ticked pages nobody has read yet is read
  // FIRST and the check continues by itself when the text lands (the effect below) — so the
  // officer never has to find a second button in the upload card. `reading` is included
  // because a read already under way needs waiting for, not starting again.
  const startSubmit = () => {
    if (docStatus === 'unread' || docStatus === 'reading') {
      setAwaitingRead(true);
      if (docStatus === 'unread') {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    void submit();
  };

  // Held in a ref so the effect below can run on the document's status alone and still call
  // the CURRENT closure — one that can see the text the read just produced.
  const startSubmitRef = useRef(startSubmit);
  useEffect(() => {
    startSubmitRef.current = startSubmit;
  });
  useEffect(() => {
    if (!awaitingRead) return;
    if (docStatus === 'unread') {
      // A file attached while we were already waiting, or a read that failed and left pages
      // ticked: ask once more rather than sitting on a spinner for ever.
      if (!readRequestedForSubmitRef.current) {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    if (docStatus === 'ready') {
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
      startSubmitRef.current();
    } else if (docStatus === 'failed' || docStatus === 'empty') {
      // Nothing came back. Stop waiting and leave the card's own error standing rather than
      // checking an empty selection.
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
    }
  }, [awaitingRead, docStatus]);

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
    result?.correctedText != null && result.correctedText === checkedText;

  return (
    <main className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.proofreadPageTitle}</h1>
          <p className="page-sub">{STR.proofreadPageIntro}</p>
        </div>
      </header>

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
            resetFlow();
          }}
          style={{ marginTop: 10 }}
        />
        <p className="hint char-count">
          {text.length.toLocaleString('en-IN')} {STR.docChars}
        </p>

        {/* The text to check usually exists as a file — a draft press note, a scanned GR.

            EMBEDDED: inside this card, directly under the box it fills, rather than as a card
            of its own — the media room's arrangement. As a separate card it read as a second,
            unrelated form, when the file is simply another way of filling the box above.

            LIVE mode (onTextChange): its text is counted beside the box rather than pushed
            into it, so there is no hand-over button to find and no way to leave an upload
            behind. See the header. */}
        <DocumentIntake
          key={docKey}
          storageKey={DOC_STORAGE_KEY}
          embedded
          feature="proofread"
          maxBytes={UPLOAD_FILE_MAX_BYTES}
          onTextChange={(value) => {
            // Only a real change may invalidate a finished check.
            if (value === docTextRef.current) return;
            docTextRef.current = value;
            setDocText(value);
            resetFlow();
          }}
          onStatusChange={setDocStatus}
          readRequest={readRequest}
          // Offered only once there IS a file: the component renders this control in every
          // state including the empty upload card, where there is nothing to delete.
          {...(docStatus === 'empty' ? {} : { onRemove: clearDocument })}
          // The same तपासणी करा, beside the file controls. A scanned PDF's page picker is
          // taller than the viewport, so the submit below it is off screen at exactly the
          // moment the officer has finished choosing pages.
          submitAction={
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={startSubmit}
              disabled={disabled}
            >
              {awaitingRead ? STR.docReadingForSubmit : STR.proofreadAction}
            </button>
          }
        />
      </section>

      <section className="card card-action">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={startSubmit}
            disabled={disabled}
          >
            {STR.proofreadAction}
          </button>
          {awaitingRead ? (
            <span className="translating-note">
              <span className="spinner" aria-hidden="true" />
              {STR.docReadingForSubmit}
            </span>
          ) : null}
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
                original={checkedText}
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
