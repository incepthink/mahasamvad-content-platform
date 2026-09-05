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
// 2. THE TURN GOES ON SCREEN BEFORE THE ATTACHMENTS ARE FINISHED. `send` takes a `prepare`
//    thunk rather than a finished attachment list, and calls it AFTER the officer's message
//    is in the conversation and the box has cleared. That is what lets someone pick a large
//    PDF and immediately ask a question about it instead of waiting in front of a disabled
//    Send button. The chips shown meanwhile are `preview` — kinds and names, the only things
//    known before the files are read — and are replaced by the real ones once they are.
//
// 3. THE HOOK OWNS THREAD CREATION. A brand-new chat has no id until its first message, and
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
  ChatProvider,
  ChatThreadDetail,
} from '@dgipr/schemas';
import { createChatThread, getChatThread, sendChatMessage } from './api';
import { rememberMyChatId } from './chatDraft';
import { STR } from './strings';
import { errorMessage } from './errorMessage';

export type SendInput = Readonly<{
  content: string;
  // What to show under the officer's own turn straight away. A file still being read has no
  // size and no URL yet, so these carry a kind and a name and nothing else.
  preview: readonly ChatAttachment[];
  // Finishes the attachments and returns what the turn should carry. Called once, after the
  // message is on screen — see the header. Resolving to an empty list when nothing was typed
  // means every attachment failed, and the turn is rolled back rather than sent empty.
  prepare: () => Promise<readonly ChatAttachment[]>;
  // Which model answers, per TURN — a thread may legitimately hold both, and only the name
  // travels. The endpoint and key of a self-hosted provider are resolved server-side.
  provider: ChatProvider;
}>;

// How much of a reasoning model's deliberation is kept on screen. The TAIL, so the line reads
// as what the model is doing now rather than as an essay that grows the pane while nothing has
// been answered yet — and bounded, so a long thinking block cannot grow this state without
// limit as it streams.
const THINKING_TAIL_CHARS = 240;

// What a chip may show. The extracted text is dropped here, exactly as the API drops it from
// its own responses: a chip shows a name and a size, never the text.
function chipsFor(
  attachments: readonly ChatAttachment[],
): ChatMessage['attachments'] {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    name: attachment.name,
    ...(attachment.imageUrl !== undefined
      ? { imageUrl: attachment.imageUrl }
      : {}),
    ...(attachment.text !== undefined ? { chars: attachment.text.length } : {}),
    ...(attachment.sourceUrl !== undefined
      ? { sourceUrl: attachment.sourceUrl }
      : {}),
  }));
}

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
  // A reasoning model thinking out loud, while it is still doing so. NOT the answer: it is
  // never added to `streaming`, never stored, and never replayed into a later turn (Qwen3's
  // own guidance). Null unless the provider streams it and the answer has not started.
  thinking: string | null;
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
  const [thinking, setThinking] = useState<string | null>(null);
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
    setThinking(null);
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
        attachments: chipsFor(input.preview),
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
          setThinking(null);
          setSending(false);
          setError(errorMessage(e, STR.chatFailed));
          return;
        }
      }

      // Created BEFORE the attachments are finished, so थांबवा can end a turn that is still
      // reading a file rather than only one the model is already answering.
      const controller = new AbortController();
      abort.current = controller;
      let answer = '';
      // Held here rather than read back off state, exactly as `answer` is: several frames can
      // land inside one React batch.
      let reasoning = '';
      let failed: string | null = null;

      // The wait moved here from in front of the Send button — see the header. The officer's
      // question is already on screen while this runs.
      let attachments: readonly ChatAttachment[];
      try {
        attachments = await input.prepare();
      } catch (e) {
        attachments = [];
        console.warn('[chat] attachment preparation failed', e);
      }

      if (controller.signal.aborted) {
        // थांबवा was pressed while the files were being read. Nothing was sent, so the turn
        // comes off the screen instead of sitting there with no answer under it.
        setMessages((current) =>
          current.filter((message) => message.id !== provisionalId),
        );
        setStreaming(null);
        setThinking(null);
        setSending(false);
        abort.current = null;
        return;
      }

      if (attachments.length === 0 && input.content.trim() === '') {
        // Every attachment failed and there is nothing else to ask. The chips kept their own
        // messages, so the failure is already explained where it happened.
        setMessages((current) =>
          current.filter((message) => message.id !== provisionalId),
        );
        setStreaming(null);
        setThinking(null);
        setSending(false);
        abort.current = null;
        setError(STR.chatAttachFailed);
        return;
      }

      // The chips were kinds and names; now they can say how big the file turned out to be
      // and show the image that was uploaded.
      const settled = chipsFor(attachments);
      setMessages((current) =>
        current.map((message) =>
          message.id === provisionalId
            ? { ...message, attachments: settled }
            : message,
        ),
      );

      try {
        await sendChatMessage(
          target,
          {
            content: input.content,
            attachments: attachments.map((attachment) => ({ ...attachment })),
            provider: input.provider,
          },
          (event) => {
            if (event.type === 'delta') {
              answer += event.text;
              setStreaming(answer);
            } else if (event.type === 'reasoning') {
              // THINKING, NOT ANSWER. It is deliberately not added to `answer`, so it never
              // reaches the message list, the stored row or the next turn's history — it exists
              // only so a reasoning model's long silence reads as progress rather than as a
              // dead pane. Only the tail is kept: see THINKING_TAIL_CHARS.
              reasoning = (reasoning + event.text).slice(-THINKING_TAIL_CHARS);
              setThinking(reasoning);
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
            } else if (event.type === 'error') {
              failed = event.message;
            }
            // Every arm is matched EXPLICITLY rather than one falling through an else: a bare
            // else would read `message` off whichever frame type is added next and fail the
            // turn with `undefined`, which is exactly what a reasoning frame did before it was
            // given an arm of its own.
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
      // The deliberation is over the moment the turn is: it is never part of the reply and is
      // not kept anywhere, here or on the row.
      setThinking(null);
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
    thinking,
    sending,
    error,
    loading,
    send,
    stop,
  };
}
