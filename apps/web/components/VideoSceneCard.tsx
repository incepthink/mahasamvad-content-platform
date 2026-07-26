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

import { useState } from 'react';
import type { VideoScene } from '@dgipr/schemas';
import {
  VIDEO_KEY_POINT_MAX_CHARS,
  clipSecondsForNarration,
  estimateNarrationSeconds,
} from '@dgipr/schemas';
import {
  STR,
  videoNarrationEstimate,
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
        <img
          src={url}
          alt={label}
          style={{ width: '100%', borderRadius: 8 }}
        />
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
  onReanimate,
  reanimateLabel,
}: {
  index: number;
  scene: VideoScene;
  mode: 'edit' | 'review';
  busy: boolean;
  // gate 1 (mode 'edit')
  onNarrationChange?: (value: string) => void;
  onBriefChange?: (value: string) => void;
  onEndBriefChange?: (value: string) => void;
  onKeyPointChange?: (value: string) => void;
  onRemove?: (() => void) | undefined;
  // gate 2 / fix panel (mode 'review'). onRedraw regenerates the PAIR from an
  // edited start brief; onRedrawEnd re-edits only the end frame.
  onRedraw?: (brief: string) => void;
  onRedrawEnd?: ((endBrief: string) => void) | undefined;
  onReanimate?: (() => void) | undefined;
  reanimateLabel?: string;
}) {
  // Which brief the fold edits: the start brief redraws the pair, the end
  // brief redraws only the end frame.
  const [briefOpen, setBriefOpen] = useState<'start' | 'end' | null>(null);
  const [briefDraft, setBriefDraft] = useState(scene.visualBrief);

  const heading = `${STR.videoSceneLabel} ${index + 1}`;
  const hasEndFrame = scene.endVisualBrief !== undefined;

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
        {/* The estimate now also names the CLIP the narration will buy, since
            the window is derived from the speech — this line is the officer's
            only feedback on how long the scene they are editing will run. */}
        <p className="hint">
          {STR.videoNarrationHint}
          {scene.narration.trim().length > 0
            ? ` · ${videoNarrationEstimate(
                estimateNarrationSeconds(scene.narration),
                clipSecondsForNarration(
                  estimateNarrationSeconds(scene.narration),
                ),
              )}`
            : ''}
        </p>
        <textarea
          id={`scene-narration-${index}`}
          className="note-input"
          style={{ minHeight: 70 }}
          value={scene.narration}
          disabled={busy}
          onChange={(event) => onNarrationChange?.(event.target.value)}
        />
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
      <p style={{ marginTop: 10 }}>{scene.narration}</p>
      {scene.keyPoint && scene.keyPoint.trim() !== '' ? (
        <p className="hint">
          {STR.videoKeyPointReviewLabel}: {scene.keyPoint}
        </p>
      ) : null}
      <p className="hint">
        {videoSceneTiming(scene.durationSeconds, scene.narrationSeconds)}
      </p>
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

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => {
            setBriefDraft(scene.visualBrief);
            setBriefOpen((open) => (open === 'start' ? null : 'start'));
          }}
        >
          {STR.videoRedrawStill}
        </button>
        {hasEndFrame && onRedrawEnd ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => {
              setBriefDraft(scene.endVisualBrief ?? '');
              setBriefOpen((open) => (open === 'end' ? null : 'end'));
            }}
          >
            {STR.videoRedrawEndStill}
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
            value={briefDraft}
            disabled={busy}
            onChange={(event) => setBriefDraft(event.target.value)}
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy || briefDraft.trim().length === 0}
              onClick={() => {
                const brief = briefDraft.trim();
                const which = briefOpen;
                setBriefOpen(null);
                if (which === 'start') onRedraw?.(brief);
                else onRedrawEnd?.(brief);
              }}
            >
              {briefOpen === 'start'
                ? STR.videoRedrawStill
                : STR.videoRedrawEndStill}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
