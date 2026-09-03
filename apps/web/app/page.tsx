'use client';

// Creative and Social page: paste a FINISHED article, then turn it into a poster
// (for the article itself, or one social poster for X/Facebook) or into a caption alone. No
// article is written here — the pasted text is the sole source and is used as-is
// (providedArticle) for the poster path.
//
// On the क्रिएटिव्ह lane the officer answers TWO INDEPENDENT questions, and `designMode` is
// DERIVED from the pair rather than stored — which is what makes it impossible for the mode and
// the pin to disagree:
//
//   DESIGN  — the template picker. Empty (the default) means the API resolves no reference at all
//             and the image model designs the whole poster; pick one and the poster follows it.
//   CONTENT — the "जसाच्या तसा मजकूर" checkbox under the text box. Unticked (the default) has
//             generatePosterCopy read the box as source material and write the poster's words out
//             of it; ticked prints exactly what is in the box, unchanged.
//
//                   | content 'ai' | content 'verbatim'
//   ----------------+--------------+--------------------
//   no template     | 'fresh'      | 'fresh_verbatim'
//   a template      | 'adaptive'   | 'onbrand'
//
// The content question used to be a pair of tabs ABOVE the text box, and before that was shown
// only once a template was picked, because 'verbatim' had no from-scratch counterpart — so on the
// default (no-template) path the officer could not ask for their exact text at all.
// 'fresh_verbatim' is that counterpart.
//
// The old design default was 'onbrand' over an auto-selected template, so every poster took the
// shape of whatever the library happened to return — twelve cramped numbered rows out of a
// 5,600-character note (generation 63511b51). बॅनर and यूट्यूब ignore designMode entirely.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Clapperboard,
  ClipboardPaste,
  Film,
  Image as ImageIcon,
  MessageSquareText,
  MonitorPlay,
  Ratio,
  Send,
  Sparkles,
  Type,
  Wand2,
} from 'lucide-react';
import {
  DEFAULT_MOTION_ASPECT,
  IMAGE_PROMPT_MAX_CHARS,
  MOTION_ASPECTS,
  MOTION_DIRECTION_MAX_CHARS,
  POSTER_HEADING_MAX_CHARS,
  POSTER_TEXT_MIN_CHARS,
  UPLOAD_FILE_MAX_BYTES,
  isArticleCategory,
  isSocialCategory,
  referenceCategoryOf,
} from '@dgipr/schemas';
import type {
  Category,
  DesignMode,
  MotionAspect,
  MotionSourceResponse,
} from '@dgipr/schemas';
import { createGeneration, getGeneration } from '../lib/api';
import { useTasks } from '../lib/TasksProvider';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import {
  DocumentIntake,
  type DocumentIntakeStatus,
} from '../components/DocumentIntake';
import ReferencePicker, {
  type ReferenceSelection,
} from '../components/ReferencePicker';
import { MotionSourcePicker } from '../components/MotionSourcePicker';
import { SocialLogoStack } from '../components/SocialLogoStack';
import { Disclosure } from '../components/Disclosure';
import { ErrorNotice } from '../components/ErrorNotice';

// ONE flat row of formats. The two-level पोस्टर/कॅप्शन picker it replaces asked a question
// officers were not making a decision about — a caption is an ADD-ON to a social post, so
// it is a checkbox under those two cards rather than a lane of its own. Built locally so
// the shared CATEGORY_OPTIONS (reused by the detail page's next-step panel and /dlo) is
// left untouched.
//
// Every value except 'video' and 'caption' IS a Category value, so the request needs
// essentially no mapping table. 'video' is a shortcut to /video, which runs its own two-gate
// flow and cannot be submitted from here. 'caption' is the ONE genuine pseudo-format: the
// caption-only lane is not a category at all, it is a social run carrying outputType 'article'
// (which means "renders no poster" on both lanes), so it submits as 'facebook' — see
// submitCategory below for why that platform and not the other.
type Format = Category | 'video' | 'caption';

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
  // The caption-only lane, beside the poster it is the alternative to. NOT the same thing as
  // the कॅप्शनही तयार करा checkbox under क्रिएटिव्ह: that one adds a caption to a poster, this
  // one produces a caption INSTEAD of a poster — one model call, no image spend, no template,
  // no design question. The API, the runner and the detail page have supported it all along
  // (outputType 'article' on a social row); it was only this form that stopped offering it.
  {
    value: 'caption',
    icon: MessageSquareText,
    name: STR.mediaFormatCaption,
    desc: STR.mediaFormatCaptionDesc,
  },
  {
    value: 'scheme',
    icon: ImageIcon,
    name: 'बॅनर',
    desc: STR.mediaFormatArticlePosterDesc,
  },
  // The one format on this page whose SOURCE is a picture rather than text — picking it
  // replaces the note box above with an upload and a motion brief. It is a real Category
  // (migration 0052), so it needs no mapping here either.
  {
    value: 'dynamic_poster',
    icon: Film,
    name: STR.mediaFormatDynamicPoster,
    desc: STR.mediaFormatDynamicPosterDesc,
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
type SelectableFormat = Extract<
  Format,
  'twitter' | 'scheme' | 'youtube' | 'caption' | 'dynamic_poster'
>;

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
  return value === 'twitter' ||
    value === 'scheme' ||
    value === 'youtube' ||
    value === 'dynamic_poster'
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
  // क्रिएटिव्ह only: WHERE THE POSTER'S WORDS COME FROM. Independent of the template question
  // below — 'ai' has generatePosterCopy read the box as source material and write the poster's
  // headline + points out of it; 'verbatim' prints exactly what is in the box, unchanged.
  //
  // 'ai' is the default: most officers paste an article or a set of notes and want a poster made
  // out of it. 'verbatim' is for the case where the box already holds the finished poster text,
  // word for word, and any rewrite would be a defect.
  //
  // Held across a format switch on purpose: it is a preference about this officer's own
  // material, and the value is simply not sent on a lane that ignores it.
  const [contentSource, setContentSource] = useState<'ai' | 'verbatim'>('ai');
  // A social post is poster-only unless asked otherwise: the caption is a separate
  // paid model call, and plenty of posts are published as an image. It can also be added
  // afterwards from the detail page, so off is a cheap default rather than a lossy one.
  const [wantCaption, setWantCaption] = useState(false);
  // क्रिएटिव्ह only: the officer's OWN prompt for the image model (migration 0045). Blank (the
  // default and the overwhelmingly common case) leaves the platform's built poster prompt in
  // place; filled, it REPLACES it — the image model then receives the DGIPR designer line, this
  // text, the poster's text and the reserved-zone rule, and nothing else the platform decided.
  //
  // Held across a format switch like contentSource, and simply not sent on a lane that ignores
  // it — a brief written for a poster is still the brief if the officer flips away and back.
  const [imagePrompt, setImagePrompt] = useState('');
  // पोस्टर runs only: the exact line to print on the poster. Blank (the default) leaves it to
  // the automatic named-subject resolution, which is what most runs want — this is the
  // override for when the officer already knows the poster must say a particular thing.
  const [posterHeading, setPosterHeading] = useState('');
  // डायनॅमिक पोस्टर only: the officer's uploaded poster, already stored (the picker uploads on
  // pick) and holding the storage path the create request carries. Held across a format switch
  // like the two fields above — an upload the officer made is not thrown away because they
  // looked at another card — and simply not sent on a lane that ignores it.
  const [motionSource, setMotionSource] = useState<MotionSourceResponse | null>(
    null,
  );
  // The motion brief for that lane. Its OWN state rather than the note box above, which is
  // hidden here: the two mean different things (that one is content, this one is direction),
  // and sharing it would send whatever was typed for a poster as the instruction for a clip.
  const [motionDirection, setMotionDirection] = useState('');
  // The SHAPE of the clip (migration 0053), and the only size question this lane asks. It used
  // to ask none: the motion prompt stated the uploaded poster's exact pixel resolution and
  // demanded it back, which a video model does not deliver — so the loudest requirement in the
  // prompt was the one thing the render could never honour.
  //
  // THE POSTER'S OWN SHAPE IS THE DEFAULT, and choosing anything else used to be the lane's
  // worst bug rather than a preference: a DGIPR social poster is 4:5, and a 4:5 poster asked
  // for a 9:16 clip came back with ~15% cut off each side, because the prompt demanded both
  // that ratio and the whole poster and only 70% of its width fits. The two fixed frames stay
  // for a department publishing into a reel or a landscape post; picking one now pads the
  // poster into it rather than letting the render crop to fill it.
  const [motionAspect, setMotionAspect] = useState<MotionAspect>(
    DEFAULT_MOTION_ASPECT,
  );
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

  // The फक्त कॅप्शन lane. Tested FIRST and excluded from every flag below it, because it is a
  // social run by category and would otherwise inherit the whole poster form — the template
  // picker, the design question, the जसाच्या तसा मजकूर checkbox and the AI प्रॉम्प्ट box, none
  // of which can affect a run that paints nothing.
  // The डायनॅमिक पोस्टर lane. Tested first alongside the caption lane and excluded from every
  // flag below, because its source is an IMAGE: the note box, the document intake, the
  // template picker and every poster option would all be answering questions this run does not
  // ask.
  const isDynamicPoster = category === 'dynamic_poster';
  const isCaption = category === 'caption';
  // What actually goes on the wire. 'caption' is not a Category, and the platform it maps to is
  // a real choice rather than a formality: generateSocialCaption branches on it, and the twitter
  // branch carries X's 280-character rule while the facebook branch writes the long multi-
  // paragraph caption. This lane is the long one — it is easier to cut a caption down by hand
  // than to expand one — so it submits 'facebook'.
  const submitCategory: Category = isCaption ? 'facebook' : category;
  // The क्रिएटिव्ह lane (submitted as 'twitter'). Still asked through isSocialCategory so a
  // ?format=facebook handoff, and any future second social card, behave identically.
  const isSocial = !isCaption && !isDynamicPoster && isSocialCategory(category);
  // The लेख पोस्टर lane. Asked positively rather than as !isSocial, which silently swept
  // यूट्यूब थंबनेल in with it — a thumbnail writes no article and locks no poster heading.
  const isArticle =
    !isCaption && !isDynamicPoster && isArticleCategory(category);
  // Has the officer explicitly chosen a template? This is the ONLY design question on the
  // क्रिएटिव्ह lane (2026-08-07): no template means a fully-AI poster, a template means that
  // template is followed. There is no separate "design mode" control any more.
  const templatePicked = isSocial && reference !== null;

  // What actually goes on the wire. DERIVED, never stored — the officer answers two INDEPENDENT
  // questions and the mode is the cell they land on:
  //
  //                   | contentSource 'ai'  | contentSource 'verbatim'
  //   ----------------+---------------------+--------------------------
  //   no template     | 'fresh'             | 'fresh_verbatim'
  //   a template      | 'adaptive'          | 'onbrand'
  //
  // No template is the DEFAULT design (the API resolves no reference at all and the image model
  // designs the whole poster), because the previous default ('onbrand' over an auto-selected
  // template) gave every poster the shape of whatever the library happened to return — twelve
  // cramped numbered rows out of a 5,600-character note (generation 63511b51). 'ai' is the default
  // content answer.
  //
  // Keeping it derived is what stops the controls from ever disagreeing — there is no state that
  // can say "fresh" while a template sits pinned beside it.
  const verbatimText = contentSource === 'verbatim';
  const designMode: DesignMode = templatePicked
    ? verbatimText
      ? 'onbrand'
      : 'adaptive'
    : verbatimText
      ? 'fresh_verbatim'
      : 'fresh';

  // Does the box hold SOURCE MATERIAL the poster's copy is written out of, rather than the
  // poster's own words? That is the 'ai' answer, on either design lane — and it changes what the
  // box's label, hint and placeholder promise.
  //
  // SCOPED TO isSocial deliberately. contentSource is a क्रिएटिव्ह control and defaults to 'ai',
  // so an unscoped test would silently re-label the लेख पोस्टर and यूट्यूब थंबनेल boxes, whose
  // wording is not this tab's to change. Those two lanes never send a designMode at all.
  // ...and TRUE on the caption lane unconditionally: the box there is source material by
  // definition — the caption is written out of it and nothing in it is printed anywhere.
  const fromArticle = (isSocial && !verbatimText) || isCaption;

  // What the folded "काय तयार करायचे?" row states, so collapsing it never hides the answer.
  // Found rather than mapped: FORMATS is the one list of formats this page offers, and a
  // second name table beside it could disagree with the cards.
  const selectedFormat = FORMATS.find((option) => option.value === category);

  // Which library the template picker shows: twitter masters for the two social formats,
  // article masters for the लेख पोस्टर, youtube masters for the थंबनेल. विभाग is gone from this
  // form — a social post here is always the DGIPR brand.
  // ('caption' is not a Category and renders no poster, so the picker is not shown there at
  // all; the substitution only keeps this expression total.)
  const pickerCategory = referenceCategoryOf(submitCategory);

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

  // Is there anything to generate FROM? The same rule submit() enforces, applied to the
  // control instead of to the press — a submit that can only be refused should not look
  // available.
  //
  // The `unread` arm is what keeps a scanned PDF usable: its pages are ticked but nobody has
  // paid to read them yet, so it contributes no text to combinedNote, and reading it and then
  // submitting is exactly what startSubmit does. Testing the text alone would leave an officer
  // whose only source is a scan with a dead button and no way forward.
  // डायनॅमिक पोस्टर is sourced from the picture, so the uploaded poster IS the requirement and
  // the direction beside it is optional — the officer may reasonably have nothing to add.
  const canSubmit = isDynamicPoster
    ? motionSource !== null
    : combinedNote.length >= POSTER_TEXT_MIN_CHARS || docStatus === 'unread';
  const submitBusy = submitting || awaitingRead;
  const submitLabel = awaitingRead
    ? STR.docReadingForSubmit
    : submitting
      ? STR.submitting
      : STR.submit;

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
    if (isDynamicPoster && !motionSource) {
      setError(STR.motionSourceRequired);
      return;
    }
    // The box holds the poster's own text now, which can legitimately be a few characters
    // ('भारत टॅक्सी' is 11) — the old 20-character article minimum would have refused it.
    // POSTER_TEXT_MIN_CHARS is shared with the API's schema, so the two cannot drift.
    // Not applied on डायनॅमिक पोस्टर, whose source is the uploaded picture.
    if (!isDynamicPoster && combinedNote.length < POSTER_TEXT_MIN_CHARS) {
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
    // Both social lanes take the social gate — a caption-only run is short and paints nothing,
    // but TasksProvider deliberately keeps one social task at a time rather than carving out an
    // exception for it.
    if (isSocial || isCaption) {
      if (hasActiveSocialTask) {
        setError(STR.busyError);
        return;
      }
      // डायनॅमिक पोस्टर takes NEITHER gate. Those two exist because their lanes share a serial
      // resource — one n8n workflow, one article pipeline — and this one shares neither: it is
      // its own two calls straight to gpt-5.6-sol and gemini-omni.
    } else if (!isDynamicPoster && hasActiveArticleTask) {
      setError(STR.busyError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGeneration({
        // On डायनॅमिक पोस्टर the note IS the motion direction, and an empty one is a complete
        // request — the picture is the source. Every other lane sends what it always has.
        note: isDynamicPoster ? motionDirection.trim() : combinedNote,
        category: submitCategory,
        // 'article' means "this run renders NO poster" on both lanes — the फक्त कॅप्शन card.
        // Every other format here renders one.
        outputType: isCaption ? 'article' : 'poster',
        // The लेख पोस्टर path uses the pasted article verbatim (skip generateArticle);
        // inert for social, whose caption is always written fresh.
        providedArticle: isArticle,
        // Social only. Opt-in beside a poster (the checkbox); MANDATORY on the फक्त कॅप्शन
        // lane, where the caption is the run's entire output — the API rejects a caption-only
        // request that does not ask for one, since it would be a request for nothing at all.
        generateCaption: isCaption ? true : isSocial ? wantCaption : undefined,
        // लेख पोस्टर only, and only when actually typed — an empty string would be a
        // meaningless "clear" on a run that has nothing to clear.
        posterHeading:
          isArticle && posterHeading.trim() ? posterHeading.trim() : undefined,
        // The विभाग question stays fixed (always the DGIPR template family); designMode is
        // derived from the template pick above, so it is 'fresh' unless the officer chose a
        // template. The reference ids below are null in that case by construction — designMode
        // and the pin can never disagree, because one is computed from the other.
        designMode: isSocial ? designMode : undefined,
        templateBrand: isSocial ? 'dgipr' : undefined,
        // The officer's own image prompt (migration 0045) — क्रिएटिव्ह only, and only when
        // actually typed. Sent trimmed, because it is stored on the row and read back verbatim
        // by every later render of this poster.
        imagePrompt:
          isSocial && imagePrompt.trim() ? imagePrompt.trim() : undefined,
        referenceImageId:
          reference?.kind === 'image' ? reference.id : undefined,
        referenceTypeId: reference?.kind === 'type' ? reference.id : undefined,
        // The uploaded poster (migration 0052). A PATH, never a URL: the API accepts only
        // paths it minted, so this is the one thing that can point a paid render at an object.
        sourceImagePath:
          isDynamicPoster && motionSource ? motionSource.path : undefined,
        // The clip's shape (migration 0053). Sent on this lane only — the schema rejects it
        // anywhere else, since no other lane renders a clip for it to describe.
        motionAspect: isDynamicPoster ? motionAspect : undefined,
      });
      // Every format now opens its own progress page. Keep tracking the run so the navbar
      // tasks panel still offers a shortcut, but do not open that panel automatically.
      // The document has been consumed and must not be re-attached to the next generation.
      clearDocument();
      addTask(id);
      router.push(`/generations/${id}`);
    } catch (e) {
      setError(errorMessage(e));
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

      {/* THE SOURCE IS A PICTURE ON ONE LANE ONLY. डायनॅमिक पोस्टर starts from a finished
          poster the officer already has, so the box that would ask for text is replaced
          outright rather than left there to be ignored: an upload, a motion brief, and the
          same send button. Everything below this card — the format picker, and on other
          lanes the poster heading and the template pin — is unchanged. */}
      {isDynamicPoster ? (
        <section className="card">
          <MotionSourcePicker
            value={motionSource}
            disabled={submitting}
            onChange={setMotionSource}
          />
          {/* Optional, and the hint says so. The poster alone is a complete request; this is
              where an officer says which part of it should move. */}
          <div className="option-field">
            <label className="field-label" htmlFor="motion-direction">
              <Wand2 size={18} className="label-icon" aria-hidden="true" />
              {STR.motionDirectionLabel}
            </label>
            <p className="hint">{STR.motionDirectionHint}</p>
            <div className="note-field">
              <textarea
                id="motion-direction"
                className="note-input"
                maxLength={MOTION_DIRECTION_MAX_CHARS}
                placeholder={STR.motionDirectionPlaceholder}
                value={motionDirection}
                disabled={submitting}
                onChange={(e) => setMotionDirection(e.target.value)}
              />
              {/* submit() directly rather than startSubmit(): that one exists to read an
                  attached document before generating, and this lane has none. */}
              <button
                type="button"
                className="btn btn-primary note-send"
                onClick={() => void submit()}
                disabled={submitBusy || !canSubmit}
                title={submitLabel}
                aria-label={submitLabel}
              >
                {submitBusy ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Send size={20} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {/* THE SHAPE OF THE CLIP. A field of its own rather than a chip strip floating in
              the text box's foot, which is where it started: a third option pushed that strip
              past the width the box reserves beside its send button, and it wrapped onto two
              rows over the officer's own text. It also earns a hint — "the poster is padded"
              is the one thing they cannot see until the clip comes back, and bars nobody
              warned them about read as a defect. */}
          <div className="option-field">
            <label className="field-label" htmlFor="motion-aspect-source">
              <Ratio size={18} className="label-icon" aria-hidden="true" />
              {STR.motionAspectLabel}
            </label>
            <p className="hint">{STR.motionAspectHint}</p>
            <div
              className="motion-aspect"
              role="radiogroup"
              aria-label={STR.motionAspectLabel}
            >
              {MOTION_ASPECTS.map((value) => (
                <button
                  key={value}
                  id={`motion-aspect-${value === 'source' ? 'source' : value.replace(':', '-')}`}
                  type="button"
                  role="radio"
                  aria-checked={motionAspect === value}
                  className={`motion-aspect-option${motionAspect === value ? ' active' : ''}`}
                  disabled={submitting}
                  onClick={() => setMotionAspect(value)}
                >
                  {value === 'source'
                    ? STR.motionAspectSource
                    : value === '9:16'
                      ? STR.motionAspectPortrait
                      : STR.motionAspectLandscape}
                </button>
              ))}
            </div>
          </div>
          {error ? <ErrorNotice message={error} /> : null}
        </section>
      ) : (
        <section className="card">
          <label className="field-label" htmlFor="note">
            <ClipboardPaste
              size={18}
              className="label-icon"
              aria-hidden="true"
            />
            {fromArticle ? STR.articleSourceLabel : STR.articlePasteLabel}
          </label>
          <p className="hint">
            {fromArticle ? STR.articleSourceHint : STR.articlePasteHint}
          </p>
          {/* Handoff from a finished run's cross-format link. The failure is stated rather
              than silent — an empty box with no explanation reads as the link not working. */}
          {prefill === 'loading' ? (
            <p className="hint" aria-live="polite">
              <span className="spinner" aria-hidden="true" />{' '}
              {STR.prefillLoading}
            </p>
          ) : prefill === 'applied' ? (
            <p className="form-success">{STR.prefillApplied}</p>
          ) : prefill === 'failed' ? (
            <ErrorNotice message={STR.prefillFailed} />
          ) : null}
          {/* The submit lives INSIDE the text box, bottom-right, the way a composer does.
              It used to be a full-width तयार करा bar in its own card ABOVE the form — put
              there because a button under the whole page (textarea + upload card + format
              cards) is off-screen for most of the time spent here. Anchoring it to the box
              keeps it in view without detaching it from what it acts on, and the error line
              follows it so a refusal (too short, another run in flight) is still reported
              where the action was taken. */}
          <div className="note-field">
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
            />
            <button
              type="button"
              className="btn btn-primary note-send"
              onClick={() => void startSubmit()}
              disabled={submitBusy || !canSubmit}
              title={submitLabel}
              aria-label={submitLabel}
            >
              {submitBusy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Send size={20} aria-hidden="true" />
              )}
            </button>
          </div>
          {error ? <ErrorNotice message={error} /> : null}

          {/* THE OFFICER'S OWN PROMPT (migration 0045), क्रिएटिव्ह only. Directly under the text
              box because the two are sent together and mean nothing apart: this is the design
              brief, that is the words to put on it.

              IT REPLACES, IT DOES NOT ADD. Fill it and the platform's entire assembled poster
              prompt is skipped — the image model gets the DGIPR designer line, this brief, the
              text above, and the reserved-zone rule, which stays because the badge and footer are
              composited in code afterwards and would otherwise land on top of the officer's own
              poster. Nothing else: no palette, no arrangement anchor, no reference-structure
              block, and no poster-copy call is made. The hint says so in as many words, because
              an officer who types one extra instruction expecting it to be ADDED to the usual
              rules would be reading this box exactly backwards.

              The template picker below still works with it: pinned, the master is the edit canvas
              and this is the only instruction sent with it; unpinned, the poster is generated from
              scratch. That question is answered by pinning, exactly as it is today.

              बॅनर, यूट्यूब थंबनेल and फक्त कॅप्शन do not show it — the first two build their image
              prompts on lanes this does not touch, and the third paints nothing at all. */}
          {isSocial ? (
            <div className="option-field">
              <label className="field-label" htmlFor="image-prompt">
                <Wand2 size={18} className="label-icon" aria-hidden="true" />
                {STR.imagePromptLabel}
              </label>
              <p className="hint">{STR.imagePromptHint}</p>
              <textarea
                id="image-prompt"
                className="note-input"
                maxLength={IMAGE_PROMPT_MAX_CHARS}
                placeholder={STR.imagePromptPlaceholder}
                value={imagePrompt}
                disabled={submitting}
                onChange={(e) => setImagePrompt(e.target.value)}
              />
            </div>
          ) : null}

          {/* Two opt-ins about the text above, in the card that holds it. Both are क्रिएटिव्ह-only
              and both are OFF by default:

              जसाच्या तसा मजकूर — print the box unchanged instead of writing the poster's copy out
                of it. Was a pair of tabs above the box; almost every run wants the default, so an
                unticked checkbox states it in a quarter of the height. Available with or without a
                template ('fresh_verbatim' / 'onbrand').
              कॅप्शनही तयार करा — the caption is a second paid call and can be added afterwards from
                the detail page, so off is a cheap default rather than a lossy one.

              बॅनर and यूट्यूब थंबनेल send neither value, so neither box is shown there — a control
              that cannot affect the run would be a lie. */}
          {isSocial ? (
            <>
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={verbatimText}
                  disabled={submitting}
                  onChange={(e) =>
                    setContentSource(e.target.checked ? 'verbatim' : 'ai')
                  }
                />
                <span>
                  <span className="option-toggle-name">
                    {STR.posterSourceVerbatim}
                  </span>
                  <span className="option-toggle-desc">
                    {STR.posterSourceVerbatimDesc}
                  </span>
                </span>
              </label>
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={wantCaption}
                  disabled={submitting}
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
            </>
          ) : null}

          {/* A finished article often arrives as a file rather than in the clipboard — a Word
              document, or a scanned press note. The shared intake reads it here; a scanned PDF
              stops to ask which pages are worth OCR'ing before a single credit is spent.

              EMBEDDED: inside this card rather than as one of its own, because the file is a
              source for the same box above it — as its own card it read as a separate form and
              an officer could finish the page without noticing the two were related.

              LIVE mode (onTextChange): the file's text is a SECOND source counted beside the box
              above, not something pushed into it — so pasting, uploading, or doing both all just
              work. It used to be appended by a button inside the card, which meant an upload that
              was never handed over was silently dropped and the submit complained the टिपणी was
              too short. */}
          <DocumentIntake
            key={docKey}
            storageKey={DOC_STORAGE_KEY}
            embedded
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
            // Throw the attached file away without starting a run. "दुसरी फाईल निवडा" only ever
            // REPLACED it, so an officer who decided to generate from the typed text alone had
            // no way to detach the document — and in live mode its text is counted at submit
            // whether or not anyone is still looking at it. Same clear the submit path runs.
            //
            // Offered only once there IS a file: the component renders this control in every
            // state including the empty upload card, where /dlo needs it (its slot itself is
            // dismissible) and this surface has nothing to delete.
            {...(docStatus === 'empty' ? {} : { onRemove: clearDocument })}
            // The same तयार करा, beside the file controls. A scanned PDF's page picker is taller
            // than the viewport, so the composer's send button above it is off screen at exactly
            // the moment the officer has finished choosing pages and wants to start the run.
            submitAction={
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => void startSubmit()}
                disabled={submitBusy || !canSubmit}
              >
                {/* Label only — the shared .spinner is accent-on-accent-soft and vanishes on a
                    maroon fill (the reason .note-send redefines it), and submitLabel already
                    states which of the two waits this is. */}
                {submitLabel}
              </button>
            }
          />
        </section>
      )}

      <section className="card">
        {/* Folded shut. The format is chosen once and then usually left alone (क्रिएटिव्ह is the
            default and by far the most-used), while the poster heading and the template pin are
            answered on few runs — at full height the three of them made this page read as far
            more work than it is. The collapsed row still states the ANSWER, so folding it can
            never hide which format the run will produce. */}
        <Disclosure
          icon={Sparkles}
          title={STR.mediaOutputLabel}
          summary={selectedFormat?.name}
          summarySet
        >
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
                (option.value === 'caption' || isSocialCategory(option.value)
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
          {/* What a लेख पोस्टर SAYS is part of choosing what to make, so it sits with the format
            cards. Social posters do not have it — their headline is written into a multi-field
            copy object with no single line to lock. Left blank (the normal case) the run reads
            the योजना / पुरस्कार / उपक्रम name out of the note itself. */}
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
            switching format remounts it against the right library.

            Not rendered on the फक्त कॅप्शन lane: that run renders no poster, so there is
            nothing for a template to shape. The pin state is cleared by the effect on
            [category] anyway, so switching away and back cannot leave a stale one behind. */}
          {!isCaption ? (
            <div className="option-field option-field-flush">
              <ReferencePicker
                key={pickerCategory}
                category={pickerCategory}
                brand="dgipr"
                variant="disclosure"
                value={reference}
                onChange={setReference}
                {...(isSocial
                  ? {
                      // On this lane an empty selection means NO template is used and the poster
                      // is designed from scratch — the opposite of the default wording, which
                      // promises the platform will pick one. लेख and यूट्यूब still auto-select,
                      // so they keep it.
                      noneLabel: STR.refPickerDisclosureNoneSocial,
                      noneHint: STR.refPickerDisclosureHintSocial,
                    }
                  : {})}
              />
            </div>
          ) : null}
        </Disclosure>
        {/* OUTSIDE the fold: a busy lane is the reason a submit will be refused, and a
            collapsed row would hide the explanation. */}
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
