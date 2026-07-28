// The generated article as a printable A4 document, built as a self-contained HTML string
// that render-html.ts prints with Chromium (`page.pdf()`).
//
// Why Chromium and not a PDF library: the same reason the posters are typeset in HTML —
// "Chromium is what makes the Devanagari correct: its HarfBuzz shaper lays out the
// conjuncts" (render-html.ts). jsPDF/pdf-lib place glyphs but run no Indic shaper, so
// क्ती / ऱ्या / ट्र come out decomposed and every matra floats off its consonant. Printing
// through the browser also keeps the text VECTOR (selectable, sharp at any zoom) rather
// than rasterising it, which an html2canvas-style approach would not.
//
// The document is deliberately plain: an official letterhead on page 1, the officer's
// optional editorial angle as a title, a date line, and the article as justified
// paragraphs. No page numbers, no fact-check appendix, no markdown rendering — the article
// is prose by contract (the drafting prompts forbid titles/markdown; see
// content-engine's category-prompt.ts).

import type { ArticlePdfAssets } from './assets.js';
import { esc } from './poster-template.js';

export type ArticlePdfLanguage = 'mr' | 'en' | 'hi';

// A4 page geometry. Declared here rather than in render-html.ts so the design lives in one
// file (the same reason ARTICLE_WIDTH/HEIGHT live in article-template.ts). The @page block
// below interpolates these very values, so opening the harness's --html output in a browser
// and hitting Ctrl+P shows the identical layout page.pdf() produces — one constant, two
// consumers, no drift.
export const A4_MARGIN = {
  top: '16mm',
  right: '20mm',
  bottom: '18mm',
  left: '20mm',
} as const;

export type BuildArticlePdfHtmlInput = Readonly<{
  // The article body: plain prose with blank-line paragraph breaks. No markdown.
  article: string;
  // The officer's OPTIONAL editorial angle (generations.heading), printed as the document
  // title. Null/empty is the common case — the document then simply has no title; we never
  // invent one.
  heading?: string | null;
  // generations.created_at (ISO), printed as the date line.
  createdAt: string;
  // Which language `article` is in. Decides the date locale and <html lang> — NOT the
  // letterhead, which stays Marathi in every language (see below).
  language: ArticlePdfLanguage;
  assets: ArticlePdfAssets;
}>;

// The department's own wording, taken verbatim from assets/poster-footer.png (and identical
// to apps/web's `appSubtitle`): "माहिती व जनसंपर्क महासंचालनालय, महाराष्ट्र शासन". Split across
// two lines here, state above directorate, which is the standard hierarchy and the way the
// emblem itself reads. Nothing is coined.
const LETTERHEAD_GOV = 'महाराष्ट्र शासन';
const LETTERHEAD_DEPT = 'माहिती व जनसंपर्क महासंचालनालय';

// mr-IN already resolves numberingSystem 'deva'. hi-IN does NOT — it resolves 'latn', which
// would print "25 जुलाई 2026" beside a body Sarvam translated with numerals_format: native —
// so Hindi pins -u-nu-deva explicitly.
const DATE_LOCALE: Record<ArticlePdfLanguage, string> = {
  mr: 'mr-IN',
  hi: 'hi-IN-u-nu-deva',
  en: 'en-IN',
};

const DATE_LABEL: Record<ArticlePdfLanguage, string> = {
  mr: 'दिनांक',
  hi: 'दिनांक',
  en: 'Date',
};

// The API container runs on UTC, so the zone is PINNED rather than inherited: a run created
// at 01:30 IST would otherwise be dated the previous day. (apps/web's formatDate() correctly
// omits timeZone — it runs in the officer's own browser.)
export function formatDocDate(iso: string, language: ArticlePdfLanguage): string {
  const date = new Intl.DateTimeFormat(DATE_LOCALE[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
  return `${DATE_LABEL[language]}: ${date}`;
}

// Split the article into paragraphs for justified <p> rendering.
//
// generations.article is prose with \n\n breaks. The single-newline fallback matters: a
// hand-pasted media-room article (articleProvided) may use single newlines throughout, and
// without it the whole document would collapse into one page-long paragraph.
export function paragraphsOf(article: string): string[] {
  const blocks = article
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const source =
    blocks.length > 1
      ? blocks
      : article
          .split(/\r?\n/)
          .map((block) => block.trim())
          .filter(Boolean);

  return source.map((block) =>
    block
      // Soft wraps INSIDE a paragraph become spaces. Chromium would collapse them anyway;
      // doing it here keeps the escaped output predictable.
      .replace(/\s*\n\s*/g, ' ')
      // Legacy rows (written before the "no markdown" prompt rule) and hand-pasted articles
      // can still carry a "### " marker. Strip it rather than printing literal hashes — we
      // deliberately do NOT render markdown; this is the one concession.
      .replace(/^#{1,6}[ \t]+/, ''),
  );
}

export function buildArticlePdfHtml(input: BuildArticlePdfHtmlInput): string {
  const { article, createdAt, language, assets } = input;
  const heading = input.heading?.trim() ?? '';
  const paragraphs = paragraphsOf(article);
  const dateLine = formatDocDate(createdAt, language);

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<style>
  /* page.pdf() is handed the same margins from A4_MARGIN; this block exists so a browser
     Ctrl+P of the raw HTML (the --html harness flag) previews identically. */
  @page {
    size: A4;
    margin: ${A4_MARGIN.top} ${A4_MARGIN.right} ${A4_MARGIN.bottom} ${A4_MARGIN.left};
  }

${assets.fontFaceCss}

  :root {
    --maroon: #7a1512;
    --ink: #1b2437;
    --muted: #5b6478;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    /* Mukta carries all of Basic Latin, Latin-1 with accents, curly quotes, – — … • ₹ €,
       AND full Devanagari including ०-९ and । ॥ — so an English or Hindi PDF is never tofu,
       even in a container with no system fonts (verified by rendering each of those classes
       with no fallback family and checking for tofu). Liberation Sans is the second chance
       for anything outside that set; "playwright install --with-deps" apt-installs
       fonts-liberation alongside Chromium. */
    font-family: 'Mukta', 'Liberation Sans', sans-serif;
    color: var(--ink);
    font-size: 11.5pt;
    /* Devanagari needs generous leading: matras sit both above and below the line. */
    line-height: 1.75;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* The letterhead is an ordinary block in NORMAL FLOW, not a page.pdf() headerTemplate.
     That is what makes it appear once, on page 1, with the body flowing under it and onto
     later pages — the convention for a government press note. displayHeaderFooter would
     also render in a separate document that does not inherit our @font-face, so a
     Devanagari running header would need the whole font data URI duplicated into it. */
  .letterhead {
    text-align: center;
    break-inside: avoid;
    padding-bottom: 6pt;
    /* A border, not a background: borders print regardless of printBackground. */
    border-bottom: 2.2pt solid var(--maroon);
  }
  .letterhead .emblem {
    width: 21mm;
    height: 21mm;
    display: block;
    margin: 0 auto 4pt;
  }
  .letterhead .gov {
    font-size: 12pt;
    font-weight: 700;
    letter-spacing: 2.5px;
  }
  .letterhead .dept {
    font-size: 15.5pt;
    font-weight: 800;
    color: var(--maroon);
    margin-top: 1pt;
  }

  /* Second, thinner rule → the classic official double rule. */
  .rule-thin {
    border-bottom: 0.7pt solid var(--maroon);
    margin: 2.4pt 0 14pt;
  }

  .doc-title {
    font-size: 15pt;
    font-weight: 800;
    line-height: 1.4;
    text-align: center;
    text-wrap: balance;
    margin-bottom: 6pt;
    /* Never orphan the title at the foot of a page. */
    break-after: avoid-page;
  }

  /* Small, muted and right-aligned on purpose: a news article's own body often opens with a
     Mahasamvad dateline ("मुंबई, दि. ५ :"), so this must read as document metadata rather
     than compete with it. */
  .doc-meta {
    font-size: 9.5pt;
    color: var(--muted);
    text-align: right;
    margin-bottom: 12pt;
    break-after: avoid-page;
  }

  .body p {
    text-align: justify;
    /* Devanagari is space-separated, so inter-word is the correct justification model. */
    text-justify: inter-word;
    /* Never hyphenate Devanagari. */
    hyphens: none;
    /* A pasted URL must not blow out the measure. */
    overflow-wrap: break-word;
    /* Chromium honours these in paged media. */
    orphans: 3;
    widows: 3;
    margin-bottom: 8.5pt;
  }
  .body p:last-child { margin-bottom: 0; }
</style>
</head>
<body>
  <header class="letterhead">
    <img class="emblem" src="${assets.emblemDataUri}" alt="" />
    <p class="gov">${LETTERHEAD_GOV}</p>
    <p class="dept">${LETTERHEAD_DEPT}</p>
  </header>
  <div class="rule-thin"></div>
${heading ? `  <h1 class="doc-title">${esc(heading)}</h1>\n` : ''}  <p class="doc-meta">${esc(dateLine)}</p>

  <main class="body">
${paragraphs.map((p) => `    <p>${esc(p)}</p>`).join('\n')}
  </main>
</body>
</html>`;
}
