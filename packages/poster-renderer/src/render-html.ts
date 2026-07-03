// Render a self-contained HTML poster to a PNG with headless Chromium (Playwright).
// Chromium is what makes the Devanagari correct: its HarfBuzz shaper lays out the
// conjuncts that GPT-image mangled. We set the viewport to the exact poster size and
// screenshot the page, so the PNG is pixel-for-pixel the HTML at full resolution.

import { chromium, type Browser } from 'playwright';
import { POSTER_WIDTH, POSTER_HEIGHT } from './poster-template.js';

export type RenderOptions = Readonly<{
  width?: number;
  height?: number;
  // Devicescale > 1 supersamples for extra-crisp text/edges (e.g. 2 → 2160×2700).
  deviceScaleFactor?: number;
}>;

export async function renderHtmlToPng(
  html: string,
  options: RenderOptions = {},
): Promise<Buffer> {
  const width = options.width ?? POSTER_WIDTH;
  const height = options.height ?? POSTER_HEIGHT;
  const deviceScaleFactor = options.deviceScaleFactor ?? 2;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor,
    });
    // The HTML embeds the font + images as data URIs, so 'load' guarantees everything
    // (font decode included) is ready; block on document.fonts as a belt-and-braces.
    // Passed as a string so this Node package needn't pull in the DOM lib for one
    // browser-context call.
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready.then(() => true)');
    return await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
    });
  } finally {
    await browser?.close();
  }
}
