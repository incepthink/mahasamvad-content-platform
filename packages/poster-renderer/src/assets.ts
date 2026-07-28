// Load the brand-constant assets the HTML poster template composites: the Devanagari
// webfont and the DGIPR header/footer frame (राजमुद्रा emblem top-right + footer band,
// transparent elsewhere). All are returned as base64 data URIs so the template is a single
// self-contained HTML string (no file:// or network fetches for Playwright to resolve).
// Paths resolve relative to this module, so it works whether it runs from dist/ (built) or
// src/ (tsx dev scripts).

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

// Mukta (Ek Type, OFL — see assets/fonts/Mukta-OFL.txt), NOT Noto Sans Devanagari.
// Noto fails to form the C+र conjuncts Marathi is full of: it leaves an explicit halant
// under the ट and sets र as a separate wide letter, so इलेक्ट्रॉनिक्स comes out looking broken
// to a Marathi reader. That defect was shipping in every poster and PDF. Mukta forms the
// ligature correctly and covers Latin, ०-९, ₹, danda and curly quotes, so English and Hindi
// exports stay tofu-free.
export const MARATHI_FONT_FAMILY = 'Mukta';

// Mukta is a STATIC family — one file per weight, unlike the single variable Noto file it
// replaces. So a caller states the weights its template actually uses and gets only those
// embedded; a poster does not need to carry the PDF's bold cuts as base64.
const FONT_FILES = {
  400: 'fonts/Mukta-Regular.ttf',
  600: 'fonts/Mukta-SemiBold.ttf',
  700: 'fonts/Mukta-Bold.ttf',
  800: 'fonts/Mukta-ExtraBold.ttf',
} as const;

export type MarathiFontWeight = keyof typeof FONT_FILES;

// The whole @font-face block rather than a bare URL: with a static family the number of
// blocks varies per caller, so the templates cannot hardcode one.
async function fontFaceCss(
  weights: readonly MarathiFontWeight[],
): Promise<string> {
  const blocks = await Promise.all(
    weights.map(async (weight) => {
      const src = await dataUri(FONT_FILES[weight], 'font/ttf');
      return `  @font-face {
    font-family: '${MARATHI_FONT_FAMILY}';
    src: url('${src}') format('truetype');
    font-weight: ${weight};
    font-style: normal;
    font-display: block;
  }`;
    }),
  );
  return blocks.join('\n');
}

export type BrandAssets = Readonly<{
  // Ready-to-embed @font-face block(s) for MARATHI_FONT_FAMILY.
  fontFaceCss: string;
  // Full-canvas transparent DGIPR frame: राजमुद्रा emblem + "महाराष्ट्र शासन" top-right and
  // the footer band (department line + social handles) bottom, overlaid on the poster.
  frameDataUri: string;
}>;

async function dataUri(file: string, mime: string): Promise<string> {
  const buf = await readFile(resolve(ASSETS_DIR, file));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function loadBrandAssets(): Promise<BrandAssets> {
  // Body copy + the ExtraBold headline (poster-template.ts).
  const [fontFaceCss_, frameDataUri] = await Promise.all([
    fontFaceCss([400, 800]),
    dataUri('poster-header-footer.png', 'image/png'),
  ]);
  return { fontFaceCss: fontFaceCss_, frameDataUri };
}

// The landscape article frame (article-header-footer.png): महासंवाद logo floats top-left, an
// opaque navy department pill + full-width white social strip at the bottom, transparent
// everywhere else. Used by the landscape article poster (article-template.ts); loadBrandAssets
// above keeps loading the portrait poster frame.
export async function loadArticleAssets(): Promise<BrandAssets> {
  // Body copy + the ExtraBold headline (article-template.ts).
  const [fontFaceCss_, frameDataUri] = await Promise.all([
    fontFaceCss([400, 800]),
    dataUri('article-header-footer.png', 'image/png'),
  ]);
  return { fontFaceCss: fontFaceCss_, frameDataUri };
}

// The printable A4 article document (article-pdf-template.ts) needs the EMBLEM on its own,
// not either poster frame — hence its own type rather than a widened BrandAssets.
// poster-logo-new.png is the 398x400 gold राजमुद्रा with NO baked-in wordmark, which is what
// makes it the right letterhead asset: at 21mm it is ~5x oversampled, while every Devanagari
// line beside it stays Chromium-typeset vector. (article-logo.png / poster-logo.png bake
// their Marathi into raster pixels and would print visibly soft next to real text.)
export type ArticlePdfAssets = Readonly<{
  // Ready-to-embed @font-face block(s) for MARATHI_FONT_FAMILY.
  fontFaceCss: string;
  // The राजमुद्रा state emblem, centred at the top of page 1.
  emblemDataUri: string;
}>;

export async function loadArticlePdfAssets(): Promise<ArticlePdfAssets> {
  // Body copy, the letterhead's bold lines, and the ExtraBold document title.
  const [fontFaceCss_, emblemDataUri] = await Promise.all([
    fontFaceCss([400, 700, 800]),
    dataUri('poster-logo-new.png', 'image/png'),
  ]);
  return { fontFaceCss: fontFaceCss_, emblemDataUri };
}

// The explainer video's burned-in key-point overlay needs the webfont ALONE:
// it is a transparent PNG laid over live footage, so any brand frame would
// stamp a poster's chrome across somebody's video.
export type CaptionAssets = Readonly<{ fontFaceCss: string }>;

export async function loadCaptionAssets(): Promise<CaptionAssets> {
  // The key-point panel is set at 600 and nothing else — one weight to embed.
  return { fontFaceCss: await fontFaceCss([600]) };
}
