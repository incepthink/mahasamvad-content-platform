'use client';

// The composer's attachment tray: everything between picking a file and having something the
// turn can carry.
//
// The rule this hook exists to enforce is ATTACH → PREPARE → SEND. An attachment is not ready
// the moment it is picked: an image has to upload, a scanned PDF needs its pages chosen and
// read, a recording and a YouTube link need transcribing (minutes). Send stays disabled until
// every one of them is `ready`, so a turn is never sent half-prepared and the model never sees
// a file that is still arriving.
//
// Where the work happens is deliberately NOT here:
//   - documents go through the shared ephemeral <DocumentIntake>, so /chat gets the same probe,
//     the same page picker and the same "no page is OCR'd unless it was ticked" spend gate as
//     every other upload surface;
//   - recordings and YouTube links go through the EXISTING /api/transcriptions job, which
//     brings the 0031 content-addressed cache with it — a recording already transcribed on
//     /transcribe comes back here instantly and free, and vice versa. The visible cost is that
//     a chat recording also appears in /transcribe's history; the composer hint says so rather
//     than letting it surprise someone.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_MAX_ATTACHMENTS,
  isImageFileName,
  type ChatAttachment,
  type YouTubeVideo,
} from '@dgipr/schemas';
import { createTranscription, getTranscription, uploadChatImage } from './api';
import { STR } from './strings';

export type DraftAttachmentState =
  'preparing' | 'transcribing' | 'ready' | 'failed';

export type DraftAttachment = Readonly<{
  // Local only — the API never sees it.
  key: string;
  kind: ChatAttachment['kind'];
  name: string;
  state: DraftAttachmentState;
  error?: string;
  // Present once ready.
  imageUrl?: string;
  text?: string;
  sourceUrl?: string;
  // A document slot's <DocumentIntake> storage key, so the card can be rendered and remounted.
  documentSlot?: string;
  // The transcription run backing a recording or link, polled until it lands.
  transcriptionId?: string;
}>;

const POLL_INTERVAL_MS = 4000;

let nextKey = 0;
function makeKey(): string {
  nextKey += 1;
  return `att-${nextKey}-${Date.now().toString(36)}`;
}

export function useChatAttachments(): {
  attachments: DraftAttachment[];
  // True while anything is still being prepared — the send button's gate.
  preparing: boolean;
  full: boolean;
  addImages: (files: readonly File[]) => Promise<void>;
  addDocumentSlot: () => void;
  // Live text from a document card, keyed by its slot. '' clears it back to not-ready.
  setDocumentText: (slot: string, name: string, text: string) => void;
  addAudio: (files: readonly File[]) => Promise<void>;
  addYouTube: (video: YouTubeVideo) => Promise<void>;
  remove: (key: string) => void;
  clear: () => void;
  // What the turn carries. Only ready attachments, stripped of local bookkeeping.
  toPayload: () => ChatAttachment[];
} {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);

  const patch = useCallback((key: string, next: Partial<DraftAttachment>) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.key === key ? { ...attachment, ...next } : attachment,
      ),
    );
  }, []);

  // How many of `wanted` will fit. Picking several files at once is normal (a phone hands over
  // five photographs), so the excess is silently dropped rather than the whole pick refused.
  const room = useCallback(
    (wanted: number): number =>
      Math.min(wanted, Math.max(0, CHAT_MAX_ATTACHMENTS - attachments.length)),
    [attachments.length],
  );

  const addImages = useCallback(
    async (files: readonly File[]) => {
      const accepted = files
        .filter((file) => isImageFileName(file.name))
        .slice(0, room(files.length));
      const pending = accepted.map((file) => ({
        key: makeKey(),
        file,
      }));
      setAttachments((current) => [
        ...current,
        ...pending.map(({ key, file }): DraftAttachment => ({
          key,
          kind: 'image',
          name: file.name,
          state: 'preparing',
        })),
      ]);
      // Uploaded one at a time rather than in parallel: several photographs from a phone are
      // megabytes each, and a serial upload keeps the tray's progress honest.
      for (const { key, file } of pending) {
        try {
          const uploaded = await uploadChatImage(file);
          patch(key, { state: 'ready', imageUrl: uploaded.imageUrl });
        } catch (e) {
          patch(key, {
            state: 'failed',
            error: e instanceof Error ? e.message : STR.chatAttachFailed,
          });
        }
      }
    },
    [patch, room],
  );

  // A document is a CARD, not a background task: <DocumentIntake> renders the probe, the page
  // picker and the read, and reports its text back through setDocumentText. So the slot starts
  // out not-ready and carries no name until the officer has actually picked a file.
  const addDocumentSlot = useCallback(() => {
    if (room(1) === 0) return;
    const key = makeKey();
    setAttachments((current) => [
      ...current,
      {
        key,
        kind: 'document',
        name: '',
        state: 'preparing',
        documentSlot: `dgipr.chat.document.${key}`,
      },
    ]);
  }, [room]);

  const setDocumentText = useCallback(
    (slot: string, name: string, text: string) => {
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.documentSlot === slot
            ? {
                ...attachment,
                name: name || attachment.name,
                text,
                // An empty read is not a failure — it is a document whose pages have not been
                // chosen yet, which is exactly the state send must wait on.
                state: text.trim() === '' ? 'preparing' : 'ready',
              }
            : attachment,
        ),
      );
    },
    [],
  );

  const addAudio = useCallback(
    async (files: readonly File[]) => {
      const accepted = files.slice(0, room(files.length));
      if (accepted.length === 0) return;
      // One run per recording, so a failure is isolated to its own chip and the other files
      // still deliver — the same stance the transcription job itself takes.
      for (const file of accepted) {
        const key = makeKey();
        setAttachments((current) => [
          ...current,
          { key, kind: 'audio', name: file.name, state: 'transcribing' },
        ]);
        try {
          const form = new FormData();
          form.append('files', file);
          const id = await createTranscription(form);
          patch(key, { transcriptionId: id });
        } catch (e) {
          patch(key, {
            state: 'failed',
            error: e instanceof Error ? e.message : STR.chatAttachFailed,
          });
        }
      }
    },
    [patch, room],
  );

  const addYouTube = useCallback(
    async (video: YouTubeVideo) => {
      if (room(1) === 0) return;
      const key = makeKey();
      setAttachments((current) => [
        ...current,
        {
          key,
          kind: 'youtube',
          name: video.title ?? video.url,
          state: 'transcribing',
          sourceUrl: video.url,
        },
      ]);
      try {
        const form = new FormData();
        form.append('youtube', JSON.stringify([video]));
        const id = await createTranscription(form);
        patch(key, { transcriptionId: id });
      } catch (e) {
        patch(key, {
          state: 'failed',
          error: e instanceof Error ? e.message : STR.chatAttachFailed,
        });
      }
    },
    [patch, room],
  );

  // Poll the transcription runs backing any recording or link still in flight. One timer for
  // all of them, running ONLY while something is actually transcribing.
  const waiting = attachments.filter(
    (attachment) =>
      attachment.state === 'transcribing' &&
      attachment.transcriptionId !== undefined,
  );
  const waitingKey = waiting
    .map((attachment) => `${attachment.key}:${attachment.transcriptionId}`)
    .join(',');
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    if (waitingKey === '') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const pending = attachmentsRef.current.filter(
        (attachment) =>
          attachment.state === 'transcribing' &&
          attachment.transcriptionId !== undefined,
      );
      for (const attachment of pending) {
        try {
          // ?text=1: the transcript is the whole point here, and this only runs once the run
          // has something to hand over.
          const detail = await getTranscription(
            attachment.transcriptionId!,
            true,
          );
          if (cancelled) return;
          if (detail.status === 'ready') {
            const text = detail.combinedText ?? '';
            patch(attachment.key, {
              state: text.trim() === '' ? 'failed' : 'ready',
              text,
              ...(text.trim() === '' ? { error: STR.chatAttachFailed } : {}),
            });
          } else if (detail.status === 'failed') {
            patch(attachment.key, {
              state: 'failed',
              error: detail.error ?? STR.chatAttachFailed,
            });
          }
        } catch (e) {
          if (cancelled) return;
          patch(attachment.key, {
            state: 'failed',
            error: e instanceof Error ? e.message : STR.chatAttachFailed,
          });
        }
      }
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingKey, patch]);

  const remove = useCallback((key: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.key !== key),
    );
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  const toPayload = useCallback(
    (): ChatAttachment[] =>
      attachments
        .filter((attachment) => attachment.state === 'ready')
        .map((attachment) => ({
          kind: attachment.kind,
          name: attachment.name || STR.chatAttachedImage,
          ...(attachment.imageUrl !== undefined
            ? { imageUrl: attachment.imageUrl }
            : {}),
          ...(attachment.text !== undefined ? { text: attachment.text } : {}),
          ...(attachment.sourceUrl !== undefined
            ? { sourceUrl: attachment.sourceUrl }
            : {}),
        })),
    [attachments],
  );

  return {
    attachments,
    // A FAILED attachment does not block sending — it is reported and simply not carried, so
    // one bad file cannot trap a message the officer has already written.
    preparing: attachments.some(
      (attachment) =>
        attachment.state === 'preparing' || attachment.state === 'transcribing',
    ),
    full: attachments.length >= CHAT_MAX_ATTACHMENTS,
    addImages,
    addDocumentSlot,
    setDocumentText,
    addAudio,
    addYouTube,
    remove,
    clear,
    toPayload,
  };
}
