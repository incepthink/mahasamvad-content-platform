// Splitting a PDF into pieces small enough for Sarvam's document digitization.
//
// Sarvam's job API validates "Page/image count must not exceed 10" when a job is STARTED,
// and its job request has no page-range parameter — so one upload can never cover more
// than ten pages. A 20-page booklet (the case this product was built for) therefore has to
// arrive as several documents. Splitting here, in code, keeps that entirely invisible to
// the user: the chunks are re-stitched with their original page numbers.

import { PDFDocument } from 'pdf-lib';

// Sarvam's hard per-job page limit. Named here because this module exists for it.
export const SARVAM_DOC_MAX_PAGES = 10;

// Ceiling on a whole document going to OCR. Ten pages is one job, so a 300-page scan is 30
// sequential jobs — an hour of waiting and a pile of credits nobody asked for. The text
// layer path has no such limit; it costs nothing.
export const OCR_MAX_TOTAL_PAGES = Number.parseInt(
  process.env.SARVAM_DOC_MAX_TOTAL_PAGES ?? '50',
  10,
);

export type PdfChunk = Readonly<{
  // The 1-based page numbers, in order, that this chunk's pages hold in the ORIGINAL
  // document. Everything downstream re-numbers against it, so a page keeps the number the
  // user sees in a reader.
  //
  // A LIST rather than a start+count because a chunk may carry the user's page SELECTION,
  // which need not be contiguous: "pages 2, 5 and 9" is one perfectly ordinary chunk.
  originalPages: readonly number[];
  data: Buffer;
}>;

// Compact page list for job labels and error messages: [3,4,5,9] → "3-5, 9". A selection
// can be scattered, and "पृष्ठ 3-9" would name pages that were never sent.
export function formatPageRanges(pages: readonly number[]): string {
  const parts: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  const flush = () => {
    if (start === null || previous === null) return;
    parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  };
  for (const page of pages) {
    if (start === null || previous === null) start = page;
    else if (page !== previous + 1) {
      flush();
      start = page;
    }
    previous = page;
  }
  flush();
  return parts.join(', ');
}

// Validates a caller's page selection against the document and puts it in document order.
//
// Order is deliberately NOT the user's click order: pages always come back ascending,
// because every consumer (note assembly, per-page translation, the review list) presents
// them as the document reads. Duplicates are dropped for the same reason — selecting a
// page twice must never OCR it twice.
function normalizeSelection(
  pageNumbers: readonly number[],
  total: number,
): number[] {
  const selection = [...new Set(pageNumbers)].sort((a, b) => a - b);
  if (selection.length === 0) {
    throw new Error('एकही पृष्ठ निवडलेले नाही.');
  }
  const outOfRange = selection.filter(
    (page) => !Number.isInteger(page) || page < 1 || page > total,
  );
  if (outOfRange.length > 0) {
    throw new Error(
      `निवडलेली पृष्ठे या फाईलमध्ये नाहीत: ${outOfRange.join(', ')} (एकूण ${total} पृष्ठे).`,
    );
  }
  return selection;
}

// `ignoreEncryption` covers the common government case of a PDF that carries an owner
// password (print/copy restrictions) but opens without one. pdf-lib refuses to load those
// otherwise, and refusing to read a document the user can open themselves is not helpful.
async function load(data: Buffer): Promise<PDFDocument> {
  return PDFDocument.load(data, { ignoreEncryption: true });
}

export async function countPdfPages(data: Buffer): Promise<number> {
  return (await load(data)).getPageCount();
}

// Splits into chunks of at most `maxPages`. A document already within the limit still comes
// back as a single chunk, so callers have one code path.
//
// `pageNumbers` narrows this to the user's SELECTION (1-based, original numbering): only
// those pages are copied, so only those pages are ever handed to a paid OCR job. Omit it
// for the whole document.
export async function splitPdfPages(
  data: Buffer,
  maxPages: number = SARVAM_DOC_MAX_PAGES,
  pageNumbers?: readonly number[],
): Promise<PdfChunk[]> {
  const source = await load(data);
  const total = source.getPageCount();
  if (total === 0) throw new Error('PDF मध्ये एकही पृष्ठ नाही.');

  const selection = pageNumbers
    ? normalizeSelection(pageNumbers, total)
    : Array.from({ length: total }, (_, index) => index + 1);

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < selection.length; start += maxPages) {
    const group = selection.slice(start, start + maxPages);
    const target = await PDFDocument.create();
    // copyPages takes an arbitrary index array, so a scattered selection copies exactly
    // as cleanly as a consecutive run does.
    const copied = await target.copyPages(
      source,
      group.map((page) => page - 1),
    );
    for (const page of copied) target.addPage(page);
    chunks.push({
      originalPages: group,
      data: Buffer.from(await target.save()),
    });
  }
  return chunks;
}
