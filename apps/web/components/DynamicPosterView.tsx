'use client';

// The finished Dynamic Poster, on the generation detail page.
//
// Shaped like the creative-output card (`poster-layout`: the result on the left, the controls
// on the right) so this format does not read as a different product — down to the same square
// row of icon actions under the result. What that row deliberately does NOT carry is the
// social poster's Canva handoff, marker feedback or publish button: Canva takes a layered
// still, marker feedback edits a PNG, and publishing needs a poster image. What it carries
// instead is the two downloads and the CROP.
//
// TWO WAYS TO CHANGE THE CLIP, and they are not the same kind of thing. The AI प्रॉम्प्ट box
// on the right continues the Gemini conversation — minutes, billed, and the model decides what
// the result looks like. The crop is local ffmpeg on the API box — seconds, free, exact, and
// repeatable as often as the officer likes. Both write a new version, so neither can destroy
// the clip already in hand.
//
// THE CLIP PLAYS FROM THE BUCKET, NOT THROUGH THE API. It is autoplaying, muted, looping and
// `playsInline` — the officer asked for something that keeps moving, and a muted autoplay is
// the only kind every browser allows. Downloads DO go through the API, because `download` on
// an anchor is ignored cross-origin.
//
// Versions are a VIEWER here, not a restore control. Each render is its own immutable object
// and the newest is always the current one; clicking an older version plays it, which is what
// makes a follow-up safe to try — nothing the officer already has can be lost by asking for a
// change. (A poster's strip restores, because a poster has a `posterPath` the rest of the
// product reads. Nothing downstream of this lane reads the clip, so there is nothing to point.)

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Crop,
  Download,
  FileImage,
  Maximize,
  Send,
  Wand2,
  X,
} from 'lucide-react';
import {
  MOTION_DIRECTION_MAX_CHARS,
  isWholeClipCrop,
  type GenerationDetail,
  type MotionCrop,
} from '@dgipr/schemas';
import {
  cropMotionVideo,
  motionGifDownloadUrl,
  motionVideoDownloadUrl,
  sendMotionFeedback,
} from '../lib/api';
import { errorMessage } from '../lib/errorMessage';
import { STR, formatDate } from '../lib/strings';
import { ErrorNotice } from './ErrorNotice';
import {
  centredRectForAspect,
  FULL_CROP,
  MotionCropBox,
} from './MotionCropBox';

// The frames a department actually publishes into, beside the free rectangle. Labelled in
// Devanagari numerals because every other ratio in this product is written that way
// (`motionAspectPortrait` is 'उभा ९:१६'), and a run of Latin digits in a Marathi row reads as
// a different product's control.
const RATIO_PRESETS = [
  { id: '4:5', label: '४:५', ratio: 4 / 5 },
  { id: '9:16', label: '९:१६', ratio: 9 / 16 },
] as const;
type RatioId = (typeof RATIO_PRESETS)[number]['id'];

export function DynamicPosterView({
  detail,
  onChanged,
  busy,
  onImageWorkStarted,
}: {
  detail: GenerationDetail;
  onChanged: () => Promise<void>;
  // A follow-up render is in flight: the row is `running` and the clip on screen is the
  // previous version, exactly as a poster re-render keeps the previous poster up.
  busy: boolean;
  onImageWorkStarted?: () => void;
}) {
  const versions = detail.motionVersions;
  // Which version is being WATCHED. Indexed from the end so a new render becomes the one on
  // screen without the officer choosing it — the same rule the poster card follows.
  const [selected, setSelected] = useState<number | null>(null);
  const [direction, setDirection] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The hand trim: armed or not, and the rectangle while it is. Held here rather than in the
  // overlay so the readout, the buttons and the box are all reading one value.
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState<MotionCrop>(FULL_CROP);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  // Which ratio preset armed the tool, if one did. Null is the free rectangle.
  const [lockedRatio, setLockedRatio] = useState<RatioId | null>(null);
  // The clip's REAL pixel dimensions, read off the element once it has metadata. A ratio in
  // fraction space is meaningless without them: 4:5 of a 9:16 frame and 4:5 of a 4:5 frame are
  // different rectangles, and the officer's displayed video is neither — the browser has scaled
  // it to the card.
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(
    null,
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // A finished follow-up — or a finished trim — must bring the officer back to the newest clip,
  // or they would sit watching the old one wondering whether anything happened. Disarming the
  // crop tool is part of that: a rectangle drawn over the previous clip means nothing on this
  // one, and leaving it up would invite them to apply it a second time.
  useEffect(() => {
    setSelected(null);
    setCropping(false);
    setCrop(FULL_CROP);
    setLockedRatio(null);
    setCropError(null);
  }, [detail.motionUrl]);

  const current =
    selected !== null && versions[selected]
      ? versions[selected]
      : (versions[versions.length - 1] ?? null);
  const videoUrl = current?.videoUrl ?? detail.motionUrl;
  const gifUrl = current?.gifUrl ?? detail.motionGifUrl;
  // Downloads name the ROW's current objects, so they are only offered while the newest
  // version is the one on screen — an older clip is playable but is not what this run is.
  const viewingLatest = selected === null || selected === versions.length - 1;

  // A new render or a version switch replaces the element (`key={videoUrl}`), so its real
  // dimensions have to be read again — a trimmed clip is not the size the one before it was,
  // and a ratio computed from the previous size would arm the wrong rectangle.
  useEffect(() => setFrame(null), [videoUrl]);

  // A preset's rectangle, in the fractions MotionCropBox and the API speak: the asked-for pixel
  // ratio divided by the clip's own IS that ratio as a share of this frame. Null until the
  // dimensions are known, which is what keeps the pills inert for the moment before metadata.
  const rectForRatio = (ratio: number): MotionCrop | null =>
    frame && frame.width > 0 && frame.height > 0
      ? centredRectForAspect(ratio / (frame.width / frame.height))
      : null;

  const activePreset =
    RATIO_PRESETS.find((preset) => preset.id === lockedRatio) ?? null;
  const lockedAspect =
    activePreset && frame && frame.width > 0 && frame.height > 0
      ? activePreset.ratio / (frame.width / frame.height)
      : null;

  const send = async () => {
    const text = direction.trim();
    if (text === '' || sending || busy) return;
    setSending(true);
    setError(null);
    try {
      await sendMotionFeedback(detail.id, text);
      setDirection('');
      onImageWorkStarted?.();
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  // A selection that keeps the whole clip is not a crop: the API refuses it, and so does the
  // button, so the refusal is read as a rule rather than met as a failure.
  const wholeClipSelected = isWholeClipCrop(crop);

  const applyCrop = async () => {
    if (applyingCrop || busy || wholeClipSelected) return;
    setApplyingCrop(true);
    setCropError(null);
    try {
      await cropMotionVideo(detail.id, crop);
      // The row is now running; the poll picks up the new version and the effect above brings
      // the officer to it and puts the tool away. `onImageWorkStarted` is what makes the tasks
      // panel show this run as busy, exactly as a follow-up render does.
      onImageWorkStarted?.();
      await onChanged();
    } catch (e) {
      setCropError(errorMessage(e));
    } finally {
      setApplyingCrop(false);
    }
  };

  const cropDisabled = !videoUrl || !viewingLatest || busy || applyingCrop;
  // The free rectangle and each preset arm the same tool, so exactly one of the controls in
  // that row reads as pressed at a time.
  const freeCropArmed = cropping && lockedRatio === null;

  return (
    <section className="card">
      <h2>{STR.motionOutputTitle}</h2>
      <div className="poster-layout">
        <div>
          <div className="poster-frame">
            {videoUrl ? (
              <video
                key={videoUrl}
                ref={videoRef}
                className="motion-video"
                src={videoUrl}
                // The clip's own pixel size, which is the only thing a ratio can be computed
                // against. Read here rather than assumed from `motionAspect`: a clip that has
                // already been trimmed once carries neither the poster's shape nor the row's.
                onLoadedMetadata={(event) =>
                  setFrame({
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight,
                  })
                }
                autoPlay
                loop
                muted
                playsInline
                // The native controls are given up while the crop tool is armed: they sit
                // across the bottom of the very surface the officer is dragging on, and a
                // scrub bar under a crop handle is a fight neither control wins. The clip
                // loops on its own, so nothing is lost for the seconds this takes.
                controls={!cropping}
              />
            ) : null}
            {cropping && videoUrl ? (
              <MotionCropBox
                value={crop}
                onChange={setCrop}
                aspect={lockedAspect}
                disabled={applyingCrop || busy}
              />
            ) : null}
            {busy ? (
              <div
                className="poster-loading"
                aria-live="polite"
                aria-busy="true"
              >
                <span className="spinner spinner-lg" />
              </div>
            ) : null}
          </div>

          {/* The same square, label-free row the social poster carries, so the two formats
              read as one product. Every control states itself on title + aria-label — the
              meaning is never left to the icon alone. */}
          <div className="poster-icon-actions">
            <a
              className="icon-btn"
              href={motionVideoDownloadUrl(detail.id)}
              title={STR.motionDownloadVideo}
              aria-label={STR.motionDownloadVideo}
              aria-disabled={!viewingLatest}
            >
              <Download size={18} strokeWidth={1.9} aria-hidden="true" />
            </a>
            {gifUrl ? (
              // A second Download glyph beside the first would say nothing about which file
              // it fetches, so the GIF takes the image mark and the label carries the rest.
              <a
                className="icon-btn"
                href={motionGifDownloadUrl(detail.id)}
                title={STR.motionDownloadGif}
                aria-label={STR.motionDownloadGif}
                aria-disabled={!viewingLatest}
              >
                <FileImage size={18} strokeWidth={1.9} aria-hidden="true" />
              </a>
            ) : null}
            {/* The hand trim. Pressed state = the box is on the clip, so the video reads as
                editable — the poster card's marking toggle, in the same place. */}
            <button
              type="button"
              className="icon-btn"
              aria-pressed={freeCropArmed}
              title={
                freeCropArmed ? STR.motionCropStartOn : STR.motionCropStart
              }
              aria-label={
                freeCropArmed ? STR.motionCropStartOn : STR.motionCropStart
              }
              disabled={cropDisabled}
              onClick={() => {
                setCropError(null);
                // Pressed while a RATIO is armed this swaps to the free rectangle rather than
                // putting the tool away: two controls arm one mode, and the one just pressed
                // should be the one that wins.
                if (freeCropArmed) {
                  setCropping(false);
                  return;
                }
                setCrop(FULL_CROP);
                setLockedRatio(null);
                setCropping(true);
              }}
            >
              <Crop size={18} strokeWidth={1.9} aria-hidden="true" />
            </button>
            {/* The ratio presets. An exact 4:5 cannot be reached by dragging four edges, and
                that is what this tool is mostly used for — so these arm it with the shape
                already right and leave only the placing to be done. A preset whose rectangle
                would be the whole clip is offered disabled with the reason on it, rather than
                accepting the press and refusing the apply. */}
            {RATIO_PRESETS.map((preset) => {
              const rect = rectForRatio(preset.ratio);
              const sameShape = rect !== null && isWholeClipCrop(rect);
              const armed = cropping && lockedRatio === preset.id;
              const label = sameShape
                ? STR.motionCropRatioSame(preset.label)
                : armed
                  ? STR.motionCropRatioOn(preset.label)
                  : STR.motionCropRatio(preset.label);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="icon-btn motion-ratio-btn"
                  aria-pressed={armed}
                  title={label}
                  aria-label={label}
                  disabled={cropDisabled || rect === null || sameShape}
                  onClick={() => {
                    if (!rect) return;
                    setCropError(null);
                    if (armed) {
                      setCropping(false);
                      setLockedRatio(null);
                      setCrop(FULL_CROP);
                      return;
                    }
                    setCrop(rect);
                    setLockedRatio(preset.id);
                    setCropping(true);
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {!gifUrl ? (
            // Stated rather than left blank: the GIF conversion is best-effort so that a
            // failure never costs the paid clip, and a missing button with no explanation
            // reads as the page being broken.
            <p className="hint">{STR.motionGifUnavailable}</p>
          ) : null}

          {cropping ? (
            <div className="motion-crop-panel">
              <p className="field-label">{STR.motionCropLabel}</p>
              <p className="hint">{STR.motionCropHint}</p>
              {/* Under a lock, what the officer may and may not change is not visible from the
                  box alone — the edge grips are simply absent — so it is said. */}
              {activePreset ? (
                <p className="hint">
                  {STR.motionCropRatioLocked(activePreset.label)}
                </p>
              ) : null}
              <p className="hint motion-crop-size">
                {STR.motionCropSize(
                  Math.round(crop.width * 100),
                  Math.round(crop.height * 100),
                )}
              </p>
              <div className="btn-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => void applyCrop()}
                  disabled={applyingCrop || busy || wholeClipSelected}
                >
                  {applyingCrop ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <Check size={16} aria-hidden="true" />
                  )}{' '}
                  {STR.motionCropApply}
                </button>
                {/* Reset means "as much as I can have", which under a lock is the largest
                    rectangle of that shape rather than the whole clip — resetting to the whole
                    clip would put a box on screen that is not the ratio the officer chose. */}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() =>
                    setCrop(
                      lockedAspect
                        ? centredRectForAspect(lockedAspect)
                        : FULL_CROP,
                    )
                  }
                  disabled={
                    applyingCrop || (lockedAspect === null && wholeClipSelected)
                  }
                >
                  <Maximize size={16} aria-hidden="true" />{' '}
                  {lockedAspect
                    ? STR.motionCropResetRatio
                    : STR.motionCropReset}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setCropping(false)}
                  disabled={applyingCrop}
                >
                  <X size={16} aria-hidden="true" /> {STR.motionCropCancel}
                </button>
              </div>
              {/* Said before the button is pressed rather than after: the API refuses a
                  whole-clip selection, and meeting that as an error would be worse than
                  reading it as a rule. */}
              {wholeClipSelected ? (
                <p className="hint">{STR.motionCropWholeClip}</p>
              ) : null}
              {applyingCrop || (busy && cropping) ? (
                <p className="hint" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />{' '}
                  {STR.motionCropBusy}
                </p>
              ) : null}
              {cropError ? <ErrorNotice message={cropError} /> : null}
            </div>
          ) : null}

          {/* Only once there is something to move between. */}
          {versions.length > 1 ? (
            <div className="motion-versions">
              <p className="field-label">{STR.motionVersionsLabel}</p>
              <div className="motion-version-row">
                {versions.map((version, index) => {
                  const active =
                    (selected === null ? versions.length - 1 : selected) ===
                    index;
                  return (
                    <button
                      key={version.videoUrl}
                      type="button"
                      className={`motion-version${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        setSelected(index);
                        // The trim always cuts the run's CURRENT clip, so a box drawn while
                        // an older version is on screen would cut something else. Put the
                        // tool away rather than let the two disagree — the ratio with it,
                        // since a preset is a rectangle measured against a frame that is
                        // about to be replaced.
                        setCropping(false);
                        setLockedRatio(null);
                      }}
                      title={version.direction ?? STR.motionVersionInitial}
                    >
                      <span className="motion-version-n">{index + 1}</span>
                      <span className="motion-version-when">
                        {formatDate(version.createdAt)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {current?.direction ? (
                <p className="hint">{current.direction}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          {/* The one control on this card. It continues the SAME Gemini conversation, so a
              change is an edit of the clip on screen rather than a fresh render from the
              poster — which is why the hint promises the previous version survives. */}
          <label className="field-label" htmlFor="motion-feedback">
            <Wand2 size={18} className="label-icon" aria-hidden="true" />
            {STR.motionFeedbackLabel}
          </label>
          <p className="hint">{STR.motionFeedbackHint}</p>
          <div className="note-field">
            <textarea
              id="motion-feedback"
              className="note-input"
              maxLength={MOTION_DIRECTION_MAX_CHARS}
              placeholder={STR.motionFeedbackPlaceholder}
              value={direction}
              disabled={sending || busy}
              onChange={(event) => setDirection(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary note-send"
              onClick={() => void send()}
              disabled={sending || busy || direction.trim() === ''}
              title={STR.motionFeedbackSend}
              aria-label={STR.motionFeedbackSend}
            >
              {sending ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Send size={20} aria-hidden="true" />
              )}
            </button>
          </div>
          {busy ? (
            <p className="hint" aria-live="polite">
              <span className="spinner" aria-hidden="true" />{' '}
              {STR.motionFeedbackBusy}
            </p>
          ) : null}
          {error ? <ErrorNotice message={error} /> : null}

          {/* The poster this run started from, and the prompt that was written out of it.
              Both are here because they are the two things an officer checks when a clip is
              not what they expected — was the right file used, and was it asked for the right
              thing. The prompt is folded: it is long, and it is a diagnostic. */}
          {detail.sourceImageUrl ? (
            <div className="motion-source-ref">
              <p className="field-label">{STR.motionSourceCaption}</p>
              {/* A plain <img> for the reason MotionSourcePicker uses one. */}
              <img
                className="motion-source-thumb"
                src={detail.sourceImageUrl}
                alt={STR.motionSourceCaption}
              />
            </div>
          ) : null}
          {detail.motionPrompt ? (
            <details className="motion-prompt-fold">
              <summary>{STR.motionPromptLabel}</summary>
              <p className="hint">{detail.motionPrompt}</p>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
