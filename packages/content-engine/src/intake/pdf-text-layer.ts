// Local, per-page PDF text extraction from the document's own TEXT LAYER (pdf.js).
//
// Why this exists beside the Sarvam OCR path: OCR reads text out of PIXELS, and is only
// necessary for SCANNED documents. A PDF whose text can be selected and copied already
// contains its characters, and reading them locally is instant, free, unlimited in length,
// and — the part that matters for this product — EXACT: no OCR misreading of a name, an
// amount or a date. Sarvam's document digitization is also capped at 10 pages per job, so
// routing a born-digital 20-page booklet through it was both wasteful and a hard failure.
//
// The catch that keeps OCR in the picture is Marathi-specific. Plenty of government PDFs
// are typeset in legacy non-Unicode fonts (Shree Lipi, Kruti Dev, DV-TTSurekh) whose
// embedded encoding maps glyphs to Latin code points. The page LOOKS like Devanagari and
// even "copies", but the extracted characters are junk. There is no reliable way to be
// certain from the bytes alone, so this module returns a VERDICT alongside the pages
// (see textLayerVerdict) and the policy in pdf-pages.ts falls back to OCR on anything but
// a clean read — with a user-facing override for what still slips through.

import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import {
  getDocument,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { type PdfPage, unwrapSoftLineBreaks } from './pdf-shared.js';

// pdf.js loads two data sets lazily, and both matter here:
//   cmaps/          predefined CID → Unicode tables. Devanagari is routinely stored in a
//                   CID font; without these, such a page extracts as nothing usable.
//   standard_fonts/ metrics for the 14 standard fonts.
// They ship inside the installed package, so resolve them off its own package.json rather
// than assuming a path relative to dist/.
//
// These must be FILESYSTEM paths, not file:// URLs: pdf.js appends the file name to this
// string and, in Node, hands the result straight to fs.readFile — which rejects a
// 'file:///…' string (and Node's fetch refuses file: URLs outright). pdf.js nonetheless
// insists the value end in a FORWARD slash, on Windows too; fs accepts forward slashes
// there, so normalise the whole path to them.
const pdfjsRoot = dirname(
  createRequire(import.meta.url).resolve('pdfjs-dist/package.json'),
);
function dataDir(name: string): string {
  return `${join(pdfjsRoot, name).split(sep).join('/')}/`;
}
const CMAP_URL = dataDir('cmaps');
const STANDARD_FONT_DATA_URL = dataDir('standard_fonts');

// A page with less than this much text does not count as a page that HAS a text layer.
// Set well above a stamp and well below a page of prose: scanners routinely burn a
// "Scanned by … / Page 3 of 20" line into every page, and a document whose only extractable
// text is that line is a scan, not a text layer. A real page of a government PDF runs
// 1,000-3,000 characters.
const MIN_CHARS_PER_REAL_PAGE = 100;
// Whole-document floor, for the degenerate cases the per-page rule cannot see.
const MIN_CHARS_PER_DOCUMENT = 200;
// Share of characters that are Private Use Area / replacement / control before the read is
// called garbled. Kept low: a clean Unicode PDF has essentially none of these.
const MAX_SUSPICIOUS_RATIO = 0.02;

export type TextLayerVerdict = 'good' | 'empty' | 'garbled';

// Text is assembled from pdf.js text items, which arrive in reading order. `hasEOL` marks
// the end of a rendered line, which is what the PDF's own layout says — the same
// hard-wrapping the OCR output has, so the same unwrap applies. The items array also
// carries marked-content markers (structure tags, no text); those have no `str`.
// pdf.js exports TextItem/TextMarkedContent only from a deep internal path, so take the
// item shape off the method that produces it instead.
type TextContentItem = Awaited<
  ReturnType<PDFPageProxy['getTextContent']>
>['items'][number];

function pageText(items: ReadonlyArray<TextContentItem>): string {
  let out = '';
  for (const item of items) {
    if (!('str' in item)) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return unwrapSoftLineBreaks(out)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

// Extracts every page's text layer. Pages that yield nothing are kept as EMPTY pages, not
// dropped: page numbers here are the document's own, and the user selects pages by them.
export async function extractTextLayerPages(data: Buffer): Promise<PdfPage[]> {
  // pdf.js takes ownership of (and detaches) the array it is given — hand it a copy so the
  // caller's buffer survives for a possible OCR fallback on the very same bytes.
  const task = getDocument({
    data: new Uint8Array(data),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    // Server-side: never reach for fonts installed on the host.
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const pages: PdfPage[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push({ page: number, text: pageText(content.items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// Characters that should not appear in real extracted text: Private Use Area (the classic
// legacy-font signature), the replacement character, and control codes.
function suspiciousCount(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isPua = code >= 0xe000 && code <= 0xf8ff;
    const isReplacement = code === 0xfffd;
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f);
    if (isPua || isReplacement || isControl) count += 1;
  }
  return count;
}

// Devanagari that came out of the PDF in VISUAL order instead of logical order.
//
// This is the failure that matters most here, and it is not hypothetical: a Chromium-
// printed Marathi page extracts "निर्णय" as "िनण य" and "कोल्हापूर" as "को ापूर" — the
// pre-base matra ि lands BEFORE its consonant and conjunct glyphs with no ToUnicode entry
// vanish. The result still looks like Devanagari to every ratio-based check, so nothing
// else in this file would catch it, and it silently rewrites exactly what must never
// change: names, places, amounts.
//
// The tell is an invariant of well-formed Unicode Devanagari: a DEPENDENT vowel sign
// (U+093E–U+094C and friends) attaches to a preceding consonant, so it can never open a
// word. Every word-initial matra is proof of visual-order text.
const WORD_INITIAL_MATRA = /(^|[\s–—(),.;:"'।॥[\]{}/\\-])[ा-ौॢॣ]/gu;
const DEVANAGARI_WORD = /[ऀ-ॿ]+/gu;
// Two occurrences could be a stray footnote glyph; a systematically reordered document
// trips this on nearly every line.
const MIN_MISORDERED = 3;
const MAX_MISORDERED_RATIO = 0.01;

function misorderedDevanagari(text: string): boolean {
  const words = text.match(DEVANAGARI_WORD)?.length ?? 0;
  if (words === 0) return false;
  const misordered = text.match(WORD_INITIAL_MATRA)?.length ?? 0;
  return (
    misordered >= MIN_MISORDERED && misordered / words > MAX_MISORDERED_RATIO
  );
}

// Is this text layer usable, or should the document go to OCR?
//
//   'empty'   — nothing meaningful came out: a scanned document. The normal fallback.
//   'garbled' — text came out but cannot be trusted: characters real text does not
//               contain (a legacy/broken font encoding), or Devanagari in visual order.
//               OCR reads the rendered pixels and gets both right.
//
// Deliberately NOT checked: whether the text is Devanagari at all. An English annexure, a
// bilingual GR and a Marathi booklet are all legitimate, and a script test would send
// perfectly good English documents to OCR.
export function textLayerVerdict(pages: readonly PdfPage[]): TextLayerVerdict {
  const total = pages.reduce((sum, page) => sum + page.text.length, 0);
  // The whole-document floor cannot exceed what the per-page rule would ask of the pages
  // actually present, or a one-page input is held to a two-page standard. This matters now
  // that a user's page SELECTION is judged on its own: a single selected page carrying 150
  // perfectly good characters must not be declared a scan and sent to paid OCR.
  const floor = Math.min(
    MIN_CHARS_PER_DOCUMENT,
    pages.length * MIN_CHARS_PER_REAL_PAGE,
  );
  if (total < floor) return 'empty';

  const realPages = pages.filter(
    (page) => page.text.length >= MIN_CHARS_PER_REAL_PAGE,
  ).length;
  // A mostly-blank document is a scan with an incidental text stamp on a few pages.
  if (realPages * 2 < pages.length) return 'empty';

  const suspicious = pages.reduce(
    (sum, page) => sum + suspiciousCount(page.text),
    0,
  );
  if (suspicious / total > MAX_SUSPICIOUS_RATIO) return 'garbled';

  const text = pages.map((page) => page.text).join('\n');
  if (misorderedDevanagari(text)) return 'garbled';

  return 'good';
}
