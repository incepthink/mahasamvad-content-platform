'use client';

// The attached photographs, as a grid of thumbnails with a way to drop one.
//
// A grid rather than the recordings' name-and-size rows, and that is the whole reason this
// exists: a recording is identified by its file name, while half a dozen phone snaps of a GR
// are told apart by what they SHOW, never by IMG_20260811.jpg.
//
// It was a whole upload card of its own (ImageFilePicker) until /dlo's three source cards
// became one — the heading, the hint and the upload button now belong to DloSourcesCard,
// which asks for all three kinds of source in one row, and what was left here is the list.
// Named for what it renders, per the PointerSelector → PointerList precedent.
//
// The thumbnails are object URLs over the picked Files, revoked when the list changes,
// because a meeting's worth of phone photos held as blobs is real memory.
//
// The URLs are MINTED INSIDE the effect that revokes them, and that pairing is load-bearing
// rather than a matter of taste. Built in a useMemo and revoked in an effect, the very FIRST
// photograph never appeared: React's dev StrictMode runs a new effect setup → cleanup → setup,
// the cleanup revoked URLs the memo had already produced, and the memo does not re-run for an
// effect re-run — so the tile rendered a dead blob: URL. Attaching a second photograph changed
// `files`, the memo minted fresh URLs, and both appeared, which is exactly the shape the bug
// was reported in. Minted and revoked in one effect, a cleanup can only ever revoke what its
// own setup made.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { formatFileSize } from './AudioFilePicker';
import { FileName } from './FileName';
import { STR } from '../lib/strings';

export function ImageThumbnailGrid({
  files,
  onChange,
}: {
  files: readonly File[];
  // The whole next list, so the caller keeps ownership of what it will submit.
  onChange: (files: File[]) => void;
}) {
  // One URL per file, rebuilt whenever the list changes.
  const [previews, setPreviews] = useState<
    ReadonlyArray<{ file: File; url: string }>
  >([]);
  useEffect(() => {
    const next = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviews(next);
    return () => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    };
  }, [files]);

  return (
    <ul className="image-grid">
      {previews.map(({ file, url }, index) => (
        <li key={`${file.name}-${file.size}`} className="image-tile">
          {/* Plain <img>, like the YouTube thumbnails: this is a local object URL of the
              officer's own pick, which next/image can never optimise and would only wrap in
              a build-time-configured loader. */}
          <img src={url} alt={file.name} />
          <button
            type="button"
            className="image-remove"
            aria-label={`${STR.dloRemoveFile}: ${file.name}`}
            onClick={() => onChange(files.filter((_, i) => i !== index))}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <FileName name={file.name} className="image-tile-name" max={22} />
          <span className="image-tile-size">{formatFileSize(file.size)}</span>
        </li>
      ))}
    </ul>
  );
}
