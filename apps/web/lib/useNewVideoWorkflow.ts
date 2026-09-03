'use client';

// The /new-video-workflow state: one conversation, its turns, and the reference images staged
// for the next one.
//
// The conversation ROW is the state of record (migration 0050), so this is a plain poll with
// no optimistic local turn list to keep in sync — the useTranscription / useDloIntake shape.
// The one thing it does NOT clone is /chat's streaming: video generation returns nothing
// until it returns everything, so there is nothing to stream.
//
// The id comes from the URL, and this hook reports a NEWLY created one back to the caller
// (`onConversationCreated`) rather than routing itself. That mirrors useChatThread, and for
// the same reason: the caller sets the URL with history.replaceState, because a Next
// navigation would remount the tree in the middle of a generation the officer is watching.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewVideoConversation } from '@dgipr/schemas';
import {
  getNewVideoConversation,
  sendNewVideoTurn,
  uploadNewVideoImage,
} from './api';
import { errorMessage } from './errorMessage';
import { rememberMyVideoConversationId } from './newVideoDraft';

// Video generation runs for minutes, so a chat-speed poll would be thousands of requests for
// one answer. 3 s is still well inside "did something just happen?" for a person watching.
const POLL_INTERVAL_MS = 3000;

// One image being staged for the next turn. `id` is present once the upload lands; until then
// the chip shows the local preview and the send waits for it.
export type StagedImage = {
  key: string;
  name: string;
  // An object URL, so the thumbnail appears the instant the file is picked.
  previewUrl: string;
  state: 'uploading' | 'ready' | 'failed';
  id: string | null;
  error: string | null;
};

export function useNewVideoWorkflow(
  conversationId: string | null,
  onConversationCreated?: (id: string) => void,
): {
  conversationId: string | null;
  conversation: NewVideoConversation | null;
  images: readonly StagedImage[];
  loading: boolean;
  sending: boolean;
  busy: boolean;
  error: string | null;
  addImages: (files: readonly File[]) => void;
  removeImage: (key: string) => void;
  send: (prompt: string) => Promise<boolean>;
  refresh: () => Promise<void>;
} {
  // Seeded from the URL and then owned locally, so a conversation created by the first turn
  // keeps polling without waiting for a route change.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [conversation, setConversation] = useState<NewVideoConversation | null>(
    null,
  );
  const [images, setImages] = useState<StagedImage[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(conversationId !== null);
  const [error, setError] = useState<string | null>(null);
  // Read inside `send` without making it depend on the list — a picked file must not
  // re-create the callback the composer is holding.
  const imagesRef = useRef<StagedImage[]>([]);
  imagesRef.current = images;
  const createdRef = useRef(onConversationCreated);
  createdRef.current = onConversationCreated;

  // Navigating between conversations re-mounts the page, but going from `/x` to `/y` within
  // the same tree does not — so the id is re-seeded and the old conversation dropped, or the
  // previous one's turns would show under the new title until the first fetch lands.
  useEffect(() => {
    setActiveId(conversationId);
    setConversation(null);
    setError(null);
    setLoading(conversationId !== null);
  }, [conversationId]);

  const refresh = useCallback(async () => {
    if (!activeId) return;
    try {
      setConversation(await getNewVideoConversation(activeId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  // The first read of a conversation opened from the rail or a reload.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = conversation?.busy ?? false;

  // Polls only while something is actually generating. A finished conversation is static —
  // nothing on the server can change it — so an idle page makes no requests at all.
  useEffect(() => {
    if (!activeId || !busy) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, busy, refresh]);

  const addImages = useCallback((files: readonly File[]) => {
    if (files.length === 0) return;
    const staged = files.map((file): StagedImage => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return {
        key,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        state: 'uploading',
        id: null,
        error: null,
      };
    });
    setImages((prev) => [...prev, ...staged]);

    // Uploaded as soon as they are picked, so the slow part overlaps typing — the /chat
    // attachment rule. The turn waits for anything still in flight.
    staged.forEach((entry, index) => {
      const file = files[index];
      if (!file) return;
      void uploadNewVideoImage(file)
        .then((uploaded) => {
          setImages((prev) =>
            prev.map((item) =>
              item.key === entry.key
                ? { ...item, state: 'ready', id: uploaded.id }
                : item,
            ),
          );
        })
        .catch((e: unknown) => {
          setImages((prev) =>
            prev.map((item) =>
              item.key === entry.key
                ? { ...item, state: 'failed', error: errorMessage(e) }
                : item,
            ),
          );
        });
    });
  }, []);

  const removeImage = useCallback((key: string) => {
    setImages((prev) => {
      const removed = prev.find((item) => item.key === key);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((item) => item.key !== key);
    });
  }, []);

  const send = useCallback(
    async (prompt: string): Promise<boolean> => {
      if (prompt.trim() === '') return false;
      setSending(true);
      setError(null);
      try {
        // A failed upload is not carried: sending its id would be a 400, and sending nothing
        // in its place would look like the model ignoring an attached picture.
        const failed = imagesRef.current.filter(
          (image) => image.state === 'failed',
        );
        const ready = imagesRef.current.filter((image) => image.id !== null);
        if (
          failed.length > 0 &&
          ready.length === 0 &&
          failed.length === imagesRef.current.length
        ) {
          setError(failed[0]?.error ?? null);
          return false;
        }
        const imageIds = ready.map((image) => image.id as string);

        const result = await sendNewVideoTurn({
          // Verbatim. Not trimmed here either — the API sends exactly this string to Gemini,
          // and the contract of this lane is that nothing on our side edits it.
          prompt,
          ...(activeId ? { conversationId: activeId } : {}),
          ...(imageIds.length > 0 ? { imageIds } : {}),
        });

        // Only cleared once the turn is on its way.
        setImages((prev) => {
          prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
          return [];
        });

        const isNew = activeId === null;
        setActiveId(result.conversationId);
        if (isNew) {
          // Ordering only (lib/newVideoDraft.ts) — never a permission.
          rememberMyVideoConversationId(result.conversationId);
          createdRef.current?.(result.conversationId);
        }
        // Fetched immediately so the queued turn appears without waiting for the first poll.
        try {
          setConversation(await getNewVideoConversation(result.conversationId));
        } catch {
          // The poll will pick it up; a failed first read is not worth an error banner.
        }
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setSending(false);
      }
    },
    [activeId],
  );

  // Object URLs are revoked as images are removed or sent; this catches the page being
  // navigated away from mid-composition.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  return {
    conversationId: activeId,
    conversation,
    images,
    loading,
    sending,
    busy,
    error,
    addImages,
    removeImage,
    send,
    refresh,
  };
}
