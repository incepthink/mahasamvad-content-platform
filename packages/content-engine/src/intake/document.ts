// How ANY uploaded document becomes pages of text — the one entry point callers should
// use. It is a dispatcher over the three backends, not a new policy: a PDF goes through
// pdf-pages.ts exactly as before (text layer first, OCR only on a bad verdict, only over
// the pages the user selected), and the other two kinds are read locally.
//
// The reason this exists is that four surfaces need the same thing (/translate, /dlo, the
// media room, /proofread) and only the PDF half was ever shared. Everything above this —
// the job state machine, the page picker, the OCR override — can now be written once
// because every kind answers the same two questions in the same shape.
//
// The shape that makes that work is the PROBE: it reports what a document is before a
// single credit is spent on it, and a non-PDF ALWAYS comes back with its pages in hand
// (reading it was local and free). That one property is what makes the page-selection step
// disappear for .txt and .docx without a single branch in the UI — there is nothing to
// choose, because nothing is being bought.

import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type {
  ExtractPdfOptions,
  PdfPage,
  PdfTextSource,
} from './pdf-shared.js';
import { extractPdfPagesDetailed, probePdf } from './pdf-pages.js';
import { extractDocxText } from './docx.js';
import { extractTextFile } from './text-file.js';

// Documents only. Meeting audio is deliberately NOT here: a transcript has no pages, no
// selection step and no per-page spend decision, so it would widen every type in this
// module to fit one caller. It stays on DLO's batch-STT path (intake/sarvam-stt.ts).
export type DocumentKind = 'pdf' | 'docx' | 'txt';

// One unit of a document. Aliases PdfPage on purpose: `page` is the ORIGINAL document's
// 1-based page number — after OCR chunking, after blank pages, always — because the UI
// lists and the user selects by it. A .docx/.txt is one page numbered 1.
export type DocumentPage = PdfPage;
export type DocumentTextSource = PdfTextSource;
export type ExtractDocumentOptions = ExtractPdfOptions;

export type DocumentProbe = Readonly<{
  kind: DocumentKind;
  pageCount: number;
  source: DocumentTextSource;
  // null ONLY when reading will cost OCR credits, i.e. a scanned PDF. Every other case
  // has already been read for free, which is what lets the caller skip the picker.
  pages: DocumentPage[] | null;
}>;

export type DocumentExtraction = Readonly<{
  kind: DocumentKind;
  source: DocumentTextSource;
  pages: DocumentPage[];
}>;

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.txt': 'txt',
};

export function documentKindOf(fileName: string): DocumentKind | null {
  return KIND_BY_EXTENSION[extname(fileName).toLowerCase()] ?? null;
}

function unsupported(name: string): Error {
  return new Error(
    `${name}: फक्त PDF, DOCX आणि TXT फाईल्स वाचता येतात.`,
  );
}

// A .docx/.txt is one page. Modelling it as page 1 rather than as a separate "whole text"
// shape is what keeps every consumer above this module kind-agnostic.
function singlePage(text: string): DocumentPage[] {
  return [{ page: 1, text }];
}

async function readWholeDocument(
  kind: 'docx' | 'txt',
  name: string,
  data: Buffer,
): Promise<DocumentPage[]> {
  return singlePage(
    kind === 'docx'
      ? await extractDocxText(name, data)
      : extractTextFile(name, data),
  );
}

// What can be learned about a document for FREE, before the user commits to anything.
// Never calls Sarvam.
export async function probeDocument(
  name: string,
  data: Buffer,
): Promise<DocumentProbe> {
  const kind = documentKindOf(name);
  if (!kind) throw unsupported(name);

  if (kind === 'pdf') {
    const probe = await probePdf(name, data);
    return { kind, ...probe };
  }

  const pages = await readWholeDocument(kind, name, data);
  return { kind, pageCount: 1, source: 'text-layer', pages };
}

// Read the document — for a PDF, only the pages named in `options.pages`, which is the
// entire spend gate. `options` is inert for the other kinds: a single-page document has
// nothing to select, and honouring a selection that omitted page 1 could only return
// nothing at all.
export async function extractDocument(
  name: string,
  data: Buffer,
  options?: ExtractDocumentOptions,
): Promise<DocumentExtraction> {
  const kind = documentKindOf(name);
  if (!kind) throw unsupported(name);

  if (kind === 'pdf') {
    const extracted = await extractPdfPagesDetailed(name, data, options);
    return { kind, ...extracted };
  }

  return {
    kind,
    source: 'text-layer',
    pages: await readWholeDocument(kind, name, data),
  };
}

// Run against a real file to see which backend it takes and how the pages come out:
//
//   tsx --env-file=../../.env src/intake/document.ts <file> [--probe] [--ocr|--text] [--pages=2,5,9]
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
  const selection = args
    .find((arg) => arg.startsWith('--pages='))
    ?.slice('--pages='.length)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((page) => Number.isInteger(page));

  if (!file) {
    console.error(
      'usage: tsx src/intake/document.ts <file> [--probe] [--ocr|--text] [--pages=2,5,9]',
    );
    process.exitCode = 1;
  } else if (args.includes('--probe')) {
    readFile(file)
      .then(async (data) => {
        const probe = await probeDocument(basename(file), data);
        console.log(
          `probe: kind=${probe.kind}, ${probe.pageCount} page(s), source=${probe.source}, text in hand=${
            probe.pages ? 'yes' : 'no'
          }`,
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
        const started = Date.now();
        const { kind, source, pages } = await extractDocument(
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
          `kind: ${kind}, source: ${source} — ${pages.length} page(s) in ${(
            (Date.now() - started) /
            1000
          ).toFixed(1)}s:`,
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
