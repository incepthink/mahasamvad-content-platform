/**
 * PageArtwork — a full illustration as a page's wallpaper.
 *
 * The sibling of PageBackdrop, and an alternative to it rather than a companion: both
 * are the decorative ground a route sits on, and two grounds at once read as noise.
 * PageBackdrop scatters hand-sketched marks; this paints one supplied drawing. A lane
 * with its own artwork uses this and drops the marks (see app/page.tsx).
 *
 * Three things worth knowing before changing it.
 *
 * THE FILE IS REFERENCED, NEVER INLINED. These drawings run to hundreds of kilobytes
 * of path data — inlining one into the document would put that weight in the HTML of
 * every page load, for wallpaper. As a CSS background it is one cacheable request
 * instead, which is the same reason PageBackdrop emits each sketch once into <defs>.
 *
 * IT SHARES PageBackdrop's PLACEMENT CONTRACT EXACTLY, so the two are interchangeable
 * at a call site and no page has to lift its own blocks out of the way: fixed to the
 * viewport, spanning the CONTENT COLUMN (--sidebar-w keeps it clear of the left rail),
 * z-index: -1 so it paints above the canvas gradient and below every in-flow element,
 * pointer-events: none, and hidden under prefers-reduced-motion. See .page-artwork in
 * dgipr.css, which also owns the opacity.
 *
 * THE OPACITY IS TUNED AGAINST A RENDER, not guessed, and is lower than the doodle
 * ceiling because a saturated illustration covers far more of its canvas than a field
 * of thin marks does. Change it by looking at the page.
 */

/** The क्रिएटिव्ह आणि सोशल lane's drawing, shared by the form and its result page. */
export const CREATIVE_ARTWORK = '/backgrounds/creative.png';

type PageArtworkProps = {
  /** Public-path URL of the drawing, e.g. CREATIVE_ARTWORK. */
  src: string;
};

export function PageArtwork({ src }: PageArtworkProps) {
  // aria-hidden: this is wallpaper. It carries no information a screen reader needs,
  // which is also why it is a background rather than an <img> with alt text.
  return (
    <div
      className="page-artwork"
      aria-hidden="true"
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}
