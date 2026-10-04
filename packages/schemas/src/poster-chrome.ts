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

// --- WHICH LOGO STYLE A SOCIAL POSTER CARRIES (2026-10-03) -----------------------------------
//
// The badge used to be the same white rounded card in the same top-right corner on every
// poster, which made every poster read as the same template. It now rotates through six
// styles: the card, a white CIRCLE, and a white QUARTER-CIRCLE tab flush with the corner (its
// two straight edges run along the top edge and the side edge) — each in the top-left or the
// top-right corner.
//
// The style is chosen DETERMINISTICALLY FROM THE GENERATION ID (pickSocialLogoStyle), so every
// place that needs it — the initial render's prompt and stamp, a redo, every feedback round
// (which must erase and re-stamp the SAME badge), every carousel slide, and the Canva layer
// export — can recompute it from the row with no column and no migration.
//
// The footprint/reserve numbers live here, not in the renderer, for the reason the two ratios
// above do: the renderer stamps the badge and the PROMPT reserves room for it, and those are two
// packages that must agree. All figures are pixels on the 1280px social canvas.

export const SOCIAL_LOGO_STYLES = [
  'card-right',
  'card-left',
  'circle-right',
  'circle-left',
  'quarter-right',
  'quarter-left',
] as const;
export type SocialLogoStyle = (typeof SOCIAL_LOGO_STYLES)[number];
export type SocialLogoShape = 'card' | 'circle' | 'quarter';
export type SocialLogoSide = 'left' | 'right';

/** What every poster rendered before the rotation carries, and the rollback value. */
export const DEFAULT_SOCIAL_LOGO_STYLE: SocialLogoStyle = 'card-right';

export function isSocialLogoStyle(value: unknown): value is SocialLogoStyle {
  return (
    typeof value === 'string' &&
    (SOCIAL_LOGO_STYLES as readonly string[]).includes(value)
  );
}

export function socialLogoShape(style: SocialLogoStyle): SocialLogoShape {
  return style.startsWith('circle')
    ? 'circle'
    : style.startsWith('quarter')
      ? 'quarter'
      : 'card';
}

export function socialLogoSide(style: SocialLogoStyle): SocialLogoSide {
  return style.endsWith('left') ? 'left' : 'right';
}

/**
 * How far the stamped badge reaches from its corner, margin included — what the renderer
 * actually covers. Keep in sync with the shape constants in poster-renderer/twitter-chrome.ts.
 */
export const SOCIAL_LOGO_FOOTPRINT: Readonly<
  Record<SocialLogoShape, Readonly<{ width: number; height: number }>>
> = {
  card: { width: 166, height: 160 },
  circle: { width: 194, height: 194 },
  quarter: { width: 224, height: 224 },
};

/**
 * What the PROMPT reserves for it: the footprint plus a little slack, which is the model's
 * margin of error. The card's 180x170 is the figure every prompt has quoted since 2026-08-07.
 */
export const SOCIAL_LOGO_RESERVE: Readonly<
  Record<SocialLogoShape, Readonly<{ width: number; height: number }>>
> = {
  card: { width: 180, height: 170 },
  circle: { width: 210, height: 210 },
  quarter: { width: 240, height: 240 },
};

// FNV-1a: tiny, stable across processes and platforms, and spreads uuids evenly enough for six
// buckets. Not a security property — only "the same id always lands on the same style".
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The style a run carries, from its id. Same id, same style, every time. */
export function pickSocialLogoStyle(seed: string): SocialLogoStyle {
  return SOCIAL_LOGO_STYLES[hashSeed(seed) % SOCIAL_LOGO_STYLES.length]!;
}
