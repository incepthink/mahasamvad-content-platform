'use client';

// The finished video card: player, timed narration list (from the scenes' own
// durations — the same numbers the SRT is built from), SRT download, cost line,
// and the per-scene fix panel (re-draw a still / re-animate ONE scene). The
// previous video keeps playing during a re-render — during a per-scene
// re-animation this view stays up with a progress note instead of being
// replaced by a progress bar (the caption-editing rationale).

import { useState } from 'react';
import type { VideoProjectDetail } from '@dgipr/schemas';
import { VIDEO_TIER_PRICE_PER_SECOND_USD, sceneTimings } from '@dgipr/schemas';
import { formatCost, STR } from '../lib/strings';
import { VideoSceneCard } from './VideoSceneCard';

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function VideoResultView({
  detail,
  busy,
  onRedrawStill,
  onReanimateScene,
  onNarrate,
}: {
  detail: VideoProjectDetail;
  // A job is in flight (re-still / re-animate / narrate) — actions disabled, note shown.
  busy: boolean;
  onRedrawStill: (index: number, brief: string) => void;
  onReanimateScene: (index: number) => void;
  // Add or refresh the Marathi TTS narration on the finished video.
  onNarrate: () => void;
}) {
  const [fixOpen, setFixOpen] = useState(false);
  // Two-step confirm per scene: first click arms, second fires (outward spend).
  const [armedIndex, setArmedIndex] = useState<number | null>(null);

  const timings = sceneTimings(detail.scenes);
  const perScenePrice = (seconds: number) =>
    formatCost(seconds * VIDEO_TIER_PRICE_PER_SECOND_USD[detail.tier]);

  return (
    <>
      <section className="card">
        <div className="article-head">
          <h2>{detail.title ?? STR.videoResultTitle}</h2>
          {detail.costUsd !== null ? (
            <span className="hint">{formatCost(detail.costUsd)}</span>
          ) : null}
        </div>
        {busy ? (
          <p className="translating-note">
            <span className="spinner" aria-hidden="true" />
            {detail.step === 'narrate'
              ? STR.videoNarratingHint
              : STR.videoAnimatingHint}
          </p>
        ) : null}
        {detail.videoUrl ? (
          <video
            key={detail.videoUrl}
            controls
            src={detail.videoUrl}
            style={{ width: '100%', borderRadius: 8, marginTop: 10 }}
          />
        ) : null}
        <div className="btn-row" style={{ marginTop: 12 }}>
          {detail.videoUrl ? (
            <a
              className="btn"
              href={detail.videoUrl}
              download={`video-v${detail.videoVersion}.mp4`}
            >
              {STR.videoDownload}
            </a>
          ) : null}
          {detail.srtUrl ? (
            <a
              className="btn"
              href={detail.srtUrl}
              download={`subtitles-v${detail.videoVersion}.srt`}
            >
              {STR.videoSrtDownload}
            </a>
          ) : null}
          {detail.videoUrl ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onNarrate}
            >
              {detail.voiced ? STR.videoReNarration : STR.videoAddNarration}
            </button>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {detail.voiced ? STR.videoSrtHintVoiced : STR.videoSrtHint}
        </p>
        {!detail.voiced ? (
          <p className="hint" style={{ marginTop: 6 }}>
            {STR.videoNarrationHintCta}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>{STR.videoTimedScript}</h2>
        <ol className="file-list" style={{ marginTop: 10 }}>
          {detail.scenes.map((scene, index) => (
            <li key={index} className="file-row">
              <span className="file-size">
                {formatClock(timings[index]?.startSeconds ?? 0)}–
                {formatClock(timings[index]?.endSeconds ?? 0)}
              </span>
              <span className="file-name" style={{ whiteSpace: 'normal' }}>
                {scene.narration}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => setFixOpen((open) => !open)}
          >
            {STR.videoFixScene}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {STR.videoReanimateHint}
        </p>
      </section>

      {fixOpen
        ? detail.scenes.map((scene, index) => (
            <VideoSceneCard
              key={index}
              index={index}
              scene={scene}
              mode="review"
              busy={busy}
              onRedraw={(brief) => onRedrawStill(index, brief)}
              onReanimate={
                scene.stillUrl
                  ? () => {
                      if (armedIndex === index) {
                        setArmedIndex(null);
                        onReanimateScene(index);
                      } else {
                        setArmedIndex(index);
                      }
                    }
                  : undefined
              }
              reanimateLabel={
                armedIndex === index
                  ? `${STR.videoAnimateConfirmYes} (${perScenePrice(scene.durationSeconds)})`
                  : STR.videoReanimateScene
              }
            />
          ))
        : null}
    </>
  );
}
