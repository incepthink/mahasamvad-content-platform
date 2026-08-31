'use client';

// The composer's attachment tray: everything between picking a file and having something the
// turn can carry.
//
// Images, recordings, DOCX and TXT keep the ATTACH → SEND → PREPARE rule: picking them costs
// nothing, and `prepare()` does their work only after Send. PDFs are the deliberate exception.
// They start an upload to OpenAI as soon as they are selected, overlapping preparation with
// the time the officer spends typing. No page-by-page OCR or transcription occurs — the model
// reads them through file search, which is also why a chat PDF may be up to 512 MB.
//
// **PRESSING SEND NEVER WAITS FOR ANY OF IT.** `prepare()` is called after the turn is already
// on screen, so an officer who picks a 30 MB PDF and immediately types a question is not held
// in front of a disabled button. Two consequences are load-bearing here:
//
//   - a selection-time upload that is still running is AWAITED at the top of `prepare()`. It
//     is neither 'pending' nor 'ready' at that moment, so without the wait the document would
//     be silently dropped from the very turn it was attached to;
//   - `prepare()` CONSUMES what it carried — it removes those chips itself, rather than the
//     caller clearing the tray up front. A failure keeps its chip and its message, which is
//     the only place the officer would ever see it, and an attachment picked while the turn
//     was being prepared is not in the snapshot and so survives untouched.
//
// Where the remaining work happens:
//   - PDFs go directly to the chat upload endpoint, which stages them in the private bucket
//     and hands them to OpenAI for file search;
//   - DOCX/TXT still go through the shared ephemeral document service (/api/documents);
//   - recordings and YouTube links go through the EXISTING /api/transcriptions job, which
//     brings the 0031 content-addressed cache with it — a recording already transcribed on
//     /transcribe comes back here instantly and free, and vice versa. The visible cost is that
//     a chat recording also appears in /transcribe's history; the composer hint says so rather
//     than letting it surprise someone.

import { useCallback, useRef, useState } from 'react';
import {
  CHAT_MAX_ATTACHMENTS,
  isImageFileName,
  type ChatAttachment,
  type YouTubeVideo,
} from '@dgipr/schemas';
import {
  createDocumentIntake,
  createTranscription,
  extractDocumentIntakePages,
  getDocumentIntake,
  getTranscription,
  uploadChatDocument,
  uploadChatImage,
} from './api';
import { joinPageTexts, numberedPages } from './documentSelection';
import { STR } from './strings';
import { errorMessage } from './errorMessage';

export type DraftAttachmentState =
  'pending' | 'preparing' | 'transcribing' | 'ready' | 'failed';

export type DraftAttachment = Readonly<{
  // Local only — the API never sees it.
  key: string;
  kind: ChatAttachment['kind'];
  name: string;
  state: DraftAttachmentState;
  error?: string;
  // Non-PDF files are held until the turn is sent, then consumed by prepare().
  file?: File;
  video?: YouTubeVideo;
  // Present once ready.
  imageUrl?: string;
  documentId?: string;
  text?: string;
  sourceUrl?: string;
  // The transcription run backing a recording or link, once one has been started.
  transcriptionId?: string;
}>;

const TRANSCRIPTION_POLL_INTERVAL_MS = 4000;
// ~40 minutes at the interval above. A cap only so a run that never terminates fails its chip
// instead of holding the turn open forever.
const TRANSCRIPTION_POLL_MAX_TICKS = 600;

// ---------- documents ----------

const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;
export const CHAT_DOCUMENT_ACCEPT: string = DOCUMENT_EXTENSIONS.join(',');

function isDocumentFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

const DOCUMENT_POLL_INTERVAL_MS = 2500;
// ~25 minutes at the interval above, past the longest realistic chunked OCR. A cap only so a
// job that never leaves 'extracting' fails the chip instead of polling forever.
const DOCUMENT_POLL_MAX_TICKS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Upload one legacy text document and return its text. PDFs never enter this function: their
// upload begins in addDocuments() and produces a documentId rather than text.
//
// **DOCX/TXT reads the WHOLE document — there is no page picker here.** The publishing
// surfaces (/dlo, /translate, /proofread, the media room) retain their page picker and OCR
// gate; this native-PDF change is isolated to the general chat.
async function readDocument(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  // Declares the surface for the shared non-PDF intake service.
  form.append('surface', 'chat');
  const created = await createDocumentIntake(form);
  let extractRequested = false;

  for (let tick = 0; tick < DOCUMENT_POLL_MAX_TICKS; tick += 1) {
    // Lean poll — the page text is fetched once, at the end, when there is something to fetch.
    const detail = await getDocumentIntake(created.id);

    if (detail.status === 'selecting') {
      // A scan waiting to be told which pages to read. All of them.
      const pages = numberedPages(detail.pageCount ?? 0);
      if (pages.length === 0) {
        throw new Error(detail.error ?? STR.chatAttachFailed);
      }
      if (!extractRequested) {
        extractRequested = true;
        await extractDocumentIntakePages(created.id, pages);
      }
    } else if (detail.status !== 'extracting') {
      // 'ready' or 'failed'. A failure that still produced pages is usable text plus a
      // warning, so the page list decides, not the status.
      if (detail.pages.length === 0) {
        throw new Error(detail.error ?? STR.chatAttachFailed);
      }
      const withText = await getDocumentIntake(created.id, true);
      return joinPageTexts(withText.pages);
    }

    await sleep(DOCUMENT_POLL_INTERVAL_MS);
  }
  throw new Error(STR.chatAttachFailed);
}

// Wait for a transcription run to land. Only ever called on a run this hook started.
async function waitForTranscript(id: string): Promise<string> {
  for (let tick = 0; tick < TRANSCRIPTION_POLL_MAX_TICKS; tick += 1) {
    await sleep(TRANSCRIPTION_POLL_INTERVAL_MS);
    // ?text=1: the transcript is the whole point here.
    const detail = await getTranscription(id, true);
    if (detail.status === 'ready') return detail.combinedText ?? '';
    if (detail.status === 'failed') {
      throw new Error(detail.error ?? STR.chatAttachFailed);
    }
  }
  throw new Error(STR.chatAttachFailed);
}

let nextKey = 0;
function makeKey(): string {
  nextKey += 1;
  return `att-${nextKey}-${Date.now().toString(36)}`;
}

// The wire shape of a draft that has been prepared. Local bookkeeping (the key, the File, the
// transcription id) is stripped here and nowhere else.
function payloadOf(draft: DraftAttachment): ChatAttachment {
  return {
    kind: draft.kind,
    name: draft.name || STR.chatAttachedImage,
    ...(draft.imageUrl !== undefined ? { imageUrl: draft.imageUrl } : {}),
    ...(draft.documentId !== undefined
      ? { documentId: draft.documentId }
      : {}),
    ...(draft.text !== undefined ? { text: draft.text } : {}),
    ...(draft.sourceUrl !== undefined ? { sourceUrl: draft.sourceUrl } : {}),
  };
}

export function useChatAttachments(): {
  attachments: DraftAttachment[];
  // True while a selected PDF is becoming active or while send-time attachments are prepared.
  // It drives the composer's "फाईल तयार करत आहोत…" line and NOTHING else — in particular it is
  // no longer the send button's gate, which is the whole point of the header above.
  preparing: boolean;
  full: boolean;
  addImages: (files: readonly File[]) => void;
  addDocuments: (files: readonly File[]) => void;
  addAudio: (files: readonly File[]) => void;
  addYouTube: (video: YouTubeVideo) => void;
  remove: (key: string) => void;
  // The chips to put under the officer's turn the moment it is sent: kinds and names only,
  // because nothing has been read yet. Exactly what `prepare()` is about to work on, since
  // both read the same ref in the same tick.
  preview: () => ChatAttachment[];
  // Do the work — wait for any selection-time upload, upload the images, read the documents,
  // transcribe the recordings and links — and return what the turn should carry, in the order
  // they were picked. Carried attachments are removed from the tray; a failed one is reported
  // on its chip and simply not carried, so one bad file cannot trap a message.
  prepare: () => Promise<ChatAttachment[]>;
} {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [preparingTurn, setPreparingTurn] = useState(false);
  // Guards against a second prepare starting before the first has released the button.
  const preparingRef = useRef(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  // Selection-time uploads still in flight, by draft key. Never rejects — each entry owns its
  // own catch — so awaiting one can only mean "this file has settled, ready or failed".
  const inflight = useRef(new Map<string, Promise<void>>());

  const patch = useCallback((key: string, next: Partial<DraftAttachment>) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.key === key ? { ...attachment, ...next } : attachment,
      ),
    );
  }, []);

  const fail = useCallback(
    (key: string, e: unknown) => {
      patch(key, {
        state: 'failed',
        error: errorMessage(e, STR.chatAttachFailed),
      });
    },
    [patch],
  );

  // How many more will fit. Picking several files at once is normal (a phone hands over five
  // photographs), so the excess is silently dropped rather than the whole pick refused.
  const add = useCallback((made: readonly DraftAttachment[]) => {
    if (made.length === 0) return [];
    const accepted = made.slice(
      0,
      Math.max(0, CHAT_MAX_ATTACHMENTS - attachmentsRef.current.length),
    );
    if (accepted.length > 0) {
      setAttachments((current) => [...current, ...accepted]);
    }
    return accepted;
  }, []);

  const addImages = useCallback(
    (files: readonly File[]) => {
      add(
        files
          .filter((file) => isImageFileName(file.name))
          .map((file) => ({
            key: makeKey(),
            kind: 'image' as const,
            name: file.name,
            state: 'pending' as const,
            file,
          })),
      );
    },
    [add],
  );

  const addDocuments = useCallback(
    (files: readonly File[]) => {
      const accepted = add(
        files
          .filter((file) => isDocumentFileName(file.name))
          .map((file) => ({
            key: makeKey(),
            kind: 'document' as const,
            name: file.name,
            state: file.name.toLowerCase().endsWith('.pdf')
              ? ('preparing' as const)
              : ('pending' as const),
            file,
          })),
      );

      for (const draft of accepted) {
        if (!draft.file?.name.toLowerCase().endsWith('.pdf')) continue;
        const upload = uploadChatDocument(draft.file)
          .then((uploaded) => {
            patch(draft.key, {
              state: 'ready',
              documentId: uploaded.documentId,
            });
          })
          .catch((error: unknown) => fail(draft.key, error))
          // Registered so a turn sent mid-upload waits for THIS file rather than leaving
          // without it; removed once settled so the map cannot grow across a long chat.
          .finally(() => {
            inflight.current.delete(draft.key);
          });
        inflight.current.set(draft.key, upload);
      }
    },
    [add, fail, patch],
  );

  const addAudio = useCallback(
    (files: readonly File[]) => {
      add(
        files.map((file) => ({
          key: makeKey(),
          kind: 'audio' as const,
          name: file.name,
          state: 'pending' as const,
          file,
        })),
      );
    },
    [add],
  );

  const addYouTube = useCallback(
    (video: YouTubeVideo) => {
      add([
        {
          key: makeKey(),
          kind: 'youtube',
          name: video.title ?? video.url,
          state: 'pending',
          sourceUrl: video.url,
          video,
        },
      ]);
    },
    [add],
  );

  const remove = useCallback((key: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.key !== key),
    );
  }, []);

  // No `clear`: `prepare()` consumes what it carried, so there is no moment at which the
  // caller should be dropping the tray wholesale — doing so would take a failed chip's
  // message with it, and a chip is the only place that message is shown.
  const preview = useCallback(
    (): ChatAttachment[] =>
      attachmentsRef.current
        .filter((attachment) => attachment.state !== 'failed')
        .map((attachment) => ({
          kind: attachment.kind,
          name: attachment.name || STR.chatAttachedImage,
          // A link is the one attachment whose identity is known before any work is done.
          ...(attachment.sourceUrl !== undefined
            ? { sourceUrl: attachment.sourceUrl }
            : {}),
        })),
    [],
  );

  const prepare = useCallback(async (): Promise<ChatAttachment[]> => {
    if (preparingRef.current) return [];
    const snapshot = attachmentsRef.current;
    if (snapshot.length === 0) return [];
    const mine = new Set(snapshot.map((attachment) => attachment.key));

    preparingRef.current = true;
    setPreparingTurn(true);
    const done = new Map<string, ChatAttachment>();

    try {
      // 0. A PDF picked moments ago may still be uploading — Send does not wait for it, so
      //    the wait is here. Until it settles the draft is neither 'pending' nor 'ready', and
      //    every branch below would skip it: the document would go missing from the very turn
      //    it was attached to.
      await Promise.all(
        [...inflight.current]
          .filter(([key]) => mine.has(key))
          .map(([, settled]) => settled),
      );
      // Re-read after the wait: the states above are stale, and an upload that just landed
      // wrote its documentId through `patch`.
      const drafts = attachmentsRef.current.filter((attachment) =>
        mine.has(attachment.key),
      );

      // A draft already carrying its result is one that survived an earlier prepare whose
      // siblings failed, or a PDF whose upload finished while the officer typed. Re-reading
      // it would be a second charge for the same bytes.
      for (const draft of drafts) {
        if (draft.state === 'ready') done.set(draft.key, payloadOf(draft));
      }

      // 1. The transcription runs are STARTED first and awaited last, so a recording is
      //    already being transcribed by Sarvam while the documents are read here.
      const waitingFor: { draft: DraftAttachment; id: string }[] = [];
      for (const draft of drafts) {
        if (draft.state !== 'pending') continue;
        if (draft.kind !== 'audio' && draft.kind !== 'youtube') continue;
        patch(draft.key, { state: 'transcribing' });
        try {
          const form = new FormData();
          if (draft.kind === 'audio') {
            if (!draft.file) throw new Error(STR.chatAttachFailed);
            form.append('files', draft.file);
          } else {
            if (!draft.video) throw new Error(STR.chatAttachFailed);
            form.append('youtube', JSON.stringify([draft.video]));
          }
          // One run per source, so a failure is isolated to its own chip and the other files
          // still deliver — the same stance the transcription job itself takes.
          const id = await createTranscription(form);
          patch(draft.key, { transcriptionId: id });
          waitingFor.push({ draft, id });
        } catch (e) {
          fail(draft.key, e);
        }
      }

      // 2. Images and documents, serially: several photographs from a phone are megabytes
      //    each and a scanned PDF's OCR runs on a lane the API already serializes, so firing
      //    them all at once would only make the tray lie about which one is being read.
      for (const draft of drafts) {
        if (draft.state !== 'pending') continue;
        if (draft.kind !== 'image' && draft.kind !== 'document') continue;
        patch(draft.key, { state: 'preparing' });
        try {
          if (!draft.file) throw new Error(STR.chatAttachFailed);
          if (draft.kind === 'image') {
            const uploaded = await uploadChatImage(draft.file);
            patch(draft.key, { state: 'ready', imageUrl: uploaded.imageUrl });
            done.set(
              draft.key,
              payloadOf({ ...draft, imageUrl: uploaded.imageUrl }),
            );
          } else {
            const text = await readDocument(draft.file);
            if (text.trim() === '') {
              // An empty read is a real answer ("this file contributed nothing"), but there
              // is nothing to carry, so it must not count as ready.
              patch(draft.key, { state: 'failed', error: STR.chatAttachEmpty });
            } else {
              patch(draft.key, { state: 'ready', text });
              done.set(draft.key, payloadOf({ ...draft, text }));
            }
          }
        } catch (e) {
          fail(draft.key, e);
        }
      }

      // 3. Collect the transcripts. In parallel — these are independent server-side runs, and
      //    two recordings should not take twice as long as one.
      await Promise.all(
        waitingFor.map(async ({ draft, id }) => {
          try {
            const text = await waitForTranscript(id);
            if (text.trim() === '') {
              patch(draft.key, {
                state: 'failed',
                error: STR.chatAttachEmpty,
              });
              return;
            }
            patch(draft.key, { state: 'ready', text });
            done.set(draft.key, payloadOf({ ...draft, text }));
          } catch (e) {
            fail(draft.key, e);
          }
        }),
      );

      // Pick order, and only what is still attached — an officer who removed a chip while it
      // was being read must not find it on the message anyway.
      const live = new Set(
        attachmentsRef.current.map((attachment) => attachment.key),
      );
      return drafts
        .filter((draft) => live.has(draft.key))
        .map((draft) => done.get(draft.key))
        .filter((entry): entry is ChatAttachment => entry !== undefined);
    } finally {
      preparingRef.current = false;
      setPreparingTurn(false);
      // Consume what the turn carried. Done here rather than by the caller clearing the tray
      // up front, so a failure keeps its chip and its message, and anything attached while
      // this ran is not in `done` and so survives.
      setAttachments((current) =>
        current.filter((attachment) => !done.has(attachment.key)),
      );
    }
  }, [fail, patch]);

  return {
    attachments,
    preparing:
      preparingTurn ||
      attachments.some(
        (attachment) =>
          attachment.kind === 'document' &&
          attachment.state === 'preparing',
      ),
    full: attachments.length >= CHAT_MAX_ATTACHMENTS,
    addImages,
    addDocuments,
    addAudio,
    addYouTube,
    remove,
    preview,
    prepare,
  };
}
