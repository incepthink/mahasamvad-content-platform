'use client';

// The Dynamic Poster lane's source control: the officer's finished still poster goes in here,
// by click or by drag-and-drop, and what comes back is the storage PATH the create request
// carries.
//
// It uploads on PICK rather than on submit, which is the /video reference-image shape and is
// what makes the drop zone become a real preview immediately — the officer is going to spend
// the next minute typing their direction beside it, and finding out then that the file was
// refused would be finding out too late. The path is what leaves this component; the API
// accepts only paths it minted itself, so the browser never names an arbitrary object.
//
// The picture is shown at its own aspect ratio (a DGIPR poster is portrait far more often than
// not) with the measured pixel size beside it. That number is a RECEIPT — proof the API read
// the file the officer meant — and no longer a promise about the output: the clip's shape is
// the ratio chosen under the प्रॉम्प्ट box (migration 0053), and the whole poster is fitted
// inside it. It used to be the promise, and the promise was not one a video model can keep.

import { useRef, useState, type DragEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  MOTION_SOURCE_ACCEPT,
  MOTION_SOURCE_EXTENSIONS,
  MOTION_SOURCE_MAX_BYTES,
  MOTION_SOURCE_MAX_MB,
  type MotionSourceResponse,
} from '@dgipr/schemas';
import { uploadMotionSource } from '../lib/api';
import { errorMessage } from '../lib/errorMessage';
import { STR } from '../lib/strings';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return MOTION_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function MotionSourcePicker({
  value,
  disabled,
  onChange,
}: {
  value: MotionSourceResponse | null;
  disabled?: boolean;
  onChange: (source: MotionSourceResponse | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counted rather than boolean: dragging over a CHILD of the drop zone fires dragleave on the
  // parent, so a flag flickers the highlight off while the pointer is still inside.
  const [dragDepth, setDragDepth] = useState(0);

  const busy = uploading || disabled === true;

  const accept = async (file: File | undefined) => {
    if (!file || busy) return;
    // Both refusals happen HERE, before the upload starts, for the reason every picker in this
    // product does it: the officer finds out in the same gesture rather than after a wait, and
    // the API states the same limits as the backstop.
    if (!hasAcceptedExtension(file.name)) {
      setError(STR.motionSourceFormats);
      return;
    }
    if (file.size > MOTION_SOURCE_MAX_BYTES) {
      setError(`${STR.motionSourceLabel} — कमाल ${MOTION_SOURCE_MAX_MB} MB.`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      onChange(await uploadMotionSource(file));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragDepth(0);
    void accept(event.dataTransfer.files[0]);
  };

  return (
    <div className="option-field">
      <label className="field-label" htmlFor="motion-source">
        <ImagePlus size={18} className="label-icon" aria-hidden="true" />
        {STR.motionSourceLabel}
      </label>
      <p className="hint">{STR.motionSourceHint}</p>

      <input
        id="motion-source"
        ref={input}
        type="file"
        accept={MOTION_SOURCE_ACCEPT}
        hidden
        onChange={(event) => {
          void accept(event.target.files?.[0]);
          // Cleared so picking the SAME file again after a removal still fires a change.
          event.target.value = '';
        }}
      />

      {value ? (
        <div className="motion-source">
          {/* A plain <img>, like every other picture in this product: the URL is a public
              bucket object not known at build time, so next/image would need a remote
              pattern per deployment and buys nothing for one thumbnail. */}
          <img
            className="motion-source-thumb"
            src={value.url}
            alt={value.name}
          />
          <div className="motion-source-meta">
            <FileName name={value.name} className="motion-source-name" />
            <span className="hint">
              {value.width} × {value.height}
            </span>
            <div className="btn-row" style={{ gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {STR.motionSourceChange}
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  onChange(null);
                }}
              >
                <X size={16} aria-hidden="true" /> {STR.motionSourceRemove}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`motion-drop${dragDepth > 0 ? ' is-over' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragDepth((depth) => depth + 1);
          }}
          onDragOver={(event) => {
            // Without preventDefault on dragover the browser opens the file instead of
            // letting the page have the drop.
            event.preventDefault();
          }}
          onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
          onDrop={onDrop}
        >
          <button
            type="button"
            className="motion-drop-button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {uploading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span>{STR.motionSourceUploading}</span>
              </>
            ) : (
              <>
                <ImagePlus size={28} strokeWidth={1.75} aria-hidden="true" />
                <span>{STR.motionSourceDrop}</span>
                <span className="hint">{STR.motionSourceFormats}</span>
              </>
            )}
          </button>
        </div>
      )}

      {error ? <ErrorNotice message={error} /> : null}
    </div>
  );
}
