'use client';

// The right-hand pane of /new-video-workflow: the turns, and the composer under them.
//
// The counterpart of ChatConversation, and deliberately shaped like it — same scroller, same
// stick-to-bottom rule, same `.chat-pane` / `.chat-scroll` / `.chat-column` CSS — because the
// two surfaces are the same kind of screen. What it does NOT share is a streaming state:
// video generation returns nothing until it returns everything, so the waiting is a status
// line inside the turn (NewVideoTurnView) rather than text arriving token by token.

import { useEffect, useRef, useState } from 'react';
import type { NewVideoConversation as Conversation } from '@dgipr/schemas';
import { ErrorNotice } from './ErrorNotice';
import { NewVideoComposer } from './NewVideoComposer';
import { NewVideoTurnView } from './NewVideoTurnView';
import { STR } from '../lib/strings';
import type { StagedImage } from '../lib/useNewVideoWorkflow';

// How close to the bottom still counts as "at the bottom". A few lines of slack, so a stray
// wheel nudge does not stop the view following a new turn.
const STICK_THRESHOLD_PX = 120;

export function NewVideoConversationView({
  conversation,
  images,
  loading,
  sending,
  busy,
  error,
  onRetry,
  onAddImages,
  onRemoveImage,
  onSend,
}: {
  conversation: Conversation | null;
  images: readonly StagedImage[];
  loading: boolean;
  sending: boolean;
  busy: boolean;
  error: string | null;
  onRetry?: () => void;
  onAddImages: (files: readonly File[]) => void;
  onRemoveImage: (key: string) => void;
  onSend: (prompt: string) => Promise<boolean>;
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

  const turns = conversation?.turns ?? [];

  // Guarded by `stick` rather than scrolling unconditionally: an officer who has scrolled up
  // to re-watch an earlier video must not be yanked down when a poll lands.
  useEffect(() => {
    if (!stick) return;
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns.length, busy, stick]);

  // A conversation opened from the rail starts at its end, where the work left off.
  useEffect(() => {
    setStick(true);
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation?.id]);

  const empty = turns.length === 0;
  // The greeting is centred in the space above the composer, NOT while the conversation is
  // still being fetched — otherwise opening one shows a greeting for the turns it is about
  // to replace. Unlike /chat, the COMPOSER does not move: it stays docked at the foot of the
  // pane in both states (see `.nvw-pane .chat-scroll.is-empty`), because a video prompt is a
  // long piece of writing that gets edited and re-sent and wants one fixed place to live.
  const centred = empty && !loading;

  return (
    <section className="chat-pane nvw-pane">
      <div
        className={centred ? 'chat-scroll is-empty' : 'chat-scroll'}
        ref={scroller}
        onScroll={onScroll}
        aria-live="polite"
        aria-busy={busy}
      >
        <div className="chat-column">
          {loading && empty ? (
            <p className="chat-loading" role="status">
              <span className="spinner spinner-lg" aria-hidden="true" />
              <span className="visually-hidden">{STR.chatLoading}</span>
            </p>
          ) : null}

          {centred ? (
            <div className="chat-empty nvw-empty">
              <h2 className="chat-empty-title">{STR.nvwEmptyTitle}</h2>
              <p className="chat-empty-hint">{STR.nvwEmptyHint}</p>
            </div>
          ) : null}

          {turns.map((turn) => (
            <NewVideoTurnView key={turn.id} turn={turn} />
          ))}

          {error !== null && !sending ? (
            <ErrorNotice
              message={error}
              fallback={STR.nvwLoadFailed}
              {...(onRetry ? { onRetry } : {})}
            />
          ) : null}
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-column">
          <NewVideoComposer
            images={images}
            busy={busy}
            sending={sending}
            isFollowUp={!empty}
            onAddImages={onAddImages}
            onRemoveImage={onRemoveImage}
            onSend={onSend}
          />
        </div>
      </div>
    </section>
  );
}
