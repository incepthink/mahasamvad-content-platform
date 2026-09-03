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
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import type { VideoScene } from '@dgipr/schemas';
import { ErrorNotice } from './ErrorNotice';
import { InlineEditableField } from './InlineEditableField';
import { storedErrorMessage } from '../lib/errorMessage';
import {
  IMAGE_FILE_ACCEPT,
  VIDEO_KEY_POINT_MAX_CHARS,
  VIDEO_NARRATION_MAX_CHARS,
} from '@dgipr/schemas';
import {
  STR,
  videoMotionBriefLength,
  videoNarrationTooLong,
  videoSceneTiming,
} from '../lib/strings';

function SceneStatusChip({ scene }: { scene: VideoScene }) {
  if (scene.status === 'still-rendering' || scene.status === 'animating') {
    return (
      // The label is wrapped rather than left as a bare text node beside the
      // spinner element: a text node with an element sibling is the other shape
      // the translator reparents, and React must be able to remove it.
      <span className="translating-note">
        <span className="spinner" aria-hidden="true" />
        <span>
          {scene.status === 'animating'
            ? VIDEO_SCENE_STATUS_LABELS.animating
            : VIDEO_SCENE_STATUS_LABELS['still-rendering']}
        </span>
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
  onDeleteEndFrame,
  onUseStartAsEnd,
  onMotionBriefSave,
  onReanimate,
  onInsertAfter,
  onReferenceImagePick,
  onReferenceImageRemove,
  referenceImageUrl,
  referenceImageBusy,
  referenceImageError,
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
  // Drops the end frame: the scene keeps its start frame and animates from that
  // alone. Free — no frame is drawn — so it sits beside the redraw button
  // rather than behind the spend confirmations.
  onDeleteEndFrame?: (() => void) | undefined;
  // Makes this scene's END frame its own START frame. Free and instant — no
  // image is generated, so it sits inside the end-frame fold beside the render
  // button rather than behind a spend confirmation. Offered only once a start
  // frame exists, since it is the picture being reused.
  onUseStartAsEnd?: (() => void) | undefined;
  // Saves the scene's motion direction. Free — it feeds the CLIP prompt only,
  // so no frame is discarded and the edit lands on the next animation.
  onMotionBriefSave?: ((motionBrief: string) => void) | undefined;
  onReanimate?: (() => void) | undefined;
  // Inserts a blank scene directly after this one. Its narration is moved out
  // of a neighbour by the officer, never invented and never left empty.
  onInsertAfter?: (() => void) | undefined;
  // gate 1 (mode 'edit') ONLY — the officer's own reference picture for this
  // scene's start frame. The card never uploads: it hands the picked File up,
  // because the upload is project-scoped (a card may be one just inserted, with
  // no stored scene to address) and the page owns the project id. Rendered only
  // when onReferenceImagePick is supplied, which is what keeps the control off
  // gate 2 and off the post-render fix panel.
  onReferenceImagePick?: ((file: File) => void) | undefined;
  onReferenceImageRemove?: (() => void) | undefined;
  referenceImageUrl?: string | undefined;
  referenceImageBusy?: boolean | undefined;
  referenceImageError?: string | undefined;
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
  // The file input is hidden and driven by a button, so the control matches
  // every other affordance on this card instead of the browser's default chrome.
  // Its value is cleared after each pick, or re-choosing the SAME file fires no
  // change event and the officer sees nothing happen.
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  // Two-step confirm for dropping the end frame. It costs nothing and a new one
  // can be drawn afterwards, but it discards a frame the officer has already
  // reviewed and it sits next to the redraw button — so a misclick must not
  // take it.
  const [deleteEndArmed, setDeleteEndArmed] = useState(false);
  // Two-step confirm for dropping the whole scene. At gate 2 the scene may
  // already own paid frames and a clip, so a misclick here is expensive —
  // unlike gate 1, where a scene is still only text.
  const [removeArmed, setRemoveArmed] = useState(false);
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
  // An EMPTY end brief is not an end frame: gate 2 overlays the draft, which
  // carries '' for a scene that has none, so testing `!== undefined` showed a
  // permanently-pending end-frame panel on legacy scenes and on any scene whose
  // end frame was just deleted.
  const hasEndFrame =
    storedEndBrief.trim() !== '' || scene.endStillUrl !== undefined;
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
              className="video-icon-action video-icon-action-danger"
              onClick={onRemove}
              disabled={busy}
              aria-label={STR.videoRemoveScene}
              title={STR.videoRemoveScene}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {/* Every text-bearing element on this card holds exactly ONE text child,
            interpolated rather than left as `{label}: {value}`. Adjacent text
            nodes are merged into a single <font> by the browser's translator,
            which detaches the nodes React is holding — the next removal then
            throws "removeChild … not a child of this node". Removing a whole
            ELEMENT stays safe, because element nodes are not reparented. */}
        {/* The storyboard's own title for this scene ("Opening — Newborn
            daughter"), directly under "दृश्य N" — the card reads as a
            storyboard row rather than as a form with a stray label above it.
            Scenes planned before the label existed simply do not show one. */}
        {scene.sceneLabel ? (
          <p className="scene-label">{scene.sceneLabel}</p>
        ) : null}
        {scene.beat ? (
          <p className="hint">{`${STR.videoSceneBeatLabel}: ${scene.beat}`}</p>
        ) : null}
        <InlineEditableField
          id={`scene-narration-${index}`}
          label={
            onNarrationChange
              ? STR.videoNarrationLabel
              : STR.videoNarrationVerbatimLabel
          }
          value={scene.narration}
          disabled={busy}
          onChange={onNarrationChange}
        />
        {scene.narration.trim().length > VIDEO_NARRATION_MAX_CHARS ? (
          <p className="form-error">
            {videoNarrationTooLong(
              scene.narration.trim().length,
              VIDEO_NARRATION_MAX_CHARS,
            )}
          </p>
        ) : null}
        <InlineEditableField
          id={`scene-key-point-${index}`}
          label={STR.videoKeyPointLabel}
          value={scene.keyPoint ?? ''}
          kind="text"
          maxLength={VIDEO_KEY_POINT_MAX_CHARS}
          disabled={busy}
          onChange={onKeyPointChange}
        />
        <InlineEditableField
          id={`scene-brief-${index}`}
          label={STR.videoStoryboardFrameLabel}
          value={scene.visualBrief}
          disabled={busy}
          onChange={onBriefChange}
        />
        {scene.endVisualBrief?.trim() && onEndBriefChange ? (
          <InlineEditableField
            id={`scene-end-brief-${index}`}
            label={STR.videoEndBriefLabel}
            value={scene.endVisualBrief}
            disabled={busy}
            onChange={onEndBriefChange}
          />
        ) : null}
        {/* The officer's own reference picture — gate 1 only, and only when the
            page supplies the handler. It sits directly under the two briefs
            because it is read TOGETHER with them: the picture does its work by
            being named in the दृश्य-वर्णन above. */}
        {onReferenceImagePick ? (
          <>
            <input
              ref={referenceInputRef}
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onReferenceImagePick(file);
              }}
            />
            {referenceImageUrl ? (
              <img
                src={referenceImageUrl}
                alt={STR.videoReferenceImageAlt}
                style={{
                  display: 'block',
                  marginTop: 8,
                  width: '100%',
                  maxWidth: 240,
                  borderRadius: 8,
                }}
              />
            ) : null}
            <div className="btn-row video-scene-actions">
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || referenceImageBusy}
                onClick={() => referenceInputRef.current?.click()}
              >
                <ImageIcon size={17} aria-hidden="true" />
                {referenceImageBusy
                  ? STR.videoReferenceImageUploading
                  : referenceImageUrl
                    ? STR.videoReferenceImageReplace
                    : STR.videoReferenceImageAdd}
              </button>
              {referenceImageUrl && onReferenceImageRemove ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy || referenceImageBusy}
                  onClick={onReferenceImageRemove}
                >
                  {STR.videoReferenceImageRemove}
                </button>
              ) : null}
              {onInsertAfter ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={onInsertAfter}
                >
                  {STR.videoInsertSceneAfter}
                </button>
              ) : null}
            </div>
            {referenceImageUrl ? (
              <p className="hint" style={{ marginTop: 6 }}>
                {STR.videoReferenceImageSaveHint}
              </p>
            ) : null}
            {referenceImageError ? (
              <ErrorNotice message={referenceImageError} />
            ) : null}
          </>
        ) : null}
        {!onReferenceImagePick && onInsertAfter ? (
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
      {scene.sceneLabel ? (
        <p className="scene-label">{scene.sceneLabel}</p>
      ) : null}
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
        <p className="hint">{`${STR.videoKeyPointReviewLabel}: ${scene.keyPoint}`}</p>
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
      {scene.error ? (
        <ErrorNotice
          message={storedErrorMessage(scene.error, STR.videoSceneFailed)}
        />
      ) : null}

      {/* Every button here is guarded on the handler that makes it work: a card
          with no stored scene behind it (a just-inserted one) gets the hint
          instead, because its redraw could only close the fold silently. */}
      {onRedraw && needsFirstFrames ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {STR.videoSceneNeedsFrames}
        </p>
      ) : null}
      {onRedraw || onRedrawEnd || onReanimate ? (
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
          {/* Offered with no end frame too — that is the way back after one is
              deleted, and the same route renders it either way. */}
          {onRedrawEnd ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                setDeleteEndArmed(false);
                setBriefOpen((open) => (open === 'end' ? null : 'end'));
              }}
            >
              {hasEndFrame ? STR.videoEditEndBrief : STR.videoAddEndFrame}
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
                : hasEndFrame
                  ? STR.videoRedrawEndStill
                  : STR.videoRenderEndStill}
            </button>
            {/* The free answer to the same question, and the reason it sits
                beside the render button rather than under it: the officer often
                does not want a DIFFERENT ending, they want no change at all.
                Offered with or without an existing end frame — with one it
                replaces it, without one it is how an end frame is added for
                nothing. Hidden while the delete confirm is armed, so that pair
                of buttons stands alone. */}
            {briefOpen === 'end' &&
            onUseStartAsEnd &&
            scene.stillUrl !== undefined &&
            !deleteEndArmed ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => {
                  setBriefOpen(null);
                  onUseStartAsEnd();
                }}
              >
                {STR.videoUseStartAsEnd}
              </button>
            ) : null}
            {/* Beside the redraw, because this is the other answer to the same
                question: the officer is looking at an end frame they do not
                want. Free, so it is not held behind the spend confirmations —
                but two-step, so it is not taken by a misclick. */}
            {briefOpen === 'end' && hasEndFrame && onDeleteEndFrame ? (
              deleteEndArmed ? (
                <>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={busy}
                    onClick={() => {
                      setDeleteEndArmed(false);
                      setBriefOpen(null);
                      onDeleteEndFrame();
                    }}
                  >
                    {STR.videoDeleteEndStillConfirm}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => setDeleteEndArmed(false)}
                  >
                    {STR.videoAnimateCancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setDeleteEndArmed(true)}
                >
                  {STR.videoDeleteEndStill}
                </button>
              )
            ) : null}
          </div>
          {briefOpen === 'end' &&
          onUseStartAsEnd &&
          scene.stillUrl !== undefined ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoUseStartAsEndHint}
            </p>
          ) : null}
          {briefOpen === 'end' && hasEndFrame && onDeleteEndFrame ? (
            <p className="hint" style={{ marginTop: 8 }}>
              {STR.videoDeleteEndStillHint}
            </p>
          ) : null}
        </>
      ) : null}

      {/* Insert a scene AFTER this one. Only "after" is offered and that is not
          a gap: a new scene must carry words moved out of a neighbour, so
          inserting before scene 1 and taking its opening words is the same
          result as inserting after scene 1 and taking its closing ones. */}
      {onInsertAfter || onRemove ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          {onInsertAfter ? (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={onInsertAfter}
            >
              {STR.videoInsertSceneAfter}
            </button>
          ) : null}
          {/* Beside the insert, because the two are the same question about
              this scene's place in the split. Two-step, unlike gate 1's remove:
              here the scene may already carry frames and a clip that were paid
              for. The removal itself only edits the draft list — it reaches the
              stored scenes on the save below. */}
          {onRemove ? (
            removeArmed ? (
              <>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  disabled={busy}
                  onClick={() => {
                    setRemoveArmed(false);
                    onRemove();
                  }}
                >
                  {STR.videoRemoveSceneConfirm}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setRemoveArmed(false)}
                >
                  {STR.videoAnimateCancel}
                </button>
              </>
              ) : (
                <button
                  type="button"
                  className="video-icon-action video-icon-action-danger"
                  disabled={busy}
                  onClick={() => setRemoveArmed(true)}
                  aria-label={STR.videoRemoveScene}
                  title={STR.videoRemoveScene}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
