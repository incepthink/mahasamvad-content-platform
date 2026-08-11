'use client';

// The photograph picker on /dlo's intake form — the sibling of AudioFilePicker.
//
// It is a separate card from the documents rather than another <DocumentIntake> slot, and the
// reason is that a document card is built around a question an image does not have: which
// pages are worth reading. An image IS one page, so there is nothing to pick, nothing to
// probe and nothing to wait for — attaching it is the whole interaction, and the reading
// happens inside प्रक्रिया like a recording's transcription does. One card holding every
// photograph, with thumbnails, therefore says what is true: these are attachments, not
// documents to work through.
//
// The thumbnails are object URLs over the picked Files. They are revoked when the list
// changes, because a meeting's worth of phone photos held as blobs is real memory.
//
// Both file guards live here, as in AudioFilePicker: the server enforces the same
// UPLOAD_FILE_MAX_BYTES (routes/dlo.ts), so this is the earlier of two answers rather than
// the only one — but it is the one an officer sees before an upload runs.

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import {
  IMAGE_FILE_ACCEPT,
  isImageFileName,
  UPLOAD_FILE_MAX_BYTES,
} from '@dgipr/schemas';
import { CardTitle } from './CardTitle';
import { formatFileSize } from './AudioFilePicker';
import { STR } from '../lib/strings';

export function ImageFilePicker({
  files,
  onChange,
  onError,
  disabled = false,
  notice,
}: {
  files: readonly File[];
  // The whole next list, so the caller keeps ownership of what it will submit — this
  // component only decides which picks are allowed to join it.
  onChange: (files: File[]) => void;
  // Reported to the caller rather than rendered here, so a refusal appears beside the submit
  // button with every other reason a run cannot start.
  onError: (message: string | null) => void;
  disabled?: boolean | undefined;
  notice?: ReactNode | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);

  // One URL per file, rebuilt whenever the list changes. Keyed by identity rather than by
  // index so removing the first photograph does not re-create the others' URLs.
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );
  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.url);
    },
    [previews],
  );

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const images = picked.filter((file) => isImageFileName(file.name));
    const accepted = images.filter(
      (file) => file.size <= UPLOAD_FILE_MAX_BYTES,
    );
    // Two different complaints, so two different messages — a pick that fails the format
    // check never reaches the size check.
    onError(
      images.length < picked.length
        ? STR.dloImageTypeError
        : accepted.length < images.length
          ? STR.fileTooLargeError
          : null,
    );
    if (accepted.length === 0) return;
    onChange([
      ...files,
      // Same name AND size is the same photograph picked twice; two genuinely different
      // shots of the same page differ in one or the other.
      ...accepted.filter(
        (file) =>
          !files.some(
            (existing) =>
              existing.name === file.name && existing.size === file.size,
          ),
      ),
    ]);
  };

  return (
    <section className="card">
      <CardTitle icon={ImageIcon}>{STR.dloImagesTitle}</CardTitle>
      <p className="hint">{STR.dloImagesHint}</p>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {STR.dloImagesUpload}
        </button>
        <input
          ref={input}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            // Clearing lets the same photograph be re-picked after it was removed.
            event.target.value = '';
          }}
        />
      </div>

      {notice}

      {previews.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {STR.dloImagesFilesTitle}
          </p>
          <ul className="image-grid">
            {previews.map(({ file, url }, index) => (
              <li key={`${file.name}-${file.size}`} className="image-tile">
                {/* Plain <img>, like the YouTube thumbnails: this is a local object URL of
                    the officer's own pick, which next/image can never optimise and would
                    only wrap in a build-time-configured loader. */}
                <img src={url} alt={file.name} />
                <button
                  type="button"
                  className="image-remove"
                  aria-label={`${STR.dloRemoveFile}: ${file.name}`}
                  onClick={() => onChange(files.filter((_, i) => i !== index))}
                >
                  <X size={14} aria-hidden="true" />
                </button>
                <span className="image-tile-name" title={file.name}>
                  {file.name}
                </span>
                <span className="image-tile-size">
                  {formatFileSize(file.size)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
