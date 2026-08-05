'use client';

// Creative and Social page: paste a FINISHED article, then turn it into a poster
// (for the article itself, or one social poster for X/Facebook) or into a caption alone. No
// article is written here — the pasted text is the sole source and is used as-is
// (providedArticle) for the poster path.
//
// The क्रिएटिव्ह lane asks ONE more question, as tabs above the text box: is the pasted text
// the poster's own words, or an article to draw them out of? That is `designMode` —
// 'onbrand' sends the note verbatim to the image-edit model (isSimpleTemplateEdit in the
// runner), 'adaptive' runs generatePosterCopy first. बॅनर and यूट्यूब ignore designMode, so
// the tabs are shown for the social lane only.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clapperboard,
  ClipboardPaste,
  Image as ImageIcon,
  MonitorPlay,
  Sparkles,
  Type,
} from 'lucide-react';
import {
  POSTER_HEADING_MAX_CHARS,
  POSTER_TEXT_MIN_CHARS,
  UPLOAD_FILE_MAX_BYTES,
  isArticleCategory,
  isSocialCategory,
  referenceCategoryOf,
} from '@dgipr/schemas';
import type { Category, DesignMode } from '@dgipr/schemas';
import { createGeneration, getGeneration } from '../lib/api';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import {
  DocumentIntake,
  type DocumentIntakeStatus,
} from '../components/DocumentIntake';
import ReferencePicker, {
  type ReferenceSelection,
} from '../components/ReferencePicker';
import { SocialLogoStack } from '../components/SocialLogoStack';
import { CardTitle } from '../components/CardTitle';

// ONE flat row of formats. The two-level पोस्टर/कॅप्शन picker it replaces asked a question
// officers were not making a decision about — a caption is an ADD-ON to a social post, so
// it is a checkbox under those two cards rather than a lane of its own. Built locally so
// the shared CATEGORY_OPTIONS (reused by the detail page's next-step panel and /dlo) is
// left untouched.
//
// Every value except 'video' IS a Category value, so the request needs no mapping table.
// 'video' is a shortcut to /video, which runs its own two-gate flow and cannot be submitted
// from here.
type Format = Category | 'video';

type FormatIcon = ComponentType<{
  size?: number;
  strokeWidth?: number;
}>;

const FORMATS = [
  {
    value: 'youtube',
    icon: MonitorPlay,
    name: STR.mediaFormatYoutube,
    desc: STR.mediaFormatYoutubeDesc,
  },
  // ONE social card. ट्विटर पोस्ट and फेसबुक पोस्ट were two cards producing the identical
  // poster: both are social categories, so both take the ठरलेले टेम्पलेट path
  // (isSimpleTemplateEdit in the runner keys off isSocialCategory), the same twitter master
  // library (referenceCategoryOf), the same chrome and the same image tier. It submits
  // 'twitter' — the X on-brand lane — which is also what makes the published post go to X.
  // Facebook remains a real category everywhere else (history, the detail page's
  // cross-format fold, /dlo); it is only this picker that stops asking.
  //
  // Its icon is the three-mark stack rather than X alone: one X read as "this makes a
  // tweet", when the poster it produces is used on all three. Instagram is shown as a
  // destination only — nothing publishes to it (see SocialLogoStack).
  {
    value: 'twitter',
    icon: SocialLogoStack,
    name: STR.mediaFormatCreative,
    desc: STR.mediaFormatCreativeDesc,
  },
  {
    value: 'scheme',
    icon: ImageIcon,
    name: 'बॅनर',
    desc: STR.mediaFormatArticlePosterDesc,
  },
  {
    value: 'video',
    icon: Clapperboard,
    name: STR.mediaOutputVideo,
    desc: STR.mediaOutputVideoDesc,
  },
] as const satisfies ReadonlyArray<{
  value: Format;
  icon: FormatIcon;
  name: string;
  desc: string;
}>;

// What the picker can actually leave selected. 'video' navigates away on click, so it is
// never held in state.
type SelectableFormat = Extract<Format, 'twitter' | 'scheme' | 'youtube'>;

// Where the upload card remembers its in-flight job across a refresh. The page also clears
// it by hand after a submit (see clearDocument), so it is named once.
const DOC_STORAGE_KEY = 'dgipr.mediaRoom.document';

// Only the formats this picker can actually leave selected are honoured as a ?format=
// target, so a stale or hand-typed link can never put the form into a state the picker
// cannot show.
function selectableFormatOf(value: string | null): SelectableFormat | null {
  // ?format=facebook still arrives from a finished Facebook run's cross-format link, and
  // the picker no longer has a card for it — it folds into the one क्रिएटिव्ह card, which
  // renders the same poster.
  if (value === 'facebook') return 'twitter';
  return value === 'twitter' || value === 'scheme' || value === 'youtube'
    ? value
    : null;
}

export default function NewGenerationPage() {
  const router = useRouter();
  const { addTask, hasActiveSocialTask, hasActiveArticleTask } = useTasks();
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
  // The chosen format IS the category — one flat picker, no derivation. ट्विटर पोस्ट is the
  // default because it is by far the most-used format on this page.
  const [category, setCategory] = useState<SelectableFormat>('twitter');
  // क्रिएटिव्ह only: what the pasted text IS. 'onbrand' (the default, and what this form used
  // to hardcode) prints it verbatim; 'adaptive' treats it as an article and has
  // generatePosterCopy write the poster's headline + points out of it. Held across a format
  // switch on purpose — it is a preference about this officer's own material, and the value
  // is simply not sent on a lane that ignores it.
  const [designMode, setDesignMode] = useState<DesignMode>('onbrand');
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
  // Arriving from a finished run's "same note, other platform" link (?from=<id>).
  const [prefill, setPrefill] = useState<
    'none' | 'loading' | 'applied' | 'failed'
  >('none');
  const prefillStartedRef = useRef(false);

  // Read the handoff off the URL rather than through useSearchParams: this page is a
  // client component with no other need for the hook, and useSearchParams would drag a
  // Suspense boundary in for a fill that is inherently client-side anyway.
  //
  // The ref is what makes this run exactly ONCE, and it deliberately has no cleanup
  // that cancels the in-flight fetch. Strict Mode mounts twice (mount → cleanup →
  // mount): a cancel-on-cleanup would abandon the first pass's result while the ref
  // makes the second pass return early, so the form would sit on "आणली जात आहे…"
  // forever — which is exactly what it did before this comment existed. Running once
  // also means a fill can never land on top of something the officer has since typed.
  useEffect(() => {
    if (prefillStartedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    if (!from) return;
    prefillStartedRef.current = true;

    // The format is applied immediately: it is in the URL, so it needs no fetch, and
    // showing the right card while the note loads makes the wait self-explanatory.
    const format = selectableFormatOf(params.get('format'));
    if (format) setCategory(format);

    setPrefill('loading');
    void (async () => {
      try {
        const detail = await getGeneration(from);
        // The source run's note, which for a run created here already CONTAINS any
        // uploaded file's text (the media room joins the two at submit), so nothing is
        // lost by arriving as text in the box rather than as a document card.
        setNote(detail.note);
        setPrefill('applied');
      } catch {
        setPrefill('failed');
      }
    })();
  }, []);

  // The क्रिएटिव्ह lane (submitted as 'twitter'). Still asked through isSocialCategory so a
  // ?format=facebook handoff, and any future second social card, behave identically.
  const isSocial = isSocialCategory(category);
  // The लेख पोस्टर lane. Asked positively rather than as !isSocial, which silently swept
  // यूट्यूब थंबनेल in with it — a thumbnail writes no article and locks no poster heading.
  const isArticle = isArticleCategory(category);
  // The क्रिएटिव्ह tab that changes what the text box holds: a finished article the poster's
  // copy is written OUT of, rather than the poster's own words. Only ever true on the social
  // lane, which is the only one whose runner branch reads designMode.
  const fromArticle = isSocial && designMode === 'adaptive';

  // Which library the template picker shows: twitter masters for the two social formats,
  // article masters for the लेख पोस्टर, youtube masters for the थंबनेल. Every format on this
  // page renders an image, so it is never hidden. रचना-शैली and विभाग are gone from this
  // form — a social post here is always the DGIPR 'onbrand' template, which is what makes
  // the pinned reference the only template question left to ask.
  const pickerCategory = referenceCategoryOf(category);

  // A pin is only meaningful for the format it was chosen under.
  useEffect(() => {
    setReference(null);
  }, [category]);

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
    // The box holds the poster's own text now, which can legitimately be a few characters
    // ('भारत टॅक्सी' is 11) — the old 20-character article minimum would have refused it.
    // POSTER_TEXT_MIN_CHARS is shared with the API's schema, so the two cannot drift.
    if (combinedNote.length < POSTER_TEXT_MIN_CHARS) {
      setError(STR.posterTextTooShort);
      return;
    }
    if (isArticle && posterHeading.trim().length > POSTER_HEADING_MAX_CHARS) {
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
        // Every format on this page renders a poster. (The caption-only lane, which sent
        // outputType 'article' on a social run, has been dropped from this form; the API,
        // the runner and the detail page still support it.)
        outputType: 'poster',
        // The लेख पोस्टर path uses the pasted article verbatim (skip generateArticle);
        // inert for social, whose caption is always written fresh.
        providedArticle: isArticle,
        // Social only, and opt-in: the caption is a second paid call and can be added
        // afterwards from the detail page.
        generateCaption: isSocial ? wantCaption : undefined,
        // लेख पोस्टर only, and only when actually typed — an empty string would be a
        // meaningless "clear" on a run that has nothing to clear.
        posterHeading:
          isArticle && posterHeading.trim() ? posterHeading.trim() : undefined,
        // The विभाग question stays fixed (always the DGIPR template family); the design
        // mode is the tab above the text box — 'onbrand' prints the note verbatim,
        // 'adaptive' writes the poster's copy out of it first.
        designMode: isSocial ? designMode : undefined,
        templateBrand: isSocial ? 'dgipr' : undefined,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
      });
      // Every format now opens its own progress page. Keep tracking the run so the navbar
      // tasks panel still offers a shortcut, but do not open that panel automatically.
      // The document has been consumed and must not be re-attached to the next generation.
      clearDocument();
      addTask(id);
      router.push(`/generations/${id}`);
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
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.mediaRoomTitle}</h1>
          <p className="page-sub">{STR.mediaRoomIntro}</p>
        </div>
      </header>

      {/* The submit sits ABOVE the form, not under it. The card below is a long
          textarea followed by an upload card and the format cards, so a button at the
          bottom is off-screen for most of the time anyone spends on this page — and this
          form is filled in one pass, then submitted, rather than reviewed downward. The
          error line stays with it so a refusal (too short, another run in flight) is
          reported where the action was taken. */}
      <section className="card card-action">
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

      <section className="card">
        {/* क्रिएटिव्ह only — it is the one lane where both paths exist. बॅनर keeps the pasted
            text as the article and picks the heading out of it; यूट्यूब थंबनेल prints it. Both
            ignore designMode, so offering the tabs there would be an inert control. */}
        {isSocial ? (
          <>
            <p className="field-label">{STR.posterSourceLabel}</p>
            <div className="segmented" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="output-option"
                aria-pressed={designMode === 'onbrand'}
                disabled={submitting}
                onClick={() => setDesignMode('onbrand')}
              >
                <span className="name">{STR.posterSourceVerbatim}</span>
                <span className="desc">{STR.posterSourceVerbatimDesc}</span>
              </button>
              <button
                type="button"
                className="output-option"
                aria-pressed={designMode === 'adaptive'}
                disabled={submitting}
                onClick={() => setDesignMode('adaptive')}
              >
                <span className="name">{STR.posterSourceArticle}</span>
                <span className="desc">{STR.posterSourceArticleDesc}</span>
              </button>
            </div>
          </>
        ) : null}
        <label className="field-label" htmlFor="note">
          <ClipboardPaste size={18} className="label-icon" aria-hidden="true" />
          {fromArticle ? STR.articleSourceLabel : STR.articlePasteLabel}
        </label>
        <p className="hint">
          {fromArticle ? STR.articleSourceHint : STR.articlePasteHint}
        </p>
        {/* Handoff from a finished run's cross-format link. The failure is stated rather
            than silent — an empty box with no explanation reads as the link not working. */}
        {prefill === 'loading' ? (
          <p className="hint" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> {STR.prefillLoading}
          </p>
        ) : prefill === 'applied' ? (
          <p className="form-success">{STR.prefillApplied}</p>
        ) : prefill === 'failed' ? (
          <p className="form-error">{STR.prefillFailed}</p>
        ) : null}
        <textarea
          id="note"
          className="note-input"
          placeholder={
            fromArticle
              ? STR.articleSourcePlaceholder
              : STR.articlePastePlaceholder
          }
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
        // Names this surface so a paid OCR read lands on this feature's service card
        // rather than being counted in the bill and attributed to nobody.
        feature="social"
        maxBytes={UPLOAD_FILE_MAX_BYTES}
        onTextChange={(text) => {
          setDocText(text);
          if (text.trim()) setError(null);
        }}
        onStatusChange={setDocStatus}
        readRequest={readRequest}
      />

      <section className="card">
        <CardTitle icon={Sparkles}>{STR.mediaOutputLabel}</CardTitle>
        <div className="output-picker output-picker-flow">
          {FORMATS.map((option) => {
            // व्हिडिओ is a shortcut, not a format this form can submit — /video runs its
            // own two-gate flow.
            const isLink = option.value === 'video';
            // One active task per lane: the क्रिएटिव्ह card is gated by an in-flight
            // social run (one n8n workflow, serial renders), लेख पोस्टर and यूट्यूब थंबनेल by an
            // in-flight article-lane run. A selected card that becomes disabled is left
            // selected — submit() re-checks both flags, and moving the choice under the
            // cursor would be worse.
            const busy =
              !isLink &&
              (isSocialCategory(option.value)
                ? hasActiveSocialTask
                : hasActiveArticleTask);
            return (
              <button
                key={option.value}
                type="button"
                className="output-option"
                aria-pressed={!isLink && category === option.value}
                disabled={busy}
                onClick={() => {
                  if (isLink) router.push('/video');
                  else setCategory(option.value as SelectableFormat);
                }}
              >
                <span className="icon" aria-hidden="true">
                  <option.icon size={30} strokeWidth={1.75} />
                </span>
                <span className="name">{option.name}</span>
                <span className="desc">{option.desc}</span>
              </button>
            );
          })}
        </div>
        {/* Sits with the format cards, not in its own section: "a post with a caption"
            is part of choosing what to make. Social formats only — a लेख पोस्टर has no
            caption to write. */}
        {isSocial ? (
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
        {/* The लेख पोस्टर twin of the caption toggle, in the same card for the same reason:
            what the poster SAYS is part of choosing what to make. Social posters do not have
            it — their headline is written into a multi-field copy object with no single line
            to lock. Left blank (the normal case) the run reads the योजना / पुरस्कार / उपक्रम
            name out of the note itself. */}
        {isArticle ? (
          <div className="option-field">
            <label className="field-label" htmlFor="poster-heading">
              <Type size={18} className="label-icon" aria-hidden="true" />
              {STR.posterHeadingLabel}
            </label>
            <p className="hint">{STR.posterHeadingCreateHint}</p>
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
        {/* The optional template pin, folded shut. In the same card as the format cards
            because it only qualifies the choice made there — and keyed by category so
            switching format remounts it against the right library. */}
        <div className="option-field option-field-flush">
          <ReferencePicker
            key={pickerCategory}
            category={pickerCategory}
            brand="dgipr"
            variant="disclosure"
            value={reference}
            onChange={setReference}
          />
        </div>
        {hasActiveSocialTask ? (
          <p className="info-callout">{STR.socialBusyInfo}</p>
        ) : null}
        {hasActiveArticleTask ? (
          <p className="info-callout">{STR.articleBusyInfo}</p>
        ) : null}
      </section>
    </main>
  );
}
