'use client';

// Creative and Social page: paste a FINISHED article, then turn it into a poster
// (for the article itself, for X, or for Facebook) or into a caption alone. No
// article is written here — the pasted text is the sole source and is used as-is
// (providedArticle) for the poster path.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clapperboard,
  Image as ImageIcon,
  MessageSquareText,
} from 'lucide-react';
import {
  NOTE_MAX_CHARS,
  POSTER_HEADING_MAX_CHARS,
  isSocialCategory,
} from '@dgipr/schemas';
import type { Category, DesignMode, TemplateBrand } from '@dgipr/schemas';
import { createGeneration } from '../lib/api';
import { BRAND_OPTIONS, DESIGN_OPTIONS } from '../lib/generationOptions';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import {
  DocumentIntake,
  type DocumentIntakeStatus,
} from '../components/DocumentIntake';
import ReferencePicker, {
  type ReferenceSelection,
} from '../components/ReferencePicker';

// The output picker is TWO levels: what artifact (पोस्टर / कॅप्शन), then what it is for
// (लेख / ट्विटर / फेसबुक). The two questions are independent, which the old flat row of
// three cards conflated. Built locally so the shared CATEGORY_OPTIONS (reused by the
// detail-page "next step" panel and /dlo) is left untouched.
type OutputKind = 'poster' | 'caption';
// Level-2 values ARE Category values, so `category` needs no mapping table. Deliberately
// NOT a 'article' | 'twitter' | 'facebook' union: 'article' would mean "the लेख poster"
// here and "no poster at all" in outputType, forty lines apart.
type PosterTarget = Extract<Category, 'scheme' | 'twitter' | 'facebook'>;
type CaptionTarget = Extract<Category, 'twitter' | 'facebook'>;

// Level 1. पोस्टर is the default and the common case; कॅप्शन is the caption-only lane,
// where no poster is rendered at all.
const OUTPUT_KINDS = [
  {
    value: 'poster',
    icon: ImageIcon,
    name: STR.categoryPoster,
    desc: STR.categoryPosterDesc,
  },
  {
    value: 'caption',
    icon: MessageSquareText,
    name: STR.mediaOutputCaption,
    desc: STR.mediaOutputCaptionDesc,
  },
] as const satisfies ReadonlyArray<{
  value: OutputKind;
  icon: typeof ImageIcon;
  name: string;
  desc: string;
}>;

// Level 2, पोस्टर branch. No icons — the level-1 row carries those, which is what gives
// the two rows their hierarchy for free (the /video page's pickers do the same).
const POSTER_TARGETS = [
  {
    value: 'scheme',
    name: STR.mediaTargetArticle,
    desc: STR.mediaTargetArticleDesc,
  },
  {
    value: 'twitter',
    name: STR.mediaTargetTwitter,
    desc: STR.mediaTargetTwitterDesc,
  },
  {
    value: 'facebook',
    name: STR.mediaTargetFacebook,
    desc: STR.mediaTargetFacebookDesc,
  },
] as const satisfies ReadonlyArray<{
  value: PosterTarget;
  name: string;
  desc: string;
}>;

// Level 2, कॅप्शन branch — the same two platform cards. One table serves both branches
// because the labels are platform names only: the card above already says whether a
// poster or only a caption is being made.
const CAPTION_TARGETS = POSTER_TARGETS.filter(
  (
    target,
  ): target is Extract<
    (typeof POSTER_TARGETS)[number],
    { value: CaptionTarget }
  > => isSocialCategory(target.value),
);

// Where the upload card remembers its in-flight job across a refresh. The page also clears
// it by hand after a submit (see clearDocument), so it is named once.
const DOC_STORAGE_KEY = 'dgipr.mediaRoom.document';

export default function NewGenerationPage() {
  const router = useRouter();
  const { addTask, openPanel, hasActiveSocialTask, hasActiveArticleTask } =
    useTasks();
  const [note, setNote] = useState('');
  // The uploaded file's text, kept BESIDE the textarea rather than pushed into it: the two
  // are independent sources and either one alone is a complete note. It used to be appended
  // on a button click inside the upload card, which meant an officer who uploaded a PDF and
  // pressed तयार करा was told to write a longer टिपणी while their document sat there unused.
  const [docText, setDocText] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentIntakeStatus>('empty');
  const [readRequest, setReadRequest] = useState(0);
  const [awaitingRead, setAwaitingRead] = useState(false);
  const readRequestedForSubmitRef = useRef(false);
  // Remounts the upload card to drop a finished document (its own state is internal).
  const [docKey, setDocKey] = useState(0);
  // The two levels of the output picker. `category` is DERIVED from the pair below rather
  // than stored, so the two can never disagree.
  const [outputKind, setOutputKind] = useState<OutputKind>('poster');
  const [posterTarget, setPosterTarget] = useState<PosterTarget>('scheme');
  const [captionTarget, setCaptionTarget] = useState<CaptionTarget>('twitter');
  const [designMode, setDesignMode] = useState<DesignMode>('fresh');
  const [templateBrand, setTemplateBrand] = useState<TemplateBrand>('dgipr');
  // A social post is poster-only unless asked otherwise: the caption is a separate
  // paid model call, and plenty of posts are published as an image. It can also be added
  // afterwards from the detail page, so off is a cheap default rather than a lossy one.
  const [wantCaption, setWantCaption] = useState(false);
  // पोस्टर runs only: the exact line to print on the poster. Blank (the default) leaves it to
  // the automatic named-subject resolution, which is what most runs want — this is the
  // override for when the officer already knows the poster must say a particular thing.
  const [posterHeading, setPosterHeading] = useState('');
  const [reference, setReference] = useState<ReferenceSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // कॅप्शन = caption only, no poster. On the wire that is outputType 'article' — which on
  // the social lane means exactly what it has always meant on the article lane: this run
  // renders no poster. (The caption lives in the `article` column, the social convention.)
  const captionOnly = outputKind === 'caption';
  const category: Category = captionOnly ? captionTarget : posterTarget;

  // ट्विटर and फेसबुक are one lane: same n8n workflow, same design modes, same
  // master library — only the recorded category differs.
  const isSocial = isSocialCategory(category);
  // CMO just follows its fixed template, so it needs no रचना-शैली (design mode) —
  // that selector is hidden and the CMO template library is shown instead.
  const isCmo = isSocial && templateBrand === 'cmo';

  // Which library the template picker shows: twitter masters for the social flows
  // (except 'fresh' — no master is edited; CMO always edits a master), article
  // masters for the पोस्टर path (which always renders a poster). null hides it.
  // A कॅप्शन run renders nothing, so there is no template to pin. This needs its own
  // branch rather than riding on isCmo: at designMode 'adaptive' the social arm below
  // would still return 'twitter'.
  const pickerCategory: 'twitter' | 'article' | null = captionOnly
    ? null
    : isSocial
      ? isCmo
        ? 'twitter'
        : designMode === 'fresh'
          ? null
          : 'twitter'
      : 'article';
  // CMO templates live under the twitter category but the 'cmo' brand; every other
  // social/article poster is DGIPR.
  const pickerBrand: TemplateBrand = isCmo ? 'cmo' : 'dgipr';

  // A pin is only meaningful for the combination it was chosen under.
  useEffect(() => {
    setReference(null);
  }, [category, designMode, templateBrand]);

  // विभाग is a social-only concept, and a कॅप्शन run has no template at all; snap it back
  // to DGIPR whenever the run is neither, so switching can never leave a stray CMO brand
  // set (which also makes isCmo above false for a caption-only run).
  useEffect(() => {
    if (!isSocial || captionOnly) setTemplateBrand('dgipr');
  }, [isSocial, captionOnly]);

  // What actually gets generated from: typed text, uploaded file, or both, in that order.
  // Blank-line separated so a pasted lead and an attached GR read as two blocks.
  const combinedNote = useMemo(
    () => [note.trim(), docText.trim()].filter(Boolean).join('\n\n'),
    [note, docText],
  );

  // Drop the attached document. A remount is what clears the card's internal state, and the
  // stored job id has to go with it or the mount effect would re-attach the same file.
  const clearDocument = () => {
    window.sessionStorage.removeItem(DOC_STORAGE_KEY);
    setDocText('');
    setDocKey((n) => n + 1);
  };

  // Press तयार करा → start the run immediately. Person/designation extraction is display-only
  // on the generation detail page, where it reads the text that was actually produced.
  const startSubmit = async () => {
    if (docStatus === 'unread' || docStatus === 'reading') {
      setAwaitingRead(true);
      if (docStatus === 'unread') {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    await submit();
  };

  const submit = async () => {
    if (combinedNote.length < 20) {
      setError(STR.noteTooShort);
      return;
    }
    // A pasted article plus a file's text can add up past the API's cap; say so here
    // rather than let the request come back 400.
    if (combinedNote.length > NOTE_MAX_CHARS) {
      setError(STR.noteTooLong);
      return;
    }
    if (!isSocial && posterHeading.trim().length > POSTER_HEADING_MAX_CHARS) {
      setError(STR.posterHeadingTooLong);
      return;
    }
    if (isSocial && hasActiveSocialTask) {
      setError(STR.busyError);
      return;
    }
    if (!isSocial && hasActiveArticleTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: combinedNote,
        category,
        // A कॅप्शन run carries outputType 'article' — "this run renders no poster", the
        // same meaning the article lane has always given it. The runner reads it off the
        // ROW, so it survives a retry and an edit-note rerun for free.
        outputType: captionOnly ? 'article' : 'poster',
        // The पोस्टर path uses the pasted article verbatim (skip generateArticle);
        // inert for social, whose caption is always written fresh.
        providedArticle: !isSocial,
        // Social only. On the कॅप्शन lane the caption is the run's entire output, so it is
        // not opt-in there — the toggle is not even rendered.
        generateCaption: isSocial ? captionOnly || wantCaption : undefined,
        // पोस्टर only, and only when actually typed — an empty string would be a
        // meaningless "clear" on a run that has nothing to clear.
        posterHeading:
          !isSocial && posterHeading.trim() ? posterHeading.trim() : undefined,
        // Template questions belong to a poster; a caption has none (and the API rejects
        // a pin on a run that renders nothing).
        designMode: isSocial && !captionOnly ? designMode : undefined,
        templateBrand: isSocial && !captionOnly ? templateBrand : undefined,
        referenceImageId:
          !captionOnly && reference?.kind === 'image'
            ? reference.id
            : undefined,
        referenceTypeId:
          !captionOnly && reference?.kind === 'type' ? reference.id : undefined,
      });
      if (isSocial) {
        // Background task: don't navigate. Track it, open the panel, reset the form
        // to the poster default so the now-disabled social cards read clearly.
        addTask(id);
        openPanel();
        setNote('');
        clearDocument();
        setOutputKind('poster');
        setPosterTarget('scheme');
        setPosterHeading('');
        setSubmitting(false);
      } else {
        // Navigate to the progress page, but also register a session row so the
        // navbar tasks panel offers a shortcut back to this run. The document is dropped
        // here too: it has been consumed by this run, and the id outlives the navigation in
        // sessionStorage — coming back would otherwise silently re-attach it to the next one.
        clearDocument();
        addTask(id);
        router.push(`/generations/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
      setSubmitting(false);
    }
  };

  const startSubmitRef = useRef(startSubmit);
  useEffect(() => {
    startSubmitRef.current = startSubmit;
  });
  useEffect(() => {
    if (!awaitingRead) return;
    if (docStatus === 'unread') {
      if (!readRequestedForSubmitRef.current) {
        readRequestedForSubmitRef.current = true;
        setReadRequest((request) => request + 1);
      }
      return;
    }
    if (docStatus === 'ready') {
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
      void startSubmitRef.current();
    } else if (docStatus === 'failed' || docStatus === 'empty') {
      readRequestedForSubmitRef.current = false;
      setAwaitingRead(false);
    }
  }, [awaitingRead, docStatus]);

  return (
    <main className="page">
      <h1 className="page-title">{STR.mediaRoomTitle}</h1>

      <section className="card">
        <label className="field-label" htmlFor="note">
          {STR.articlePasteLabel}
        </label>
        <p className="hint">{STR.articlePasteHint}</p>
        <textarea
          id="note"
          className="note-input"
          placeholder={STR.articlePastePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 10 }}
        />
      </section>

      {/* A finished article often arrives as a file rather than in the clipboard — a Word
          document, or a scanned press note. The shared intake reads it here; a scanned PDF
          stops to ask which pages are worth OCR'ing before a single credit is spent. It sits
          inline rather than behind a fold so every upload surface in the product looks the
          same.

          LIVE mode (onTextChange): the file's text is a SECOND source counted beside the box
          above, not something pushed into it — so pasting, uploading, or doing both all just
          work. It used to be appended by a button inside the card, which meant an upload that
          was never handed over was silently dropped and the submit complained the टिपणी was
          too short. */}
      <DocumentIntake
        key={docKey}
        storageKey={DOC_STORAGE_KEY}
        onTextChange={(text) => {
          setDocText(text);
          if (text.trim()) setError(null);
        }}
        onStatusChange={setDocStatus}
        readRequest={readRequest}
      />

      <section className="card">
        <h2>{STR.mediaOutputLabel}</h2>
        <div className="output-picker">
          {OUTPUT_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="output-option"
              aria-pressed={outputKind === option.value}
              // पोस्टर is never disabled: its children straddle both lanes, so a single
              // flag would be a lie whenever one lane is free. कॅप्शन can be — both of
              // its children are social.
              disabled={option.value === 'caption' && hasActiveSocialTask}
              onClick={() => setOutputKind(option.value)}
            >
              <span className="icon" aria-hidden="true">
                <option.icon size={30} strokeWidth={1.75} />
              </span>
              <span className="name">{option.name}</span>
              <span className="desc">{option.desc}</span>
            </button>
          ))}
          <button
            type="button"
            className="output-option"
            onClick={() => router.push('/video')}
          >
            <span className="icon" aria-hidden="true">
              <Clapperboard size={30} strokeWidth={1.75} />
            </span>
            <span className="name">{STR.mediaOutputVideo}</span>
            <span className="desc">{STR.mediaOutputVideoDesc}</span>
          </button>
        </div>
        {/* Level 2: what the chosen artifact is FOR. Subordinate to the row above rather
            than a card of its own, and without icons — that is what gives the two rows
            their hierarchy. */}
        <div className="output-sublevel">
          <p className="field-label">{STR.mediaTargetLabel}</p>
          <div
            className={
              captionOnly ? 'output-picker output-picker-two' : 'output-picker'
            }
          >
            {(captionOnly ? CAPTION_TARGETS : POSTER_TARGETS).map((option) => {
              // v1 allows one active task per lane at a time: the ट्विटर/फेसबुक cards
              // are gated by an in-flight social run (they share one n8n workflow),
              // the लेख card by an in-flight article run (the lanes don't block each
              // other). Under कॅप्शन every child is social, so this collapses with no
              // special case. A selected card that becomes disabled is left selected —
              // submit() re-checks both flags, and moving the choice under the user's
              // cursor would be worse.
              const disabled = isSocialCategory(option.value)
                ? hasActiveSocialTask
                : hasActiveArticleTask;
              return (
                <button
                  key={option.value}
                  type="button"
                  className="output-option"
                  aria-pressed={category === option.value}
                  disabled={disabled}
                  onClick={() => {
                    if (!captionOnly) {
                      setPosterTarget(option.value);
                      // CAPTION_TARGETS already excludes 'scheme'; this re-narrows the
                      // widened union the ternary above produces (the /dlo picker's move).
                    } else if (option.value !== 'scheme') {
                      setCaptionTarget(option.value);
                    }
                  }}
                >
                  <span className="name">{option.name}</span>
                  <span className="desc">{option.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Sits with the format cards, not in its own section: "a post with a caption"
            is part of choosing what to make. Social lanes only, and not on the कॅप्शन
            lane, where a caption is the whole output and the toggle would be a tautology. */}
        {isSocial && !captionOnly ? (
          <label className="option-toggle">
            <input
              type="checkbox"
              checked={wantCaption}
              onChange={(e) => setWantCaption(e.target.checked)}
            />
            <span>
              <span className="option-toggle-name">
                {STR.captionToggleLabel}
              </span>
              <span className="option-toggle-desc">
                {STR.captionToggleHint}
              </span>
            </span>
          </label>
        ) : null}
        {/* The पोस्टर twin of the caption toggle, and in the same card for the same reason:
            what the poster SAYS is part of choosing what to make. Only the article-poster lane
            has it — a social poster's headline is written into a multi-field copy object and
            has no single line to lock. Left blank (the normal case) the run reads the योजना /
            पुरस्कार / उपक्रम name out of the note itself. */}
        {!isSocial ? (
          <div className="option-field">
            <label className="field-label" htmlFor="poster-heading">
              {STR.posterHeadingLabel}
            </label>
            <p className="hint">{STR.posterHeadingHint}</p>
            <input
              id="poster-heading"
              type="text"
              maxLength={POSTER_HEADING_MAX_CHARS}
              placeholder={STR.posterHeadingPlaceholder}
              value={posterHeading}
              onChange={(e) => setPosterHeading(e.target.value)}
              style={{ marginTop: 10 }}
            />
          </div>
        ) : null}
        {/* A caption-only run can never be published from the app — both X and the
            Facebook Page endpoint need the poster — so say so before the run, not after. */}
        {captionOnly ? (
          <p className="info-callout">{STR.mediaCaptionOnlyInfo}</p>
        ) : null}
        {hasActiveSocialTask ? (
          <p className="info-callout">{STR.socialBusyInfo}</p>
        ) : null}
        {hasActiveArticleTask ? (
          <p className="info-callout">{STR.articleBusyInfo}</p>
        ) : null}
      </section>

      {/* विभाग and रचना-शैली are poster questions; a कॅप्शन run has no template at all. */}
      {isSocial && !captionOnly ? (
        <>
          <section className="card">
            <h2>{STR.brandLabel}</h2>
            <div className="output-picker output-picker-two">
              {BRAND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="output-option"
                  aria-pressed={templateBrand === option.value}
                  onClick={() => setTemplateBrand(option.value)}
                >
                  <span className="icon" aria-hidden="true">
                    <option.icon size={30} strokeWidth={1.75} />
                  </span>
                  <span className="name">{option.name}</span>
                  <span className="desc">{option.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* CMO just follows its fixed template, so the रचना-शैली modes only apply
              to DGIPR social posts. */}
          {!isCmo ? (
            <section className="card">
              <h2>{STR.designModeLabel}</h2>
              <div className="output-picker">
                {DESIGN_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="output-option"
                    aria-pressed={designMode === option.value}
                    onClick={() => setDesignMode(option.value)}
                  >
                    <span className="icon" aria-hidden="true">
                      <option.icon size={30} strokeWidth={1.75} />
                    </span>
                    <span className="name">{option.name}</span>
                    <span className="desc">{option.desc}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {pickerCategory ? (
        // Keyed by category+brand so switching either remounts the picker: the reset
        // effect above clears the pin, and the remount drops the child's stale manual
        // mode (which would otherwise still show the previous library).
        <ReferencePicker
          key={`${pickerCategory}-${pickerBrand}`}
          category={pickerCategory}
          brand={pickerBrand}
          value={reference}
          onChange={setReference}
        />
      ) : null}

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void startSubmit()}
            disabled={submitting || awaitingRead}
          >
            {awaitingRead
              ? STR.docReadingForSubmit
              : submitting
                ? STR.submitting
                : STR.submit}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </main>
  );
}
