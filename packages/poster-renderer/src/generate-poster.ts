// Orchestrate poster rendering (PROJECT_CONTEXT step 14): the image model paints only a
// text-free background scene, then we typeset the poster in HTML and screenshot it.
//
//   copy --> buildScenePrompt --> GPT-image (photo) ─┐
//                                                     ├─> buildPosterHtml --> Playwright --> PNG
//               cropped emblem + footer + webfont ────┘
//
// This replaces the old "let GPT-image typeset the whole poster" flow, which mangled the
// Marathi conjuncts. See build-scene-prompt.ts / poster-template.ts / render-html.ts.

import type { Copy } from '@dgipr/schemas';
import { buildScenePrompt } from './build-scene-prompt.js';
import { generateImage } from './openai-image.js';
import { loadBrandAssets } from './assets.js';
import { buildPosterHtml, type PosterVariant } from './poster-template.js';
import { renderHtmlToPng } from './render-html.js';

export type GeneratePosterInput = Readonly<{
  copy: Copy;
  // Optional pre-rendered scene (PNG). When given, the OpenAI image call is skipped —
  // used by the offline preview script and for cheap re-renders of the template.
  sceneImage?: Buffer;
  // Which reference layout to use. Omit to let the template pick one at random.
  variant?: PosterVariant;
}>;

export type GeneratedPoster = Readonly<{
  png: Buffer;
  // The text-free prompt sent to the image model (null when a sceneImage was supplied).
  scenePrompt: string | null;
  // The background photo used (generated or supplied), for saving/proofing.
  sceneImage: Buffer;
}>;

function toDataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function generatePoster(
  input: GeneratePosterInput,
): Promise<GeneratedPoster> {
  const { copy } = input;

  let scenePrompt: string | null = null;
  let sceneImage = input.sceneImage;
  if (!sceneImage) {
    scenePrompt = buildScenePrompt(copy);
    sceneImage = await generateImage(scenePrompt);
  }

  const assets = await loadBrandAssets();
  const html = buildPosterHtml({
    copy,
    sceneDataUri: toDataUri(sceneImage),
    assets,
    // exactOptionalPropertyTypes: only set `variant` when the caller supplied one.
    ...(input.variant ? { variant: input.variant } : {}),
  });
  const png = await renderHtmlToPng(html);

  return { png, scenePrompt, sceneImage };
}
