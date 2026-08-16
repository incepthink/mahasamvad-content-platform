'use client';

// Poster display + download + manual text edit + the two-choice feedback loop
// ("मजकूर सुधारा" cheap re-render vs "चित्र बदला" new background image).

import { useState } from 'react';
import {
  Download,
  // Palette — the recolour redo, hidden from the UI (see the commented button below).
  RotateCw,
  SquareDashed,
  SquarePen,
} from 'lucide-react';
import { POSTER_HEADING_MAX_CHARS, isYoutubeCategory } from '@dgipr/schemas';
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
import { CrossFormatLinks } from './CrossFormatLinks';
import { FeedbackBox } from './FeedbackBox';
import {
  ARTICLE_RESERVED_ZONES,
  YOUTUBE_RESERVED_ZONES,
  PosterAnnotator,
  markerInZones,
  type AnnotatorMode,
} from './PosterAnnotator';
import { PosterImageFeedbackBox } from './PosterImageFeedbackBox';
import { PosterVersionStrip } from './PosterVersionStrip';
import { CanvaLink } from './CanvaLink';

export function PosterPanel({
  detail,
  onChanged,
  busy = false,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // True while the server is re-rendering the poster (driven by detail.step).
  busy?: boolean;
  // Fired once every edit here that produces a new poster image has been ACCEPTED by the
  // API — the detail page hands the run to the navbar's सुरू असलेली कामे panel so the
  // officer can leave the page and still watch it finish. Called after the await, never
  // before: these routes flip the row to running before their 202, and the panel files a
  // still-`completed` row as terminal and stops polling it.
  onImageWorkStarted?: (() => void) | undefined;
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
    clearRegions,
    submittedClearRegions,
    addClearRegion,
    removeClearRegion,
    setClearNote,
    setClearAction,
    markSubmitted,
    dismissSubmitted,
  } = usePosterMarkers(detail);
  // Which gesture the overlay captures: red "change this" markers or blue "free this
  // space" rectangles. Both sets travel in one round. NULL means the poster is not armed
  // at all — which is what makes this one piece of state serve both the two icon buttons
  // (SocialPostView's shape) and the feedback fold, instead of a separate `annotOpen`
  // flag that could disagree with it.
  const [annotMode, setAnnotMode] = useState<AnnotatorMode | null>(null);
  const annotOpen = annotMode !== null;

  if (!detail.posterUrl) return null;

  // This panel also serves the यूट्यूब थंबनेल lane, which shares almost all of it — one
  // image, a download, a redo and pixel feedback. What it does NOT have is structured
  // poster copy, a palette assignment or a heading lock, so those three affordances are
  // hidden rather than shown inert.
  const isThumbnail = isYoutubeCategory(detail.category);
  const showSpinner = busy || pending;
  // Poster text-edit + feedback (copy/scene) both re-render from the CACHED scene
  // image, so they only work when a scene was produced locally (ARTICLE_POSTER_MODE
  // = html). In n8n mode the poster is baked by the workflow with no separate scene
  // (sceneUrl null), so replace them with pixel-level feedback against the latest
  // complete poster rather than pretending structured copy remains editable. A thumbnail
  // never has either, so it always takes the pixel-feedback path.
  const canRevise = !!detail.sceneUrl && !!detail.copy;
  // Which chrome the marker warning is about. The article poster's lockup is top-LEFT and
  // the thumbnail's is top-RIGHT, so this is not a cosmetic difference — the wrong constant
  // warns about the wrong corner.
  const reservedZones = isThumbnail
    ? YOUTUBE_RESERVED_ZONES
    : ARTICLE_RESERVED_ZONES;
  // Same test SocialPostView makes: the poster routes want a poster and an idle row, NOT
  // a completed status — a run whose last edit failed still has both and must be able to
  // carry on. `failed` therefore counts here too.
  const posterEditable =
    (detail.status === 'completed' || detail.status === 'failed') &&
    !showSpinner;
  const downloadLabel = isThumbnail
    ? STR.downloadThumbnail
    : STR.downloadPoster;

  return (
    <section className="card">
      <h2>{isThumbnail ? STR.thumbnailTitle : STR.posterTitle}</h2>
      <div className="poster-layout">
        <div className="poster-frame">
          <img
            src={detail.posterUrl}
            alt={isThumbnail ? STR.thumbnailTitle : STR.posterTitle}
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
              mode={annotMode ?? 'mark'}
              clearRegions={clearRegions}
              onAddClear={addClearRegion}
              onRemoveClear={removeClearRegion}
              submittedClearRegions={submittedClearRegions}
            />
          ) : null}
          {showSpinner ? (
            <div className="poster-loading" aria-live="polite" aria-busy="true">
              <span className="spinner spinner-lg" />
            </div>
          ) : null}
        </div>
        <div>
          {/* Icon-only actions on the poster itself — the same row SocialPostView puts
              under a social poster, so the two lanes read as one product. Every button
              carries its Marathi label as title + aria-label, since nothing here is
              spelled out on screen. The यूट्यूब थंबनेल lane shares the row unchanged; what
              does not apply to it (the heading lock) is hidden further down, not here. */}
          <div className="poster-icon-actions">
            <a
              className="icon-btn"
              href={posterDownloadUrl(detail.id)}
              title={downloadLabel}
              aria-label={downloadLabel}
            >
              <Download size={18} strokeWidth={1.9} aria-hidden="true" />
            </a>
            <CanvaLink generationId={detail.id} />
            {/* A fresh redesign of this same run. Only offered on the pixel-feedback
                lane: in `html` mode the poster is typeset from a cached scene and the
                two folds below are the way it changes. */}
            {!canRevise ? (
              <button
                type="button"
                className="icon-btn"
                title={STR.posterRedesign}
                aria-label={STR.posterRedesign}
                disabled={!posterEditable}
                onClick={async () => {
                  setPending(true);
                  try {
                    await regeneratePoster(detail.id);
                    onImageWorkStarted?.();
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <RotateCw size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
            ) : null}
            {/* HIDDEN FROM THE UI, deliberately kept: the recolour redo
                ("वेगळ्या रंगात तयार करा"), which re-renders with the current colour family
                barred. The API still supports it — regeneratePoster takes `recolour` — so
                restoring it is uncommenting this block plus the `Palette` import above.
                A thumbnail never had it: its palette comes from the reference and the
                message, so a "different colours" redo is indistinguishable from the plain
                one, which is why the guard below stays if this ever comes back.
            {!canRevise && !isThumbnail ? (
              <button
                type="button"
                className="icon-btn"
                title={STR.posterRecolour}
                aria-label={STR.posterRecolour}
                disabled={!posterEditable}
                onClick={async () => {
                  setPending(true);
                  try {
                    await regeneratePoster(detail.id, { recolour: true });
                    onImageWorkStarted?.();
                    await onChanged();
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <Palette size={18} strokeWidth={1.9} aria-hidden="true" />
              </button>
            ) : null}
            */}
            {/* The two annotator gestures. They only ARM the poster — the notes are
                typed in the fold below, exactly as on a social run. */}
            {!canRevise ? (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  aria-pressed={annotMode === 'mark'}
                  title={
                    annotMode === 'mark'
                      ? STR.iconEditPosterOn
                      : STR.iconEditPoster
                  }
                  aria-label={
                    annotMode === 'mark'
                      ? STR.iconEditPosterOn
                      : STR.iconEditPoster
                  }
                  disabled={showSpinner}
                  onClick={() =>
                    setAnnotMode(annotMode === 'mark' ? null : 'mark')
                  }
                >
                  <SquarePen size={18} strokeWidth={1.9} aria-hidden="true" />
                </button>
                {/* The blue gesture: free a rectangle so the officer can place their own
                    logo or photograph there by hand. Its own button rather than a mode
                    inside the pencil, because it is a different request — nothing is
                    being edited, space is being made. */}
                <button
                  type="button"
                  className="icon-btn icon-btn-clear"
                  aria-pressed={annotMode === 'clear'}
                  title={
                    annotMode === 'clear'
                      ? STR.iconClearSpaceOn
                      : STR.iconClearSpace
                  }
                  aria-label={
                    annotMode === 'clear'
                      ? STR.iconClearSpaceOn
                      : STR.iconClearSpace
                  }
                  disabled={showSpinner}
                  onClick={() =>
                    setAnnotMode(annotMode === 'clear' ? null : 'clear')
                  }
                >
                  <SquareDashed
                    size={18}
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                </button>
              </>
            ) : null}
            {/* Last in the row, and the only entry that navigates rather than acting on
                this run — the trailing arrow is what says so. */}
            <CrossFormatLinks
              generationId={detail.id}
              category={detail.category}
            />
          </div>

          {/* Stays a text button: it opens a multi-field editor, not a single action, so
              it does not belong in a row of one-tap icons. `html` mode only. */}
          {canRevise ? (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? STR.closeEditCopy : STR.editCopy}
              </button>
            </div>
          ) : null}

          {/* `canRevise` already requires detail.copy; the explicit test is what narrows
              it for the compiler now that a copy-less lane (the thumbnail) reaches here. */}
          {canRevise && editing && detail.copy ? (
            <div style={{ marginTop: 18 }}>
              <CopyEditForm
                copy={detail.copy}
                onSave={async (copy) => {
                  setPending(true);
                  try {
                    await updatePosterCopy(detail.id, copy);
                    // Synchronous — the row never leaves `completed`, so this lands in the
                    // panel as a finished row rather than one to follow. Tracked anyway:
                    // it re-renders the poster, and "everything I started here is in the
                    // list" is a simpler promise than a per-route judgement about which
                    // renders were slow enough to count.
                    onImageWorkStarted?.();
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
                    onImageWorkStarted?.();
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
              {/* `failed` counts here too: the poster routes need a poster and an idle row,
                  not a completed status, and a run whose last edit failed still has both.
                  Hiding these was what left such a run with nothing to act on. */}
              {detail.status === 'completed' || detail.status === 'failed' ? (
                <div className="poster-feedback">
                  {detail.posterStyleLabel ? (
                    <p className="hint poster-style-label">
                      {STR.posterStyleLabelPrefix} {detail.posterStyleLabel}
                    </p>
                  ) : null}
                  {/* The redesign redo moved into the icon row under the poster (the ↻
                      button), so its explanatory hint went with it — the button carries
                      its Marathi label as title + aria-label there, the SocialPostView
                      shape. What stays here is the material that is not a one-tap action. */}
                  {/* The heading redo, and the one that fixes a wrong heading: print exactly
                      this text. It lives here rather than on the create form alone because
                      the officer only discovers the automatic text is wrong once the poster
                      exists. */}
                  {/* Article lane only: a thumbnail's text IS the officer's note, so
                      there is no single automatic line to override. */}
                  {isThumbnail ? null : (
                    <PosterHeadingEditor
                      current={detail.posterHeading}
                      disabled={showSpinner}
                      onApply={async (heading) => {
                        setPending(true);
                        try {
                          await regeneratePoster(detail.id, {
                            posterHeading: heading,
                          });
                          onImageWorkStarted?.();
                          await onChanged();
                        } finally {
                          setPending(false);
                        }
                      }}
                    />
                  )}
                </div>
              ) : null}
              <PosterImageFeedbackBox
                markers={markers}
                onNoteChange={setNote}
                onRemoveMarker={removeMarker}
                // Opening the fold arms the poster if an icon has not already done so;
                // closing it disarms. So the fold and the two icons are two ways into
                // one state rather than two states that can disagree.
                onOpenChange={(open) =>
                  setAnnotMode((current) => (open ? (current ?? 'mark') : null))
                }
                disabled={showSpinner}
                showReservedWarning={markers.some((m) =>
                  markerInZones(m.region, reservedZones),
                )}
                submittedMarkers={submittedMarkers}
                mode={annotMode ?? 'mark'}
                onModeChange={setAnnotMode}
                clearRegions={clearRegions}
                onClearNoteChange={setClearNote}
                onClearActionChange={setClearAction}
                onRemoveClearRegion={removeClearRegion}
                submittedClearRegions={submittedClearRegions}
                showClearReservedWarning={clearRegions.some((c) =>
                  markerInZones(c.region, reservedZones),
                )}
                onSubmit={async (payload) => {
                  setPending(true);
                  try {
                    await sendPosterImageFeedback(detail.id, payload);
                    markSubmitted();
                    onImageWorkStarted?.();
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
      {/* Switching version reuses `pending` — it means the same thing here as it does for a
          synchronous copy edit: the poster on screen is about to be replaced. */}
      <PosterVersionStrip
        detail={detail}
        onChanged={onChanged}
        onRestoringChange={setPending}
        busy={showSpinner}
      />
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
