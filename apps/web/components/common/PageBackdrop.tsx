/**
 * PageBackdrop — the hand-drawn doodle wallpaper a page sits on.
 *
 * One decorative layer per route, so a page says what it is about before a word is
 * read: क्रिएटिव्ह आणि सोशल gets picture/camera/palette marks, लेख / बातमी would get
 * newspaper marks, and so on. The marks are the caller's (see lib/doodleMarks.ts);
 * this file owns the sketching and the scatter.
 *
 * THE MARKS ARE REDRAWN BY HAND, NOT RENDERED AS ICONS. A lucide component paints a
 * CAD-clean 1.5px outline, and a field of those reads as a spreadsheet of pictograms
 * rather than as wallpaper. Every mark here is run through rough.js instead, which
 * re-samples each curve and jitters it into a wobbly, double-struck stroke — which is
 * what a WhatsApp-style doodle ground is actually made of. That is also why
 * lib/doodleMarks.ts stores GEOMETRY rather than components: a finished <svg> cannot
 * be redrawn.
 *
 * Five things worth knowing before changing it.
 *
 * THE LAYOUT IS DETERMINISTIC, NOT RANDOM. Positions come from a seeded PRNG rather
 * than Math.random(), because this renders on the server as well as in the browser and
 * a fresh draw on each would be a hydration mismatch on every page load. rough.js is
 * held to the same rule — every sketch is given an explicit `seed`, since its default
 * is a fresh random one per call. The same `seed` therefore always produces the same
 * wallpaper; a different seed re-scatters it.
 *
 * SKETCHING IS MEMOIZED PER MARK, NOT PER POSITION. Re-sampling forty icons on every
 * render would be real work, so each mark is sketched in SKETCH_VARIANTS versions once
 * and cached at module scope; a position then picks a variant. That caps the cost at
 * (marks x variants) for the life of the process however dense the field is, and two
 * variants of forty marks, each landing at its own size and angle, is already more
 * variety than the eye can track.
 *
 * EACH SKETCH IS EMITTED ONCE AND REFERENCED, and both halves of that matter for page
 * WEIGHT rather than for speed. A sketched mark is a hundred-odd bezier segments where
 * the icon was three, so a hundred of them written out in full put half a megabyte of
 * path data in the document — for wallpaper. Every distinct sketch therefore goes into
 * <defs> once and each position is a <use>, and the coordinates are rounded to
 * PATH_DECIMALS, which is a third of the bytes and invisible at 0.1 of a 24-unit grid.
 * Measure the built page (.next/server/app/index.html) after changing either.
 *
 * IT SITS BEHIND THE CONTENT, not under a z-index race. The layer is `z-index: -1`
 * inside the root stacking context, which paints it above the canvas gradient and below
 * every in-flow element — so no page has to mark its own blocks `position: relative` to
 * stay on top. That only works because `body` is transparent and the gradient lives on
 * `html` alone (see the `html`/`body` split in dgipr.css); putting a background back on
 * `body` would paint over this layer and the wallpaper would silently vanish.
 *
 * IT IS FIXED TO THE VIEWPORT, like the canvas gradient above it, so a long page does
 * not scroll through a moving field of doodles.
 *
 * ROUGHNESS AND OPACITY ARE TUNED AGAINST A RENDER, not guessed. Both are small
 * numbers with a narrow good range — too little roughness and the marks are back to
 * being icons, too much and a 24-unit glyph turns to scribble; too little opacity and
 * the wallpaper is invisible (the complaint this file was rewritten for), too much and
 * it competes with running Devanagari. Change them by looking at the page, not by
 * reasoning about the values.
 */
import type { ReactNode } from 'react';
import rough from 'roughjs';

import type { DoodleMark } from '../../lib/doodleMarks';

/** lucide's own grid, which is the space lib/doodleMarks.ts stores geometry in. */
const VIEW_BOX = 24;

/** How wobbly a stroke is, in grid units. Much past this the small marks turn to mush. */
const ROUGHNESS = 0.8;
/** How much a straight line bends on its way across. Carries most of the charm. */
const BOWING = 2;
/** Stroke weight in grid units — 1.15 of 24 reads as a ~2px pen at wallpaper size. */
const STROKE_WIDTH = 1.15;
/** Distinct sketches kept per mark. Each is written into the document once. */
const SKETCH_VARIANTS = 2;
/** Coordinate precision. 0.1 of a 24-unit grid is well under a rendered pixel. */
const PATH_DECIMALS = 1;

type SketchedPath = {
  d: string;
  fill: string | undefined;
  strokeWidth: number;
};

/** mulberry32 — a small, fast, well-distributed PRNG. Same seed, same wallpaper. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function num(attrs: Readonly<Record<string, string>>, name: string): number {
  return Number(attrs[name] ?? 0);
}

function points(attrs: Readonly<Record<string, string>>): [number, number][] {
  const flat = (attrs.points ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i] as number, flat[i + 1] as number]);
  }
  return out;
}

let generator: ReturnType<typeof rough.generator> | undefined;
const sketches = new Map<string, SketchedPath[]>();

/**
 * Redraw one mark by hand. `markKey` and `variant` are the cache key AND the sketch's
 * seed, which is what makes the same mark come back identical on the server and in the
 * browser — rough.js seeds itself randomly when it is not told otherwise.
 */
function sketchMark(
  mark: DoodleMark,
  markKey: number,
  variant: number,
): SketchedPath[] {
  const key = `${markKey}:${variant}`;
  const cached = sketches.get(key);
  if (cached) return cached;

  generator ??= rough.generator();
  const gen = generator;
  const drawn: SketchedPath[] = [];

  mark.forEach(([tag, attrs], index) => {
    // A lucide node painted with `fill: currentColor` is a solid dot (the palette's
    // paint blobs, a filled pin). Sketching it as an outline would lose it entirely.
    const solid = attrs.fill === 'currentColor';
    const options = {
      seed: markKey * 9973 + variant * 131 + index * 7 + 1,
      roughness: ROUGHNESS,
      bowing: BOWING,
      strokeWidth: STROKE_WIDTH,
      stroke: 'currentColor',
      preserveVertices: true,
      ...(solid ? { fill: 'currentColor', fillStyle: 'solid' } : {}),
    };

    let drawable;
    switch (tag) {
      case 'path':
        drawable = gen.path(attrs.d ?? '', options);
        break;
      case 'circle':
        drawable = gen.circle(
          num(attrs, 'cx'),
          num(attrs, 'cy'),
          num(attrs, 'r') * 2,
          options,
        );
        break;
      case 'ellipse':
        drawable = gen.ellipse(
          num(attrs, 'cx'),
          num(attrs, 'cy'),
          num(attrs, 'rx') * 2,
          num(attrs, 'ry') * 2,
          options,
        );
        break;
      // Corner radii are dropped on purpose: rough.js has no rounded rectangle, and a
      // hand-drawn corner is not square anyway.
      case 'rect':
        drawable = gen.rectangle(
          num(attrs, 'x'),
          num(attrs, 'y'),
          num(attrs, 'width'),
          num(attrs, 'height'),
          options,
        );
        break;
      case 'line':
        drawable = gen.line(
          num(attrs, 'x1'),
          num(attrs, 'y1'),
          num(attrs, 'x2'),
          num(attrs, 'y2'),
          options,
        );
        break;
      case 'polyline':
        drawable = gen.linearPath(points(attrs), options);
        break;
      case 'polygon':
        drawable = gen.polygon(points(attrs), options);
        break;
      default:
        return;
    }

    // Built from the drawable's own op sets rather than through `toPaths`, which is
    // the only way to ask for fixed precision — it renders at full float width.
    for (const set of drawable.sets) {
      const d = gen.opsToPath(set, PATH_DECIMALS);
      if (!d) continue;
      drawn.push({
        d,
        // 'fillPath' is the solid interior of a filled shape; 'path' and the hachure
        // sets are strokes.
        fill: set.type === 'fillPath' ? 'currentColor' : undefined,
        strokeWidth: STROKE_WIDTH,
      });
    }
  });

  sketches.set(key, drawn);
  return drawn;
}

type PageBackdropProps = {
  /** The marks to scatter, in no particular order. Cycled through at random. */
  marks: readonly DoodleMark[];
  /** Changing this re-scatters the same marks into a different arrangement. */
  seed?: number | undefined;
  columns?: number | undefined;
  rows?: number | undefined;
};

export function PageBackdrop({
  marks,
  seed = 7,
  columns = 11,
  rows = 9,
}: PageBackdropProps) {
  if (marks.length === 0) return null;

  const random = mulberry32(seed);
  const drawn: ReactNode[] = [];
  const recent: number[] = [];
  const memory = Math.min(8, marks.length - 1);
  // Every sketch a position uses, written into <defs> once at the end. Keyed by the
  // id so a mark reused across the field costs one <use>, not another sketch.
  const used = new Map<string, SketchedPath[]>();

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // One mark per grid cell, jittered inside it — a bare grid reads as a
      // spreadsheet, and a fully free scatter clumps and leaves holes.
      let pick = Math.floor(random() * marks.length);
      // Keep a short memory rather than only checking the previous cell: with forty
      // marks the eye notices the same doodle twice in a NEIGHBOURHOOD, not twice in
      // a row. Bounded, so a very short set cannot spin here.
      for (let tries = 0; tries < 6 && recent.includes(pick); tries += 1) {
        pick = (pick + 1) % marks.length;
      }
      recent.push(pick);
      if (recent.length > memory) recent.shift();

      const mark = marks[pick];
      if (!mark) continue;

      const left = ((column + 0.14 + random() * 0.72) * 100) / columns;
      const top = ((row + 0.14 + random() * 0.72) * 100) / rows;
      const size = Math.round(34 + random() * 40);
      // Doodles sit near-upright: a wide rotation range reads as scattered debris
      // rather than as a drawn ground.
      const angle = Math.round(-15 + random() * 30);
      // Per-mark opacity is what gives the field depth. Without it a hundred marks at
      // one value read as a flat printed texture.
      const alpha = (0.62 + random() * 0.55).toFixed(2);
      const variant = Math.floor(random() * SKETCH_VARIANTS);
      // The seed is in the id because a page could carry two backdrops one day, and a
      // duplicate id would silently make the second one draw the first one's marks.
      const id = `pbd-${seed}-${pick}-${variant}`;
      if (!used.has(id)) used.set(id, sketchMark(mark, pick, variant));

      drawn.push(
        <span
          key={`${row}-${column}`}
          className="page-backdrop-mark"
          // Checkerboard, so the mobile rule in dgipr.css can halve the density
          // without opening a bald patch on one side of the screen.
          data-thin={(row + column) % 2 === 1 ? '1' : undefined}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            opacity: alpha,
            transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          }}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <use href={`#${id}`} />
          </svg>
        </span>,
      );
    }
  }

  // aria-hidden: this is wallpaper. It carries no information a screen reader
  // needs, and reading out a hundred doodle names before the page would be noise.
  return (
    <div className="page-backdrop" aria-hidden="true">
      {/* The sketch library. It paints nothing itself — width/height 0 keeps it out of
          the layout — and every mark above points into it. */}
      <svg width="0" height="0" className="page-backdrop-defs">
        <defs>
          {[...used].map(([id, paths]) => (
            <g key={id} id={id}>
              {paths.map((path, index) => (
                <path
                  key={index}
                  d={path.d}
                  strokeWidth={path.strokeWidth}
                  {...(path.fill ? { fill: path.fill, stroke: 'none' } : {})}
                />
              ))}
            </g>
          ))}
        </defs>
      </svg>
      {drawn}
    </div>
  );
}
