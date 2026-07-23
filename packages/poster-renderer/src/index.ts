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
export { generateImage, IMAGE_MODEL } from './openai-image.js';
export type { GenerateImageOptions } from './openai-image.js';
export { loadBrandAssets, loadArticleAssets } from './assets.js';
export type { BrandAssets } from './assets.js';
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
export { renderHtmlToPng } from './render-html.js';
export type { RenderOptions } from './render-html.js';
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
} from './video/assemble.js';
