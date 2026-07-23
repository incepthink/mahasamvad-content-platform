'use client';

// One video project's page, driven entirely by the row's status (the id is in
// the URL and the state is the DB row, so a refresh loses nothing):
//
//   scripting            → progress card
//   script_ready         → GATE 1: editable scene cards → "स्टोरीबोर्ड तयार करा"
//   storyboarding        → scene cards with per-scene spinners as stills land
//   storyboard_ready     → GATE 2: stills + redraw loop + the two-step animate
//                          confirm (THE spend — shows the estimate first)
//   animating            → per-scene chips; the previous video (if any) stays
//                          playable during a per-scene re-render
//   completed            → player + timed script + SRT + per-scene fix panel
//   failed               → error + the cheapest retry that applies (animate
//                          resumes from persisted clips)

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { VideoProjectDetail, VideoScene } from '@dgipr/schemas';
import { VIDEO_SCENE_LIMIT, estimateVideoRenderCostUsd } from '@dgipr/schemas';
import {
  narrateVideo,
  reanimateVideoScene,
  regenerateVideoStill,
  saveVideoScript,
  startVideoAnimation,
  startVideoStoryboard,
} from '../../../lib/api';
import { useVideoProject } from '../../../lib/useVideoProject';
import { formatCost, STR, VIDEO_STEP_LABELS } from '../../../lib/strings';
import { VideoSceneCard } from '../../../components/VideoSceneCard';
import { VideoStatusChip } from '../../../components/VideoStatusChip';
import { VideoResultView } from '../../../components/VideoResultView';

// No durationSeconds: clip windows are server-assigned from the measured
// narration audio (the storyboard job's voice phase), never hand-picked.
type SceneDraft = {
  narration: string;
  visualBrief: string;
  beat?: string | undefined;
};

function draftsFrom(scenes: readonly VideoScene[]): SceneDraft[] {
  return scenes.map((scene) => ({
    narration: scene.narration,
    visualBrief: scene.visualBrief,
    beat: scene.beat,
  }));
}

function WorkingCard({ detail }: { detail: VideoProjectDetail }) {
  const label =
    (detail.step ? VIDEO_STEP_LABELS[detail.step] : undefined) ??
    VIDEO_STEP_LABELS.script;
  return (
    <section className="card">
      <div className="dlo-processing">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p className="dlo-processing-title">{label}</p>
        {detail.status === 'animating' ? (
          <p className="hint">{STR.videoAnimatingHint}</p>
        ) : null}
      </div>
      {detail.scenes.length > 0 ? (
        <ul className="file-list" style={{ marginTop: 12 }}>
          {detail.scenes.map((scene, index) => (
            <li key={index} className="file-row">
              <span className="file-name" style={{ whiteSpace: 'normal' }}>
                {STR.videoSceneLabel} {index + 1}: {scene.narration}
              </span>
              <span className="file-size">
                {scene.status === 'done' || scene.status === 'still-ready'
                  ? '✓'
                  : scene.status === 'failed'
                    ? STR.videoSceneFailed
                    : scene.status === 'animating' ||
                        scene.status === 'still-rendering'
                      ? '…'
                      : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function VideoProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { detail, error, refresh } = useVideoProject(id);

  const [drafts, setDrafts] = useState<SceneDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Two-step confirm for the full animate (irreversible spend).
  const [animateArmed, setAnimateArmed] = useState(false);
  const lastStatus = useRef<VideoProjectDetail['status'] | null>(null);

  // Seed gate 1's drafts on each transition INTO script_ready ("per
  // transition", the useDloIntake rule, so a later regeneration reseeds).
  useEffect(() => {
    if (!detail) return;
    if (
      detail.status === 'script_ready' &&
      lastStatus.current !== 'script_ready'
    ) {
      setDrafts(draftsFrom(detail.scenes));
    }
    if (detail.status !== 'storyboard_ready') setAnimateArmed(false);
    lastStatus.current = detail.status;
  }, [detail]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setFormError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <main className="page">
        <p className="form-error">{error}</p>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="page">
        <section className="card">
          <div className="dlo-processing">
            <span className="spinner spinner-lg" aria-hidden="true" />
          </div>
        </section>
      </main>
    );
  }

  const bounds = VIDEO_SCENE_LIMIT;
  const estimate = formatCost(
    estimateVideoRenderCostUsd(detail.tier, detail.scenes),
  );
  const allStillsReady =
    detail.scenes.length > 0 &&
    detail.scenes.every((scene) => scene.stillUrl !== undefined);
  // A per-scene re-render on a finished video: keep showing the result view.
  const reRendering = detail.status === 'animating' && detail.videoUrl !== null;

  const submitScript = () =>
    act(async () => {
      if (!drafts) return;
      await saveVideoScript(id, {
        scenes: drafts.map((draft) => ({
          narration: draft.narration,
          visualBrief: draft.visualBrief,
        })),
      });
      await startVideoStoryboard(id);
    });

  const redrawStill = (index: number, brief: string) =>
    act(() => regenerateVideoStill(id, index, { visualBrief: brief }));

  return (
    <main className="page">
      <div className="article-head">
        <h1 className="page-title">{detail.title ?? STR.videoTitle}</h1>
        <VideoStatusChip status={detail.status} />
      </div>

      {detail.status === 'scripting' ||
      detail.status === 'storyboarding' ||
      (detail.status === 'animating' && !reRendering) ? (
        <WorkingCard detail={detail} />
      ) : null}

      {detail.status === 'script_ready' && drafts ? (
        <>
          <section className="card">
            <h2>{STR.videoScriptTitle}</h2>
            <p className="hint">{STR.videoScriptIntro}</p>
          </section>
          {drafts.map((draft, index) => (
            <VideoSceneCard
              key={index}
              index={index}
              scene={{
                narration: draft.narration,
                visualBrief: draft.visualBrief,
                // Display placeholder only — the real window is assigned by
                // the storyboard job's voice phase and never edited here.
                durationSeconds: 8,
                status: 'pending',
                ...(draft.beat !== undefined ? { beat: draft.beat } : {}),
              }}
              mode="edit"
              busy={busy}
              onNarrationChange={(value) =>
                setDrafts((prev) =>
                  prev
                    ? prev.map((d, i) =>
                        i === index ? { ...d, narration: value } : d,
                      )
                    : prev,
                )
              }
              onBriefChange={(value) =>
                setDrafts((prev) =>
                  prev
                    ? prev.map((d, i) =>
                        i === index ? { ...d, visualBrief: value } : d,
                      )
                    : prev,
                )
              }
              onRemove={
                drafts.length > bounds.min
                  ? () =>
                      setDrafts((prev) =>
                        prev ? prev.filter((_, i) => i !== index) : prev,
                      )
                  : undefined
              }
            />
          ))}
          <section className="card">
            <div className="btn-row">
              {drafts.length < bounds.max ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((prev) =>
                      prev
                        ? [...prev, { narration: '', visualBrief: '' }]
                        : prev,
                    )
                  }
                >
                  {STR.videoAddScene}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  drafts.some(
                    (d) =>
                      d.narration.trim().length === 0 ||
                      d.visualBrief.trim().length === 0,
                  )
                }
                onClick={submitScript}
              >
                {busy ? STR.submitting : STR.videoToStoryboard}
              </button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoToStoryboardHint}
            </p>
            {formError ? <p className="form-error">{formError}</p> : null}
          </section>
        </>
      ) : null}

      {detail.status === 'storyboard_ready' ? (
        <>
          <section className="card">
            <h2>{STR.videoStoryboardTitle}</h2>
            <p className="hint">{STR.videoStoryboardIntro}</p>
          </section>
          {detail.scenes.map((scene, index) => (
            <VideoSceneCard
              key={index}
              index={index}
              scene={scene}
              mode="review"
              busy={busy}
              onRedraw={(brief) => void redrawStill(index, brief)}
            />
          ))}
          <section className="card">
            <p className="hint">
              {STR.videoAnimateEstimate}: <strong>{estimate}</strong>
            </p>
            <div className="btn-row" style={{ marginTop: 10 }}>
              {animateArmed ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !allStillsReady}
                    onClick={() =>
                      void act(async () => {
                        setAnimateArmed(false);
                        await startVideoAnimation(id);
                      })
                    }
                  >
                    {STR.videoAnimateConfirmYes} ({estimate})
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setAnimateArmed(false)}
                  >
                    {STR.videoAnimateCancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !allStillsReady}
                  onClick={() => setAnimateArmed(true)}
                >
                  {STR.videoAnimate}
                </button>
              )}
            </div>
            {animateArmed ? (
              <p className="hint" style={{ marginTop: 8 }}>
                {STR.videoAnimateConfirm}
              </p>
            ) : null}
            {!allStillsReady ? (
              <p className="hint" style={{ marginTop: 8 }}>
                {STR.videoStillPending}
              </p>
            ) : null}
            {formError ? <p className="form-error">{formError}</p> : null}
          </section>
        </>
      ) : null}

      {detail.status === 'completed' || reRendering ? (
        <VideoResultView
          detail={detail}
          busy={busy || reRendering}
          onRedrawStill={(index, brief) => void redrawStill(index, brief)}
          onReanimateScene={(index) =>
            void act(() => reanimateVideoScene(id, index))
          }
          onNarrate={() => void act(() => narrateVideo(id))}
        />
      ) : null}

      {detail.status === 'failed' ? (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          {detail.error ? <p className="form-error">{detail.error}</p> : null}
          <div className="btn-row" style={{ marginTop: 12 }}>
            {allStillsReady ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void act(() => startVideoAnimation(id))}
              >
                {STR.videoRetryAnimate}
              </button>
            ) : detail.scenes.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void act(() => startVideoStoryboard(id))}
              >
                {STR.videoToStoryboard}
              </button>
            ) : null}
            <Link className="btn" href="/video">
              {STR.videoTitle}
            </Link>
          </div>
          {allStillsReady ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoResumeHint}
            </p>
          ) : null}
          {formError ? <p className="form-error">{formError}</p> : null}
        </section>
      ) : null}

      {detail.status === 'failed' && detail.videoUrl ? (
        <section className="card">
          <video
            key={detail.videoUrl}
            controls
            src={detail.videoUrl}
            style={{ width: '100%', borderRadius: 8 }}
          />
        </section>
      ) : null}
    </main>
  );
}
