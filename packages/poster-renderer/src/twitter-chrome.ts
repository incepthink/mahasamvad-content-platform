// Stamp the brand chrome — the Government of Maharashtra emblem lockup (a clean
// white rounded-square badge with poster-logo-new.png and "महाराष्ट्र शासन",
// top-right) and the department footer band + social-handle strip
// (footer-new-poster.png, full-width bottom) — onto a rendered social poster.
// Mirrors article-chrome.ts: the image prompts erase the master's chrome and reserve
// these zones, and the API composites these immutable graphics after the render
// returns. Applies to BOTH the initial render and pixel-feedback edits (feedback
// re-edits a poster that already carries the chrome; re-stamping keeps it crisp).
//
// The reserved-zone numbers quoted to the image model live in the prompt builders
// (content-engine/build-poster-prompt.ts) and must stay in sync with the constants below: at
// the 1280x1600 canvas the tightly-fitted white lockup badge is 160x154 at a 6px margin from
// the top-right corner, and the prompt reserves 180x170 there.
//
// THE FOOTER IS APPENDED, NOT PASTED OVER (2026-08-10). The badge is still a destructive
// overlay — it sits in a corner that almost never holds the tail of a sentence — but the
// full-width footer band is now stamped onto a strip ADDED BELOW the artwork
// (footer-extension.ts). The band was burying the last line of long posters, and the reserve
// protecting it could only ever be a request: an image model has no ruler, and the same prompt
// tells it three times over to show every point and match the reference's density. Appending
// makes the failure impossible instead of unlikely. What the prompt asks for at the bottom is
// that the DESIGN run off the edge in whatever colours it uses, with only a 16px cushion below
// the last line of text — see footerAppendedMargin in build-poster-prompt.ts. It asked for a
// calm plain-background margin first, and that produced a poster with 173 flat grey pixels
// above its own footer.
//
// AND THE FINISHED POSTER IS 4:5 AGAIN (2026-08-13). Appending made the delivered file
// 1280x1691 — 1:1.32, no longer the 4:5 the whole product assumes. Officers place these on a
// 1080x1350 Canva canvas, where a taller-than-4:5 image leaves a gap down each side that they
// then close by hand, displacing the design. So the height is taken out of the REQUEST rather
// than off the finished image: the model is asked for SOCIAL_ARTWORK_HEIGHT, the strip is
// joined below it, and the sum is exactly SOCIAL_POSTER_HEIGHT. Cropping the artwork instead
// would have reopened the burying bug this file exists to close, and squashing it distorts.
//
// The artwork height is NOT 1600 - 91. gpt-image-2 requires BOTH dimensions divisible by 16
// ("Invalid size '1280x1509'. Width and height must both be divisible by 16." — verified live
// 2026-08-13, a 400 that arrives in ~1s and would fail the run after the copy call is paid
// for). So the artwork is 1504 (16 x 94) and the appended strip is the 96px remainder, which
// is a little taller than the band's own ~91px: the extra ~5px is filled by the same
// edge-continuation that makes the join invisible, so it reads as the poster, not as padding.
// Any future change to either number must keep artwork % 16 === 0 and strip >= band height.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DEFAULT_SOCIAL_LOGO_STYLE,
  SOCIAL_LOCKUP_MARGIN_RATIO,
  SOCIAL_LOCKUP_WIDTH_RATIO,
  SOCIAL_LOGO_STYLES,
  socialLogoShape,
  socialLogoSide,
  type SocialLogoSide,
  type SocialLogoStyle,
} from '@dgipr/schemas';
import { loadScaled } from './article-chrome.js';
import { joinFooterStrip, type FooterJoinSpec } from './footer-extension.js';

const ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets',
);

// Base units are pixels on the twitter canvas itself: masters are always 1280 wide
// (MASTER_DIMENSIONS in content-engine) and so is every render, so the scale factor is
// normally 1 — it only kicks in if the model ever returns another width.
const ASSET_BASE_WIDTH = 1280;
// The badge's PLACEMENT comes from @dgipr/schemas rather than living here, because a
// browser needs it too: the Dynamic Poster crop preview lays this same artwork over an
// unbranded clip in CSS, and apps/web cannot import this package. The ratios are exact
// binary fractions of the 1280px canvas, so these are still precisely 160 and 6.
const LOCKUP_WIDTH = ASSET_BASE_WIDTH * SOCIAL_LOCKUP_WIDTH_RATIO;
const LOCKUP_HEIGHT = 154;
const LOCKUP_CORNER_RADIUS = 12;
const LOCKUP_MARGIN = ASSET_BASE_WIDTH * SOCIAL_LOCKUP_MARGIN_RATIO;
const EMBLEM_TARGET_WIDTH = 96;
const EMBLEM_TOP = 8;
const LABEL_TOP = 119;
const LABEL_MAX_WIDTH = 154;
const LABEL_FONT_SIZE = 21;
const LABEL = 'महाराष्ट्र शासन';
const LABEL_COLOUR = '#17324d';
// The card-less variant sits directly on footage with NOTHING behind it — no
// card, no panel, no halo — so the navy wordmark would disappear on any dark
// scene. It is set in white instead, which is the broadcast default over
// footage. Change this one constant if a light-footage deployment wants the
// navy back.
const LABEL_COLOUR_ON_FOOTAGE = '#ffffff';
// THE TWO SHAPED BADGES (2026-10-03, see SOCIAL_LOGO_STYLES in @dgipr/schemas). Same emblem and
// wordmark as the card, on a white circle or a white quarter-circle tab instead of a rounded
// square. Pixels on the 1280px canvas; SOCIAL_LOGO_FOOTPRINT in schemas is what these cover and
// must be kept in step with them (circle: 8 + 186 = 194; quarter: 224 flush with the corner).
//
// The marks are set a little smaller inside both shapes: the wordmark is the widest part of the
// lockup and sits at the bottom of it, which is exactly where a circle's chord and a quarter's
// arc narrow fastest.
const CIRCLE_DIAMETER = 186;
const CIRCLE_MARGIN = 8;
const CIRCLE_MARK_SCALE = 0.86;
// The quarter is centred ON the corner, so its two straight edges are the poster's own top edge
// and side edge and only the arc shows. Radius chosen so the marks' far corner (the outer end of
// the wordmark) clears the arc by ~20px.
const QUARTER_RADIUS = 224;
const QUARTER_MARK_SCALE = 0.94;
const QUARTER_PAD_TOP = 16;
const QUARTER_PAD_SIDE = 18;
// Gap between the emblem and the wordmark inside the shaped badges, before mark scaling. The card
// derives its gap from EMBLEM_TOP/LABEL_TOP; this is the same visual gap.
const SHAPED_MARK_GAP = 10;
const BADGE_STROKE_COLOUR = '#dce3ea';
// footer-new-poster.png was exported on a 3376x4219 transparent canvas; the
// intended footer artwork occupies the bottom 239 pixels.
const SOCIAL_FOOTER_SOURCE_HEIGHT = 239;

/**
 * The finished DGIPR social poster: 1280x1600, a true 4:5, which is what drops into a
 * 1080x1350 Canva/Instagram/Facebook portrait frame with no gap.
 */
export const SOCIAL_POSTER_HEIGHT = 1600;

/**
 * The canvas the IMAGE MODEL is asked for — the finished poster minus the strip the branding
 * band is joined onto. Must stay divisible by 16 (gpt-image-2 rejects anything else) and must
 * leave a strip at least as tall as the band. Keep in sync with SOCIAL_ZONES.height in
 * content-engine/src/generation/build-poster-prompt.ts, which is what the prompt reserves.
 */
export const SOCIAL_ARTWORK_HEIGHT = 1504;

/** The render size to request for DGIPR social artwork, e.g. for generateImage / n8n. */
export const SOCIAL_ARTWORK_SIZE = `${ASSET_BASE_WIDTH}x${SOCIAL_ARTWORK_HEIGHT}`;

// The two shapes overlayTwitterChrome has to tell apart: fresh artwork, and a finished poster
// coming back round through a feedback edit. Both are derived from the constants above rather
// than from the runtime band height, so the finished poster is exactly 4:5 whatever the footer
// asset measures. joinFooterStrip owns the decision and the strip arithmetic, shared verbatim
// with the YouTube-thumbnail lane so the two cannot drift.
const SOCIAL_FOOTER_JOIN: FooterJoinSpec = {
  baseWidth: ASSET_BASE_WIDTH,
  artworkHeight: SOCIAL_ARTWORK_HEIGHT,
  finishedHeight: SOCIAL_POSTER_HEIGHT,
};

export type GovernmentLockupRaster = Readonly<{
  data: Buffer;
  width: number;
  height: number;
}>;
type Raster = GovernmentLockupRaster;

export type CanvaPosterLayer = Readonly<{
  png: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type CanvaSocialPosterLayers = Readonly<{
  base: Buffer;
  logo: CanvaPosterLayer;
  footer: CanvaPosterLayer;
  width: number;
  height: number;
}>;

// Render the Marathi wordmark through Sharp/Pango with the bundled Devanagari
// font. The emblem remains a high-resolution raster, while the label is freshly
// shaped at the output size so both stay sharp and perfectly centred.
async function renderGovernmentLabel(
  scale: number,
  colour: string,
): Promise<Raster> {
  const data = await sharp({
    text: {
      text: `<span foreground="${colour}">${LABEL}</span>`,
      font: `Mukta SemiBold ${LABEL_FONT_SIZE}`,
      fontfile: resolve(ASSETS_DIR, 'fonts/Mukta-SemiBold.ttf'),
      width: Math.round(LABEL_MAX_WIDTH * scale),
      align: 'centre',
      rgba: true,
      dpi: Math.max(1, Math.round(72 * scale)),
    },
  })
    .png()
    .toBuffer();
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not render the Maharashtra government wordmark.');
  }
  return { data, width: meta.width, height: meta.height };
}

async function buildGovernmentLockup(
  scale: number,
  background: GovernmentLockupBackground,
): Promise<Raster> {
  const width = Math.round(LOCKUP_WIDTH * scale);
  const height = Math.round(LOCKUP_HEIGHT * scale);
  const stroke = Math.max(1, 1.5 * scale);
  const strokeInset = stroke / 2;
  const cornerRadius = LOCKUP_CORNER_RADIUS * scale;
  const onFootage = background === 'transparent';
  const card = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${strokeInset}" y="${strokeInset}"
        width="${width - stroke}" height="${height - stroke}"
        rx="${cornerRadius}" ry="${cornerRadius}"
        fill="#ffffff" stroke="#dce3ea" stroke-width="${stroke}"/>
    </svg>`,
  );
  const [emblem, label] = await Promise.all([
    loadScaled('poster-logo-new.png', EMBLEM_TARGET_WIDTH * scale),
    renderGovernmentLabel(
      scale,
      onFootage ? LABEL_COLOUR_ON_FOOTAGE : LABEL_COLOUR,
    ),
  ]);
  const marks = [
    {
      input: emblem.data,
      left: Math.round((width - emblem.width) / 2),
      top: Math.round(EMBLEM_TOP * scale),
    },
    {
      input: label.data,
      left: Math.round((width - label.width) / 2),
      top: Math.round(LABEL_TOP * scale),
    },
  ];

  if (!onFootage) {
    return {
      data: await sharp(card).composite(marks).png().toBuffer(),
      width,
      height,
    };
  }

  // Nothing behind the marks at all: no card, no panel, no halo — the emblem
  // and the wordmark composite straight onto the footage.
  return {
    data: await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(marks)
      .png()
      .toBuffer(),
    width,
    height,
  };
}

/**
 * `card` (default) is the white rounded badge the social and YouTube posters
 * carry. `transparent` drops the card so the emblem + wordmark sit directly on
 * the artwork — what the explainer video wants, since a white square over
 * live-action footage reads as a sticker.
 */
export type GovernmentLockupBackground = 'card' | 'transparent';

export type GovernmentLockupOptions = Readonly<{
  background?: GovernmentLockupBackground;
}>;

// Shared with the explainer-video path so posters and videos always use the
// exact same Maharashtra Government emblem + wordmark artwork. Callers choose
// the target width; the social poster uses 160px on a 1280px canvas, while
// video intentionally asks for a slightly larger proportion.
export async function renderGovernmentLockup(
  targetWidth: number,
  options: GovernmentLockupOptions = {},
): Promise<GovernmentLockupRaster> {
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    throw new Error('Government lockup target width must be positive.');
  }
  return buildGovernmentLockup(
    targetWidth / LOCKUP_WIDTH,
    options.background ?? 'card',
  );
}

// The emblem stacked over the wordmark, centred on `axisX`, starting at `top` — the same two
// marks the card carries, at `markScale` of their card size. Returned as composite operations so
// the caller decides the shape behind them.
async function stackedMarks(
  markScale: number,
  axisX: number,
  top: number,
): Promise<{
  marks: { input: Buffer; left: number; top: number }[];
  width: number;
  height: number;
}> {
  const [emblem, label] = await Promise.all([
    loadScaled('poster-logo-new.png', EMBLEM_TARGET_WIDTH * markScale),
    renderGovernmentLabel(markScale, LABEL_COLOUR),
  ]);
  const gap = Math.round(SHAPED_MARK_GAP * markScale);
  return {
    marks: [
      {
        input: emblem.data,
        left: Math.round(axisX - emblem.width / 2),
        top: Math.round(top),
      },
      {
        input: label.data,
        left: Math.round(axisX - label.width / 2),
        top: Math.round(top + emblem.height + gap),
      },
    ],
    width: Math.max(emblem.width, label.width),
    height: emblem.height + gap + label.height,
  };
}

// A white circle with the marks centred in it.
async function buildCircleLockup(scale: number): Promise<Raster> {
  const size = Math.round(CIRCLE_DIAMETER * scale);
  const stroke = Math.max(1, 1.5 * scale);
  const markScale = scale * CIRCLE_MARK_SCALE;
  // Measure the stack once at the top, then place it so it is optically centred: a hair below
  // true centre, because the wordmark's raster carries more blank line-height under it than the
  // emblem carries above.
  const probe = await stackedMarks(markScale, size / 2, 0);
  const top = (size - probe.height) / 2 + 2 * scale;
  const { marks } = await stackedMarks(markScale, size / 2, top);
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - stroke / 2}"
        fill="#ffffff" stroke="${BADGE_STROKE_COLOUR}" stroke-width="${stroke}"/>
    </svg>`,
  );
  return {
    data: await sharp(shape).composite(marks).png().toBuffer(),
    width: size,
    height: size,
  };
}

// A white quarter-circle centred on the poster's corner: its straight edges ARE the poster's top
// edge and side edge, so only the arc is drawn as an edge. The marks sit in the corner, inset by
// the pads, with their axis kept off the side edge so the wordmark has room.
async function buildQuarterLockup(
  scale: number,
  side: SocialLogoSide,
): Promise<Raster> {
  const r = Math.round(QUARTER_RADIUS * scale);
  const stroke = Math.max(1, 1.5 * scale);
  const markScale = scale * QUARTER_MARK_SCALE;
  const probe = await stackedMarks(markScale, 0, 0);
  const padSide = QUARTER_PAD_SIDE * scale;
  const axisX =
    side === 'right'
      ? r - padSide - probe.width / 2
      : padSide + probe.width / 2;
  const { marks } = await stackedMarks(
    markScale,
    axisX,
    QUARTER_PAD_TOP * scale,
  );
  // Centre of the circle is the corner: (r, 0) for the top-right, (0, 0) for the top-left. The
  // filled region is the corner wedge; the stroke follows the arc only, since the two straight
  // edges lie on the poster's own edges.
  const arcInset = stroke / 2;
  const ar = r - arcInset;
  const fill =
    side === 'right'
      ? `M ${r} 0 L ${r - ar} 0 A ${ar} ${ar} 0 0 0 ${r} ${ar} Z`
      : `M 0 0 L ${ar} 0 A ${ar} ${ar} 0 0 1 0 ${ar} Z`;
  const arc =
    side === 'right'
      ? `M ${r - ar} 0 A ${ar} ${ar} 0 0 0 ${r} ${ar}`
      : `M ${ar} 0 A ${ar} ${ar} 0 0 1 0 ${ar}`;
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r}" height="${r}">
      <path d="${fill}" fill="#ffffff"/>
      <path d="${arc}" fill="none" stroke="${BADGE_STROKE_COLOUR}" stroke-width="${stroke}"/>
    </svg>`,
  );
  return {
    data: await sharp(shape).composite(marks).png().toBuffer(),
    width: r,
    height: r,
  };
}

export type PlacedSocialLogo = Readonly<{
  data: Buffer;
  width: number;
  height: number;
  /** Where its top-left corner lands on the poster. */
  left: number;
  top: number;
}>;

/**
 * The social badge in a given style, rendered for a poster `posterWidth` pixels wide and already
 * placed. The ONE place that decides where each style goes, shared by the stamp and by the Canva
 * layer export so the two cannot disagree about which pixels are the badge.
 *
 * `card-right` is exactly what overlayTwitterChrome has always stamped.
 */
export async function placeSocialLogo(
  style: SocialLogoStyle,
  posterWidth: number,
): Promise<PlacedSocialLogo> {
  const scale = posterWidth / ASSET_BASE_WIDTH;
  const shape = socialLogoShape(style);
  const side = socialLogoSide(style);
  let raster: Raster;
  let margin: number;
  if (shape === 'circle') {
    raster = await buildCircleLockup(scale);
    margin = Math.round(CIRCLE_MARGIN * scale);
  } else if (shape === 'quarter') {
    raster = await buildQuarterLockup(scale, side);
    margin = 0;
  } else {
    raster = await renderGovernmentLockup(LOCKUP_WIDTH * scale);
    margin = Math.round(LOCKUP_MARGIN * scale);
  }
  return {
    ...raster,
    left: side === 'right' ? posterWidth - raster.width - margin : margin,
    top: margin,
  };
}

// Rendered badges are deterministic for a given style and width, and detection below renders all
// six, so they are kept for the life of the process.
const placedLogoCache = new Map<string, Promise<PlacedSocialLogo>>();
function cachedPlacedLogo(
  style: SocialLogoStyle,
  width: number,
): Promise<PlacedSocialLogo> {
  const key = `${style}@${width}`;
  let placed = placedLogoCache.get(key);
  if (!placed) {
    placed = placeSocialLogo(style, width);
    placed.catch(() => placedLogoCache.delete(key));
    placedLogoCache.set(key, placed);
  }
  return placed;
}

/**
 * Which logo style a FINISHED social poster actually carries, read off its pixels — or null when
 * none matches (not one of ours, or the corner was edited after stamping).
 *
 * WHY READ IT RATHER THAN RECOMPUTE IT. A feedback round erases the badge it is told about and the
 * stamp puts the run's badge back; if what the prompt describes is not what is on the image, the
 * old badge survives beside the new one. The poster was stamped by this file into a lossless PNG,
 * so the badge's opaque pixels match a fresh render of the same style EXACTLY — which makes this
 * a lookup, not a guess, and it stays right for posters made before the rotation existed, and
 * across any change to how a run's style is chosen.
 */
export async function detectSocialLogoStyle(
  poster: Buffer,
): Promise<SocialLogoStyle | null> {
  const { data, info } = await sharp(poster)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let best: { style: SocialLogoStyle; diff: number } | null = null;
  for (const style of SOCIAL_LOGO_STYLES) {
    const placed = await cachedPlacedLogo(style, info.width);
    if (
      placed.left + placed.width > info.width ||
      placed.top + placed.height > info.height
    )
      continue;
    const logo = await sharp(placed.data).ensureAlpha().raw().toBuffer();
    let sum = 0;
    let n = 0;
    // Every 3rd pixel of the badge's fully opaque area is plenty and keeps this cheap.
    for (let i = 0; i < placed.width * placed.height; i += 3) {
      if (logo[i * 4 + 3]! !== 255) continue;
      const x = placed.left + (i % placed.width);
      const y = placed.top + Math.floor(i / placed.width);
      const p = (y * info.width + x) * info.channels;
      sum +=
        Math.abs(data[p]! - logo[i * 4]!) +
        Math.abs(data[p + 1]! - logo[i * 4 + 1]!) +
        Math.abs(data[p + 2]! - logo[i * 4 + 2]!);
      n += 3;
    }
    const diff = n > 0 ? sum / n : Number.POSITIVE_INFINITY;
    if (!best || diff < best.diff) best = { style, diff };
  }
  // A stamped badge reproduces to within rounding; anything else is not one of ours.
  return best && best.diff < 2 ? best.style : null;
}

export type SocialChromeOptions = Readonly<{
  /** Which badge to stamp. Absent = DEFAULT_SOCIAL_LOGO_STYLE, the pre-rotation card. */
  logoStyle?: SocialLogoStyle | undefined;
}>;

async function loadSocialFooter(targetWidth: number): Promise<Raster> {
  const source = sharp(resolve(ASSETS_DIR, 'footer-new-poster.png'));
  const meta = await source.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.height < SOCIAL_FOOTER_SOURCE_HEIGHT
  ) {
    throw new Error('Could not read dimensions of social footer asset.');
  }

  const width = Math.round(targetWidth);
  const height = Math.round((SOCIAL_FOOTER_SOURCE_HEIGHT / meta.width) * width);
  const data = await source
    .extract({
      left: 0,
      top: meta.height - SOCIAL_FOOTER_SOURCE_HEIGHT,
      width: meta.width,
      height: SOCIAL_FOOTER_SOURCE_HEIGHT,
    })
    .resize({ width, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return { data, width, height };
}

/**
 * The department footer band on its own — footer-new-poster.png cropped to its artwork and
 * resized to `targetWidth`, transparent above it.
 *
 * Exported for exactly the reason renderGovernmentLockup is: apps/api serves it to a browser
 * that lays it over an UNBRANDED clip in CSS (the Dynamic Poster crop preview), so this stays
 * the one source of the artwork instead of a copy under apps/web/public. Only the bytes are
 * returned — the band keeps its own aspect, so a caller places it by width alone and lets the
 * height follow, which is also what stops a second copy of 239:3376 existing anywhere.
 */
export async function renderSocialFooterBand(
  targetWidth: number,
): Promise<Buffer> {
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    throw new Error('Social footer band target width must be positive.');
  }
  return (await loadSocialFooter(targetWidth)).data;
}

export type SocialChromeLayers = Readonly<{
  logo: Readonly<{ png: Buffer; width: number; height: number }>;
  footer: Readonly<{ png: Buffer; width: number; height: number }>;
  /** The badge's inset from the top and right edges, in pixels of this frame. */
  margin: number;
}>;

/**
 * Both chrome graphics rendered for a frame `frameWidth` pixels wide, with the badge's inset
 * already resolved to pixels — everything a caller needs to composite them itself.
 *
 * WHY THIS IS SEPARATE FROM overlayTwitterChrome. That function stamps the chrome onto a still
 * poster with sharp, and it also EXTENDS the canvas so the band sits below the artwork rather
 * than over it. Neither is available to a caller compositing onto video, where ffmpeg does the
 * drawing and the frame size is fixed by the crop. So this returns the layers and the offsets
 * and leaves the drawing to whoever asked — while keeping the placement in ONE place, derived
 * from the same SOCIAL_LOCKUP_* ratios the poster and the crop preview use.
 *
 * Placed by WIDTH on both axes, top margin included: that is what makes one number serve a
 * 4:5 poster and a clip of any shape alike, and it is the rule the browser preview follows
 * with a percentage `margin-top`. See poster-chrome.ts.
 */
export async function socialChromeLayers(
  frameWidth: number,
): Promise<SocialChromeLayers> {
  if (!Number.isFinite(frameWidth) || frameWidth <= 0) {
    throw new Error('Social chrome frame width must be positive.');
  }
  const [lockup, footer] = await Promise.all([
    renderGovernmentLockup(frameWidth * SOCIAL_LOCKUP_WIDTH_RATIO),
    loadSocialFooter(frameWidth),
  ]);
  return {
    logo: { png: lockup.data, width: lockup.width, height: lockup.height },
    footer: { png: footer.data, width: footer.width, height: footer.height },
    margin: Math.round(frameWidth * SOCIAL_LOCKUP_MARGIN_RATIO),
  };
}

// Canva's Magic Layers is useful for the model-painted body of a poster, but it also tries to
// reconstruct the small official emblem and the fine-print footer when they arrive flattened
// into that same bitmap. Preserve those pixels exactly by lifting the two chrome rectangles out
// of an already-finished poster. The returned base has transparent holes under them and the two
// crops carry the exact pixels that were removed, so stacking base -> logo -> footer is
// pixel-identical without requiring a separately stored pre-chrome render.
//
// The CARD's logo crop is deliberately the complete rectangular badge footprint, including its
// few background-coloured corner pixels. That makes the reconstruction lossless while ensuring
// Magic Layers sees none of the emblem or Marathi wordmark underneath the separate Canva layer.
//
// The CIRCLE and QUARTER badges are not rectangles: their bounding box holds a good deal of the
// poster's own artwork (a quarter of radius 224 leaves ~21% of its square outside the arc). So
// for those the split follows the badge's own alpha — every pixel the badge touches goes to the
// logo layer, everything else stays in the base — which is still pixel-identical when restacked,
// because each pixel lives in exactly one layer at its finished value.
export async function buildCanvaSocialPosterLayers(
  poster: Buffer,
  options: SocialChromeOptions = {},
): Promise<CanvaSocialPosterLayers> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read social poster dimensions for Canva.');
  }

  const style = options.logoStyle ?? DEFAULT_SOCIAL_LOGO_STYLE;
  const [lockup, footerRaster] = await Promise.all([
    placeSocialLogo(style, meta.width),
    loadSocialFooter(meta.width),
  ]);
  const logoLeft = lockup.left;
  const logoTop = lockup.top;
  const footerTop = meta.height - footerRaster.height;
  if (logoLeft < 0 || logoTop < 0 || footerTop < 0) {
    throw new Error(
      'Social poster is too small for its Canva branding layers.',
    );
  }

  const rectangular = socialLogoShape(style) === 'card';
  // The badge's own coverage, one byte per pixel of its box: non-zero wherever it paints.
  const badgeAlpha = rectangular
    ? null
    : await sharp(lockup.data).ensureAlpha().extractChannel(3).raw().toBuffer();
  const [logo, footer, rawBase] = await Promise.all([
    rectangular
      ? sharp(poster)
          .extract({
            left: logoLeft,
            top: logoTop,
            width: lockup.width,
            height: lockup.height,
          })
          .png()
          .toBuffer()
      : sharp(poster)
          .extract({
            left: logoLeft,
            top: logoTop,
            width: lockup.width,
            height: lockup.height,
          })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            // Raw RGB + a binary alpha joined as raw bytes. `removeAlpha().joinChannel()` chained
            // silently returns a THREE-channel PNG (see source-overlay.ts), so build RGBA by hand.
            const rgba = Buffer.alloc(info.width * info.height * 4);
            for (let i = 0; i < info.width * info.height; i += 1) {
              rgba[i * 4] = data[i * info.channels]!;
              rgba[i * 4 + 1] = data[i * info.channels + 1]!;
              rgba[i * 4 + 2] = data[i * info.channels + 2]!;
              rgba[i * 4 + 3] = badgeAlpha![i]! > 0 ? 255 : 0;
            }
            return sharp(rgba, {
              raw: { width: info.width, height: info.height, channels: 4 },
            })
              .png()
              .toBuffer();
          }),
    sharp(poster)
      .extract({
        left: 0,
        top: footerTop,
        width: meta.width,
        height: footerRaster.height,
      })
      .png()
      .toBuffer(),
    sharp(poster).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (rawBase.info.channels !== 4) {
    throw new Error('Could not prepare an RGBA social poster for Canva.');
  }
  const clearAlpha = (
    left: number,
    top: number,
    width: number,
    height: number,
  ): void => {
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) {
        rawBase.data[(y * meta.width + x) * 4 + 3] = 0;
      }
    }
  };
  if (badgeAlpha) {
    for (let y = 0; y < lockup.height; y += 1) {
      for (let x = 0; x < lockup.width; x += 1) {
        if (badgeAlpha[y * lockup.width + x]! > 0) {
          rawBase.data[((logoTop + y) * meta.width + logoLeft + x) * 4 + 3] = 0;
        }
      }
    }
  } else {
    clearAlpha(logoLeft, logoTop, lockup.width, lockup.height);
  }
  clearAlpha(0, footerTop, meta.width, footerRaster.height);
  const base = await sharp(rawBase.data, { raw: rawBase.info })
    .png()
    .toBuffer();

  return {
    base,
    logo: {
      png: logo,
      left: logoLeft,
      top: logoTop,
      width: lockup.width,
      height: lockup.height,
    },
    footer: {
      png: footer,
      left: 0,
      top: footerTop,
      width: meta.width,
      height: footerRaster.height,
    },
    width: meta.width,
    height: meta.height,
  };
}

// Composite the white emblem + Marathi wordmark lockup into its corner (top-right on the default
// card; see SOCIAL_LOGO_STYLES for the rotation), and footer-new-poster.png onto a strip appended
// below the artwork, returning a new PNG.
//
// IDEMPOTENCE. This runs on initial renders AND on pixel-feedback re-renders, and a feedback
// round edits the poster this function last produced — which already carries its appended
// strip. Extending unconditionally would grow the poster by a strip every round. So the two
// cases are told apart by ASPECT rather than by a flag or a stored dimension: fresh artwork
// comes back at DESIGN_ASPECT (1:1.175), a finished poster at FINISHED_ASPECT (4:5). Aspect
// rather than absolute height because the model is not contractually bound to return 1280
// wide, and everything else in this file already scales off the width it actually got.
//
// THE LOGO STYLE MUST BE THE SAME ON EVERY STAMP OF ONE RUN. A feedback round erases the badge it
// can see and this function puts it back, so a different style on the second stamp would move the
// badge between versions. Callers pass the run's style (socialLogoStyleFor in apps/api).
export async function overlayTwitterChrome(
  poster: Buffer,
  options: SocialChromeOptions = {},
): Promise<Buffer> {
  const meta = await sharp(poster).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Could not read poster dimensions for chrome overlay.');
  }

  const [lockup, footer] = await Promise.all([
    placeSocialLogo(options.logoStyle ?? DEFAULT_SOCIAL_LOGO_STYLE, meta.width),
    loadSocialFooter(meta.width),
  ]);

  const joined = await joinFooterStrip(
    poster,
    SOCIAL_FOOTER_JOIN,
    footer.height,
  );
  const base = joined.base;
  const baseHeight = joined.height;

  return sharp(base)
    .composite([
      {
        input: lockup.data,
        left: lockup.left,
        top: lockup.top,
      },
      { input: footer.data, left: 0, top: baseHeight - footer.height },
    ])
    .png()
    .toBuffer();
}
