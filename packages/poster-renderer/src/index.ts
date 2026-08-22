export const POSTER_RENDERER_PACKAGE = '@dgipr/poster-renderer';

export type PosterDimensions = Readonly<{
  width: number;
  height: number;
}>;

export {
  buildScenePrompt,
  buildArticleScenePrompt,
  buildCmoCirclePhotoPrompt,
} from './build-scene-prompt.js';
export { generateImage, editImage, IMAGE_MODEL } from './openai-image.js';
export type { GenerateImageOptions } from './openai-image.js';
export { loadBrandAssets, loadArticleAssets } from './assets.js';
export type { BrandAssets } from './assets.js';
export { loadArticlePdfAssets } from './assets.js';
export type { ArticlePdfAssets } from './assets.js';
export {
  buildPosterHtml,
  headStrings,
  POSTER_WIDTH,
  POSTER_HEIGHT,
  POSTER_VARIANTS,
} from './poster-template.js';
export type { BuildPosterHtmlInput, PosterVariant } from './poster-template.js';
export {
  buildArticlePosterHtml,
  ARTICLE_WIDTH,
  ARTICLE_HEIGHT,
} from './article-template.js';
export type { BuildArticlePosterHtmlInput } from './article-template.js';
export { overlayArticleChrome } from './article-chrome.js';
export {
  buildCanvaSocialPosterLayers,
  overlayTwitterChrome,
  // The Government of Maharashtra emblem + Marathi wordmark as one raster.
  // Exported so apps/api can serve it to the video review players, which lay
  // it over an unbranded scene clip in CSS — the stitch owns the burned-in
  // branding, so this stays the single source of the artwork.
  renderGovernmentLockup,
  SOCIAL_ARTWORK_HEIGHT,
  SOCIAL_ARTWORK_SIZE,
  SOCIAL_POSTER_HEIGHT,
} from './twitter-chrome.js';
export type {
  CanvaPosterLayer,
  CanvaSocialPosterLayers,
  GovernmentLockupRaster,
} from './twitter-chrome.js';
export { overlayCmoChrome, CMO_POSTER_SIZE } from './cmo-chrome.js';
export {
  overlayYoutubeChrome,
  fitToYoutubeThumbnail,
  YOUTUBE_THUMBNAIL_WIDTH,
  YOUTUBE_THUMBNAIL_HEIGHT,
} from './youtube-chrome.js';
export {
  annotateFeedbackRegions,
  CLEAR_REGION_LETTERS,
} from './feedback-marker.js';
export type { NormalizedRegion } from './feedback-marker.js';
// Did a "free this space" edit actually free the space? READ-ONLY — it measures the
// returned poster and reports, and never writes a pixel (see clear-region-check.ts for
// why a code-composited fill was rejected). Log-only at the call site for now.
export {
  measureClearedRegions,
  formatClearRegionReport,
} from './clear-region-check.js';
export type {
  ClearRegionMeasurement,
  ClearRegionRect,
} from './clear-region-check.js';
// Measures what colours a rendered poster actually uses, so the palette rotation can spread away
// from what SHIPPED rather than from what was merely assigned (see poster-colours.ts).
export { measurePosterColours, hueBucketOf } from './poster-colours.js';
export type { PosterColours, HueBucket } from './poster-colours.js';
// Turns a picture an officer uploaded into upright, bounded PNG bytes — the one
// representation the image clients may assume they are holding.
export {
  normalizeReferenceImage,
  UnreadableImageError,
} from './reference-image.js';
export { renderHtmlToPng } from './render-html.js';
export type { RenderOptions } from './render-html.js';
export { renderHtmlToPdf, ChromiumUnavailableError } from './render-html.js';
export type { PdfRenderOptions, PdfMargin } from './render-html.js';
// The article as a printable A4 document: the same Chromium/HarfBuzz path the posters use,
// emitted as a real PDF rather than a screenshot, so the Devanagari is shaped correctly AND
// the text stays vector (selectable, sharp at any zoom) instead of rasterised.
export {
  buildArticlePdfHtml,
  formatDocDate,
  paragraphsOf,
  A4_MARGIN,
} from './article-pdf-template.js';
export type {
  BuildArticlePdfHtmlInput,
  ArticlePdfLanguage,
} from './article-pdf-template.js';
export { generateArticlePdf } from './generate-article-pdf.js';
export type { GenerateArticlePdfInput } from './generate-article-pdf.js';
export { generatePoster } from './generate-poster.js';
export type {
  GeneratePosterInput,
  GeneratedPoster,
} from './generate-poster.js';
export { generateArticlePoster } from './generate-article-poster.js';
export type {
  GenerateArticlePosterInput,
  GeneratedArticlePoster,
} from './generate-article-poster.js';
// Explainer-video assembly: strip Veo's audio + stitch scene clips into one
// browser-safe silent MP4; crop stills to the Veo aspect before the user sees
// them; mux a fit-to-window Marathi narration track onto the stitched video.
export {
  assembleSilentVideo,
  cropToAspect,
  decodeAudioToWav,
  muxNarration,
  validateSceneClip,
  validateVideoOutput,
  wavDurationSeconds,
  resolveFfmpeg,
  type NarrationSegment,
  type SceneClipCheckOptions,
  type SceneOverlay,
  type VideoAssemblyOptions,
  type VideoValidation,
} from './video/assemble.js';
// The burned-in Marathi key point: Chromium typesets it (the only correct
// Devanagari shaper here) and assembleSilentVideo composites it after Veo, so
// no image or video model ever renders the text.
export {
  renderCaptionOverlay,
  buildCaptionHtml,
  CAPTION_FRAME_SIZE,
  type CaptionAspect,
} from './video/caption-overlay.js';
