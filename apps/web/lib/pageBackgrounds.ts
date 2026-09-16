/**
 * Which photograph a route sits on.
 *
 * The point of the map is that giving a route its own photo is a ONE-LINE edit
 * here and nothing else — no CSS, no prop threading, no new component. That is what stopped the old arrangement working:
 * the component it replaced took a `src`, so the answer to "which picture does
 * this page use" was spread across the call sites.
 *
 * Keys are named after the LANE, not the URL, so /chat and /new-video-workflow
 * share `conversation` and renaming a route does not orphan an entry.
 *
 * ONE INVARIANT ACROSS THE SET: backgrounds 1-4 are matched in INK DENSITY, so
 * every route reads at the same strength under the single shared
 * `--page-bg-overlay` wash in theme.css. They differ in pattern, and in how much
 * of the canvas that pattern covers, but never in opacity. background-new.png was
 * retired on 2026-09-16 for failing exactly this: it sat ~4x weaker than the rest,
 * which left nine routes reading as if they had no ground at all. Adding a fifth
 * photograph means matching that density first — measure it, do not eyeball it.
 *
 * The `satisfies` clause is load-bearing: it makes a mistyped path a typecheck
 * error while keeping the keys a literal union, so `background="analytcs"` fails
 * `tsc` instead of silently rendering no ground.
 */
export const PAGE_BACKGROUNDS = {
  default: '/backgrounds/background-1.png',
  home: '/backgrounds/background-1.png',
  analytics: '/backgrounds/background-2.png',
  conversation: '/backgrounds/background-1.png',
  creative: '/backgrounds/background-4.png',
  dlo: '/backgrounds/background-2.png',
  generations: '/backgrounds/background-3.png',
  glossary: '/backgrounds/background-2.png',
  newDlo: '/backgrounds/background-2.png',
  proofread: '/backgrounds/background-4.png',
  references: '/backgrounds/background-4.png',
  transcribe: '/backgrounds/background-3.png',
  translate: '/backgrounds/background-3.png',
  video: '/backgrounds/background-4.png',
} as const satisfies Record<string, `/backgrounds/${string}`>;

export type PageBackgroundKey = keyof typeof PAGE_BACKGROUNDS;

/**
 * Every DISTINCT file the map points at, deduped — what BackgroundPreloader warms.
 *
 * Derived from PAGE_BACKGROUNDS rather than written out beside it, so giving a
 * route its own photo stays the one-line edit above and cannot leave a new file
 * un-warmed (or a retired one being fetched for nothing).
 */
export const PAGE_BACKGROUND_FILES: readonly string[] = [
  ...new Set(Object.values(PAGE_BACKGROUNDS)),
];
