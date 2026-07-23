'use client';

// Completed-state view for a Twitter/n8n run on the detail page (the "पूर्ण पाहा"
// link-out target; the navbar tasks panel is the primary surface). Shows the poster
// + caption with copy / download / regenerate, iterative poster image feedback, and
// the caption's own two edit paths: describe the change and let the caption editor
// rewrite it, or open the hand editor and type it yourself. A finished post reads as
// a finished post, so the caption is a read-only block until the user asks to edit it.

import { useState } from 'react';
import type { GenerationDetail } from '@dgipr/schemas';
import {
  posterDownloadUrl,
  publishGeneration,
  sendCaptionFeedback,
  sendPosterImageFeedback,
  updateCaption,
} from '../lib/api';
import { STR } from '../lib/strings';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { FeedbackBox } from './FeedbackBox';
import { PosterAnnotator } from './PosterAnnotator';
import { PosterImageFeedbackBox } from './PosterImageFeedbackBox';
import { PosterVersionStrip } from './PosterVersionStrip';

export function SocialPostView({
  detail,
  onRegenerate,
  onChanged,
  busy = false,
}: {
  detail: GenerationDetail;
  onRegenerate: () => Promise<void>;
  onChanged: () => Promise<void>;
  busy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
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
  const [annotOpen, setAnnotOpen] = useState(false);
  // Hand-edited caption, opened on demand — by default the caption is a read-only
  // block. `baseline` is the server's text: when it changes — an AI revision landed, or
  // the page reloaded — both reset, so the server always wins on a real change. Skipped
  // while the editor is open so a refresh can't wipe what is being typed; that is safe
  // because the AI feedback box is disabled meanwhile and nothing else writes `article`.
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(detail.article ?? '');
  const [captionBaseline, setCaptionBaseline] = useState(detail.article ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionSaved, setCaptionSaved] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  if (
    !editingCaption &&
    detail.article !== null &&
    detail.article !== captionBaseline
  ) {
    setCaptionBaseline(detail.article);
    setCaptionDraft(detail.article);
  }
  const captionDirty = captionDraft.trim() !== captionBaseline.trim();
  // Code points, not `.length`: the label reads "अक्षरे", so an emoji counts once.
  const captionLength = Array.from(captionDraft).length;
  // The caption revision runs off the row's status (like translation), so it is read
  // from the payload flag rather than from `busy`.
  const captionRevising = detail.captionRevising;
  const showSpinner = busy || pending;

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

  const saveCaption = async () => {
    setSavingCaption(true);
    setCaptionError(null);
    try {
      const saved = await updateCaption(detail.id, captionDraft.trim());
      setCaptionBaseline(saved);
      setCaptionDraft(saved);
      setCaptionSaved(true);
      // Back to the read-only block; on failure the editor stays open so the
      // typed text is not lost.
      setEditingCaption(false);
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

  const regenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
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

  const publishLabel =
    detail.category === 'facebook' ? STR.publishToFacebook : STR.publishToX;
  const liveUrl = justPublishedUrl ?? detail.publishedUrl;
  const canPublish =
    detail.status === 'completed' &&
    detail.posterUrl !== null &&
    detail.article !== null &&
    !showSpinner;

  return (
    <section className="card">
      <h2>{STR.posterTitle}</h2>
      <div className="poster-layout">
        {detail.posterUrl ? (
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
        ) : null}
        <div>
          {detail.article ? (
            <div className="caption-editor">
              {editingCaption ? (
                <>
                  <label className="caption-label" htmlFor="social-caption">
                    {STR.captionLabel}
                  </label>
                  <textarea
                    id="social-caption"
                    className="social-caption-edit"
                    value={captionDraft}
                    onChange={(e) => {
                      setCaptionDraft(e.target.value);
                      setCaptionError(null);
                    }}
                    rows={8}
                    disabled={savingCaption || captionRevising}
                    aria-label={STR.captionLabel}
                  />
                </>
              ) : (
                <>
                  <span className="caption-label">{STR.captionLabel}</span>
                  <p className="social-caption">{detail.article}</p>
                </>
              )}
              <div className="caption-meta">
                {editingCaption ? (
                  <span className="hint">{STR.captionEditHint}</span>
                ) : (
                  <span className="caption-counter">
                    {captionLength} {STR.captionCounterLabel}
                  </span>
                )}
                {editingCaption ? null : (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={captionRevising}
                    onClick={() => {
                      setCaptionDraft(detail.article ?? '');
                      setCaptionError(null);
                      setEditingCaption(true);
                    }}
                  >
                    {STR.captionEdit}
                  </button>
                )}
              </div>
              {editingCaption ? (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    disabled={!captionDirty || savingCaption || captionRevising}
                    onClick={saveCaption}
                  >
                    {savingCaption ? STR.captionSaving : STR.captionSave}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={savingCaption}
                    onClick={() => {
                      setCaptionDraft(captionBaseline);
                      setCaptionError(null);
                      setEditingCaption(false);
                    }}
                  >
                    {STR.captionRevert}
                  </button>
                </div>
              ) : null}
              {captionSaved ? (
                <p className="form-success">{STR.captionSaved}</p>
              ) : null}
              {captionError ? (
                <p className="form-error">{captionError}</p>
              ) : null}
            </div>
          ) : null}
          <div className="btn-row" style={{ marginTop: 18 }}>
            {detail.posterUrl ? (
              <a
                className="btn btn-primary"
                href={posterDownloadUrl(detail.id)}
              >
                {STR.taskDownloadPoster}
              </a>
            ) : null}
            {detail.article ? (
              <button type="button" className="btn" onClick={copyCaption}>
                {copied ? STR.copied : STR.taskCopyCaption}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={regenerating || showSpinner}
              onClick={regenerate}
            >
              {STR.taskRegenerate}
            </button>
            {canPublish && !confirmingPublish ? (
              <button
                type="button"
                className="btn"
                disabled={publishingPost}
                onClick={() => {
                  setConfirmingPublish(true);
                  setPublishError(null);
                }}
              >
                {liveUrl ? STR.publishAgain : publishLabel}
              </button>
            ) : null}
          </div>
          {confirmingPublish ? (
            <div className="info-callout" style={{ marginTop: 12 }}>
              <p>{STR.publishConfirmHint}</p>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={publishingPost}
                  onClick={publish}
                >
                  {publishingPost ? STR.publishing : STR.publishConfirmYes}
                </button>
                <button
                  type="button"
                  className="btn"
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
          {detail.article ? (
            <div className="poster-feedback">
              {captionRevising ? (
                <span className="translating-note">
                  <span className="spinner" aria-hidden="true" />
                  {STR.revisingCaption}
                </span>
              ) : (
                <FeedbackBox
                  title={STR.captionFeedbackTitle}
                  hint={
                    editingCaption
                      ? STR.captionDirtyBlocksAi
                      : STR.captionFeedbackHint
                  }
                  suggestions={STR.chipsCaption}
                  // A hand edit in progress would be overwritten by the revision this
                  // sends (the job rewrites the SERVER's caption); make the user close
                  // the editor — saved or reverted — first.
                  disabled={editingCaption}
                  onSubmit={async (feedback) => {
                    await sendCaptionFeedback(detail.id, feedback);
                    await onChanged();
                  }}
                />
              )}
              {detail.captionReviseError ? (
                <p className="form-error">{detail.captionReviseError}</p>
              ) : null}
            </div>
          ) : null}
          {detail.posterUrl ? (
            <div className="poster-feedback">
              <PosterImageFeedbackBox
                markers={markers}
                onNoteChange={setNote}
                onRemoveMarker={removeMarker}
                onOpenChange={setAnnotOpen}
                disabled={showSpinner}
                submittedMarkers={submittedMarkers}
                onSubmit={async (payload) => {
                  setPending(true);
                  try {
                    await sendPosterImageFeedback(detail.id, payload);
                    markSubmitted();
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <PosterVersionStrip detail={detail} />
    </section>
  );
}
