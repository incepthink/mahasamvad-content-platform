// In-process job registry for uploaded documents: probe a file for free, read the pages
// the user selected — and only those — and hand the text back. Used by every surface that
// takes a file but does not persist one (the media room, /proofread), and the model
// /translate's PDF path follows.
//
// Why IN MEMORY and not a table: these are ad-hoc uploads. Pasted text is never stored and
// a citizen's uploaded PDF has even less business being persisted, so the job lives in this
// map for a TTL and then disappears along with the bytes. The cost is honest and small: an
// API restart loses an in-flight job and the user re-uploads, which the route reports as a
// plain Marathi error rather than a spinner that never ends.
//
// The bytes are held for the job's LIFETIME rather than dropped after the first read,
// because the user can ask for the document to be re-read with OCR when the text layer came
// out wrong. Still nothing on disk, nothing in the database: the TTL, the 25 MiB upload cap
// and MAX_JOBS bound what memory this can hold.
//
// Sequencing and persistence only, per AGENTS.md — the extraction policy (text layer first,
// OCR in ≤10-page chunks, page identity) lives in @dgipr/content-engine.

import { randomUUID } from 'node:crypto';
import {
  createCostAccumulator,
  detectPageLanguage,
  extractDocument,
  probeDocument,
  runInCostScope,
  runInCostTask,
  type DocumentKind,
  type DocumentPage as EnginePage,
  type DocumentTextSource,
} from '@dgipr/content-engine';
import type { SupabaseClient, UsageFeature } from '@dgipr/database';
import { recordTasksFromCost } from './service-usage.js';
import type {
  DocumentDetail,
  DocumentExtractProgress,
  DocumentIntakeStatus,
  DocumentPage,
} from '@dgipr/schemas';

export type DocumentIntakeJob = {
  id: string;
  fileName: string;
  kind: DocumentKind;
  // Kept for the job's lifetime so the pages the user selects can be read long after the
  // upload request returned — and so an OCR re-read has something to re-read.
  data: Buffer;
  status: DocumentIntakeStatus;
  // The pages actually READ so far. On a scanned document this holds only what the user
  // selected and paid for, so it is a subset of pageCount by design.
  pages: DocumentPage[];
  // Every page the document has, from the free probe. The selection list is drawn from
  // this, which is why it is known before anything is read.
  pageCount: number | null;
  // Reading this document costs OCR credits (its text layer was unusable).
  needsOcr: boolean;
  source: DocumentTextSource | null;
  extractProgress: DocumentExtractProgress | null;
  error: string | null;
  // Which sidebar feature the upload came from, for /analytics attribution only. This
  // service is shared by four surfaces and knows nothing else about its caller, so a paid
  // OCR read would otherwise be orphaned — countable in the bill, attributable to nobody.
  // Optional and NEVER inferred: an absent value records no service row, which is honest,
  // where guessing a feature would put one surface's spend on another's card.
  feature: UsageFeature | null;
  // Which OCR backend this job's PDF is read with, overriding OCR_PROVIDER. Set from the
  // declared upload SURFACE at create time and carried for the job's life, so a re-read
  // (the "read it with OCR instead" override) uses the same backend the first read did —
  // otherwise the same document could come back in two different shapes on one screen.
  // null = the deployment's default, which is every surface except /chat.
  ocrProvider: string | null;
  createdAt: string;
  touchedAt: number;
};

// A finished job is worth keeping around long enough for the user to read its pages and
// pull the text across; an abandoned one must not pin tens of megabytes forever.
const JOB_TTL_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;
// Hard ceiling on live jobs so a burst of uploads cannot exhaust the API's memory. Each
// job also pins its file (≤25 MiB) until it expires.
const MAX_JOBS = 20;
// Per Sarvam JOB, and a job is at most 10 pages, so the shared default is already right;
// a little headroom for slow scans of dense pages.
const OCR_TIMEOUT_MS = 12 * 60_000;

const jobs = new Map<string, DocumentIntakeJob>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.touchedAt < cutoff && job.status !== 'extracting') jobs.delete(id);
  }
}, SWEEP_INTERVAL_MS);
// Never hold the process open just for the sweeper.
sweep.unref();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Evict the oldest idle job when the registry is full. A job being read is never evicted —
// its owner is watching it right now.
function makeRoom(): void {
  if (jobs.size < MAX_JOBS) return;
  const idle = [...jobs.values()]
    .filter((job) => job.status !== 'extracting')
    .sort((a, b) => a.touchedAt - b.touchedAt);
  const oldest = idle[0];
  if (oldest) jobs.delete(oldest.id);
}

export function getDocumentIntakeJob(id: string): DocumentIntakeJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  job.touchedAt = Date.now();
  return job;
}

function toPage(page: EnginePage): DocumentPage {
  return {
    page: page.page,
    text: page.text,
    chars: page.text.length,
    // Deterministic and free. Surfaces that care (an English annexure inside a Marathi
    // booklet behaves differently per target language) get it without asking.
    language: detectPageLanguage(page.text),
  };
}

// The polled shape. Page TEXT is omitted unless asked for: a 20-page document is ~40k
// characters, and a 2.5 s poll that shipped all of it would move megabytes over a run.
// The client fetches the text once, when a phase completes.
export function toDocumentIntakeDetail(
  job: DocumentIntakeJob,
  includeText: boolean,
): DocumentDetail {
  return {
    id: job.id,
    fileName: job.fileName,
    kind: job.kind,
    status: job.status,
    pages: job.pages.map((page) => ({
      ...page,
      text: includeText ? page.text : '',
    })),
    pageCount: job.pageCount,
    needsOcr: job.needsOcr,
    source: job.source,
    extractProgress: job.extractProgress,
    error: job.error,
    createdAt: job.createdAt,
  };
}

// Registers an uploaded file and probes it. NOTHING is sent to Sarvam here, which is the
// entire point: OCR is billed per page, so the user gets to choose the pages before any of
// them are paid for.
//
// The probe splits the run in two:
//   text in hand → every page was free to read (a born-digital PDF, or any .docx/.txt), so
//                  the job goes straight to 'ready' and the review list doubles as the
//                  page picker.
//   scanned PDF  → 'selecting'. Only the page COUNT is known, so the user picks by number
//                  and only that selection is ever OCR'd.
//
// Awaited rather than fired off in the background because the probe is local and quick, and
// answering the upload with the page count spares the client a poll just to draw a checkbox
// list. It also lets a file that cannot be opened at all fail the upload outright, instead
// of becoming a job that exists only to report its own failure.
export async function startDocumentIntake(
  fileName: string,
  data: Buffer,
  feature: UsageFeature | null = null,
  ocrProvider: string | null = null,
): Promise<{
  id: string;
  kind: DocumentKind;
  pageCount: number;
  needsOcr: boolean;
}> {
  makeRoom();
  const probe = await probeDocument(fileName, data);
  const needsOcr = probe.source === 'ocr';
  const id = randomUUID();
  const job: DocumentIntakeJob = {
    id,
    fileName,
    kind: probe.kind,
    data,
    status: probe.pages ? 'ready' : 'selecting',
    pages: probe.pages ? probe.pages.map(toPage) : [],
    pageCount: probe.pageCount,
    needsOcr,
    source: probe.pages ? 'text-layer' : null,
    extractProgress: null,
    error: null,
    feature,
    ocrProvider,
    createdAt: new Date().toISOString(),
    touchedAt: Date.now(),
  };
  jobs.set(id, job);
  return { id, kind: probe.kind, pageCount: probe.pageCount, needsOcr };
}

// Read the pages the user just chose, and only those.
//
// Deliberately 'auto' rather than forcing OCR even when the probe said the document needs
// it: the probe judged the WHOLE document, and a booklet can be scanned across most of its
// pages while the three the user actually wants carry a perfectly good text layer.
// Re-reading that layer is local and free, so trying costs nothing and can save the whole
// OCR bill.
export function startDocumentIntakeExtraction(
  job: DocumentIntakeJob,
  pages: readonly number[],
  client?: SupabaseClient,
): void {
  runExtraction(job, 'auto', pages, client);
}

// "The text looks wrong — read it with OCR instead." Re-runs extraction on the retained
// bytes and throws away the previous read, including any corrections the user made to it —
// they were written against pages that are being replaced. Still bounded by the page
// selection: an override of the QUALITY gate is not an override of the spend gate.
export function startDocumentIntakeReextraction(
  job: DocumentIntakeJob,
  pages: readonly number[],
  client?: SupabaseClient,
): void {
  job.pages = [];
  runExtraction(job, 'ocr', pages, client);
}

function runExtraction(
  job: DocumentIntakeJob,
  source: 'auto' | 'ocr',
  pages: readonly number[],
  client?: SupabaseClient,
): void {
  job.status = 'extracting';
  job.error = null;
  job.extractProgress = null;
  job.touchedAt = Date.now();

  void (async () => {
    try {
      // Metered so a paid read from /translate, /proofread or the media room reaches that
      // feature's service card. A born-digital PDF read from its text layer spends nothing
      // and records nothing — recordOcrCost only fires on the pixel path.
      const cost = createCostAccumulator();
      const extracted = await runInCostScope(cost, () =>
        runInCostTask('document_ocr', () =>
          extractDocument(job.fileName, job.data, {
            source,
            pages,
            timeoutMs: OCR_TIMEOUT_MS,
            // Undefined for every surface but /chat, which is what leaves the published-output
            // surfaces on OCR_PROVIDER exactly as before.
            ...(job.ocrProvider ? { ocrProvider: job.ocrProvider } : {}),
            // OCR runs one ≤10-page Sarvam job at a time, so a long scan is minutes of
            // spinner without this.
            onProgress: (pagesDone, pageCount) => {
              job.extractProgress = { pagesDone, pageCount };
              job.touchedAt = Date.now();
            },
          }),
        ),
      );
      // Both halves must be present: an upload that declared no feature, or a caller with
      // no client, records nothing rather than landing on an arbitrary card.
      if (client && job.feature) {
        recordTasksFromCost(client, job.feature, cost);
      }
      job.source = extracted.source;
      job.pages = extracted.pages.map(toPage);
      job.status = 'ready';
    } catch (error) {
      console.error(`[document-intake ${job.id}] extraction failed:`, error);
      job.status = 'failed';
      job.error = errorMessage(error);
    } finally {
      job.extractProgress = null;
      job.touchedAt = Date.now();
    }
  })();
}
