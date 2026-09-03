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
// THE INPUT IS STABILISED HERE rather than at every call site. A composer derives its file
// list from attachment state that changes for reasons a picture does not care about (a
// document's read finishing, an upload reporting ready), and a fresh array each render would
// revoke and re-mint every URL — the <img> then reloads and the thumbnails flicker while a
// turn is being prepared. So the effect runs on the FILES, not on the array holding them.
//
// Returned as a Map keyed by the File itself rather than by index, so a caller that mixes
// photographs into a list with other kinds of source (the attachment strip) cannot line the
// wrong URL up against the wrong file.

import { useEffect, useRef, useState } from 'react';

export function useFilePreviews(
  files: readonly File[],
): ReadonlyMap<File, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<File, string>>(
    () => new Map(),
  );
  // The array the effect last saw. Replaced only when the files themselves differ, so an
  // equal-but-new array is not a change.
  const stable = useRef<readonly File[]>(files);
  const same =
    stable.current.length === files.length &&
    files.every((file, index) => stable.current[index] === file);
  if (!same) stable.current = files;
  const tracked = stable.current;

  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of tracked) next.set(file, URL.createObjectURL(file));
    setPreviews(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [tracked]);

  return previews;
}
