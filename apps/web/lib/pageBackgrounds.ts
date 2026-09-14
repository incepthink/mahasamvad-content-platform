/**
 * Which photograph a route sits on.
 *
 * Every key points at the same file today. The point of the map is that giving a
 * route its own photo is a ONE-LINE edit here and nothing else — no CSS, no prop
 * threading, no new component. That is what stopped the old arrangement working:
 * the component it replaced took a `src`, so the answer to "which picture does
 * this page use" was spread across the call sites.
 *
 * Keys are named after the LANE, not the URL, so /chat and /new-video-workflow
 * share `conversation` and renaming a route does not orphan an entry.
 *
 * The `satisfies` clause is load-bearing: it makes a mistyped path a typecheck
 * error while keeping the keys a literal union, so `background="analytcs"` fails
 * `tsc` instead of silently rendering no ground.
 */
export const PAGE_BACKGROUNDS = {
  default: '/backgrounds/background-new.png',
  home: '/backgrounds/background-try.png',
  analytics: '/backgrounds/background-new.png',
  conversation: '/backgrounds/background-new.png',
  creative: '/backgrounds/background-new.png',
  dlo: '/backgrounds/background-2.png',
  generations: '/backgrounds/background-new.png',
  glossary: '/backgrounds/background-new.png',
  newDlo: '/backgrounds/background-new.png',
  proofread: '/backgrounds/background-4.png',
  references: '/backgrounds/background-new.png',
  transcribe: '/backgrounds/background-3.png',
  translate: '/backgrounds/background-new.png',
  video: '/backgrounds/background-new.png',
} as const satisfies Record<string, `/backgrounds/${string}`>;

export type PageBackgroundKey = keyof typeof PAGE_BACKGROUNDS;
