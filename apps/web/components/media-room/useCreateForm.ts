'use client';

/**
 * All of the create form's state and its one submit path, in one hook.
 *
 * The page below it is markup: every rule about what a lane sends, what a lane
 * hides, and when a submit may be refused lives here, so a control and the request
 * it produces cannot drift apart. The lane predicates (`isSocial`, `isArticle`,
 * `isCaption`, `fromArticle`) are DERIVED from the chosen format on every render —
 * none of them is stored, which is what makes it impossible for two controls to
 * disagree about which lane the run is on.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IMAGE_PROMPT_MAX_CHARS,
  POSTER_HEADING_MAX_CHARS,
  POSTER_TEXT_MIN_CHARS,
  isArticleCategory,
  isSocialCategory,
  referenceCategoryOf,
} from '@dgipr/schemas';
import type { DesignMode } from '@dgipr/schemas';
import { createGeneration, getGeneration } from '@/lib/api';
import { useTasks } from '@/lib/TasksProvider';
import { STR } from '@/lib/strings';
import { errorMessage } from '@/lib/errorMessage';
import type {
  DocumentIntakeInfo,
  DocumentIntakeStatus,
} from '@/components/DocumentIntake';
import type { ReferenceSelection } from '@/components/ReferencePicker';
import {
  DEFAULT_FORMAT,
  selectableFormatOf,
  submitCategoryOf,
  type SelectableFormat,
} from './formats';

/**
 * Where the upload card remembers its in-flight job across a refresh. The form also
 * clears it by hand after a submit (see clearDocument), so it is named once.
 */
export const DOC_STORAGE_KEY = 'dgipr.mediaRoom.document';

export type PrefillState = 'none' | 'loading' | 'applied' | 'failed';

export function useCreateForm() {
  const router = useRouter();
  const { addTask, hasActiveSocialTask, hasActiveArticleTask } = useTasks();

  const [note, setNote] = useState('');
  // The uploaded file's text, kept BESIDE the textarea rather than pushed into it: the
  // two are independent sources and either one alone is a complete note. It used to be
  // appended on a button click inside the upload card, which meant an officer who
  // uploaded a PDF and pressed the submit was told to write a longer note while their
  // document sat there unused.
  const [docText, setDocText] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentIntakeStatus>('empty');
  // Which file is attached, for the card in the attachment strip above the upload block.
  // Reported beside the status rather than taken off the snapshot, because the snapshot is
  // null until there is text — and a card that appears only once a minutes-long OCR has
  // finished is a card that is missing for exactly the wait it exists to explain.
  const [docInfo, setDocInfo] = useState<DocumentIntakeInfo | null>(null);
  // The upload card is folded behind the [+] button. Opened by hand, and never closed
  // automatically once a file is attached — see NoteComposer.
  const [docOpen, setDocOpen] = useState(false);
  const [readRequest, setReadRequest] = useState(0);
  const [awaitingRead, setAwaitingRead] = useState(false);
  const readRequestedForSubmitRef = useRef(false);
  // Remounts the upload card to drop a finished document (its own state is internal).
  const [docKey, setDocKey] = useState(0);

  // The chosen format IS the category — one flat picker, no derivation.
  const [format, setFormat] = useState<SelectableFormat>(DEFAULT_FORMAT);

  // Creative only: WHERE THE POSTER'S WORDS COME FROM. Independent of the template
  // question — 'ai' has generatePosterCopy read the box as source material and write
  // the poster's headline + points out of it; 'verbatim' prints exactly what is in the
  // box, unchanged. 'ai' is the default: most officers paste an article or a set of
  // notes and want a poster made out of it.
  //
  // Held across a format switch on purpose: it is a preference about this officer's own
  // material, and the value is simply not sent on a lane that ignores it.
  const [contentSource, setContentSource] = useState<'ai' | 'verbatim'>('ai');
  // A social post is poster-only unless asked otherwise: the caption is a separate paid
  // model call, and plenty of posts are published as an image. It can also be added
  // afterwards from the detail page, so off is a cheap default rather than a lossy one.
  const [wantCaption, setWantCaption] = useState(false);
  // Creative only: the officer's OWN prompt for the image model (migration 0045).
  // Blank (the default and the overwhelmingly common case) leaves the platform's built
  // poster prompt in place; filled, it REPLACES it.
  const [imagePrompt, setImagePrompt] = useState('');
  // Banner runs only: the exact line to print on the poster. Blank (the default) leaves
  // it to the automatic named-subject resolution.
  const [posterHeading, setPosterHeading] = useState('');
  const [reference, setReference] = useState<ReferenceSelection | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arriving from a finished run's "same note, other platform" link (?from=<id>).
  const [prefill, setPrefill] = useState<PrefillState>('none');
  const prefillStartedRef = useRef(false);

  // Read the handoff off the URL rather than through useSearchParams: this page is a
  // client component with no other need for the hook, and useSearchParams would drag a
  // Suspense boundary in for a fill that is inherently client-side anyway.
  //
  // The ref is what makes this run exactly ONCE, and it deliberately has no cleanup that
  // cancels the in-flight fetch. Strict Mode mounts twice (mount then cleanup then
  // mount): a cancel-on-cleanup would abandon the first pass's result while the ref
  // makes the second pass return early, so the form would sit on the loading line
  // forever. Running once also means a fill can never land on top of something the
  // officer has since typed.
  useEffect(() => {
    if (prefillStartedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    if (!from) return;
    prefillStartedRef.current = true;

    // The format is applied immediately: it is in the URL, so it needs no fetch, and
    // showing the right answer while the note loads makes the wait self-explanatory.
    const target = selectableFormatOf(params.get('format'));
    if (target) setFormat(target);

    setPrefill('loading');
    void (async () => {
      try {
        const detail = await getGeneration(from);
        // The source run's note, which for a run created here already CONTAINS any
        // uploaded file's text (this form joins the two at submit), so nothing is lost
        // by arriving as text in the box rather than as a document card.
        setNote(detail.note);
        setPrefill('applied');
      } catch {
        setPrefill('failed');
      }
    })();
  }, []);

  // The caption-only lane. Tested FIRST and excluded from every flag below it, because
  // it is a social run by category and would otherwise inherit the whole poster form —
  // the template picker, the verbatim checkbox and the AI prompt box, none of which can
  // affect a run that paints nothing.
  const isCaption = format === 'caption';
  const submitCategory = submitCategoryOf(format);
  // The Creative lane (submitted as 'twitter'). Still asked through isSocialCategory so
  // a ?format=facebook handoff, and any future second social entry, behave identically.
  const isSocial = !isCaption && isSocialCategory(format);
  // The Banner lane. Asked positively rather than as !isSocial, which silently swept the
  // YouTube thumbnail in with it — a thumbnail writes no article and locks no poster
  // heading.
  const isArticle = !isCaption && isArticleCategory(format);
  // Has the officer explicitly chosen a template? This is the ONLY design question on
  // the Creative lane: no template means a fully-AI poster, a template means that
  // template is followed. There is no separate "design mode" control.
  const templatePicked = isSocial && reference !== null;

  // What actually goes on the wire. DERIVED, never stored — the officer answers two
  // INDEPENDENT questions and the mode is the cell they land on:
  //
  //                   | contentSource 'ai'  | contentSource 'verbatim'
  //   ----------------+---------------------+--------------------------
  //   no template     | 'fresh'             | 'fresh_verbatim'
  //   a template      | 'adaptive'          | 'onbrand'
  //
  // No template is the DEFAULT design (the API resolves no reference at all and the
  // image model designs the whole poster), because the previous default ('onbrand' over
  // an auto-selected template) gave every poster the shape of whatever the library
  // happened to return — twelve cramped numbered rows out of a 5,600-character note
  // (generation 63511b51).
  const verbatimText = contentSource === 'verbatim';
  const designMode: DesignMode = templatePicked
    ? verbatimText
      ? 'onbrand'
      : 'adaptive'
    : verbatimText
      ? 'fresh_verbatim'
      : 'fresh';

  // Does the box hold SOURCE MATERIAL the poster's copy is written out of, rather than
  // the poster's own words? That is the 'ai' answer, on either design lane — and it
  // changes what the box's label, hint and placeholder promise.
  //
  // SCOPED TO isSocial deliberately. contentSource is a Creative control and defaults
  // to 'ai', so an unscoped test would silently re-label the Banner and YouTube
  // thumbnail boxes, whose wording is not this checkbox's to change.
  // ...and TRUE on the caption lane unconditionally: the box there is source material by
  // definition — the caption is written out of it and nothing in it is printed anywhere.
  const fromArticle = (isSocial && !verbatimText) || isCaption;

  // Which library the template picker shows: twitter masters for the social format,
  // article masters for Banner, youtube masters for the thumbnail.
  // ('caption' is not a Category and renders no poster, so the picker is not shown there
  // at all; the substitution only keeps this expression total.)
  const pickerCategory = referenceCategoryOf(submitCategory);

  // A pin is only meaningful for the format it was chosen under.
  useEffect(() => {
    setReference(null);
  }, [format]);

  // Once a file IS attached, the upload block folds away on its own and its card in the
  // attachment strip takes over — reading progress, page count, remove. That is the whole
  // point of the strip: the block is a page list, and a page list nobody asked to see
  // pushes the officer's own text box off a phone screen.
  //
  // Only on the TRANSITION into a read, so re-opening the block from the card leaves it
  // open. A scan waiting for its page selection, or a failed read, is exempt — NoteComposer
  // keeps that block on screen regardless, because it is asking a question.
  const docReadStartedRef = useRef(false);
  useEffect(() => {
    const reading = docStatus === 'reading' || docStatus === 'ready';
    if (reading && !docReadStartedRef.current) setDocOpen(false);
    docReadStartedRef.current = reading;
  }, [docStatus]);

  // What actually gets generated from: typed text, uploaded file, or both, in that
  // order. Blank-line separated so a pasted lead and an attached GR read as two blocks.
  const combinedNote = useMemo(
    () => [note.trim(), docText.trim()].filter(Boolean).join('\n\n'),
    [note, docText],
  );

  // Is there anything to generate FROM? The same rule submit() enforces, applied to the
  // control instead of to the press — a submit that can only be refused should not look
  // available.
  //
  // The `unread` arm is what keeps a scanned PDF usable: its pages are ticked but nobody
  // has paid to read them yet, so it contributes no text to combinedNote, and reading it
  // and then submitting is exactly what startSubmit does. Testing the text alone would
  // leave an officer whose only source is a scan with a dead button and no way forward.
  const canSubmit =
    combinedNote.length >= POSTER_TEXT_MIN_CHARS || docStatus === 'unread';
  const submitBusy = submitting || awaitingRead;
  const submitLabel = awaitingRead
    ? STR.docReadingForSubmit
    : submitting
      ? STR.submitting
      : STR.submit;

  // Drop the attached document. A remount is what clears the card's internal state, and
  // the stored job id has to go with it or the mount effect would re-attach the same
  // file.
  const clearDocument = () => {
    window.sessionStorage.removeItem(DOC_STORAGE_KEY);
    setDocText('');
    // The remount reports 'empty' with no file on its own, but not until it has mounted —
    // and until then the strip would still be showing a card for a document that is gone.
    setDocInfo(null);
    setDocStatus('empty');
    setDocKey((n) => n + 1);
  };

  const submit = async () => {
    // The box holds the poster's own text now, which can legitimately be a few
    // characters — the old 20-character article minimum would have refused it.
    // POSTER_TEXT_MIN_CHARS is shared with the API's schema, so the two cannot drift.
    if (combinedNote.length < POSTER_TEXT_MIN_CHARS) {
      setError(STR.posterTextTooShort);
      return;
    }
    if (isArticle && posterHeading.trim().length > POSTER_HEADING_MAX_CHARS) {
      setError(STR.posterHeadingTooLong);
      return;
    }
    if (isSocial && imagePrompt.trim().length > IMAGE_PROMPT_MAX_CHARS) {
      setError(STR.imagePromptTooLong);
      return;
    }
    // Both social lanes take the social gate — a caption-only run is short and paints
    // nothing, but TasksProvider deliberately keeps one social task at a time rather
    // than carving out an exception for it.
    if (isSocial || isCaption) {
      if (hasActiveSocialTask) {
        setError(STR.busyError);
        return;
      }
    } else if (hasActiveArticleTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        note: combinedNote,
        category: submitCategory,
        // 'article' means "this run renders NO poster" on both lanes — the caption-only
        // entry. Every other format here renders one.
        outputType: isCaption ? 'article' : 'poster',
        // The Banner path uses the pasted article verbatim (skip generateArticle); inert
        // for social, whose caption is always written fresh.
        providedArticle: isArticle,
        // Social only. Opt-in beside a poster (the checkbox); MANDATORY on the
        // caption-only lane, where the caption is the run's entire output — the API
        // rejects a caption-only request that does not ask for one, since it would be a
        // request for nothing at all.
        generateCaption: isCaption ? true : isSocial ? wantCaption : undefined,
        // Banner only, and only when actually typed — an empty string would be a
        // meaningless "clear" on a run that has nothing to clear.
        posterHeading:
          isArticle && posterHeading.trim() ? posterHeading.trim() : undefined,
        // The template-brand question stays fixed (always the DGIPR family); designMode
        // is derived from the template pick above, so it is 'fresh' unless the officer
        // chose a template. The reference ids below are null in that case by
        // construction — designMode and the pin can never disagree, because one is
        // computed from the other.
        designMode: isSocial ? designMode : undefined,
        templateBrand: isSocial ? 'dgipr' : undefined,
        // The officer's own image prompt (migration 0045) — Creative only, and only
        // when actually typed. Sent trimmed, because it is stored on the row and read
        // back verbatim by every later render of this poster.
        imagePrompt:
          isSocial && imagePrompt.trim() ? imagePrompt.trim() : undefined,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
      });
      // Every format opens its own progress page. Keep tracking the run so the navbar
      // tasks panel still offers a shortcut, but do not open that panel automatically.
      // The document has been consumed and must not be re-attached to the next
      // generation.
      clearDocument();
      addTask(id);
      router.push(`/generations/${id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };

  // Press the submit and the run starts immediately. A scanned PDF whose pages are
  // ticked but unread is read first, and the submit resumes from the effect below once
  // its text lands.
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

  // Choosing a format resets nothing the officer typed — only the pin, above, which is
  // library-specific. The upload card stays open if it was opened.
  const chooseFormat = (next: SelectableFormat) => {
    setFormat(next);
    setError(null);
  };

  return {
    // text + document
    note,
    setNote,
    docKey,
    docOpen,
    setDocOpen,
    docStatus,
    docInfo,
    // One setter for the pair, so a status can never be recorded against the previous
    // file's name.
    setDocState: (
      status: DocumentIntakeStatus,
      info: DocumentIntakeInfo | null,
    ) => {
      setDocStatus(status);
      setDocInfo(info);
    },
    setDocText,
    readRequest,
    clearDocument,

    // format + lane predicates
    format,
    chooseFormat,
    isSocial,
    isArticle,
    isCaption,
    fromArticle,
    pickerCategory,

    // Creative options
    verbatimText,
    setContentSource,
    wantCaption,
    setWantCaption,
    imagePrompt,
    setImagePrompt,

    // Banner option
    posterHeading,
    setPosterHeading,

    // template
    reference,
    setReference,

    // submit
    submitting,
    submitBusy,
    submitLabel,
    canSubmit,
    startSubmit,
    error,
    setError,
    prefill,

    // busy gates
    hasActiveSocialTask,
    hasActiveArticleTask,
    router,
  };
}
