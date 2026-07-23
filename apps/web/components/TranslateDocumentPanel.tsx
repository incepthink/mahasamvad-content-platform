'use client';

// The PDF half of /translate: upload a document, pick pages, translate them into English
// and/or Hindi. Owns the whole PDF flow so the page itself stays a mode switch.
//
// The upload is PROBED, not read: the API reports the page count and whether reading will
// cost OCR credits, and the flow forks on that answer.
//
//   born-digital → its text layer was free, so every page is already in hand and the run
//                  lands straight in the review list, which is itself the page picker.
//   scanned      → a 'selecting' step first, listing page NUMBERS only. Its text does not
//                  exist yet, because producing it is the OCR the user is being asked to
//                  authorise. Only the pages ticked here are ever sent, and paid for.
//
// So the card stack is: upload → (selection, scans only) → extraction (polled) → page
// review (checkboxes, character counts, an optional AI instruction that resolves to a page
// selection) → the shared name check → translation → results per language.
//
// Three things worth knowing before editing:
//   - The job lives in the API's MEMORY. A 404 means it expired or the API restarted, and
//     the only honest recovery is to upload again — which is what `gone` does.
//   - The AI instruction is structural ONLY: it changes which pages are selected and
//     nothing else. It never becomes translator instructions, so English and Hindi always
//     see identical source text.
//   - `detail.source` says HOW the text was read: straight from the PDF's own text layer
//     (exact) or by OCR (pixels, so names and amounts can be misread). The server's quality
//     gate cannot catch every broken PDF font, so the user gets an explicit "read it with
//     OCR instead" — which discards the current pages, edits and translations, hence the
//     confirm. That override still honours the page selection: it re-reads, it does not
//     re-bill the whole document.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type {
  PrepareTranslationResponse,
  TranslationLanguage,
  TranslationTermInput,
} from '@dgipr/schemas';
import {
  createTranslateDocument,
  extractDocumentPages,
  interpretDocumentInstruction,
  prepareDocumentTranslation,
  reextractDocument,
  startDocumentTranslation,
} from '../lib/api';
import { downloadBlob } from '../lib/download';
import { STR } from '../lib/strings';
import { useTranslateDocument } from '../lib/useTranslateDocument';
import { TranslationTermsReview } from './TranslationTermsReview';

// Survives a tab refresh during a 10-minute OCR: the job itself is server-side, so the id
// is all that has to be remembered.
const JOB_STORAGE_KEY = 'dgipr.translate.document.job';

// Rough throughput used for the "अंदाजे वेळ" line. One page is one or two sequential
// Sarvam calls; ~25 s per page per language is what runs have looked like. Deliberately
// pessimistic — a translation that finishes early is a good surprise.
const SECONDS_PER_PAGE_PER_LANGUAGE = 25;

function marathiNumber(value: number): string {
  return value.toLocaleString('mr-IN');
}

export function TranslateDocumentPanel() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [openPage, setOpenPage] = useState<number | null>(null);
  const [instruction, setInstruction] = useState('');
  const [interpreting, setInterpreting] = useState(false);
  const [instructionNote, setInstructionNote] = useState<string | null>(null);
  const [languages, setLanguages] = useState<Set<TranslationLanguage>>(
    () => new Set<TranslationLanguage>(['en']),
  );
  const [prep, setPrep] = useState<'idle' | 'preparing' | 'review'>('idle');
  const [prepared, setPrepared] = useState<
    PrepareTranslationResponse['terms'] | null
  >(null);
  const [shownResult, setShownResult] = useState<TranslationLanguage>('en');
  const [copied, setCopied] = useState(false);
  const [confirmingReextract, setConfirmingReextract] = useState(false);
  const [reextracting, setReextracting] = useState(false);
  // Re-opening the page picker on an already-read scan. Purely local: the server has no
  // "go back to selecting" state, and does not need one — changing the selection is just
  // another /extract call.
  const [reselecting, setReselecting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The page selection `prepared` was built for. A retry with the same selection reuses
  // the cached name list instead of paying for the OpenAI extraction again; any change to
  // the pages or edits makes the signatures differ, forcing a fresh prepare.
  const preparedSig = useRef<string | null>(null);

  const { detail, gone, refresh } = useTranslateDocument(jobId);

  // Re-attach to a job left running by a previous page view (refresh, accidental
  // navigation). An id that no longer exists resolves to `gone` on the first poll.
  useEffect(() => {
    const stored = window.sessionStorage.getItem(JOB_STORAGE_KEY);
    if (stored) setJobId(stored);
  }, []);

  useEffect(() => {
    if (jobId) window.sessionStorage.setItem(JOB_STORAGE_KEY, jobId);
    else window.sessionStorage.removeItem(JOB_STORAGE_KEY);
  }, [jobId]);

  // The page picker is open either because the document is scanned and nothing has been
  // read yet, or because the user reopened it to choose differently.
  const isSelecting =
    detail?.status === 'selecting' ||
    (reselecting && detail?.status === 'ready');

  // What the checkboxes list. While selecting that is every page the document HAS (known
  // from the probe, before anything is read); afterwards it is the pages actually read —
  // which, after a partial read, is NOT 1..n, so the numbers must come from the pages
  // themselves rather than from a count.
  const totalPages = detail?.pageCount ?? 0;
  const selectablePages = useMemo(
    () =>
      isSelecting
        ? Array.from({ length: totalPages }, (_, index) => index + 1)
        : (detail?.pages ?? []).map((page) => page.page),
    [isSelecting, totalPages, detail?.pages],
  );

  // Everything is selected by default — translating the whole document is the common
  // case, and narrowing is what the checkboxes and the instruction box are for. A
  // selection the user has already made survives the move from picker to review list.
  useEffect(() => {
    if (selectablePages.length === 0) return;
    setSelected((prev) => (prev.size > 0 ? prev : new Set(selectablePages)));
  }, [selectablePages]);

  // Extraction started, so the picker has done its job and should not reappear over the
  // fresh pages when the job lands back on 'ready'.
  useEffect(() => {
    if (detail?.status === 'extracting') setReselecting(false);
  }, [detail?.status]);

  // Follow the job into its result: whichever language finished first is shown.
  useEffect(() => {
    const first = detail?.results[0]?.language;
    if (first)
      setShownResult((prev) =>
        detail?.results.some((r) => r.language === prev) ? prev : first,
      );
  }, [detail?.results]);

  const pages = detail?.pages ?? [];
  const selectedPages = pages.filter((page) => selected.has(page.page));
  const selectedChars = selectedPages.reduce(
    (sum, page) => sum + (edits[String(page.page)]?.length ?? page.chars),
    0,
  );
  const estimateMinutes = Math.max(
    1,
    Math.round(
      (selectedPages.length * languages.size * SECONDS_PER_PAGE_PER_LANGUAGE) /
        60,
    ),
  );
  const hasEnglishPages = pages.some((page) => page.language === 'en');
  const busy =
    detail?.status === 'extracting' || detail?.status === 'translating';

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError(STR.translateDocPdfOnly);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const created = await createTranslateDocument(form);
      resetSelection();
      setJobId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setUploading(false);
    }
  };

  const resetSelection = () => {
    setSelected(new Set());
    setEdits({});
    setOpenPage(null);
    setInstruction('');
    setInstructionNote(null);
    setPrep('idle');
    setPrepared(null);
    setError(null);
    setConfirmingReextract(false);
    setReselecting(false);
  };

  // "Read these pages." The one call that spends OCR credits on a scanned document — and
  // only on what is ticked. The job goes back to 'extracting' and the poll takes over.
  const readSelected = async () => {
    if (!jobId || selected.size === 0) return;
    setExtracting(true);
    setError(null);
    try {
      await extractDocumentPages(
        jobId,
        [...selected].sort((a, b) => a - b),
      );
      setEdits({});
      setOpenPage(null);
      setPrep('idle');
      setPrepared(null);
      setReselecting(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setExtracting(false);
    }
  };

  // Re-read the same file with OCR. Page text (including the user's corrections) and any
  // translation are rebuilt from scratch, so the edits are dropped with them — but the page
  // SELECTION is kept and sent, because this overrules the quality gate, not the spend one.
  const rereadWithOcr = async () => {
    if (!jobId || selected.size === 0) return;
    setReextracting(true);
    try {
      await reextractDocument(
        jobId,
        [...selected].sort((a, b) => a - b),
      );
      setEdits({});
      setOpenPage(null);
      setInstructionNote(null);
      setPrep('idle');
      setPrepared(null);
      setError(null);
      setConfirmingReextract(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setReextracting(false);
    }
  };

  const startOver = () => {
    setJobId(null);
    resetSelection();
  };

  const togglePage = (page: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
    setInstructionNote(null);
    setPrep('idle');
  };

  const applyInstruction = async () => {
    if (!jobId || instruction.trim().length === 0) return;
    setInterpreting(true);
    setError(null);
    try {
      const result = await interpretDocumentInstruction(
        jobId,
        instruction.trim(),
      );
      if (result.pages.length === 0) {
        setInstructionNote(null);
        setError(STR.translateDocInstructionUnclear);
        return;
      }
      setSelected(new Set(result.pages));
      setInstructionNote(
        `${STR.translateDocInstructionApplied} ${result.pages
          .map(marathiNumber)
          .join(', ')}`,
      );
      setPrep('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setInterpreting(false);
    }
  };

  const toggleLanguage = (language: TranslationLanguage) => {
    setLanguages((prev) => {
      const next = new Set(prev);
      if (next.has(language)) next.delete(language);
      else next.add(language);
      return next;
    });
    setPrep('idle');
  };

  // Step 1 of the translation: the same mandatory name check every other translation
  // surface runs, over the selected pages only.
  const startNameCheck = async () => {
    if (!jobId) return;
    if (selected.size === 0) {
      setError(STR.translateDocNoSelection);
      return;
    }
    if (languages.size === 0) {
      setError(STR.translateDocNoTargets);
      return;
    }
    // Reuse a prepared name list when the selection has not changed since it was built —
    // /prepare re-runs the OpenAI proper-noun extraction over every selected page, so on a
    // retry after a failed translation (same pages) that is a full re-extraction paid for
    // nothing. Any change to the pages or edits makes the signature differ, forcing a
    // fresh prepare.
    const signature = `${[...selected].sort((a, b) => a - b).join(',')}|${JSON.stringify(edits)}`;
    if (prepared && preparedSig.current === signature) {
      setPrep('review');
      return;
    }
    setPrep('preparing');
    setError(null);
    try {
      const result = await prepareDocumentTranslation(jobId, {
        pages: [...selected].sort((a, b) => a - b),
        ...(Object.keys(edits).length > 0 ? { pageEdits: edits } : {}),
      });
      setPrepared(result.terms);
      preparedSig.current = signature;
      setPrep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.namesPrepareError);
      setPrep('idle');
    }
  };

  // Step 2: kick off the background job and let the poll take over.
  const confirmTranslate = async (terms: TranslationTermInput[]) => {
    if (!jobId) return;
    setError(null);
    // Don't re-translate a language that already succeeded: after a Hindi failure the good
    // English pages are already banked on the job, so a retry should only run the missing
    // language and never re-bill English. If everything already has a result, this is a
    // deliberate full re-translation (the user changed the selection), so run them all.
    const requested = [...languages];
    const missing = requested.filter(
      (lang) => !detail?.results.some((r) => r.language === lang),
    );
    const toRun = missing.length > 0 ? missing : requested;
    try {
      await startDocumentTranslation(jobId, {
        languages: toRun,
        pages: [...selected].sort((a, b) => a - b),
        ...(Object.keys(edits).length > 0 ? { pageEdits: edits } : {}),
        terms,
      });
      // Keep `prepared` (and its signature) so a retry after a failed run reuses the name
      // list instead of re-running the OpenAI extraction; only the review card is hidden,
      // via prep='idle'. It is cleared when the selection changes or the file is replaced.
      setPrep('idle');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    }
  };

  const result = detail?.results.find((r) => r.language === shownResult);
  const resultText = useMemo(
    () =>
      result
        ? result.pages
            .map(
              (page) =>
                `--- ${STR.translateDocPage} ${page.page} ---\n\n${page.text}`,
            )
            .join('\n\n')
        : '',
    [result],
  );

  const copyResult = async () => {
    if (!resultText) return;
    await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ---------- render ----------

  if (gone && jobId) {
    return (
      <section className="card">
        <p className="form-error">{STR.translateDocGone}</p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={startOver}>
            {STR.translateDocNewFile}
          </button>
        </div>
      </section>
    );
  }

  if (!jobId) {
    return (
      <section className="card">
        <h2>{STR.translateDocUploadTitle}</h2>
        <p className="hint">{STR.translateDocUploadHint}</p>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? STR.submitting : STR.translateDocUpload}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <>
      {detail?.status === 'extracting' || !detail ? (
        <section className="card">
          <div className="dlo-processing">
            <span className="spinner spinner-lg" aria-hidden="true" />
            <p className="dlo-processing-title">{STR.translateDocExtracting}</p>
            <p className="hint">{STR.translateDocExtractingHint}</p>
            {detail?.extractProgress ? (
              <p className="hint">
                {STR.translateDocExtractProgress}{' '}
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
      ) : null}

      {detail?.status === 'failed' && detail.pages.length === 0 ? (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          {detail.error ? <p className="form-error">{detail.error}</p> : null}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={startOver}>
              {STR.translateDocNewFile}
            </button>
          </div>
        </section>
      ) : null}

      {/* The pre-OCR page picker. Numbers only: this document's text does not exist yet,
          and producing it is exactly the spend being authorised here. */}
      {isSelecting && detail ? (
        <section className="card">
          <h2>{STR.translateDocSelectTitle}</h2>
          <p className="hint">
            {reselecting
              ? STR.translateDocChangeSelectionHint
              : STR.translateDocSelectHint}
          </p>
          <p className="hint" style={{ marginTop: 8 }}>
            <FileText size={16} aria-hidden="true" /> {detail.fileName} ·{' '}
            {STR.translateDocSelectTotal} {marathiNumber(totalPages)}
          </p>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-small"
              disabled={extracting}
              onClick={() => setSelected(new Set(selectablePages))}
            >
              {STR.translateDocSelectAll}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={extracting}
              onClick={() => setSelected(new Set())}
            >
              {STR.translateDocClearAll}
            </button>
          </div>

          <ul className="page-list">
            {selectablePages.map((page) => (
              <li key={page} className="page-row">
                <label className="page-row-head">
                  <input
                    type="checkbox"
                    checked={selected.has(page)}
                    disabled={extracting}
                    onChange={() => togglePage(page)}
                  />
                  <span className="page-row-name">
                    {STR.translateDocPage} {marathiNumber(page)}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="hint" style={{ marginTop: 12 }}>
            {marathiNumber(selected.size)} / {marathiNumber(totalPages)}{' '}
            {STR.translateDocSelectCount}
          </p>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={extracting || selected.size === 0}
              onClick={() => void readSelected()}
            >
              {extracting ? STR.submitting : STR.translateDocReadSelected}
            </button>
            {reselecting ? (
              <button
                type="button"
                className="btn"
                disabled={extracting}
                onClick={() => setReselecting(false)}
              >
                {STR.translateDocReextractCancel}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={extracting}
                onClick={startOver}
              >
                {STR.translateDocNewFile}
              </button>
            )}
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </section>
      ) : null}

      {pages.length > 0 && !isSelecting ? (
        <>
          {/* A translation that failed after the pages were read used to vanish silently:
              the full-page failed card above needs pages.length === 0, and the results
              card below needs a result to exist — a Hindi-only failure has neither. Show
              the error here, where the user is already looking, and leave the review +
              retry controls below intact so they can fix a name and re-run without
              re-uploading. */}
          {detail?.status === 'failed' && detail.error ? (
            <section className="card">
              <p className="form-error">{detail.error}</p>
            </section>
          ) : null}
          <section className="card">
            <h2>{STR.translateDocPagesTitle}</h2>
            <p className="hint">{STR.translateDocPagesHint}</p>
            {detail?.source ? (
              <p className="hint" style={{ marginTop: 8 }}>
                <span
                  className={
                    detail.source === 'ocr'
                      ? 'chip chip-queued'
                      : 'chip chip-completed'
                  }
                >
                  {detail.source === 'ocr'
                    ? STR.translateDocSourceOcr
                    : STR.translateDocSourceTextLayer}
                </span>{' '}
                {detail.source === 'ocr'
                  ? STR.translateDocSourceOcrHint
                  : STR.translateDocSourceTextLayerHint}
              </p>
            ) : null}
            {/* Offered only while the document still has pages nobody has paid to read —
                on a fully-read document the review list below already IS the picker. */}
            {detail && detail.pageCount !== null
              ? detail.pageCount > pages.length && (
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy || reextracting}
                      onClick={() => setReselecting(true)}
                    >
                      {STR.translateDocChangeSelection}
                    </button>
                  </div>
                )
              : null}
            {/* The quality gate cannot catch every broken PDF font, so the user can
                overrule it. Only offered on a text-layer read — re-running OCR on OCR
                output would just spend the same minutes again. */}
            {detail?.source === 'text-layer' && !confirmingReextract ? (
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy || reextracting}
                  onClick={() => setConfirmingReextract(true)}
                >
                  {STR.translateDocReextract}
                </button>
              </div>
            ) : null}
            {confirmingReextract ? (
              <div className="info-callout" style={{ marginTop: 10 }}>
                <p>{STR.translateDocReextractHint}</p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={reextracting}
                    onClick={() => void rereadWithOcr()}
                  >
                    {reextracting
                      ? STR.submitting
                      : STR.translateDocReextractYes}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={reextracting}
                    onClick={() => setConfirmingReextract(false)}
                  >
                    {STR.translateDocReextractCancel}
                  </button>
                </div>
              </div>
            ) : null}
            {hasEnglishPages ? (
              <div className="info-callout" style={{ marginTop: 12 }}>
                <p>{STR.translateDocEnglishPagesNote}</p>
              </div>
            ) : null}

            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() =>
                  setSelected(new Set(pages.map((page) => page.page)))
                }
              >
                {STR.translateDocSelectAll}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => setSelected(new Set())}
              >
                {STR.translateDocClearAll}
              </button>
            </div>

            <ul className="page-list">
              {pages.map((page) => {
                const text = edits[String(page.page)] ?? page.text;
                const isOpen = openPage === page.page;
                return (
                  <li key={page.page} className="page-row">
                    <label className="page-row-head">
                      <input
                        type="checkbox"
                        checked={selected.has(page.page)}
                        disabled={busy}
                        onChange={() => togglePage(page.page)}
                      />
                      <span className="page-row-name">
                        {STR.translateDocPage} {marathiNumber(page.page)}
                      </span>
                      {/* A page with no text has no language to report — the detector
                          defaults to Marathi on an empty string, which would badge a
                          blank page मराठी. */}
                      {text.length > 0 ? (
                        <span className="chip chip-queued">
                          {page.language === 'en'
                            ? STR.translateDocLangEn
                            : STR.translateDocLangMr}
                        </span>
                      ) : null}
                      {edits[String(page.page)] !== undefined ? (
                        <span className="chip chip-completed">
                          {STR.translateDocEdited}
                        </span>
                      ) : null}
                      <span className="page-row-chars">
                        {marathiNumber(text.length)} {STR.translateDocChars}
                      </span>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenPage(isOpen ? null : page.page);
                        }}
                      >
                        {isOpen
                          ? STR.translateDocEditClose
                          : STR.translateDocEdit}
                      </button>
                    </label>
                    {isOpen ? (
                      <textarea
                        className="note-input"
                        value={text}
                        disabled={busy}
                        onChange={(event) =>
                          setEdits((prev) => ({
                            ...prev,
                            [String(page.page)]: event.target.value,
                          }))
                        }
                        style={{ marginTop: 10, minHeight: 220 }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <p className="hint" style={{ marginTop: 12 }}>
              {marathiNumber(selectedPages.length)} /{' '}
              {marathiNumber(pages.length)} {STR.translateDocSelectedSummary} ·{' '}
              {marathiNumber(selectedChars)} {STR.translateDocChars} ·{' '}
              {STR.translateDocEstimate} ~{marathiNumber(estimateMinutes)}{' '}
              {STR.translateDocMinutes}
            </p>
          </section>

          <section className="card">
            <label className="field-label" htmlFor="translate-doc-instruction">
              {STR.translateDocInstructionLabel}
            </label>
            <p className="hint">{STR.translateDocInstructionHint}</p>
            <input
              id="translate-doc-instruction"
              type="text"
              placeholder={STR.translateDocInstructionPlaceholder}
              value={instruction}
              disabled={busy}
              onChange={(event) => setInstruction(event.target.value)}
              style={{ marginTop: 10 }}
            />
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={applyInstruction}
                disabled={
                  busy || interpreting || instruction.trim().length === 0
                }
              >
                {STR.translateDocInstructionApply}
              </button>
              {interpreting ? (
                <span className="translating-note">
                  <span className="spinner" aria-hidden="true" />
                  {STR.translateDocInstructionWorking}
                </span>
              ) : null}
            </div>
            {instructionNote ? (
              <p className="form-success">{instructionNote}</p>
            ) : null}
          </section>

          <section className="card">
            <span className="field-label">{STR.translateDocTargetsLabel}</span>
            <p className="hint">{STR.translateDocTargetsHint}</p>
            <div className="lang-toggle" role="group" style={{ marginTop: 8 }}>
              {(['en', 'hi'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="btn btn-small"
                  aria-pressed={languages.has(option)}
                  disabled={busy}
                  onClick={() => toggleLanguage(option)}
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
                disabled={busy || prep !== 'idle'}
              >
                {detail && detail.results.length > 0
                  ? STR.translateDocRetranslate
                  : STR.namesStartCheck}
              </button>
              <button
                type="button"
                className="btn"
                onClick={startOver}
                disabled={busy}
              >
                {STR.translateDocNewFile}
              </button>
              {prep === 'preparing' ? (
                <span className="translating-note">
                  <span className="spinner" aria-hidden="true" />
                  {STR.namesChecking}
                </span>
              ) : null}
            </div>

            {prep === 'review' && prepared ? (
              <TranslationTermsReview
                terms={prepared}
                busy={false}
                collapseVerified
                // Pass every selected target so both spelling columns show when both
                // languages run — the officer can fix a Hindi name without unticking
                // English first (which used to be the only way to reach the Hindi column).
                languages={[...languages]}
                onConfirm={confirmTranslate}
                onCancel={() => {
                  setPrep('idle');
                  setPrepared(null);
                }}
              />
            ) : null}
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        </>
      ) : null}

      {detail?.status === 'translating' ? (
        <section className="card">
          <div className="dlo-processing">
            <span className="spinner spinner-lg" aria-hidden="true" />
            <p className="dlo-processing-title">
              {STR.translateDocTranslating}
              {detail.progress
                ? ` — ${
                    detail.progress.language === 'hi'
                      ? STR.translateTargetHindi
                      : STR.translateTargetEnglish
                  } ${marathiNumber(detail.progress.pageIndex + 1)}/${marathiNumber(
                    detail.progress.pageCount,
                  )}`
                : ''}
            </p>
            <p className="hint">{STR.translateDocTranslatingHint}</p>
          </div>
        </section>
      ) : null}

      {detail && detail.results.length > 0 ? (
        <section className="card">
          <h2>{STR.translateDocResultsTitle}</h2>
          {detail.status === 'failed' && detail.error ? (
            <p className="form-error">{detail.error}</p>
          ) : null}
          <div className="lang-toggle" role="group" style={{ marginTop: 8 }}>
            {detail.results.map((entry) => (
              <button
                key={entry.language}
                type="button"
                className="btn btn-small"
                aria-pressed={shownResult === entry.language}
                onClick={() => setShownResult(entry.language)}
              >
                {entry.language === 'hi'
                  ? STR.translateOutputTitleHindi
                  : STR.translateOutputTitle}
              </button>
            ))}
          </div>

          {/* Names the Hindi output could not be made to carry verbatim. The translation
              is still shown; this asks the officer to check those names in it. */}
          {result && result.unpreservedNames.length > 0 ? (
            <div className="info-callout warn" style={{ marginTop: 12 }}>
              <p className="field-label">{STR.translateUnpreservedTitle}</p>
              <p className="hint">
                {STR.translateUnpreservedHint} {result.unpreservedNames.join(', ')}
              </p>
            </div>
          ) : null}

          {result?.pages.map((page) => (
            <div key={page.page} className="doc-result-page">
              <p className="field-label">
                {STR.translateDocPage} {marathiNumber(page.page)}
              </p>
              {page.mode === 'passthrough' ? (
                <p className="hint">{STR.translateDocPassthrough}</p>
              ) : null}
              <div className="article-body">{page.text}</div>
            </div>
          ))}

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button type="button" className="btn" onClick={copyResult}>
              {copied ? STR.copied : STR.translateDocCopyAll}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadBlob(
                  shownResult === 'hi'
                    ? 'document-hindi-translation.txt'
                    : 'document-english-translation.txt',
                  resultText,
                  'text/plain',
                )
              }
            >
              {STR.translateDocDownload}
            </button>
          </div>
          {result ? (
            <p className="hint">
              {result.lockedTermCount} {STR.translateLockedTerms}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
