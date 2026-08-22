// Splitting a PDF into pieces small enough to send somewhere.
//
// TWO callers with two different limits, hence two split functions:
//
//   splitPdfPages       by PAGE COUNT — Sarvam's job API validates "Page/image count must
//                       not exceed 10" when a job is STARTED, and its job request has no
//                       page-range parameter, so one upload can never cover more pages.
//   splitPdfPagesBySize by BYTES — the OpenAI path sends a whole chunk as CONTEXT with
//                       every page it reads, so what bounds a chunk is the request size
//                       limit, not a page count. A 400-page text PDF can be small; a
//                       12-page scan can be huge.
//
// Either way the split is invisible to the user: the chunks carry their original page
// numbers and everything downstream re-numbers against them.

import { PDFDocument } from 'pdf-lib';

// Sarvam's hard per-job page limit. Named here because this module exists for it.
export const SARVAM_DOC_MAX_PAGES = 10;

// Optional ceiling on a whole document going to OCR, and OFF by default.
//
// It used to default to 50, on the reasoning that ten pages is one Sarvam job so a 300-page
// scan is 30 sequential jobs — an hour of waiting and a pile of credits nobody asked for.
// What that missed is that no page reaches this function unless the officer TICKED it, so
// the spend was already authorised and the ceiling only ever refused a selection they had
// deliberately made, with no way past it. A real booklet runs well over 50 pages.
//
// Set SARVAM_DOC_MAX_TOTAL_PAGES to restore a cap; unset means no limit. The text-layer path
// never had one — it costs nothing. The OpenAI OCR backend has none either; it bounds a
// request by BYTES (openai-doc.ts's OCR_MAX_REQUEST_BYTES), not by page count.
export const OCR_MAX_TOTAL_PAGES = process.env.SARVAM_DOC_MAX_TOTAL_PAGES
  ? Number.parseInt(process.env.SARVAM_DOC_MAX_TOTAL_PAGES, 10)
  : Number.POSITIVE_INFINITY;

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

// Copies exactly `group` (1-based original page numbers) into its own PDF.
async function copyGroup(
  source: PDFDocument,
  group: readonly number[],
): Promise<PdfChunk> {
  const target = await PDFDocument.create();
  const copied = await target.copyPages(
    source,
    group.map((page) => page - 1),
  );
  for (const page of copied) target.addPage(page);
  return { originalPages: [...group], data: Buffer.from(await target.save()) };
}

// Splits into chunks each of which serializes to at most `maxBytes`.
//
// WHY BY SIZE. The OpenAI reader sends a chunk as CONTEXT alongside every page it
// transcribes — that surrounding text is what lets it read a smudged name correctly, and it
// is the whole reason this function exists. So the thing that has to be bounded is the
// REQUEST, and a page count is a bad proxy for it: 400 pages of born-digital text can be a
// few MB while 12 pages of 600dpi scan can be 300.
//
// The size of a group cannot be known without serializing it, so this estimates from the
// document's average page size, then VERIFIES and halves anything that came out over
// budget. Halving rather than dropping one page at a time keeps the recursion logarithmic
// on a document whose pages vary wildly in size (a text report with four scanned annexures
// is the normal shape here).
//
// A single page over budget on its own is returned anyway, deliberately: the alternative is
// refusing to read it at all, and the caller gets a clearer failure from the API than from
// us guessing on its behalf.
export async function splitPdfPagesBySize(
  data: Buffer,
  maxBytes: number,
  pageNumbers?: readonly number[],
  // A SECOND ceiling, for a backend that also caps how many pages one request may carry
  // (Gemini reads at most 1,000 pages per document). Omit it for a byte-only bound.
  maxPages: number = Number.POSITIVE_INFINITY,
): Promise<PdfChunk[]> {
  const source = await load(data);
  const total = source.getPageCount();
  if (total === 0) throw new Error('PDF मध्ये एकही पृष्ठ नाही.');

  const selection = pageNumbers
    ? normalizeSelection(pageNumbers, total)
    : Array.from({ length: total }, (_, index) => index + 1);

  // The whole selection may well fit — the common case by far, since most uploads are a few
  // pages — and then there is nothing to estimate or verify.
  const whole = await copyGroup(source, selection);
  if (whole.data.length <= maxBytes && selection.length <= maxPages) {
    return [whole];
  }

  // Overshoot the estimate deliberately: `verify` below splits anything too big, and a group
  // that comes back under budget costs one wasted serialization, while one that comes back
  // far too small costs the context this function exists to provide.
  const averageBytes = Math.max(
    1,
    Math.ceil(whole.data.length / selection.length),
  );
  const estimate = Math.max(
    1,
    Math.min(Math.floor(maxBytes / averageBytes), maxPages),
  );

  const verify = async (group: readonly number[]): Promise<PdfChunk[]> => {
    const chunk = await copyGroup(source, group);
    if (
      (chunk.data.length <= maxBytes && group.length <= maxPages) ||
      group.length === 1
    ) {
      return [chunk];
    }
    const middle = Math.floor(group.length / 2);
    return [
      ...(await verify(group.slice(0, middle))),
      ...(await verify(group.slice(middle))),
    ];
  };

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < selection.length; start += estimate) {
    chunks.push(...(await verify(selection.slice(start, start + estimate))));
  }
  return chunks;
}
