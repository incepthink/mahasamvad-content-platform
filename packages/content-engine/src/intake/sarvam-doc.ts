// Marathi PDF OCR via the Sarvam Document Digitization API — the SCANNED-document
// backend. Born-digital PDFs are read locally from their text layer instead
// (pdf-text-layer.ts); the choice between the two lives in pdf-pages.ts, which is what
// callers use. This file is the OCR transport and nothing else.
//
// Local pdf-parse was rejected for this job for a reason that still holds: government
// PDFs are routinely SCANNED, and a text-layer parser yields nothing there, while this
// OCRs Devanagari across 23 languages. One async job per chunk: create → upload → start →
// poll → download.
//
// CHUNKING. Sarvam validates "Page/image count must not exceed 10" at job start and takes
// no page-range parameter, so a longer document is split into ≤10-page PDFs
// (pdf-split.ts), OCR'd one job at a time, and stitched back with each chunk's original
// page numbers. Sequential, not parallel: Sarvam's concurrency behaviour under a burst of
// jobs is untested, and a page-range in an error message is worth more than a few saved
// minutes. A chunk failure fails the whole extraction — silently missing middle pages
// would be far worse than an error naming the pages that could not be read.
//
// What the output ZIP actually contains (verified 2026-07-21 against a 3-page
// document, because the whole page-selection feature rests on it):
//
//   document.md              the WHOLE document as one Markdown file, its pages
//                            separated by a bare `---` rule
//   metadata/page_001.json   per page: page_num + blocks[] of { text,
//   metadata/page_002.json   layout_tag, reading_order, coordinates }
//   …
//
// So there is no per-page Markdown file to read, and page boundaries have to be
// recovered. Splitting document.md on `---` keeps the Markdown (headings,
// tables) and is tried first; the split is only TRUSTED when it produces exactly
// as many parts as there are metadata pages, because a thematic break inside a
// page would otherwise silently shift every page number after it. When the count
// disagrees, the metadata blocks are the authority — they carry the real page
// boundaries (and their own page_num), at the cost of Markdown structure.
//
// KEEPING THE MARKDOWN MATTERS MORE THAN IT USED TO. Since PDF_EXTRACTION_MODE defaulted to
// 'ocr' (pdf-pages.ts) this is the only PDF backend, and it was made the only one because
// government material is full of TABLES that must survive into the article prompt. So the
// split is attempted twice — once permissively, then requiring a blank line before the rule
// (a setext heading underline, `Heading` over `-----`, is the false positive that costs a
// whole document its Markdown) — and the metadata fallback reads each block's `layout_tag`
// so a table block is kept verbatim instead of being flattened into a paragraph.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import AdmZip from 'adm-zip';
import { createSarvamClient } from './sarvam-client.js';
import {
  OCR_MAX_TOTAL_PAGES,
  SARVAM_DOC_MAX_PAGES,
  formatPageRanges,
  splitPdfPages,
} from './pdf-split.js';
import {
  type ExtractPdfOptions,
  type PdfPage,
  unwrapSoftLineBreaks,
} from './pdf-shared.js';

// Ceiling on ONE job, i.e. at most 10 pages; default 10 min. Overridable per call.
const DOC_TIMEOUT_MS = Number.parseInt(
  process.env.SARVAM_DOC_TIMEOUT_MS ?? `${10 * 60_000}`,
  10,
);
const DOC_POLL_MS = 5_000;

// Page order from an output-ZIP entry name (metadata/page_001.json …). Sorting
// lexicographically would put page 10 before page 2, so order on the LAST number
// in the base name instead; an entry with no number sorts last.
function pageOrderKey(entryName: string): number {
  const matches = basename(entryName).match(/\d+/g);
  const last = matches?.[matches.length - 1];
  return last ? Number.parseInt(last, 10) : Number.MAX_SAFE_INTEGER;
}

// One page's metadata: OCR blocks in reading order. Only the fields used here are
// declared — the file also carries coordinates, confidence and layout tags.
type PageMetadata = {
  page_num?: number;
  blocks?: Array<{
    text?: unknown;
    reading_order?: unknown;
    layout_tag?: unknown;
  }>;
};

// Does this block hold a table? Sarvam's layout tags are not contractually documented, so
// the test is deliberately loose (anything containing 'table') and is BACKED UP by looking
// at the text itself — a block whose lines are pipe-delimited or which carries an HTML
// table is one whatever it is labelled. Getting this wrong in either direction is cheap:
// a false positive keeps a paragraph's line breaks, a false negative loses a table's
// columns exactly as the old code did for every block.
function isTableBlock(block: { text?: unknown; layout_tag?: unknown }): boolean {
  const tag =
    typeof block.layout_tag === 'string' ? block.layout_tag.toLowerCase() : '';
  if (tag.includes('table')) return true;
  const text = typeof block.text === 'string' ? block.text : '';
  if (/<\/?(table|tr|td|th)\b/i.test(text)) return true;
  // Two or more lines that both open and close with a pipe: a Markdown table.
  const piped = text
    .split('\n')
    .filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  return piped >= 2;
}

function metadataEntries(zip: AdmZip) {
  return zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory &&
        entry.entryName.endsWith('.json') &&
        basename(entry.entryName).startsWith('page_'),
    )
    .sort((a, b) => pageOrderKey(a.entryName) - pageOrderKey(b.entryName));
}

// Rebuild a page's text from its OCR blocks, in reading order, and take the page's own
// number with it. Loses the DOCUMENT-level Markdown (headings, the page's overall shape),
// which is why this is the fallback rather than the primary path — but a block that is
// itself a table keeps its own rows: its internal line breaks are the table, so they are
// preserved verbatim rather than trimmed per line, and it is separated from its neighbours
// by a blank line so no prose can be pulled into the first row.
function pageFromMetadata(
  raw: string,
  fallbackPage: number,
): PdfPage & { hasTable: boolean } {
  let parsed: PageMetadata;
  try {
    parsed = JSON.parse(raw) as PageMetadata;
  } catch {
    return { page: fallbackPage, text: '', hasTable: false };
  }
  const blocks = (parsed.blocks ?? [])
    .map((block, index) => ({
      text: typeof block.text === 'string' ? block.text.trim() : '',
      table: isTableBlock(block),
      order:
        typeof block.reading_order === 'number' ? block.reading_order : index,
    }))
    .filter((block) => block.text.length > 0)
    .sort((a, b) => a.order - b.order);
  const text = blocks.map((block) => block.text).join('\n\n');
  return {
    hasTable: blocks.some((block) => block.table),
    page:
      typeof parsed.page_num === 'number' && parsed.page_num > 0
        ? parsed.page_num
        : fallbackPage,
    text,
  };
}

// The chunk's pages, in order and numbered from 1 within the chunk (the caller offsets
// them to the document's own numbering). See the file header for the ZIP layout this reads.
//
// Empty pages are KEPT. Dropping them and renumbering — which this used to do — shifts
// every later page number, so one blank page in a 20-page document silently made "translate
// pages 11-14" translate the wrong pages.
function pagesFromOutputZip(zipPath: string, expectedPages: number): PdfPage[] {
  const zip = new AdmZip(zipPath);
  if (process.env.SARVAM_DOC_DEBUG) {
    console.log(
      `[sarvam-doc] output zip entries: ${zip
        .getEntries()
        .map((entry) => entry.entryName)
        .join(', ')}`,
    );
  }

  const metadata = metadataEntries(zip);
  const markdown = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.endsWith('.md'))
    .map((entry) => entry.getData().toString('utf8'))
    .join('\n\n');

  // Preferred: split the Markdown on the page rule, but only when the number of parts
  // agrees with a known page count (a stray `---` inside a page would otherwise renumber
  // everything after it).
  //
  // Two candidate rules, tried in order. The permissive one is the original. The strict one
  // additionally requires a BLANK line before the rule, which is what distinguishes a
  // CommonMark thematic break from a setext heading underline — `शीर्षक` over `-----` is a
  // heading, not a page boundary, and one of them in a document used to cost every page its
  // Markdown (and therefore its tables) by pushing the whole read onto the metadata path.
  const known = metadata.length > 0 ? metadata.length : expectedPages;
  for (const rule of [/\n\s*-{3,}\s*\n/, /\n[ \t]*\n[ \t]*-{3,}[ \t]*\n/]) {
    const parts = markdown
      .split(rule)
      .map((part) => unwrapSoftLineBreaks(part).trim());
    if (parts.length === known && parts.some((part) => part.length > 0)) {
      return parts.map((text, index) => ({ page: index + 1, text }));
    }
  }

  // Fallback: the metadata blocks, which own the real page boundaries and page numbers.
  if (metadata.length > 0) {
    const pages = metadata.map((entry, index) =>
      pageFromMetadata(entry.getData().toString('utf8'), index + 1),
    );
    console.warn(
      `[sarvam-doc] markdown page split did not match ${metadata.length} page(s); using page metadata instead.${
        pages.some((page) => page.hasTable)
          ? ' Some pages contain tables — check their columns survived.'
          : ''
      }`,
    );
    return pages.map(({ page, text }) => ({ page, text }));
  }

  // Neither shape available: hand back whatever Markdown there was as one page.
  const whole = markdown.trim();
  return whole.length > 0 ? [{ page: 1, text: whole }] : [];
}

// One Sarvam job: at most SARVAM_DOC_MAX_PAGES pages, numbered 1..n within the chunk.
async function extractChunkPages(
  label: string,
  data: Buffer,
  expectedPages: number,
  timeoutMs: number,
): Promise<PdfPage[]> {
  const client = createSarvamClient();
  const workDir = await mkdtemp(join(tmpdir(), 'sarvam-doc-'));
  try {
    // Sarvam's presigned upload requires a .pdf file name; the display name may
    // be Devanagari, so upload under a fixed safe name.
    const pdfPath = join(workDir, 'input.pdf');
    await writeFile(pdfPath, data);

    const job = await client.documentIntelligence.createJob({
      language: 'mr-IN',
      outputFormat: 'md',
      pollingIntervalMs: DOC_POLL_MS,
      maxPollingAttempts: Math.max(1, Math.ceil(timeoutMs / DOC_POLL_MS)),
    });
    await job.uploadFile(pdfPath);
    await job.start();
    const status = await job.waitUntilComplete();

    if (status.job_state === 'Failed') {
      throw new Error(
        `Sarvam document digitization failed for ${label}: ${
          status.error_message ?? 'unknown error'
        }`,
      );
    }

    const zipPath = join(workDir, 'output.zip');
    await job.downloadOutput(zipPath);
    return pagesFromOutputZip(zipPath, expectedPages);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// OCRs a PDF, splitting it into ≤10-page jobs as needed. Throws with a descriptive
// message on any failure — the DLO caller records it as that FILE's error without failing
// the whole intake; the translate caller fails the (single-file) job.
//
// `options.pages` restricts this to the user's selection, and doing so is the whole reason
// the option exists: OCR is billed per page, so a page the user did not select must never
// reach Sarvam. That selection is now the ONLY spend gate — the page-count ceiling below is
// off unless SARVAM_DOC_MAX_TOTAL_PAGES is set, because every page here was ticked on
// purpose and a real booklet runs past any round number worth defaulting to.
export async function extractPdfPagesViaOcr(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  const timeoutMs = options?.timeoutMs ?? DOC_TIMEOUT_MS;
  const chunks = await splitPdfPages(
    data,
    SARVAM_DOC_MAX_PAGES,
    options?.pages,
  );
  const totalPages = chunks.reduce(
    (sum, chunk) => sum + chunk.originalPages.length,
    0,
  );

  if (totalPages > OCR_MAX_TOTAL_PAGES) {
    throw new Error(
      `${name}: ${totalPages} पृष्ठे OCR साठी खूप जास्त आहेत (कमाल ${OCR_MAX_TOTAL_PAGES}). कृपया कमी पृष्ठे निवडा.`,
    );
  }

  const pages: PdfPage[] = [];
  let pagesDone = 0;
  for (const chunk of chunks) {
    const label =
      chunks.length === 1 && !options?.pages
        ? name
        : `${name} (पृष्ठ ${formatPageRanges(chunk.originalPages)})`;
    const chunkPages = await extractChunkPages(
      label,
      chunk.data,
      chunk.originalPages.length,
      timeoutMs,
    );
    // Back to the ORIGINAL document's numbering. A chunk's pages are numbered 1..n within
    // the chunk, so its own page list is the lookup table — this is the single point where
    // page identity is restored, and getting it wrong silently translates the wrong pages.
    for (const page of chunkPages) {
      const original = chunk.originalPages[page.page - 1];
      if (original === undefined) {
        console.warn(
          `[sarvam-doc] ${label}: OCR returned page ${page.page} but only ${chunk.originalPages.length} were sent; dropping it.`,
        );
        continue;
      }
      pages.push({ page: original, text: page.text });
    }
    pagesDone += chunk.originalPages.length;
    options?.onProgress?.(pagesDone, totalPages);
  }

  if (pages.every((page) => page.text.length === 0)) {
    throw new Error(
      `Sarvam document digitization returned no text for ${name}.`,
    );
  }
  return pages;
}
