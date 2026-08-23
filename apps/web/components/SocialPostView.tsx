'use client';

// Completed-state view for a Twitter/Facebook run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface).
//
// Layout, top to bottom: the poster with an icon-button row under it (download /
// redesign / recolour / mark-for-image-edit / free-this-space, then one brand-mark
// publish button per platform — फेसबुक live, X disabled), the caption as an ALWAYS-EDITABLE
// textarea with copy (and, on a run that has none, generate) icons in its bottom-right
// corner, the marker notes for whatever the user has marked on the poster, and one
// "बदल हवा आहे?" fold whose two pills switch between the caption and the poster change
// request. The hand edit has no save button: it autosaves when focus leaves the box.

import { useState } from 'react';
import type {
  GenerationDetail,
  PosterImageFeedbackRequest,
} from '@dgipr/schemas';
import {
  Copy,
  Download,
  // Palette — the "वेगळ्या रंगात तयार करा" recolour redo, hidden from the UI (see the
  // commented button below). Restore this import with it.
  RotateCw,
  SquareDashed,
  SquarePen,
} from 'lucide-react';
import {
  generateCaption,
  posterDownloadUrl,
  publishGeneration,
  regeneratePoster,
  sendCaptionFeedback,
  sendPosterImageFeedback,
  updateCaption,
} from '../lib/api';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { ClearActionToggle, clearActionLabel } from './ClearActionToggle';
import { FacebookLogo } from './FacebookLogo';
import { XLogo } from './XLogo';
import {
  CLEAR_LETTERS,
  PosterAnnotator,
  type AnnotatorMode,
} from './PosterAnnotator';
import { PosterVersionStrip } from './PosterVersionStrip';
import { CanvaLink } from './CanvaLink';
// The caption, the marker notes and the change note are all written in Marathi on an InScript
// keyboard, which a controlled box can overwrite half-formed. See ComposeSafeInput.
import { ComposeSafeInput, ComposeSafeTextarea } from './ComposeSafeInput';
import { ErrorNotice } from './ErrorNotice';

type ChangeTab = 'caption' | 'poster';

export function SocialPostView({
  detail,
  onChanged,
  busy = false,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  busy?: boolean;
  // Fired once a POSTER edit has been accepted by the API, handing the run to the navbar's
  // सुरू असलेली कामे panel so it can be followed after leaving this page. Poster work only:
  // a caption edit or revision touches no image, and this run's caption is already on screen
  // here with its own inline indicator. Called after the await — these routes flip the row to
  // running before their 202, and the panel files a still-`completed` row as terminal.
  onImageWorkStarted?: (() => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);
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
  // The caption is always live. `baseline` is the server's text: when it changes —
  // an AI revision landed, or the page reloaded — both reset, but ONLY while the box
  // is clean, so a refresh can never wipe something half-typed.
  const [captionDraft, setCaptionDraft] = useState(detail.article ?? '');
  const [captionBaseline, setCaptionBaseline] = useState(detail.article ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionSaved, setCaptionSaved] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  // Asking for the first caption on a run created poster-only. Local only until the
  // 202 lands; after that detail.captionRevising drives the state, like the AI revision.
  const [startingCaption, setStartingCaption] = useState(false);
  // One fold, two change requests. Both drafts live here so switching a pill is a
  // pure view change — nothing typed is thrown away.
  const [changeTab, setChangeTab] = useState<ChangeTab>('caption');
  const [captionChange, setCaptionChange] = useState('');
  const [posterChange, setPosterChange] = useState('');
  const [sendingChange, setSendingChange] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const captionDirty = captionDraft !== captionBaseline;
  if (
    !captionDirty &&
    detail.article !== null &&
    detail.article !== captionBaseline
  ) {
    setCaptionBaseline(detail.article);
    setCaptionDraft(detail.article);
  }
  // Code points, not `.length`: the label reads "अक्षरे", so an emoji counts once.
  const captionLength = Array.from(captionDraft).length;
  // The caption revision runs off the row's status (like translation), so it is read
  // from the payload flag rather than from `busy`.
  const captionRevising = detail.captionRevising;
  const captionMissing = detail.article === null;
  const captionGenerating =
    captionMissing && (startingCaption || captionRevising);
  const showSpinner = busy || pending;
  const settled = detail.status === 'completed' && !showSpinner;
  // Poster edits do NOT need a completed row — every poster route (image-feedback,
  // regenerate, restore) asks only for a poster and no running job. Gating them on
  // 'completed' is what left a run whose last edit failed with a visible poster and no way
  // to touch it; a run recovered from such a failure must be able to carry straight on.
  const posterEditable =
    detail.posterUrl !== null &&
    (detail.status === 'completed' || detail.status === 'failed') &&
    !showSpinner;

  // Copies what is on screen, so an unsaved hand edit copies as the user sees it.
  const copyCaption = async () => {
    if (!captionDraft) return;
    try {
      await navigator.clipboard.writeText(captionDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  // Autosave: the box has no save button, so leaving it is the commit. Silent when
  // nothing changed, and never fires mid-revision (the job owns the column then).
  const saveCaptionOnBlur = async () => {
    if (!captionDirty || savingCaption || captionRevising) return;
    const text = captionDraft.trim();
    // An empty box on a run that never had a caption is not an edit to persist.
    if (text.length === 0) return;
    setSavingCaption(true);
    setCaptionError(null);
    try {
      const saved = await updateCaption(detail.id, text);
      setCaptionBaseline(saved);
      setCaptionDraft(saved);
      setCaptionSaved(true);
      setTimeout(() => setCaptionSaved(false), 2500);
      // Pull the row back so publish + history read the saved text (this row is
      // settled, so no poll is running).
      await onChanged();
    } catch (error) {
      setCaptionError(errorMessage(error));
    } finally {
      setSavingCaption(false);
    }
  };

  // First caption for a poster-only run. The job reports through captionRevising, so
  // this only has to survive the gap until the next poll. An existing caption is
  // changed through the fold below instead — the generate route refuses to overwrite.
  const startCaption = async () => {
    setStartingCaption(true);
    setCaptionError(null);
    try {
      await generateCaption(detail.id);
      await onChanged();
    } catch (error) {
      setCaptionError(errorMessage(error));
    } finally {
      setStartingCaption(false);
    }
  };

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

  const sendChange = async (target: ChangeTab = changeTab) => {
    if (sendingChange) return;
    setChangeError(null);
    if (target === 'caption') {
      const text = captionChange.trim();
      if (text.length < 3) {
        setChangeError(STR.feedbackTooShort);
        return;
      }
      setSendingChange(true);
      try {
        await sendCaptionFeedback(detail.id, text);
        setCaptionChange('');
        await onChanged();
      } catch (e) {
        setChangeError(errorMessage(e));
      } finally {
        setSendingChange(false);
      }
      return;
    }
    const text = posterChange.trim();
    if (markers.length === 0 && clearRegions.length === 0 && text.length < 3) {
      setChangeError(STR.feedbackTooShort);
      return;
    }
    if (markers.some((m) => m.note.trim().length < 3)) {
      setChangeError(STR.markerNoteTooShort);
      return;
    }
    // The schema wants absent keys, not '' / [] (min lengths reject those). A
    // clear region's note is genuinely optional — an empty one means "you decide
    // where that content goes" — so it is omitted rather than sent blank.
    const payload: PosterImageFeedbackRequest = {
      ...(text.length >= 3 ? { feedback: text } : {}),
      ...(markers.length > 0
        ? {
            annotations: markers.map((m) => ({
              region: m.region,
              note: m.note.trim(),
            })),
          }
        : {}),
      ...(clearRegions.length > 0
        ? {
            clearRegions: clearRegions.map((c) => ({
              region: c.region,
              action: c.action,
              ...(c.note.trim().length > 0 ? { note: c.note.trim() } : {}),
            })),
          }
        : {}),
    };
    setSendingChange(true);
    setPending(true);
    try {
      await sendPosterImageFeedback(detail.id, payload);
      markSubmitted();
      setPosterChange('');
      setAnnotMode(null);
      onImageWorkStarted?.();
      await onChanged();
    } catch (e) {
      setChangeError(errorMessage(e));
    } finally {
      setSendingChange(false);
      setPending(false);
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
  const changeSuggestions =
    changeTab === 'caption' ? STR.chipsCaption : STR.chipsPosterImage;
  const changeDraft = changeTab === 'caption' ? captionChange : posterChange;
  const setChangeDraft =
    changeTab === 'caption' ? setCaptionChange : setPosterChange;

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
            <div className="poster-frame">
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
                href={posterDownloadUrl(detail.id)}
                title={STR.iconDownloadPoster}
                aria-label={STR.iconDownloadPoster}
              >
                <Download size={18} strokeWidth={1.9} aria-hidden="true" />
              </a>
              <CanvaLink generationId={detail.id} />
              <button
                type="button"
                className="icon-btn"
                title={STR.iconRedesignPoster}
                aria-label={STR.iconRedesignPoster}
                disabled={!posterEditable}
                onClick={() => void redoPoster(false)}
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
                onClick={() => {
                  const next = annotMode === 'mark' ? null : 'mark';
                  setAnnotMode(next);
                  // Marking only feeds the poster request, so send the fold there too.
                  if (next) setChangeTab('poster');
                }}
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
                onClick={() => {
                  const next = annotMode === 'clear' ? null : 'clear';
                  setAnnotMode(next);
                  if (next) setChangeTab('poster');
                }}
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
                  aria-busy={sendingChange}
                  disabled={showSpinner || sendingChange}
                  onClick={() => void sendChange('poster')}
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
          <div className="caption-editor">
            <label className="caption-label" htmlFor="social-caption">
              {STR.captionLabel}
            </label>
            <div className="caption-box">
              <ComposeSafeTextarea
                id="social-caption"
                className="social-caption-edit"
                value={captionDraft}
                onChange={(next) => {
                  setCaptionDraft(next);
                  setCaptionError(null);
                }}
                onBlur={() => void saveCaptionOnBlur()}
                rows={10}
                readOnly={captionMissing}
                tabIndex={captionMissing ? -1 : undefined}
                disabled={savingCaption || captionRevising}
                aria-label={STR.captionLabel}
              />
              {captionMissing ? (
                <div className="caption-generate-overlay">
                  <button
                    type="button"
                    className="btn btn-primary caption-generate-button"
                    aria-label={
                      captionGenerating
                        ? STR.captionGenerating
                        : STR.captionGenerate
                    }
                    disabled={!settled || captionGenerating}
                    onClick={() => void startCaption()}
                  >
                    {captionGenerating ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      STR.captionGenerate
                    )}
                  </button>
                </div>
              ) : (
                <div className="caption-box-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    title={copied ? STR.copied : STR.iconCopyCaption}
                    aria-label={copied ? STR.copied : STR.iconCopyCaption}
                    disabled={captionDraft.length === 0}
                    onClick={() => void copyCaption()}
                  >
                    <Copy size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <div className="caption-meta">
              <span className="caption-counter">
                {captionLength} {STR.captionCounterLabel}
              </span>
            </div>
            {captionRevising || startingCaption ? (
              <span className="translating-note">
                <span className="spinner" aria-hidden="true" />
                {startingCaption ? STR.captionGenerating : STR.revisingCaption}
              </span>
            ) : null}
            {savingCaption ? (
              <p className="hint">{STR.captionSavingShort}</p>
            ) : null}
            {captionSaved ? (
              <p className="form-success">{STR.captionSaved}</p>
            ) : null}
            {captionError ? <ErrorNotice message={captionError} /> : null}
            {detail.captionReviseError ? (
              <ErrorNotice message={detail.captionReviseError} />
            ) : null}
          </div>

          {/* Marker notes: shown only once something is actually marked on the poster
              (or a marked round was just sent). Their submit action sits below the
              poster icons; the fold below remains for optional whole-poster feedback. */}
          {detail.posterUrl &&
          (markers.length > 0 || submittedMarkers.length > 0) ? (
            <div className="marker-notes">
              <p className="hint">
                {markers.length > 0
                  ? STR.posterAnnotateHint
                  : STR.markersSubmittedHint}
              </p>
              {markers.length === 0 ? (
                submittedMarkers.map((marker, i) => (
                  <div
                    className="marker-note-row marker-note-submitted"
                    key={`s-${marker.id}`}
                  >
                    <span className="marker-note-badge" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="marker-note-text">{marker.note}</span>
                  </div>
                ))
              ) : (
                <>
                  {markers.map((marker, i) => (
                    <div className="marker-note-row" key={marker.id}>
                      <span className="marker-note-badge" aria-hidden="true">
                        {i + 1}
                      </span>
                      <ComposeSafeInput
                        type="text"
                        value={marker.note}
                        placeholder={STR.markerNotePlaceholder}
                        aria-label={`${STR.markerLabel} ${i + 1}`}
                        maxLength={500}
                        disabled={showSpinner || sendingChange}
                        onChange={(next) => setNote(marker.id, next)}
                      />
                      <button
                        type="button"
                        className="marker-note-remove"
                        aria-label={STR.markerRemove}
                        disabled={showSpinner || sendingChange}
                        onClick={() => removeMarker(marker.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : null}

          {/* The blue "free this space" boxes. Their note is OPTIONAL — an empty
              one means "you decide where that content goes" — so there is no
              too-short validation here and none of these rows can block a send. */}
          {detail.posterUrl &&
          (clearRegions.length > 0 || submittedClearRegions.length > 0) ? (
            <div className="marker-notes">
              <p className="hint">
                {clearRegions.length > 0
                  ? STR.clearRegionHint
                  : STR.clearRegionSubmittedHint}
              </p>
              {clearRegions.length === 0
                ? submittedClearRegions.map((c, i) => (
                    <div
                      className="marker-note-row marker-note-submitted"
                      key={`sc-${c.id}`}
                    >
                      <span
                        className="marker-note-badge clear-badge"
                        aria-hidden="true"
                      >
                        {CLEAR_LETTERS[i] ?? i + 1}
                      </span>
                      <span className="marker-note-text">
                        {clearActionLabel(c.action)}
                        {c.note ? ` — ${c.note}` : ''}
                      </span>
                    </div>
                  ))
                : clearRegions.map((c, i) => (
                    <div key={c.id}>
                      <div className="marker-note-row">
                        <span
                          className="marker-note-badge clear-badge"
                          aria-hidden="true"
                        >
                          {CLEAR_LETTERS[i] ?? i + 1}
                        </span>
                        <ComposeSafeInput
                          type="text"
                          value={c.note}
                          placeholder={STR.clearRegionNotePlaceholder}
                          aria-label={`${STR.clearRegionLabel} ${CLEAR_LETTERS[i] ?? i + 1}`}
                          maxLength={500}
                          disabled={showSpinner || sendingChange}
                          onChange={(next) => setClearNote(c.id, next)}
                        />
                        <button
                          type="button"
                          className="marker-note-remove"
                          aria-label={STR.clearRegionRemove}
                          disabled={showSpinner || sendingChange}
                          onClick={() => removeClearRegion(c.id)}
                        >
                          ✕
                        </button>
                      </div>
                      <ClearActionToggle
                        value={c.action}
                        letter={String(CLEAR_LETTERS[i] ?? i + 1)}
                        disabled={showSpinner || sendingChange}
                        onChange={(action) => setClearAction(c.id, action)}
                      />
                    </div>
                  ))}
            </div>
          ) : null}

          {/* One place for the error whenever anything is annotated — the submit
              button for that case sits under the poster, and the fold below shows
              it instead when there is nothing annotated. */}
          {changeError && (markers.length > 0 || clearRegions.length > 0) ? (
            <ErrorNotice message={changeError} />
          ) : null}

          {/* One fold for both change requests. The pills only swap the view — each
              draft is kept, so a half-typed caption note survives a look at the poster. */}
          {detail.article !== null || detail.posterUrl ? (
            <details
              className="fold change-request"
              aria-disabled={showSpinner}
            >
              <summary>{STR.changeRequestTitle}</summary>
              <div className="fold-body">
                <div className="change-pills" role="tablist">
                  {detail.article !== null ? (
                    <button
                      type="button"
                      role="tab"
                      className="change-pill"
                      aria-selected={changeTab === 'caption'}
                      onClick={() => {
                        setChangeTab('caption');
                        setChangeError(null);
                      }}
                    >
                      {STR.changeTabCaption}
                    </button>
                  ) : null}
                  {detail.posterUrl ? (
                    <button
                      type="button"
                      role="tab"
                      className="change-pill"
                      aria-selected={changeTab === 'poster'}
                      onClick={() => {
                        setChangeTab('poster');
                        setChangeError(null);
                      }}
                    >
                      {STR.changeTabPoster}
                    </button>
                  ) : null}
                </div>
                <p className="hint">
                  {changeTab === 'caption'
                    ? STR.captionFeedbackHint
                    : STR.posterImageFeedbackHint}
                </p>
                {changeSuggestions.length > 0 ? (
                  <div className="suggestion-row">
                    <span className="suggestion-label">
                      {STR.feedbackSuggestionsLabel}
                    </span>
                    {changeSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="suggestion-chip"
                        disabled={showSpinner || sendingChange}
                        onClick={() => {
                          setChangeDraft(suggestion);
                          setChangeError(null);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
                <ComposeSafeTextarea
                  value={changeDraft}
                  onChange={(next) => {
                    setChangeDraft(next);
                    setChangeError(null);
                  }}
                  placeholder={
                    changeTab === 'caption'
                      ? STR.changeCaptionPlaceholder
                      : markers.length > 0
                        ? STR.posterOverallNotePlaceholder
                        : STR.changePosterPlaceholder
                  }
                  rows={3}
                  disabled={
                    showSpinner ||
                    sendingChange ||
                    (changeTab === 'caption' && captionRevising)
                  }
                  style={{ marginTop: 10 }}
                />
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      showSpinner ||
                      sendingChange ||
                      (changeTab === 'caption' && captionRevising)
                    }
                    onClick={() => void sendChange()}
                  >
                    {sendingChange ? STR.sendingFeedback : STR.sendFeedback}
                  </button>
                </div>
                {changeError &&
                markers.length === 0 &&
                clearRegions.length === 0 ? (
                  <ErrorNotice message={changeError} />
                ) : null}
              </div>
            </details>
          ) : null}
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
