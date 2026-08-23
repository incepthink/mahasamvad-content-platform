'use client';

// One conversation: load it, send a turn, watch the answer arrive.
//
// Two things here are load-bearing and easy to undo by accident.
//
// 1. THE STREAMING ANSWER IS HELD OUTSIDE THE MESSAGE LIST (`streaming`) until the turn
//    finishes, and only then appended. So the list stays a list of things that are actually
//    saved — nothing on screen can claim to be persisted before it is — and the scroll
//    handling only ever has one growing element to follow.
//
// 2. THE HOOK OWNS THREAD CREATION. A brand-new chat has no id until its first message, and
//    the obvious arrangement (create the thread, hand the id back, let the page re-key this
//    hook) loses the turn: the reload effect would fire for the new id and replace the
//    optimistic user message with the empty list the server still has. So `send` creates the
//    thread itself, keeps the id in state, and reports it through `onThreadCreated` — the
//    reload effect keys on the PROP, which has not changed, so nothing is refetched and
//    nothing is clobbered mid-stream.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatAttachment,
  ChatMessage,
  ChatThreadDetail,
} from '@dgipr/schemas';
import { createChatThread, getChatThread, sendChatMessage } from './api';
import { rememberMyChatId } from './chatDraft';
import { STR } from './strings';
import { errorMessage } from './errorMessage';

export type SendInput = Readonly<{
  content: string;
  attachments: readonly ChatAttachment[];
}>;

export function useChatThread(
  initialThreadId: string | null,
  // Called once, when a brand-new chat becomes a real thread. The page uses it to put the id
  // in the URL (without a navigation — see the page) and to refresh the rail.
  onThreadCreated?: (id: string) => void,
): {
  threadId: string | null;
  thread: ChatThreadDetail | null;
  messages: ChatMessage[];
  // The answer as it is being written; null when nothing is in flight. An empty string means
  // the turn has been sent and the first token has not arrived.
  streaming: string | null;
  sending: boolean;
  error: string | null;
  loading: boolean;
  send: (input: SendInput) => Promise<void>;
  stop: () => void;
} {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [thread, setThread] = useState<ChatThreadDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialThreadId !== null);
  const abort = useRef<AbortController | null>(null);
  const created = useRef(onThreadCreated);
  created.current = onThreadCreated;

  // Keyed on the PROP, not on `threadId` — see the header. Switching chats must also stop the
  // previous one's answer streaming into this one.
  useEffect(() => {
    abort.current?.abort();
    abort.current = null;
    setThreadId(initialThreadId);
    setStreaming(null);
    setSending(false);
    setError(null);
    setThread(null);
    setMessages([]);

    if (initialThreadId === null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const detail = await getChatThread(initialThreadId);
        if (cancelled) return;
        setThread(detail);
        setMessages(detail.messages);
      } catch (e) {
        if (cancelled) return;
        setError(errorMessage(e, STR.chatLoadFailed));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialThreadId]);

  const send = useCallback(
    async (input: SendInput) => {
      if (sending) return;

      // The officer's turn goes on screen immediately under a provisional id, swapped for the
      // real row when the stream reports it. Waiting for the server would leave the box
      // cleared and the message nowhere.
      const provisionalId = `pending-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: provisionalId,
        role: 'user',
        content: input.content,
        // The extracted text is dropped here, exactly as the API drops it from its own
        // responses: a chip shows a name and a size, never the text.
        attachments: input.attachments.map((attachment) => ({
          kind: attachment.kind,
          name: attachment.name,
          ...(attachment.imageUrl !== undefined
            ? { imageUrl: attachment.imageUrl }
            : {}),
          ...(attachment.text !== undefined
            ? { chars: attachment.text.length }
            : {}),
          ...(attachment.sourceUrl !== undefined
            ? { sourceUrl: attachment.sourceUrl }
            : {}),
        })),
        model: null,
        costUsd: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimistic]);
      setStreaming('');
      setSending(true);
      setError(null);

      let target = threadId;
      if (target === null) {
        try {
          target = await createChatThread();
          setThreadId(target);
          rememberMyChatId(target);
          created.current?.(target);
        } catch (e) {
          // Nothing was sent, so the turn is put back in the officer's hands rather than left
          // as a question with no answer under it.
          setMessages((current) =>
            current.filter((message) => message.id !== provisionalId),
          );
          setStreaming(null);
          setSending(false);
          setError(errorMessage(e, STR.chatFailed));
          return;
        }
      }

      const controller = new AbortController();
      abort.current = controller;
      let answer = '';
      let failed: string | null = null;

      try {
        await sendChatMessage(
          target,
          {
            content: input.content,
            attachments: input.attachments.map((attachment) => ({
              ...attachment,
            })),
          },
          (event) => {
            if (event.type === 'delta') {
              answer += event.text;
              setStreaming(answer);
            } else if (event.type === 'done') {
              setMessages((current) =>
                current.map((message) =>
                  message.id === provisionalId
                    ? { ...message, id: event.userMessageId }
                    : message,
                ),
              );
              if (event.title !== undefined) {
                const { title } = event;
                setThread((current) =>
                  current ? { ...current, title } : current,
                );
              }
            } else {
              failed = event.message;
            }
          },
          controller.signal,
        );
      } catch (e) {
        // An abort is the थांबवा button, not a failure. The server finishes the turn and
        // stores what it produced, so the complete answer is there on the next load — what is
        // on screen is simply where the reading stopped.
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          failed = errorMessage(e, STR.chatFailed);
        }
      } finally {
        abort.current = null;
      }

      // Settle: the streamed text becomes an ordinary message. Its id is provisional too —
      // nothing renders it — and reopening the chat replaces the list with the stored rows.
      if (answer !== '' || failed !== null) {
        setMessages((current) => [
          ...current,
          {
            id: `answer-${Date.now()}`,
            role: 'assistant',
            content: answer,
            attachments: [],
            model: null,
            costUsd: null,
            error: failed,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setStreaming(null);
      setSending(false);
      if (failed !== null) setError(failed);
    },
    [threadId, sending],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  // A chat left behind must not keep a stream running after the page moves on.
  useEffect(() => () => abort.current?.abort(), []);

  return {
    threadId,
    thread,
    messages,
    streaming,
    sending,
    error,
    loading,
    send,
    stop,
  };
}
