'use client';

// The social caption as an ALWAYS-EDITABLE textarea — shared by the social poster card
// (SocialPostView) and the carousel card (CarouselView), both of which store their caption in
// the run's `article` column and reach the same three routes (generate, hand edit, AI revision).
// Extracted rather than copied so the two cannot drift: the autosave-on-blur rule, the
// "never overwrite something half-typed" baseline rule and the generate overlay live here once.
//
// The hand edit has no save button: leaving the box is the commit. A run created without a
// caption gets an empty read-only box with a generate button over it.
//
// `revision` adds the edit assistant (EditChat, caption-only) under the box. SocialPostView
// does not ask for it — its own assistant serves the caption and the poster together — while
// the carousel, whose slide edits live on the slides, has nothing else to put it in.

import { useState } from 'react';
import type { EditAssistantAction, GenerationDetail } from '@dgipr/schemas';
import { Copy } from 'lucide-react';
import {
  generateCaption,
  sendCaptionFeedback,
  updateCaption,
} from '../lib/api';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
// Written in Marathi on an InScript keyboard, which a controlled box can overwrite
// half-formed. See ComposeSafeInput.
import { ComposeSafeTextarea } from './ComposeSafeInput';
import { EditChat } from './EditChat';
import { ErrorNotice } from './ErrorNotice';

export function SocialCaptionEditor({
  detail,
  onChanged,
  busy = false,
  revision = false,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // An image job in flight on the same card. The caption is still editable then, but a
  // FIRST caption is not started until the run settles — its own job writes that column.
  busy?: boolean;
  revision?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // `baseline` is the server's text: when it changes — an AI revision landed, or the page
  // reloaded — both reset, but ONLY while the box is clean, so a refresh can never wipe
  // something half-typed.
  const [captionDraft, setCaptionDraft] = useState(detail.article ?? '');
  const [captionBaseline, setCaptionBaseline] = useState(detail.article ?? '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [captionSaved, setCaptionSaved] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  // Asking for the first caption on a run created without one. Local only until the 202
  // lands; after that detail.captionRevising drives the state, like the AI revision.
  const [startingCaption, setStartingCaption] = useState(false);

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
  // The caption revision runs off the row's status (like translation), so it is read from
  // the payload flag rather than from `busy`.
  const captionRevising = detail.captionRevising;
  const captionMissing = detail.article === null;
  const captionGenerating =
    captionMissing && (startingCaption || captionRevising);
  const settled = detail.status === 'completed' && !busy;

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

  // Autosave: the box has no save button, so leaving it is the commit. Silent when nothing
  // changed, and never fires mid-revision (the job owns the column then).
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
      // Pull the row back so publish + history read the saved text (this row is settled,
      // so no poll is running).
      await onChanged();
    } catch (error) {
      setCaptionError(errorMessage(error));
    } finally {
      setSavingCaption(false);
    }
  };

  // First caption for a run made without one. The job reports through captionRevising, so
  // this only has to survive the gap until the next poll. An existing caption is changed
  // through the revision fold instead — the generate route refuses to overwrite.
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

  // One step of the edit assistant's plan. On this surface it can only touch the caption,
  // through the same routes the old revision fold used.
  const executeAction = async (action: EditAssistantAction) => {
    if (action.type === 'caption_revise') {
      await sendCaptionFeedback(detail.id, action.instruction);
      await onChanged();
    } else if (action.type === 'caption_generate') {
      await generateCaption(detail.id);
      await onChanged();
    }
  };

  return (
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
                captionGenerating ? STR.captionGenerating : STR.captionGenerate
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
      {savingCaption ? <p className="hint">{STR.captionSavingShort}</p> : null}
      {captionSaved ? <p className="form-success">{STR.captionSaved}</p> : null}
      {captionError ? <ErrorNotice message={captionError} /> : null}
      {detail.captionReviseError ? (
        <ErrorNotice message={detail.captionReviseError} />
      ) : null}

      {revision ? (
        <EditChat
          generationId={detail.id}
          surface="caption"
          onExecute={executeAction}
          hint={STR.editChatHintCaption}
          placeholder={STR.editChatPlaceholderCaption}
        />
      ) : null}
    </div>
  );
}
