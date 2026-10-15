'use client';

// Completed-state view for a Twitter/Facebook run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface).
//
// Layout, top to bottom: the poster with an icon-button row under it (download /
// redesign / recolour / mark-for-image-edit / free-this-space, then one brand-mark
// publish button per platform — फेसबुक live, X disabled), the caption as an ALWAYS-EDITABLE
// textarea with copy (and, on a run that has none, generate) icons in its bottom-right
// corner, the marker notes for whatever the user has marked on the poster, and the edit
// assistant (EditChat): one conversation in which the officer says what they want changed —
// caption, poster, a fresh design or both — and the assistant routes it to the right edit.
// The hand edit has no save button: it autosaves when focus leaves the box.

import { useEffect, useRef, useState } from 'react';
import type {
  EditAssistantAction,
  FeedbackRegion,
  GenerationDetail,
  PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import {
  Download,
  ImageDown,
  // Palette — the "वेगळ्या रंगात तयार करा" recolour redo, hidden from the UI (see the
  // commented button below). Restore this import with it.
  RotateCw,
  SquareDashed,
  SquarePen,
} from 'lucide-react';
// Through the API context rather than imported directly, so /learn can render this card
// against its no-network sandbox. With no provider it is lib/api itself.
import { useApi } from '../lib/apiContext';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { posterRoundPayload } from '../lib/posterRound';
import { FacebookLogo } from './FacebookLogo';
import { XLogo } from './XLogo';
import {
  PosterAnnotator,
  type AnnotatorMode,
  type PosterMarkerDraft,
} from './PosterAnnotator';
import { PosterMarkNotes } from './PosterMarkNotes';
import { PosterVersionStrip } from './PosterVersionStrip';
import { CanvaLink } from './CanvaLink';
import { EditChat } from './EditChat';
import { ErrorNotice } from './ErrorNotice';
import { SocialCaptionEditor } from './SocialCaptionEditor';

export type MarksRefusal =
  string | { message: string; suggestion: { label: string; note: string } };

export function SocialPostView({
  detail,
  onChanged,
  busy = false,
  onImageWorkStarted,
  beforeSendMarks,
  onAnnotationChange,
  fillFirstMarkNote,
  placeMark,
  clearMarks,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  busy?: boolean;
  // An extra refusal for the marks' own send button, checked beside the note-length rule and
  // reported in the same place. Returns the message to show, or null to let the round go.
  // Only /learn passes one (its practice can only simulate a headline edit); unset, the
  // button behaves exactly as it always has. A refusal may carry a suggested note, offered
  // as a button that fills mark ① — never applied silently over the officer's own words.
  beforeSendMarks?:
    | ((markers: readonly PosterMarkerDraft[]) => MarksRefusal | null)
    | undefined;
  // Told whenever marking is armed/disarmed or the red marks change. Only /learn listens —
  // its coach advances on "marking is on" and "a mark sits on the headline". Pass a stable
  // function: it is an effect dependency.
  onAnnotationChange?:
    | ((state: {
        marking: boolean;
        markers: readonly PosterMarkerDraft[];
      }) => void)
    | undefined;
  // Writes `note` into mark ①'s note each time `seq` changes. Only /learn passes one (its
  // coach offers a button that writes the example for the learner).
  fillFirstMarkNote?: { note: string; seq: number } | null | undefined;
  // Places a red mark at `region` each time `seq` changes, and removes every red mark each
  // time `clearMarks.seq` changes. Only /learn passes them (its autoplay demo marks the
  // headline itself); unset, nothing here behaves differently.
  placeMark?: { region: FeedbackRegion; seq: number } | null | undefined;
  clearMarks?: { seq: number } | null | undefined;
  // Fired once a POSTER edit has been accepted by the API, handing the run to the navbar's
  // सुरू असलेली कामे panel so it can be followed after leaving this page. Poster work only:
  // a caption edit or revision touches no image, and this run's caption is already on screen
  // here with its own inline indicator. Called after the await — these routes flip the row to
  // running before their 202, and the panel files a still-`completed` row as terminal.
  onImageWorkStarted?: (() => void) | undefined;
}) {
  const {
    generateCaption,
    plainPosterDownloadUrl,
    posterDownloadUrl,
    publishGeneration,
    regeneratePoster,
    sendCaptionFeedback,
    sendPosterImageFeedback,
  } = useApi();
  const [pending, setPending] = useState(false);
  // Direct publish to the official account: two-step confirm (posting is
  // outward-facing and irreversible), then a synchronous API call. The live-post
  // URL also arrives persisted as detail.publishedUrl on the next refresh;
  // justPublishedUrl covers the gap until then.
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishingPost, setPublishingPost] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [justPublishedUrl, setJustPublishedUrl] = useState<string | null>(null);
  // Numbered click-to-point markers for pixel feedback (see PosterAnnotator).
  // The last sent round stays on screen inert (usePosterMarkers) so the user
  // can see what they asked for.
  const {
    markers,
    submittedMarkers,
    addMarker,
    removeMarker,
    setNote,
    clearRegions,
    submittedClearRegions,
    addClearRegion,
    removeClearRegion,
    setClearNote,
    setClearAction,
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers(detail);
  // Armed by the pencil / dashed-square icons under the poster (which show as
  // pressed while on), not by opening a fold — annotating is its own explicit
  // mode. `null` = nothing armed; the two are mutually exclusive because one
  // pointer gesture has to mean exactly one thing, but BOTH sets are sent in one
  // round, so switching between them never discards anything.
  const [annotMode, setAnnotMode] = useState<AnnotatorMode | null>(null);
  const annotOpen = annotMode !== null;
  useEffect(() => {
    onAnnotationChange?.({ marking: annotMode === 'mark', markers });
  }, [onAnnotationChange, annotMode, markers]);
  const filledSeq = useRef(0);
  const firstMarkerId = markers[0]?.id;
  useEffect(() => {
    if (!fillFirstMarkNote || fillFirstMarkNote.seq === filledSeq.current)
      return;
    if (firstMarkerId === undefined) return;
    filledSeq.current = fillFirstMarkNote.seq;
    setNote(firstMarkerId, fillFirstMarkNote.note);
  }, [fillFirstMarkNote, firstMarkerId, setNote]);
  const placedSeq = useRef(0);
  useEffect(() => {
    if (!placeMark || placeMark.seq === placedSeq.current) return;
    placedSeq.current = placeMark.seq;
    addMarker(placeMark.region);
    // addMarker is a fresh function each render; the seq is what says "do it now",
    // so it is deliberately left out of the deps.
  }, [placeMark]);
  const clearedSeq = useRef(0);
  const markerIds = markers.map((m) => m.id).join(',');
  useEffect(() => {
    if (!clearMarks || clearMarks.seq === clearedSeq.current) return;
    clearedSeq.current = clearMarks.seq;
    for (const id of markerIds.split(',').filter(Boolean))
      removeMarker(Number(id));
  }, [clearMarks]);
  // The caption box itself — its draft, autosave and generate button — is
  // SocialCaptionEditor, shared with the carousel card. Change REQUESTS go through the edit
  // assistant below; this state only serves the marks' own send button under the poster.
  const [sendingChange, setSendingChange] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  // A refusal's suggested note for mark ①, shown as a button beside the refusal.
  const [changeSuggestion, setChangeSuggestion] = useState<{
    label: string;
    note: string;
  } | null>(null);

  const showSpinner = busy || pending;
  // Poster edits do NOT need a completed row — every poster route (image-feedback,
  // regenerate, restore) asks only for a poster and no running job. Gating them on
  // 'completed' is what left a run whose last edit failed with a visible poster and no way
  // to touch it; a run recovered from such a failure must be able to carry straight on.
  const posterEditable =
    detail.posterUrl !== null &&
    (detail.status === 'completed' || detail.status === 'failed') &&
    !showSpinner;

  const publish = async () => {
    setPublishingPost(true);
    setPublishError(null);
    try {
      const postUrl = await publishGeneration(detail.id, 'facebook');
      setJustPublishedUrl(postUrl);
      setConfirmingPublish(false);
      // Pull the refreshed detail so the persisted publishedUrl arrives (the
      // poll has stopped on this completed row).
      await onChanged();
    } catch (error) {
      setPublishError(errorMessage(error));
    } finally {
      setPublishingPost(false);
    }
  };

  // Re-render this run's poster as a new version; the row flips to running
  // server-side, so refresh to resume polling.
  const redoPoster = async (recolour: boolean) => {
    setPending(true);
    try {
      await regeneratePoster(detail.id, recolour ? { recolour: true } : {});
      onImageWorkStarted?.();
      await onChanged();
    } finally {
      setPending(false);
    }
  };

  // One poster round, shared by the marks' send button and the edit assistant. Throws on
  // failure so each caller reports it where the officer is looking.
  const submitPosterRound = async (payload: PosterImageFeedbackRequest) => {
    setSendingChange(true);
    setPending(true);
    try {
      await sendPosterImageFeedback(detail.id, payload);
      markSubmitted();
      setAnnotMode(null);
      onImageWorkStarted?.();
      await onChanged();
    } finally {
      setSendingChange(false);
      setPending(false);
    }
  };

  // The marks, sent on their own with the notes typed beside them.
  const sendMarks = async () => {
    if (sendingChange) return;
    setChangeError(null);
    setChangeSuggestion(null);
    if (markers.some((m) => m.note.trim().length < 3)) {
      setChangeError(STR.markerNoteTooShort);
      return;
    }
    const refusal = beforeSendMarks?.(markers) ?? null;
    if (refusal) {
      if (typeof refusal === 'string') setChangeError(refusal);
      else {
        setChangeError(refusal.message);
        setChangeSuggestion(refusal.suggestion);
      }
      return;
    }
    try {
      await submitPosterRound(posterRoundPayload(markers, clearRegions));
    } catch (e) {
      setChangeError(errorMessage(e));
    }
  };

  // Carry out one step of the edit assistant's plan, through the same routes the old
  // "AI ला सूचना द्या" fold used. The assistant only ever proposes what this card can do.
  const executeAction = async (action: EditAssistantAction) => {
    switch (action.type) {
      case 'caption_revise':
        await sendCaptionFeedback(detail.id, action.instruction);
        await onChanged();
        return;
      case 'caption_generate':
        await generateCaption(detail.id);
        await onChanged();
        return;
      case 'poster_edit':
        await submitPosterRound(
          posterRoundPayload(markers, clearRegions, {
            feedback: action.instruction,
            markerNotes: action.markerNotes,
          }),
        );
        return;
      case 'poster_redesign':
        await redoPoster(false);
        return;
      case 'poster_heading':
        // Article posters only — never planned for a social card.
        return;
    }
  };

  const liveUrl = justPublishedUrl ?? detail.publishedUrl;
  // The Facebook button is NOT gated on the row's category, a settled row or a finished
  // caption. Not the category, because the create form's one क्रिएटिव्ह card submits
  // 'twitter' for every social poster — that poster goes on the Page too, which is why the
  // publish call names its target platform instead of letting the route infer one. Not the
  // rest, because the officer decides when a post is ready and the route's own guards
  // answer in Marathi if it is not (the reply lands in publishError under the poster).
  // What is left is the one press that could not recover: a publish already in flight —
  // posting is irreversible, so a second click must never make a second live post.
  const publishBlocked = publishingPost;

  return (
    <section className="card">
      {/* A कॅप्शन run has no poster, so "तयार झालेले पोस्टर" would head a card that
          contains only a caption. */}
      <h2>{detail.posterUrl ? STR.posterTitle : STR.captionLabel}</h2>
      {/* The information carried more items than any master template lays out. Every item IS on
          the poster (the image prompt is told to extend the reference's row pattern rather than
          drop content) — this says the design was stretched, so the officer can check it reads
          well or split the note. Same transient in-process registry as the article warnings. */}
      {detail.posterUrl && detail.posterCapacityWarning ? (
        <div className="info-callout warn" style={{ marginBottom: 12 }}>
          <p className="field-label">{STR.posterCapacityWarnTitle}</p>
          <p className="hint">
            {STR.posterCapacityWarnBody(
              detail.posterCapacityWarning.needed,
              detail.posterCapacityWarning.available,
            )}
          </p>
        </div>
      ) : null}
      {/* A कॅप्शन run has no poster, so the left column is empty — without this the
          caption would be laid out in the narrow poster column. */}
      <div
        className={
          detail.posterUrl ? 'poster-layout' : 'poster-layout is-caption-only'
        }
      >
        {detail.posterUrl ? (
          <div>
            <div className="poster-frame" data-learn="poster">
              <img
                src={detail.posterUrl}
                alt={STR.posterTitle}
                className="poster-image"
                draggable={false}
              />
              <PosterAnnotator
                markers={markers}
                onAdd={addMarker}
                onRemove={removeMarker}
                active={annotOpen && !showSpinner}
                disabled={showSpinner}
                submittedMarkers={submittedMarkers}
                onDismissSubmitted={dismissSubmitted}
                mode={annotMode ?? 'mark'}
                clearRegions={clearRegions}
                onAddClear={addClearRegion}
                onRemoveClear={removeClearRegion}
                submittedClearRegions={submittedClearRegions}
              />
              {showSpinner ? (
                <div
                  className="poster-loading"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <span className="spinner spinner-lg" />
                </div>
              ) : null}
            </div>
            {/* Icon-only actions on the poster itself. Every one carries its label as
                title + aria-label, since nothing here is spelled out on screen. */}
            <div className="poster-icon-actions">
              <a
                className="icon-btn"
                data-learn="download"
                href={posterDownloadUrl(detail.id)}
                title={STR.iconDownloadPoster}
                aria-label={STR.iconDownloadPoster}
              >
                <Download size={18} strokeWidth={1.9} aria-hidden="true" />
              </a>
              {/* The artwork alone, without the stamped badge and footer band. */}
              <a
                className="icon-btn"
                data-learn="download-plain"
                href={plainPosterDownloadUrl(detail.id)}
                title={STR.iconDownloadPosterPlain}
                aria-label={STR.iconDownloadPosterPlain}
              >
                <ImageDown size={18} strokeWidth={1.9} aria-hidden="true" />
              </a>
              <CanvaLink generationId={detail.id} />
              <button
                type="button"
                className="icon-btn"
                data-learn="redo"
                title={STR.iconRedesignPoster}
                aria-label={STR.iconRedesignPoster}
                disabled={!posterEditable}
                // The error slot the marks use: a failed redesign used to be an unhandled
                // rejection, which on /learn is also where "not in this lesson" is said.
                onClick={() => {
                  setChangeError(null);
                  void redoPoster(false).catch((e: unknown) =>
                    setChangeError(errorMessage(e)),
                  );
                }}
              >
                <RotateCw size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              {/* HIDDEN FROM THE UI, deliberately kept: the recolour redo
                  ("वेगळ्या रंगात तयार करा"), which re-renders the poster with the current
                  colour family barred. The API still supports it — regeneratePoster takes
                  `recolour`, and redoPoster(true) below is still the way in — so restoring
                  this is uncommenting the block plus the `Palette` import above.
              <button
                type="button"
                className="icon-btn"
                title={STR.iconRecolourPoster}
                aria-label={STR.iconRecolourPoster}
                disabled={!posterEditable}
                onClick={() => void redoPoster(true)}
              >
                <Palette size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              */}
              <button
                type="button"
                className="icon-btn"
                data-learn="mark-button"
                // Pressed state = marking is armed, so the poster reads as editable.
                aria-pressed={annotMode === 'mark'}
                title={
                  annotMode === 'mark'
                    ? STR.iconEditPosterOn
                    : STR.iconEditPoster
                }
                aria-label={
                  annotMode === 'mark'
                    ? STR.iconEditPosterOn
                    : STR.iconEditPoster
                }
                disabled={showSpinner}
                onClick={() =>
                  setAnnotMode(annotMode === 'mark' ? null : 'mark')
                }
              >
                <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              {/* The blue gesture: free a rectangle of the poster so the officer can
                  place their own logo or photograph there by hand. Its own button
                  rather than a mode inside the pencil, because it is a different
                  request — nothing is being edited, space is being made. */}
              <button
                type="button"
                className="icon-btn icon-btn-clear"
                aria-pressed={annotMode === 'clear'}
                title={
                  annotMode === 'clear'
                    ? STR.iconClearSpaceOn
                    : STR.iconClearSpace
                }
                aria-label={
                  annotMode === 'clear'
                    ? STR.iconClearSpaceOn
                    : STR.iconClearSpace
                }
                disabled={showSpinner}
                onClick={() =>
                  setAnnotMode(annotMode === 'clear' ? null : 'clear')
                }
              >
                <SquareDashed size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              {/* Publish to the official account, one button per platform, brand mark
                  only — where the poster goes is the whole message, so a Marathi label
                  beside it would say the same thing twice. The label still travels as
                  title + aria-label, since nothing here is spelled out on screen.
                  The फेसबुक one stays pressable on a फेसबुक run — see publishBlocked. */}
              <button
                type="button"
                className="icon-btn"
                title={STR.publishToFacebook}
                aria-label={STR.publishToFacebook}
                disabled={publishBlocked}
                onClick={() => {
                  setConfirmingPublish(true);
                  setPublishError(null);
                }}
              >
                <FacebookLogo size={18} />
              </button>
              {/* Always disabled: X publishing is held back. Shown rather than hidden so
                  the officer can see the platform exists and is simply not open yet. */}
              <button
                type="button"
                className="icon-btn"
                title={STR.iconPublishDisabled}
                aria-label={STR.iconPublishDisabled}
                disabled
              >
                <XLogo size={17} />
              </button>
            </div>
            {markers.length > 0 || clearRegions.length > 0 ? (
              <div className="btn-row marker-submit-action">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-learn="send"
                  aria-busy={sendingChange}
                  disabled={showSpinner || sendingChange}
                  onClick={() => void sendMarks()}
                >
                  {sendingChange ? STR.sendingFeedback : STR.sendFeedback}
                </button>
              </div>
            ) : null}
            {detail.posterStyleLabel ? (
              <p className="hint poster-style-label" style={{ marginTop: 10 }}>
                {STR.posterStyleLabelPrefix} {detail.posterStyleLabel}
              </p>
            ) : null}
            {confirmingPublish ? (
              <div className="info-callout" style={{ marginTop: 12 }}>
                <p>{STR.publishConfirmHint}</p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={publishingPost}
                    onClick={publish}
                  >
                    {publishingPost ? STR.publishing : STR.publishConfirmYes}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={publishingPost}
                    onClick={() => setConfirmingPublish(false)}
                  >
                    {STR.publishCancel}
                  </button>
                </div>
              </div>
            ) : null}
            {publishError ? <ErrorNotice message={publishError} /> : null}
            {justPublishedUrl ? (
              <p className="form-success">
                {STR.publishSuccess}{' '}
                <a href={justPublishedUrl} target="_blank" rel="noreferrer">
                  {STR.publishedViewPost}
                </a>
              </p>
            ) : liveUrl ? (
              // Persisted from an earlier session — survives reloads.
              <p style={{ marginTop: 10 }}>
                <a href={liveUrl} target="_blank" rel="noreferrer">
                  {STR.publishedViewPost}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
        <div>
          {/* No cross-format link row on a कॅप्शन-only run: the two platforms' captions
              are written the same way, so "make this for ट्विटर" would only re-buy the
              text already on screen. */}
          {/* The caption is a live textarea from the first render — no "बदल करा" step.
              A poster-only run gets an empty one plus the generate icon. */}
          <SocialCaptionEditor
            detail={detail}
            onChanged={onChanged}
            busy={showSpinner}
          />

          {/* What is marked on the poster, with a note beside each mark. */}
          {detail.posterUrl ? (
            <PosterMarkNotes
              markers={markers}
              submittedMarkers={submittedMarkers}
              clearRegions={clearRegions}
              submittedClearRegions={submittedClearRegions}
              onNoteChange={setNote}
              onRemoveMarker={removeMarker}
              onClearNoteChange={setClearNote}
              onClearActionChange={setClearAction}
              onRemoveClearRegion={removeClearRegion}
              disabled={showSpinner || sendingChange}
            />
          ) : null}

          {/* The marks' own send button reports here. */}
          {changeError ? <ErrorNotice message={changeError} /> : null}
          {changeSuggestion && markers[0] ? (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-small"
                data-learn="use-example"
                onClick={() => {
                  const first = markers[0];
                  if (first) setNote(first.id, changeSuggestion.note);
                  setChangeSuggestion(null);
                  setChangeError(null);
                }}
              >
                {changeSuggestion.label}
              </button>
            </div>
          ) : null}

          {/* The edit assistant: say what to change, in any words, and it works out whether
              that is the caption, the poster, a fresh design or both. */}
          <EditChat
            generationId={detail.id}
            surface="social"
            marks={detail.posterUrl ? { markers, clearRegions } : undefined}
            onExecute={executeAction}
            hint={STR.editChatHintSocial}
            placeholder={STR.editChatPlaceholderSocial}
            starters={detail.posterUrl ? STR.editChatStartersSocial : []}
            disabled={sendingChange}
          />
        </div>
      </div>
      {/* Switching version reuses `pending` — it means the same thing here as it does for a
          poster re-render: the poster on screen is about to be replaced. */}
      <PosterVersionStrip
        detail={detail}
        onChanged={onChanged}
        onRestoringChange={setPending}
        busy={showSpinner || sendingChange}
      />
    </section>
  );
}
