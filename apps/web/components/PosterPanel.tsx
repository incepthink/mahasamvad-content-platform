'use client';

// Poster display + download + manual text edit + the two-choice feedback loop
// ("मजकूर सुधारा" cheap re-render vs "चित्र बदला" new background image).

import { useState } from 'react';
import { POSTER_HEADING_MAX_CHARS } from '@dgipr/schemas';
import type { GenerationDetail } from '@dgipr/schemas';
import {
  posterDownloadUrl,
  regeneratePoster,
  sendPosterFeedback,
  sendPosterImageFeedback,
  updatePosterCopy,
} from '../lib/api';
import { STR } from '../lib/strings';
import { usePosterMarkers } from '../lib/usePosterMarkers';
import { CopyEditForm } from './CopyEditForm';
import { FeedbackBox } from './FeedbackBox';
import {
  ARTICLE_RESERVED_ZONES,
  PosterAnnotator,
  markerInZones,
} from './PosterAnnotator';
import { PosterImageFeedbackBox } from './PosterImageFeedbackBox';
import { PosterVersionStrip } from './PosterVersionStrip';

export function PosterPanel({
  detail,
  onChanged,
  busy = false,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // True while the server is re-rendering the poster (driven by detail.step).
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<'copy' | 'scene'>('copy');
  // Bridges the gap before the first poll reports `running`, and covers the
  // fully-synchronous manual copy edit (status never leaves `completed`).
  const [pending, setPending] = useState(false);
  // Numbered click-to-point markers for the n8n pixel-feedback path. Armed only
  // while the feedback fold is open; the last sent round stays on screen inert
  // (usePosterMarkers) so the user can see what they asked for.
  const {
    markers,
    submittedMarkers,
    addMarker,
    removeMarker,
    setNote,
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers(detail);
  const [annotOpen, setAnnotOpen] = useState(false);

  if (!detail.posterUrl || !detail.copy) return null;

  const showSpinner = busy || pending;
  // Poster text-edit + feedback (copy/scene) both re-render from the CACHED scene
  // image, so they only work when a scene was produced locally (ARTICLE_POSTER_MODE
  // = html). In n8n mode the poster is baked by the workflow with no separate scene
  // (sceneUrl null), so replace them with pixel-level feedback against the latest
  // complete poster rather than pretending structured copy remains editable.
  const canRevise = !!detail.sceneUrl;

  return (
    <section className="card">
      <h2>{STR.posterTitle}</h2>
      <div className="poster-layout">
        <div className="poster-frame">
          <img
            src={detail.posterUrl}
            alt={STR.posterTitle}
            className="poster-image"
            draggable={false}
          />
          {!canRevise ? (
            <PosterAnnotator
              markers={markers}
              onAdd={addMarker}
              onRemove={removeMarker}
              active={annotOpen && !showSpinner}
              disabled={showSpinner}
              submittedMarkers={submittedMarkers}
              onDismissSubmitted={dismissSubmitted}
            />
          ) : null}
          {showSpinner ? (
            <div className="poster-loading" aria-live="polite" aria-busy="true">
              <span className="spinner spinner-lg" />
            </div>
          ) : null}
        </div>
        <div>
          <div className="btn-row">
            <a className="btn btn-primary" href={posterDownloadUrl(detail.id)}>
              {STR.downloadPoster}
            </a>
            {canRevise ? (
              <button
                type="button"
                className="btn"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? STR.closeEditCopy : STR.editCopy}
              </button>
            ) : null}
          </div>

          {canRevise && editing ? (
            <div style={{ marginTop: 18 }}>
              <CopyEditForm
                copy={detail.copy}
                onSave={async (copy) => {
                  setPending(true);
                  try {
                    await updatePosterCopy(detail.id, copy);
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              />
            </div>
          ) : null}

          {canRevise ? (
            <div style={{ marginTop: 18 }}>
              <FeedbackBox
                title={STR.posterFeedbackTitle}
                onSubmit={async (feedback) => {
                  setPending(true);
                  try {
                    await sendPosterFeedback(detail.id, { target, feedback });
                    await onChanged();
                  } finally {
                    // After onChanged the server reports `running`, so the `busy`
                    // prop keeps the spinner up through the async job.
                    setPending(false);
                  }
                }}
              >
                <div className="segmented">
                  <button
                    type="button"
                    className="output-option"
                    aria-pressed={target === 'copy'}
                    onClick={() => setTarget('copy')}
                  >
                    <span className="name">{STR.posterFeedbackTargetCopy}</span>
                    <span className="desc">
                      {STR.posterFeedbackTargetCopyDesc}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="output-option"
                    aria-pressed={target === 'scene'}
                    onClick={() => setTarget('scene')}
                  >
                    <span className="name">
                      {STR.posterFeedbackTargetScene}
                    </span>
                    <span className="desc">
                      {STR.posterFeedbackTargetSceneDesc}
                    </span>
                  </button>
                </div>
              </FeedbackBox>
            </div>
          ) : (
            <div className="poster-feedback">
              {detail.status === 'completed' ? (
                <div className="poster-feedback">
                  {detail.posterStyleLabel ? (
                    <p className="hint poster-style-label">
                      {STR.posterStyleLabelPrefix} {detail.posterStyleLabel}
                    </p>
                  ) : null}
                  <p className="hint">{STR.posterRedesignHint}</p>
                  <div className="poster-redesign-actions">
                    {/* Both buttons re-render the poster as a new version; the row flips to
                        running server-side, so refresh to resume polling. `recolour`
                        additionally bars the family shown above, for when only the colours
                        are wrong. Same pair as SocialPostView. */}
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={showSpinner}
                      onClick={async () => {
                        setPending(true);
                        try {
                          await regeneratePoster(detail.id);
                          await onChanged();
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      {STR.posterRedesign}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={showSpinner}
                      onClick={async () => {
                        setPending(true);
                        try {
                          await regeneratePoster(detail.id, { recolour: true });
                          await onChanged();
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      {STR.posterRecolour}
                    </button>
                  </div>
                  {/* The third redo, and the one that fixes a wrong heading: print exactly
                      this text. It lives here rather than on the create form alone because
                      the officer only discovers the automatic text is wrong once the poster
                      exists. */}
                  <PosterHeadingEditor
                    current={detail.posterHeading}
                    disabled={showSpinner}
                    onApply={async (heading) => {
                      setPending(true);
                      try {
                        await regeneratePoster(detail.id, {
                          posterHeading: heading,
                        });
                        await onChanged();
                      } finally {
                        setPending(false);
                      }
                    }}
                  />
                </div>
              ) : null}
              <PosterImageFeedbackBox
                markers={markers}
                onNoteChange={setNote}
                onRemoveMarker={removeMarker}
                onOpenChange={setAnnotOpen}
                disabled={showSpinner}
                showReservedWarning={markers.some((m) =>
                  markerInZones(m.region, ARTICLE_RESERVED_ZONES),
                )}
                submittedMarkers={submittedMarkers}
                onSubmit={async (payload) => {
                  setPending(true);
                  try {
                    await sendPosterImageFeedback(detail.id, payload);
                    markSubmitted();
                    await onChanged();
                  } finally {
                    // The refreshed row now drives `busy` until the n8n edit
                    // finishes, so the overlay does not flicker between states.
                    setPending(false);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
      <PosterVersionStrip detail={detail} />
    </section>
  );
}

// Type the exact line the poster must carry, and re-render with it. Closed by default — a
// finished poster should read as a finished poster, the same reasoning as the caption card's
// read-only block. `current` is what the run already has stored (null = the heading is being
// resolved automatically from the note), and applying an EMPTY string is a meaningful action:
// it hands the decision back to the automatic resolver.
function PosterHeadingEditor({
  current,
  disabled,
  onApply,
}: {
  current: string | null;
  disabled: boolean;
  onApply: (heading: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? '');

  return (
    <div className="poster-heading-editor">
      <p className="hint">
        {STR.posterHeadingCurrentPrefix}{' '}
        {current ? <strong>{current}</strong> : STR.posterHeadingAuto}
      </p>
      {open ? (
        <>
          <input
            type="text"
            maxLength={POSTER_HEADING_MAX_CHARS}
            placeholder={STR.posterHeadingPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
          />
          <p className="hint">{STR.posterHeadingHint}</p>
          <div className="poster-redesign-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={disabled || value.trim().length === 0}
              onClick={async () => {
                await onApply(value.trim());
                setOpen(false);
              }}
            >
              {STR.posterHeadingApply}
            </button>
            {current ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={disabled}
                onClick={async () => {
                  setValue('');
                  await onApply('');
                  setOpen(false);
                }}
              >
                {STR.posterHeadingClear}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setValue(current ?? '');
                setOpen(false);
              }}
            >
              {STR.posterHeadingCancel}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-small"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {STR.posterHeadingEdit}
        </button>
      )}
    </div>
  );
}
