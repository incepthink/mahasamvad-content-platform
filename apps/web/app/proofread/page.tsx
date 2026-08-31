'use client';

// Ad-hoc proofreading of pasted Marathi/English text OR an uploaded file. Single
// synchronous step (no review phase like /translate): submit → the API returns only
// CONFIRMED genuine mistakes (grammar/spelling/punctuation/name/style) plus a corrected
// text that is a deterministic patch of the input. Nothing is stored.
//
// SAME SHAPE AS THE OTHER CREATE SURFACES — Creative and Social (app/page.tsx), लेख / बातमी
// (app/dlo/page.tsx), भाषांतर (app/translate/page.tsx) and ध्वनिलेखन: a doodle wallpaper, a
// page-head, and ONE composer card built out of components/common (FormCard →
// PromptTextarea → a tool row → AttachmentStrip) WITH THE SUBMIT AT THE END OF THAT ROW.
// It used to be a legacy `.card` holding a `.note-input`, a full-width upload card and a
// `.card-action` bar of its own — the same ideas in a spelling no other page still uses,
// which is exactly how these pages drift apart.
//
// THE SUBMIT IS IN THE COMPOSER CARD, and there is only ONE of it. There were two: a
// `.card-action` bar under the composer, and a duplicate passed into the upload card as
// `submitAction`, which existed because a scanned PDF's page picker was taller than the
// viewport and the bar below it was off screen. Everything below this card (the issues, the
// corrected text) is a consequence of pressing it rather than something to fill in first,
// and every complaint the press can raise is rendered directly under it.
//
// FILES ARE ATTACHED THE WAY /dlo ATTACHES THEM (components/common/DocumentAttachments):
// the paperclip opens the browser's file dialog, several documents at once, and each one
// becomes a card in the strip under the tool row. There is no upload BLOCK any more — a
// card with its own upload control, its own page picker and its own hand-over button was a
// second form on a page that already had one, and getting a PDF checked took three presses
// in three different places (निवडलेली पृष्ठे वाचा → हा मजकूर वापरा → तपासणी करा). An officer
// who pressed only the last one was told to write something to check while their document
// sat there, read and ignored.
//
// तपासणी करा is now the only press. THE SPEND GATE IS UNCHANGED and is exactly why the
// reading waits for it: every PDF is read by OCR (PDF_EXTRACTION_MODE=ocr), which is billed
// per page, so attaching only PROBES — free — and this button is what authorises the read.
// It reads whatever is attached and unread, then continues into the check on its own as
// soon as the text lands.
//
// The files' text is counted BESIDE the textarea rather than pushed into it, so a pasted
// note and an attached document are independent sources and either one alone is a complete
// job. Both are joined at submit, and the string actually sent is remembered
// (`checkedText`) because the corrected text and its highlight replay are only meaningful
// against the exact input they were produced from. That string is PROSE, not the HTML the
// OCR backend returns — see lib/extractedText, which is why a marked correction now lands
// on a word rather than inside a tag.
//
// Nothing is stored — not the text, not the uploaded file (the intake job is in-memory with
// a TTL) — so this page has no history list, unlike /dlo and /transcribe.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import {
  buildProofreadHighlights,
  type ProofreadHighlight,
  type ProofreadIssue,
  type ProofreadResponse,
} from '@dgipr/schemas';
import { Button } from '@/components/ui/button';
import { AttachmentStrip } from '@/components/common/AttachmentStrip';
import { ComposerToolbarButton } from '@/components/common/ComposerToolbarButton';
import { useDocumentAttachments } from '@/components/common/DocumentAttachments';
import { FormCard } from '@/components/common/FormCard';
import { PageBackdrop } from '@/components/common/PageBackdrop';
import { PromptTextarea } from '@/components/common/PromptTextarea';
import { cn } from '@/lib/utils';
import { proofreadText } from '../../lib/api';
import { downloadBlob } from '../../lib/download';
import { PROOFREAD_DOODLES } from '../../lib/doodleMarks';
import { PROOFREAD_TYPE_LABELS, STR } from '../../lib/strings';
import { errorMessage } from '../../lib/errorMessage';
import { ErrorNotice } from '../../components/ErrorNotice';

// The prefix each attached document's reader remembers its in-flight job under. One per
// surface, or two pages would fight over one job (see useDocumentAttachments).
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
        <Button
          variant="outline"
          type="button"
          aria-pressed={highlightsOn}
          onClick={() => {
            setHighlightsOn((on) => !on);
            setActive(null);
          }}
        >
          {highlightsOn
            ? STR.proofreadHighlightHide
            : STR.proofreadHighlightShow}
        </Button>
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
  // The submit is waiting for an attached document to be read before it can check anything.
  const [awaitingRead, setAwaitingRead] = useState(false);
  const readRequestedForSubmitRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ProofreadResponse | null>(null);
  // The exact string the current result was produced from. The corrected text is a
  // deterministic patch of it and buildProofreadHighlights replays that patch, so anything
  // else here — the textarea alone, a since-edited value — would mark the wrong words.
  const [checkedText, setCheckedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The attached files, exactly as /dlo holds them: picked through the paperclip below,
  // listed as cards in the strip under it, and READ only when this page's own submit is
  // pressed — see useDocumentAttachments for why the reading waits for that press.
  const docs = useDocumentAttachments({
    storagePrefix: DOC_STORAGE_KEY,
    feature: 'proofread',
    onError: setError,
    // A document that has just been read is new source text, which invalidates a check made
    // from the old one exactly as editing the box does.
    onTextChange: () => resetFlow(),
    disabled: checking,
  });

  // Named once: every gate below reads the list's aggregate status, and an effect that
  // depended on `docs` itself would re-run on every poll.
  const docStatus = docs.status;

  // What actually gets checked: typed text, uploaded files, or both, in that order.
  // Blank-line separated so a pasted note and an attached document read as two blocks.
  const combinedText = useMemo(
    () => [text.trim(), docs.text.trim()].filter(Boolean).join('\n\n'),
    [text, docs.text],
  );

  // The `unread` arm is what keeps an attached PDF usable: nobody has paid to read it yet,
  // so it contributes nothing to combinedText, and reading it and then checking is exactly
  // what startSubmit does. Testing the text alone would leave an officer whose only source
  // is a file with a dead button and no way forward.
  const canSubmit = combinedText.length > 0 || docStatus === 'unread';
  const busy = checking || awaitingRead;
  const disabled = busy || !canSubmit;

  const submitLabel = awaitingRead
    ? STR.docReadingForSubmit
    : checking
      ? STR.proofreadChecking
      : STR.proofreadAction;

  const resetFlow = () => {
    setResult(null);
    setError(null);
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
      setError(errorMessage(e, STR.proofreadError));
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
        docs.requestRead();
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
      // A file attached while we were already waiting, or a read that failed: ask once more
      // rather than sitting on a spinner for ever.
      if (!readRequestedForSubmitRef.current) {
        readRequestedForSubmitRef.current = true;
        docs.requestRead();
      }
      return;
    }
    if (docStatus === 'ready') {
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
      startSubmitRef.current();
    } else if (docStatus === 'failed' || docStatus === 'empty') {
      // Nothing came back. Stop waiting and leave the reader's own error standing rather
      // than checking nothing.
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
    }
    // Keyed on the document list's STATUS and nothing else: `docs` itself is rebuilt on
    // every render, so depending on the object would re-run this on every poll.
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
    // No foot clearance and so no pinned bar: the submit is in the composer card below,
    // so nothing sits over the last block or over the credit line.
    <main className="page">
      {/* Wallpaper for this lane: what an officer brings here is a draft to be corrected —
          pens and proof marks, dictionaries, ticks and warnings. The marks are decorative
          only, and the vocabulary lives beside the other lanes' in lib/doodleMarks.ts —
          see components/common/PageBackdrop.tsx. */}
      <PageBackdrop marks={PROOFREAD_DOODLES} seed={29} />

      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.proofreadPageTitle}</h1>
          <p className="page-sub">{STR.proofreadPageIntro}</p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        {/* The one input. Everything that decides WHAT is checked lives in this card: the
            typed text and the file behind the paperclip. */}
        <FormCard
          htmlFor="proofread-text"
          label={STR.proofreadInputLabel}
          hint={STR.proofreadInputHint}
        >
          <div className="mt-4">
            {/* Uncontrolled by design: this box is pasted into, but it is also TYPED into,
                and an InScript keyboard assembles each Marathi character in stages a
                controlled box can overwrite half-formed. PromptTextarea wraps
                ComposeSafeTextarea for exactly that reason. */}
            <PromptTextarea
              id="proofread-text"
              value={text}
              onChange={(next) => {
                setText(next);
                resetFlow();
              }}
              placeholder={STR.proofreadInputPlaceholder}
              disabled={checking}
              className="w-full"
            />

            {/* The one band of controls: attach a file, then the page's one action.
                Icon-only for the tool, the same h-9 row the other create surfaces use. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Opens the browser's file dialog directly, the way /dlo's composer
                  tools do. It used to toggle an upload BLOCK below the card, which was a
                  second form with its own upload control and its own page picker. */}
              <ComposerToolbarButton
                icon={Paperclip}
                label={STR.docUpload}
                disabled={checking}
                onClick={docs.pick}
              />

              {/* The count and the action travel together at the right edge, in one group
                  rather than on two competing auto margins — two of those split the free
                  space between them and would leave the count stranded mid-row. */}
              <div className="ms-auto flex items-center gap-3">
                {/* A pasted press note is long enough that "how much is this?" is a real
                    question; an empty box does not need the answer. */}
                {text.length > 0 ? (
                  <span className="text-muted-foreground text-sm">
                    {text.length.toLocaleString('en-IN')} {STR.docChars}
                  </span>
                ) : null}

                {/* THE SUBMIT, at the end of the tool row, exactly as it sits on Creative
                    and Social (components/media-room/NoteComposer), on /dlo and on
                    /translate. The condition is the one the `.card-action` bar carried,
                    unchanged: DISABLED until there is something to check (`canSubmit` —
                    which counts a scanned PDF whose pages are ticked but unread, or an
                    officer whose only source is a scan would face a dead button), and
                    disabled again while a read or a check is genuinely in flight.

                    Enabled, it carries the slow warm sheen (`mr-submit-flow`,
                    globals.css) — the only moving thing on the page, so "there is
                    something to press now" reads without a label; disabled it is quiet
                    and still. */}
                <button
                  type="button"
                  onClick={startSubmit}
                  disabled={disabled}
                  className={cn(
                    'text-primary-foreground inline-flex h-9 shrink-0 items-center rounded-md px-5 text-sm font-bold transition-[filter]',
                    'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    disabled
                      ? 'bg-primary'
                      : 'mr-submit-flow hover:saturate-110 hover:brightness-105',
                  )}
                >
                  {submitLabel}
                </button>
              </div>
            </div>

            {/* Why a press was refused, under the button that was pressed. It used to be
                in the `.card-action` bar; with the button in the card, a message left down
                there would be a refusal the officer never sees. */}
            {error ? (
              <div className="mt-3">
                <ErrorNotice message={error} />
              </div>
            ) : null}

            {/* The one thing the button's own label has no room for: a long text takes a
                minute or two. Only while it is actually running. */}
            {checking ? (
              <p
                className="text-muted-foreground mt-2 text-sm"
                aria-live="polite"
              >
                {STR.proofreadMayTakeTime}
              </p>
            ) : null}

            {/* Directly under the tool that produced it, so "attach" and "attached" are
                one place on the screen. */}
            <AttachmentStrip
              items={docs.items}
              disabled={checking}
              className="mt-4"
            />

            {/* The hidden file input and one reader per attached document. Renders nothing
                — every card the officer sees is in the strip above. */}
            {docs.readers}
          </div>
        </FormCard>

        {/* Everything below is OUTPUT — a consequence of the press above, never something
            to fill in first. Each block is the same box shape as the composer (see
            FormCard), written out because these are headed by an h2 rather than by a label
            pointing at a control. */}
        {clean ? (
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <p className="m-0">
              <span className="chip chip-completed">
                {STR.proofreadNoIssues}
              </span>
            </p>
          </section>
        ) : null}

        {result && errorIssues.length > 0 ? (
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <h2 className="text-foreground m-0 text-base font-semibold">
              {STR.proofreadIssuesTitle}
            </h2>
            {errorIssues.map((issue, index) => (
              <IssueRow key={`${issue.excerpt}-${index}`} issue={issue} />
            ))}
          </section>
        ) : null}

        {result && styleIssues.length > 0 ? (
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <h2 className="text-foreground m-0 text-base font-semibold">
              {STR.proofreadStyleAdvisoryTitle}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {STR.proofreadStyleAdvisoryHint}
            </p>
            {styleIssues.map((issue, index) => (
              <IssueRow key={`${issue.excerpt}-${index}`} issue={issue} />
            ))}
          </section>
        ) : null}

        {result && result.unverifiedNames.length > 0 ? (
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <h2 className="text-foreground m-0 text-base font-semibold">
              {STR.proofreadUnverifiedTitle}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {STR.proofreadUnverifiedHint}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {result.unverifiedNames.map((name) => (
                <span key={name} className="chip chip-queued">
                  {name}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {result ? (
          <section className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
            <h2 className="text-foreground m-0 text-base font-semibold">
              {STR.proofreadCorrectedTitle}
            </h2>
            {result.correctedText === null ? (
              <div className="mt-3">
                <ErrorNotice message={STR.proofreadCorrectedUnavailable} />
              </div>
            ) : (
              <>
                {correctedUnchanged ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {STR.proofreadCorrectedUnchanged}
                  </p>
                ) : null}
                <CorrectedArticle
                  original={checkedText}
                  corrected={result.correctedText}
                  issues={result.issues}
                />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={copyCorrected}
                  >
                    {copied ? STR.copied : STR.copyText}
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() =>
                      downloadBlob(
                        'proofread-corrected.txt',
                        result.correctedText ?? '',
                        'text/plain',
                      )
                    }
                  >
                    {STR.downloadTxt}
                  </Button>
                </div>
              </>
            )}
            {result.language === 'en' ? (
              <p className="text-muted-foreground mt-3 text-sm">
                {STR.proofreadEnglishStyleNote}
              </p>
            ) : null}
            {result.styleReference ? (
              <p className="text-muted-foreground mt-3 text-sm">
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
      </div>
    </main>
  );
}
