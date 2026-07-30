'use client';

// One DLO intake's workspace, addressed by /dlo/[id]. Three visible steps: (1) processing —
// audio transcribed via Sarvam batch STT, PDFs via document digitization, DOCX/TXT locally;
// (2) an EDITABLE review of the Marathi text, where the officer corrects names and amounts
// before they become "facts"; and (3) the generated article, produced by the existing
// generation runner.
//
// The input step is NOT here — it lives on /dlo (DloIntakeForm), which posts the intake and
// navigates here. That split is what lets several officers work at once: this component is
// per-intake and mounted by a route, rather than one always-mounted workspace holding the
// only intakeId the app could have.
//
// THE STEP IS DERIVED FROM THE ROW, never from where the officer has clicked. That is what
// makes a reload, a closed tab or a different machine pick the work back up exactly where it
// was — the intake row is the state of record, and everything the row does not carry (the
// officer's corrections, the unticked pages, and the two PAID lookups) is autosaved into
// dlo_intakes.review_state so resuming never re-buys anything.
//
// Step 2 is per SOURCE (see DloSourceReview): each recording and document gets its own
// editable card, and a PDF is listed page by page so pages that do not belong in the article
// can be unchecked. What the officer ends up with is re-assembled here with the same combiner
// the intake job used, and that string is what is sent as the generation's note.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Music } from 'lucide-react';
import type {
  DloCategory,
  DloIntakeDetail,
  KnownDesignation,
  PreparedName,
} from '@dgipr/schemas';
import {
  articlePdfDownloadUrl,
  extractDloPages,
  generateFromDloIntake,
  prepareDesignations,
  verifyPersonName,
  reextractDloFile,
  sendArticleFeedback,
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
import { useArticleStream } from '../lib/useArticleStream';
import { useDloIntake } from '../lib/useDloIntake';
import { useDloReviewAutosave } from '../lib/useDloReviewAutosave';
import { useGeneration } from '../lib/useGeneration';
import { useTasks } from '../lib/TasksProvider';
import { DloCategoryPicker } from './DloCategoryPicker';
import { DloSourceReview } from './DloSourceReview';
import {
  DesignationReview,
  collectDesignations,
  type DesignationEdit,
  type DesignationExtra,
} from './DesignationReview';
import { MarkdownText } from './MarkdownText';
import { ProgressSteps } from './ProgressSteps';
import { StyleReferenceField } from './StyleReferenceField';
import { DLO_INTAKE_STEP_LABELS, STR } from '../lib/strings';

type DloStep = 'processing' | 'review' | 'generating' | 'output';

// Bound of the generation note the reviewed text becomes (see DloGenerateRequestSchema).
// There is deliberately no upper bound: a meeting's recordings and scans are as long as
// they are, and the officer has already reviewed and paid to extract every character by the
// time they reach this step. The character counts below are therefore informational.
const TEXT_MIN_CHARS = 20;

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

// The generation phase, isolated so useGeneration only runs once an id exists.
// While running it shows the shared pipeline progress AND the article as it is written;
// on completion it hands the article up (the parent renders the output step); on failure
// it shows the error with a way out.
function GenerationPhase({
  id,
  onCompleted,
  onBackToReview,
}: {
  id: string;
  onCompleted: (article: string) => void;
  onBackToReview: () => void;
}) {
  const { detail, error } = useGeneration(id);

  const article = detail?.status === 'completed' ? detail.article : null;
  // The draft arriving live. Purely a view — the row is still the state of record, and this
  // is dropped the moment the finished article is in hand. A run that streams nothing (a
  // restarted API, a poster-only lane, ARTICLE_STREAMING=0) leaves it empty and the progress
  // steps below are exactly what the officer saw before.
  const streamed = useArticleStream(id, article === null);
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
          <button type="button" className="btn" onClick={onBackToReview}>
            {STR.dloRegenerateArticle}
          </button>
        </div>
      </section>
    );
  }
  const draft = streamed ? (
    <section className="card">
      <div className="article-head">
        <h2>{STR.articleStreamingTitle}</h2>
        <span className="translating-note" aria-live="off">
          <span className="spinner" aria-hidden="true" />
          {STR.articleStreamingBadge}
        </span>
      </div>
      {/* aria-live="polite" on a token stream would have a screen reader read the article
          several times over, so the region is announced once and read on completion. */}
      <div className="article-body article-body--streaming">
        {draftText(streamed)}
      </div>
    </section>
  ) : null;

  if (!detail) {
    return (
      <>
        <section className="card">
          <div className="dlo-processing">
            <span className="spinner spinner-lg" aria-hidden="true" />
            <p className="dlo-processing-title">{STR.progressTitle}</p>
            {error ? <p className="hint">{error}</p> : null}
          </div>
        </section>
        {draft}
      </>
    );
  }
  return (
    <>
      <ProgressSteps detail={detail} />
      {draft}
    </>
  );
}

// A blinking caret after the last character, so a pause between tokens reads as "still
// writing" rather than "finished". Rendered as its own element because the text is plain
// Devanagari and must stay copyable and selectable exactly as it is.
function draftText(text: string) {
  return (
    <>
      {text}
      <span className="stream-caret" aria-hidden="true" />
    </>
  );
}

// Keep the DLO officer on the finished-article step while an LLM revision runs. The
// generation detail is the source of truth after the first render: its poll follows the
// `revise_article` job and replaces the visible article as soon as the revised copy is
// persisted. This is intentionally a focused DLO view rather than <ArticleView>, whose
// translation, fact-check and source-note controls belong on the linked detail page.
function DloArticleOutput({
  id,
  initialArticle,
  onBackToReview,
}: {
  id: string;
  initialArticle: string;
  onBackToReview: () => void;
}) {
  const { detail, error: refreshError, refresh } = useGeneration(id);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const article = detail?.article ?? initialArticle;
  const revising =
    sending ||
    detail?.articleRevising === true ||
    (detail?.status === 'running' && detail.step === 'revise_article');
  const revisionError =
    feedbackError ??
    detail?.articleReviseError ??
    (detail?.status === 'failed' && detail.step === 'revise_article'
      ? detail.error
      : null) ??
    refreshError;

  const copyArticle = async () => {
    await navigator.clipboard.writeText(article);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const revise = async () => {
    const instruction = feedback.trim();
    if (instruction.length < 3) {
      setFeedbackError(STR.feedbackTooShort);
      return;
    }
    setSending(true);
    setFeedbackError(null);
    try {
      await sendArticleFeedback(id, instruction);
      setFeedback('');
      await refresh();
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="card">
        <div className="article-head">
          <h2>{STR.dloOutputTitle}</h2>
        </div>
        {/* Same as the detail page: rendered for reading, copied/downloaded raw. */}
        <MarkdownText text={article} className="article-body" />
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
          {/* Rendered server-side by Chromium (a browser-side PDF library cannot
              shape Devanagari matras), so this is a link rather than a
              downloadBlob — only the API can force a cross-origin download. */}
          <a className="btn" href={articlePdfDownloadUrl(id)}>
            {STR.downloadPdf}
          </a>
          <Link className="btn" href={`/generations/${id}`}>
            {STR.dloViewDetail}
          </Link>
        </div>

        <div style={{ marginTop: 22 }}>
          <label className="field-label" htmlFor="dlo-article-feedback">
            {STR.articleFeedbackTitle}
          </label>
          <p className="hint">{STR.articleFeedbackHint}</p>
          <textarea
            id="dlo-article-feedback"
            value={feedback}
            onChange={(event) => {
              setFeedback(event.target.value);
              setFeedbackError(null);
            }}
            placeholder={STR.feedbackPlaceholder}
            rows={3}
            maxLength={4_000}
            disabled={revising}
            style={{ marginTop: 10 }}
          />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={revise}
              disabled={revising}
            >
              {revising ? STR.sendingFeedback : STR.sendFeedback}
            </button>
            {revising ? (
              <span className="translating-note" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                {STR.revisingArticle}
              </span>
            ) : null}
          </div>
          {revisionError ? <p className="form-error">{revisionError}</p> : null}
        </div>
      </section>

      {/* An intake is never "consumed": it stays ready and can produce another article from
          the same sources, so this returns to review rather than starting over. */}
      <section className="card">
        <div className="btn-row">
          <button type="button" className="btn" onClick={onBackToReview}>
            {STR.dloRegenerateArticle}
          </button>
        </div>
      </section>
    </>
  );
}

export default function DloWorkspace({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const { addTask } = useTasks();
  const [category, setCategory] = useState<DloCategory>('news');
  const [heading, setHeading] = useState('');
  // Tier 1 of the article's style-reference hierarchy: a published article the officer wants
  // this one shaped like. Style only — never a factual source (see StyleReferenceField).
  const [styleReference, setStyleReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [combinedText, setCombinedText] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [article, setArticle] = useState<string | null>(null);

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

  // व्यक्ती व पदनाम: the people the note names and the designation to print before each.
  // `null` = not fetched, `[]` = fetched and nobody was named.
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
  // Names whose "तपासले म्हणून खूण करा" write is in flight, and the last failure. Per-name so
  // several rows can be confirmed without the card going busy as a whole.
  const [verifyingNames, setVerifyingNames] = useState<string[]>([]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const {
    detail: intake,
    error: intakeError,
    refresh,
  } = useDloIntake(intakeId);

  // What the saved review state restored, recorded as a ref rather than inferred from the
  // designation state. The auto-fire effect below runs in the SAME commit as the seeding
  // effect, where its `designationNames === null` closure is still true — so a state-based
  // guard would fire a PAID call one render before the seed lands. A ref mutates immediately
  // and is therefore the only guard that holds.
  const restoredFromSave = useRef({ designations: false });
  const seeded = useRef(false);
  const [seededWriter, setSeededWriter] = useState<string | null>(null);

  // Seed once from the officer's saved review state. useDloIntake fetches the heavy `?text=1`
  // shape on each transition into `ready`, so by the time the review step can render, this
  // value is authoritative — `null` genuinely means "nothing was ever saved" rather than
  // "not loaded yet".
  useEffect(() => {
    if (seeded.current) return;
    if (!intake || intake.status !== 'ready') return;
    seeded.current = true;
    const saved = intake.reviewState;
    // Category/heading are real columns, so they come off the row itself and survive even on
    // a database without 0036.
    setCategory(intake.category);
    setHeading(intake.heading ?? '');
    if (!saved) return;
    // Whose save we are resuming, handed to the autosave below so that reopening one's own
    // work in a new tab (which mints a new writer id) is not mistaken for a second officer.
    setSeededWriter(saved.writer);
    setEdits({ ...saved.edits });
    setExcluded(new Set(saved.excluded));
    if (saved.styleReference) setStyleReference(saved.styleReference);
    if (saved.designations) {
      const currentResolver = saved.designations.resolverVersion === 2;
      restoredFromSave.current.designations = currentResolver;
      if (currentResolver) {
        setDesignationNames([...saved.designations.names]);
      }
      setKnownDesignations([...saved.designations.known]);
      setDesignationEdits({ ...saved.designations.edits });
      setDesignationExtras([...saved.designations.extras]);
    }
  }, [intake]);

  // Resuming an intake that already produced an article lands on the article — that is the
  // outcome of the work. "याच स्रोतातून पुन्हा लेख तयार करा" comes back here to review.
  const adoptedGeneration = useRef(false);
  useEffect(() => {
    if (adoptedGeneration.current) return;
    const latest = intake?.generations[0];
    if (!latest) return;
    adoptedGeneration.current = true;
    setGenerationId(latest.id);
  }, [intake]);

  // Seed the legacy single-textarea fallback with the combined output.
  useEffect(() => {
    if (intake?.status !== 'ready') return;
    setCombinedText((prev) => prev || (intake.combinedText ?? ''));
  }, [intake]);

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

  // The step is derived, never stored: that is what makes a reload resume exactly where the
  // officer was rather than restarting the flow.
  const step: DloStep = generationId
    ? article
      ? 'output'
      : 'generating'
    : intake?.status === 'ready'
      ? 'review'
      : 'processing';

  // Autosave everything the row does not already carry, so leaving costs nothing already paid
  // for. Only while the intake is ready — nothing is worth saving before the review step
  // exists, and staying quiet during extract/re-extract keeps officer writes clear of the
  // job's own writes.
  const {
    saving,
    saveError,
    conflict,
    flush: flushReview,
    acknowledgeConflict,
    adoptWriter,
  } = useDloReviewAutosave(
    intakeId,
    intake?.status === 'ready' && seeded.current,
    {
      edits,
      excluded,
      styleReference,
      // The key-point summary is no longer produced, so nothing is written here. A blob saved
      // before that change keeps its `pointers` field untouched — the PATCH is per field.
      pointers: undefined,
      designations:
        designationNames !== null
          ? {
              resolverVersion: 2,
              names: designationNames,
              known: knownDesignations,
              edits: designationEdits,
              extras: designationExtras,
            }
          : undefined,
      category,
      heading,
    },
  );

  // Adopt the identity of the save we resumed from, so the first autosave after a reload does
  // not report our own earlier work as somebody else's edit.
  useEffect(() => {
    if (seededWriter) adoptWriter(seededWriter);
  }, [seededWriter, adoptWriter]);

  // Find the people this note names and what पदनाम each should carry. Best-effort: any failure
  // leaves an empty (non-null) list, so the officer can still generate — without designations,
  // which is what happens today.
  const runDesignations = useCallback(
    async (text: string, preserveOfficerEdits = false) => {
      setDesignationsError(false);
      if (!preserveOfficerEdits) {
        setDesignationEdits({});
        setDesignationExtras([]);
      }
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
    },
    [],
  );

  // Once per review session, and never on resume — a RESUMED intake must not re-buy a name
  // list it already has.
  useEffect(() => {
    if (step !== 'review' || !intake) return;
    if (!seeded.current || restoredFromSave.current.designations) return;
    if (designationNames !== null || designationsLoading) return;
    void runDesignations(
      reviewText,
      intake.reviewState?.designations !== undefined,
    );
  }, [
    step,
    intake,
    designationNames,
    designationsLoading,
    reviewText,
    runDesignations,
  ]);

  // Patch ONE field of a row's edit state, preserving the rest. Each setter used to rebuild the
  // whole object from the fields it happened to know about, which silently dropped any other —
  // a real hazard now that `accepted` (whether a dictionary suggestion was confirmed) lives here
  // too, since losing it would quietly un-accept a person the officer had already approved.
  const patchDesignationEdit = (
    marathi: string,
    patch: Partial<DesignationEdit>,
  ) => {
    setDesignationEdits((prev) => {
      const term = designationNames?.find((n) => n.marathi === marathi);
      const current: DesignationEdit = prev[marathi] ?? {
        designation: term?.designation ?? '',
        remember: false,
        // Seed from the row's own default, NOT `false`. A pre-ticked suggestion has no edit
        // entry until something is patched, so a `false` seed would un-accept it the moment
        // the officer merely retyped its पदनाम — the same silent drop, one keystroke later.
        // Must stay in step with `valueFor` in DesignationReview.
        accepted: term?.suggested ?? false,
      };
      return { ...prev, [marathi]: { ...current, ...patch } };
    });
  };

  const editDesignation = (marathi: string, designation: string) =>
    patchDesignationEdit(marathi, { designation });

  const toggleRememberDesignation = (marathi: string, remember: boolean) =>
    patchDesignationEdit(marathi, { remember });

  const toggleAcceptedDesignation = (marathi: string, accepted: boolean) =>
    patchDesignationEdit(marathi, { accepted });

  // "तपासले म्हणून खूण करा": confirm the name's नाव-शब्दकोश row from here. The row's own
  // `verified` flag is flipped locally on success rather than re-fetching the list — a re-fetch
  // would re-buy the extractor call, and this is the only field that changed. The flipped list
  // is what the review autosave stores, so the badge survives a reload.
  const verifyName = async (marathi: string) => {
    if (verifyingNames.includes(marathi)) return;
    setVerifyError(null);
    setVerifyingNames((prev) => [...prev, marathi]);
    try {
      await verifyPersonName({ name: marathi });
      setDesignationNames((prev) =>
        prev
          ? prev.map((term) =>
              term.marathi === marathi
                ? { ...term, verified: true, inGlossary: true }
                : term,
            )
          : prev,
      );
    } catch {
      setVerifyError(STR.designationsVerifyError);
    } finally {
      setVerifyingNames((prev) => prev.filter((name) => name !== marathi));
    }
  };

  const changeDesignationExtra = (
    index: number,
    patch: Partial<DesignationExtra>,
  ) => {
    setDesignationExtras((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  // Three visible steps: input (on /dlo) → this workspace's processing + review → output.
  // `processing`, `review` and `generating` all map to the middle rail index.
  const stepIndex = step === 'output' ? 2 : 1;
  const railSteps = [STR.dloStepInput, STR.dloStepReview, STR.dloStepOutput];

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
    if (!intake) return;
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
    if (!intake) return;
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
      // Await the autosave before generating, so what is stored and what becomes the article
      // can never disagree.
      await flushReview();
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
      setArticle(null);
      // Several DLO articles can now be in flight at once, so the navbar tasks panel is the
      // right place to watch them.
      addTask(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  // Back to review from the article, to produce another one from the same sources.
  const backToReview = () => {
    setGenerationId(null);
    setArticle(null);
    setError(null);
  };

  const failedFiles = intake?.files.filter((f) => f.status === 'failed') ?? [];
  const busy = submitting || extracting || reextractingIndex !== null;
  // The people the article will name are not known until the prepare call lands, and they are
  // part of what the officer is approving here — so generating is held until the card has
  // something to show. `null` is "not fetched yet"; `[]` is a finished lookup that named
  // nobody, which is a complete answer and must not block. A failure also lands as `[]`, so a
  // broken lookup degrades to generating without designations rather than to a dead button.
  const designationsPending = designationNames === null || designationsLoading;

  return (
    <main className="page">
      {/* /dlo itself is where a second piece of work is started; this workspace no longer
          offers its own shortcut there. STR.dloNewWork is left in strings.ts unused. */}
      <div className="dlo-head">
        <h1 className="page-title">{STR.dloTitle}</h1>
      </div>

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
                <button
                  type="button"
                  className="btn"
                  onClick={() => router.push('/dlo')}
                >
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
                {intakeError ? (
                  <p className="form-error">{intakeError}</p>
                ) : null}
              </div>
              {intake ? <SourceStatusList intake={intake} /> : null}
            </>
          )}
        </section>
      ) : null}

      {step === 'review' ? (
        <>
          {conflict ? (
            <section className="card">
              <div className="info-callout">
                <p>{STR.dloReviewConflict}</p>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      seeded.current = false;
                      restoredFromSave.current = { designations: false };
                      acknowledgeConflict();
                      void refresh();
                    }}
                  >
                    {STR.dloReviewConflictReload}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card">
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={busy || pendingSelection || designationsPending}
              >
                {submitting ? STR.submitting : STR.dloGenerate}
              </button>
              {saving ? (
                <span className="translating-note" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />
                  {STR.dloReviewSaving}
                </span>
              ) : null}
            </div>
            {pendingSelection ? (
              <p className="hint">{STR.dloReviewSelectionPending}</p>
            ) : null}
            {saveError ? <p className="form-error">{saveError}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </section>

          {/* The people the article will name and the पदनाम each carries — the first thing the
              officer sees on the review step. (The key-point summary that used to sit above this
              was removed: it cost a paid model call per review and filtered nothing.) */}
          <DesignationReview
            names={designationNames}
            known={knownDesignations}
            edits={designationEdits}
            extras={designationExtras}
            loading={designationsLoading}
            error={designationsError ? STR.designationsError : null}
            busy={busy}
            onEditDesignation={editDesignation}
            onToggleRemember={toggleRememberDesignation}
            onToggleAccepted={toggleAcceptedDesignation}
            onChangeExtra={changeDesignationExtra}
            onAddExtra={() =>
              setDesignationExtras((prev) => [
                ...prev,
                { name: '', designation: '', remember: false },
              ])
            }
            onRegenerate={() => void runDesignations(reviewText)}
            onVerify={(marathi) => void verifyName(marathi)}
            verifying={verifyingNames}
            verifyError={verifyError}
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
                <p className="hint" style={{ marginTop: 6 }}>
                  {combinedText.length.toLocaleString('mr-IN')}{' '}
                  {STR.dloCharsSuffix}
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
                <p className="hint">
                  {STR.dloReviewTotal}{' '}
                  {reviewText.length.toLocaleString('mr-IN')}{' '}
                  {STR.dloCharsSuffix}
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
            <DloCategoryPicker value={category} onChange={setCategory} />
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
          onCompleted={setArticle}
          onBackToReview={backToReview}
        />
      ) : null}

      {step === 'output' && article && generationId ? (
        <DloArticleOutput
          id={generationId}
          initialArticle={article}
          onBackToReview={backToReview}
        />
      ) : null}
    </main>
  );
}
