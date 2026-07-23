// Shapes and text hygiene shared by the two PDF extraction backends: the local
// text layer (pdf-text-layer.ts) and Sarvam OCR (sarvam-doc.ts). Both produce the
// same PdfPage[], so the policy in pdf-pages.ts can swap one for the other and no
// caller can tell which ran.

// One extracted page of a PDF. `page` is 1-based and is the page number of the
// ORIGINAL document — after OCR chunking, after blank pages, always. The UI lists
// pages by it and the user selects by it, so it must never be a running index.
export type PdfPage = Readonly<{ page: number; text: string }>;

// Which backend produced the pages. Surfaced to the user because it changes how
// much the text should be distrusted: OCR misreads names and amounts, a text
// layer is exact.
export type PdfTextSource = 'text-layer' | 'ocr';

export type ExtractPdfOptions = Readonly<{
  // Per Sarvam JOB budget (one job = up to 10 pages), not a whole-document one.
  timeoutMs?: number | undefined;
  // 'auto' (default) tries the text layer and falls back to OCR; the explicit
  // values are what the UI's "read it with OCR instead" button sends.
  source?: 'auto' | PdfTextSource | undefined;
  // Pages finished, for the OCR path's chunk-by-chunk progress. Never called on
  // the text-layer path, which returns in one step.
  onProgress?: ((pagesDone: number, pageCount: number) => void) | undefined;
  // The user's page selection: 1-based ORIGINAL page numbers. Undefined = the whole
  // document. On the OCR path ONLY these pages are sent to Sarvam — that is the entire
  // point of the option, since OCR is billed per page and a page nobody selected is a
  // page nobody should pay for. On the text-layer path (free) the document is read
  // whole and filtered, because reading it whole costs nothing.
  pages?: readonly number[] | undefined;
}>;

// Lines that start a Markdown block and must never be merged into the line above:
// headings, list items, table rows, quotes, fences, thematic rules.
const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|-{3,}\s*$)/;

// Joins hard-wrapped lines back into whole paragraphs.
//
// Both backends reproduce the PDF's LINE breaks, so a sentence — and, worse, a name —
// arrives split: "संवाद\nवारी". That breaks the glossary lock outright
// (findGlossaryTermsInText matches the surface form literally, and the extractor mines the
// name with a space), and it hands the translator half-sentences. Blank lines still
// separate paragraphs and every Markdown block start is preserved, so structure survives;
// only a plain line followed by another plain line is rejoined.
export function unwrapSoftLineBreaks(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const previous = out[out.length - 1];
    const canJoin =
      previous !== undefined &&
      previous.trim().length > 0 &&
      line.trim().length > 0 &&
      !BLOCK_START.test(line) &&
      !BLOCK_START.test(previous);
    if (canJoin) out[out.length - 1] = `${previous.trimEnd()} ${line.trim()}`;
    else out.push(line);
  }
  return out.join('\n');
}
