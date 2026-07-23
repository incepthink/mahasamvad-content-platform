// In-process job registry for /translate's PDF path: probe an uploaded document for free,
// read the pages the user selected — and only those — then translate them into English
// and/or Hindi.
//
// Why IN MEMORY and not a table: /translate is the one ad-hoc surface of the product —
// pasted text is never stored, and a citizen's uploaded PDF has even less business being
// persisted. The job therefore lives in this map for a TTL and then disappears, along with
// the PDF bytes. The cost is honest and small: an API restart loses an in-flight job and
// the user re-uploads, which the route reports as a plain Marathi error rather than a
// spinner that never ends.
//
// The PDF bytes are held for the job's LIFETIME rather than dropped after the first read,
// because the user can ask for the document to be re-read with OCR when the text layer
// came out wrong (see startDocumentReextraction). Still nothing on disk, nothing in the
// database: the TTL, the 25 MiB upload cap and MAX_JOBS bound what memory this can hold.
//
// Sequencing and persistence only, per AGENTS.md — the extraction policy, the page-language
// routing and every translation guard live in @dgipr/content-engine.

import { randomUUID } from 'node:crypto';
import {
  extractPdfPagesDetailed,
  probePdf,
  translateDocumentPages,
  detectPageLanguage,
  type DocumentPageInput,
  type TranslatedDocumentPage,
  type PdfPage,
  type PdfTextSource,
} from '@dgipr/content-engine';
import {
  findGlossaryTermsInText,
  upsertGlossaryTerm,
  type SupabaseClient,
} from '@dgipr/database';
import type {
  DocumentExtractProgress,
  TranslateDocumentDetail,
  TranslateDocumentPage,
  TranslateDocumentProgress,
  TranslateDocumentRequest,
  TranslateDocumentResult,
  TranslateDocumentStatus,
  TranslationLanguage,
} from '@dgipr/schemas';

export type DocumentJob = {
  id: string;
  fileName: string;
  // Kept for the job's lifetime so the user can ask for an OCR re-read — and, now, so the
  // pages they select can be read long after the upload request has returned.
  data: Buffer;
  status: TranslateDocumentStatus;
  // The pages actually READ so far. On a scanned document this holds only what the user
  // selected and paid for, so it is a subset of pageCount by design.
  pages: TranslateDocumentPage[];
  // Every page the document has, from the free probe. The selection list is drawn from
  // this, which is why it is known before anything is read.
  pageCount: number | null;
  // Reading this document costs OCR credits (its text layer was unusable).
  needsOcr: boolean;
  source: PdfTextSource | null;
  extractProgress: DocumentExtractProgress | null;
  progress: TranslateDocumentProgress | null;
  results: TranslateDocumentResult[];
  error: string | null;
  createdAt: string;
  touchedAt: number;
};

// A finished job is worth keeping around long enough for the user to read and download
// both translations; an abandoned one must not pin tens of megabytes forever.
const JOB_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;
// Hard ceiling on live jobs so a burst of uploads cannot exhaust the API's memory. Each
// job now also pins its PDF (≤25 MiB) until it expires.
const MAX_JOBS = 20;
// Per Sarvam JOB, and a job is at most 10 pages, so the shared default is already right;
// a little headroom for slow scans of dense pages.
const OCR_TIMEOUT_MS = 12 * 60_000;

const jobs = new Map<string, DocumentJob>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.touchedAt < cutoff && !isBusy(job)) jobs.delete(id);
  }
}, SWEEP_INTERVAL_MS);
// Never hold the process open just for the sweeper.
sweep.unref();

function isBusy(job: DocumentJob): boolean {
  return job.status === 'extracting' || job.status === 'translating';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Evict the oldest idle job when the registry is full. A busy job is never evicted — its
// owner is watching it right now.
function makeRoom(): void {
  if (jobs.size < MAX_JOBS) return;
  const idle = [...jobs.values()]
    .filter((job) => !isBusy(job))
    .sort((a, b) => a.touchedAt - b.touchedAt);
  const oldest = idle[0];
  if (oldest) jobs.delete(oldest.id);
}

export function getDocumentJob(id: string): DocumentJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  job.touchedAt = Date.now();
  return job;
}

// The polled shape. Page and result TEXT is omitted unless asked for: a 20-page document
// is ~40k characters per language, and a 2.5 s poll that shipped all of it would move
// megabytes over a run. The client fetches the text once, when a phase completes.
export function toDocumentDetail(
  job: DocumentJob,
  includeText: boolean,
): TranslateDocumentDetail {
  return {
    id: job.id,
    fileName: job.fileName,
    status: job.status,
    pages: job.pages.map((page) => ({
      ...page,
      text: includeText ? page.text : '',
    })),
    pageCount: job.pageCount,
    needsOcr: job.needsOcr,
    source: job.source,
    extractProgress: job.extractProgress,
    progress: job.progress,
    results: job.results.map((result) => ({
      ...result,
      pages: result.pages.map((page) => ({
        ...page,
        text: includeText ? page.text : '',
      })),
    })),
    error: job.error,
    createdAt: job.createdAt,
  };
}

// The pages a request selected, with the user's OCR corrections applied. Unknown page
// numbers are ignored rather than failing the request — the selection is a UI artifact and
// a stale one should not cost the user their run.
export function selectedPages(
  job: DocumentJob,
  pages: readonly number[],
  pageEdits: Readonly<Record<string, string>> | undefined,
): DocumentPageInput[] {
  const wanted = new Set(pages);
  return job.pages
    .filter((page) => wanted.has(page.page))
    .map((page) => {
      const edited = pageEdits?.[String(page.page)];
      const text = (edited ?? page.text).trim();
      return { page: page.page, text };
    })
    .filter((page) => page.text.length > 0);
}

// --- extraction -------------------------------------------------------------

function toDocumentPage(page: PdfPage): TranslateDocumentPage {
  return {
    page: page.page,
    text: page.text,
    chars: page.text.length,
    // Deterministic, so an English annexure page inside a Marathi document is
    // routed correctly per target language (see translate-document.ts).
    language: detectPageLanguage(page.text),
  };
}

// Registers an uploaded PDF and probes it — page count and a text-layer attempt, both free
// and local. NOTHING is sent to Sarvam here, which is the entire point: OCR is billed per
// page, so the user gets to choose the pages before any of them are paid for.
//
// The probe splits the run in two:
//   text layer usable → every page is already in hand for nothing, so the job goes straight
//                       to 'ready' and the existing review list serves as the page picker.
//                       Behaviourally identical to how this always worked.
//   scanned           → 'selecting'. Only the page COUNT is known, so the user picks by
//                       number and only that selection is ever OCR'd.
//
// Awaited rather than fired off in the background because the probe is local and quick, and
// answering the upload with the page count spares the client a poll just to draw a
// checkbox list. It also lets a PDF that cannot be opened at all fail the upload outright,
// instead of becoming a job that exists only to report its own failure.
export async function startDocument(
  fileName: string,
  data: Buffer,
): Promise<{ id: string; pageCount: number; needsOcr: boolean }> {
  makeRoom();
  const probe = await probePdf(fileName, data);
  const needsOcr = probe.source === 'ocr';
  const id = randomUUID();
  const job: DocumentJob = {
    id,
    fileName,
    data,
    status: probe.pages ? 'ready' : 'selecting',
    pages: probe.pages ? probe.pages.map(toDocumentPage) : [],
    pageCount: probe.pageCount,
    needsOcr,
    source: probe.pages ? 'text-layer' : null,
    extractProgress: null,
    progress: null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    touchedAt: Date.now(),
  };
  jobs.set(id, job);
  return { id, pageCount: probe.pageCount, needsOcr };
}

// Read the pages the user just chose, and only those.
//
// Deliberately 'auto' rather than forcing OCR even when the probe said the document needs
// it: the probe judged the WHOLE document, and a booklet can be scanned across most of its
// pages while the three the user actually wants carry a perfectly good text layer. Re-reading
// that layer is local and free, so trying costs nothing and can save the whole OCR bill.
export function startDocumentExtraction(
  job: DocumentJob,
  pages: readonly number[],
): void {
  // A new page selection invalidates any translation of the old one.
  job.results = [];
  job.progress = null;
  runExtraction(job, 'auto', pages);
}

// "The text looks wrong — read it with OCR instead." Re-runs extraction on the retained
// bytes and throws away everything derived from the previous read: page text the user may
// have corrected, and any translation, since a translation of text nobody trusts is not
// worth keeping on screen beside the new pages. Still bounded by the page selection — an
// override of the QUALITY gate is not an override of the spend gate.
export function startDocumentReextraction(
  job: DocumentJob,
  pages: readonly number[],
): void {
  job.pages = [];
  job.results = [];
  job.progress = null;
  runExtraction(job, 'ocr', pages);
}

function runExtraction(
  job: DocumentJob,
  source: 'auto' | 'ocr',
  pages: readonly number[],
): void {
  job.status = 'extracting';
  job.error = null;
  job.extractProgress = null;
  job.touchedAt = Date.now();

  void (async () => {
    try {
      const extracted = await extractPdfPagesDetailed(job.fileName, job.data, {
        source,
        pages,
        timeoutMs: OCR_TIMEOUT_MS,
        // OCR runs one ≤10-page Sarvam job at a time, so a long scan is minutes of
        // spinner without this.
        onProgress: (pagesDone, pageCount) => {
          job.extractProgress = { pagesDone, pageCount };
          job.touchedAt = Date.now();
        },
      });
      job.source = extracted.source;
      job.pages = extracted.pages.map(toDocumentPage);
      job.status = 'ready';
    } catch (error) {
      console.error(`[translate-document ${job.id}] extraction failed:`, error);
      job.status = 'failed';
      job.error = errorMessage(error);
    } finally {
      job.extractProgress = null;
      job.touchedAt = Date.now();
    }
  })();
}

// --- translation ------------------------------------------------------------

// Translate the selected pages into each requested language, one language at a time.
// Mirrors startTranslateJob's contract: the confirmed names are saved as VERIFIED glossary
// rows BEFORE translating, so the spellings the user just approved lock into this very run
// (and every future one), and the glossary scan below picks them up.
export function startDocumentTranslation(
  client: SupabaseClient,
  job: DocumentJob,
  request: TranslateDocumentRequest,
): void {
  const pages = selectedPages(job, request.pages, request.pageEdits);
  job.status = 'translating';
  job.error = null;
  job.progress = {
    language: request.languages[0]!,
    pageIndex: 0,
    pageCount: pages.length,
  };
  job.touchedAt = Date.now();

  void (async () => {
    try {
      if (pages.length === 0) {
        throw new Error('निवडलेल्या पृष्ठांमध्ये मजकूर आढळला नाही.');
      }

      if (request.terms) {
        for (const term of request.terms) {
          await upsertGlossaryTerm(client, {
            marathi: term.marathi,
            // english is NOT NULL; a Hindi-only extra carries no English, so fall
            // back to the Marathi form rather than reject the row.
            english: term.english?.trim() || term.marathi,
            hindi: term.hindi?.trim() || term.marathi,
            termType: term.termType ?? 'other',
            verified: true,
            source: 'manual',
          });
        }
      }

      const sourceText = pages.map((page) => page.text).join('\n\n');
      const terms = await findGlossaryTermsInText(client, sourceText);
      const glossary = terms.map((term) => ({
        marathi: term.marathi,
        english: term.english,
        hindi: term.hindi ?? undefined,
        termType: term.termType,
      }));

      // English before Hindi, regardless of the order the client sent. The client builds
      // the list from a Set, so re-ticking English can put Hindi first — and a Hindi
      // failure must never pre-empt an English target that would have succeeded. Whether
      // to re-run a language that already has a result is the CLIENT's call (it requests
      // only the missing language on a failure-retry, so the good English pages are never
      // re-billed); here we translate exactly what was asked, replacing each language's
      // result as it completes.
      const order: TranslationLanguage[] = ['en', 'hi'];
      const languages = order.filter((language) =>
        request.languages.includes(language),
      );

      // A late throw (e.g. a genuinely untranslated block on page 9) must not discard the
      // pages already translated in this run. Bank each language's result the moment its
      // first page lands and update it as pages complete, so a failure keeps everything
      // paid for so far; then rethrow to fail the job with the pages still present.
      let failure: unknown = null;
      for (const language of languages) {
        const done: TranslatedDocumentPage[] = [];
        const writeResult = () => {
          job.results = [
            ...job.results.filter((result) => result.language !== language),
            {
              language,
              // Copied into the job's mutable shape (the engine's pages are
              // Readonly with readonly name arrays).
              pages: done.map((page) => ({
                page: page.page,
                text: page.text,
                mode: page.mode,
                unpreservedNames: [...page.unpreservedNames],
              })),
              lockedTermCount: glossary.length,
              unpreservedNames: [
                ...new Set(done.flatMap((page) => page.unpreservedNames)),
              ],
            },
          ];
          job.touchedAt = Date.now();
        };
        try {
          await translateDocumentPages(pages, glossary, language, {
            onProgress: (pageIndex, pageCount) => {
              job.progress = { language, pageIndex, pageCount };
              job.touchedAt = Date.now();
            },
            onPage: (page) => {
              done.push(page);
              writeResult();
            },
          });
        } catch (error) {
          // Keep whatever pages finished before the throw, then stop — a later language
          // is not attempted once one has failed.
          if (done.length > 0) writeResult();
          failure = error;
          break;
        }
      }

      if (failure) throw failure;
      job.status = 'completed';
      job.progress = null;
    } catch (error) {
      console.error(
        `[translate-document ${job.id}] translation failed:`,
        error,
      );
      job.status = 'failed';
      job.error = errorMessage(error);
      job.progress = null;
    } finally {
      job.touchedAt = Date.now();
    }
  })();
}
