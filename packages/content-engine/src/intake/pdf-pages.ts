// How a PDF becomes text: the policy, and the only entry point callers should use.
//
// Two backends, and the difference matters to the product, not just to the code:
//
//   text layer (pdf-text-layer.ts)  the characters already stored in the PDF. Instant,
//                                   free, no page limit, and EXACT — names, amounts and
//                                   dates come out as typed.
//   OCR (sarvam-doc.ts)             Sarvam reading the PIXELS. Necessary for scanned
//                                   documents, which are routine in government material.
//                                   Minutes per document, costs credits, misreads names,
//                                   and is capped at 10 pages per job (hence the chunking).
//
// So: try the text layer, use it when it reads cleanly, and fall back to OCR otherwise.
// The gate cannot be perfect — a PDF typeset in a legacy non-Unicode Marathi font extracts
// as convincing-looking junk — so /translate also offers the user an explicit "read it
// with OCR instead", which arrives here as source: 'ocr'.
//
// PAGE SELECTION. Because OCR is billed per page, the user chooses which pages are worth
// reading BEFORE any job runs, and that choice arrives as options.pages. Only those pages
// are sent to Sarvam. probePdf is the other half of that arrangement: it reports, for free,
// how many pages there are and whether reading them will cost anything — which is what lets
// the UI show a born-digital document's text while the user picks, and offer a scanned one
// nothing but page numbers.

import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  type ExtractPdfOptions,
  type PdfPage,
  type PdfTextSource,
} from './pdf-shared.js';
import { extractTextLayerPages, textLayerVerdict } from './pdf-text-layer.js';
import { extractPdfPagesViaOcr } from './sarvam-doc.js';
import { countPdfPages } from './pdf-split.js';

export type PdfExtraction = Readonly<{
  source: PdfTextSource;
  pages: PdfPage[];
}>;

// What a PDF is, before a single credit is spent on it. See probePdf.
export type PdfProbe = Readonly<{
  pageCount: number;
  // 'text-layer' — the pages are already in hand, free, and `pages` holds them.
  // 'ocr'        — reading this document will cost credits, so the user gets to choose
  //                which pages are worth paying for before any job runs.
  source: PdfTextSource;
  pages: PdfPage[] | null;
}>;

// Narrows extracted pages to the user's selection, preserving document order.
function filterToSelection(
  pages: readonly PdfPage[],
  selection: readonly number[],
): PdfPage[] {
  const wanted = new Set(selection);
  return pages.filter((page) => wanted.has(page.page));
}

// The full result, for callers that show the user which backend ran (/translate does —
// OCR text deserves more scrutiny in review than a text layer does).
export async function extractPdfPagesDetailed(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfExtraction> {
  const source = options?.source ?? 'auto';

  if (source === 'ocr') {
    return {
      source: 'ocr',
      pages: await extractPdfPagesViaOcr(name, data, options),
    };
  }

  let pages: PdfPage[] | null = null;
  try {
    pages = await extractTextLayerPages(data);
  } catch (error) {
    // A PDF pdf.js cannot open at all (damaged, password-protected) is still worth
    // handing to OCR, which works from the rendered page.
    console.warn(`[pdf-pages] text layer unreadable for ${name}:`, error);
  }

  // Narrow to the selection BEFORE judging the read. The pages nobody asked for say
  // nothing about whether the pages they DID ask for are readable: a booklet typeset for
  // its first half and scanned for its second would otherwise pass on the strength of the
  // half being thrown away, and the selected half would come back blank.
  const selected =
    pages && options?.pages ? filterToSelection(pages, options.pages) : pages;

  if (source === 'text-layer') {
    if (!selected || selected.every((page) => page.text.length === 0)) {
      throw new Error(`${name}: या PDF मध्ये थेट वाचता येईल असा मजकूर नाही.`);
    }
    return { source: 'text-layer', pages: selected };
  }

  const verdict = selected ? textLayerVerdict(selected) : 'empty';
  if (selected && verdict === 'good') {
    console.log(
      `[pdf-pages] ${name}: using the PDF text layer (${selected.length} page(s), no OCR).`,
    );
    return { source: 'text-layer', pages: selected };
  }

  console.log(
    `[pdf-pages] ${name}: text layer verdict '${verdict}' — falling back to Sarvam OCR${
      options?.pages ? ` for ${options.pages.length} selected page(s)` : ''
    }.`,
  );
  return {
    source: 'ocr',
    pages: await extractPdfPagesViaOcr(name, data, options),
  };
}

// What can be learned about a PDF for FREE, before the user commits to anything.
//
// This never calls Sarvam. It reads the page count and the local text layer, and reports
// which backend a real extraction would take. That verdict is what lets the UI ask the
// right question: a born-digital document can show its pages' text while the user picks
// (costing nothing), whereas a scanned one can only offer page numbers — showing its text
// would mean running the very OCR the user is being asked to authorise.
export async function probePdf(name: string, data: Buffer): Promise<PdfProbe> {
  let pages: PdfPage[] | null = null;
  try {
    pages = await extractTextLayerPages(data);
  } catch (error) {
    console.warn(`[pdf-pages] text layer unreadable for ${name}:`, error);
  }

  const verdict = pages ? textLayerVerdict(pages) : 'empty';
  if (pages && verdict === 'good') {
    console.log(
      `[pdf-pages] ${name}: probe found a usable text layer (${pages.length} page(s), no OCR needed).`,
    );
    return { pageCount: pages.length, source: 'text-layer', pages };
  }

  // pdf.js could not read it, so ask pdf-lib for the count alone — the user still has to be
  // shown how many pages there are to choose from. If neither library can open the file,
  // there is nothing to select and the caller should hear about it now, not after an upload.
  const pageCount = pages?.length ?? (await countPdfPages(data));
  console.log(
    `[pdf-pages] ${name}: probe verdict '${verdict}' — ${pageCount} page(s), OCR needed.`,
  );
  return { pageCount, source: 'ocr', pages: null };
}

// Pages only — the shape /translate's job has always used.
export async function extractPdfPages(
  name: string,
  data: Buffer,
  options?: ExtractPdfOptions,
): Promise<PdfPage[]> {
  return (await extractPdfPagesDetailed(name, data, options)).pages;
}

// Run directly against a real PDF to see which backend it takes and how the pages come
// out — page numbering across OCR chunks is what page selection depends on, and
// --pages is how to prove a subset still reports the ORIGINAL document's numbers:
//
//   tsx --env-file=../../.env src/intake/pdf-pages.ts <file.pdf> [--ocr|--text] [--pages=2,5,9]
//   tsx --env-file=../../.env src/intake/pdf-pages.ts <file.pdf> --probe
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const forced = args.includes('--ocr')
    ? 'ocr'
    : args.includes('--text')
      ? 'text-layer'
      : 'auto';
  const probeOnly = args.includes('--probe');
  const selection = args
    .find((arg) => arg.startsWith('--pages='))
    ?.slice('--pages='.length)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((page) => Number.isInteger(page));
  if (!file) {
    console.error(
      'usage: tsx src/intake/pdf-pages.ts <file.pdf> [--ocr|--text] [--pages=2,5,9] [--probe]',
    );
    process.exitCode = 1;
  } else if (probeOnly) {
    readFile(file)
      .then(async (data) => {
        const probe = await probePdf(basename(file), data);
        console.log(
          `probe: ${probe.pageCount} page(s), source=${probe.source}, text in hand=${probe.pages ? 'yes' : 'no'}`,
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  } else {
    process.env.SARVAM_DOC_DEBUG = '1';
    readFile(file)
      .then(async (data) => {
        console.log(
          `extracting ${basename(file)} (${(data.length / 1024 / 1024).toFixed(1)} MB), source=${forced}${
            selection ? `, pages=${selection.join(',')}` : ''
          }…`,
        );
        const started = Date.now();
        const { source, pages } = await extractPdfPagesDetailed(
          basename(file),
          data,
          {
            source: forced,
            ...(selection ? { pages: selection } : {}),
            onProgress: (done, total) =>
              console.log(`  …OCR ${done}/${total} page(s)`),
          },
        );
        console.log(
          `\nsource: ${source} — ${pages.length} page(s) in ${((Date.now() - started) / 1000).toFixed(1)}s:`,
        );
        for (const page of pages) {
          console.log(
            `  page ${page.page}: ${page.text.length} chars — ${page.text
              .replace(/\s+/g, ' ')
              .slice(0, 80)}…`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
