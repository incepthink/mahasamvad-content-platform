'use client';

// Which window each attached recording is set to use, for a composer that holds a list of
// picked recordings — /dlo, /transcribe and /chat all do.
//
// KEYED BY THE `File` OBJECT ITSELF, not by name or by index. A name is not unique (two takes
// of one meeting arrive as `recording.m4a` twice) and an index moves the moment a recording
// above it is removed — which is exactly when a mis-keyed window does its damage, silently
// re-pointing somebody's four-minute selection at a different two-hour meeting. The `File`
// picked from the dialog is a stable identity for as long as the form holds it, which is
// precisely the lifetime of the selection. A `WeakMap` would be tidier still; a plain `Map`
// is used because the list has to be re-read on every render and the entries are pruned
// against the current files anyway.
//
// THE WIRE FORMAT IS SPARSE. `audioTrims` carries one entry per TRIMMED recording, so a form
// where nothing was trimmed appends no field at all and its request is byte-for-byte what it
// was before this feature existed. See apps/api/src/routes/audio-trims.ts for the other half.

import { useCallback, useMemo, useState } from 'react';
import {
  formatTimecode,
  isPartialTrim,
  type AudioTrim,
  type AudioTrimEntry,
} from '@dgipr/schemas';
import { STR } from '@/lib/strings';

export type AudioTrimsState = ReturnType<typeof useAudioTrims>;

export function useAudioTrims() {
  const [trims, setTrims] = useState<ReadonlyMap<File, AudioTrim>>(new Map());

  const get = useCallback(
    (file: File): AudioTrim | null => trims.get(file) ?? null,
    [trims],
  );

  // `null` clears — which is what "use the whole recording" commits, and what keeps a stale
  // window from surviving a decision to stop trimming.
  const set = useCallback((file: File, trim: AudioTrim | null): void => {
    setTrims((current) => {
      const next = new Map(current);
      if (trim === null) next.delete(file);
      else next.set(file, trim);
      return next;
    });
  }, []);

  /**
   * Drop windows for recordings that are no longer attached.
   *
   * Called by the composer whenever its list changes. Without it a removed recording's window
   * would still be in the map, and re-attaching a file with the same identity later would
   * silently bring back a selection the officer had already discarded.
   */
  const retain = useCallback((files: readonly File[]): void => {
    setTrims((current) => {
      if (current.size === 0) return current;
      const keep = new Set(files);
      let changed = false;
      const next = new Map<File, AudioTrim>();
      for (const [file, trim] of current) {
        if (keep.has(file)) next.set(file, trim);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const clear = useCallback((): void => setTrims(new Map()), []);

  /**
   * The `audioTrims` field for a create request, or null when nothing was trimmed.
   *
   * `files` must be the recordings in the ORDER they are appended to the FormData — the index
   * is the key the API matches on, and the name travels with it as the check that catches a
   * list that has shifted underneath.
   */
  const fieldValue = useCallback(
    (files: readonly File[]): string | null => {
      const entries: AudioTrimEntry[] = [];
      files.forEach((file, index) => {
        const trim = trims.get(file);
        // A window covering the whole recording is not a trim: sending it would spend an
        // ffmpeg run and a stored object to reproduce the original.
        if (trim === undefined || !isPartialTrim(trim)) return;
        entries.push({
          index,
          name: file.name,
          startSeconds: trim.startSeconds,
          endSeconds: trim.endSeconds,
          ...(trim.durationSeconds !== undefined
            ? { durationSeconds: trim.durationSeconds }
            : {}),
        });
      });
      return entries.length === 0 ? null : JSON.stringify(entries);
    },
    [trims],
  );

  return useMemo(
    () => ({ get, set, retain, clear, fieldValue, count: trims.size }),
    [get, set, retain, clear, fieldValue, trims.size],
  );
}

/**
 * The second line on a trimmed recording's card: what was chosen, against how long the whole
 * recording is.
 *
 * Falls back to the file's size when nothing was trimmed, because that is what the card said
 * before and is still the most useful thing to know about an untrimmed upload.
 */
export function audioCardMeta(
  trim: AudioTrim | null,
  fallback: string,
): string {
  if (trim === null) return fallback;
  const window = `${formatTimecode(trim.startSeconds)}–${formatTimecode(trim.endSeconds)}`;
  return trim.durationSeconds === undefined
    ? window
    : STR.audioTrimCardMeta(window, formatTimecode(trim.durationSeconds));
}
