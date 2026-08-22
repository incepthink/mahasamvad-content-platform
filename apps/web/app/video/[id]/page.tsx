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
  UPLOAD_FILE_MAX_BYTES,
  VIDEO_NARRATION_MAX_CHARS,
  VIDEO_SCENE_LIMIT,
  VIDEO_STYLE_MAX_CHARS,
  VIDEO_TOTAL_FIT_TOLERANCE,
  VIDEO_LOCKUP_MARGIN_RATIO,
  VIDEO_LOCKUP_WIDTH_RATIO,
  UPLOADED_NARRATION_VOICE,
  VIDEO_TOTAL_SECONDS,
  clipSecondsForNarration,
  estimateNarrationSeconds,
} from '@dgipr/schemas';
import {
  deleteVideoSceneEndFrame,
  narrateVideo,
  reanimateVideoScene,
  regenerateVideoStill,
  reopenVideoScript,
  reopenVideoStoryboard,
  replanVideoScript,
  restitchVideo,
  saveVideoScript,
  saveVideoSceneMotion,
  startVideoAnimation,
  startVideoStoryboard,
  uploadVideoSceneReferenceImage,
  useStartFrameAsEndFrame,
  API_URL,
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
  // React's key, and it must NOT be the array position. With key={index},
  // deleting scene i unmounts the LAST card and re-renders every card from i
  // onward with different content — so one deletion rewrites the text of every
  // scene below it. That is merely wasteful on its own, but it is fatal once
  // the browser's translator has re-parented those text nodes into <font>
  // wrappers: React still holds the originals, and removing one throws
  // "removeChild … not a child of this node". Keyed by identity, a deletion
  // unmounts exactly the deleted card and leaves every other card's DOM alone.
  //
  // Derived, not a random id, so it stays stable across a reseed: a stored
  // scene keeps `s{index}` after every save, which is what preserves a gate-2
  // card's open brief fold. Inserted scenes take a counter, since they have no
  // stored position to name them by until the save lands.
  uid: string;
  // Which STORED scene this card is, so the API can keep its frames and clip
  // lineage when an insert shifts every later card's position. Undefined marks
  // a scene the officer just inserted, which has nothing rendered yet.
  sourceIndex?: number | undefined;
  narration: string;
  visualBrief: string;
  endVisualBrief: string;
  // The planned visual window the script writer saw. It is shown for review;
  // the continuous voice phase normalises the complete timeline after edits.
  durationSeconds: number;
  // The on-screen Marathi line. Blank is a real answer meaning "no overlay on
  // this scene", so it is stored as '' rather than undefined.
  keyPoint: string;
  // The officer's reference picture for this scene's start frame. BOTH halves
  // are held: the URL renders the thumbnail, and the PATH is what the save
  // sends. '' means "no picture", and — because the field is always sent — that
  // is also how a removal reaches the API.
  referenceImagePath: string;
  referenceImageUrl: string;
  beat?: string | undefined;
};

// Names an inserted card until a save turns it into a stored scene. Module
// scope so it never repeats within a session — two cards inserted at the same
// position must not collide on a key, which `new-${index}` did.
let insertedSceneSeq = 0;

function blankDraft(): SceneDraft {
  insertedSceneSeq += 1;
  return {
    uid: `n${insertedSceneSeq}`,
    narration: '',
    visualBrief: '',
    endVisualBrief: '',
    keyPoint: '',
    referenceImagePath: '',
    referenceImageUrl: '',
    durationSeconds: clipSecondsForNarration(0),
  };
}

function draftsFrom(scenes: readonly VideoScene[]): SceneDraft[] {
  return scenes.map((scene, index) => ({
    uid: `s${index}`,
    sourceIndex: index,
    narration: scene.narration,
    visualBrief: scene.visualBrief,
    endVisualBrief: scene.endVisualBrief ?? '',
    keyPoint: scene.keyPoint ?? '',
    // Seeded on BOTH gates even though only gate 1 can edit it: gate 2's save
    // sends the same field, so an unseeded draft would send '' and silently
    // detach a picture the officer attached before the storyboard was rendered.
    referenceImagePath: scene.referenceImagePath ?? '',
    referenceImageUrl: scene.referenceImageUrl ?? '',
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
                  {/* One interpolated string, not `{a} {b}: {c}`. Three sibling
                      text nodes are what the browser's translator merges into a
                      single <font>, after which React's own references to them
                      are no longer children of this <span> and removing one
                      throws NotFoundError. A lone text child is safe: React
                      removes the ELEMENT, which the translator never reparents. */}
                  <span className="file-name" style={{ whiteSpace: 'normal' }}>
                    {`${STR.videoSceneLabel} ${index + 1}: ${scene.narration}`}
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
                    {/* The stored clip is the provider's own footage, with no
                        branding burned in — the government lockup belongs to
                        the stitch alone, so that changing its size takes effect
                        on a free restitch instead of being frozen into every
                        paid clip. The preview therefore lays the same artwork
                        over the player in CSS, at the same proportions the
                        stitch uses, so what the officer reviews here matches
                        the finished video. */}
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxWidth: 560,
                      }}
                    >
                      <video
                        key={scene.clipUrl}
                        controls
                        muted
                        preload="metadata"
                        src={scene.clipUrl}
                        style={{
                          display: 'block',
                          width: '100%',
                          borderRadius: 8,
                        }}
                      />
                      <img
                        src={`${API_URL}/api/video/lockup.png`}
                        alt=""
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: `${VIDEO_LOCKUP_MARGIN_RATIO * 100}%`,
                          // A percentage MARGIN resolves against the containing
                          // block's width in CSS, which is what makes this the
                          // same offset the stitch uses. `top` would not: that
                          // percentage is of the HEIGHT, so on 16:9 footage it
                          // would land the lockup ~1.8x too far down.
                          marginTop: `${VIDEO_LOCKUP_MARGIN_RATIO * 100}%`,
                          width: `${VIDEO_LOCKUP_WIDTH_RATIO * 100}%`,
                          pointerEvents: 'none',
                        }}
                      />
                    </div>
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
  // Reference-picture upload state, kept OUT of `busy`/`formError`: a picture
  // travelling for one card must not disable the rest of the page, and its
  // failure belongs on that card rather than under the action buttons. Keyed by
  // draft uid, never index, so an insert mid-upload cannot move either onto a
  // different scene.
  const [referenceBusyUid, setReferenceBusyUid] = useState<string | null>(null);
  const [referenceErrors, setReferenceErrors] = useState<
    Record<string, string>
  >({});
  // Two-step confirm for the full animate (irreversible spend).
  const [animateArmed, setAnimateArmed] = useState(false);
  // Scenes the officer ticked for a re-shoot whose clip is already current.
  // ONLY those — a scene the animate is going to render anyway is never in
  // here, so this list stays what it is sent as: an addition to the job's own
  // stale set, never a replacement for it.
  const [extraScenes, setExtraScenes] = useState<readonly number[]>([]);
  const lastStatus = useRef<VideoProjectDetail['status'] | null>(null);

  // Seed the drafts on each transition INTO a review gate ("per transition",
  // the useDloIntake rule, so a later regeneration reseeds). Gate 2 is seeded
  // too, because the narration is editable there as well — that is where the
  // officer can re-split it against the frames they are looking at.
  useEffect(() => {
    if (!detail) return;
    const atGate =
      detail.status === 'script_ready' || detail.status === 'storyboard_ready';
    if (atGate && lastStatus.current !== detail.status) {
      setDrafts(draftsFrom(detail.scenes));
      setStyleDraft(detail.style ?? '');
    }
    if (detail.status !== 'storyboard_ready') {
      setAnimateArmed(false);
      setExtraScenes([]);
    }
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
  // The eight-scene ceiling is the NOTE lane's product limit — its narration is
  // budgeted at 30/60 seconds, so more cuts than that is chopping. A ready
  // script's length is the officer's own and its scene count is derived from
  // it (2026-08-12), so counting an already-longer project against eight would
  // only remove the extra-visual-cut affordance from exactly the projects that
  // have the most narration to illustrate.
  const canAddScene =
    detail.inputMode === 'note' ? (drafts ?? []).length < bounds.max : true;
  // Removing is offered on BOTH lanes for the same reason narration editing is
  // (see the gate-1 card below): on a ready-script project it is only legal
  // once the scene's words have been moved into a neighbour, and the API's
  // word-identity guard is what refuses the other case, in Marathi. Gating the
  // control instead would remove the legal use too — an officer who merged two
  // scenes' words then had no way to drop the emptied one.
  const canRemoveScene = (drafts ?? []).length > bounds.min;
  // Gate-1 budget line: what the edited drafts are estimated to speak, against
  // the project's selected total. Estimated from characters, so it is a guide,
  // not a verdict — the storyboard job measures the real WAVs.
  const totalNarrationSeconds = (drafts ?? []).reduce(
    (sum, draft) => sum + estimateNarrationSeconds(draft.narration),
    0,
  );
  // This project speaks in a recording the officer supplied, not a synthesized
  // voice — so its length is measured rather than estimated, and the re-voice
  // action must not be offered (the API refuses it too).
  const narrationIsUploaded = detail.voiceSpeaker === UPLOADED_NARRATION_VOICE;
  const measuredNarrationSeconds = detail.scenes.reduce(
    (sum, scene) => sum + (scene.narrationSeconds ?? 0),
    0,
  );
  const narrationTarget = VIDEO_TOTAL_SECONDS[detail.durationBucket];
  const narrationOverBudget =
    detail.inputMode === 'note' &&
    totalNarrationSeconds > narrationTarget * VIDEO_TOTAL_FIT_TOLERANCE;
  // Unlike the running total above, this one BLOCKS the two buttons that COMMIT
  // a split: the save route rejects a narration longer than one clip's worth of
  // speech (no clip may exceed VIDEO_CLIP_MAX_SECONDS), so letting the press
  // through only produced a raw zod `too_big` payload. The card that is over
  // says so, and the remedy is to split the line across two scenes.
  //
  // It deliberately does NOT gate the re-plan (2026-08-14): that call never
  // writes narration, its schema therefore carries no ceiling, and a scene the
  // ready-script splitter itself produced past this constant would otherwise
  // leave the officer unable to redescribe ANY scene until they had first
  // rewritten words the button was never going to touch.
  const narrationTooLong = (drafts ?? []).some(
    (d) => d.narration.trim().length > VIDEO_NARRATION_MAX_CHARS,
  );
  // A scene that declared an end frame must have rendered it too — animate
  // would otherwise buy a clip whose reviewed ending never existed.
  const allStillsReady =
    detail.scenes.length > 0 &&
    detail.scenes.every(
      (scene) =>
        scene.stillUrl !== undefined &&
        (scene.endVisualBrief === undefined || scene.endStillUrl !== undefined),
    );
  // The scenes the animate job will render whatever the officer ticks: one with
  // no clip yet, and one whose clip is stale (animated from a frame, ending,
  // window or motion brief that has since changed). `clipStale` is the API's
  // report of the job's OWN test, so this list cannot claim a scene will be
  // re-shot when the job would skip it, or the reverse.
  const requiredScenes = detail.scenes
    .map((scene, index) =>
      scene.clipUrl === undefined || scene.clipStale === true ? index : -1,
    )
    .filter((index) => index >= 0);
  // Ticks that still name a scene. A save clears them (see saveStoryboardScript)
  // and a required scene is never held here, so this is normally just the list —
  // the filters are what keep a stale index from reaching the route as a 400.
  const extraSelected = extraScenes.filter(
    (index) => index < detail.scenes.length && !requiredScenes.includes(index),
  );

  // Gate 2 holds unsaved script edits. Until they are committed the redraw
  // routes (which act on STORED scenes) cannot reach an inserted card, and
  // animating would render the scene list as it was before the edit — so the
  // animate button waits for the save.
  const storyboardDirty =
    drafts !== null &&
    detail.status === 'storyboard_ready' &&
    (drafts.length !== detail.scenes.length ||
      drafts.some((draft, index) => {
        const stored =
          draft.sourceIndex === undefined
            ? undefined
            : detail.scenes[draft.sourceIndex];
        return (
          stored === undefined ||
          draft.sourceIndex !== index ||
          stored.narration !== draft.narration ||
          (stored.keyPoint ?? '') !== draft.keyPoint
        );
      }));
  // Gate 1's equivalent, and it compares MORE fields than gate 2's: the briefs,
  // the key point and the style paragraph are all editable here, where at gate 2
  // a stored scene's briefs are changed through the redraw fold (which persists
  // on its own) rather than through the draft.
  const scriptDirty =
    drafts !== null &&
    detail.status === 'script_ready' &&
    (styleDraft.trim() !== (detail.style ?? '').trim() ||
      drafts.length !== detail.scenes.length ||
      drafts.some((draft, index) => {
        const stored =
          draft.sourceIndex === undefined
            ? undefined
            : detail.scenes[draft.sourceIndex];
        return (
          stored === undefined ||
          draft.sourceIndex !== index ||
          stored.narration !== draft.narration ||
          stored.visualBrief !== draft.visualBrief ||
          (stored.endVisualBrief ?? '') !== draft.endVisualBrief ||
          (stored.keyPoint ?? '') !== draft.keyPoint ||
          (stored.referenceImagePath ?? '') !== draft.referenceImagePath
        );
      }));
  // Both gate-1 buttons refuse the same payloads the save route does, so an
  // inserted scene has to be given its words and its brief here rather than
  // failing server-side.
  const scriptIncomplete = (drafts ?? []).some(
    (d) => d.narration.trim().length === 0 || d.visualBrief.trim().length === 0,
  );
  // The re-plan's own precondition, and deliberately NOT `scriptIncomplete`: a
  // missing दृश्य-वर्णन is exactly what it is being pressed to supply, so
  // blocking on one would disable the button in the case it exists for. Only
  // the narration is required, because that is the input the model plans FROM.
  const narrationIncomplete = (drafts ?? []).some(
    (d) => d.narration.trim().length === 0,
  );
  const allClipsReady =
    detail.scenes.length > 0 &&
    detail.scenes.every((scene) => scene.clipUrl !== undefined);
  // A per-scene re-render on a finished video: keep showing the result view.
  const reRendering = detail.status === 'animating' && detail.videoUrl !== null;

  const patchDraft = (index: number, patch: Partial<SceneDraft>) =>
    setDrafts((prev) =>
      prev ? prev.map((d, i) => (i === index ? { ...d, ...patch } : d)) : prev,
    );

  // Uploads one card's reference picture and holds the returned path on the
  // DRAFT. Deliberately outside `act()`: this is not a project action, it must
  // not disable the whole page while a photograph travels, and — most of all —
  // it must not `refresh()`, which would reseed the drafts and discard every
  // unsaved edit on the page. Nothing is attached until the officer saves.
  //
  // Keyed by the draft's uid rather than its index, so an insert or a removal
  // while an upload is in flight cannot move the spinner onto another card.
  const pickReferenceImage = async (index: number, file: File) => {
    const draft = drafts?.[index];
    if (!draft) return;
    const uid = draft.uid;
    const clearError = () =>
      setReferenceErrors((prev) => {
        if (prev[uid] === undefined) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    // Refused here rather than by the API, the picker rule: an oversized file
    // must not be uploaded before being rejected.
    if (file.size > UPLOAD_FILE_MAX_BYTES) {
      setReferenceErrors((prev) => ({ ...prev, [uid]: STR.fileTooLargeError }));
      return;
    }
    clearError();
    setReferenceBusyUid(uid);
    try {
      const uploaded = await uploadVideoSceneReferenceImage(id, file);
      // By identity, not by the index this started with — the officer may have
      // inserted or removed a card while the file was travelling.
      setDrafts((prev) =>
        prev
          ? prev.map((d) =>
              d.uid === uid
                ? {
                    ...d,
                    referenceImagePath: uploaded.path,
                    referenceImageUrl: uploaded.url,
                  }
                : d,
            )
          : prev,
      );
    } catch (e) {
      setReferenceErrors((prev) => ({
        ...prev,
        [uid]: e instanceof Error ? e.message : STR.genericError,
      }));
    } finally {
      setReferenceBusyUid((current) => (current === uid ? null : current));
    }
  };

  // A new card carries no sourceIndex, so the API treats it as new rather than
  // adopting a neighbour's frames. It starts blank on purpose: its narration is
  // moved out of a neighbour by the officer (which is what keeps the joined
  // script — and therefore the measured audio — byte-identical), and its frames
  // are bought only when the officer presses redraw.
  const insertSceneAfter = (index: number) =>
    setDrafts((prev) =>
      prev
        ? [...prev.slice(0, index + 1), blankDraft(), ...prev.slice(index + 1)]
        : prev,
    );

  const scriptPayload = (list: SceneDraft[]) =>
    list.map((draft) => ({
      ...(draft.sourceIndex !== undefined
        ? { sourceIndex: draft.sourceIndex }
        : {}),
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
      // Same rule, same reason: '' is how a removed reference picture reaches
      // the API, and omitting the field means "leave the stored one alone".
      referenceImagePath: draft.referenceImagePath,
    }));

  // Gate 2's save. Same route as gate 1 (it already accepts storyboard_ready)
  // but it does NOT start the storyboard job: the officer stays on this page
  // and buys frames per scene with the redraw button. Reseeds afterwards,
  // because an insert renumbers the stored scenes this page's sourceIndexes
  // point at.
  const saveStoryboardScript = () =>
    act(async () => {
      if (!drafts) return;
      const updated = await saveVideoScript(id, {
        scenes: scriptPayload(drafts),
      });
      setDrafts(draftsFrom(updated.scenes));
      // The ticks below the animate button are scene INDEXES, and a save may
      // have inserted, removed or reordered scenes — so they no longer name the
      // scenes they were put on. Dropped rather than remapped: an index that
      // silently moved would buy the wrong clip.
      setExtraScenes([]);
    });

  // Gate 1's re-plan. Sends the same split the save would, but the fields the
  // AI is about to overwrite are sent only so a FAILED call leaves the current
  // text on screen — a blank brief is expected here, which is why the route has
  // its own schema (the save route's requires one).
  const replanPayload = (list: SceneDraft[]) =>
    list.map((draft) => ({
      ...(draft.sourceIndex !== undefined
        ? { sourceIndex: draft.sourceIndex }
        : {}),
      narration: draft.narration,
      ...(draft.visualBrief.trim() !== ''
        ? { visualBrief: draft.visualBrief.trim() }
        : {}),
      ...(draft.endVisualBrief.trim() !== ''
        ? { endVisualBrief: draft.endVisualBrief.trim() }
        : {}),
      ...(draft.keyPoint.trim() !== ''
        ? { keyPoint: draft.keyPoint.trim() }
        : {}),
      // Sent unconditionally, unlike the fields above it: this one is not being
      // re-derived by the model, so '' has to mean "removed" here exactly as it
      // does on the save. Omitting it would restore a picture the officer had
      // just detached the moment they pressed "AI ने पुन्हा तयार करा".
      referenceImagePath: draft.referenceImagePath,
    }));

  // Persists the split and re-derives every pipeline-owned field on top of it,
  // in one synchronous call. Reseeds afterwards for the same reason the two
  // saves do — an insert renumbers the stored scenes the drafts point at — and
  // additionally because every card's description has just been replaced.
  const replanScript = () =>
    act(async () => {
      if (!drafts) return;
      const updated = await replanVideoScript(id, {
        scenes: replanPayload(drafts),
      });
      setDrafts(draftsFrom(updated.scenes));
      setStyleDraft(updated.style ?? '');
    });

  // Gate 1's save. Same route, and deliberately NOT followed by
  // startVideoStoryboard: an officer reworking a long script needs to bank the
  // edits without buying a frame for every scene, and until this existed the
  // only button that persisted anything was the one that spends. Reseeds for
  // the same reason gate 2's does — an insert renumbers the stored scenes the
  // drafts' sourceIndexes point at.
  const saveScriptDraft = () =>
    act(async () => {
      if (!drafts) return;
      const updated = await saveVideoScript(id, {
        ...(styleDraft.trim() !== '' ? { style: styleDraft.trim() } : {}),
        scenes: scriptPayload(drafts),
      });
      setDrafts(draftsFrom(updated.scenes));
      setStyleDraft(updated.style ?? '');
    });

  const submitScript = () =>
    act(async () => {
      if (!drafts) return;
      await saveVideoScript(id, {
        // Sent only when it says something: the schema rejects an empty style,
        // and omitting it leaves the stored paragraph alone.
        ...(styleDraft.trim() !== '' ? { style: styleDraft.trim() } : {}),
        scenes: scriptPayload(drafts),
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

  // Free and immediate: the scene drops its end frame and animates from the
  // start frame alone. The gate-2 draft is cleared alongside the row — the card
  // there renders the DRAFT's end brief over the stored scene, so leaving it
  // behind would both keep a phantom end frame on screen and put the deleted
  // brief straight back on the next "बदल जतन करा".
  // Free and instant: the scene's end frame becomes its own start frame, so the
  // shot holds on that composition. The gate-2 draft is patched alongside the
  // row for the same reason the delete does it — that card renders the DRAFT's
  // end brief over the stored scene, so an unpatched draft would put the old
  // (or empty) brief straight back on the next "बदल जतन करा".
  const useStartAsEndFrame = (index: number, cardIndex: number) =>
    act(async () => {
      await useStartFrameAsEndFrame(id, index);
      // The API sets the end brief to the STORED start brief (it is now the
      // description of the frame standing at the end), so the draft is given
      // the same string rather than the card's possibly-unsaved one — an
      // unpatched draft would overwrite it with the old text on the next save,
      // and a different string would report the card dirty for no edit.
      const stored = detail.scenes[index];
      patchDraft(cardIndex, {
        endVisualBrief:
          stored?.openingVisualBrief ?? stored?.visualBrief ?? '',
      });
    });

  const deleteEndFrame = (index: number, cardIndex: number) =>
    act(async () => {
      await deleteVideoSceneEndFrame(id, index);
      patchDraft(cardIndex, { endVisualBrief: '' });
    });

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
              key={draft.uid}
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
              // Editable on EVERY lane now, because moving words between scenes
              // is a re-split, not a rewrite: the joined script stays identical
              // and the API's word-identity guard passes. A genuine word change
              // on a ready-script project is still refused there, in Marathi.
              onNarrationChange={(value: string) =>
                patchDraft(index, { narration: value })
              }
              onBriefChange={(value) =>
                patchDraft(index, { visualBrief: value })
              }
              onEndBriefChange={(value) =>
                patchDraft(index, { endVisualBrief: value })
              }
              onKeyPointChange={(value) =>
                patchDraft(index, { keyPoint: value })
              }
              // Gate 1 ONLY. The handlers are not passed at gate 2 or on the
              // fix panel, which is what keeps the control off those cards —
              // there a frame has been bought, and the affordance for changing
              // it is the redraw fold, which spends.
              onReferenceImagePick={(file: File) =>
                void pickReferenceImage(index, file)
              }
              onReferenceImageRemove={() =>
                patchDraft(index, {
                  referenceImagePath: '',
                  referenceImageUrl: '',
                })
              }
              referenceImageUrl={draft.referenceImageUrl || undefined}
              referenceImageBusy={referenceBusyUid === draft.uid}
              referenceImageError={referenceErrors[draft.uid]}
              onInsertAfter={
                canAddScene ? () => insertSceneAfter(index) : undefined
              }
              // Offered on the ready-script lane too — see canRemoveScene.
              onRemove={
                canRemoveScene
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
              {canAddScene ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    setDrafts((prev) => (prev ? [...prev, blankDraft()] : prev))
                  }
                >
                  {STR.videoAddScene}
                </button>
              ) : null}
              {/* Re-derives every pipeline-owned field over the current split.
                  Unlike the two buttons beside it, neither a blank दृश्य-वर्णन
                  nor an over-long narration disables it — supplying the first is
                  what it is for, and the second is text it does not write. It is
                  always available (no `scriptDirty` gate): re-planning an
                  unchanged split is a legitimate "try again" on a description
                  the officer does not like, and it costs one text call. */}
              <button
                type="button"
                className="btn"
                disabled={busy || narrationIncomplete}
                onClick={replanScript}
              >
                {busy ? STR.submitting : STR.videoReplanScript}
              </button>
              {/* Persists the edits and stays here. Free — no frame is drawn,
                  which is the whole point of it sitting beside the button that
                  does draw them. */}
              <button
                type="button"
                className="btn"
                disabled={
                  busy || !scriptDirty || narrationTooLong || scriptIncomplete
                }
                onClick={saveScriptDraft}
              >
                {busy ? STR.submitting : STR.videoSaveStoryboardScript}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || narrationTooLong || scriptIncomplete}
                onClick={submitScript}
              >
                {busy ? STR.submitting : STR.videoToStoryboard}
              </button>
            </div>
            {scriptDirty ? (
              <p className="hint" style={{ marginTop: 8 }}>
                {STR.videoSaveScriptHint}
              </p>
            ) : null}
            {/* Always shown, because the button is always live — and because
                the one thing an officer needs to know before pressing it is
                what it will NOT touch. */}
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoReplanScriptHint}
            </p>
            {/* Only on the ready-script lane, and only when a remove is
                actually reachable: on the note lane a scene's words are the
                pipeline's own and may be dropped outright. */}
            {detail.inputMode === 'script' && canRemoveScene ? (
              <p className="hint" style={{ marginTop: 8 }}>
                {STR.videoRemoveSceneScriptHint}
              </p>
            ) : null}
            {/* The running narration total against the project's selected
                length. Advisory ONLY — it never blocks the submit, because the
                storyboard job measures the real audio and shortens whatever
                still overruns; a character estimate must not veto a script the
                voice might well fit. */}
            <p
              className={narrationOverBudget ? 'form-error' : 'hint'}
              style={{ marginTop: 8 }}
            >
              {/* With the officer's own recording the length is no longer an
                  estimate — it was MEASURED at create time, and the per-scene
                  shares of that WAV sum to it. Labelling it "अंदाज" would
                  understate what the pipeline actually knows. */}
              {/* Joined into ONE expression rather than left as two adjacent
                  text children — see the note in WorkingCard. */}
              {(narrationIsUploaded
                ? `${STR.videoNarrationAudioMeasured}: ${videoReadyScriptEstimate(
                    measuredNarrationSeconds,
                    detail.scenes.length,
                  )}`
                : detail.inputMode === 'script'
                  ? `${STR.videoScriptEstimateLabel}: ${videoReadyScriptEstimate(
                      totalNarrationSeconds,
                      drafts.length,
                    )}`
                  : videoNarrationTotal(
                      totalNarrationSeconds,
                      narrationTarget,
                    )) +
                (narrationOverBudget ? ` ${STR.videoNarrationTotalOver}` : '')}
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
          {(drafts ?? draftsFrom(detail.scenes)).map((draft, index) => {
            // The card shows the STORED scene's frames and timing, overlaid
            // with the edited narration. A card the officer just inserted has
            // no stored scene behind it, so it renders as pending with no
            // frames until the save lands and its redraw is pressed.
            const stored =
              draft.sourceIndex === undefined
                ? undefined
                : detail.scenes[draft.sourceIndex];
            return (
              <VideoSceneCard
                key={draft.uid}
                index={index}
                scene={{
                  ...(stored ?? {
                    durationSeconds: draft.durationSeconds,
                    status: 'pending' as const,
                  }),
                  narration: draft.narration,
                  visualBrief: draft.visualBrief,
                  endVisualBrief: draft.endVisualBrief,
                  keyPoint: draft.keyPoint,
                }}
                mode="review"
                busy={busy}
                onNarrationChange={(value) =>
                  patchDraft(index, { narration: value })
                }
                {...(stored
                  ? {
                      onRedraw: (brief: string) =>
                        void redrawStill(draft.sourceIndex!, brief),
                      onRedrawEnd: (endBrief: string) =>
                        void redrawEndStill(draft.sourceIndex!, endBrief),
                      onDeleteEndFrame: () =>
                        void deleteEndFrame(draft.sourceIndex!, index),
                      onUseStartAsEnd: () =>
                        void useStartAsEndFrame(draft.sourceIndex!, index),
                      onMotionBriefSave: (motionBrief: string) =>
                        void saveMotionBrief(draft.sourceIndex!, motionBrief),
                    }
                  : {})}
                {...(stored
                  ? {}
                  : {
                      // No stored scene to redraw yet, so the brief is edited
                      // in the card itself and travels with the save — without
                      // this an inserted scene had no way to state its prompt
                      // at all, and would be saved with an empty one.
                      onBriefChange: (value: string) =>
                        patchDraft(index, { visualBrief: value }),
                      onEndBriefChange: (value: string) =>
                        patchDraft(index, { endVisualBrief: value }),
                      redrawUnavailableHint: STR.videoInsertedSceneSaveFirst,
                    })}
                onInsertAfter={
                  canAddScene ? () => insertSceneAfter(index) : undefined
                }
              />
            );
          })}
          <section className="card">
            {/* Unsaved edits must be committed before the frames of a new scene
                can be bought — the redraw routes act on STORED scenes. */}
            <div className="btn-row" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  !storyboardDirty ||
                  narrationTooLong ||
                  // Same emptiness rules as gate 1's submit: the save route
                  // rejects a blank narration or brief, so an inserted scene
                  // must state both here rather than fail server-side.
                  scriptIncomplete
                }
                onClick={saveStoryboardScript}
              >
                {busy ? STR.submitting : STR.videoSaveStoryboardScript}
              </button>
              {/* Back to gate 1, where the briefs, key points and style
                  paragraph are editable. Gated on `storyboardDirty` like the
                  two spending buttons below, and for a plainer reason: the
                  status change reseeds the drafts from the stored scenes, so
                  an unsaved re-split would be discarded on the way. */}
              <button
                type="button"
                className="btn"
                disabled={busy || storyboardDirty}
                onClick={() => void act(() => reopenVideoScript(id))}
              >
                {busy ? STR.submitting : STR.videoBackToScript}
              </button>
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              {STR.videoBackToScriptHint}
            </p>
            {storyboardDirty ? (
              <p className="hint" style={{ marginBottom: 12 }}>
                {STR.videoSaveStoryboardScriptHint}
              </p>
            ) : null}
            {/* A scene added (or re-briefed) at this gate has no frames yet, and
                animate is blocked until every scene does. The storyboard job
                skips scenes whose frames are current and finds the measured
                narration current too, so this buys the missing frames ONLY. It
                waits for the save, like animate: the job renders the STORED
                scene list. */}
            {!allStillsReady ? (
              <>
                <div className="btn-row" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || storyboardDirty}
                    onClick={() => void act(() => startVideoStoryboard(id))}
                  >
                    {busy ? STR.submitting : STR.videoRenderMissingFrames}
                  </button>
                </div>
                <p className="hint" style={{ marginBottom: 12 }}>
                  {STR.videoRenderMissingFramesHint}
                </p>
              </>
            ) : null}
            <div className="btn-row">
              {animateArmed ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !allStillsReady || storyboardDirty}
                    onClick={() =>
                      void act(async () => {
                        setAnimateArmed(false);
                        await startVideoAnimation(id, extraSelected);
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
                  disabled={busy || !allStillsReady || storyboardDirty}
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
            {/* Which scenes this spend buys. Every scene the job is going to
                render is ticked and LOCKED: unticking one would rejoin a clip
                animated from a frame the officer has already replaced — old
                footage in a video they believe they just fixed — so the control
                only ever adds. On a first run every scene is required, so the
                rows are all locked and the hint says there is nothing to choose
                — they are still listed, because that column of ticks is what
                the officer is about to pay for. */}
            <div className="reshoot">
              <p className="reshoot-title">{STR.videoReshootTitle}</p>
              <p className="hint">
                {requiredScenes.length === detail.scenes.length
                  ? STR.videoReshootAll
                  : STR.videoReshootHint}
              </p>
              <ul className="reshoot-list">
                {detail.scenes.map((scene, index) => {
                  const required = requiredScenes.includes(index);
                  const checked = required || extraSelected.includes(index);
                  return (
                    <li
                      key={index}
                      className={`reshoot-row${required ? ' is-locked' : ''}`}
                    >
                      <label className="reshoot-row-head">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy || required}
                          onChange={(event) =>
                            setExtraScenes((current) =>
                              event.target.checked
                                ? [...current, index]
                                : current.filter((i) => i !== index),
                            )
                          }
                        />
                        <span className="reshoot-row-name">
                          {`${STR.videoSceneLabel} ${index + 1}`}
                        </span>
                        {/* The scene's own line, so the officer can tell which
                            one this is without counting cards above. */}
                        <span className="reshoot-row-beat">
                          {scene.beat ?? scene.narration}
                        </span>
                        <span className="reshoot-row-note">
                          {required
                            ? STR.videoReshootRequired
                            : checked
                              ? null
                              : STR.videoReshootKeeping}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">
                {STR.videoReshootSelected}:{' '}
                {requiredScenes.length + extraSelected.length} /{' '}
                {detail.scenes.length}
              </p>
            </div>
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
          // The fix panel maps card position to scene index directly (it walks
          // detail.scenes, not the drafts), so the two indexes are the same one.
          onDeleteEndFrame={(index) => void deleteEndFrame(index, index)}
          onUseStartAsEnd={(index) => void useStartAsEndFrame(index, index)}
          onSaveMotionBrief={(index, motionBrief) =>
            void saveMotionBrief(index, motionBrief)
          }
          onReanimateScene={(index) =>
            void act(() => reanimateVideoScene(id, index))
          }
          onNarrate={() => void act(() => narrateVideo(id))}
          onRestitch={() => void act(() => restitchVideo(id))}
          onBackToStoryboard={() =>
            void act(() => reopenVideoStoryboard(id).then(() => undefined))
          }
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
