// Orchestrate the LANDSCAPE article image: the image model paints only a text-free,
// right-biased background photo, then we typeset the headline + frame in HTML and screenshot
// it. Same pipeline as generate-poster.ts (kept for the portrait poster), but wired to the
// article scene prompt, the article frame and the landscape article template.
//
//   copy --> buildArticleScenePrompt --> GPT-image (photo) ─┐
//                                                            ├─> buildArticlePosterHtml --> Playwright --> PNG
//                 article frame + webfont ───────────────────┘

import type { Copy } from '@dgipr/schemas';
import { buildArticleScenePrompt } from './build-scene-prompt.js';
import { generateImage } from './openai-image.js';
import { loadArticleAssets } from './assets.js';
import {
  buildArticlePosterHtml,
  ARTICLE_WIDTH,
  ARTICLE_HEIGHT,
} from './article-template.js';
import { renderHtmlToPng } from './render-html.js';

export type GenerateArticlePosterInput = Readonly<{
  copy: Copy;
  // Optional pre-rendered scene (PNG). When given, the OpenAI image call is skipped —
  // used by the offline preview script and for cheap re-renders of the template.
  sceneImage?: Buffer;
}>;

export type GeneratedArticlePoster = Readonly<{
  png: Buffer;
  // The text-free prompt sent to the image model (null when a sceneImage was supplied).
  scenePrompt: string | null;
  // The background photo used (generated or supplied), for saving/proofing.
  sceneImage: Buffer;
}>;

function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function generateArticlePoster(
  input: GenerateArticlePosterInput,
): Promise<GeneratedArticlePoster> {
  const { copy } = input;

  let scenePrompt: string | null = null;
  let sceneImage = input.sceneImage;
  if (!sceneImage) {
    scenePrompt = buildArticleScenePrompt(copy);
    sceneImage = await generateImage(scenePrompt);
  }

  const assets = await loadArticleAssets();
  const html = buildArticlePosterHtml({
    copy,
    sceneDataUri: toDataUri(sceneImage),
    assets,
  });
  const png = await renderHtmlToPng(html, {
    width: ARTICLE_WIDTH,
    height: ARTICLE_HEIGHT,
  });

  return { png, scenePrompt, sceneImage };
}
