'use client';

// The recording picker, shared by /dlo's intake form and /transcribe.
//
// Both surfaces ask for exactly the same thing — meeting recordings, several at a time, listed
// with their sizes and removable one by one — so they render one component rather than two
// lookalikes that drift apart. A card, a hint, one upload button, and the list underneath.
//
// It owns both file guards, and they are here rather than on the server for the same reason:
// a recording takes minutes to upload, so "wrong container" and "too big" have to be said at
// the picker. The server still enforces the size (routes/dlo.ts, routes/transcriptions.ts)
// against the same UPLOAD_FILE_MAX_BYTES, so this is the earlier of two answers, never the
// only one.

import { useRef, type ReactNode } from 'react';
import { Mic, Music, X } from 'lucide-react';
import {
  AUDIO_FILE_ACCEPT,
  isAudioFileName,
  UPLOAD_FILE_MAX_BYTES,
} from '@dgipr/schemas';
import { CardTitle } from './CardTitle';
import { STR } from '../lib/strings';

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AudioFilePicker({
  title,
  hint,
  uploadLabel,
  filesTitle,
  files,
  onChange,
  onError,
  maxFiles,
  disabled = false,
  notice,
}: {
  title: string;
  hint: string;
  uploadLabel: string;
  filesTitle: string;
  files: readonly File[];
  // Called with the whole next list, so the caller keeps ownership of the files it will
  // submit — this component only decides which picks are allowed to join them.
  onChange: (files: File[]) => void;
  // Rejections are reported to the caller rather than rendered here, so the message appears
  // beside the submit button with every other reason a run cannot start.
  onError: (message: string | null) => void;
  maxFiles?: number | undefined;
  disabled?: boolean | undefined;
  // Anything the surface needs between the button and the list — /dlo uses it to ask for
  // recordings a reload could not keep.
  notice?: ReactNode | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const atLimit = maxFiles !== undefined && files.length >= maxFiles;

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const audio = picked.filter((file) => isAudioFileName(file.name));
    const accepted = audio.filter((file) => file.size <= UPLOAD_FILE_MAX_BYTES);
    // Two different complaints, so two different messages. A pick that fails the container
    // check never reaches the size check, and is reported as the wrong type.
    onError(
      audio.length < picked.length
        ? STR.dloFileTypeError
        : accepted.length < audio.length
          ? STR.fileTooLargeError
          : null,
    );
    if (accepted.length === 0) return;
    const next = [
      ...files,
      // Same name AND size is the same recording picked twice; a genuine re-record differs
      // in one or the other.
      ...accepted.filter(
        (file) =>
          !files.some((p) => p.name === file.name && p.size === file.size),
      ),
    ];
    onChange(maxFiles === undefined ? next : next.slice(0, maxFiles));
  };

  return (
    <section className="card">
      {/* An <h2>, like every other card heading on both surfaces this picker appears on.
          .field-label is scoped to <label> in globals.css, so a <p> carrying it got no
          weight at all and this card's title read as body text beside its neighbours.
          The microphone is fixed here rather than passed in: this component only ever
          takes recordings, so a caller choosing the icon could only get it wrong. */}
      <CardTitle icon={Mic}>{title}</CardTitle>
      <p className="hint">{hint}</p>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled || atLimit}
          onClick={() => input.current?.click()}
        >
          {uploadLabel}
        </button>
        <input
          ref={input}
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            // Clearing lets the same file be re-picked after it was removed.
            event.target.value = '';
          }}
        />
      </div>

      {notice}

      {files.length > 0 ? (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {filesTitle}
          </p>
          <ul className="file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="file-row">
                <Music size={20} aria-hidden="true" />
                <span className="file-name">{file.name}</span>
                <span className="file-size">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="file-remove"
                  aria-label={`${STR.dloRemoveFile}: ${file.name}`}
                  onClick={() => onChange(files.filter((_, i) => i !== index))}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
