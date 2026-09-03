'use client';

// The finished Dynamic Poster, on the generation detail page.
//
// Shaped like the creative-output card (`poster-layout`: the result on the left, the controls
// on the right) so this format does not read as a different product. What it deliberately does
// NOT carry is the row of icon actions that card has — no Canva handoff, no marker editing, no
// publish. None of the three mean anything here: Canva takes a layered still, marker feedback
// edits a PNG, and publishing needs a poster image. The one control on the right is the AI
// प्रॉम्प्ट box, which continues the same Gemini conversation.
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

import { useEffect, useState } from 'react';
import { Download, Send, Wand2 } from 'lucide-react';
import {
  MOTION_DIRECTION_MAX_CHARS,
  type GenerationDetail,
} from '@dgipr/schemas';
import {
  motionGifDownloadUrl,
  motionVideoDownloadUrl,
  sendMotionFeedback,
} from '../lib/api';
import { errorMessage } from '../lib/errorMessage';
import { STR, formatDate } from '../lib/strings';
import { ErrorNotice } from './ErrorNotice';

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

  // A finished follow-up must bring the officer back to the newest clip, or they would sit
  // watching the old one wondering whether anything happened.
  useEffect(() => {
    setSelected(null);
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

  return (
    <section className="card">
      <h2>{STR.motionOutputTitle}</h2>
      <div className="poster-layout">
        <div>
          <div className="poster-frame">
            {videoUrl ? (
              <video
                key={videoUrl}
                className="motion-video"
                src={videoUrl}
                autoPlay
                loop
                muted
                playsInline
                controls
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

          <div className="btn-row" style={{ gap: 10, marginTop: 12 }}>
            <a
              className="btn btn-small"
              href={motionVideoDownloadUrl(detail.id)}
              aria-disabled={!viewingLatest}
            >
              <Download size={16} aria-hidden="true" />{' '}
              {STR.motionDownloadVideo}
            </a>
            {gifUrl ? (
              <a
                className="btn btn-small"
                href={motionGifDownloadUrl(detail.id)}
                aria-disabled={!viewingLatest}
              >
                <Download size={16} aria-hidden="true" />{' '}
                {STR.motionDownloadGif}
              </a>
            ) : (
              // Stated rather than left blank: the GIF conversion is best-effort so that a
              // failure never costs the paid clip, and a missing button with no explanation
              // reads as the page being broken.
              <span className="hint">{STR.motionGifUnavailable}</span>
            )}
          </div>

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
                      onClick={() => setSelected(index)}
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
