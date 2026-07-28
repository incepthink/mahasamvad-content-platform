'use client';

// Completed-state view for a Twitter/Facebook run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface).
//
// Layout, top to bottom: the poster with an icon-button row under it (download /
// redesign / recolour / publish / mark-for-image-edit), the caption as an ALWAYS-EDITABLE
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
  Palette,
  RotateCw,
  Share2,
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
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { CrossFormatLinks } from './CrossFormatLinks';
import { PosterAnnotator } from './PosterAnnotator';
import { PosterVersionStrip } from './PosterVersionStrip';

type ChangeTab = 'caption' | 'poster';

export function SocialPostView({
  detail,
  onChanged,
  busy = false,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  busy?: boolean;
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
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers(detail);
  // Armed by the pencil icon under the poster (which shows as pressed while on),
  // not by opening a fold — marking is now its own explicit mode.
  const [annotOpen, setAnnotOpen] = useState(false);
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
      setCaptionError(
        error instanceof Error ? error.message : STR.genericError,
      );
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
      setCaptionError(
        error instanceof Error ? error.message : STR.genericError,
      );
    } finally {
      setStartingCaption(false);
    }
  };

  const publish = async () => {
    setPublishingPost(true);
    setPublishError(null);
    try {
      const postUrl = await publishGeneration(detail.id);
      setJustPublishedUrl(postUrl);
      setConfirmingPublish(false);
      // Pull the refreshed detail so the persisted publishedUrl arrives (the
      // poll has stopped on this completed row).
      await onChanged();
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : STR.genericError,
      );
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
        setChangeError(e instanceof Error ? e.message : STR.genericError);
      } finally {
        setSendingChange(false);
      }
      return;
    }
    const text = posterChange.trim();
    if (markers.length === 0 && text.length < 3) {
      setChangeError(STR.feedbackTooShort);
      return;
    }
    if (markers.some((m) => m.note.trim().length < 3)) {
      setChangeError(STR.markerNoteTooShort);
      return;
    }
    // The schema wants absent keys, not '' / [] (min lengths reject those).
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
    };
    setSendingChange(true);
    setPending(true);
    try {
      await sendPosterImageFeedback(detail.id, payload);
      markSubmitted();
      setPosterChange('');
      setAnnotOpen(false);
      await onChanged();
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSendingChange(false);
      setPending(false);
    }
  };

  const publishLabel =
    detail.category === 'facebook' ? STR.publishToFacebook : STR.publishToX;
  const liveUrl = justPublishedUrl ?? detail.publishedUrl;
  const canPublish =
    detail.status === 'completed' &&
    detail.posterUrl !== null &&
    detail.article !== null &&
    !showSpinner &&
    // X publishing is held back for now; Facebook is live.
    detail.category !== 'twitter';
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
      <div className="poster-layout">
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
              <button
                type="button"
                className="icon-btn"
                title={STR.iconRedesignPoster}
                aria-label={STR.iconRedesignPoster}
                disabled={!settled}
                onClick={() => void redoPoster(false)}
              >
                <RotateCw size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={STR.iconRecolourPoster}
                aria-label={STR.iconRecolourPoster}
                disabled={!settled}
                onClick={() => void redoPoster(true)}
              >
                <Palette size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={canPublish ? publishLabel : STR.iconPublishDisabled}
                aria-label={canPublish ? publishLabel : STR.iconPublishDisabled}
                disabled={!canPublish || publishingPost}
                onClick={() => {
                  setConfirmingPublish(true);
                  setPublishError(null);
                }}
              >
                <Share2 size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                // Pressed state = marking is armed, so the poster reads as editable.
                aria-pressed={annotOpen}
                title={annotOpen ? STR.iconEditPosterOn : STR.iconEditPoster}
                aria-label={
                  annotOpen ? STR.iconEditPosterOn : STR.iconEditPoster
                }
                disabled={showSpinner}
                onClick={() => {
                  const next = !annotOpen;
                  setAnnotOpen(next);
                  // Marking only feeds the poster request, so send the fold there too.
                  if (next) setChangeTab('poster');
                }}
              >
                <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
              {/* Last in the row, and the only entry that navigates rather than acting
                  on this run — the trailing arrow is what says so. */}
              <CrossFormatLinks
                generationId={detail.id}
                category={detail.category}
              />
            </div>
            {markers.length > 0 ? (
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
            {publishError ? <p className="form-error">{publishError}</p> : null}
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
          {/* A कॅप्शन-only run has no poster and therefore no icon row above, so the
              cross-format links get one of their own here. */}
          {!detail.posterUrl ? (
            <div className="poster-icon-actions" style={{ marginTop: 0 }}>
              <CrossFormatLinks
                generationId={detail.id}
                category={detail.category}
              />
            </div>
          ) : null}
          {/* The caption is a live textarea from the first render — no "बदल करा" step.
              A poster-only run gets an empty one plus the generate icon. */}
          <div className="caption-editor">
            <label className="caption-label" htmlFor="social-caption">
              {STR.captionLabel}
            </label>
            <div className="caption-box">
              <textarea
                id="social-caption"
                className="social-caption-edit"
                value={captionDraft}
                onChange={(e) => {
                  setCaptionDraft(e.target.value);
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
              <span className="hint">{STR.captionAutosaveHint}</span>
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
            {captionError ? <p className="form-error">{captionError}</p> : null}
            {detail.captionReviseError ? (
              <p className="form-error">{detail.captionReviseError}</p>
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
                      <input
                        type="text"
                        value={marker.note}
                        placeholder={STR.markerNotePlaceholder}
                        aria-label={`${STR.markerLabel} ${i + 1}`}
                        maxLength={500}
                        disabled={showSpinner || sendingChange}
                        onChange={(e) => setNote(marker.id, e.target.value)}
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
                  {changeError ? (
                    <p className="form-error">{changeError}</p>
                  ) : null}
                </>
              )}
            </div>
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
                <textarea
                  value={changeDraft}
                  onChange={(e) => {
                    setChangeDraft(e.target.value);
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
                {changeError && markers.length === 0 ? (
                  <p className="form-error">{changeError}</p>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <PosterVersionStrip detail={detail} />
    </section>
  );
}
