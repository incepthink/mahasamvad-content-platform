'use client';

// DLO (Digital Liaison Officer) interface — a 4-step flow: (1) meeting inputs
// (free-text notes + PDF/MP3/DOCX uploads + article type), (2) processing
// (files upload to the API; audio is transcribed via Sarvam batch STT, PDFs
// via Sarvam document digitization, DOCX locally), (3) an EDITABLE review of
// the Marathi text — the officer corrects names/amounts before they become
// "facts" — and (4) the generated article, produced by the existing generation
// runner. That runner uses the simplified single-call article generator by
// default (ARTICLE_GENERATION_MODE=full is the explicit legacy opt-out). The
// reviewed text becomes a normal generation's note, so feedback, translation,
// and posters all continue to work from its detail page.
//
// Step 3 is per SOURCE (see DloSourceReview): each recording and document gets
// its own editable card, and a PDF is listed page by page so pages that do not
// belong in the article can be unchecked. What the officer ends up with is
// re-assembled here with the same combiner the intake job used, and that string
// is what is sent as the generation's note.
//
// Recordings and documents take DIFFERENT routes into step 1, and the split is about what
// each one costs to read. A recording has to be transcribed by Sarvam, so it is uploaded
// with the intake and read by the job. A document is read RIGHT HERE, by the shared
// ephemeral service every upload surface uses (<DocumentIntake>) — which is what puts the
// page picker in front of the officer the moment a scanned PDF is attached, instead of
// several minutes and one form-submit later. Those documents therefore arrive at the intake
// already extracted, as `documents` on the create request, and the job leaves them alone.
//
// Reading them here is optional, though — a scanned PDF can be OCR'd for minutes, and the
// officer may not need to see the text before the article exists. The live page SELECTION is
// handed over unread by default, and the intake job reads exactly those pages during प्रक्रिया,
// which the run was going to sit through anyway. The pages still turn up in the review step,
// editable, like any other source.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Music, X } from 'lucide-react';
import type {
  DloCategory,
  DloIntakeDetail,
  DloPreReadDocument,
  KnownDesignation,
  PreparedName,
} from '@dgipr/schemas';
import {
  articlePdfDownloadUrl,
  createDloIntake,
  extractDloPages,
  fetchPointers,
  generateFromDloIntake,
  prepareDesignations,
  reextractDloFile,
} from '../lib/api';
import {
  assembleDloText,
  filePageNumbers,
  forgetFile,
  forgetFileKeys,
  hasPendingSelection,
  hasPerSourceText,
  pageKey,
  pendingSelections,
} from '../lib/dloReview';
import { downloadBlob } from '../lib/download';
import { ARTICLE_CATEGORY_OPTIONS } from '../lib/generationOptions';
import { useDloIntake } from '../lib/useDloIntake';
import { useGeneration } from '../lib/useGeneration';
import { DloSourceReview } from './DloSourceReview';
import { PointerList } from './PointerList';
import {
  DesignationReview,
  collectDesignations,
  type DesignationEdit,
  type DesignationExtra,
} from './DesignationReview';
import {
  DocumentIntake,
  type DocumentSnapshot,
} from './DocumentIntake';
import { ProgressSteps } from './ProgressSteps';
import { StyleReferenceField } from './StyleReferenceField';
import { DLO_INTAKE_STEP_LABELS, STR } from '../lib/strings';

type DloStep = 'input' | 'processing' | 'review' | 'generating' | 'output';

// This picker now takes recordings only; documents go through <DocumentIntake> and are read
// before the intake is even created (see the file header).
const AUDIO_EXTENSIONS = ['.mp3'] as const;

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

// One document upload card. Slots are identified by a counter rather than by array index so
// that removing one cannot make the next card adopt its neighbour's in-flight job.
type DocumentSlot = Readonly<{ id: number; snapshot: DocumentSnapshot | null }>;

// Same ceiling the API puts on the documents array.
const MAX_DOCUMENTS = 10;

// Where each slot's card remembers its in-flight job across a refresh — a long OCR must
// survive one. Cleared by hand when a slot is dropped or the run is submitted, or the card
// would silently re-attach a document that has already been used.
function documentStorageKey(id: number): string {
  return `dgipr.dlo.document.${id}`;
}

// The wire shape: a PDF travels as the pages the officer kept (with their corrections), a
// DOCX/TXT as one string. `jobId` lets the API archive the original from the ephemeral job
// it is still holding, rather than making the browser upload the same bytes twice.
//
// A scan handed over from the initial picker is the exception: it has no text yet, so it
// travels as the page SELECTION alone and the intake job reads exactly those pages out of that
// archive. That makes the archive load-bearing rather than a convenience — without it there is
// nothing to read, which is why the API fails such a file instead of dropping it quietly.
function toPreReadDocument(snapshot: DocumentSnapshot): DloPreReadDocument {
  if (snapshot.pendingPages.length > 0) {
    return {
      jobId: snapshot.jobId,
      name: snapshot.fileName,
      kind: snapshot.kind,
      ...(snapshot.pageCount !== null ? { pageCount: snapshot.pageCount } : {}),
      pendingPages: [...snapshot.pendingPages],
    };
  }
  return {
    jobId: snapshot.jobId,
    name: snapshot.fileName,
    kind: snapshot.kind,
    ...(snapshot.pageCount !== null ? { pageCount: snapshot.pageCount } : {}),
    ...(snapshot.kind === 'pdf'
      ? {
          // Which backend read it is a PDF question — the review step badges it, and it
          // gates the "read it with OCR instead" offer. A .txt has no second reader.
          ...(snapshot.source !== null ? { pdfSource: snapshot.source } : {}),
          pages: snapshot.pages.map((page) => ({ ...page })),
        }
      : {
          text: snapshot.pages
            .map((page) => page.text)
            .filter((text) => text.trim().length > 0)
            .join('\n\n'),
        }),
  };
}

// Bounds of the generation note the reviewed text becomes (see
// DloGenerateRequestSchema / CreateGenerationRequestSchema).
const TEXT_MIN_CHARS = 20;
const TEXT_MAX_CHARS = 60_000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The picked recordings on the input step. Entries carry their index in the `files` array,
// so removing one still addresses the right file.
function SelectedFileList({
  title,
  entries,
  onRemove,
}: {
  title: string;
  entries: ReadonlyArray<{ file: File; index: number }>;
  onRemove: (index: number) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <>
      <p className="field-label" style={{ marginTop: 16 }}>
        {title}
      </p>
      <ul className="file-list">
        {entries.map(({ file, index }) => (
          <li key={`${file.name}-${file.size}`} className="file-row">
            {isAudioFile(file.name) ? (
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
              onClick={() => onRemove(index)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
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

export default function DloWorkspace() {
  const [step, setStep] = useState<DloStep>('input');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // One entry per document upload card. Each card reads its own file through the shared
  // ephemeral service and reports back what it currently holds; a card that is still empty
  // is a slot waiting for a file, which is why it starts with one.
  const [documents, setDocuments] = useState<DocumentSlot[]>([
    { id: 0, snapshot: null },
  ]);
  const nextSlotId = useRef(1);
  const [category, setCategory] = useState<DloCategory>('news');
  const [heading, setHeading] = useState('');
  // Tier 1 of the article's style-reference hierarchy: a published article the officer wants
  // this one shaped like. Style only — never a factual source (see StyleReferenceField).
  const [styleReference, setStyleReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [combinedText, setCombinedText] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [article, setArticle] = useState<string | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);

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

  // Pointers are a read-only, flat summary of the reviewed source. They help the officer scan
  // a long intake but never replace or filter the source used for article generation.
  // `null` means "not fetched yet"; `[]` means "fetched, nothing to show".
  const [pointers, setPointers] = useState<string[] | null>(null);
  const [pointersLoading, setPointersLoading] = useState(false);
  const [pointersError, setPointersError] = useState(false);

  // व्यक्ती व पदनाम: the people the note names and the designation to print before each. Same
  // three-state shape as pointers — `null` = not fetched, `[]` = fetched and nobody was named.
  // Edits are keyed by the person's Marathi name so a re-fetch that returns the same people
  // keeps what the officer typed; a name that disappears simply stops being collected.
  const [designationNames, setDesignationNames] = useState<
    PreparedName[] | null
  >(null);
  const [knownDesignations, setKnownDesignations] = useState<
    KnownDesignation[]
  >([]);
  const [designationsLoading, setDesignationsLoading] = useState(false);
  const [designationsError, setDesignationsError] = useState(false);
  const [designationEdits, setDesignationEdits] = useState<
    Record<string, DesignationEdit>
  >({});
  const [designationExtras, setDesignationExtras] = useState<
    DesignationExtra[]
  >([]);

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

  // Summarise the current text into one flat, source-ordered list. Best-effort: a short/empty
  // note or any failure leaves an empty (non-null) list so the officer can still generate.
  const runPointers = useCallback(
    async (text: string) => {
      setPointersError(false);
      const trimmed = text.trim();
      if (trimmed.length < TEXT_MIN_CHARS) {
        setPointers([]);
        return;
      }
      setPointersLoading(true);
      try {
        const result = await fetchPointers({ text: trimmed, category });
        setPointers(result.points);
      } catch {
        setPointers([]);
        setPointersError(true);
      } finally {
        setPointersLoading(false);
      }
    },
    [category],
  );

  // Fire pointer extraction once the review step opens, from the note the intake just
  // produced. Guarded on `pointers === null` so it runs exactly once per review session; the
  // officer re-runs it by hand (with their edits) via the regenerate button.
  useEffect(() => {
    if (step !== 'review' || !intake) return;
    if (pointers !== null || pointersLoading) return;
    void runPointers(reviewText);
  }, [step, intake, pointers, pointersLoading, reviewText, runPointers]);

  // Find the people this note names and what पदनाम each should carry. Best-effort in exactly
  // the way pointers are: any failure leaves an empty (non-null) list, so the officer can
  // still generate — without designations, which is what happens today.
  const runDesignations = useCallback(async (text: string) => {
    setDesignationsError(false);
    setDesignationEdits({});
    setDesignationExtras([]);
    const trimmed = text.trim();
    if (trimmed.length < TEXT_MIN_CHARS) {
      setDesignationNames([]);
      return;
    }
    setDesignationsLoading(true);
    try {
      const result = await prepareDesignations({ text: trimmed });
      setDesignationNames(result.names);
      setKnownDesignations(result.knownDesignations);
    } catch {
      setDesignationNames([]);
      setDesignationsError(true);
    } finally {
      setDesignationsLoading(false);
    }
  }, []);

  // Same once-per-review-session guard as the pointer fetch above, and safe for the same
  // reason: useDloIntake has already fetched the heavy ?text=1 shape before flipping to ready,
  // so `reviewText` is populated the first time the review step renders.
  useEffect(() => {
    if (step !== 'review' || !intake) return;
    if (designationNames !== null || designationsLoading) return;
    void runDesignations(reviewText);
  }, [
    step,
    intake,
    designationNames,
    designationsLoading,
    reviewText,
    runDesignations,
  ]);

  const editDesignation = (marathi: string, designation: string) => {
    setDesignationEdits((prev) => ({
      ...prev,
      [marathi]: { designation, remember: prev[marathi]?.remember ?? false },
    }));
  };

  const toggleRememberDesignation = (marathi: string, remember: boolean) => {
    setDesignationEdits((prev) => ({
      ...prev,
      [marathi]: {
        designation:
          prev[marathi]?.designation ??
          designationNames?.find((n) => n.marathi === marathi)?.designation ??
          '',
        remember,
      },
    }));
  };

  const changeDesignationExtra = (
    index: number,
    patch: Partial<DesignationExtra>,
  ) => {
    setDesignationExtras((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  // Three visible steps now: input → the middle step (processing + pointers + review, all of
  // which the officer moves through in place) → output. `processing`, `review` and
  // `generating` therefore all map to the middle rail index.
  const stepIndex = step === 'input' ? 0 : step === 'output' ? 2 : 1;
  const railSteps = [STR.dloStepInput, STR.dloStepReview, STR.dloStepOutput];

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const accepted = picked.filter((file) => isAudioFile(file.name));
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

  const audioFiles = files.map((file, index) => ({ file, index }));

  // Every document with something to send: pages that were read, or — by default for a scan
  // still at its initial picker — the pages picked for the intake job to read. A slot whose
  // file is still loading, or whose pages are all unticked, contributes nothing either way and
  // is simply not sent.
  const attachedDocuments = documents.flatMap((slot) =>
    slot.snapshot &&
    (slot.snapshot.pages.length > 0 || slot.snapshot.pendingPages.length > 0)
      ? [slot.snapshot]
      : [],
  );

  const addDocumentSlot = () => {
    setDocuments((prev) =>
      prev.length >= MAX_DOCUMENTS
        ? prev
        : [...prev, { id: nextSlotId.current++, snapshot: null }],
    );
    setError(null);
  };

  // Dropping a slot must take its stored job id with it, or the next card mounted under
  // that key would re-attach the document that was just removed.
  const removeDocumentSlot = (id: number) => {
    window.sessionStorage.removeItem(documentStorageKey(id));
    setDocuments((prev) => prev.filter((slot) => slot.id !== id));
    setError(null);
  };

  // A submitted run CONSUMES its documents: the intake now owns their text, so the cards are
  // emptied and their job ids forgotten. Called only after the create succeeds — a failed
  // create must leave the officer's read documents exactly where they were.
  const clearDocumentSlots = () => {
    for (const slot of documents) {
      window.sessionStorage.removeItem(documentStorageKey(slot.id));
    }
    setDocuments([]);
  };

  const submit = async () => {
    if (
      notes.trim().length === 0 &&
      files.length === 0 &&
      attachedDocuments.length === 0
    ) {
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
      // Documents were handled here, at the input step, so read ones travel as text rather than
      // bytes — which stops a scanned PDF being OCR'd a second time by the job. A scan still at
      // its initial picker travels as its page selection instead and IS read by the job, once.
      if (attachedDocuments.length > 0) {
        form.append(
          'documents',
          JSON.stringify(attachedDocuments.map(toPreReadDocument)),
        );
      }
      const id = await createDloIntake(form);
      clearDocumentSlots();
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
    // The approved person → पदनाम pairs. A blank पदनाम is dropped, so "no designations" is
    // the absence of the field and the article is exactly what /dlo produced before.
    const designations = collectDesignations(
      designationNames,
      designationEdits,
      designationExtras,
    );
    setSubmitting(true);
    setError(null);
    try {
      const id = await generateFromDloIntake(intakeId, {
        combinedText: text,
        category,
        ...(heading.trim() ? { heading: heading.trim() } : {}),
        ...(designations.length > 0 ? { designations } : {}),
        // Only when actually pasted — an empty string would be stored as a reference that
        // isn't one, and the resolver would have to re-derive "no reference" from it.
        ...(styleReference.trim()
          ? { styleReference: styleReference.trim() }
          : {}),
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
    // Starting over means starting over: a document left in sessionStorage would re-attach
    // itself to the next run without the officer ever choosing it again.
    clearDocumentSlots();
    setDocuments([{ id: nextSlotId.current++, snapshot: null }]);
    setCategory('news');
    setHeading('');
    setStyleReference('');
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
    setPointers(null);
    setPointersLoading(false);
    setPointersError(false);
    setDesignationNames(null);
    setKnownDesignations([]);
    setDesignationsLoading(false);
    setDesignationsError(false);
    setDesignationEdits({});
    setDesignationExtras([]);
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
          </section>

          {/* Recordings and documents get a control each. A recording is transcribed whole
              and has nothing to pick; a document is read page by page and, if it is a scan,
              its pages are chosen at review before any OCR is paid for. Asking for them
              together made one picker stand for two different jobs. */}
          <section className="card">
            <p className="field-label">{STR.dloAudioTitle}</p>
            <p className="hint">{STR.dloAudioHint}</p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => audioInput.current?.click()}
              >
                {STR.dloAudioUpload}
              </button>
              <input
                ref={audioInput}
                type="file"
                accept=".mp3,audio/mpeg"
                multiple
                hidden
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>
            <SelectedFileList
              title={STR.dloAudioFilesTitle}
              entries={audioFiles}
              onRemove={removeFile}
            />
          </section>

          {/* One card per document, each probing its file HERE — so a scanned PDF asks which
              pages are worth OCR'ing the moment it is attached. The selected pages are handed
              to the intake job unread by default; reading them in this card remains optional. */}
          {/* <section className="card">
            <p className="field-label">{STR.dloDocsTitle}</p>
            <p className="hint">{STR.dloDocsHint}</p>
          </section> */}

          {documents.map((slot) => (
            <DocumentIntake
              key={slot.id}
              storageKey={documentStorageKey(slot.id)}
              accept={['pdf', 'docx', 'txt']}
              title={STR.dloDocsCardTitle}
              hint={STR.dloDocsIntakeHint}
              // /dlo is the one surface that can read a scan later: its live initial selection
              // is the handover, and the intake job reads exactly those pages from the archived
              // original. Waiting for OCR in this card is optional, not the price of going on.
              allowDeferredRead
              onTextChange={(_text, snapshot) => {
                setDocuments((prev) =>
                  // Every card reports once on mount with nothing loaded; rebuilding the
                  // list for that would re-render the whole step for no change.
                  prev.some(
                    (entry) =>
                      entry.id === slot.id && entry.snapshot !== snapshot,
                  )
                    ? prev.map((entry) =>
                        entry.id === slot.id ? { ...entry, snapshot } : entry,
                      )
                    : prev,
                );
                if (snapshot) setError(null);
              }}
              {...(documents.length > 1
                ? { onRemove: () => removeDocumentSlot(slot.id) }
                : {})}
            />
          ))}

          <section className="card">
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-small"
                disabled={documents.length >= MAX_DOCUMENTS}
                onClick={addDocumentSlot}
              >
                {STR.dloDocsAdd}
              </button>
            </div>
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

          <StyleReferenceField
            value={styleReference}
            onChange={setStyleReference}
          />

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

          {/* A read-only key-point summary first, then the authoritative uploaded-source review.
              The summary helps scan a long intake; it does not filter what reaches the article. */}
          <PointerList
            points={pointers ?? []}
            loading={pointersLoading}
            error={pointersError}
            busy={submitting || extracting || reextractingIndex !== null}
            onRegenerate={() => void runPointers(reviewText)}
          />

          {/* Then the people the article will name and the पदनाम each carries. */}
          <DesignationReview
            names={designationNames}
            known={knownDesignations}
            edits={designationEdits}
            extras={designationExtras}
            loading={designationsLoading}
            error={designationsError ? STR.designationsError : null}
            busy={submitting || extracting || reextractingIndex !== null}
            onEditDesignation={editDesignation}
            onToggleRemember={toggleRememberDesignation}
            onChangeExtra={changeDesignationExtra}
            onAddExtra={() =>
              setDesignationExtras((prev) => [
                ...prev,
                { name: '', designation: '', remember: false },
              ])
            }
            onRegenerate={() => void runDesignations(reviewText)}
          />

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

          <StyleReferenceField
            value={styleReference}
            onChange={setStyleReference}
          />
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
                <>
                  {/* Rendered server-side by Chromium (a browser-side PDF library cannot
                      shape Devanagari matras), so this is a link rather than a
                      downloadBlob — only the API can force a cross-origin download. */}
                  <a className="btn" href={articlePdfDownloadUrl(generationId)}>
                    {STR.downloadPdf}
                  </a>
                  <Link className="btn" href={`/generations/${generationId}`}>
                    {STR.dloViewDetail}
                  </Link>
                </>
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
