'use client';

// One scene of a video project, in one of two modes:
//
// - 'edit' (gate 1, script review): narration + visual brief are open
//   textareas — the officer corrects names/amounts in the narration and can
//   reshape the visual before anything is rendered.
// - 'review' (gate 2 storyboard + the post-render fix panel): shows the
//   keyframe still with the narration beside it; the brief opens in a fold for
//   "change the description and redraw" (cents), and the fix panel adds the
//   per-scene re-animate action (that scene's Veo cost only).
//
// Per-scene status/error chips render in both modes — a failed scene must say
// so on ITS card, not sink the project.

import { useState } from 'react';
import type { VideoScene } from '@dgipr/schemas';
import { estimateNarrationSeconds } from '@dgipr/schemas';
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
  'still-rendering': 'चित्र तयार होत आहे…',
  animating: 'दृश्य ॲनिमेट होत आहे…',
} as const;

export function VideoSceneCard({
  index,
  scene,
  mode,
  busy,
  onNarrationChange,
  onBriefChange,
  onRemove,
  onRedraw,
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
  onRemove?: (() => void) | undefined;
  // gate 2 / fix panel (mode 'review')
  onRedraw?: (brief: string) => void;
  onReanimate?: (() => void) | undefined;
  reanimateLabel?: string;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefDraft, setBriefDraft] = useState(scene.visualBrief);

  const heading = `${STR.videoSceneLabel} ${index + 1}`;

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
        <p className="hint">
          {STR.videoNarrationHint}
          {scene.narration.trim().length > 0
            ? ` · ${videoNarrationEstimate(estimateNarrationSeconds(scene.narration))}`
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
      </section>
    );
  }

  return (
    <section className="card">
      <div className="article-head">
        <h2>{heading}</h2>
        <SceneStatusChip scene={scene} />
      </div>
      {scene.stillUrl ? (
        <img
          src={scene.stillUrl}
          alt={heading}
          style={{ width: '100%', maxWidth: 480, borderRadius: 8 }}
        />
      ) : (
        <p className="hint">{STR.videoStillPending}</p>
      )}
      <p style={{ marginTop: 10 }}>{scene.narration}</p>
      <p className="hint">
        {videoSceneTiming(scene.durationSeconds, scene.narrationSeconds)}
      </p>
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
            setBriefOpen((open) => !open);
          }}
        >
          {STR.videoEditBrief}
        </button>
        {!briefOpen ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => onRedraw?.(scene.visualBrief)}
          >
            {STR.videoRedrawStill}
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
          <textarea
            className="note-input"
            style={{ marginTop: 10, minHeight: 70 }}
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
                setBriefOpen(false);
                onRedraw?.(briefDraft.trim());
              }}
            >
              {STR.videoRedrawStill}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
