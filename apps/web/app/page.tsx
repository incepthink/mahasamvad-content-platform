'use client';

// Media-room page: paste a FINISHED article, then turn it into a poster, a
// Facebook post, or a Twitter post. No article is written here — the pasted text
// is the sole source and is used as-is (providedArticle) for the poster path.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bird, Image as ImageIcon, ThumbsUp } from 'lucide-react';
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
import { DocumentIntake } from '../components/DocumentIntake';
import ReferencePicker, {
  type ReferenceSelection,
} from '../components/ReferencePicker';

// The three outputs this page offers. "पोस्टर" runs the article-poster path
// (category 'scheme') on the pasted article verbatim; the other two are the
// existing social lanes. Built locally so the shared CATEGORY_OPTIONS (reused by
// the detail-page "next step" panel) is left untouched.
const OUTPUT_CHOICES = [
  {
    value: 'scheme',
    icon: ImageIcon,
    name: STR.categoryPoster,
    desc: STR.categoryPosterDesc,
  },
  {
    value: 'twitter',
    icon: Bird,
    name: STR.categoryTwitter,
    desc: STR.categoryTwitterDesc,
  },
  {
    value: 'facebook',
    icon: ThumbsUp,
    name: STR.categoryFacebook,
    desc: STR.categoryFacebookDesc,
  },
] as const satisfies ReadonlyArray<{
  value: Category;
  icon: typeof ImageIcon;
  name: string;
  desc: string;
}>;

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
  // Remounts the upload card to drop a finished document (its own state is internal).
  const [docKey, setDocKey] = useState(0);
  const [category, setCategory] = useState<Category>('scheme');
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

  // ट्विटर and फेसबुक are one lane: same n8n workflow, same design modes, same
  // master library — only the recorded category differs.
  const isSocial = isSocialCategory(category);
  // CMO just follows its fixed template, so it needs no रचना-शैली (design mode) —
  // that selector is hidden and the CMO template library is shown instead.
  const isCmo = isSocial && templateBrand === 'cmo';

  // Which library the template picker shows: twitter masters for the social flows
  // (except 'fresh' — no master is edited; CMO always edits a master), article
  // masters for the पोस्टर path (which always renders a poster). null hides it.
  const pickerCategory: 'twitter' | 'article' | null = isSocial
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

  // विभाग is a social-only concept; snap it back to DGIPR whenever the run is not a
  // social post, so switching category can never leave a stray CMO brand set.
  useEffect(() => {
    if (!isSocial) setTemplateBrand('dgipr');
  }, [isSocial]);

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
        // Always a poster here (the runner ignores outputType for social).
        outputType: 'poster',
        // The पोस्टर path uses the pasted article verbatim (skip generateArticle);
        // inert for social, whose caption is always written fresh by n8n.
        providedArticle: !isSocial,
        // Social only: the caption is opt-in (see wantCaption above). Absent on the
        // पोस्टर path, where the pasted article already IS the text.
        generateCaption: isSocial ? wantCaption : undefined,
        // पोस्टर only, and only when actually typed — an empty string would be a
        // meaningless "clear" on a run that has nothing to clear.
        posterHeading:
          !isSocial && posterHeading.trim() ? posterHeading.trim() : undefined,
        designMode: isSocial ? designMode : undefined,
        templateBrand: isSocial ? templateBrand : undefined,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
      });
      if (isSocial) {
        // Background task: don't navigate. Track it, open the panel, reset the form
        // to the poster default so the now-disabled social cards read clearly.
        addTask(id);
        openPanel();
        setNote('');
        clearDocument();
        setCategory('scheme');
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
      />

      <section className="card">
        <h2>{STR.mediaOutputLabel}</h2>
        <div className="output-picker">
          {OUTPUT_CHOICES.map((option) => {
            // v1 allows one active task per lane at a time: the ट्विटर/फेसबुक cards
            // are gated by an in-flight social run (they share one n8n workflow),
            // the पोस्टर card by an in-flight article run (the lanes don't block
            // each other).
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
                onClick={() => setCategory(option.value)}
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
            is part of choosing what to make, and it only exists for the social lanes. */}
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
        {hasActiveSocialTask ? (
          <p className="info-callout">{STR.socialBusyInfo}</p>
        ) : null}
        {hasActiveArticleTask ? (
          <p className="info-callout">{STR.articleBusyInfo}</p>
        ) : null}
      </section>

      {isSocial ? (
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
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? STR.submitting : STR.submit}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </main>
  );
}
