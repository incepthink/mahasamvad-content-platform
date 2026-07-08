// Build the LANDSCAPE article image as a self-contained HTML document (Playwright
// screenshots it into the final PNG via render-html.ts). Same idea as poster-template.ts —
// Chromium's HarfBuzz shaper typesets the Marathi from the already-correct `copy`, so the
// Devanagari conjuncts are never mangled — but this is the newer landscape layout that
// mirrors the DGIPR farm-article references (farm-article-ref1/2/3):
//
//   • a full-bleed AI photo running top→bottom (no orange bands),
//   • one bold, centred scheme headline on a semi-transparent light panel on the LEFT
//     (maroon text, ref1 style),
//   • wrapped by the landscape article-header-footer.png frame (महासंवाद logo top-left,
//     navy department pill + white social strip at the bottom, transparent elsewhere).
//
// The AI supplies ONLY the photo; the headline and frame are drawn here. The portrait
// poster (poster-template.ts / generatePoster) is kept separately for other image types.

import type { Copy } from '@dgipr/schemas';
import type { BrandAssets } from './assets.js';
import { esc, headStrings } from './poster-template.js';

// Landscape canvas: exactly 2× the 696×392 article frame so the overlaid frame keeps its
// aspect (no distortion). With render-html.ts's deviceScaleFactor:2 the PNG is 2784×1568.
export const ARTICLE_WIDTH = 1392;
export const ARTICLE_HEIGHT = 784;

export type BuildArticlePosterHtmlInput = Readonly<{
  copy: Copy;
  // Background photo for the full-bleed image zone, as a data URI (or any URL Chromium loads).
  sceneDataUri: string;
  assets: BrandAssets;
}>;

export function buildArticlePosterHtml(input: BuildArticlePosterHtmlInput): string {
  const { copy, sceneDataUri, assets } = input;
  // Only the scheme headline is shown; headStrings resolves the best heading per post_type.
  const { headline } = headStrings(copy);

  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Noto Sans Devanagari';
    src: url('${assets.fontDataUri}') format('truetype');
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  :root {
    --maroon: #7a1512;
    --cream: 255, 247, 234;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ARTICLE_WIDTH}px; height: ${ARTICLE_HEIGHT}px; }
  body {
    font-family: 'Noto Sans Devanagari', sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .stage {
    position: relative;
    width: ${ARTICLE_WIDTH}px;
    height: ${ARTICLE_HEIGHT}px;
    overflow: hidden;
    background: #e9eef0;
  }

  /* Layers (bottom → top): photo · light text panel · headline · frame */

  /* Full-bleed photo — runs the whole canvas top→bottom, so no orange bands crop it. */
  .photo { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* Semi-transparent light/cream panel on the left, feathered into the photo on the right;
     runs the full canvas height (behind the frame's logo at top and footer band at bottom). */
  .panel {
    position: absolute;
    left: 0; top: 0; width: 720px; height: 100%;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 56px;
    background: linear-gradient(
      90deg,
      rgba(var(--cream), 0.93) 0%,
      rgba(var(--cream), 0.90) 62%,
      rgba(var(--cream), 0.70) 84%,
      rgba(var(--cream), 0) 100%
    );
  }
  .headline {
    font-weight: 900;
    font-size: 52px;
    line-height: 1.2;
    letter-spacing: -.3px;
    text-align: center;
    text-wrap: balance;
    color: var(--maroon);
  }

  /* The article frame overlays the logo, the navy department pill and the white social
     strip (all opaque in the PNG); the rest of the frame is transparent. */
  .frame { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 10; display: block; pointer-events: none; }
</style>
</head>
<body>
  <div class="stage">
    <div class="photo"><img src="${sceneDataUri}" alt="" /></div>
    <div class="panel"><h1 class="headline">${esc(headline)}</h1></div>
    <img class="frame" src="${assets.frameDataUri}" alt="" />
  </div>
</body>
</html>`;
}
