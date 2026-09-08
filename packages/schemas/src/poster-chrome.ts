// WHERE THE DGIPR SOCIAL POSTER'S BRAND CHROME SITS, as fractions of the poster's WIDTH.
//
// The artwork itself is rendered by @dgipr/poster-renderer (renderGovernmentLockup for the
// white emblem badge, footer-new-poster.png for the department band) and composited onto every
// finished twitter/facebook poster by overlayTwitterChrome. These two numbers are only the
// PLACEMENT, and they live here for the reason VIDEO_LOCKUP_WIDTH_RATIO does: two sides have
// to agree about it and one of them is the browser. overlayTwitterChrome derives its pixels
// from them, and the Dynamic Poster's crop preview lays the same artwork over the clip in CSS
// — apps/web cannot import poster-renderer (the combineIntakeSources move), so a second copy
// of these numbers in the web would be a copy free to drift.
//
// FRACTIONS OF THE WIDTH, NOT THE HEIGHT, on both axes — including the top margin. That is
// what makes one number serve a 1280x1600 poster and a clip of any shape alike, and in CSS it
// is why the preview offsets the badge with a percentage `margin-top` rather than `top`: a
// percentage margin resolves against the containing block's WIDTH, a percentage `top` against
// its height. Getting that backwards drops the badge ~1.25x too far down on a 4:5 frame and
// further still on a 9:16 one.
//
// There are deliberately no HEIGHT ratios here. Both graphics are laid out at a width and left
// to keep their own aspect — `height: auto` in the preview, and a width-only resize in the
// renderer — so the badge's 154:160 and the band's 239:3376 are properties of the artwork
// rather than numbers two packages have to hold identically.

/** The emblem + "महाराष्ट्र शासन" badge: 160px wide on the 1280px social canvas. */
export const SOCIAL_LOCKUP_WIDTH_RATIO = 0.125;

/** Its inset from the top and right edges: 6px on the same canvas. */
export const SOCIAL_LOCKUP_MARGIN_RATIO = 0.0046875;
