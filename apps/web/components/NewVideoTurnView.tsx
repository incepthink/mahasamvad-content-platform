'use client';

// One turn of the /new-video-workflow EXPERIMENT: the instruction on the right, the video
// under it on the left — the ChatMessageBubble shape, so the two surfaces read alike.
//
// The one deliberate departure from the rest of the product: a failure shows the PROVIDER'S
// OWN WORDS rather than a canned Marathi sentence. Everywhere else `storedErrorMessage`
// replaces an English internal message, and rightly so — but this page exists to read what
// the Gemini API says (a safety-filter reason, a rejected parameter, a quota wall), and
// normalising that away would defeat the whole experiment.

import type { NewVideoTurn } from '@dgipr/schemas';
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

export function NewVideoTurnView({ turn }: { turn: NewVideoTurn }) {
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
    </>
  );
}
