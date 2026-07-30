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
import {
  VIDEO_SCENE_LIMIT,
  VIDEO_STYLE_MAX_CHARS,
  VIDEO_TOTAL_FIT_TOLERANCE,
  VIDEO_TOTAL_SECONDS,
  clipSecondsForNarration,
  estimateNarrationSeconds,
} from '@dgipr/schemas';
import {
  narrateVideo,
  reanimateVideoScene,
  regenerateVideoStill,
  reopenVideoStoryboard,
  restitchVideo,
  saveVideoScript,
  saveVideoSceneMotion,
  startVideoAnimation,
  startVideoStoryboard,
} from '../../../lib/api';
import { useVideoProject } from '../../../lib/useVideoProject';
import {
  videoNarrationTotal,
  videoReadyScriptEstimate,
  STR,
  VIDEO_STEP_LABELS,
} from '../../../lib/strings';
import { VideoSceneCard } from '../../../components/VideoSceneCard';
import { VideoStatusChip } from '../../../components/VideoStatusChip';
import { VideoResultView } from '../../../components/VideoResultView';

type SceneDraft = {
  narration: string;
  visualBrief: string;
  endVisualBrief: string;
  // The planned visual window the script writer saw. It is shown for review;
  // the continuous voice phase normalises the complete timeline after edits.
  durationSeconds: number;
  // The on-screen Marathi line. Blank is a real answer meaning "no overlay on
  // this scene", so it is stored as '' rather than undefined.
  keyPoint: string;
  beat?: string | undefined;
};

function draftsFrom(scenes: readonly VideoScene[]): SceneDraft[] {
  return scenes.map((scene) => ({
    narration: scene.narration,
    visualBrief: scene.visualBrief,
    endVisualBrief: scene.endVisualBrief ?? '',
    keyPoint: scene.keyPoint ?? '',
    durationSeconds: scene.durationSeconds,
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
            <li
              key={index}
              className="file-row"
              style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
            >
              <div style={{ flex: '1 1 100%', minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
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
                </div>
                {scene.clipUrl ? (
                  <div style={{ marginTop: 10 }}>
                    <p className="hint" style={{ marginBottom: 6 }}>
                      {STR.videoClipPreview}
                    </p>
                    <video
                      key={scene.clipUrl}
                      controls
                      muted
                      preload="metadata"
                      src={scene.clipUrl}
                      style={{
                        display: 'block',
                        width: '100%',
                        maxWidth: 560,
                        borderRadius: 8,
                      }}
                    />
                  </div>
                ) : null}
              </div>
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
  // The project's visual style/setting paragraph, editable here because it is
  // an input to every frame prompt — without this an officer whose frames came
  // back with the wrong setting could only regenerate the whole script.
  const [styleDraft, setStyleDraft] = useState('');
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
      setStyleDraft(detail.style ?? '');
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
  // Gate-1 budget line: what the edited drafts are estimated to speak, against
  // the project's selected total. Estimated from characters, so it is a guide,
  // not a verdict — the storyboard job measures the real WAVs.
  const totalNarrationSeconds = (drafts ?? []).reduce(
    (sum, draft) => sum + estimateNarrationSeconds(draft.narration),
    0,
  );
  const narrationTarget = VIDEO_TOTAL_SECONDS[detail.durationBucket];
  const narrationOverBudget =
    detail.inputMode === 'note' &&
    totalNarrationSeconds > narrationTarget * VIDEO_TOTAL_FIT_TOLERANCE;
  // A scene that declared an end frame must have rendered it too — animate
  // would otherwise buy a clip whose reviewed ending never existed.
  const allStillsReady =
    detail.scenes.length > 0 &&
    detail.scenes.every(
      (scene) =>
        scene.stillUrl !== undefined &&
        (scene.endVisualBrief === undefined || scene.endStillUrl !== undefined),
    );
  const allClipsReady =
    detail.scenes.length > 0 &&
    detail.scenes.every((scene) => scene.clipUrl !== undefined);
  // A per-scene re-render on a finished video: keep showing the result view.
  const reRendering = detail.status === 'animating' && detail.videoUrl !== null;

  const submitScript = () =>
    act(async () => {
      if (!drafts) return;
      await saveVideoScript(id, {
        // Sent only when it says something: the schema rejects an empty style,
        // and omitting it leaves the stored paragraph alone.
        ...(styleDraft.trim() !== '' ? { style: styleDraft.trim() } : {}),
        scenes: drafts.map((draft) => ({
          narration: draft.narration,
          visualBrief: draft.visualBrief,
          // Blank = single-frame scene (legacy semantics); the schema takes
          // the field only when it says something.
          ...(draft.endVisualBrief.trim() !== ''
            ? { endVisualBrief: draft.endVisualBrief.trim() }
            : {}),
          // Always sent, INCLUDING blank — an officer clearing this line means
          // "drop the overlay on this scene", which omitting the field would
          // silently discard.
          keyPoint: draft.keyPoint.trim(),
        })),
      });
      await startVideoStoryboard(id);
    });

  const redrawStill = (index: number, brief: string) =>
    act(() =>
      regenerateVideoStill(id, index, {
        frame: 'start',
        openingVisualBrief: brief,
      }),
    );

  // Free and frame-preserving: the motion direction only feeds the clip
  // prompt, so the saved text applies to the next animation of that scene.
  const saveMotionBrief = (index: number, motionBrief: string) =>
    act(() => saveVideoSceneMotion(id, index, { motionBrief }));

  const redrawEndStill = (index: number, endBrief: string) =>
    act(() =>
      regenerateVideoStill(id, index, {
        frame: 'end',
        endVisualBrief: endBrief,
      }),
    );

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
          <section className="card">
            <label className="field-label" htmlFor="video-style">
              {STR.videoStyleLabel}
            </label>
            <p className="hint" style={{ marginTop: 4 }}>
              {STR.videoStyleHint}
            </p>
            <textarea
              id="video-style"
              className="textarea"
              style={{ marginTop: 6, minHeight: 90 }}
              value={styleDraft}
              maxLength={VIDEO_STYLE_MAX_CHARS}
              disabled={busy}
              onChange={(event) => setStyleDraft(event.target.value)}
            />
          </section>
          {drafts.map((draft, index) => (
            <VideoSceneCard
              key={index}
              index={index}
              scene={{
                narration: draft.narration,
                visualBrief: draft.visualBrief,
                endVisualBrief: draft.endVisualBrief,
                keyPoint: draft.keyPoint,
                durationSeconds: draft.durationSeconds,
                status: 'pending',
                ...(draft.beat !== undefined ? { beat: draft.beat } : {}),
              }}
              mode="edit"
              busy={busy}
              {...(detail.inputMode === 'note'
                ? {
                    onNarrationChange: (value: string) =>
                      setDrafts((prev) =>
                        prev
                          ? prev.map((d, i) =>
                              i === index ? { ...d, narration: value } : d,
                            )
                          : prev,
                      ),
                  }
                : {})}
              onBriefChange={(value) =>
                setDrafts((prev) =>
                  prev
                    ? prev.map((d, i) =>
                        i === index ? { ...d, visualBrief: value } : d,
                      )
                    : prev,
                )
              }
              onEndBriefChange={(value) =>
                setDrafts((prev) =>
                  prev
                    ? prev.map((d, i) =>
                        i === index ? { ...d, endVisualBrief: value } : d,
                      )
                    : prev,
                )
              }
              onKeyPointChange={(value) =>
                setDrafts((prev) =>
                  prev
                    ? prev.map((d, i) =>
                        i === index ? { ...d, keyPoint: value } : d,
                      )
                    : prev,
                )
              }
              onRemove={
                detail.inputMode === 'note' && drafts.length > bounds.min
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
              {detail.inputMode === 'note' && drafts.length < bounds.max ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((prev) =>
                      prev
                        ? [
                            ...prev,
                            {
                              narration: '',
                              visualBrief: '',
                              endVisualBrief: '',
                              keyPoint: '',
                              durationSeconds: clipSecondsForNarration(0),
                            },
                          ]
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
            {/* The running narration total against the project's selected
                length. Advisory ONLY — it never blocks the submit, because the
                storyboard job measures the real audio and shortens whatever
                still overruns; a character estimate must not veto a script the
                voice might well fit. */}
            <p
              className={narrationOverBudget ? 'form-error' : 'hint'}
              style={{ marginTop: 8 }}
            >
              {detail.inputMode === 'script'
                ? `${STR.videoScriptEstimateLabel}: ${videoReadyScriptEstimate(
                    totalNarrationSeconds,
                    drafts.length,
                  )}`
                : videoNarrationTotal(totalNarrationSeconds, narrationTarget)}
              {narrationOverBudget ? ` ${STR.videoNarrationTotalOver}` : ''}
            </p>
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
              onRedrawEnd={(endBrief) => void redrawEndStill(index, endBrief)}
              onMotionBriefSave={(motionBrief) =>
                void saveMotionBrief(index, motionBrief)
              }
            />
          ))}
          <section className="card">
            <div className="btn-row">
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
                    {STR.videoAnimateConfirmYes}
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
          onRedrawEndStill={(index, endBrief) =>
            void redrawEndStill(index, endBrief)
          }
          onSaveMotionBrief={(index, motionBrief) =>
            void saveMotionBrief(index, motionBrief)
          }
          onReanimateScene={(index) =>
            void act(() => reanimateVideoScene(id, index))
          }
          onNarrate={() => void act(() => narrateVideo(id))}
          onRestitch={() => void act(() => restitchVideo(id))}
        />
      ) : null}

      {detail.status === 'failed' ? (
        <section className="card">
          <h2>{STR.failedTitle}</h2>
          {detail.error ? <p className="form-error">{detail.error}</p> : null}
          <div className="btn-row" style={{ marginTop: 12 }}>
            {allClipsReady &&
            (detail.step === 'stitch' || detail.step === 'upload') ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void act(() => restitchVideo(id))}
              >
                {STR.videoRestitch}
              </button>
            ) : allStillsReady ? (
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
            {detail.scenes.length > 0 && allStillsReady ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(() => reopenVideoStoryboard(id))}
              >
                {STR.videoBackToStoryboard}
              </button>
            ) : null}
            <Link className="btn" href="/video">
              {STR.videoTitle}
            </Link>
          </div>
          {allClipsReady &&
          (detail.step === 'stitch' || detail.step === 'upload') ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoRestitchHint}
            </p>
          ) : allStillsReady ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoResumeHint}
            </p>
          ) : null}
          {detail.scenes.length > 0 && allStillsReady ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoBackToStoryboardHint}
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
