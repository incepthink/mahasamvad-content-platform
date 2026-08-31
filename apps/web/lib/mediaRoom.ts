/**
 * What the media room is looking at — the one place the four generation types on
 * that page are named, recognised and measured.
 *
 * It exists because THREE separate things need the same answer and must not
 * disagree: the card (which visual to render), the masonry packer (how tall the
 * card will be, before the image has loaded) and the generating placeholder
 * (what shape to hold open while the render is paid for).
 *
 * Imports from `@dgipr/schemas` are TYPE-ONLY, the `lib/strings.ts` rule: a value
 * import pulls zod into every bundle that reads one of these labels. The social
 * category test is therefore written out rather than taken from
 * `isSocialCategory` — the same trade `runFormatKey` makes, for the same reason.
 */
import type { GenerationSummary } from '@dgipr/schemas';

export type MediaKind = 'creative' | 'youtube' | 'banner' | 'caption';

/**
 * Which of the media room's four output types a run is.
 *
 * `outputType === 'article'` on a SOCIAL run means "this run renders no poster"
 * (the caption-only lane), which is why it is tested before the category: a
 * caption run is filed under `facebook` and would otherwise read as a poster.
 */
export function mediaKindOf(
  item: Pick<GenerationSummary, 'category' | 'outputType'>,
): MediaKind {
  const social = item.category === 'twitter' || item.category === 'facebook';
  if (social && item.outputType === 'article') return 'caption';
  if (item.category === 'youtube') return 'youtube';
  if (social) return 'creative';
  return 'banner';
}

/** True for the three kinds that produce a picture. Caption is the only one that does not. */
export function hasArtwork(kind: MediaKind): boolean {
  return kind !== 'caption';
}

/**
 * Width ÷ height of the artwork each kind delivers. These are the REAL rendered
 * sizes, not design preferences — keep them in step with the renderer:
 *
 *   creative → 1280x1600  (twitter-chrome.ts, the finished 4:5 social poster)
 *   youtube  → 1280x720   (youtube-chrome.ts, artwork + the joined footer band)
 *   banner   → 1536x1024  (the article poster's gpt-image canvas)
 *
 * They are an ESTIMATE, never a promise: `MediaCard` re-measures each image from
 * its own `naturalWidth/naturalHeight` on load and lets the real ratio win. These
 * values only decide the box held open before the bytes arrive — which is exactly
 * the window the generating animation occupies, so being close matters.
 *
 * `caption` has no artwork; its number is the shape its text tile is drawn at.
 */
export const MEDIA_KIND_ASPECT: Record<MediaKind, number> = {
  creative: 1280 / 1600,
  youtube: 1280 / 720,
  banner: 1536 / 1024,
  caption: 1 / 1,
};

export function aspectOf(kind: MediaKind): number {
  return MEDIA_KIND_ASPECT[kind];
}

/**
 * Roughly how tall a card will be, in multiples of the column width — the one
 * number `MasonryGrid` packs on. Only the ratio between items matters, so this
 * is deliberately unitless and does not need the pixel width of anything.
 *
 * An over- or under-estimate costs a slightly uneven column, never a wrong
 * layout: the cards themselves are sized by their own content.
 */
// A card is now the artwork and nothing else, so an image card's height IS its
// aspect ratio — there is no text strip under it to add.
const CAPTION_TILE = 0.85; // the white text box, at its typical clamped height

export function estimateCardHeight(
  item: Pick<GenerationSummary, 'category' | 'outputType'>,
): number {
  const kind = mediaKindOf(item);
  if (kind === 'caption') return CAPTION_TILE;
  return 1 / aspectOf(kind);
}
