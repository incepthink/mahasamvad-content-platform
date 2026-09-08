'use client';

// The crop rectangle an officer drags over a finished Dynamic Poster clip.
//
// WHY A BOX AND NOT A RATIO. The lane already lets them pick 9:16, 16:9 or the poster's own
// shape before the render (see dynamic-poster.ts in @dgipr/schemas), and that settles the FRAME.
// It does not settle the CROP: a department often wants one panel of a poster — the headline
// block, a single announcement card — moving on its own, and no ratio names that rectangle.
// So this asks for the rectangle itself.
//
// WHY A RATIO ANYWAY, as an option. The free rectangle is the right primitive and the wrong
// gesture for the commonest job there is: getting the clip to an exact 4:5 or 9:16 so it drops
// into an Instagram or X frame with no strip left over. Hitting a ratio by dragging four edges
// is not something a person can do — an officer reported exactly that, a sliver of white along
// the foot of a poster placed in Canva. So `aspect` locks the SHAPE and leaves them only the
// two decisions that are genuinely theirs: where over the poster the frame sits, and how much
// of it to take.
//
// COORDINATES ARE FRACTIONS OF THE CLIP, 0..1, never pixels. The browser has scaled the video
// to fit the card, so its displayed size has nothing to do with the real frame; the API maps
// these fractions back onto the source's own pixels (cropVideoToRect, @dgipr/poster-renderer).
// The same convention PosterAnnotator uses over a poster, for the same reason.
//
// `aspect` IS THEREFORE IN FRACTION SPACE, NOT PIXELS — the rectangle's width/height as a share
// of the frame, which is the asked-for pixel ratio divided by the clip's own. The caller
// computes it, because only the caller knows the clip's real dimensions (`videoWidth`). Getting
// that backwards yields a rectangle that is right on a square frame and wrong on every other
// one, which is the exact class of error the lock exists to remove.
//
// The value is always VALID: every update runs through `clampRect`, so a rectangle that would
// leave the frame, shrink past MOTION_CROP_MIN_SIDE or drift off the locked ratio is corrected
// as it is drawn rather than refused when the officer presses the button. A crop tool that
// stops moving is understood; one that accepts a gesture and then rejects it is not.

import { useRef, useState } from 'react';
import { MOTION_CROP_MIN_SIDE, type MotionCrop } from '@dgipr/schemas';
import { STR } from '../lib/strings';

// The eight grips, named by the edges they move: a corner moves two, an edge one.
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
// Under a lock an edge grip cannot exist: it moves one side alone, which is the one thing the
// lock is there to prevent. Corners only, and they resize about the opposite corner.
const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];

export const FULL_CROP: MotionCrop = { x: 0, y: 0, width: 1, height: 1 };

type Drag =
  // Moving the whole rectangle. `grabX`/`grabY` are where inside it the pointer went down, so
  // it does not jump to centre itself under the finger on the first move.
  | { kind: 'move'; grabX: number; grabY: number }
  // Resizing. The rectangle as it was when the grip was taken, so every move is computed from
  // the original edges rather than from the last frame — which is what stops a fast drag past
  // an opposite edge from creeping.
  | { kind: 'resize'; handle: Handle; from: MotionCrop }
  // Drawing a fresh rectangle from a point on the dimmed area outside the current one.
  | { kind: 'draw'; startX: number; startY: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The size a locked rectangle takes when the officer asks for `width` x `height`: follow
// whichever axis demands more, derive the other from the ratio, then pull the pair inside the
// frame and up to the minimum side WITHOUT ever breaking the ratio — which is why each bound
// re-derives the opposite side instead of clamping it on its own.
function sizeForAspect(width: number, height: number, aspect: number) {
  let w = Math.max(width, height * aspect);
  if (w > 1) w = 1;
  if (w / aspect > 1) w = aspect;
  if (w < MOTION_CROP_MIN_SIDE) w = MOTION_CROP_MIN_SIDE;
  if (w / aspect < MOTION_CROP_MIN_SIDE) w = MOTION_CROP_MIN_SIDE * aspect;
  return { width: w, height: w / aspect };
}

/**
 * The largest rectangle of `aspect` (fraction space — see the header) that fits the frame,
 * centred. What a ratio preset arms the tool with: the most of the poster the officer can keep
 * at that shape, so the only thing left to do is slide it.
 */
export function centredRectForAspect(aspect: number): MotionCrop {
  const { width, height } = sizeForAspect(1, 1, aspect);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

// Pull a rectangle back inside the frame, up to the minimum side, and onto the locked ratio if
// there is one. Growing happens around the CENTRE, so a box the officer dragged too small
// settles where they were pointing rather than springing back toward a corner.
function clampRect(rect: MotionCrop, aspect?: number | null): MotionCrop {
  const { width, height } = aspect
    ? sizeForAspect(rect.width, rect.height, aspect)
    : {
        width: clamp(rect.width, MOTION_CROP_MIN_SIDE, 1),
        height: clamp(rect.height, MOTION_CROP_MIN_SIDE, 1),
      };
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    width,
    height,
    x: clamp(cx - width / 2, 0, 1 - width),
    y: clamp(cy - height / 2, 0, 1 - height),
  };
}

function edgesOf(rect: MotionCrop) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

function rectOf(
  left: number,
  top: number,
  right: number,
  bottom: number,
): MotionCrop {
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function MotionCropBox({
  value,
  onChange,
  aspect = null,
  disabled = false,
}: {
  value: MotionCrop;
  onChange: (rect: MotionCrop) => void;
  // The rectangle's width/height as a share of the frame — NOT the pixel ratio. Null is the
  // free rectangle this started as.
  aspect?: number | null;
  // A job is running: the selection stays visible so the officer can see what they asked for,
  // but nothing captures input.
  disabled?: boolean;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const locked = typeof aspect === 'number' && aspect > 0;

  // Where the pointer is, as a fraction of the surface. The surface is the video's own box, so
  // this is the fraction of the clip — to within the video element's 1px border, which is under
  // a tenth of a percent of any real frame and far below what a crop can express.
  const pointAt = (event: React.PointerEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const begin = (event: React.PointerEvent<HTMLElement>, next: Drag) => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(next);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag || disabled) return;
    const { x, y } = pointAt(event);

    if (drag.kind === 'move') {
      onChange(
        clampRect(
          {
            x: clamp(x - drag.grabX, 0, 1 - value.width),
            y: clamp(y - drag.grabY, 0, 1 - value.height),
            width: value.width,
            height: value.height,
          },
          aspect,
        ),
      );
      return;
    }

    if (drag.kind === 'draw') {
      onChange(
        clampRect(
          rectOf(
            Math.min(drag.startX, x),
            Math.min(drag.startY, y),
            Math.max(drag.startX, x),
            Math.max(drag.startY, y),
          ),
        ),
      );
      return;
    }

    // Resizing a LOCKED rectangle is its own operation, not the free one with a correction
    // applied afterwards: the opposite corner is pinned, the pointer says how big the shape is,
    // and the room left in that direction caps it. Correcting a free resize instead would let
    // the pinned corner drift, which reads as the box sliding out from under the finger.
    if (locked && aspect) {
      const from = edgesOf(drag.from);
      const anchorX = drag.handle.includes('w') ? from.right : from.left;
      const anchorY = drag.handle.includes('n') ? from.bottom : from.top;
      const roomX = drag.handle.includes('w') ? anchorX : 1 - anchorX;
      const roomY = drag.handle.includes('n') ? anchorY : 1 - anchorY;
      const asked = sizeForAspect(
        Math.abs(x - anchorX),
        Math.abs(y - anchorY),
        aspect,
      );
      const width = Math.min(asked.width, roomX, roomY * aspect);
      const height = width / aspect;
      const left = drag.handle.includes('w') ? anchorX - width : anchorX;
      const top = drag.handle.includes('n') ? anchorY - height : anchorY;
      onChange(
        clampRect(rectOf(left, top, left + width, top + height), aspect),
      );
      return;
    }

    // Free resize: each named edge is driven by the pointer and bounded by its opposite, which
    // is what keeps the rectangle from turning inside out when a grip is dragged straight across.
    let { left, top, right, bottom } = edgesOf(drag.from);
    if (drag.handle.includes('w')) {
      left = clamp(x, 0, right - MOTION_CROP_MIN_SIDE);
    }
    if (drag.handle.includes('e')) {
      right = clamp(x, left + MOTION_CROP_MIN_SIDE, 1);
    }
    if (drag.handle.includes('n')) {
      top = clamp(y, 0, bottom - MOTION_CROP_MIN_SIDE);
    }
    if (drag.handle.includes('s')) {
      bottom = clamp(y, top + MOTION_CROP_MIN_SIDE, 1);
    }
    onChange(clampRect(rectOf(left, top, right, bottom)));
  };

  const end = () => setDrag(null);

  // The keyboard equivalent of the two gestures, so the box is not pointer-only: arrows nudge
  // it, Shift+arrows resize it. One percent a press, a tenth with Ctrl. Under a lock the resize
  // is a single number — the width — and the height follows, so either axis drives it.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.ctrlKey ? 0.1 : 0.01;
    const dx =
      event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy =
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    if (!event.shiftKey) {
      onChange(
        clampRect({ ...value, x: value.x + dx, y: value.y + dy }, aspect),
      );
      return;
    }
    const grow = dx !== 0 ? dx : dy;
    onChange(
      clampRect(
        locked
          ? { ...value, width: value.width + grow, height: value.height }
          : { ...value, width: value.width + dx, height: value.height + dy },
        aspect,
      ),
    );
  };

  const boxStyle = {
    left: `${value.x * 100}%`,
    top: `${value.y * 100}%`,
    width: `${value.width * 100}%`,
    height: `${value.height * 100}%`,
  };

  return (
    <div
      ref={surface}
      className={
        'motion-crop' +
        (locked ? ' is-locked' : '') +
        (disabled ? ' is-disabled' : '')
      }
      // Drawing starts anywhere on the dimmed area; the box below stops the event on its own
      // handlers, so moving it never also starts a new rectangle underneath. Under a lock there
      // is nothing to draw — a fresh rectangle would have to be the locked shape anyway, and
      // dragging one out of a corner is a worse way to place it than sliding the one already on
      // screen. So the dimmed area is inert there, and the cursor says so.
      onPointerDown={(event) => {
        if (locked) return;
        const { x, y } = pointAt(event);
        begin(event, { kind: 'draw', startX: x, startY: y });
      }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="motion-crop-box"
        style={boxStyle}
        role="group"
        tabIndex={disabled ? -1 : 0}
        aria-label={
          locked ? STR.motionCropRegionLockedLabel : STR.motionCropRegionLabel
        }
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          const { x, y } = pointAt(event);
          begin(event, {
            kind: 'move',
            grabX: x - value.x,
            grabY: y - value.y,
          });
        }}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* Rule-of-thirds guides. Decoration, and pointer-transparent, so they can never take
            a drag away from the box they sit inside. */}
        <span className="motion-crop-thirds" aria-hidden="true" />
        {(locked ? CORNER_HANDLES : HANDLES).map((handle) => (
          <span
            key={handle}
            className={`motion-crop-handle motion-crop-handle-${handle}`}
            onPointerDown={(event) =>
              begin(event, { kind: 'resize', handle, from: value })
            }
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
    </div>
  );
}
