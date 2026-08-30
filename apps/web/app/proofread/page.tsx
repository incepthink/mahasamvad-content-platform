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
// `submitAction`, which existed because a scanned PDF's page picker is taller than the
// viewport and the bar below it was off screen. The upload block now opens BELOW the tool
// row that carries तपासणी करा, so the picker can be as tall as it likes without pushing the
// button anywhere — and everything below this card (the issues, the corrected text) is a
// consequence of pressing it rather than something to fill in first. Every complaint the
// press can raise is rendered directly under it.
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
// The upload block itself lives BEHIND THE PAPERCLIP inside the composer, and what is
// attached is a card in the strip under the tool row (AttachmentStrip). The block folds
// away on its own once the file is read and stays open while it still has something to
// ask — a page selection, or a failure.
//
// The file's text is counted BESIDE the textarea rather than pushed into it, so a pasted
// note and an attached document are two independent sources and either one alone is a
// complete job. Both are joined at submit, and the string actually sent is remembered
// (`checkedText`) because the corrected text and its highlight replay are only meaningful
// against the exact input they were produced from.
//
// Nothing is stored — not the text, not the uploaded file (the intake job is in-memory with
// a TTL) — so this page has no history list, unlike /dlo and /transcribe.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Paperclip } from 'lucide-react';
import {
  UPLOAD_FILE_MAX_BYTES,
  buildProofreadHighlights,
  type ProofreadHighlight,
  type ProofreadIssue,
  type ProofreadResponse,
} from '@dgipr/schemas';
import { Button } from '@/components/ui/button';
import {
  AttachmentStrip,
  type AttachmentItem,
} from '@/components/common/AttachmentStrip';
import { ComposerToolbarButton } from '@/components/common/ComposerToolbarButton';
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
import {
  DocumentIntake,
  type DocumentIntakeInfo,
  type DocumentIntakeStatus,
} from '../../components/DocumentIntake';

// Where the upload card remembers its in-flight job. Named once because the remove control
// has to clear it by hand — see clearDocument.
const DOC_STORAGE_KEY = 'dgipr.proofread.document';

// The upload block this page's paperclip opens, named so the button can point at it.
const DOC_PANEL_ID = 'proofread-document';

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
  // The uploaded file's text, kept BESIDE the textarea rather than pushed into it: the two
  // are independent sources and either one alone is a complete job.
  const [docText, setDocText] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentIntakeStatus>('empty');
  // Enough to NAME the file in the attachment strip while it is still being read — the
  // snapshot cannot, being null until there is text to describe.
  const [docInfo, setDocInfo] = useState<DocumentIntakeInfo | null>(null);
  // Whether the upload block below the strip is on screen. Opened by the paperclip and by
  // the attachment card; folded away on its own once a read starts (see the effect below).
  const [docOpen, setDocOpen] = useState(false);
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

  const submitLabel = awaitingRead
    ? STR.docReadingForSubmit
    : checking
      ? STR.proofreadChecking
      : STR.proofreadAction;

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
    // The remount reports 'empty' with no file on its own, but not until it has mounted —
    // and until then the strip would still be showing a card for a document that is gone.
    setDocInfo(null);
    setDocStatus('empty');
    setDocOpen(false);
    setDocKey((n) => n + 1);
    resetFlow();
  };

  // Once a file IS attached, the upload block folds away on its own and its card in the
  // strip takes over — reading progress, page count, remove. Only on the TRANSITION into a
  // read, so re-opening the block from the card leaves it open. A scan waiting for its page
  // selection, or a failed read, is exempt: `docNeedsBlock` below keeps that block on screen
  // regardless, because it is asking a question.
  const docReadStartedRef = useRef(false);
  useEffect(() => {
    const reading = docStatus === 'reading' || docStatus === 'ready';
    if (reading && !docReadStartedRef.current) setDocOpen(false);
    docReadStartedRef.current = reading;
  }, [docStatus]);

  // Folding either of these away would hide the question, and in the page-selection case
  // the check would then run over a document nobody had paid to read.
  const docNeedsBlock = docStatus === 'unread' || docStatus === 'failed';
  const showDoc = docOpen || docNeedsBlock;

  const attachments: AttachmentItem[] = docInfo
    ? [
        {
          id: 'document',
          name: docInfo.fileName,
          icon: FileText,
          meta:
            docStatus === 'reading'
              ? STR.attachmentReading
              : docStatus === 'unread'
                ? STR.attachmentNeedsPages
                : docStatus === 'failed'
                  ? STR.attachmentFailed
                  : docInfo.pageCount !== null
                    ? `${docInfo.pageCount.toLocaleString('mr-IN')} ${STR.attachmentPagesSuffix}`
                    : STR.attachmentReady,
          busy: docStatus === 'reading',
          failed: docStatus === 'failed',
          removeLabel: `${STR.docRemove}: ${docInfo.fileName}`,
          onRemove: clearDocument,
          // Only while the block is foldable: opening it is the point of the card, but a
          // block that is on screen asking a question must not be closable from here.
          ...(docNeedsBlock
            ? {}
            : {
                open: showDoc,
                openLabel: showDoc ? STR.attachmentClose : STR.attachmentOpen,
                onOpen: () => setDocOpen((open) => !open),
              }),
        },
      ]
    : [];

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
              <ComposerToolbarButton
                icon={Paperclip}
                label={STR.docUpload}
                disabled={checking}
                active={showDoc}
                controls={DOC_PANEL_ID}
                onClick={() => setDocOpen((open) => !open)}
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
              items={attachments}
              disabled={checking}
              className="mt-4"
            />
          </div>

          {/* The text to check usually exists as a file — a draft press note, a scanned GR.
              The shared intake reads pdf/docx/txt; a scanned PDF stops to ask which pages
              are worth OCR'ing before a single credit is spent.

              LIVE mode (onTextChange): its text is counted beside the box above rather than
              pushed into it, so there is no hand-over button to find and no way to leave an
              upload behind. See the header.

              No rule of its own: `.doc-intake-embedded` already draws the divider and the
              spacing above itself, and a wrapper adding a second `border-t` would stack two
              lines above the block. */}
          {showDoc ? (
            <div id={DOC_PANEL_ID} className="mt-3">
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
                onStatusChange={(status, info) => {
                  setDocStatus(status);
                  setDocInfo(info);
                }}
                readRequest={readRequest}
                // Offered only once there IS a file: the component renders this control in
                // every state including the empty upload card, where there is nothing to
                // delete — and the paperclip already closes that.
                {...(docStatus === 'empty' ? {} : { onRemove: clearDocument })}
              />
            </div>
          ) : null}
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
