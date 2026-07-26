// Render self-contained HTML with headless Chromium (Playwright) — to a PNG (posters) or a
// PDF (the printable article document). Chromium is what makes the Devanagari correct: its
// HarfBuzz shaper lays out the conjuncts that GPT-image mangled, and that no PDF library
// shapes at all. For PNGs we set the viewport to the exact poster size and screenshot the
// page, so the image is pixel-for-pixel the HTML at full resolution; for PDFs the text stays
// vector, so it is selectable and sharp at any zoom.

import { chromium, type Browser } from 'playwright';
import { POSTER_WIDTH, POSTER_HEIGHT } from './poster-template.js';

export type RenderOptions = Readonly<{
  width?: number;
  height?: number;
  // Devicescale > 1 supersamples for extra-crisp text/edges (e.g. 2 → 2160×2700).
  deviceScaleFactor?: number;
  // Keep the page's transparent pixels transparent instead of compositing onto
  // white. Needed by the video caption overlay, which is a mostly-empty PNG
  // laid over footage; a poster is opaque by construction and ignores this.
  transparent?: boolean;
}>;

export type PdfMargin = Readonly<{
  top: string;
  right: string;
  bottom: string;
  left: string;
}>;

export type PdfRenderOptions = Readonly<{
  // Paper size, e.g. 'A4'. Passed explicitly rather than relying on preferCSSPageSize so the
  // template's @page block and page.pdf() cannot disagree.
  format?: string;
  margin?: PdfMargin;
  timeoutMs?: number;
}>;

// Whole-render deadline. page.pdf() takes no timeout option of its own and Fastify has no
// default request timeout, so without an explicit race a wedged Chromium would hold a
// connection (and a process) open indefinitely.
const DEFAULT_TIMEOUT_MS = 30_000;

// Thrown when Chromium simply is not installed in this environment. deploy/api.Dockerfile
// installs the browser for the article-PDF export; if that layer is ever missing, callers
// translate this into a "PDF service unavailable" message rather than a stack trace.
export class ChromiumUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Chromium is not installed in this environment.');
    this.name = 'ChromiumUnavailableError';
    this.cause = cause;
  }
}

// Every Chromium launch in this package goes through here.
//   --no-sandbox            : required when running as root in a container.
//   --disable-dev-shm-usage : Docker gives /dev/shm 64 MB, which Chromium can exhaust while
//                             laying out a multi-page document. Sends shared memory to /tmp
//                             instead; it cannot affect the rendered output.
async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      timeout: DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      throw new ChromiumUnavailableError(error);
    }
    throw error;
  }
}

export async function renderHtmlToPng(
  html: string,
  options: RenderOptions = {},
): Promise<Buffer> {
  const width = options.width ?? POSTER_WIDTH;
  const height = options.height ?? POSTER_HEIGHT;
  const deviceScaleFactor = options.deviceScaleFactor ?? 2;

  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
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
      ...(options.transparent ? { omitBackground: true } : {}),
    });
  } finally {
    await browser?.close();
  }
}

export async function renderHtmlToPdf(
  html: string,
  options: PdfRenderOptions = {},
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let browser: Browser | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await launchChromium();
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);

    const render = (async (): Promise<Buffer> => {
      // Same contract as renderHtmlToPng: the HTML embeds the font and the emblem as data
      // URIs, so 'load' means everything is in hand, and document.fonts.ready is the
      // belt-and-braces guaranteeing the Devanagari is shaped before we print.
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready.then(() => true)');
      // page.pdf() renders with PRINT css media, so @page and break-* apply without an
      // @media block. No displayHeaderFooter: it renders in a separate document that does
      // not inherit our @font-face (a Devanagari running header would need the font data
      // URI duplicated into it), and this document wants no page numbers anyway.
      return await page.pdf({
        ...(options.format ? { format: options.format } : {}),
        ...(options.margin ? { margin: options.margin } : {}),
        // The letterhead is built so it does not NEED this (the emblem is an <img> and every
        // rule is a border, both of which always print), but it costs nothing and stops a
        // later tint or band silently vanishing. Paired with print-color-adjust: exact.
        printBackground: true,
      });
    })();

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('PDF render timed out.')),
        timeoutMs,
      );
    });

    return await Promise.race([render, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    // Must also run when the race rejects, so a timed-out render cannot leak a browser.
    await browser?.close().catch(() => undefined);
  }
}
