'use client';

// What /learn's coach draws over the real screen: the rest of the page dimmed, the control
// the current step is about lit up with a glowing ring, and the coach's help text in a
// callout attached to that ring — below it, above it, or beside it, wherever it fits.
//
// The target is an element carrying `data-learn="…"`, or a region of one (the headline is
// part of the poster image, so it is the poster frame's box scaled down to HEADLINE_REGION),
// plus any `also` elements lit with it.
//
// Neither the ring nor the dim takes a click (pointer-events off; the dim is a spread
// SVG mask with a hole per lit control, not panels over the page). What makes the rest of the page
// inert is useLessonGate; this component only draws. With no target (the intro, the recap)
// or a target not on screen, the whole page is dimmed and the callout sits in the middle /
// at the foot of the screen.
//
// Tracked with requestAnimationFrame rather than scroll/resize listeners: the target moves
// for reasons no listener reports (the poster image loading, a textarea growing as it is
// typed into, a card appearing above it), and a ring left behind at the old position is
// worse than one read per frame.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LessonTarget } from '../../lib/learn/lesson';

type Box = Readonly<{
  top: number;
  left: number;
  width: number;
  height: number;
}>;

type Placement = 'below' | 'above' | 'right' | 'left' | 'dock' | 'center';

type Layout = Readonly<{
  ring: Box | null;
  // The target's `also` elements, each lit with a ring of its own.
  extras: readonly Box[];
  placement: Placement;
  top: number;
  left: number;
  // Where the callout's arrow meets its edge, px from the callout's own left/top.
  arrow: number;
}>;

const PAD = 6;
const GAP = 16;
const EDGE = 12;

function elementBox(learn: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[data-learn="${learn}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0 ? null : rect;
}

function padded(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): Box {
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
}

// The target's box, then one box per `also` element that is on the page. Separate boxes
// rather than one around them all: in a two-column layout a union lights the inert
// controls BETWEEN them too.
function measure(
  target: LessonTarget,
): { main: Box; extras: readonly Box[] } | null {
  const rect = elementBox(target.learn);
  if (!rect) return null;
  const r = target.region;
  const main = padded(
    r
      ? {
          left: rect.left + r.x * rect.width,
          top: rect.top + r.y * rect.height,
          width: r.width * rect.width,
          height: r.height * rect.height,
        }
      : rect,
  );
  const extras: Box[] = [];
  for (const learn of target.also ?? []) {
    const extra = elementBox(learn);
    if (extra) extras.push(padded(extra));
  }
  return { main, extras };
}

function onScreen(box: Box, vw: number, vh: number): boolean {
  return (
    box.top + box.height > 0 &&
    box.left + box.width > 0 &&
    box.top < vh &&
    box.left < vw
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function place(
  ring: Box | null,
  extras: readonly Box[],
  size: { width: number; height: number },
  centred: boolean,
): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width: w, height: h } = size;
  const middle = { top: (vh - h) / 2, left: (vw - w) / 2 };
  if (!ring || !onScreen(ring, vw, vh)) {
    return centred
      ? { ring: null, extras: [], placement: 'center', ...middle, arrow: 0 }
      : {
          ring: null,
          extras: [],
          placement: 'dock',
          top: vh - h - EDGE,
          left: middle.left,
          arrow: 0,
        };
  }
  const centreX = ring.left + ring.width / 2;
  const centreY = ring.top + ring.height / 2;
  const alongX = (left: number) => clamp(centreX - left, 24, w - 24);
  const alongY = (top: number) => clamp(centreY - top, 24, h - 24);
  const horizontalLeft = clamp(ring.left, EDGE, vw - w - EDGE);

  if (ring.top + ring.height + GAP + h <= vh - EDGE) {
    const top = ring.top + ring.height + GAP;
    return {
      ring,
      extras,
      placement: 'below',
      top,
      left: horizontalLeft,
      arrow: alongX(horizontalLeft),
    };
  }
  if (ring.top - GAP - h >= EDGE) {
    const top = ring.top - GAP - h;
    return {
      ring,
      extras,
      placement: 'above',
      top,
      left: horizontalLeft,
      arrow: alongX(horizontalLeft),
    };
  }
  const sideTop = clamp(centreY - h / 2, EDGE, vh - h - EDGE);
  if (ring.left + ring.width + GAP + w <= vw - EDGE) {
    const left = ring.left + ring.width + GAP;
    return {
      ring,
      extras,
      placement: 'right',
      top: sideTop,
      left,
      arrow: alongY(sideTop),
    };
  }
  if (ring.left - GAP - w >= EDGE) {
    const left = ring.left - GAP - w;
    return {
      ring,
      extras,
      placement: 'left',
      top: sideTop,
      left,
      arrow: alongY(sideTop),
    };
  }
  // A target taller than the screen (the whole poster on a phone): the callout sits over
  // the foot of the screen, on top of the target rather than off the page.
  return {
    ring,
    extras,
    placement: 'dock',
    top: vh - h - EDGE,
    left: middle.left,
    arrow: 0,
  };
}

function near(x: number, y: number): boolean {
  return Math.abs(x - y) < 0.5;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    near(a.top, b.top) &&
    near(a.left, b.left) &&
    near(a.width, b.width) &&
    near(a.height, b.height)
  );
}

function sameLayout(a: Layout | null, b: Layout): boolean {
  if (!a) return false;
  return (
    sameBox(a.ring, b.ring) &&
    a.extras.length === b.extras.length &&
    a.extras.every((box, i) => sameBox(box, b.extras[i] ?? null)) &&
    a.placement === b.placement &&
    near(a.top, b.top) &&
    near(a.left, b.left) &&
    near(a.arrow, b.arrow)
  );
}

export function Spotlight({
  target,
  stepKey,
  emphasis,
  nudge,
  children,
}: {
  target: LessonTarget | null;
  // Changes when the step changes: the target is scrolled into view once per step.
  stepKey: string;
  // Bumped by मला दाखवा: scroll the target into view and pulse the ring.
  emphasis: number;
  // Bumped when the gate swallows a press, so the callout shakes: "use this one".
  nudge: number;
  // The callout's content.
  children: ReactNode;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const learn = target?.learn;
  const region = target?.region;
  const also = target?.also?.join('|') ?? '';

  useEffect(() => {
    const t: LessonTarget | null = learn
      ? {
          learn,
          ...(region ? { region } : {}),
          ...(also ? { also: also.split('|') } : {}),
        }
      : null;
    let frame = 0;
    const tick = () => {
      const boxes = t ? measure(t) : null;
      // Once per step, bring the target into view the first time it exists.
      if (t && boxes && scrolledFor.current !== stepKey) {
        scrolledFor.current = stepKey;
        if (!onScreen(boxes.main, window.innerWidth, window.innerHeight)) {
          document
            .querySelector(`[data-learn="${t.learn}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      const rect = calloutRef.current?.getBoundingClientRect();
      const next = place(
        boxes?.main ?? null,
        boxes?.extras ?? [],
        { width: rect?.width ?? 360, height: rect?.height ?? 160 },
        t === null,
      );
      if (!sameLayout(layoutRef.current, next)) {
        layoutRef.current = next;
        setLayout(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [learn, region, also, stepKey]);

  // A short shake of the callout when a press elsewhere was swallowed.
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (nudge === 0) return;
    setShaking(true);
    const timer = setTimeout(() => setShaking(false), 600);
    return () => clearTimeout(timer);
  }, [nudge]);

  useEffect(() => {
    if (emphasis === 0 || !learn) return;
    document
      .querySelector<HTMLElement>(`[data-learn="${learn}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [emphasis, learn]);

  const ring = layout?.ring ?? null;
  const lit = ring ? [ring, ...(layout?.extras ?? [])] : [];
  const placement = layout?.placement ?? 'center';
  const arrowSide =
    placement === 'below' || placement === 'above' ? 'left' : 'top';

  // Portalled to <body>: the page's glass cards use backdrop-filter, which would make a
  // `position: fixed` descendant fixed to the card rather than to the screen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      {/* The dim: the whole screen, with a hole for each lit control. An SVG mask rather
          than a spread box-shadow round the ring, so two lit controls do not dim each
          other. */}
      <svg className="learn-dim" aria-hidden="true">
        <defs>
          <mask id="learn-dim-holes">
            <rect width="100%" height="100%" fill="white" />
            {lit.map((box, i) => (
              <rect
                key={i}
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                rx={10}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          className="learn-dim-fill"
          mask="url(#learn-dim-holes)"
        />
      </svg>
      {lit.map((box, i) => (
        <div
          key={`ring-${i}-${emphasis}`}
          className={'learn-spot' + (emphasis > 0 ? ' is-emphasised' : '')}
          aria-hidden="true"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
        />
      ))}
      <div
        ref={calloutRef}
        className={
          'learn-callout' +
          ` is-${placement}` +
          (shaking ? ' is-nudged' : '') +
          (layout ? '' : ' is-measuring')
        }
        data-learn-allow=""
        role="dialog"
        aria-modal="false"
        style={{ top: layout?.top ?? 0, left: layout?.left ?? 0 }}
      >
        {placement === 'dock' || placement === 'center' ? null : (
          <span
            className="learn-callout-arrow"
            aria-hidden="true"
            style={{ [arrowSide]: layout?.arrow ?? 0 }}
          />
        )}
        {/* The scrolling lives here, not on the callout: the arrow overflows the callout's
            edge, and on an `overflow: auto` box that overflow grows a scrollbar, the text
            re-wraps taller, the callout stops fitting where it was placed and flips —
            every frame, as a flicker. */}
        <div className="learn-callout-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
