export const POSTER_RENDERER_PACKAGE = '@dgipr/poster-renderer';

export type PosterDimensions = Readonly<{
  width: number;
  height: number;
}>;

export { buildScenePrompt, buildArticleScenePrompt } from './build-scene-prompt.js';
export { generateImage, IMAGE_MODEL } from './openai-image.js';
export { loadBrandAssets, loadArticleAssets } from './assets.js';
export type { BrandAssets } from './assets.js';
export {
  buildPosterHtml,
  POSTER_WIDTH,
  POSTER_HEIGHT,
  POSTER_VARIANTS,
} from './poster-template.js';
export type {
  BuildPosterHtmlInput,
  PosterVariant,
} from './poster-template.js';
export {
  buildArticlePosterHtml,
  ARTICLE_WIDTH,
  ARTICLE_HEIGHT,
} from './article-template.js';
export type { BuildArticlePosterHtmlInput } from './article-template.js';
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
