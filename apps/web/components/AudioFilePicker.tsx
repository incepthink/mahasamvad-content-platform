'use client';

// The recording picker, shared by /dlo's intake form and /transcribe.
//
// Both surfaces ask for exactly the same thing — meeting recordings, several at a time, listed
// with their sizes and removable one by one — so they render one component rather than two
// lookalikes that drift apart. A card, a hint, one upload button, and the list underneath.
//
// Both file guards are decided by lib/filePicks, shared with the photograph picker and with
// /dlo's combined sources card, and they run HERE rather than only on the server for the same
// reason: a recording takes minutes to upload, so "wrong container" and "too big" have to be
// said at the picker. The server still enforces the size (routes/transcriptions.ts) against
// the same UPLOAD_FILE_MAX_BYTES, so this is the earlier of two answers, never the only one.
// The size half is now stated by the CALLER, because only /transcribe still has a ceiling to
// state: /dlo's intake route dropped its per-file cap, so its sources card passes none.

import { useRef, type ReactNode } from 'react';
import { Mic, Music, X } from 'lucide-react';
import {
  AUDIO_FILE_ACCEPT,
  UPLOAD_FILE_MAX_BYTES,
  isAudioFileName,
} from '@dgipr/schemas';
import { acceptFilePicks } from '../lib/filePicks';
import { CardTitle } from './CardTitle';
import { STR } from '../lib/strings';

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// The attached recordings, name + size + a way to drop one. Split out of the card below so
// /dlo's combined sources card can list its recordings without also inheriting a heading, a
// hint and an upload button it renders once for all three kinds of source.
export function AudioFileList({
  files,
  onChange,
}: {
  files: readonly File[];
  onChange: (files: File[]) => void;
}) {
  return (
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
  );
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
    const {
      files: next,
      added,
      error,
    } = acceptFilePicks({
      current: files,
      picked: Array.from(list),
      isAllowedName: isAudioFileName,
      typeError: STR.dloFileTypeError,
      // /transcribe's own route (routes/transcriptions.ts) still caps a recording at this,
      // so the picker says so first rather than after the upload. /dlo's sources card
      // deliberately passes none — its intake route has no per-file ceiling.
      maxBytes: UPLOAD_FILE_MAX_BYTES,
    });
    onError(error);
    if (added === 0) return;
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
          <AudioFileList files={files} onChange={onChange} />
        </>
      ) : null}
    </section>
  );
}
