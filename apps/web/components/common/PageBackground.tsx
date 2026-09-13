/**
 * PageBackground — the photograph a route sits on.
 *
 * It keeps the placement contract the doodle wallpaper (PageBackdrop) uses, so the
 * two are interchangeable at a call site and no page has to lift its own blocks out
 * of the way: fixed to the viewport, spanning the CONTENT COLUMN via
 * --sidebar-w so it stays clear of the left rail in both its widths, z-index: -1 so
 * it paints above the canvas and below every in-flow element, and pointer-events:
 * none so it never eats a click. The rule itself is `.page-background` in theme.css,
 * which also owns the overlay gradient — only the image travels from here.
 *
 * ONE DOCUMENTED DIFFERENCE FROM THAT CONTRACT, and it is deliberate rather than an
 * oversight: this is NOT hidden under `prefers-reduced-motion`. A still photograph
 * is not motion, and it is now the product's ground rather than decoration — hiding
 * it would leave the glass panels floating over a flat canvas they were tuned
 * against. It hides under `prefers-reduced-transparency` instead, together with the
 * glass that depends on it (theme.css §8).
 *
 * THE IMAGE IS REFERENCED, NEVER INLINED — one cacheable request instead of
 * hundreds of kilobytes in the HTML of every page load, for wallpaper.
 */

import type { CSSProperties } from 'react';
import {
  PAGE_BACKGROUNDS,
  type PageBackgroundKey,
} from '../../lib/pageBackgrounds';

export function PageBackground({ name }: { name: PageBackgroundKey }) {
  // aria-hidden: this is wallpaper. It carries no information a screen reader
  // needs, which is also why it is a background rather than an <img> with alt text.
  return (
    <div
      className="page-background"
      aria-hidden="true"
      style={
        { '--page-bg-image': `url(${PAGE_BACKGROUNDS[name]})` } as CSSProperties
      }
    />
  );
}
