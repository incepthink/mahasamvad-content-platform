'use client';

// Click/drag overlay on the poster image for placing feedback annotations. A
// single click drops a default-sized box centered on the point; dragging draws an
// exact rectangle. Coordinates are normalized 0..1 so they are independent of the
// displayed size — the API re-draws the same boxes on the full-size poster before
// the image model sees it (feedback-marker.ts), which is why the two visual
// languages here must match that file exactly.
//
// TWO modes, set by the caller's toolbar:
//   'mark'  — RED numbered boxes. A pointing gesture at the element to change
//             (the element at/around it), never a hard mask boundary.
//   'clear' — BLUE lettered boxes with a translucent fill. "Free this space": the
//             rectangle is left as plain background for a logo or photo added by
//             hand, and each box's own `action` says what happens to the content
//             inside — moved elsewhere on the poster, or deleted. Both actions
//             look the same here on purpose: the prompt names each box by its
//             letter, so no third colour is needed and the drawn language stays
//             the two the officer already knows (red = change, blue = free).
// Both sets are always drawn; only the active mode captures new input.

import { useRef, useState } from 'react';
import {
  POSTER_FEEDBACK_MAX_CLEAR_REGIONS,
  POSTER_FEEDBACK_MAX_MARKERS,
  type FeedbackRegion,
  type PosterClearAction,
} from '@dgipr/schemas';
import { STR } from '../lib/strings';

export type PosterMarkerDraft = {
  id: number;
  region: FeedbackRegion;
  note: string;
};

// A marker's shape plus the ACTION, and two differences in meaning: `note` is
// optional (an empty one means "you decide where this content goes", the common
// case), and `action` says what happens to whatever is inside —
//   'displace' — it stays on the poster; the layout is re-laid-out to fit it
//                elsewhere. The default, and what this gesture always meant.
//   'remove'   — it is deleted and nothing else on the poster moves.
// Per box, not per round, so one round can free one area each way.
export type PosterClearDraft = PosterMarkerDraft & {
  action: PosterClearAction;
};

export type AnnotatorMode = 'mark' | 'clear';

// Badge letters, matching CLEAR_REGION_LETTERS in poster-renderer's
// feedback-marker.ts — Latin because the poster-side badge is drawn as vector
// strokes and cannot depend on a Devanagari font inside the deploy container.
export const CLEAR_LETTERS: readonly string[] = ['A', 'B', 'C'];

// Article chrome zones (महासंवाद logo card top-left + footer band) in normalized
// coordinates — mirrors the reserved-zone pixel numbers in article-chrome.ts
// (~420x180 and ~150px on a 1536x1024 canvas). Markers there get a soft warning:
// the chrome is stamped in code after the edit, so changes under it won't show.
export const ARTICLE_RESERVED_ZONES: readonly FeedbackRegion[] = [
  { x: 0, y: 0, width: 0.273, height: 0.176 },
  { x: 0, y: 0.854, width: 1, height: 0.146 },
];

// YouTube-thumbnail chrome zones (emblem lockup top-RIGHT + the full-width department
// strip) in normalized coordinates — mirrors the reserved-zone pixel numbers in
// youtube-chrome.ts / build-youtube-thumbnail-prompt.ts (130x130 top-right and 70px on a
// 1280x720 canvas). Note the side: the article poster's lockup is top-LEFT, so reusing that
// constant here would warn about the wrong corner.
export const YOUTUBE_RESERVED_ZONES: readonly FeedbackRegion[] = [
  { x: 0.898, y: 0, width: 0.102, height: 0.181 },
  { x: 0, y: 0.903, width: 1, height: 0.097 },
];

export function markerInZones(
  region: FeedbackRegion,
  zones: readonly FeedbackRegion[],
): boolean {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  return zones.some(
    (z) =>
      cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height,
  );
}

// Click box: 16% of the poster width, height corrected by the displayed aspect
// ratio so the box looks square. Drags below the minimum side collapse to this.
const DEFAULT_BOX_WIDTH = 0.16;
const MIN_DRAG_SIDE = 0.02;
const CLICK_SLOP_PX = 6;

type Draft = {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  startClientX: number;
  startClientY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function defaultBox(cx: number, cy: number, aspect: number): FeedbackRegion {
  const width = DEFAULT_BOX_WIDTH;
  const height = Math.min(DEFAULT_BOX_WIDTH * aspect, 1);
  return {
    x: clamp(cx - width / 2, 0, 1 - width),
    y: clamp(cy - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function regionStyle(r: FeedbackRegion): React.CSSProperties {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.width * 100}%`,
    height: `${r.height * 100}%`,
  };
}

export function PosterAnnotator({
  markers,
  onAdd,
  onRemove,
  active,
  disabled,
  submittedMarkers = [],
  onDismissSubmitted,
  mode = 'mark',
  clearRegions = [],
  onAddClear,
  onRemoveClear,
  submittedClearRegions = [],
}: {
  markers: readonly PosterMarkerDraft[];
  onAdd: (region: FeedbackRegion) => void;
  onRemove: (id: number) => void;
  // Capture pointer input (a marking mode armed, no job running). The overlay is
  // pointer-transparent otherwise so it never hijacks scrolling over the poster.
  active: boolean;
  // Job running: annotations stay visible but inert (no ✕, no new boxes).
  disabled: boolean;
  // The last sent round, kept on screen (dashed, dimmed) through the re-render
  // and on the new poster so the user can see what they asked for.
  submittedMarkers?: readonly PosterMarkerDraft[];
  onDismissSubmitted?: () => void;
  // Which gesture a new box becomes. Both sets are drawn regardless.
  mode?: AnnotatorMode;
  clearRegions?: readonly PosterClearDraft[];
  onAddClear?: (region: FeedbackRegion) => void;
  onRemoveClear?: (id: number) => void;
  submittedClearRegions?: readonly PosterClearDraft[];
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const clearing = mode === 'clear' && !!onAddClear;
  const atCapacity = clearing
    ? clearRegions.length >= POSTER_FEEDBACK_MAX_CLEAR_REGIONS
    : markers.length >= POSTER_FEEDBACK_MAX_MARKERS;
  const capturing = active && !disabled && !atCapacity;

  const norm = (e: React.PointerEvent) => {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
      aspect: rect.width / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!capturing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = norm(e);
    setDraft({
      startX: x,
      startY: y,
      curX: x,
      curY: y,
      startClientX: e.clientX,
      startClientY: e.clientY,
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const { x, y } = norm(e);
    setDraft({ ...draft, curX: x, curY: y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;
    const { x, y, aspect } = norm(e);
    setDraft(null);
    // `clearing` already asserts onAddClear is present, so this narrows.
    const add = clearing ? onAddClear : onAdd;
    const isClick =
      Math.abs(e.clientX - draft.startClientX) < CLICK_SLOP_PX &&
      Math.abs(e.clientY - draft.startClientY) < CLICK_SLOP_PX;
    if (isClick) {
      add(defaultBox(x, y, aspect));
      return;
    }
    const rx = Math.min(draft.startX, x);
    const ry = Math.min(draft.startY, y);
    const rw = Math.abs(x - draft.startX);
    const rh = Math.abs(y - draft.startY);
    add(
      rw < MIN_DRAG_SIDE || rh < MIN_DRAG_SIDE
        ? defaultBox(x, y, aspect)
        : { x: rx, y: ry, width: rw, height: rh },
    );
  };

  return (
    <div
      ref={surface}
      className={'poster-annotator' + (capturing ? ' active' : '')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
    >
      {submittedMarkers.map((marker, i) => (
        <div
          key={`s-${marker.id}`}
          className="marker-box marker-box-submitted"
          style={regionStyle(marker.region)}
        >
          <span className="marker-badge">{i + 1}</span>
        </div>
      ))}
      {submittedClearRegions.map((c, i) => (
        <div
          key={`sc-${c.id}`}
          className="marker-box clear-box clear-box-submitted"
          style={regionStyle(c.region)}
        >
          <span className="marker-badge clear-badge">
            {CLEAR_LETTERS[i] ?? i + 1}
          </span>
        </div>
      ))}
      {(submittedMarkers.length > 0 || submittedClearRegions.length > 0) &&
      !disabled &&
      onDismissSubmitted ? (
        <button
          type="button"
          className="marker-dismiss"
          // Load-bearing: when the overlay is armed, a chip click must not
          // also drop a new marker underneath it.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDismissSubmitted}
        >
          {STR.markersDismiss}
        </button>
      ) : null}
      {markers.map((marker, i) => (
        <div
          key={marker.id}
          className="marker-box"
          style={regionStyle(marker.region)}
        >
          <span className="marker-badge">{i + 1}</span>
          {!disabled ? (
            <button
              type="button"
              className="marker-remove"
              aria-label={STR.markerRemove}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemove(marker.id)}
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
      {/* Clear boxes drawn last so an overlap reads as the "free this space"
          gesture — the more destructive of the two, and the one whose extent
          the user needs to judge. Mirrors the draw order in feedback-marker.ts. */}
      {clearRegions.map((c, i) => (
        <div
          key={c.id}
          className="marker-box clear-box"
          style={regionStyle(c.region)}
        >
          <span className="marker-badge clear-badge">
            {CLEAR_LETTERS[i] ?? i + 1}
          </span>
          {!disabled && onRemoveClear ? (
            <button
              type="button"
              className="marker-remove clear-remove"
              aria-label={STR.clearRegionRemove}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onRemoveClear(c.id)}
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
      {draft ? (
        <div
          className={'marker-ghost' + (clearing ? ' clear-ghost' : '')}
          style={regionStyle({
            x: Math.min(draft.startX, draft.curX),
            y: Math.min(draft.startY, draft.curY),
            width: Math.abs(draft.curX - draft.startX),
            height: Math.abs(draft.curY - draft.startY),
          })}
        />
      ) : null}
    </div>
  );
}
