'use client';

/**
 * The pictures an officer attaches to a run for the IMAGE MODEL to see (migration 0056) —
 * "this building", "this person", "make it look like this".
 *
 * Its own hook rather than more fields on `useCreateForm` because this list has a LIFECYCLE
 * the rest of that form does not: each picture is uploaded the moment it is picked, so a card
 * can be in flight, stored or failed while the officer is still typing the note. Everything
 * the create request eventually SENDS still comes out of `useCreateForm` — this only decides
 * which picks are allowed in and what happened to each one.
 *
 * UPLOADED AS PICKED, NOT AT SUBMIT, and that is the point of the design: a phone photograph
 * is several megabytes, and a create that waited until the press would sit there uploading
 * with the officer wondering whether they had pressed it. Parallel uploads while the note is
 * being written cost that wait nothing.
 *
 * WHAT FAILED STAYS ON SCREEN. A picture whose upload failed keeps its card, labelled, and is
 * simply not among the paths the submit sends — where dropping it silently would produce a
 * poster that ignored one of the officer's pictures with nothing anywhere saying why. The
 * submit is blocked only while something is still IN FLIGHT, because that one resolves itself.
 *
 * Nothing here is drafted: a File is a live browser handle that cannot be serialized, and the
 * uploaded path is not worth restoring on its own — a picture with no thumbnail beside it is a
 * card the officer cannot identify.
 */

import { useCallback, useRef, useState } from 'react';
import {
  GENERATION_PROMPT_IMAGE_LIMIT,
  UPLOAD_FILE_MAX_BYTES,
  isImageFileName,
  type PromptImageUpload,
} from '@dgipr/schemas';
import { uploadPromptImage } from '@/lib/api';
import { acceptFilePicks } from '@/lib/filePicks';
import { errorMessage } from '@/lib/errorMessage';
import { STR } from '@/lib/strings';

export type PromptImageSlot = Readonly<{
  // Minted here and stable for the slot's life, so a card's identity does not move when one
  // above it is removed — two phone photographs can arrive called IMG_0001.jpg.
  id: string;
  file: File;
  // Null until the upload lands. `upload.path` is the ONLY thing the create request carries.
  upload: PromptImageUpload | null;
  status: 'uploading' | 'ready' | 'failed';
}>;

export type PromptImages = Readonly<{
  slots: readonly PromptImageSlot[];
  // The files, for the thumbnail URLs (lib/useFilePreviews keys its map by File).
  files: readonly File[];
  // What the create request sends: the stored paths, in the order they were attached, with
  // anything still uploading or failed left out.
  paths: readonly string[];
  // Something is still in flight, so a submit now would send a short list.
  uploading: boolean;
  add: (list: FileList | null) => void;
  remove: (id: string) => void;
  clear: () => void;
}>;

export function usePromptImages({
  onError,
}: {
  // Refusals — the wrong kind of file, one too large, one too many, an upload that failed.
  // Reported to the form so they land under the submit with every other reason a run cannot
  // start, rather than beside a picker halfway up the card.
  onError: (message: string) => void;
}): PromptImages {
  const [slots, setSlots] = useState<readonly PromptImageSlot[]>([]);
  // What `add` compares a new pick against, and what `remove` filters. A ref as well as
  // state because the acceptance check reports refusals, and a state updater may legitimately
  // run twice — a duplicate complaint for one pick is a bug the officer would see.
  const slotsRef = useRef<readonly PromptImageSlot[]>(slots);

  const write = useCallback((next: readonly PromptImageSlot[]) => {
    slotsRef.current = next;
    setSlots(next);
  }, []);

  // Patch ONE slot by id, leaving the rest alone. By id rather than by index because an
  // upload lands long after it started and the officer may have removed a card above it.
  const patch = useCallback(
    (id: string, change: Partial<PromptImageSlot>) => {
      const next = slotsRef.current.map((slot) =>
        slot.id === id ? { ...slot, ...change } : slot,
      );
      // A slot removed while its upload was in flight stays removed: the map above found
      // nothing to change, so this is a no-op rather than a resurrection.
      write(next);
    },
    [write],
  );

  const add = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const current = slotsRef.current;
      const {
        files: accepted,
        added,
        error,
      } = acceptFilePicks({
        current: current.map((slot) => slot.file),
        picked: Array.from(list),
        isAllowedName: isImageFileName,
        typeError: STR.promptImageTypeError,
        // The route's own ceiling, so an oversized picture is refused in the same gesture
        // rather than at the end of its upload.
        maxBytes: UPLOAD_FILE_MAX_BYTES,
      });
      if (error) onError(error);
      if (added === 0) return;

      // The cap, applied to what SURVIVED the checks above. Reported rather than silently
      // trimmed: an officer who attaches six pictures and sees four has to be told which rule
      // applied. The type/size complaint wins when there is one — it is the more specific.
      const room = GENERATION_PROMPT_IMAGE_LIMIT - current.length;
      const fresh = accepted.slice(current.length, current.length + room);
      if (fresh.length < added && !error) {
        onError(
          STR.promptImageLimit(
            GENERATION_PROMPT_IMAGE_LIMIT.toLocaleString('mr-IN'),
          ),
        );
      }
      if (fresh.length === 0) return;

      const slots = fresh.map<PromptImageSlot>((file) => ({
        id: crypto.randomUUID(),
        file,
        upload: null,
        status: 'uploading',
      }));
      write([...current, ...slots]);

      // Started here rather than in an effect: the pick IS the event, and an effect over the
      // list would have to work out which entries it had not uploaded yet.
      for (const slot of slots) {
        void (async () => {
          try {
            patch(slot.id, {
              upload: await uploadPromptImage(slot.file),
              status: 'ready',
            });
          } catch (e) {
            patch(slot.id, { status: 'failed' });
            onError(errorMessage(e));
          }
        })();
      }
    },
    [onError, patch, write],
  );

  const remove = useCallback(
    (id: string) => {
      write(slotsRef.current.filter((slot) => slot.id !== id));
    },
    [write],
  );

  const clear = useCallback(() => write([]), [write]);

  return {
    slots,
    files: slots.map((slot) => slot.file),
    paths: slots
      .map((slot) => slot.upload?.path)
      .filter((path): path is string => typeof path === 'string'),
    uploading: slots.some((slot) => slot.status === 'uploading'),
    add,
    remove,
    clear,
  };
}
