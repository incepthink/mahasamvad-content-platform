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
// Once uploaded, the picture is the whole control: shown large, at its own aspect ratio (a
// DGIPR poster is portrait far more often than not), with a delete button in its corner and
// nothing else. The filename and the measured pixel size used to sit beside it as a receipt;
// the poster on screen is a better one, and the room they took is what the moving-region
// rectangle is dragged over. The clip's shape is the ratio chosen under the प्रॉम्प्ट box
// (migration 0053) and the whole poster is fitted inside it, so no size shown here was ever a
// promise about the output.

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
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
import { FieldLabel } from './common/FieldLabel';

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return MOTION_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function MotionSourcePicker({
  value,
  disabled,
  onChange,
  overlay,
  tools,
}: {
  value: MotionSourceResponse | null;
  disabled?: boolean;
  onChange: (source: MotionSourceResponse | null) => void;
  // Drawn over the preview, inside the box that is exactly the picture — which is the one
  // place a rectangle expressed as fractions of the poster can be positioned correctly.
  // The Dynamic Poster lane passes its moving-region selector here; nothing else uses it.
  overlay?: ReactNode | undefined;
  // Rendered directly UNDER the picture: the selection tools that draw the overlay above.
  tools?: ReactNode | undefined;
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
      {/* A div rather than a <label>: the explanation now lives behind an ⓘ inside it, and
          a label pointing at the hidden file input would open the file dialog when that icon
          is clicked. The drop zone below is a real button, so nothing is lost. */}
      <div className="field-label">
        <ImagePlus size={18} className="label-icon" aria-hidden="true" />
        <FieldLabel
          helpId="motion-source-help"
          label={STR.motionSourceLabel}
          // BOTH sentences, because the rectangle is now drawn on this very preview and no
          // longer has a heading of its own to explain it. Why an officer is being asked to
          // mark one at all — a video model redraws every pixel, their Devanagari included —
          // is the whole feature, and without it the box reads as an optional crop.
          hint={
            <>
              {STR.motionSourceHint} {STR.motionRegionHint}
            </>
          }
        />
      </div>

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
        /* THE PICTURE IS THE WHOLE CONTROL. No filename, no measured size, no pair of
           buttons beside it: the officer is looking at the poster they just picked, which
           says more than its name does, and the one thing left to do to it is take it back
           out. So the only affordance is a delete button in the corner of the frame — and
           the room the metadata column used to take is given to the picture, because the
           moving-region rectangle is dragged over it. */
        <div className="motion-source">
          {/* `position: relative` and a box that is exactly the image, not the card: the
              overlay's coordinates are fractions of the POSTER, so whitespace beside it
              would shift every one of them. */}
          <div className="motion-source-frame">
            {/* A plain <img>, like every other picture in this product: the URL is a public
                bucket object not known at build time, so next/image would need a remote
                pattern per deployment and buys nothing here. */}
            <img
              className="motion-source-preview"
              src={value.url}
              alt={value.name}
            />
            {overlay}
          </div>
          {tools}
          {/* In the corner of the CARD rather than over the picture, so it never covers
              artwork or fights the selection surface for a press. */}
          <button
            type="button"
            className="motion-source-delete"
            disabled={busy}
            aria-label={STR.motionSourceRemove}
            title={STR.motionSourceRemove}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
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
