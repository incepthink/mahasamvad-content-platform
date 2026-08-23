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
import { MarkdownText } from './MarkdownText';
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
  onAddDocuments,
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
  onAddDocuments: (files: readonly File[]) => void;
  onAddAudio: (files: readonly File[]) => void;
  onAddYouTube: (video: YouTubeVideo) => void;
  onRemoveAttachment: (key: string) => void;
  onSend: (content: string) => Promise<boolean>;
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
  // The centred layout belongs to a chat with nothing in it, NOT to one still being
  // fetched — otherwise opening a chat throws the composer into the middle of the screen
  // and back down again as the turns land.
  const centred = empty && !loading;

  return (
    // An empty chat centres the greeting with the composer under it (CSS only — the
    // composer element is the same one in both states, so nothing typed or attached is
    // lost when the first message moves it to the foot of the screen).
    <section className={centred ? 'chat-pane chat-pane--empty' : 'chat-pane'}>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={sending}
      >
        <div className="chat-column">
          {loading && empty ? (
            <p className="chat-loading" role="status">
              <span className="spinner spinner-lg" aria-hidden="true" />
              <span className="visually-hidden">{STR.chatLoading}</span>
            </p>
          ) : null}

          {empty && !loading ? (
            <div className="chat-empty">
              <h2 className="chat-empty-title">{STR.chatEmptyTitle}</h2>
              <p className="chat-empty-hint">{STR.chatEmptyHint}</p>
            </div>
          ) : null}

          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}

          {streaming !== null ? (
            <article className="chat-turn chat-turn--assistant">
              {streaming === '' ? (
                // Before the first token. Gemini may think before it writes, so this window is
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
                // Markdown WHILE it streams, not plain text that recompiles at the end.
                // It used to render raw, on the argument that re-parsing half-written
                // Markdown flickers as each `#` and `**` completes — but the cost of that
                // was worse: the officer read `## शीर्षक` and `**ठळक**` for the whole
                // answer and then watched the finished text reflow under them. The parser
                // is a pure function over the string so far, so there is nothing to keep in
                // sync; a token mid-word is momentarily literal and resolves on the next
                // delta.
                <MarkdownText text={streaming} className="chat-answer" />
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
            onAddDocuments={onAddDocuments}
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
