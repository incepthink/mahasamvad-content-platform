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
import {
  DEFAULT_NEW_VIDEO_MODE,
  type NewVideoAspect,
  type NewVideoCharacter,
  type NewVideoConversation,
  type NewVideoMode,
} from '@dgipr/schemas';
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

// A STORYBOARD answer is text written into the row as it streams (every ~0.7 s on the API
// side), so the poll is what the officer watches it arrive through. Faster than the video
// poll, and still only while something is actually being written.
const STORYBOARD_POLL_INTERVAL_MS = 1200;

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
  // THE CONVERSATION'S MODE (migration 0060). Picked before the first message and fixed by
  // it: once a conversation exists its stored mode is the answer and `setMode` is a no-op.
  mode: NewVideoMode;
  setMode: (mode: NewVideoMode) => void;
  modeLocked: boolean;
  images: readonly StagedImage[];
  loading: boolean;
  sending: boolean;
  busy: boolean;
  error: string | null;
  // The cast (migration 0054). `castIds` is what the composer's picker edits BEFORE the first
  // turn and what the server reports after it — see `castLocked`.
  characters: readonly NewVideoCharacter[];
  castIds: readonly string[];
  setCastIds: (ids: readonly string[]) => void;
  castLocked: boolean;
  // FORKING (Step 4). Which earlier turn the NEXT instruction continues from, or null for
  // the ordinary case — whatever last succeeded. A turn id rather than anything the provider
  // would recognise: the interaction handle never leaves the API.
  forkFromTurnId: string | null;
  setForkFromTurnId: (turnId: string | null) => void;
  addImages: (files: readonly File[]) => void;
  removeImage: (key: string) => void;
  send: (prompt: string, aspect: NewVideoAspect) => Promise<boolean>;
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
  // The cast the officer is picking for a conversation that has not started yet. Once it has,
  // the server's stored cast is the answer and this is not consulted — a conversation's cast
  // is fixed on its first turn, because a character's portrait is attached on the turn that
  // establishes them and stacking a reference into the middle of an edit chain is a
  // documented failure mode.
  const [pickedCastIds, setPickedCastIds] = useState<readonly string[]>([]);
  // The mode picked for a conversation that has not started yet. Once it has, the stored
  // mode wins — see `mode` below.
  const [pickedMode, setPickedMode] = useState<NewVideoMode>(
    DEFAULT_NEW_VIDEO_MODE,
  );
  // Armed by clicking a turn, cleared once the instruction it applied to has left. Held here
  // rather than in the composer because it belongs to the CONVERSATION being read — the
  // officer arms it by pressing a button on a turn well above the box.
  const [forkFromTurnId, setForkFromTurnId] = useState<string | null>(null);
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
    // A cast picked for a conversation that was never started must not follow the officer
    // into a different one.
    setPickedCastIds([]);
    // Nor a fork point: a turn id belongs to one conversation, and carrying it across would
    // send the next request an id the server would rightly refuse.
    setForkFromTurnId(null);
    // A new conversation starts on the default mode rather than on whatever the last one
    // was: the choice is made on the empty page, where the selector is the first thing seen.
    setPickedMode(DEFAULT_NEW_VIDEO_MODE);
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
  // Locked as soon as there IS a conversation — including while an opened one is still being
  // fetched, so the selector never offers a choice the server would refuse. Until the fetch
  // lands the picked value shows; it is the stored one from then on.
  const modeLocked = activeId !== null;
  const mode: NewVideoMode = conversation?.mode ?? pickedMode;
  const modeRef = useRef<NewVideoMode>(mode);
  modeRef.current = mode;
  const setMode = useCallback(
    (next: NewVideoMode) => {
      if (!modeLocked) setPickedMode(next);
    },
    [modeLocked],
  );
  // Locked once there is a video to edit. Read off the TURNS rather than off the cast itself:
  // a conversation that started with nobody in it must not become pickable later, or the
  // picker would offer to add a character to a chain that cannot receive one.
  const castLocked = (conversation?.turns.length ?? 0) > 0;
  const characters = conversation?.characters ?? [];
  const castIds = castLocked
    ? characters.map((character) => character.id)
    : pickedCastIds;
  // Held in a ref for the same reason the staged images are: picking a character must not
  // re-create the callback the composer is holding.
  const castRef = useRef<readonly string[]>(pickedCastIds);
  castRef.current = pickedCastIds;
  const lockedRef = useRef(castLocked);
  lockedRef.current = castLocked;
  // Same reason again: arming a fork must not re-create the callback the composer holds.
  const forkRef = useRef<string | null>(forkFromTurnId);
  forkRef.current = forkFromTurnId;

  // Polls only while something is actually generating. A finished conversation is static —
  // nothing on the server can change it — so an idle page makes no requests at all.
  const pollInterval =
    mode === 'storyboard' ? STORYBOARD_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  useEffect(() => {
    if (!activeId || !busy) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer = setTimeout(tick, pollInterval);
    };
    timer = setTimeout(tick, pollInterval);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, busy, refresh, pollInterval]);

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
    async (prompt: string, aspect: NewVideoAspect): Promise<boolean> => {
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

        // Sent only while the cast is still being set. A follow-up omits it: the server
        // already holds the cast and would refuse a DIFFERENT one, so there is nothing for a
        // client to add by echoing it back.
        const castToSend = lockedRef.current ? [] : castRef.current;
        const storyboard = modeRef.current === 'storyboard';

        const result = await sendNewVideoTurn(
          storyboard
            ? {
                // A storyboard turn is an ordinary chat message: text, and the pictures that
                // are context for it. No shape, cast, fork or edit/new choice — the API
                // refuses the last three in this mode.
                prompt,
                mode: 'storyboard',
                ...(activeId ? { conversationId: activeId } : {}),
                ...(imageIds.length > 0 ? { imageIds } : {}),
              }
            : {
                // Verbatim. Not trimmed here either — the API sends exactly this string to
                // Gemini, and the contract of this lane is that nothing on our side edits it.
                prompt,
                mode: 'video',
                // The output shape, always sent: it travels as a request field, so it never
                // touches the prompt above.
                aspect,
                ...(activeId ? { conversationId: activeId } : {}),
                ...(imageIds.length > 0 ? { imageIds } : {}),
                ...(castToSend.length > 0
                  ? { characterIds: [...castToSend] }
                  : {}),
                // Omitted unless armed, so the ordinary turn's request is byte-for-byte what
                // it has always been.
                ...(forkRef.current !== null
                  ? { fromTurnId: forkRef.current }
                  : {}),
                // No `intent`: whether this edits the video on screen or makes a new clip is
                // always the API's call (`auto`), read off the instruction itself.
              },
        );

        // Only cleared once the turn is on its way — the fork with it, since it described
        // this one instruction and the next one starts from what this produces. A FAILED
        // send keeps it armed, so re-pressing send does what the officer meant.
        setImages((prev) => {
          prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
          return [];
        });
        setForkFromTurnId(null);

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
    mode,
    setMode,
    modeLocked,
    images,
    loading,
    sending,
    busy,
    error,
    characters,
    castIds,
    setCastIds: setPickedCastIds,
    castLocked,
    forkFromTurnId,
    setForkFromTurnId,
    addImages,
    removeImage,
    send,
    refresh,
  };
}
