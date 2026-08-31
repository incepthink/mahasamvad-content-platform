'use client';

// One object URL per picked image file, revoked when the list changes — a meeting's worth
// of phone photographs held as blobs is real memory.
//
// THE URLS ARE MINTED INSIDE THE EFFECT THAT REVOKES THEM, and that pairing is
// load-bearing rather than a matter of taste. Built in a useMemo and revoked in an effect,
// the very FIRST photograph never appeared: React's dev StrictMode runs a new effect
// setup → cleanup → setup, the cleanup revoked URLs the memo had already produced, and the
// memo does not re-run for an effect re-run — so the tile rendered a dead blob: URL.
// Attaching a second photograph changed the list, the memo minted fresh URLs, and both
// appeared, which is exactly the shape the bug was reported in. Minted and revoked in one
// effect, a cleanup can only ever revoke what its own setup made.
//
// Returned as a Map keyed by the File itself rather than by index, so a caller that mixes
// photographs into a list with other kinds of source (the attachment strip) cannot line the
// wrong URL up against the wrong file.

import { useEffect, useState } from 'react';

export function useFilePreviews(
  files: readonly File[],
): ReadonlyMap<File, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<File, string>>(
    () => new Map(),
  );

  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of files) next.set(file, URL.createObjectURL(file));
    setPreviews(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [files]);

  return previews;
}
