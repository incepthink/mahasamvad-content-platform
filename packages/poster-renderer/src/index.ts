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
export { overlayTwitterChrome } from './twitter-chrome.js';
export { overlayCmoChrome } from './cmo-chrome.js';
export { annotateFeedbackRegions } from './feedback-marker.js';
export type { NormalizedRegion } from './feedback-marker.js';
// Measures what colours a rendered poster actually uses, so the palette rotation can spread away
// from what SHIPPED rather than from what was merely assigned (see poster-colours.ts).
export { measurePosterColours, hueBucketOf } from './poster-colours.js';
export type { PosterColours, HueBucket } from './poster-colours.js';
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
  muxNarration,
  wavDurationSeconds,
  resolveFfmpeg,
  type NarrationSegment,
  type SceneOverlay,
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
