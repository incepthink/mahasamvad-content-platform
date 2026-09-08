'use client';

/**
 * "Attach files, get their text." The /dlo composer's document model, for the two surfaces
 * whose whole job is a string: /translate and /proofread.
 *
 * WHAT CHANGED AND WHY. Both pages used to mount one <DocumentIntake> as a BLOCK below the
 * composer: a card with its own upload control, its own page picker and its own hand-over
 * button. One file at a time, three presses to get a scanned PDF translated, and a second
 * form on a page that already had one — while /dlo, asked the same question, had long since
 * moved to a paperclip, a file dialog and a row of cards. This is that shape, applied here:
 *
 *   press the paperclip          → the browser's own file dialog, several files at once
 *   what is attached             → one card per file in the composer's AttachmentStrip
 *   press the page's own submit  → anything unread is read, then the run continues
 *
 * THE SPEND GATE IS UNCHANGED, and it is why the reading is not done at attach time. Every
 * PDF is read by OCR now (PDF_EXTRACTION_MODE=ocr), which is billed per page, so a file
 * attached and then thought better of must not have cost anything. Attaching PROBES — free
 * — and the press that authorises the OCR is भाषांतर करा / तपासा itself. What is gone is the
 * per-page QUESTION, not the gate: /dlo dropped it first, on the grounds that a document is
 * attached in order to be read whole and the officer was answering a question with no
 * consequence.
 *
 * Each file is read by its own <DocumentIntake>, which is where the upload, the
 * poll, the whole-document selection, the OCR read and the HTML→prose conversion already
 * live. Nothing about reading a document is reimplemented here. This owns the LIST, and the
 * reasons a list needs owning are that the page needs one combined string, one aggregate
 * status to gate its submit on, and one row of cards. Opening a card exposes the existing
 * page selection, text correction and OCR retry controls. Uploaded jobs survive refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { DOCUMENT_MAX_BYTES, type AnalyticsFeatureKey } from '@dgipr/schemas';
import {
  DOCUMENT_FILE_ACCEPT,
  DocumentIntake,
  isDocumentFileName,
  type DocumentIntakeInfo,
  type DocumentIntakeStatus,
} from '@/components/DocumentIntake';
import { acceptFilePicks } from '@/lib/filePicks';
import { formatFileSize } from '@/lib/fileSize';
import { STR } from '@/lib/strings';
import type { AttachmentItem } from './AttachmentStrip';

type Slot = Readonly<{
  id: string;
  name: string;
  size: number;
  storageKey: string;
  file?: File;
}>;

export type DocumentAttachments = Readonly<{
  // Every attached document's text, blank-line separated, in the order they were attached.
  // Empty while nothing has been read.
  text: string;
  // The cards for the composer's AttachmentStrip.
  items: readonly AttachmentItem[];
  /**
   * The list as ONE status, ordered by what the submit has to do about it:
   *
   *   unread   something is attached that nobody has paid to read yet, so the submit must
   *            read before it can run.
   *   reading  a read (or an upload) is in flight; the submit waits.
   *   ready    there is text.
   *   failed   everything attached failed to read.
   *   empty    nothing attached.
   */
  status: DocumentIntakeStatus;
  count: number;
  // Opens the file dialog. The button lives in the caller's tool row, so the input is here
  // and the press is theirs.
  pick: () => void;
  // "Read whatever is attached and not read yet." Each reader ignores it unless it is the
  // one waiting, so this is safe to call over a mixed list.
  requestRead: () => void;
  clear: () => void;
  // The hidden picker and each document reader; opening an attachment reveals its reader.
  readers: ReactNode;
}>;

export function useDocumentAttachments({
  storagePrefix,
  feature,
  onError,
  onTextChange,
  disabled = false,
}: {
  // Where each reader remembers its in-flight job across a refresh. One prefix per surface,
  // or two pages would fight over one job.
  storagePrefix: string;
  // Which sidebar feature a paid read belongs to, for /analytics attribution.
  feature: AnalyticsFeatureKey;
  // Refusals — the wrong kind of file, one too large, an upload that failed. Only real
  // messages are forwarded: a reader reports `null` on mount and there are several of them,
  // so passing that through would wipe a complaint the officer has not read yet.
  onError: (message: string) => void;
  // The combined text changed, which on both surfaces invalidates whatever was produced
  // from the previous text. Not called for the initial empty string.
  onTextChange?: (() => void) | undefined;
  disabled?: boolean | undefined;
}): DocumentAttachments {
  const [slots, setSlots] = useState<readonly Slot[]>([]);
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [statuses, setStatuses] = useState<
    Readonly<Record<string, DocumentIntakeStatus>>
  >({});
  const [infos, setInfos] = useState<
    Readonly<Record<string, DocumentIntakeInfo | null>>
  >({});
  // A counter rather than a flag, so a retry after a failed read is an explicit new request
  // — the rule <DocumentIntake> already applies to its own `readRequest`.
  const [readRequest, setReadRequest] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // What `add` compares a new pick against. A ref rather than the state itself so the
  // acceptance check (which reports refusals) stays out of a state updater, where React may
  // legitimately run it twice.
  const slotsRef = useRef<readonly Slot[]>(slots);

  // Restore uploaded jobs, including the single-document key used by the old form.
  // Unique slot IDs prevent a new pick from adopting a different file's cached job.
  useEffect(() => {
    let saved: Slot[] = [];
    try {
      const parsed: unknown = JSON.parse(
        window.sessionStorage.getItem(`${storagePrefix}.attachments`) ?? '[]',
      );
      if (Array.isArray(parsed)) {
        saved = parsed.filter(
          (slot): slot is Slot =>
            typeof slot?.id === 'string' &&
            typeof slot?.name === 'string' &&
            typeof slot?.size === 'number' &&
            typeof slot?.storageKey === 'string' &&
            slot.storageKey.startsWith(`${storagePrefix}.`) &&
            !!window.sessionStorage.getItem(slot.storageKey),
        );
      }
    } catch {
      // A stale local manifest does not prevent attaching a fresh document.
    }
    const legacyJob = window.sessionStorage.getItem(storagePrefix);
    if (legacyJob && saved.length === 0) {
      const id = crypto.randomUUID();
      const storageKey = `${storagePrefix}.${id}`;
      window.sessionStorage.setItem(storageKey, legacyJob);
      window.sessionStorage.removeItem(storagePrefix);
      saved = [{ id, name: STR.docUploadTitle, size: 0, storageKey }];
    }
    slotsRef.current = saved;
    setSlots(saved);
    setRestored(true);
  }, [storagePrefix]);

  useEffect(() => {
    if (!restored) return;
    window.sessionStorage.setItem(
      `${storagePrefix}.attachments`,
      JSON.stringify(
        slots.map(({ id, name, size, storageKey }) => ({
          id,
          name,
          size,
          storageKey,
        })),
      ),
    );
  }, [slots, restored, storagePrefix]);

  const text = useMemo(
    () =>
      slots
        .map((slot) => (texts[slot.id] ?? '').trim())
        .filter((value) => value.length > 0)
        .join('\n\n'),
    [slots, texts],
  );

  const status = useMemo<DocumentIntakeStatus>(() => {
    if (slots.length === 0) return 'empty';
    // A slot with no status yet has just been picked and is uploading, which is a read in
    // flight as far as the submit is concerned.
    const list = slots.map((slot) => statuses[slot.id] ?? 'reading');
    if (list.includes('unread')) return 'unread';
    if (list.includes('reading')) return 'reading';
    if (list.includes('failed')) return 'failed';
    if (text.length > 0) return 'ready';
    return 'empty';
  }, [slots, statuses, text]);

  // Only a REAL change may invalidate a finished translation or check: a reader re-renders
  // on every poll and republishes the same string.
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  });
  const lastText = useRef(text);
  useEffect(() => {
    if (text === lastText.current) return;
    lastText.current = text;
    onTextChangeRef.current?.();
  }, [text]);

  const write = useCallback((next: readonly Slot[]) => {
    slotsRef.current = next;
    setSlots(next);
  }, []);

  const forget = useCallback(
    (id: string) => {
      // A reader adopts a job from sessionStorage before it looks at its file, so a key left
      // behind would re-attach a document the officer has just dropped.
      const slot = slotsRef.current.find((item) => item.id === id);
      if (slot) window.sessionStorage.removeItem(slot.storageKey);
      write(slotsRef.current.filter((slot) => slot.id !== id));
      const drop = <T,>(map: Readonly<Record<string, T>>) => {
        const next = { ...map };
        delete next[id];
        return next;
      };
      setTexts(drop);
      setStatuses(drop);
      setInfos(drop);
    },
    [storagePrefix, write],
  );

  const clear = useCallback(() => {
    for (const slot of slotsRef.current) {
      window.sessionStorage.removeItem(slot.storageKey);
    }
    write([]);
    setTexts({});
    setStatuses({});
    setInfos({});
  }, [storagePrefix, write]);

  const add = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const current = slotsRef.current;
      const { files, added, error } = acceptFilePicks({
        current: [],
        picked: Array.from(list).filter(
          (file) =>
            !current.some(
              (slot) => slot.name === file.name && slot.size === file.size,
            ),
        ),
        isAllowedName: isDocumentFileName,
        typeError: STR.docUnsupported,
        // The reading backend's own per-file ceiling, so an over-size scan is refused here
        // rather than several minutes into its upload.
        maxBytes: DOCUMENT_MAX_BYTES,
      });
      if (error) onError(error);
      if (added === 0) return;
      write([
        ...current,
        ...files.map((file) => {
          const id = crypto.randomUUID();
          return {
            id,
            file,
            name: file.name,
            size: file.size,
            storageKey: `${storagePrefix}.${id}`,
          };
        }),
      ]);
    },
    [onError, write, storagePrefix],
  );

  const items = useMemo<AttachmentItem[]>(
    () =>
      slots.map((slot) => {
        const slotStatus = statuses[slot.id] ?? 'reading';
        const info = infos[slot.id] ?? null;
        return {
          id: slot.id,
          name: info?.fileName ?? slot.name,
          icon: FileText,
          meta:
            slotStatus === 'reading'
              ? STR.attachmentReading
              : slotStatus === 'unread'
                ? STR.attachmentWillRead
                : slotStatus === 'failed'
                  ? STR.attachmentFailed
                  : info?.pageCount != null
                    ? `${info.pageCount.toLocaleString('mr-IN')} ${STR.attachmentPagesSuffix}`
                    : formatFileSize(slot.size),
          busy: slotStatus === 'reading',
          failed: slotStatus === 'failed',
          removeLabel: `${STR.docRemove}: ${info?.fileName ?? slot.name}`,
          onRemove: () => forget(slot.id),
          open: openId === slot.id,
          openLabel:
            openId === slot.id ? STR.attachmentClose : STR.attachmentOpen,
          onOpen: () =>
            setOpenId((current) => (current === slot.id ? null : slot.id)),
        };
      }),
    [slots, statuses, infos, forget, openId],
  );

  const readers = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={DOCUMENT_FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files);
          // Clearing lets the same file be re-picked after it was removed.
          event.target.value = '';
        }}
      />
      {slots.map((slot) => (
        <DocumentIntake
          key={slot.id}
          headless={openId !== slot.id}
          embedded
          storageKey={slot.storageKey}
          feature={feature}
          file={slot.file}
          onRemove={() => forget(slot.id)}
          readRequest={readRequest}
          onTextChange={(value) =>
            setTexts((prev) =>
              prev[slot.id] === value ? prev : { ...prev, [slot.id]: value },
            )
          }
          onStatusChange={(slotStatus, info) => {
            // Until an upload has produced a job, empty is still pending work.
            if (slotStatus === 'empty' && !info) slotStatus = 'reading';
            setStatuses((prev) =>
              prev[slot.id] === slotStatus
                ? prev
                : { ...prev, [slot.id]: slotStatus },
            );
            setInfos((prev) =>
              prev[slot.id]?.fileName === info?.fileName &&
              prev[slot.id]?.pageCount === info?.pageCount
                ? prev
                : { ...prev, [slot.id]: info },
            );
          }}
          onError={(message) => {
            if (message) {
              setStatuses((prev) => ({ ...prev, [slot.id]: 'failed' }));
              setOpenId(slot.id);
              onError(message);
            }
          }}
        />
      ))}
    </>
  );

  return {
    text,
    items,
    status,
    count: slots.length,
    pick: () => {
      if (!disabled) fileInput.current?.click();
    },
    requestRead: () => setReadRequest((request) => request + 1),
    clear,
    readers,
  };
}
