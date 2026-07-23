'use client';

// DLO (Digital Liaison Officer) interface — a 4-step flow: (1) meeting inputs
// (free-text notes + PDF/MP3/DOCX uploads + article type), (2) processing
// (files upload to the API; audio is transcribed via Sarvam batch STT, PDFs
// via Sarvam document digitization, DOCX locally), (3) an EDITABLE review of
// the Marathi text — the officer corrects names/amounts before they become
// "facts" — and (4) the generated article, produced by the existing generation
// pipeline (the reviewed text becomes a normal generation's note, so
// feedback/translation/posters all work from its detail page).
//
// Step 3 is per SOURCE (see DloSourceReview): each recording and document gets
// its own editable card, and a PDF is listed page by page so pages that do not
// belong in the article can be unchecked. What the officer ends up with is
// re-assembled here with the same combiner the intake job used, and that string
// is what is sent as the generation's note.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Music, X } from 'lucide-react';
import type { DloCategory, DloIntakeDetail } from '@dgipr/schemas';
import {
  createDloIntake,
  extractDloPages,
  generateFromDloIntake,
  reextractDloFile,
} from '../../lib/api';
import {
  assembleDloText,
  filePageNumbers,
  forgetFile,
  forgetFileKeys,
  hasPendingSelection,
  hasPerSourceText,
  pageKey,
  pendingSelections,
} from '../../lib/dloReview';
import { downloadBlob } from '../../lib/download';
import { ARTICLE_CATEGORY_OPTIONS } from '../../lib/generationOptions';
import { useDloIntake } from '../../lib/useDloIntake';
import { useGeneration } from '../../lib/useGeneration';
import { DloSourceReview } from '../../components/DloSourceReview';
import { ProgressSteps } from '../../components/ProgressSteps';
import { DLO_INTAKE_STEP_LABELS, STR } from '../../lib/strings';

type DloStep = 'input' | 'processing' | 'review' | 'generating' | 'output';

const ACCEPTED_EXTENSIONS = ['.pdf', '.mp3', '.docx'] as const;

// Bounds of the generation note the reviewed text becomes (see
// DloGenerateRequestSchema / CreateGenerationRequestSchema).
const TEXT_MIN_CHARS = 20;
const TEXT_MAX_CHARS = 60_000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Per-file transcription/extraction status rows (processing + review steps).
function SourceStatusList({ intake }: { intake: DloIntakeDetail }) {
  if (intake.files.length === 0) return null;
  return (
    <>
      <p className="field-label" style={{ marginTop: 16 }}>
        {STR.dloSourcesTitle}
      </p>
      <ul className="file-list">
        {intake.files.map((file, index) => (
          <li key={`${file.name}-${index}`} className="file-row">
            {file.kind === 'audio' ? (
              <Music size={20} aria-hidden="true" />
            ) : (
              <FileText size={20} aria-hidden="true" />
            )}
            <span className="file-name">{file.name}</span>
            <span className="file-size">
              {file.status === 'done'
                ? `${STR.dloFileStatusDone}${
                    file.chars !== undefined
                      ? ` · ${file.chars.toLocaleString('mr-IN')} ${STR.dloCharsSuffix}`
                      : ''
                  }`
                : file.status === 'failed'
                  ? STR.dloFileStatusFailed
                  : STR.dloFileStatusPending}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Article-category picker (news vs scheme), same option cards as the home form.
function CategoryPicker({
  value,
  onChange,
}: {
  value: DloCategory;
  onChange: (next: DloCategory) => void;
}) {
  return (
    <>
      <h2>{STR.categoryLabel}</h2>
      <div className="output-picker">
        {ARTICLE_CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="output-option"
            aria-pressed={value === option.value}
            onClick={() => {
              // ARTICLE_CATEGORY_OPTIONS already excludes the social lanes; this
              // re-narrows the widened Category to the two a DLO run can produce.
              if (option.value === 'news' || option.value === 'scheme') {
                onChange(option.value);
              }
            }}
          >
            <span className="icon" aria-hidden="true">
              <option.icon size={30} strokeWidth={1.75} />
            </span>
            <span className="name">{option.name}</span>
            <span className="desc">{option.desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// The generation phase, isolated so useGeneration only runs once an id exists.
// While running it shows the shared pipeline progress; on completion it hands
// the article up (the parent renders the output step); on failure it shows the
// error with a way out.
function GenerationPhase({
  id,
  onCompleted,
  onReset,
}: {
  id: string;
  onCompleted: (article: string) => void;
  onReset: () => void;
}) {
  const { detail, error } = useGeneration(id);

  const article = detail?.status === 'completed' ? detail.article : null;
  useEffect(() => {
    if (article) onCompleted(article);
  }, [article, onCompleted]);

  if (detail?.status === 'failed') {
    return (
      <section className="card">
        <h2>{STR.failedTitle}</h2>
        <p className="hint">{STR.failedHint}</p>
        {detail.error ? <p className="form-error">{detail.error}</p> : null}
        <div className="btn-row" style={{ marginTop: 14 }}>
          <Link className="btn" href={`/generations/${id}`}>
            {STR.dloViewDetail}
          </Link>
          <button type="button" className="btn" onClick={onReset}>
            {STR.dloStartOver}
          </button>
        </div>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="card">
        <div className="dlo-processing">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <p className="dlo-processing-title">{STR.progressTitle}</p>
          {error ? <p className="hint">{error}</p> : null}
        </div>
      </section>
    );
  }
  return <ProgressSteps detail={detail} />;
}

export default function DloPage() {
  const [step, setStep] = useState<DloStep>('input');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<DloCategory>('news');
  const [heading, setHeading] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [combinedText, setCombinedText] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [article, setArticle] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Review-step state, keyed per source (see lib/dloReview): the officer's edits
  // and the sources/pages left out of the article. Everything is included until
  // it is unchecked, so an untouched review generates exactly what it used to.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [reextractingIndex, setReextractingIndex] = useState<number | null>(
    null,
  );
  const sawReextractRunning = useRef(false);
  // A page-selection read is in flight. Cleared by the poll, not here: the intake goes
  // running → ready and the cards repopulate on their own.
  const [extracting, setExtracting] = useState(false);
  const sawExtractRunning = useRef(false);
  const [showPreview, setShowPreview] = useState(false);

  const {
    detail: intake,
    error: intakeError,
    refresh,
  } = useDloIntake(intakeId);

  // Advance to the review step once the intake job finishes, seeding the legacy
  // single-textarea fallback with the combined transcription/extraction output.
  useEffect(() => {
    if (step !== 'processing' || intake?.status !== 'ready') return;
    setCombinedText(intake.combinedText ?? '');
    setError(null);
    setStep('review');
  }, [step, intake]);

  // An OCR re-read runs the intake back through running → ready. Waiting for the
  // running state first matters: the intake is still 'ready' in the instant
  // between asking for the re-read and the first poll landing.
  useEffect(() => {
    if (reextractingIndex === null) return;
    if (intake?.status === 'running') {
      sawReextractRunning.current = true;
    } else if (intake?.status !== 'queued' && sawReextractRunning.current) {
      sawReextractRunning.current = false;
      setReextractingIndex(null);
    }
  }, [intake?.status, reextractingIndex]);

  // Reading the selected pages takes the intake through the same running → ready loop,
  // and needs the same "wait until you have actually seen running" guard.
  useEffect(() => {
    if (!extracting) return;
    if (intake?.status === 'running') {
      sawExtractRunning.current = true;
    } else if (intake?.status !== 'queued' && sawExtractRunning.current) {
      sawExtractRunning.current = false;
      setExtracting(false);
    }
  }, [intake?.status, extracting]);

  // An intake made before per-source text shipped carries only the combined
  // text, so it keeps the old single box rather than a row of empty cards.
  const perSource = intake ? hasPerSourceText(intake.files) : true;
  // A scanned PDF nobody has chosen pages for yet. It contributes nothing to the note
  // until it is read, so generating now would silently drop a whole source.
  const pendingSelection = intake ? hasPendingSelection(intake.files) : false;
  const reviewText = useMemo(
    () =>
      intake && perSource
        ? assembleDloText(intake.notes, intake.files, edits, excluded)
        : combinedText,
    [intake, perSource, edits, excluded, combinedText],
  );

  const stepIndex =
    step === 'input'
      ? 0
      : step === 'processing'
        ? 1
        : step === 'review'
          ? 2
          : 3;
  const railSteps = [
    STR.dloStepInput,
    STR.dloStepProcessing,
    STR.dloStepReview,
    STR.dloStepOutput,
  ];

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const accepted = picked.filter((file) =>
      ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)),
    );
    setError(accepted.length < picked.length ? STR.dloFileTypeError : null);
    if (accepted.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...accepted.filter(
          (file) =>
            !prev.some((p) => p.name === file.name && p.size === file.size),
        ),
      ]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    if (notes.trim().length === 0 && files.length === 0) {
      setError(STR.dloNeedInput);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('notes', notes);
      form.append('category', category);
      form.append('heading', heading);
      for (const file of files) form.append('files', file, file.name);
      const id = await createDloIntake(form);
      setIntakeId(id);
      setStep('processing');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggling anything closes nothing and loses nothing — edits are kept for an
  // excluded source, so unchecking and re-checking is free.
  const toggleKey = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
  };

  // A PDF's whole-file checkbox is its select-all: it works on the page keys, so
  // the page rows and the header stay one piece of state. Works the same before a scan has
  // been read, where the page numbers come from the probe's count rather than from pages.
  const toggleFilePages = (index: number, include: boolean) => {
    const file = intake?.files[index];
    const pages = file ? (filePageNumbers(file) ?? []) : [];
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const page of pages) {
        if (include) next.delete(pageKey(index, page));
        else next.add(pageKey(index, page));
      }
      return next;
    });
    setError(null);
  };

  // "Read the pages I picked." One request for every scanned PDF still unread, so an
  // intake holding three of them is still one click. This is the call that spends OCR
  // credits, and only on what is ticked.
  const readSelectedPages = async () => {
    if (!intakeId || !intake) return;
    const selections = pendingSelections(intake.files, excluded);
    if (selections.length === 0) {
      setError(STR.dloReviewNoPagesPicked);
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      await extractDloPages(intakeId, selections);
      await refresh();
    } catch (e) {
      setExtracting(false);
      setError(e instanceof Error ? e.message : STR.genericError);
    }
  };

  // "Read this PDF with OCR instead." The confirm the officer just accepted says
  // this file's corrections are discarded, so they are dropped here rather than
  // silently re-applied to pages they were never written against.
  const reextract = async (index: number) => {
    if (!intakeId || !intake) return;
    const file = intake.files[index];
    if (!file) return;
    // Read off the CURRENT selection before it is forgotten below — re-reading is a
    // quality fix, not a reason to re-OCR pages the officer already excluded.
    const pages = (filePageNumbers(file) ?? []).filter(
      (page) => !excluded.has(pageKey(index, page)),
    );
    if (pages.length === 0) {
      setError(STR.dloReviewNoPagesPicked);
      return;
    }
    setReextractingIndex(index);
    sawReextractRunning.current = false;
    setError(null);
    setEdits((prev) => forgetFile(prev, index));
    setExcluded((prev) => forgetFileKeys(prev, index));
    try {
      await reextractDloFile(intakeId, index, pages);
      await refresh();
    } catch (e) {
      setReextractingIndex(null);
      setError(e instanceof Error ? e.message : STR.genericError);
    }
  };

  const generate = async () => {
    if (pendingSelection) {
      setError(STR.dloReviewSelectionPending);
      return;
    }
    const text = reviewText.trim();
    if (text.length < TEXT_MIN_CHARS) {
      setError(STR.dloReviewTooShort);
      return;
    }
    if (text.length > TEXT_MAX_CHARS) {
      setError(STR.dloReviewTooLong);
      return;
    }
    if (!intakeId) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await generateFromDloIntake(intakeId, {
        combinedText: text,
        category,
        ...(heading.trim() ? { heading: heading.trim() } : {}),
      });
      setGenerationId(id);
      setStep('generating');
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('input');
    setNotes('');
    setFiles([]);
    setCategory('news');
    setHeading('');
    setError(null);
    setSubmitting(false);
    setCopied(false);
    setIntakeId(null);
    setCombinedText('');
    setGenerationId(null);
    setArticle(null);
    setEdits({});
    setExcluded(new Set());
    setReextractingIndex(null);
    setExtracting(false);
    setShowPreview(false);
  };

  const copyArticle = async () => {
    if (!article) return;
    await navigator.clipboard.writeText(article);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const failedFiles = intake?.files.filter((f) => f.status === 'failed') ?? [];

  return (
    <main className="page">
      <h1 className="page-title">{STR.dloTitle}</h1>

      <ol className="dlo-steps" aria-label={STR.dloTitle}>
        {railSteps.map((label, i) => {
          const state =
            i < stepIndex
              ? 'done'
              : i === stepIndex
                ? step === 'output'
                  ? 'done'
                  : 'active'
                : 'pending';
          return (
            <li key={label} className={`progress-step ${state}`}>
              <span className="mark" aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {step === 'input' ? (
        <>
          <section className="card">
            <p className="hint">{STR.dloIntro}</p>
            <label
              className="field-label"
              htmlFor="dlo-notes"
              style={{ marginTop: 16 }}
            >
              {STR.dloNotesLabel}
            </label>
            <p className="hint">{STR.dloNotesHint}</p>
            <textarea
              id="dlo-notes"
              className="note-input"
              placeholder={STR.dloNotesPlaceholder}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              style={{ marginTop: 10 }}
            />
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => fileInput.current?.click()}
              >
                {STR.dloUpload}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.mp3,.docx"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>
            <p className="hint">{STR.dloUploadHint}</p>
            {files.length > 0 ? (
              <>
                <p className="field-label" style={{ marginTop: 16 }}>
                  {STR.dloFilesTitle}
                </p>
                <ul className="file-list">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.size}`} className="file-row">
                      {file.name.toLowerCase().endsWith('.mp3') ? (
                        <Music size={20} aria-hidden="true" />
                      ) : (
                        <FileText size={20} aria-hidden="true" />
                      )}
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        className="file-remove"
                        aria-label={`${STR.dloRemoveFile}: ${file.name}`}
                        onClick={() => removeFile(index)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className="card">
            <CategoryPicker value={category} onChange={setCategory} />
          </section>

          <section className="card">
            <label className="field-label" htmlFor="dlo-heading">
              {STR.headingLabel}
            </label>
            <p className="hint">{STR.headingHint}</p>
            <input
              id="dlo-heading"
              type="text"
              placeholder={STR.headingPlaceholder}
              value={heading}
              onChange={(event) => setHeading(event.target.value)}
              style={{ marginTop: 10 }}
            />
          </section>

          <section className="card">
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? STR.submitting : STR.dloSubmit}
              </button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        </>
      ) : null}

      {step === 'processing' ? (
        <section className="card">
          {intake?.status === 'failed' ? (
            <>
              <h2>{STR.failedTitle}</h2>
              <p className="hint">{STR.failedHint}</p>
              {intake.error ? (
                <p className="form-error">{intake.error}</p>
              ) : null}
              <SourceStatusList intake={intake} />
              <div className="btn-row" style={{ marginTop: 14 }}>
                <button type="button" className="btn" onClick={reset}>
                  {STR.dloStartOver}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dlo-processing">
                <span className="spinner spinner-lg" aria-hidden="true" />
                <p className="dlo-processing-title">
                  {intake?.step
                    ? DLO_INTAKE_STEP_LABELS[intake.step]
                    : STR.dloProcessingTitle}
                </p>
                <p className="hint">{STR.dloProcessingHint}</p>
                {intakeError ? <p className="hint">{intakeError}</p> : null}
              </div>
              {intake ? <SourceStatusList intake={intake} /> : null}
            </>
          )}
        </section>
      ) : null}

      {step === 'review' ? (
        <>
          <section className="card">
            <h2>{STR.dloReviewTitle}</h2>
            <p className="hint">{STR.dloReviewHint}</p>
            {failedFiles.length > 0 ? (
              <div className="info-callout" style={{ marginTop: 12 }}>
                <p>{STR.dloReviewFailedWarning}</p>
                <ul>
                  {failedFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      {file.name}
                      {file.error ? ` — ${file.error}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!perSource ? (
              <>
                <textarea
                  className="note-input"
                  value={combinedText}
                  onChange={(event) => setCombinedText(event.target.value)}
                  style={{ marginTop: 12, minHeight: 320 }}
                />
                <p
                  className={
                    combinedText.length > TEXT_MAX_CHARS ? 'form-error' : 'hint'
                  }
                  style={{ marginTop: 6 }}
                >
                  {combinedText.length.toLocaleString('mr-IN')} /{' '}
                  {TEXT_MAX_CHARS.toLocaleString('mr-IN')} {STR.dloCharsSuffix}
                </p>
              </>
            ) : null}
          </section>

          {perSource && intake ? (
            <>
              <DloSourceReview
                intake={intake}
                edits={edits}
                excluded={excluded}
                busy={submitting || extracting}
                reextractingIndex={reextractingIndex}
                onEdit={(key, value) =>
                  setEdits((prev) => ({ ...prev, [key]: value }))
                }
                onToggle={toggleKey}
                onToggleFilePages={toggleFilePages}
                onReextract={(index) => void reextract(index)}
              />

              {/* One button for every unread scan in the intake — an intake holding three
                  of them should still be one click. Nothing above this point has cost a
                  single OCR credit; this is where the spend happens. */}
              {pendingSelection ? (
                <section className="card">
                  <p className="hint">{STR.dloReviewReadSelectedHint}</p>
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={extracting || submitting}
                      onClick={() => void readSelectedPages()}
                    >
                      {extracting
                        ? STR.dloReviewReading
                        : STR.dloReviewReadSelected}
                    </button>
                    {extracting ? (
                      <span className="translating-note">
                        <span className="spinner" aria-hidden="true" />
                        {STR.dloProcessingHint}
                      </span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* What actually gets sent, on demand. Read-only on purpose: the
                  per-source cards are the one place text is edited, and a second
                  editable copy of the same text could only disagree with them. */}
              <section className="card">
                <p
                  className={
                    reviewText.length > TEXT_MAX_CHARS ? 'form-error' : 'hint'
                  }
                >
                  {STR.dloReviewTotal}{' '}
                  {reviewText.length.toLocaleString('mr-IN')} /{' '}
                  {TEXT_MAX_CHARS.toLocaleString('mr-IN')} {STR.dloCharsSuffix}
                </p>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setShowPreview((prev) => !prev)}
                  >
                    {showPreview
                      ? STR.dloReviewPreviewHide
                      : STR.dloReviewPreviewShow}
                  </button>
                </div>
                {showPreview ? (
                  <div className="article-body" style={{ marginTop: 12 }}>
                    {reviewText || STR.dloReviewEmpty}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          <section className="card">
            <CategoryPicker value={category} onChange={setCategory} />
          </section>

          <section className="card">
            <label className="field-label" htmlFor="dlo-review-heading">
              {STR.headingLabel}
            </label>
            <p className="hint">{STR.headingHint}</p>
            <input
              id="dlo-review-heading"
              type="text"
              placeholder={STR.headingPlaceholder}
              value={heading}
              onChange={(event) => setHeading(event.target.value)}
              style={{ marginTop: 10 }}
            />
          </section>

          <section className="card">
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={
                  submitting ||
                  extracting ||
                  pendingSelection ||
                  reextractingIndex !== null
                }
              >
                {submitting ? STR.submitting : STR.dloGenerate}
              </button>
              <button type="button" className="btn" onClick={reset}>
                {STR.dloStartOver}
              </button>
            </div>
            {pendingSelection ? (
              <p className="hint">{STR.dloReviewSelectionPending}</p>
            ) : null}
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        </>
      ) : null}

      {step === 'generating' && generationId ? (
        <GenerationPhase
          id={generationId}
          onCompleted={(text) => {
            setArticle(text);
            setStep('output');
          }}
          onReset={reset}
        />
      ) : null}

      {step === 'output' && article ? (
        <>
          <section className="card">
            <div className="article-head">
              <h2>{STR.dloOutputTitle}</h2>
            </div>
            <div className="article-body">{article}</div>
            <div className="btn-row" style={{ marginTop: 18 }}>
              <button type="button" className="btn" onClick={copyArticle}>
                {copied ? STR.copied : STR.copyText}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadBlob('dlo-article.txt', article, 'text/plain')
                }
              >
                {STR.downloadTxt}
              </button>
              {generationId ? (
                <Link className="btn" href={`/generations/${generationId}`}>
                  {STR.dloViewDetail}
                </Link>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={reset}>
                {STR.dloNewArticle}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
