'use client';

// One turn.
//
// The two roles are shaped differently on purpose. A question is short and belongs to the
// person who asked it, so it sits in a contained bubble on the right; an answer is prose to be
// read, so it runs the full column width with no container at all — a long article inside a
// speech bubble is harder to read for no gain. This is also why only the answer gets a copy
// button and Markdown rendering.

import { useState } from 'react';
import type { ChatMessage } from '@dgipr/schemas';
// CirclePlay stands in for a YouTube mark: lucide 1.x carries no brand icons.
import {
  Check,
  CirclePlay,
  Copy,
  FileText,
  Image as ImageIcon,
  Mic,
} from 'lucide-react';
import { MarkdownText } from './MarkdownText';
import { STR } from '../lib/strings';
import { FileName } from './FileName';

const KIND_ICON = {
  image: ImageIcon,
  document: FileText,
  audio: Mic,
  youtube: CirclePlay,
} as const;

function AttachmentChips({
  attachments,
}: {
  attachments: ChatMessage['attachments'];
}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && attachment.imageUrl,
  );
  const rest = attachments.filter((attachment) => attachment.kind !== 'image');

  return (
    <div className="chat-attachments">
      {images.length > 0 ? (
        <div className="chat-attach-images">
          {images.map((attachment) => (
            /* A plain <img>, like every other remote image in this app: these are runtime
               URLs from our own bucket, and next/image would need the host allow-listed for
               no benefit at this size. */
            <img
              key={attachment.imageUrl}
              src={attachment.imageUrl}
              alt={attachment.name}
              className="chat-attach-image"
            />
          ))}
        </div>
      ) : null}
      {rest.map((attachment) => {
        const Icon = KIND_ICON[attachment.kind];
        return (
          <span
            key={`${attachment.name}-${attachment.kind}`}
            className="chat-chip"
          >
            <Icon size={15} aria-hidden="true" />
            <FileName
              name={attachment.name}
              className="chat-chip-name"
              max={28}
            />
            {attachment.chars !== undefined ? (
              <span className="chat-chip-meta">
                {attachment.chars.toLocaleString('mr-IN')} अक्षरे
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard is not worth an error message; the text is selectable.
    }
  };

  if (message.role === 'user') {
    return (
      <article className="chat-turn chat-turn--user">
        <div className="chat-bubble">
          <AttachmentChips attachments={message.attachments} />
          {message.content !== '' ? (
            // Not Markdown: what the officer typed is shown exactly as typed, so a note
            // pasted with `#` or `*` in it is not silently restructured.
            <p className="chat-user-text">{message.content}</p>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="chat-turn chat-turn--assistant">
      {message.content !== '' ? (
        <MarkdownText text={message.content} className="chat-answer" />
      ) : null}
      {message.error !== null ? (
        <p className="chat-turn-error" role="alert">
          {STR.chatFailed}
        </p>
      ) : null}
      {message.content !== '' ? (
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
