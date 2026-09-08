'use client';

// The window an officer drags over a recording — the audio counterpart of MotionCropBox, and
// built on the same three decisions, because they were the right ones there for reasons that
// hold here too.
//
// FRACTIONS OF THE TRACK, NOT PIXELS. The element is whatever width the dialog gives it and
// the recording is whatever length it is; the only stable coordinate is "how far along". The
// value the caller holds is in SECONDS, because that is what ffmpeg is handed and what the
// timecodes read, and the conversion happens at this boundary rather than being smeared
// through the component.
//
// THE VALUE IS ALWAYS VALID. Every update goes through `clampWindow`, so a handle dragged past
// its partner, past the ends of the recording, or down below the minimum window is corrected
// as it moves rather than refused when the officer presses the button. A slider that stops
// moving is understood; one that accepts a gesture and then rejects it is not.
//
// IT IS NOT POINTER-ONLY. Each handle is a focusable slider in its own right with the ARIA a
// slider needs, and the selected band is focusable too — arrows nudge it, Shift+arrows resize
// it. The step is a fraction of the RECORDING rather than a fixed number of seconds, so a
// keypress covers a sensible distance on a two-minute clip and on a two-hour one alike.

import { useRef, useState } from 'react';
import { AUDIO_TRIM_MIN_SECONDS, formatTimecode } from '@dgipr/schemas';
import { cn } from '@/lib/utils';
import { STR } from '@/lib/strings';

export type TrimWindow = Readonly<{
  startSeconds: number;
  endSeconds: number;
}>;

type Drag =
  // Moving one edge. The other is fixed, so this is the whole state it needs. Two members
  // rather than one carrying `'start' | 'end'`, because a discriminant that is itself a union
  // cannot be narrowed away by the checks below — the compiler would still be offering this
  // shape where only `draw` can remain.
  | Readonly<{ kind: 'start' }>
  | Readonly<{ kind: 'end' }>
  // Sliding the whole window. `grabOffset` is how far into the window the pointer went down,
  // in seconds, so it does not jump to centre itself under the finger on the first move.
  | Readonly<{ kind: 'move'; grabOffset: number }>
  // Drawing a fresh window from a point on the track outside the current one.
  | Readonly<{ kind: 'draw'; anchorSeconds: number }>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Pull a window inside the recording and up to the minimum length.
 *
 * `anchor` says which edge the officer is holding, and therefore which one must NOT move when
 * the other runs into it: dragging the start rightwards past the end has to stop the start,
 * not drag the end along. Without that the window creeps and the far edge ends up somewhere
 * nobody put it.
 */
export function clampWindow(
  window: TrimWindow,
  durationSeconds: number,
  anchor: 'start' | 'end' | 'both' = 'both',
): TrimWindow {
  // A recording shorter than the minimum window cannot be trimmed at all; the caller does not
  // offer the slider in that case, and this keeps the maths finite regardless.
  const minimum = Math.min(AUDIO_TRIM_MIN_SECONDS, durationSeconds);

  if (anchor === 'start') {
    const end = clamp(window.endSeconds, minimum, durationSeconds);
    return {
      startSeconds: clamp(window.startSeconds, 0, end - minimum),
      endSeconds: end,
    };
  }
  if (anchor === 'end') {
    const start = clamp(window.startSeconds, 0, durationSeconds - minimum);
    return {
      startSeconds: start,
      endSeconds: clamp(window.endSeconds, start + minimum, durationSeconds),
    };
  }
  // Sliding the whole window: its LENGTH is what must survive, so the pair is pushed back
  // inside the recording together rather than each end being clamped on its own — clamping
  // them separately is what silently shortens a window dragged off the end.
  const length = clamp(
    window.endSeconds - window.startSeconds,
    minimum,
    durationSeconds,
  );
  const start = clamp(window.startSeconds, 0, durationSeconds - length);
  return { startSeconds: start, endSeconds: start + length };
}

export function AudioTrimRange({
  value,
  durationSeconds,
  onChange,
  peaks,
  playheadSeconds = null,
  onScrub,
  disabled = false,
}: {
  value: TrimWindow;
  durationSeconds: number;
  onChange: (window: TrimWindow) => void;
  // Best-effort: absent for a recording too large to decode, and the track is then a plain
  // one. See lib/audioWaveform.ts.
  peaks?: Float32Array | null | undefined;
  // Where playback has reached, so the officer can hear their way to an edge.
  playheadSeconds?: number | null | undefined;
  // A bare click on the track jumps playback there. Separate from `onChange` because moving
  // the listening position is not editing the selection.
  onScrub?: ((seconds: number) => void) | undefined;
  disabled?: boolean | undefined;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const asFraction = (seconds: number): number =>
    durationSeconds <= 0 ? 0 : clamp(seconds / durationSeconds, 0, 1);

  // Where the pointer is along the recording, in seconds.
  const secondsAt = (event: React.PointerEvent): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp(
      ((event.clientX - rect.left) / rect.width) * durationSeconds,
      0,
      durationSeconds,
    );
  };

  const begin = (event: React.PointerEvent<HTMLElement>, next: Drag): void => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(next);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag === null || disabled) return;
    const at = secondsAt(event);

    if (drag.kind === 'start') {
      onChange(
        clampWindow({ ...value, startSeconds: at }, durationSeconds, 'start'),
      );
      return;
    }
    if (drag.kind === 'end') {
      onChange(
        clampWindow({ ...value, endSeconds: at }, durationSeconds, 'end'),
      );
      return;
    }
    if (drag.kind === 'move') {
      const length = value.endSeconds - value.startSeconds;
      const start = at - drag.grabOffset;
      onChange(
        clampWindow(
          { startSeconds: start, endSeconds: start + length },
          durationSeconds,
        ),
      );
      return;
    }
    // Drawing. The anchor is wherever the drag started, so pulling left of it is as valid as
    // pulling right — a selection that could only be made left-to-right is a selection half
    // the people who try it cannot make.
    onChange(
      clampWindow(
        {
          startSeconds: Math.min(drag.anchorSeconds, at),
          endSeconds: Math.max(drag.anchorSeconds, at),
        },
        durationSeconds,
        'end',
      ),
    );
  };

  const end = (): void => setDrag(null);

  // One percent of the recording a press, a tenth with Ctrl, a whole ten with Shift held for
  // resize. Proportional rather than a fixed number of seconds so a keypress is worth roughly
  // the same amount of travel whatever the length.
  const stepFor = (event: React.KeyboardEvent): number =>
    durationSeconds * (event.ctrlKey || event.metaKey ? 0.001 : 0.01);

  const edgeKeys =
    (edge: 'start' | 'end') =>
    (event: React.KeyboardEvent<HTMLElement>): void => {
      if (disabled) return;
      const step = stepFor(event);
      let delta = 0;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -step;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = step;
      if (delta === 0 && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      const target =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? durationSeconds
            : (edge === 'start' ? value.startSeconds : value.endSeconds) +
              delta;
      onChange(
        clampWindow(
          edge === 'start'
            ? { ...value, startSeconds: target }
            : { ...value, endSeconds: target },
          durationSeconds,
          edge,
        ),
      );
    };

  const bandKeys = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    const step = stepFor(event);
    const delta =
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    if (delta === 0) return;
    event.preventDefault();
    if (event.shiftKey) {
      onChange(
        clampWindow(
          { ...value, endSeconds: value.endSeconds + delta },
          durationSeconds,
          'end',
        ),
      );
      return;
    }
    onChange(
      clampWindow(
        {
          startSeconds: value.startSeconds + delta,
          endSeconds: value.endSeconds + delta,
        },
        durationSeconds,
      ),
    );
  };

  const startFraction = asFraction(value.startSeconds);
  const endFraction = asFraction(value.endSeconds);
  const bars = peaks ?? null;

  // Shared by both handles: an <input type=range> cannot express two thumbs over one track, so
  // the roles are declared by hand and carry the same information a native slider would.
  const sliderAria = (edge: 'start' | 'end') =>
    ({
      role: 'slider' as const,
      tabIndex: disabled ? -1 : 0,
      'aria-valuemin': 0,
      'aria-valuemax': Math.round(durationSeconds),
      'aria-valuenow': Math.round(
        edge === 'start' ? value.startSeconds : value.endSeconds,
      ),
      'aria-valuetext': formatTimecode(
        edge === 'start' ? value.startSeconds : value.endSeconds,
      ),
      'aria-label':
        edge === 'start' ? STR.audioTrimStartLabel : STR.audioTrimEndLabel,
      'aria-orientation': 'horizontal' as const,
    }) as const;

  return (
    <div
      ref={track}
      className={cn(
        'audio-trim relative h-28 w-full touch-none rounded-xl border select-none',
        // NOT `overflow-hidden`. The handles overhang the ends by half their width so a
        // window covering the whole recording still has two grabbable edges — and clipping
        // here put the end handle's grab area outside the element at its DEFAULT position,
        // which made the commonest gesture on this control silently impossible. The
        // waveform and the shrouds are clipped by their own wrapper below instead.
        // The unselected part of the track reads as the recording's quiet background; the
        // selection is painted over it below.
        'bg-muted/40',
        disabled && 'pointer-events-none opacity-60',
      )}
      onPointerDown={(event) => {
        // A press on the dimmed track starts a NEW window — the same gesture MotionCropBox
        // gives the area outside its rectangle, and the fastest way to select a passage the
        // officer can already see in the waveform.
        const at = secondsAt(event);
        onScrub?.(at);
        begin(event, { kind: 'draw', anchorSeconds: at });
      }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {/* Everything that must not escape the rounded corners — the picture and the two
          shrouds. Pointer-transparent so the track beneath still receives the draw gesture. */}
      <span
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        aria-hidden="true"
      >
        {/* The waveform, drawn once across the whole track. The SELECTION is expressed by
          dimming what is outside it rather than by drawing two waveforms, so the picture the
          officer is reading never changes as they drag — only the lighting on it. */}
        {bars ? (
          <svg
            className="text-foreground/45 pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${bars.length} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {Array.from(bars, (peak, index) => {
              const height = Math.max(1.5, peak * 92);
              return (
                <rect
                  key={index}
                  x={index + 0.15}
                  y={50 - height / 2}
                  width={0.7}
                  height={height}
                  rx={0.35}
                  fill="currentColor"
                />
              );
            })}
          </svg>
        ) : (
          // No picture: a centre line, so the track still reads as a length of audio rather
          // than an empty box. It carries no information and says so by being flat.
          <span
            className="bg-muted-foreground/25 pointer-events-none absolute inset-x-0 top-1/2 h-px"
            aria-hidden="true"
          />
        )}

        {/* The two shrouds. Two elements rather than one box-shadow so each side can be
          pointer-transparent independently of the band between them. */}
        <span
          className="bg-background/80 pointer-events-none absolute inset-y-0 left-0"
          style={{ width: `${startFraction * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="bg-background/80 pointer-events-none absolute inset-y-0 right-0"
          style={{ width: `${(1 - endFraction) * 100}%` }}
          aria-hidden="true"
        />
      </span>

      {/* The selection. Tinted rather than outlined, because an outline over a waveform reads
          as part of the waveform. */}
      <div
        {...(disabled ? {} : { tabIndex: 0 })}
        role="group"
        aria-label={STR.audioTrimWindowLabel}
        className={cn(
          'bg-primary/[0.04] border-primary/70 absolute inset-y-0 border-x-2',
          drag?.kind === 'move' ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{
          left: `${startFraction * 100}%`,
          width: `${Math.max(0, endFraction - startFraction) * 100}%`,
        }}
        onKeyDown={bandKeys}
        onPointerDown={(event) =>
          begin(event, {
            kind: 'move',
            grabOffset: secondsAt(event) - value.startSeconds,
          })
        }
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      />

      {/* The handles, outside the band so a press on one is never also a press to move the
          whole window. Each is wider than it looks (`-ms-3` plus padding) because a 4px grab
          target is not a target on a touchscreen. */}
      {(['start', 'end'] as const).map((edge) => {
        const fraction = edge === 'start' ? startFraction : endFraction;
        return (
          <div
            key={edge}
            {...sliderAria(edge)}
            className={cn(
              'group absolute inset-y-0 flex w-6 cursor-ew-resize items-center justify-center',
              edge === 'start' ? '-ms-3' : '-me-3',
            )}
            style={
              edge === 'start'
                ? { left: `${fraction * 100}%` }
                : { right: `${(1 - fraction) * 100}%` }
            }
            onKeyDown={edgeKeys(edge)}
            onPointerDown={(event) => begin(event, { kind: edge })}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span
              className={cn(
                'bg-primary flex h-16 w-3 items-center justify-center rounded-full shadow-sm transition-transform',
                'group-hover:scale-110 group-focus-visible:scale-110',
              )}
              aria-hidden="true"
            >
              {/* Two grip lines: the one detail that says "drag me" without a label. */}
              <span className="bg-primary-foreground/70 h-5 w-px" />
              <span className="bg-primary-foreground/70 ms-0.5 h-5 w-px" />
            </span>
          </div>
        );
      })}

      {/* Playback position. Drawn last so it stays visible over the band, and only while
          something is actually playing — a stationary line at 0:00 reads as a third handle. */}
      {playheadSeconds !== null && playheadSeconds !== undefined ? (
        <span
          className="bg-foreground/70 pointer-events-none absolute inset-y-0 w-0.5"
          style={{ left: `${asFraction(playheadSeconds) * 100}%` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
