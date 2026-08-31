'use client';

// The YouTube source panel, shared by /dlo's intake form, /transcribe and /chat — one
// implementation rather than three lookalikes that drift apart. Paste a link, see which video
// it is, submit it as a source.
//
// On both create surfaces it renders `embedded`, INSIDE the composer, opened by that
// composer's link tool: a recording and a link are answers to one question ("what am I
// transcribing?") even though one is a file dialog and the other a pasted URL, and a card of
// its own read as a second, separate form. It kept its `card` wrapper for a caller that has
// no composer to sit in.
//
// Three decisions worth keeping:
//
// - THE LINK IS VALIDATED LOCALLY BEFORE THE NETWORK. `parseYouTubeVideoId` is the same
//   function the API re-runs on submit, so "that isn't a YouTube link" is answered instantly
//   and identically on both sides. A paste that fails never reaches the probe.
//
// - THERE IS NO "ADD" BUTTON: a pasted link probes itself. That local validation is exactly
//   what makes this safe — the probe fires only once a value parses as a YouTube video, so
//   half-typed text never reaches the network. A paste goes immediately; typed text waits out
//   a short debounce, since a hand-typed watch URL can parse as complete several characters
//   before it is. Each value is attempted ONCE (`attempted`), so a failed probe shows its
//   error and stops rather than retrying on every re-render.
//
// - A FAILED PROBE STILL ADDS THE VIDEO. The probe is a nicety: it turns a URL into a title
//   and a thumbnail so the officer can confirm they pasted the right thing. A private,
//   unlisted or region-blocked video has no oEmbed record while remaining perfectly
//   transcribable, so a probe failure degrades to a bare link chip rather than refusing the
//   source. The route is built to answer 200 in exactly that case.
//
// - THERE IS NO DURATION AND NO COST ESTIMATE, deliberately. oEmbed does not return one, and
//   getting it would mean provisioning a YouTube Data API key. The card's question is "is
//   this the video I meant?", which a title and a thumbnail answer.

import { useEffect, useRef, useState } from 'react';
// CirclePlay, not a YouTube brand mark: lucide 1.x carries no brand icons at all, and a
// play glyph says "video" perfectly well beside a card already titled यूट्युब व्हिडिओ.
import { CirclePlay, Link2, X } from 'lucide-react';
import {
  MAX_YOUTUBE_LINKS,
  parseYouTubeVideoId,
  type YouTubeVideo,
} from '@dgipr/schemas';
import { probeYouTubeVideo } from '../lib/api';
import { CardTitle } from './CardTitle';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';

// TEMPORARILY TURNED OFF EVERYWHERE (UI only). The card still renders — an officer who has
// used it should see that the capability exists and is unavailable, not find it silently
// missing — but it is inert and dimmed. This is deliberately a module constant rather than a
// prop passed at each call site: three surfaces render this card (/dlo, /transcribe, /chat)
// and a per-caller flag is the kind that gets missed on the fourth. Nothing on the server
// changed; flip this back to `false` to restore it.
//
// Exported so a surface that only offers a BUTTON opening this card (/dlo's composer) can
// dim the button too, instead of presenting a live-looking tool that opens an inert panel.
export const YOUTUBE_INPUT_OFF = true;

export function YouTubeLinkInput({
  videos,
  onChange,
  onError,
  disabled = false,
  maxLinks = MAX_YOUTUBE_LINKS,
  embedded = false,
}: {
  videos: readonly YouTubeVideo[];
  // Called with the whole next list, so the caller keeps ownership of what it will submit —
  // this component only decides which links are allowed to join them (the contract every
  // source picker on both create surfaces follows).
  onChange: (videos: YouTubeVideo[]) => void;
  // Rejections go to the caller so they appear beside the submit button with every other
  // reason a run cannot start. Local, transient problems are shown in the card instead.
  onError: (message: string | null) => void;
  disabled?: boolean | undefined;
  maxLinks?: number | undefined;
  // Renders as a plain block inside the caller's own card instead of as a card of its own —
  // the <DocumentIntake embedded> contract, and for the same reason: on /dlo this panel is
  // opened by a tool button inside the composer, and a nested card there reads as a second,
  // separate form. Only the wrapper and the heading level change.
  embedded?: boolean | undefined;
}) {
  const [url, setUrl] = useState('');
  const [probing, setProbing] = useState(false);
  // Shown under the field rather than passed to onError: it is about the text still sitting
  // in this input, so it belongs next to it.
  const [fieldError, setFieldError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The value the last probe was started for. Without it a probe that fails would be retried
  // by the effect below on the next render, hammering the route with the same bad link.
  const attempted = useRef<string | null>(null);

  const atLimit = videos.length >= maxLinks;
  // Every guard below reads this, never the prop: the kill switch has to win over a caller
  // that passes `disabled={false}`.
  const off = disabled || YOUTUBE_INPUT_OFF;

  const add = async (raw: string) => {
    const trimmed = raw.trim();
    // `disabled` is checked here, not only on the input: the field can be disabled by the
    // parent while a debounce started before it is still pending.
    if (trimmed === '' || probing || atLimit || off) return;

    const videoId = parseYouTubeVideoId(trimmed);
    if (videoId === null) {
      setFieldError(STR.ytInvalid);
      return;
    }
    // The id, not the pasted string: the same video arrives as youtu.be/ID, as a watch URL
    // with tracking parameters and as a /shorts/ link, and all three are one source.
    if (videos.some((video) => video.videoId === videoId)) {
      attempted.current = trimmed;
      setFieldError(STR.ytDuplicate);
      return;
    }

    attempted.current = trimmed;
    setFieldError(null);
    setProbing(true);
    try {
      const video = await probeYouTubeVideo(trimmed);
      onChange([...videos, video]);
      setUrl('');
      attempted.current = null;
      onError(null);
      // Straight on to the next paste — an officer adding a link is usually adding several.
      input.current?.focus();
    } catch (error) {
      setFieldError(errorMessage(error));
    } finally {
      setProbing(false);
    }
  };

  // Held in a ref so the debounce effect below can depend on the VALUE alone. `add` closes over
  // `videos`/`onChange`, both of which change identity on a parent render, so putting it in the
  // dependency list would restart the timer on every render and could postpone the probe
  // indefinitely.
  const addRef = useRef(add);
  addRef.current = add;

  // A link that parses probes itself — this is what replaces the old लिंक जोडा button.
  // Debounced rather than immediate because a hand-typed watch URL can parse as a complete
  // video id while more characters are still coming; a paste skips the wait (onPaste below).
  useEffect(() => {
    const trimmed = url.trim();
    if (trimmed === '' || probing || atLimit || off) return;
    if (attempted.current === trimmed) return;
    if (parseYouTubeVideoId(trimmed) === null) return;

    const timer = setTimeout(() => void addRef.current(trimmed), 450);
    return () => clearTimeout(timer);
  }, [atLimit, off, probing, url]);

  const Wrapper = embedded ? 'div' : 'section';

  return (
    <Wrapper
      className={`${embedded ? '' : 'card'}${off ? ' yt-card--off' : ''}`}
      aria-disabled={off || undefined}
    >
      {/* A real heading, not a .field-label on a <p>: that class is scoped to <label> in
          globals.css, so it rendered unweighted and the title read as body text. Embedded
          it drops to an <h3>, the composer around it already carrying the <h2>. */}
      <CardTitle icon={CirclePlay} level={embedded ? 3 : 2}>
        {STR.ytTitle}
      </CardTitle>
      <p className="hint">{STR.ytHint}</p>

      <div className="yt-add" style={{ marginTop: 12 }}>
        {/* Field and icon are ONE control: the wrapper carries the border and the focus ring,
            the input inside it is chrome-less. An icon merely placed beside the box would not
            move with the focus state and would read as decoration. */}
        <div
          className={`yt-field${fieldError ? ' yt-field--invalid' : ''}`}
          data-testid="yt-field"
        >
          <Link2 size={18} aria-hidden="true" />
          <input
            ref={input}
            type="url"
            inputMode="url"
            className="yt-url-input"
            placeholder={STR.ytPlaceholder}
            value={url}
            disabled={off || atLimit}
            aria-label={STR.ytTitle}
            aria-invalid={fieldError !== null}
            onChange={(event) => {
              setUrl(event.target.value);
              if (fieldError) setFieldError(null);
            }}
            onPaste={(event) => {
              // The paste itself starts the check: a pasted link is complete by definition, so
              // there is nothing to wait for. Only when the clipboard alone is a whole video
              // link — otherwise this is an edit to existing text and the debounce owns it.
              const pasted = event.clipboardData.getData('text').trim();
              if (pasted === '' || parseYouTubeVideoId(pasted) === null) return;
              event.preventDefault();
              setUrl(pasted);
              setFieldError(null);
              void add(pasted);
            }}
            onKeyDown={(event) => {
              // Enter still works for a typed link the officer does not want to wait on.
              // Prevented so this cannot submit an enclosing form instead.
              if (event.key === 'Enter') {
                event.preventDefault();
                void add(url);
              }
            }}
          />
          {/* The probe has no button to live in any more, so it reports here — in the field the
              link was pasted into, where the officer is already looking. */}
          {probing ? (
            <span className="yt-probing">
              <span className="spinner" aria-hidden="true" />
              {STR.ytAdding}
            </span>
          ) : null}
          {/* Clearing a mistyped link without selecting it first — shown only when there is
              something to clear, so it never occupies the row by default. */}
          {url && !probing ? (
            <button
              type="button"
              className="yt-clear"
              aria-label={STR.ytClear}
              disabled={off}
              onClick={() => {
                setUrl('');
                setFieldError(null);
                input.current?.focus();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {fieldError ? (
        <p className="form-error" style={{ marginTop: 8 }} role="alert">
          {fieldError}
        </p>
      ) : null}
      {atLimit ? (
        <p className="hint" style={{ marginTop: 8 }}>
          {STR.ytAtLimit}
        </p>
      ) : null}

      {videos.length > 0 ? (
        <>
          {/* Named and counted like the recordings list above it, so the two read as the same
              kind of thing arriving two ways. */}
          <p className="field-label" style={{ marginTop: 18, marginBottom: 0 }}>
            {STR.ytListTitle} ({videos.length.toLocaleString('mr-IN')})
          </p>
          <ul className="yt-list">
            {videos.map((video) => (
              <li key={video.videoId} className="yt-item">
                {/* Plain <img>, not next/image: the host is remote and unconfigured, and a
                  thumbnail that fails to load should simply leave the icon behind rather
                  than error a build-time-configured loader. */}
                {video.thumbnailUrl ? (
                  <img
                    className="yt-thumb"
                    src={video.thumbnailUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="yt-thumb yt-thumb--empty" aria-hidden="true">
                    <CirclePlay size={20} />
                  </span>
                )}
                <div className="yt-meta">
                  {/* The link opens the video so the officer can check it is the right one
                    without leaving their place in the form. */}
                  <a
                    className="yt-name"
                    href={video.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {video.title ?? video.url}
                  </a>
                  {video.author ? (
                    <span className="yt-channel">{video.author}</span>
                  ) : (
                    // A probe that found nothing is stated, not hidden: the source is fine,
                    // but the officer should know the card could not confirm it.
                    <span className="yt-channel">{STR.ytUnknown}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="file-remove"
                  disabled={off}
                  aria-label={`${STR.ytRemove}: ${video.title ?? video.url}`}
                  onClick={() =>
                    onChange(
                      videos.filter((entry) => entry.videoId !== video.videoId),
                    )
                  }
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Wrapper>
  );
}
