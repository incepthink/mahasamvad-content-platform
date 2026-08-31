'use client';

// "Get the text out of a file, then hand it to me." The whole ephemeral upload flow in one
// component, for surfaces that just want a string: the media room (paste a finished
// article) and /proofread.
//
// The steps it shows follow the FILE, not the page it sits on:
//
//   .txt / .docx   read locally at upload for nothing, so there is one page and nothing to
//                  choose — straight to the review card.
//   born-digital   its text layer was free too, so the review list doubles as the picker.
//   scanned PDF    stops first at a page picker showing NUMBERS only. Its text does not
//                  exist yet; producing it is the OCR spend being authorised, and only the
//                  ticked pages are ever paid for.
//
// Two things worth knowing before editing:
//   - The job lives in the API's MEMORY. A 404 means it expired or the API restarted, and
//     the only honest recovery is to upload again — which is what `gone` does. The job id
//     is kept in sessionStorage so a refresh during a 10-minute OCR reattaches instead of
//     abandoning a read that has already been paid for.
//   - In the default HANDOFF mode nothing is committed to the caller until "हा मजकूर
//     वापरा". The user can uncheck pages and fix OCR errors first, and on a surface with a
//     character cap that is how they get under it. A surface that treats the file as a
//     SECOND source beside its own text box passes `onTextChange` instead (LIVE mode) —
//     see the prop comments.
//   - A surface with a job of its own downstream (/dlo) can pass `allowDeferredRead`. While
//     the server is still waiting for a scanned PDF's page selection, that live selection is
//     handed over automatically as `pendingPages`; the caller reads it later, with no commit
//     button or OCR wait here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText, ListChecks, Trash2 } from 'lucide-react';
import type {
  AnalyticsFeatureKey,
  DocumentKind,
  PdfTextSourceValue,
} from '@dgipr/schemas';
import { DOCUMENT_MAX_BYTES } from '@dgipr/schemas';
import {
  createDocumentIntake,
  extractDocumentIntakePages,
  reextractDocumentIntake,
} from '../lib/api';
import {
  joinPageTexts,
  numberedPages,
  pageText,
  setPages,
  togglePage,
} from '../lib/documentSelection';
import { extractedPlainText } from '../lib/extractedText';
import { useDocumentIntake } from '../lib/useDocumentIntake';
import { STR } from '../lib/strings';
import { errorMessage, storedErrorMessage } from '../lib/errorMessage';
import { CardTitle } from './CardTitle';
import { DocumentPages } from './DocumentPages';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';

const EXTENSIONS: Record<DocumentKind, string> = {
  pdf: '.pdf',
  docx: '.docx',
  txt: '.txt',
};

// For a caller that owns the file control itself (a composer toolbar button, on a surface
// that mounts this component `headless`): the dialog's filter and the check applied to what
// comes back, from the one list, so the two can never disagree about what a document is.
export const DOCUMENT_FILE_ACCEPT = Object.values(EXTENSIONS).join(',');

export function isDocumentFileName(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return Object.values(EXTENSIONS).some((ext) => name.endsWith(ext));
}

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

// Everything a caller needs to describe the file behind the text it just received: which
// ephemeral job it came from (so an API-side caller can still reach the original bytes),
// what it was called, and — for a surface that keeps documents page by page rather than as
// one string — the SELECTED pages with the user's corrections already applied.
export type DocumentSnapshot = Readonly<{
  jobId: string;
  fileName: string;
  kind: DocumentKind;
  source: PdfTextSourceValue | null;
  pageCount: number | null;
  pages: ReadonlyArray<{ page: number; text: string }>;
  // The pages the user picked but deliberately did NOT have read (see `allowDeferredRead`).
  // Empty on every ordinary snapshot, and mutually exclusive with `pages`: a deferred document
  // has no text at all yet, only a selection. A caller that cannot read them later must treat a
  // snapshot carrying these as empty.
  pendingPages: readonly number[];
}>;

export type DocumentIntakeStatus =
  'empty' | 'unread' | 'reading' | 'ready' | 'failed';

/**
 * Enough to NAME the attached file while it is still being read — which the snapshot
 * cannot do, being null until there is text (or a deferred selection) to describe. It
 * exists for the attachment strip above this block: a card that says "वाचत आहोत…" under
 * a blank name would be worse than no card at all.
 */
export type DocumentIntakeInfo = Readonly<{
  fileName: string;
  kind: DocumentKind;
  pageCount: number | null;
}>;

export function DocumentIntake({
  storageKey,
  accept = ['pdf', 'docx', 'txt'],
  maxChars,
  maxBytes = DOCUMENT_MAX_BYTES,
  title,
  hint,
  autoOpenPicker = false,
  allowDeferredRead = false,
  readWholeDocument = false,
  embedded = false,
  headless = false,
  feature,
  file,
  onText,
  onTextChange,
  onStatusChange,
  onError,
  readRequest,
  onRemove,
  submitAction,
}: {
  // Where this surface remembers its in-flight job across a refresh. Must be unique per
  // surface, or two pages would fight over one job.
  storageKey: string;
  accept?: readonly DocumentKind[] | undefined;
  // The caller's character budget, if it has one. Shown against the running total so the
  // page checkboxes become the way to get under it.
  maxChars?: number | undefined;
  // The per-file upload ceiling, checked before the upload starts — which on a large scan is
  // the difference between a refusal now and one several minutes from now.
  //
  // DEFAULTED, not optional-and-usually-absent: the ceiling is the reading backend's own
  // per-file limit, so it is true of every surface rather than a policy each one opts into.
  // A caller may still pass a LOWER one; passing Infinity is how a future surface with its
  // own reader opts out.
  maxBytes?: number | undefined;
  // Card heading + hint, when the shared copy does not fit. /dlo needs its own: the default
  // hint promises the file is not stored, and a DLO document IS archived with the intake.
  title?: string | undefined;
  hint?: string | undefined;
  // Opens the file dialog as soon as the card appears. For a surface where this block is
  // itself the answer to an "attach a document" button (/dlo): the officer has already said
  // what they want, so the identical press inside the card that appears is a step with no
  // decision in it. Ignored when the card mounts onto an in-flight job — a read already
  // being paid for must never be interrupted by a file dialog.
  autoOpenPicker?: boolean | undefined;
  // Makes the live page SELECTION itself the handover while the server is still in
  // `status === 'selecting'`, leaving the reading to whatever runs next. Only /dlo may set
  // this — it is the one surface with a job of its own downstream (the intake reads exactly
  // these pages from the archived original). The server-status gate deliberately excludes
  // reselecting an already-read scan, whose paid text must not be discarded and re-read later.
  // Everywhere else the text has to exist in the browser now, so a selection with no text
  // would simply be a lost upload.
  //
  // LIVE mode only, in practice: a deferred document has no text, so there is nothing for the
  // handoff button to hand over.
  allowDeferredRead?: boolean | undefined;
  // This surface reads the WHOLE document, so there is no page to choose and no picker to
  // show. Set by /dlo, where a PDF is handed to the model entire rather than page by page.
  //
  // It does not change what is handed over — the picker already defaulted to every page and
  // `allowDeferredRead` already handed that selection on without a commit — only whether the
  // officer is asked a question that no longer has consequences. Keeping the selection
  // machinery underneath is deliberate: `pendingPages` stays the wire shape, so the route,
  // the intake job and the review step needed no change, and a surface that reads page by
  // page again is one prop away.
  readWholeDocument?: boolean | undefined;
  // Renders as a plain block inside the caller's own card instead of as a card of its own.
  // For a surface where the file sits BESIDE its text box rather than replacing it (the
  // media room): a nested card there reads as a second, separate form, and the officer has
  // to work out whether the two are related. Only the wrapper and the heading level change
  // — every state below renders identically inside it.
  embedded?: boolean | undefined;
  // Renders NOTHING — every hook above the render stays, so the file is still uploaded,
  // polled, selected whole and reported through the callbacks below, but this component
  // draws no card. For a surface that already lists its sources somewhere else (/dlo lists
  // every attachment as a card in its composer strip): with no page to choose, the card
  // here had only the file's name and a remove button left on it, both of which that strip
  // already carries, so it was a second copy of an answer the officer had already been
  // given. A headless caller supplies the file itself (`file`) — there is no file control
  // to press — and must take `onError`, or an upload refusal has nowhere to appear.
  headless?: boolean | undefined;
  // Which sidebar feature this upload belongs to, for /analytics attribution only. The
  // document service is shared by four surfaces and knows nothing else about its caller, so
  // without it a PAID OCR read is countable in the bill and attributable to nobody. Optional
  // and never guessed server-side: an omitted value records no service row, which is honest,
  // where a default would put one surface's spend on another's card.
  feature?: AnalyticsFeatureKey | undefined;
  // The file to read, for a caller that owns the file control itself (see `headless`).
  // Uploaded once, when it first arrives, and never over a job this component is already
  // re-attaching to — a read that has been paid for outranks a fresh pick of the same slot.
  // Ignored while this component renders its own picker; there the <input> is the source.
  file?: File | undefined;
  // HANDOFF mode: the text reaches the caller only when the button is pressed. Right for a
  // surface whose single text box the file REPLACES (/translate, /proofread) — the click is
  // what authorises overwriting whatever is in it.
  onText?: ((text: string) => void) | undefined;
  // LIVE mode: the current selection's text is streamed to the caller as it changes (and ''
  // when the file is dropped or re-read), and the hand-over button disappears. For a surface
  // that keeps the file's text BESIDE its own box rather than in it — there is nothing to
  // overwrite, so a button that has to be found and pressed only ever silently discards the
  // whole upload, which is exactly what it did on the media room.
  //
  // The second argument describes the file the text came from (null while nothing is
  // loaded). A caller that only wants a string ignores it — which is why it is a second
  // parameter rather than a change to the first.
  onTextChange?:
    ((text: string, snapshot: DocumentSnapshot | null) => void) | undefined;
  // LIVE mode: lets a parent distinguish an attached scan whose selected pages have not
  // been read yet from a genuinely empty source. Bumping `readRequest` asks this component
  // to run its existing selected-page extraction flow.
  // The second argument names the attached file (null before one is attached), so a
  // caller listing its sources can label a read that is still running. A caller that only
  // wants the status ignores it — which is why it is a second parameter rather than a
  // change to the first.
  onStatusChange?:
    | ((status: DocumentIntakeStatus, info: DocumentIntakeInfo | null) => void)
    | undefined;
  // Upload refusals (wrong kind, too large, the create call failed) and their clearing,
  // for a caller that has to show them itself. REQUIRED IN PRACTICE of a `headless` one:
  // this component renders the notice inline in every other mode, and a refusal nobody
  // renders is an attachment that silently never appears.
  onError?: ((message: string | null) => void) | undefined;
  readRequest?: number | undefined;
  // Offered by a surface that shows SEVERAL of these at once (/dlo), where dropping one
  // document has to be possible without dropping the others.
  onRemove?: (() => void) | undefined;
  // The caller's own primary action (the media room's तयार करा), rendered beside the file
  // controls in every state that HAS a file. A scanned PDF's page picker is tall enough to
  // push the surface's own submit off screen, so the action has to be reachable from where
  // the officer's attention already is — and it is the caller's node rather than a callback
  // so the label, the disabled rule and the busy spinner stay owned by the one place that
  // knows them. Not shown before a file is attached: the caller's own submit is still in
  // view there, and a second copy of it would be noise.
  submitAction?: ReactNode | undefined;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [used, setUsed] = useState(false);
  // Re-opening the page picker on an already-read scan. Purely local: the server has no
  // "go back to selecting" state and does not need one — changing the selection is just
  // another /extract call.
  const [reselecting, setReselecting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { detail, gone, refresh } = useDocumentIntake(jobId);

  // Re-attach to a job left running by a previous page view (refresh, accidental
  // navigation). An id that no longer exists resolves to `gone` on the first poll.
  useEffect(() => {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored) setJobId(stored);
  }, [storageKey]);

  useEffect(() => {
    if (jobId) window.sessionStorage.setItem(storageKey, jobId);
    else window.sessionStorage.removeItem(storageKey);
  }, [jobId, storageKey]);

  // Open the dialog with the card (see `autoOpenPicker`). Once per mount, and gated on
  // sessionStorage rather than on `jobId`, because the re-attach effect above has not
  // committed its state by the time this one runs — reading the store is the only way to
  // know here whether this card is about to adopt a job. The click rides the officer's own
  // click into the browser's transient activation window (a passive effect in the same tick),
  // which is what makes the dialog allowed to open at all.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpenPicker || autoOpened.current) return;
    autoOpened.current = true;
    if (window.sessionStorage.getItem(storageKey)) return;
    fileInput.current?.click();
  }, [autoOpenPicker, storageKey]);

  const isSelecting =
    detail?.status === 'selecting' ||
    (reselecting && detail?.status === 'ready');
  // Use the server status rather than `isSelecting`: that flag also covers re-picking pages
  // from an already-read scan, where auto-deferral would discard text already paid for.
  const deferring = allowDeferredRead && detail?.status === 'selecting';

  // What the checkboxes list. While selecting that is every page the document HAS (known
  // from the free probe, before anything is read); afterwards it is the pages actually
  // read — which, after a partial read, is NOT 1..n, so the numbers must come from the
  // pages themselves rather than from a count.
  const listedPages = useMemo(
    () =>
      isSelecting
        ? numberedPages(detail?.pageCount ?? 0)
        : (detail?.pages ?? []).map((page) => page.page),
    [isSelecting, detail?.pageCount, detail?.pages],
  );

  // Everything is selected by default — wanting the whole document is the common case, and
  // narrowing is what the checkboxes are for. A selection the user already made survives
  // the move from picker to review list.
  useEffect(() => {
    if (listedPages.length === 0) return;
    setSelected((prev) => (prev.size > 0 ? prev : new Set(listedPages)));
  }, [listedPages]);

  // Extraction started, so the picker has done its job and must not reappear over the
  // fresh pages when the job lands back on 'ready'.
  useEffect(() => {
    if (detail?.status === 'extracting') {
      setReselecting(false);
    } else if (detail?.status === 'ready' || detail?.status === 'failed') {
      setExtracting(false);
    }
  }, [detail?.status]);

  const pages = detail?.pages ?? [];
  // The string every caller receives, and it is PROSE — a page read by Sarvam's OCR
  // arrives as semantic HTML (see lib/extractedText), and /translate and /proofread were
  // handing that markup to a model as the text to work on. The pages themselves are left
  // exactly as they were extracted: the review list still renders the HTML as a table and
  // the correction textarea still edits the source, so what is stored and what is shown
  // are unchanged — only what leaves this component for a model is converted.
  const text = useMemo(
    () =>
      extractedPlainText(
        joinPageTexts(pages, {
          isSelected: (page) => selected.has(page),
          edits,
        }),
      ),
    [pages, selected, edits],
  );
  const overLimit = maxChars !== undefined && text.length > maxChars;
  const live = onTextChange !== undefined;
  const status = useMemo<DocumentIntakeStatus>(() => {
    if (gone && jobId) return 'failed';
    if (!jobId) return 'empty';
    if (text.trim().length > 0) return 'ready';
    if (!detail || detail.status === 'extracting' || extracting) {
      return 'reading';
    }
    if (isSelecting) return selected.size > 0 ? 'unread' : 'empty';
    if (detail.status === 'failed' && pages.length === 0) return 'failed';
    return 'empty';
  }, [
    gone,
    jobId,
    text,
    detail,
    extracting,
    isSelecting,
    selected.size,
    pages.length,
  ]);

  // The same selection `text` was built from, kept page by page for a caller that stores
  // documents that way. Null until there is a read file to describe.
  const snapshot = useMemo<DocumentSnapshot | null>(() => {
    if (!jobId || !detail) return null;
    // A deferred document describes the live selection, not text: `pages` is empty and
    // `source` is unknown because nothing has read it yet.
    if (deferring) {
      if (selected.size === 0) return null;
      return {
        jobId,
        fileName: detail.fileName,
        kind: detail.kind,
        source: null,
        pageCount: detail.pageCount,
        pages: [],
        pendingPages: [...selected].sort((a, b) => a - b),
      };
    }
    if (pages.length === 0) return null;
    return {
      jobId,
      fileName: detail.fileName,
      kind: detail.kind,
      source: detail.source,
      pageCount: detail.pageCount,
      pages: pages
        .filter((page) => selected.has(page.page))
        .map((page) => ({ page: page.page, text: pageText(page, edits) })),
      pendingPages: [],
    };
  }, [jobId, detail, deferring, pages, selected, edits]);

  const acceptAttr = accept.map((kind) => EXTENSIONS[kind]).join(',');

  // Live mode: publish the current text on every change. Held in a ref so an inline arrow
  // from the caller (the normal way this is passed) cannot re-fire the effect on every
  // render — only a real change of `text` may.
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  });
  useEffect(() => {
    onTextChangeRef.current?.(text, snapshot);
  }, [text, snapshot]);

  // Memoized on the three fields rather than on `detail`, which is a fresh object on
  // every poll — without that, the effect below would re-fire every 2.5 seconds and
  // re-render the caller's whole form for no change.
  const info = useMemo<DocumentIntakeInfo | null>(
    () =>
      detail
        ? {
            fileName: detail.fileName,
            kind: detail.kind,
            pageCount: detail.pageCount,
          }
        : null,
    [detail?.fileName, detail?.kind, detail?.pageCount],
  );

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });
  useEffect(() => {
    onStatusChangeRef.current?.(status, info);
  }, [status, info]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  useEffect(() => {
    onErrorRef.current?.(error);
  }, [error]);

  // "हा मजकूर वापरा" hands over a snapshot, so any later change to the selection or the
  // text means the caller is now holding something stale — say so rather than leave a
  // confirmation standing over text that no longer matches.
  useEffect(() => {
    setUsed(false);
  }, [text]);

  const resetSelection = () => {
    setSelected(new Set());
    setEdits({});
    setError(null);
    setUsed(false);
    setReselecting(false);
    setExtracting(false);
  };

  const reset = () => {
    setJobId(null);
    resetSelection();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!accept.some((kind) => name.endsWith(EXTENSIONS[kind]))) {
      setError(STR.docUnsupported);
      return;
    }
    if (maxBytes !== undefined && file.size > maxBytes) {
      setError(STR.fileTooLargeError);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      if (feature) form.append('feature', feature);
      const created = await createDocumentIntake(form);
      resetSelection();
      setJobId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  // The caller's own pick (see `file`). Keyed on the File itself rather than on its name,
  // so re-picking the same file after a removal still uploads; gated on sessionStorage
  // rather than on `jobId`, because the re-attach effect above has not committed its state
  // by the time this one runs — the `autoOpenPicker` reasoning, for the same reason.
  const uploadedFile = useRef<File | null>(null);
  useEffect(() => {
    if (!file || uploadedFile.current === file) return;
    uploadedFile.current = file;
    if (window.sessionStorage.getItem(storageKey)) return;
    // `upload` is deliberately not a dependency: it is recreated every render, and the
    // File identity guarded above is what decides whether this fires.
    void upload(file);
  }, [file, storageKey]);

  // "Read these pages." The one call that spends OCR credits on a scanned document — and
  // only on what is ticked. The job goes to 'extracting' and the poll takes over.
  const readSelected = useCallback(async () => {
    if (!jobId || selected.size === 0) return;
    setExtracting(true);
    setError(null);
    try {
      await extractDocumentIntakePages(
        jobId,
        [...selected].sort((a, b) => a - b),
      );
      setEdits({});
      setUsed(false);
      setReselecting(false);
      await refresh();
    } catch (e) {
      setExtracting(false);
      setError(errorMessage(e));
    }
  }, [jobId, refresh, selected]);

  // A request counter makes retries explicit and prevents a still-true boolean from
  // re-running an OCR read after a failed attempt or a later file upload.
  const handledReadRequestRef = useRef(readRequest);
  useEffect(() => {
    if (
      readRequest === undefined ||
      readRequest === handledReadRequestRef.current ||
      status !== 'unread'
    ) {
      return;
    }
    handledReadRequestRef.current = readRequest;
    void readSelected();
  }, [readRequest, readSelected, status]);

  // Re-read with OCR. Page text (including the user's corrections) is rebuilt from
  // scratch, so the edits go with it — but the page SELECTION is kept and sent, because
  // this overrules the quality gate, not the spend one.
  const rereadWithOcr = async () => {
    if (!jobId || selected.size === 0) return;
    setExtracting(true);
    setError(null);
    try {
      await reextractDocumentIntake(
        jobId,
        [...selected].sort((a, b) => a - b),
      );
      setEdits({});
      setUsed(false);
      await refresh();
    } catch (e) {
      setExtracting(false);
      setError(errorMessage(e));
    }
  };

  // ---------- render ----------

  // Nothing to draw (see `headless`). Every hook above has already run, so the upload, the
  // poll, the whole-document selection and all three callbacks behave exactly as they do
  // for a caller that shows the card.
  if (headless) return null;

  // Every state below is wrapped in the same shell, so `embedded` is decided once here
  // rather than at six return sites. A string tag keeps its identity across renders, so
  // switching it can never remount the tree inside (the ReferencePicker precedent).
  const Shell = embedded ? 'div' : 'section';
  const shellClass = embedded ? 'doc-intake-embedded' : 'card';
  // Subordinate to the caller's own card heading when embedded; the look is identical and
  // only the document outline differs (see CardTitle).
  const titleLevel = embedded ? 3 : 2;

  if (gone && jobId) {
    return (
      <Shell className={shellClass}>
        <ErrorNotice message={STR.docGone} />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            {STR.docUploadOther}
          </button>
        </div>
      </Shell>
    );
  }

  // The upload control, plus the remove control when the surface offers one. Built once and
  // dropped into every render branch below, so "choose another file" and "remove this
  // document" are reachable from whichever state the card is in.
  const fileButton = (
    <>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => fileInput.current?.click()}
        disabled={uploading || extracting}
      >
        {uploading
          ? STR.submitting
          : jobId
            ? STR.docUploadOther
            : STR.docUpload}
      </button>
      {/* Icon-only: this is the one destructive control in the row and it sat beside the
          file picker as a same-sized worded button, which made "choose a file" and "throw
          this document away" look like the same kind of action. The label still travels as
          title + aria-label — the icon-btn doctrine — so nothing depends on reading a shape. */}
      {onRemove ? (
        <button
          type="button"
          className="icon-btn icon-btn-sm icon-btn-danger"
          onClick={onRemove}
          disabled={uploading || extracting}
          title={STR.docRemove}
          aria-label={STR.docRemove}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept={acceptAttr}
        hidden
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </>
  );

  // Placed by hand in each row below rather than folded into `fileButton`, because the page
  // picker swaps that button for a cancel one while re-picking pages — and the officer's own
  // submit must not disappear with it.
  const callerAction = jobId ? submitAction : null;

  if (!jobId) {
    return (
      <Shell className={shellClass}>
        {/* An <h2>, like every other card heading on the surfaces this appears on:
            .field-label is scoped to <label> in globals.css, so a <p> carrying it rendered
            unweighted. The two later states below use the same element for the same reason. */}
        <CardTitle icon={FileText} level={titleLevel}>
          {title ?? STR.docUploadTitle}
        </CardTitle>
        <p className="hint">{hint ?? STR.docUploadHint}</p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          {fileButton}
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </Shell>
    );
  }

  if (!detail || detail.status === 'extracting') {
    return (
      <Shell className={shellClass}>
        <div className="dlo-processing">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <p className="dlo-processing-title">{STR.docExtracting}</p>
          <p className="hint">{STR.docExtractingHint}</p>
          {detail?.extractProgress ? (
            <p className="hint">
              {STR.docExtractProgress}{' '}
              {marathiNumber(detail.extractProgress.pagesDone)} /{' '}
              {marathiNumber(detail.extractProgress.pageCount)}
            </p>
          ) : null}
          {detail ? (
            <p className="hint">
              <FileText size={16} aria-hidden="true" />{' '}
              <FileName name={detail.fileName} />
            </p>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (detail.status === 'failed' && pages.length === 0) {
    return (
      <Shell className={shellClass}>
        {detail.error ? (
          <ErrorNotice
            message={storedErrorMessage(detail.error, STR.genericError)}
          />
        ) : null}
        <div className="btn-row" style={{ marginTop: 12 }}>
          {fileButton}
          {callerAction}
        </div>
      </Shell>
    );
  }

  // A surface that reads the whole document has nothing to ask. The card still exists —
  // the officer needs to see WHICH file is attached and be able to swap or drop it — but it
  // states what will happen instead of requesting a decision. `selected` is already every
  // page (see the effect above), so the snapshot this reports is unchanged.
  if (isSelecting && readWholeDocument) {
    return (
      <Shell className={shellClass}>
        <CardTitle icon={FileText} level={titleLevel}>
          {STR.docWholeReadTitle}
        </CardTitle>
        <p className="hint">{STR.docWholeReadHint}</p>
        <p className="hint" style={{ marginTop: 8 }}>
          <FileText size={16} aria-hidden="true" />{' '}
          <FileName name={detail.fileName} /> · {STR.docSelectTotal}{' '}
          {marathiNumber(detail.pageCount ?? 0)}
        </p>
        <div className="btn-row" style={{ marginTop: 14 }}>
          {fileButton}
          {callerAction}
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </Shell>
    );
  }

  // The pre-OCR page picker. Numbers only: this document's text does not exist yet, and
  // producing it is exactly the spend being authorised here.
  if (isSelecting) {
    return (
      <Shell className={shellClass}>
        <CardTitle icon={ListChecks} level={titleLevel}>
          {STR.docSelectTitle}
        </CardTitle>
        <p className="hint">
          {reselecting ? STR.docChangeSelectionHint : STR.docSelectHint}
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          <FileText size={16} aria-hidden="true" />{' '}
          <FileName name={detail.fileName} /> · {STR.docSelectTotal}{' '}
          {marathiNumber(detail.pageCount ?? 0)}
        </p>

        <DocumentPages
          pageNumbers={listedPages}
          isSelected={(page) => selected.has(page)}
          busy={extracting}
          onToggle={(page) => setSelected((prev) => togglePage(prev, page))}
          onSetAll={(all, include) =>
            setSelected((prev) => setPages(prev, all, include))
          }
        />

        <p className="hint" style={{ marginTop: 12 }}>
          {marathiNumber(selected.size)} /{' '}
          {marathiNumber(detail.pageCount ?? 0)} {STR.docSelectCount}
        </p>

        {/* /dlo hands the live selection to its downstream job automatically. */}
        {deferring ? (
          <p className="hint" style={{ marginTop: 8 }}>
            {STR.docPagesReadLaterHint}
          </p>
        ) : null}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-small"
            disabled={extracting || selected.size === 0}
            onClick={() => void readSelected()}
          >
            {extracting ? STR.submitting : STR.docReadSelected}
          </button>
          {reselecting ? (
            <button
              type="button"
              className="btn"
              disabled={extracting}
              onClick={() => setReselecting(false)}
            >
              {STR.docReextractCancel}
            </button>
          ) : (
            fileButton
          )}
          {callerAction}
        </div>
        {error ? <ErrorNotice message={error} /> : null}
      </Shell>
    );
  }

  return (
    <Shell className={shellClass}>
      <CardTitle icon={FileText} level={titleLevel}>
        {STR.docReviewTitle}
      </CardTitle>
      <p className="hint">{STR.docReviewHint}</p>
      <p className="hint" style={{ marginTop: 8 }}>
        <FileText size={16} aria-hidden="true" />{' '}
        <FileName name={detail.fileName} />
      </p>

      {/* A translation-style failure after some pages were read: the text is still usable,
          so say what went wrong and leave the controls alone. */}
      {detail.status === 'failed' && detail.error ? (
        <ErrorNotice
          message={storedErrorMessage(detail.error, STR.genericError)}
        />
      ) : null}

      {/* Offered only while the document still has pages nobody has paid to read — on a
          fully-read document the review list below already IS the picker. */}
      {detail.pageCount !== null && detail.pageCount > pages.length ? (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-small"
            disabled={extracting}
            onClick={() => setReselecting(true)}
          >
            {STR.docChangeSelection}
          </button>
        </div>
      ) : null}

      <DocumentPages
        pages={pages}
        isSelected={(page) => selected.has(page)}
        edits={edits}
        source={detail.source}
        busy={extracting}
        onToggle={(page) => setSelected((prev) => togglePage(prev, page))}
        onSetAll={(all, include) =>
          setSelected((prev) => setPages(prev, all, include))
        }
        onEdit={(key, value) => setEdits((prev) => ({ ...prev, [key]: value }))}
        // Only a PDF has a second backend to fall back to.
        {...(detail.kind === 'pdf'
          ? { onReextract: () => void rereadWithOcr() }
          : {})}
      />

      <p
        className={overLimit ? 'form-error' : 'hint'}
        style={{ marginTop: 12 }}
      >
        {marathiNumber(text.length)}
        {maxChars !== undefined ? ` / ${marathiNumber(maxChars)}` : ''}{' '}
        {STR.docChars}
      </p>

      {/* Live mode has nothing to confirm — the caller already holds this text — so it gets
          a statement of that instead of a button nobody would know to press. */}
      {live && text.trim().length > 0 ? (
        <p className="hint" style={{ marginTop: 4 }}>
          {STR.docAutoUsed}
        </p>
      ) : null}

      <div className="btn-row" style={{ marginTop: 14 }}>
        {live ? null : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={extracting || text.trim().length === 0 || overLimit}
            onClick={() => {
              onText?.(text);
              setUsed(true);
            }}
          >
            {used ? STR.docUsed : STR.docUseText}
          </button>
        )}
        {fileButton}
        {callerAction}
      </div>
      {text.trim().length === 0 ? (
        <p className="hint">{STR.docEmptySelection}</p>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
    </Shell>
  );
}
