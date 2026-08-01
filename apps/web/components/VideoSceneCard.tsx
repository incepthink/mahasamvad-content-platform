'use client';

// One scene of a video project, in one of two modes:
//
// - 'edit' (gate 1, script review): narration + the two visual briefs (start
//   and end frame of the same shot) are open textareas — the officer corrects
//   names/amounts in the narration and can reshape either frame before
//   anything is rendered.
// - 'review' (gate 2 storyboard + the post-render fix panel): shows the START
//   and END frames side by side with the narration beneath; each frame has its
//   own redraw affordance (cents). Redrawing the start also redraws the end —
//   the end frame is edited FROM the start, so a new start orphans it; the
//   hint under the button says so. The fix panel adds the per-scene re-animate
//   action (that scene's Veo cost only).
//
// Per-scene status/error chips render in both modes — a failed scene must say
// so on ITS card, not sink the project.

import { useEffect, useRef, useState } from 'react';
import type { VideoScene } from '@dgipr/schemas';
import {
  VIDEO_KEY_POINT_MAX_CHARS,
  VIDEO_NARRATION_MAX_CHARS,
  estimateNarrationSeconds,
} from '@dgipr/schemas';
import {
  STR,
  videoMotionBriefLength,
  videoNarrationEstimate,
  videoNarrationTooLong,
  videoSceneTiming,
} from '../lib/strings';

function SceneStatusChip({ scene }: { scene: VideoScene }) {
  if (scene.status === 'still-rendering' || scene.status === 'animating') {
    return (
      <span className="translating-note">
        <span className="spinner" aria-hidden="true" />
        {scene.status === 'animating'
          ? VIDEO_SCENE_STATUS_LABELS.animating
          : VIDEO_SCENE_STATUS_LABELS['still-rendering']}
      </span>
    );
  }
  if (scene.status === 'failed') {
    return <span className="form-error">{STR.videoSceneFailed}</span>;
  }
  return null;
}

const VIDEO_SCENE_STATUS_LABELS = {
  'still-rendering': 'चित्रे तयार होत आहेत…',
  animating: 'दृश्य तयार होत आहे…',
} as const;

// One reviewed frame (start or end) with its label; the redraw button lives
// with the frame it redraws.
function FramePreview({
  label,
  url,
  pendingLabel,
}: {
  label: string;
  url: string | undefined;
  pendingLabel: string;
}) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <p className="field-label" style={{ marginBottom: 6 }}>
        {label}
      </p>
      {url ? (
        <img src={url} alt={label} style={{ width: '100%', borderRadius: 8 }} />
      ) : (
        <p className="hint">{pendingLabel}</p>
      )}
    </div>
  );
}

export function VideoSceneCard({
  index,
  scene,
  mode,
  busy,
  onNarrationChange,
  onBriefChange,
  onEndBriefChange,
  onKeyPointChange,
  onRemove,
  onRedraw,
  onRedrawEnd,
  onMotionBriefSave,
  onReanimate,
  onInsertAfter,
  redrawUnavailableHint,
  reanimateLabel,
}: {
  index: number;
  scene: VideoScene;
  mode: 'edit' | 'review';
  busy: boolean;
  // gate 1 (mode 'edit'). The two brief handlers are also taken in 'review'
  // mode by a card with no stored scene, where they are the only way its
  // prompt can be written before the save that unlocks the redraw buttons.
  onNarrationChange?: (value: string) => void;
  onBriefChange?: (value: string) => void;
  onEndBriefChange?: (value: string) => void;
  onKeyPointChange?: (value: string) => void;
  onRemove?: (() => void) | undefined;
  // gate 2 / fix panel (mode 'review'). onRedraw regenerates the PAIR from an
  // edited start brief; onRedrawEnd re-edits only the end frame.
  onRedraw?: (brief: string) => void;
  onRedrawEnd?: ((endBrief: string) => void) | undefined;
  // Saves the scene's motion direction. Free — it feeds the CLIP prompt only,
  // so no frame is discarded and the edit lands on the next animation.
  onMotionBriefSave?: ((motionBrief: string) => void) | undefined;
  onReanimate?: (() => void) | undefined;
  // Inserts a blank scene directly after this one. Its narration is moved out
  // of a neighbour by the officer, never invented and never left empty.
  onInsertAfter?: (() => void) | undefined;
  // Shown in place of the redraw buttons when this card has no stored scene
  // behind it yet, so an officer is told what to do instead of being handed a
  // button that cannot reach the API.
  redrawUnavailableHint?: string | undefined;
  reanimateLabel?: string;
}) {
  // Which brief the fold edits: the start brief redraws the pair, the end
  // brief redraws only the end frame. Each keeps its OWN draft, re-seeded only
  // when the stored brief changes (the motionDraft pattern below) — reseeding
  // on every open discarded whatever the officer had just typed.
  const [briefOpen, setBriefOpen] = useState<'start' | 'end' | null>(null);
  const storedStartBrief = scene.openingVisualBrief ?? scene.visualBrief;
  const storedEndBrief = scene.endVisualBrief ?? '';
  const [startDraft, setStartDraft] = useState(storedStartBrief);
  const [endDraft, setEndDraft] = useState(storedEndBrief);
  const lastStartProp = useRef(storedStartBrief);
  const lastEndProp = useRef(storedEndBrief);
  useEffect(() => {
    if (lastStartProp.current === storedStartBrief) return;
    lastStartProp.current = storedStartBrief;
    setStartDraft(storedStartBrief);
  }, [storedStartBrief]);
  useEffect(() => {
    if (lastEndProp.current === storedEndBrief) return;
    lastEndProp.current = storedEndBrief;
    setEndDraft(storedEndBrief);
  }, [storedEndBrief]);
  // The motion direction is edited in place (no redraw follows it), so the
  // draft must re-seed when a save lands and the refreshed prop comes back —
  // and only then, or every poll would discard what is being typed.
  const [motionDraft, setMotionDraft] = useState(scene.motionBrief ?? '');
  const [motionSaved, setMotionSaved] = useState(false);
  const lastMotionProp = useRef(scene.motionBrief);
  useEffect(() => {
    if (lastMotionProp.current === scene.motionBrief) return;
    lastMotionProp.current = scene.motionBrief;
    setMotionDraft(scene.motionBrief ?? '');
  }, [scene.motionBrief]);

  const openDraft = briefOpen === 'end' ? endDraft : startDraft;

  const heading = `${STR.videoSceneLabel} ${index + 1}`;
  const hasEndFrame = scene.endVisualBrief !== undefined;
  // Nothing has been drawn for this scene yet — a stored scene the officer just
  // inserted, or one whose brief changed. The control is the same fold, but
  // "पुन्हा काढा" ("redraw") is the wrong word when there is no frame to redraw,
  // and it was the only affordance on such a card.
  const needsFirstFrames = mode === 'review' && scene.stillUrl === undefined;

  if (mode === 'edit') {
    return (
      <section className="card">
        <div className="article-head">
          <h2>{heading}</h2>
          {onRemove ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={onRemove}
              disabled={busy}
            >
              {STR.videoRemoveScene}
            </button>
          ) : null}
        </div>
        {scene.beat ? (
          <p className="hint">
            {STR.videoSceneBeatLabel}: {scene.beat}
          </p>
        ) : null}
        <label className="field-label" htmlFor={`scene-narration-${index}`}>
          {STR.videoNarrationLabel}
        </label>
        {/* The writer saw this planned visual window. The speech estimate is a
            guide; all boxes are synthesized later as one continuous track. */}
        <p className="hint">
          {onNarrationChange
            ? STR.videoNarrationHint
            : STR.videoNarrationLockedHint}
          {scene.narration.trim().length > 0
            ? ` · ${videoNarrationEstimate(
                estimateNarrationSeconds(scene.narration),
                scene.durationSeconds,
              )}`
            : ''}
        </p>
        {/* Deliberately no maxLength on the textarea: silently truncating a
            pasted paragraph loses the officer's words, which is worse than
            saying the line is too long. The save button is disabled while any
            scene is over, so this is the only place the count has to be seen. */}
        <textarea
          id={`scene-narration-${index}`}
          className="note-input"
          style={{ minHeight: 70 }}
          value={scene.narration}
          disabled={busy}
          readOnly={onNarrationChange === undefined}
          onChange={(event) => onNarrationChange?.(event.target.value)}
        />
        {scene.narration.trim().length > VIDEO_NARRATION_MAX_CHARS ? (
          <p className="form-error">
            {videoNarrationTooLong(
              scene.narration.trim().length,
              VIDEO_NARRATION_MAX_CHARS,
            )}
          </p>
        ) : null}
        <label
          className="field-label"
          htmlFor={`scene-key-point-${index}`}
          style={{ marginTop: 12 }}
        >
          {STR.videoKeyPointLabel}
        </label>
        <p className="hint">{STR.videoKeyPointHint}</p>
        <input
          id={`scene-key-point-${index}`}
          type="text"
          className="note-input"
          value={scene.keyPoint ?? ''}
          maxLength={VIDEO_KEY_POINT_MAX_CHARS}
          disabled={busy}
          onChange={(event) => onKeyPointChange?.(event.target.value)}
        />
        <label
          className="field-label"
          htmlFor={`scene-brief-${index}`}
          style={{ marginTop: 12 }}
        >
          {STR.videoBriefLabel}
        </label>
        <p className="hint">{STR.videoBriefHint}</p>
        <textarea
          id={`scene-brief-${index}`}
          className="note-input"
          style={{ minHeight: 70 }}
          value={scene.visualBrief}
          disabled={busy}
          onChange={(event) => onBriefChange?.(event.target.value)}
        />
        <label
          className="field-label"
          htmlFor={`scene-end-brief-${index}`}
          style={{ marginTop: 12 }}
        >
          {STR.videoEndBriefLabel}
        </label>
        <p className="hint">{STR.videoEndBriefHint}</p>
        <textarea
          id={`scene-end-brief-${index}`}
          className="note-input"
          style={{ minHeight: 70 }}
          value={scene.endVisualBrief ?? ''}
          disabled={busy}
          onChange={(event) => onEndBriefChange?.(event.target.value)}
        />
        {onInsertAfter ? (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={onInsertAfter}
            >
              {STR.videoInsertSceneAfter}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card">
      <div className="article-head">
        <h2>{heading}</h2>
        <SceneStatusChip scene={scene} />
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          maxWidth: hasEndFrame ? 720 : 480,
        }}
      >
        <FramePreview
          label={STR.videoStartFrameLabel}
          url={scene.stillUrl}
          pendingLabel={STR.videoStillPending}
        />
        {hasEndFrame ? (
          <FramePreview
            label={STR.videoEndFrameLabel}
            url={scene.endStillUrl}
            pendingLabel={STR.videoEndStillPending}
          />
        ) : null}
      </div>
      {/* Editable at gate 2 as well, so the officer can re-split the narration
          against the frames they are actually looking at. Moving words between
          scenes leaves the joined script byte-identical, so the measured WAV
          stays current and no TTS is re-bought — only the affected windows are
          re-weighted, which is what keeps the cuts aligned with the voice. */}
      {onNarrationChange ? (
        <>
          <label
            className="field-label"
            htmlFor={`scene-review-narration-${index}`}
            style={{ marginTop: 10 }}
          >
            {STR.videoNarrationLabel}
          </label>
          <p className="hint">{STR.videoNarrationResplitHint}</p>
          <textarea
            id={`scene-review-narration-${index}`}
            className="note-input"
            style={{ minHeight: 70 }}
            value={scene.narration}
            disabled={busy}
            onChange={(event) => onNarrationChange(event.target.value)}
          />
          {scene.narration.trim().length > VIDEO_NARRATION_MAX_CHARS ? (
            <p className="form-error">
              {videoNarrationTooLong(
                scene.narration.trim().length,
                VIDEO_NARRATION_MAX_CHARS,
              )}
            </p>
          ) : null}
        </>
      ) : (
        <p style={{ marginTop: 10 }}>{scene.narration}</p>
      )}
      {scene.keyPoint && scene.keyPoint.trim() !== '' ? (
        <p className="hint">
          {STR.videoKeyPointReviewLabel}: {scene.keyPoint}
        </p>
      ) : null}
      <p className="hint">
        {videoSceneTiming(scene.durationSeconds, scene.narrationSeconds)}
      </p>
      {onMotionBriefSave || scene.motionBrief ? (
        <details style={{ marginTop: 10 }}>
          <summary className="field-label">{STR.videoMotionBriefLabel}</summary>
          {onMotionBriefSave ? (
            <>
              <p className="hint" style={{ marginTop: 6 }}>
                {STR.videoMotionBriefEditHint}
              </p>
              <textarea
                className="note-input"
                style={{ marginTop: 6, minHeight: 120 }}
                value={motionDraft}
                disabled={busy}
                onChange={(event) => {
                  setMotionDraft(event.target.value);
                  setMotionSaved(false);
                }}
              />
              <p className="hint" style={{ marginTop: 6 }}>
                {videoMotionBriefLength(motionDraft.trim().length)}
              </p>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={
                    busy ||
                    motionDraft.trim().length === 0 ||
                    motionDraft.trim() === (scene.motionBrief ?? '').trim()
                  }
                  onClick={() => {
                    setMotionSaved(true);
                    onMotionBriefSave(motionDraft.trim());
                  }}
                >
                  {STR.videoMotionBriefSave}
                </button>
              </div>
              {motionSaved ? (
                <p className="hint" style={{ marginTop: 6 }}>
                  {STR.videoMotionBriefSaved}
                </p>
              ) : null}
            </>
          ) : (
            <p
              className="hint"
              style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}
            >
              {scene.motionBrief}
            </p>
          )}
        </details>
      ) : null}
      {/* Since windows are derived by ceil()ing the measured narration, a NEW
          scene mathematically cannot trip this — it survives as the warning for
          a LEGACY frozen window (a scene whose paid clip predates the change),
          which is exactly when muxNarration's atempo will engage. */}
      {scene.narrationSeconds !== undefined &&
      scene.narrationSeconds > scene.durationSeconds * 1.1 ? (
        <p className="hint">{STR.videoNarrationTooFast}</p>
      ) : null}
      {scene.narrationAudioUrl ? (
        <div style={{ marginTop: 8 }}>
          <p className="hint">{STR.videoNarrationListen}</p>
          <audio
            controls
            src={scene.narrationAudioUrl}
            style={{ width: '100%', maxWidth: 480 }}
          />
        </div>
      ) : null}
      {scene.error ? <p className="form-error">{scene.error}</p> : null}

      {/* Every button here is guarded on the handler that makes it work: a card
          with no stored scene behind it (a just-inserted one) gets the hint
          instead, because its redraw could only close the fold silently. */}
      {onRedraw && needsFirstFrames ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {STR.videoSceneNeedsFrames}
        </p>
      ) : null}
      {onRedraw || (hasEndFrame && onRedrawEnd) || onReanimate ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          {onRedraw ? (
            <button
              type="button"
              className={
                needsFirstFrames ? 'btn btn-small btn-primary' : 'btn btn-small'
              }
              disabled={busy}
              onClick={() =>
                setBriefOpen((open) => (open === 'start' ? null : 'start'))
              }
            >
              {needsFirstFrames
                ? STR.videoRenderSceneFrames
                : STR.videoEditStartBrief}
            </button>
          ) : null}
          {hasEndFrame && onRedrawEnd ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                setBriefOpen((open) => (open === 'end' ? null : 'end'))
              }
            >
              {STR.videoEditEndBrief}
            </button>
          ) : null}
          {onReanimate ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={onReanimate}
            >
              {reanimateLabel ?? STR.videoReanimateScene}
            </button>
          ) : null}
        </div>
      ) : onBriefChange ? (
        // A just-inserted card has no stored scene, so it has no redraw fold to
        // hold its brief — but the brief is exactly what the officer must write
        // before the save that makes the redraw reachable. The textareas are
        // therefore shown open, editing the DRAFT (the save sends them), rather
        // than behind a toggle whose spend button could not work yet.
        <>
          <p className="hint" style={{ marginTop: 12 }}>
            {STR.videoInsertedSceneHint}
          </p>
          <label
            className="field-label"
            htmlFor={`scene-review-brief-${index}`}
            style={{ marginTop: 10 }}
          >
            {STR.videoBriefLabel}
          </label>
          <p className="hint">{STR.videoBriefHint}</p>
          <textarea
            id={`scene-review-brief-${index}`}
            className="note-input"
            style={{ minHeight: 70 }}
            value={scene.visualBrief}
            disabled={busy}
            onChange={(event) => onBriefChange(event.target.value)}
          />
          {onEndBriefChange ? (
            <>
              <label
                className="field-label"
                htmlFor={`scene-review-end-brief-${index}`}
                style={{ marginTop: 12 }}
              >
                {STR.videoEndBriefLabel}
              </label>
              <p className="hint">{STR.videoEndBriefHint}</p>
              <textarea
                id={`scene-review-end-brief-${index}`}
                className="note-input"
                style={{ minHeight: 70 }}
                value={scene.endVisualBrief ?? ''}
                disabled={busy}
                onChange={(event) => onEndBriefChange(event.target.value)}
              />
            </>
          ) : null}
          {redrawUnavailableHint ? (
            <p className="hint" style={{ marginTop: 12 }}>
              {redrawUnavailableHint}
            </p>
          ) : null}
        </>
      ) : redrawUnavailableHint ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {redrawUnavailableHint}
        </p>
      ) : null}

      {briefOpen ? (
        <>
          <p className="hint" style={{ marginTop: 10 }}>
            {briefOpen === 'start'
              ? STR.videoRedrawStillNote
              : STR.videoEndBriefHint}
          </p>
          <textarea
            className="note-input"
            style={{ marginTop: 6, minHeight: 70 }}
            value={openDraft}
            disabled={busy}
            onChange={(event) =>
              briefOpen === 'start'
                ? setStartDraft(event.target.value)
                : setEndDraft(event.target.value)
            }
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy || openDraft.trim().length === 0}
              onClick={() => {
                const which = briefOpen;
                const brief = openDraft.trim();
                setBriefOpen(null);
                if (which === 'start') onRedraw?.(brief);
                else onRedrawEnd?.(brief);
              }}
            >
              {briefOpen === 'start'
                ? needsFirstFrames
                  ? STR.videoRenderSceneFrames
                  : STR.videoRedrawStill
                : STR.videoRedrawEndStill}
            </button>
          </div>
        </>
      ) : null}

      {/* Insert a scene AFTER this one. Only "after" is offered and that is not
          a gap: a new scene must carry words moved out of a neighbour, so
          inserting before scene 1 and taking its opening words is the same
          result as inserting after scene 1 and taking its closing ones. */}
      {onInsertAfter ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={onInsertAfter}
          >
            {STR.videoInsertSceneAfter}
          </button>
        </div>
      ) : null}
    </section>
  );
}
