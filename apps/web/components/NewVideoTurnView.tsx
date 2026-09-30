'use client';

// One turn of the /new-video-workflow EXPERIMENT: the instruction on the right, the video
// under it on the left — the ChatMessageBubble shape, so the two surfaces read alike.
//
// The one deliberate departure from the rest of the product: a failure shows the PROVIDER'S
// OWN WORDS rather than a canned Marathi sentence. Everywhere else `storedErrorMessage`
// replaces an English internal message, and rightly so — but this page exists to read what
// the Gemini API says (a safety-filter reason, a rejected parameter, a quota wall), and
// normalising that away would defeat the whole experiment.

import { useState } from 'react';
import {
  Check,
  Copy,
  CornerDownRight,
  ImagePlus,
  Sparkles,
} from 'lucide-react';
import type {
  NewVideoGeneratedImage,
  NewVideoMode,
  NewVideoPendingImage,
  NewVideoTurn,
} from '@dgipr/schemas';
import { MarkdownText } from './MarkdownText';
import { STR } from '../lib/strings';

function StatusLine({ status }: { status: NewVideoTurn['status'] }) {
  if (status === 'queued') {
    return (
      <p className="nvw-status" role="status">
        <span className="chat-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {STR.nvwQueued}
      </p>
    );
  }
  return (
    <p className="nvw-status" role="status">
      <span className="spinner" aria-hidden="true" />
      {STR.nvwGenerating}
    </p>
  );
}

// The pictures a storyboard answer generated, under the text they belong to. Each opens full
// size in a new tab — they are storyboard frames an officer will want to look at closely.
function GeneratedImages({
  images,
  pending,
}: {
  images: readonly NewVideoGeneratedImage[];
  pending: readonly NewVideoPendingImage[];
}) {
  if (images.length === 0 && pending.length === 0) return null;
  return (
    <figure className="nvw-sb-images" aria-label={STR.nvwStoryboardImages}>
      {images.map((image) => (
        <a
          key={image.id}
          href={image.url}
          target="_blank"
          rel="noreferrer"
          className="nvw-sb-image"
          title={`${STR.nvwStoryboardImageOpen}${image.label !== '' ? ` — ${image.label}` : ''}`}
        >
          {/* A plain <img>, like every other remote image in this app: a runtime URL from
              our own public bucket. */}
          <img
            src={image.url}
            alt={image.label || image.prompt}
            loading="lazy"
          />
          {image.label !== '' ? (
            <figcaption className="nvw-sb-image-label">
              {image.label}
            </figcaption>
          ) : null}
        </a>
      ))}
      {/* A picture still being drawn sits where it will land, at its own proportions, so
          the finished one replaces it without the answer jumping. */}
      {pending.map((image, index) => (
        <div
          key={`pending-${index}`}
          className="nvw-sb-pending"
          role="status"
          title={STR.nvwStoryboardImageCreatingHint}
        >
          <div
            className="nvw-sb-pending-canvas"
            data-orientation={image.orientation}
          >
            <span className="nvw-sb-pending-blob" aria-hidden="true" />
            <span className="nvw-sb-pending-badge">
              <Sparkles size={14} aria-hidden="true" />
              {STR.nvwStoryboardImageCreating}
            </span>
          </div>
          {image.label !== '' ? (
            <span className="nvw-sb-image-label">{image.label}</span>
          ) : null}
        </div>
      ))}
    </figure>
  );
}

// STORYBOARD MODE's assistant turn: an ordinary chat answer. The text is the assistant's own
// Markdown — scene headings, rules between scenes — rendered as /chat renders an answer; there
// is no scene structure to parse and none is imposed. Shown while it streams.
function StoryboardAnswer({ turn }: { turn: NewVideoTurn }) {
  const [copied, setCopied] = useState(false);
  const text = turn.modelText ?? '';
  const writing = turn.status === 'queued' || turn.status === 'generating';
  // Only a turn still running can be drawing; a settled turn's registry entry is stale by
  // definition, whatever a late poll says.
  const drawing = turn.status === 'generating';
  const drawingNow = drawing && turn.pendingImages.length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard is not worth an error message; the text is selectable.
    }
  };

  return (
    <article className="chat-turn chat-turn--assistant">
      {text !== '' ? (
        <MarkdownText text={text} className="chat-answer nvw-storyboard" />
      ) : null}

      <GeneratedImages
        images={turn.generatedImages}
        pending={drawing ? turn.pendingImages : []}
      />

      {/* While a picture is being drawn the placeholder card IS the status — a "writing"
          line under it would say something untrue. */}
      {writing && !drawingNow ? (
        <p className="nvw-status" role="status">
          <span className="chat-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {STR.nvwStoryboardWriting}
        </p>
      ) : null}

      {turn.status === 'failed' ? (
        <div className="nvw-error" role="alert">
          <p className="nvw-error-title">{STR.nvwStoryboardFailed}</p>
          {turn.error !== null ? (
            <pre className="nvw-error-detail">{turn.error}</pre>
          ) : null}
        </div>
      ) : null}

      {turn.status === 'completed' && text !== '' ? (
        <div className="chat-turn-actions">
          <button type="button" className="btn-ghost chat-copy" onClick={copy}>
            {copied ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            <span>{copied ? STR.chatCopied : STR.chatCopy}</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function NewVideoTurnView({
  turn,
  mode = 'video',
  ordinal,
  canFork,
  forkArmed,
  onFork,
  canRetryFromOriginal = false,
  retryArmed = false,
  onRetryFromOriginal,
}: {
  turn: NewVideoTurn;
  /** Which kind of conversation this turn belongs to — decides how the answer is shown. */
  mode?: NewVideoMode;
  /** 1-based, shown only when naming which video a pending change continues from. */
  ordinal: number;
  /**
   * Whether this turn can be continued from. FALSE on the newest completed turn, which the
   * next instruction already continues from — offering it there would be a button that
   * changes nothing. Also false without a video at all.
   */
  canFork: boolean;
  forkArmed: boolean;
  onFork?: (turnId: string | null) => void;
  /**
   * RETRY FROM THE ORIGINAL PICTURE: offered on a settled video turn that carried pictures.
   * Starts a NEW clip from them rather than editing a video that drifted away from them.
   */
  canRetryFromOriginal?: boolean;
  retryArmed?: boolean;
  onRetryFromOriginal?: (turnId: string | null) => void;
}) {
  const forkable = canFork && onFork !== undefined;
  const retryable = canRetryFromOriginal && onRetryFromOriginal !== undefined;

  return (
    <>
      <article className="chat-turn chat-turn--user">
        <div className="chat-bubble">
          {turn.images.length > 0 ? (
            <div className="chat-attach-images">
              {turn.images.map((image) => (
                /* A plain <img>, like every other remote image in this app: these are runtime
                   URLs from our own public bucket. */
                <img
                  key={image.id}
                  src={image.url}
                  alt={image.name}
                  className="chat-attach-image"
                />
              ))}
            </div>
          ) : null}
          {/* Shown exactly as typed — not Markdown — because this is the string that went to
              the model and the point of the page is to be able to compare it. */}
          <p className="chat-user-text">{turn.prompt}</p>
        </div>
      </article>

      {mode === 'storyboard' ? (
        <StoryboardAnswer turn={turn} />
      ) : (
        <article className="chat-turn chat-turn--assistant">
          {turn.status === 'queued' || turn.status === 'generating' ? (
            <StatusLine status={turn.status} />
          ) : null}

          {turn.videoUrl !== null ? (
            <video
              className="nvw-video"
              src={turn.videoUrl}
              controls
              playsInline
              preload="metadata"
            >
              {STR.nvwVideoUnsupported}
            </video>
          ) : null}

          {turn.modelText !== null && turn.modelText !== '' ? (
            <p className="nvw-model-text">
              <span className="nvw-model-label">{STR.nvwModelSaid}</span>{' '}
              {turn.modelText}
            </p>
          ) : null}

          {/* FORKING (Step 4). Sits under the video rather than beside the prompt because it is
            about the VIDEO — "carry on from this one" — and because it is an occasional
            recovery, not part of the ordinary flow. aria-pressed, so an officer who has
            scrolled away can still see which video the box is now pointed at. */}
          {forkable ? (
            <button
              type="button"
              className={
                forkArmed
                  ? 'btn-ghost nvw-fork is-active'
                  : 'btn-ghost nvw-fork'
              }
              onClick={() => onFork?.(forkArmed ? null : turn.id)}
              aria-pressed={forkArmed}
              title={STR.nvwForkFromHint}
            >
              <CornerDownRight size={16} aria-hidden="true" />
              {forkArmed ? STR.nvwForkCancel : STR.nvwForkFrom}
              <span className="visually-hidden">
                {' '}
                ({STR.nvwForkTurn} {ordinal.toLocaleString('mr-IN')})
              </span>
            </button>
          ) : null}

          {/* Offered on a FAILED turn too: a render that died is as good a reason as a
              render that ignored the picture to start again from the picture itself. */}
          {retryable ? (
            <button
              type="button"
              className={
                retryArmed
                  ? 'btn-ghost nvw-fork is-active'
                  : 'btn-ghost nvw-fork'
              }
              onClick={() => onRetryFromOriginal?.(retryArmed ? null : turn.id)}
              aria-pressed={retryArmed}
              title={STR.nvwRetryFromOriginalHint}
            >
              <ImagePlus size={16} aria-hidden="true" />
              {retryArmed ? STR.nvwForkCancel : STR.nvwRetryFromOriginal}
              <span className="visually-hidden">
                {' '}
                ({STR.nvwForkTurn} {ordinal.toLocaleString('mr-IN')})
              </span>
            </button>
          ) : null}

          {turn.status === 'failed' ? (
            <div className="nvw-error" role="alert">
              <p className="nvw-error-title">{STR.nvwFailed}</p>
              {turn.error !== null ? (
                // Verbatim, in a monospace block: it is a provider message, often English, and
                // reading it is the job.
                <pre className="nvw-error-detail">{turn.error}</pre>
              ) : null}
            </div>
          ) : null}
        </article>
      )}
    </>
  );
}
