// The SPELLING REFERENCE for an exact-text red-box edit: the string the officer wants on the
// poster, typeset by Chromium in Mukta, large, black on white.
//
// An image model copies a SHAPE it can see far more reliably than it spells a string it was
// told — which is the whole of the ९↔१ defect and of a broken jodakshar. So the edit call is
// handed this picture beside the crop and told to copy its letters, conjuncts and digits while
// keeping the poster's own font, weight, colour and size. Chromium's HarfBuzz shaper is what
// makes the conjuncts in it correct (render-html.ts's contract); no model draws this picture.
//
// Free harness: `npx tsx src/spelling-reference.ts [text]` writes spelling-reference.png.

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { MARATHI_FONT_FAMILY, loadSpellingAssets } from './assets.js';
import { renderHtmlToPng } from './render-html.js';

export const SPELLING_REFERENCE_WIDTH = 1024;
export const SPELLING_REFERENCE_HEIGHT = 512;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Big enough that each akshara is unmistakable, small enough that a typical correction fits on
// one or two lines. Counted in GRAPHEMES (one akshara = one cluster), not code points, which
// would count every matra and virama separately and shrink a Marathi word for nothing.
const graphemes = new Intl.Segmenter('mr', { granularity: 'grapheme' });

function fontSizeFor(text: string): number {
  const length = Math.max(1, [...graphemes.segment(text)].length);
  return Math.round(Math.min(220, Math.max(64, 1700 / length)));
}

export function buildSpellingReferenceHtml(
  text: string,
  fontFaceCss: string,
): string {
  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8" />
<style>
${fontFaceCss}
  html, body {
    margin: 0;
    padding: 0;
    width: ${SPELLING_REFERENCE_WIDTH}px;
    height: ${SPELLING_REFERENCE_HEIGHT}px;
    background: #ffffff;
  }
  .stage {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 32px 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .text {
    font-family: '${MARATHI_FONT_FAMILY}', sans-serif;
    font-weight: 700;
    font-size: ${fontSizeFor(text)}px;
    line-height: 1.35;
    color: #000000;
    overflow-wrap: anywhere;
  }
</style>
</head>
<body><div class="stage"><div class="text">${escapeHtml(text)}</div></div></body>
</html>`;
}

/** The target string as a black-on-white PNG, for the image model to copy letter shapes from. */
export async function renderSpellingReference(text: string): Promise<Buffer> {
  const { fontFaceCss } = await loadSpellingAssets();
  return renderHtmlToPng(buildSpellingReferenceHtml(text.trim(), fontFaceCss), {
    width: SPELLING_REFERENCE_WIDTH,
    height: SPELLING_REFERENCE_HEIGHT,
    deviceScaleFactor: 1,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const text = process.argv[2] ?? '११ सदस्यांचे इलेक्ट्रॉनिक्स';
  const png = await renderSpellingReference(text);
  await writeFile('spelling-reference.png', png);
  console.log(
    `wrote spelling-reference.png (${png.length} bytes) for «${text}»`,
  );
}
