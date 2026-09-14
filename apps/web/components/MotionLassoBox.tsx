'use client';

// The freehand lasso an officer draws over the uploaded Dynamic Poster to say which part may
// MOVE — the companion to MotionCropBox for everything a rectangle is the wrong shape for: a
// person cut out of a photograph, a flag, a curved illustration. A box big enough to hold one of
// those also unfreezes the Devanagari beside it, which is the exact defect the region exists to
// prevent (see MotionRegionSchema in @dgipr/schemas).
//
// THE GESTURE. Press, drag round the shape, let go — the outline closes itself back to where it
// started. A new drag replaces the previous outline; Escape abandons one in progress. There is
// no point-by-point editing on purpose: redrawing takes a second and is a gesture every officer
// already understands, while handles on 200 points are not.
//
// COORDINATES ARE FRACTIONS OF THE POSTER, 0..1, exactly as MotionCropBox's are, and for the
// same reason: the browser has scaled the picture to fit the card. The API fills the outline
// with the nonzero winding rule, so a figure-eight moves both loops — and the scrim below is
// drawn with the same rule, so what the officer sees dimmed is what stays frozen.
//
// THE PATH IS SIMPLIFIED BEFORE IT LEAVES. A pointer reports a point every few milliseconds, and
// a slow careful outline would otherwise be thousands of them. Ramer–Douglas–Peucker at a
// sub-pixel-ish tolerance keeps the shape and drops the noise, and the tolerance is raised until
// the outline fits MOTION_LASSO_MAX_POINTS, so a valid drag is never refused by the API.
//
// KEYBOARD: the lasso is inherently a pointer gesture. The box tool beside it remains fully
// keyboard-operable, which is the accessible way to mark a region.

import { useEffect, useId, useRef, useState } from 'react';
import {
  MOTION_CROP_MIN_SIDE,
  MOTION_LASSO_MAX_POINTS,
  MOTION_LASSO_MIN_POINTS,
  polygonArea,
  polygonBounds,
  type MotionPoint,
  type MotionPolygon,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';

// Below this share of the frame between two samples the pointer has not really moved — the
// raw stream is thinned before simplification so a held-still finger cannot pile up points.
const SAMPLE_SPACING = 0.002;
// The starting RDP tolerance, as a share of the frame. ~2px on a 1280px poster.
const SIMPLIFY_TOLERANCE = 0.0015;
// An outline enclosing less than this share of the poster is a slip, not a selection.
const MIN_AREA = 0.0015;

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function perpendicularDistance(p: MotionPoint, a: MotionPoint, b: MotionPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

// Iterative RDP, so a very long outline cannot blow the stack.
function simplify(points: MotionPoint[], tolerance: number): MotionPoint[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicularDistance(
        points[i]!,
        points[first]!,
        points[last]!,
      );
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

// The outline the API will receive, or null when the drag was a slip. Rounded to four places:
// a ten-thousandth of the poster is well under a pixel and it keeps the request small.
export function finishLasso(raw: MotionPoint[]): MotionPolygon | null {
  if (raw.length < MOTION_LASSO_MIN_POINTS) return null;
  let tolerance = SIMPLIFY_TOLERANCE;
  let points = simplify(raw, tolerance);
  while (points.length > MOTION_LASSO_MAX_POINTS) {
    tolerance *= 1.5;
    points = simplify(raw, tolerance);
  }
  points = points.map((p) => ({
    x: Math.round(p.x * 10000) / 10000,
    y: Math.round(p.y * 10000) / 10000,
  }));
  // The closing segment is implied; a duplicated end point adds nothing.
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (
    points.length > MOTION_LASSO_MIN_POINTS &&
    first.x === last.x &&
    first.y === last.y
  ) {
    points.pop();
  }
  if (points.length < MOTION_LASSO_MIN_POINTS) return null;
  const box = polygonBounds(points);
  if (box.width < MOTION_CROP_MIN_SIDE || box.height < MOTION_CROP_MIN_SIDE) {
    return null;
  }
  if (polygonArea(points) < MIN_AREA) return null;
  return { type: 'polygon', points };
}

function pathOf(points: readonly MotionPoint[], close: boolean): string {
  if (points.length === 0) return '';
  const body = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
    .join(' ');
  return close ? `${body} Z` : body;
}

export function MotionLassoBox({
  value,
  onChange,
  disabled = false,
}: {
  value: MotionPolygon | null;
  onChange: (polygon: MotionPolygon) => void;
  // A job is running: the outline stays visible, nothing captures input.
  disabled?: boolean;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<MotionPoint[] | null>(null);
  // A drag that turned out too small to be a selection says so for a moment, rather than
  // silently leaving the previous outline in place as if nothing had happened.
  const [rejected, setRejected] = useState(false);
  const maskId = `motion-lasso-mask-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!rejected) return;
    const timer = window.setTimeout(() => setRejected(false), 2200);
    return () => window.clearTimeout(timer);
  }, [rejected]);

  const pointAt = (event: React.PointerEvent): MotionPoint => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Focus, so Escape reaches onKeyDown while the drag is in progress.
    event.currentTarget.focus({ preventScroll: true });
    setRejected(false);
    setDraft([pointAt(event)]);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft || disabled) return;
    const next = pointAt(event);
    const last = draft[draft.length - 1]!;
    if (Math.hypot(next.x - last.x, next.y - last.y) < SAMPLE_SPACING) return;
    setDraft([...draft, next]);
  };

  const onPointerUp = () => {
    if (!draft) return;
    const polygon = finishLasso(draft);
    setDraft(null);
    if (polygon) onChange(polygon);
    else setRejected(true);
  };

  const shown = draft ?? value?.points ?? null;
  const closed = draft === null;

  return (
    <div
      ref={surface}
      className={
        'motion-crop motion-lasso' +
        (disabled ? ' is-disabled' : '') +
        (draft ? ' is-drawing' : '')
      }
      role="application"
      tabIndex={disabled ? -1 : 0}
      aria-label={STR.motionLassoSurfaceLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && draft) {
          event.preventDefault();
          setDraft(null);
        }
      }}
    >
      <svg
        className="motion-lasso-svg"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {shown && shown.length > 1 ? (
          <>
            {/* The scrim: the whole poster dimmed except inside the outline. Drawn from the
                LIVE draft as well, closed back to its starting point, so the officer sees what
                will be selected while still drawing rather than only after letting go. A mask
                rather than an even-odd path, because the mask's fill uses the SAME nonzero rule
                the API fills with — even-odd would show a self-overlapping loop as frozen. */}
            <defs>
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="1"
                height="1"
              >
                <rect x="0" y="0" width="1" height="1" fill="#fff" />
                <path d={pathOf(shown, true)} fill="#000" fillRule="nonzero" />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="1"
              height="1"
              fill="rgba(0, 0, 0, 0.5)"
              mask={`url(#${maskId})`}
            />
          </>
        ) : null}
        {shown ? (
          <>
            <path
              className="motion-lasso-shadow"
              d={pathOf(shown, closed)}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="motion-lasso-line"
              d={pathOf(shown, closed)}
              vectorEffect="non-scaling-stroke"
            />
            {/* While drawing, the segment the outline will close with on release — dashed,
                so it reads as implied rather than drawn. */}
            {!closed && shown.length > 2 ? (
              <path
                className="motion-lasso-closing"
                d={pathOf([shown[shown.length - 1]!, shown[0]!], false)}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </>
        ) : null}
      </svg>

      {!shown && !rejected ? (
        <p className="motion-lasso-prompt">{STR.motionLassoPrompt}</p>
      ) : null}
      {rejected ? (
        <p className="motion-lasso-prompt is-warn" role="status">
          {STR.motionLassoTooSmall}
        </p>
      ) : null}
    </div>
  );
}
