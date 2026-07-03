export const POSTER_RENDERER_PACKAGE = '@dgipr/poster-renderer';

export type PosterDimensions = Readonly<{
  width: number;
  height: number;
}>;

export { buildScenePrompt } from './build-scene-prompt.js';
export { generateImage, IMAGE_MODEL } from './openai-image.js';
export { loadBrandAssets } from './assets.js';
export type { BrandAssets } from './assets.js';
export {
  buildPosterHtml,
  POSTER_WIDTH,
  POSTER_HEIGHT,
} from './poster-template.js';
export type { BuildPosterHtmlInput } from './poster-template.js';
export { renderHtmlToPng } from './render-html.js';
export type { RenderOptions } from './render-html.js';
export { generatePoster } from './generate-poster.js';
export type {
  GeneratePosterInput,
  GeneratedPoster,
} from './generate-poster.js';
