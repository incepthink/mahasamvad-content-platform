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
import { FileText, ListChecks } from 'lucide-react';
import type {
  AnalyticsFeatureKey,
  DocumentKind,
  PdfTextSourceValue,
} from '@dgipr/schemas';
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
import { useDocumentIntake } from '../lib/useDocumentIntake';
import { STR } from '../lib/strings';
import { CardTitle } from './CardTitle';
import { DocumentPages } from './DocumentPages';

const EXTENSIONS: Record<DocumentKind, string> = {
  pdf: '.pdf',
  docx: '.docx',
  txt: '.txt',
};

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

export function DocumentIntake({
  storageKey,
  accept = ['pdf', 'docx', 'txt'],
  maxChars,
  maxBytes,
  title,
  hint,
  allowDeferredRead = false,
  feature,
  onText,
  onTextChange,
  onStatusChange,
  readRequest,
  onRemove,
}: {
  // Where this surface remembers its in-flight job across a refresh. Must be unique per
  // surface, or two pages would fight over one job.
  storageKey: string;
  accept?: readonly DocumentKind[] | undefined;
  // The caller's character budget, if it has one. Shown against the running total so the
  // page checkboxes become the way to get under it.
  maxChars?: number | undefined;
  // The caller's per-file upload ceiling, if it has one. Checked before the upload starts,
  // which on a large scan is the difference between a refusal now and one several minutes
  // from now. Omitted by every surface that does not cap uploads — the shared document
  // service itself does not.
  maxBytes?: number | undefined;
  // Card heading + hint, when the shared copy does not fit. /dlo needs its own: the default
  // hint promises the file is not stored, and a DLO document IS archived with the intake.
  title?: string | undefined;
  hint?: string | undefined;
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
  // Which sidebar feature this upload belongs to, for /analytics attribution only. The
  // document service is shared by four surfaces and knows nothing else about its caller, so
  // without it a PAID OCR read is countable in the bill and attributable to nobody. Optional
  // and never guessed server-side: an omitted value records no service row, which is honest,
  // where a default would put one surface's spend on another's card.
  feature?: AnalyticsFeatureKey | undefined;
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
  onStatusChange?: ((status: DocumentIntakeStatus) => void) | undefined;
  readRequest?: number | undefined;
  // Offered by a surface that shows SEVERAL of these at once (/dlo), where dropping one
  // document has to be possible without dropping the others.
  onRemove?: (() => void) | undefined;
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
  const text = useMemo(
    () =>
      joinPageTexts(pages, {
        isSelected: (page) => selected.has(page),
        edits,
      }),
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

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  });
  useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

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
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setUploading(false);
    }
  };

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
      setError(e instanceof Error ? e.message : STR.genericError);
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
      setError(e instanceof Error ? e.message : STR.genericError);
    }
  };

  // ---------- render ----------

  if (gone && jobId) {
    return (
      <section className="card">
        <p className="form-error">{STR.docGone}</p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            {STR.docUploadOther}
          </button>
        </div>
      </section>
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
      {onRemove ? (
        <button
          type="button"
          className="btn btn-small"
          onClick={onRemove}
          disabled={uploading || extracting}
        >
          {STR.docRemove}
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

  if (!jobId) {
    return (
      <section className="card">
        {/* An <h2>, like every other card heading on the surfaces this appears on:
            .field-label is scoped to <label> in globals.css, so a <p> carrying it rendered
            unweighted. The two later states below use the same element for the same reason. */}
        <CardTitle icon={FileText}>{title ?? STR.docUploadTitle}</CardTitle>
        <p className="hint">{hint ?? STR.docUploadHint}</p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          {fileButton}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    );
  }

  if (!detail || detail.status === 'extracting') {
    return (
      <section className="card">
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
              <FileText size={16} aria-hidden="true" /> {detail.fileName}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  if (detail.status === 'failed' && pages.length === 0) {
    return (
      <section className="card">
        {detail.error ? <p className="form-error">{detail.error}</p> : null}
        <div className="btn-row" style={{ marginTop: 12 }}>
          {fileButton}
        </div>
      </section>
    );
  }

  // The pre-OCR page picker. Numbers only: this document's text does not exist yet, and
  // producing it is exactly the spend being authorised here.
  if (isSelecting) {
    return (
      <section className="card">
        <CardTitle icon={ListChecks}>{STR.docSelectTitle}</CardTitle>
        <p className="hint">
          {reselecting ? STR.docChangeSelectionHint : STR.docSelectHint}
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          <FileText size={16} aria-hidden="true" /> {detail.fileName} ·{' '}
          {STR.docSelectTotal} {marathiNumber(detail.pageCount ?? 0)}
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
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="card">
      <CardTitle icon={FileText}>{STR.docReviewTitle}</CardTitle>
      <p className="hint">{STR.docReviewHint}</p>
      <p className="hint" style={{ marginTop: 8 }}>
        <FileText size={16} aria-hidden="true" /> {detail.fileName}
      </p>

      {/* A translation-style failure after some pages were read: the text is still usable,
          so say what went wrong and leave the controls alone. */}
      {detail.status === 'failed' && detail.error ? (
        <p className="form-error">{detail.error}</p>
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
      </div>
      {text.trim().length === 0 ? (
        <p className="hint">{STR.docEmptySelection}</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
