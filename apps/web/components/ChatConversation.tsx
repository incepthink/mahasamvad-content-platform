'use client';

// The right-hand pane: the turns, the answer being written, and the composer.
//
// It owns the scroll behaviour, which is the one piece of chat UI that is easy to get wrong in
// both directions. It follows a growing answer only while the officer is already at the bottom
// — someone who has scrolled up to re-read an earlier turn must not be yanked back down every
// time a token arrives.

import { useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ChatThreadDetail,
  YouTubeVideo,
} from '@dgipr/schemas';
import { ChatComposer } from './ChatComposer';
import { ChatMessageBubble } from './ChatMessageBubble';
import { STR } from '../lib/strings';
import type { DraftAttachment } from '../lib/useChatAttachments';

// How close to the bottom still counts as "at the bottom". A few lines of slack, so a stray
// wheel nudge does not stop the view following the answer.
const STICK_THRESHOLD_PX = 120;

export function ChatConversation({
  thread,
  messages,
  streaming,
  sending,
  loading,
  error,
  attachments,
  preparing,
  full,
  onAddImages,
  onAddDocumentSlot,
  onDocumentText,
  onAddAudio,
  onAddYouTube,
  onRemoveAttachment,
  onSend,
  onStop,
}: {
  thread: ChatThreadDetail | null;
  messages: readonly ChatMessage[];
  streaming: string | null;
  sending: boolean;
  loading: boolean;
  error: string | null;
  attachments: readonly DraftAttachment[];
  preparing: boolean;
  full: boolean;
  onAddImages: (files: readonly File[]) => void;
  onAddDocumentSlot: () => void;
  onDocumentText: (slot: string, name: string, text: string) => void;
  onAddAudio: (files: readonly File[]) => void;
  onAddYouTube: (video: YouTubeVideo) => void;
  onRemoveAttachment: (key: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    setStick(distance <= STICK_THRESHOLD_PX);
  };

  // Runs on every delta, which is why it is guarded by `stick` rather than scrolling
  // unconditionally.
  useEffect(() => {
    if (!stick) return;
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, streaming, stick]);

  // A newly opened chat starts at its end, where the conversation left off.
  useEffect(() => {
    setStick(true);
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [thread?.id]);

  const empty = messages.length === 0 && streaming === null;

  return (
    <section className="chat-pane">
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={sending}
      >
        <div className="chat-column">
          {loading && empty ? <p className="chat-note">…</p> : null}

          {empty && !loading ? (
            <div className="chat-empty">
              <h2 className="chat-empty-title">{STR.chatEmptyTitle}</h2>
              <p className="chat-empty-hint">{STR.chatEmptyHint}</p>
              <p className="chat-empty-notice">{STR.chatEmptyNotice}</p>
            </div>
          ) : null}

          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}

          {streaming !== null ? (
            <article className="chat-turn chat-turn--assistant">
              {streaming === '' ? (
                // Before the first token. gpt-5 thinks before it writes, so this window is
                // real and an empty pane would read as a failure.
                <p className="chat-thinking">
                  <span className="chat-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {STR.chatThinking}
                </p>
              ) : (
                // Plain text while streaming, Markdown once settled: re-parsing half-written
                // Markdown on every token makes headings and lists flicker in and out as their
                // syntax completes.
                <p className="chat-answer chat-answer--streaming">
                  {streaming}
                </p>
              )}
            </article>
          ) : null}

          {error !== null && !sending ? (
            <p className="chat-note chat-note--error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-column">
          <ChatComposer
            attachments={attachments}
            preparing={preparing}
            full={full}
            sending={sending}
            onAddImages={onAddImages}
            onAddDocumentSlot={onAddDocumentSlot}
            onDocumentText={onDocumentText}
            onAddAudio={onAddAudio}
            onAddYouTube={onAddYouTube}
            onRemove={onRemoveAttachment}
            onSend={onSend}
            onStop={onStop}
          />
        </div>
      </div>
    </section>
  );
}
