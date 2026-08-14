// The shared shape of "an uploaded document being read", used by every upload surface:
// /translate's PDF mode, /dlo's intake, the media room and /proofread.
//
// Nothing here is persisted. The API holds the job in memory for a TTL — the same
// contract /translate has always had ("ad-hoc text is not stored") — so these schemas
// exist only so apps/api and apps/web agree on the job's shape while it is alive.
//
// The one idea worth carrying in your head while reading this file: NOTHING is read until
// the user has picked pages, because OCR is billed per page. That is why a probe reports a
// page COUNT separately from the pages themselves, why `pages` can be empty on a job that
// is perfectly healthy, and why every re-read request carries a page selection.
//
// translate-document.ts imports from here rather than redefining; the package index
// exports this module first, so both sides see one definition of each name.

import { z } from 'zod';

// What a document can be. Meeting audio is deliberately absent — a transcript has no
// pages, no picker and no per-page spend decision, so it stays on DLO's own STT path.
export const DocumentKindSchema = z.enum(['pdf', 'docx', 'txt']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

// No upload ceiling: a department scan can be a whole booklet, and refusing it at the door
// was the one failure an officer could do nothing about. The routes still pass this as their
// multipart `fileSize` limit — busboy treats Infinity as "unlimited", which is its own
// default — so the only bound left is the box's memory: an intake job holds the file's bytes
// in process for its TTL, so a very large upload costs RAM for up to 60 minutes.
//
// The page-selection spend gate is untouched and is what keeps a 300-page scan cheap:
// nothing is read until pages are ticked. It is now the ONLY gate — OCR_MAX_TOTAL_PAGES no
// longer defaults to 50 and is off unless SARVAM_DOC_MAX_TOTAL_PAGES is set, since every
// page it refused had already been chosen on purpose.
export const DOCUMENT_MAX_BYTES = Number.POSITIVE_INFINITY;

// Which backend produced the page text. Shown to the user because it changes how hard the
// review step has to work: OCR misreads names and amounts, a text layer is exact.
export const PdfTextSourceSchema = z.enum(['text-layer', 'ocr']);
export type PdfTextSourceValue = z.infer<typeof PdfTextSourceSchema>;

// selecting → extracting → ready, plus failed.
//
// 'selecting' comes FIRST and is the point of the whole arrangement: the document has been
// probed (page count known, text layer tried — all free) but nothing has been sent to OCR
// yet. The user picks pages here, and only those pages are ever paid for. Like 'ready' it
// is an IDLE, user-gated state, not a running one — a poll that treats it as active will
// spin forever.
//
// A .docx/.txt never sees 'selecting': reading it was local and free, so it lands straight
// in 'ready' with its single page.
export const DocumentIntakeStatusSchema = z.enum([
  'selecting',
  'extracting',
  'ready',
  'failed',
]);
export type DocumentIntakeStatus = z.infer<typeof DocumentIntakeStatusSchema>;

// One extracted page. `page` is the ORIGINAL document's number — never a running index —
// because the UI lists and the user selects by it.
//
// `language` is the deterministic Devanagari-ratio verdict. It lives on the shared page
// rather than on /translate's own because it costs nothing to compute and more than one
// surface wants it (/translate routes English pages differently per target; /proofread
// reports which language it checked).
export const DocumentPageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
  chars: z.number().int().nonnegative(),
  language: z.enum(['mr', 'en']),
});
export type DocumentPage = z.infer<typeof DocumentPageSchema>;

// OCR progress, in pages. Null on the text-layer path, which returns in one step, and
// null once extraction is over.
export const DocumentExtractProgressSchema = z.object({
  pagesDone: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
});
export type DocumentExtractProgress = z.infer<
  typeof DocumentExtractProgressSchema
>;

// The user's page choice, sent once from the 'selecting' step. Only these pages are read,
// and on a scanned document that means only these pages are billed.
export const ExtractDocumentRequestSchema = z.object({
  pages: z.array(z.number().int().positive()).min(1),
});
export type ExtractDocumentRequest = z.infer<
  typeof ExtractDocumentRequestSchema
>;

// "The text looks wrong — read it with OCR instead." The quality gate cannot catch every
// broken PDF font, and the user is already looking at the extracted text, so the override
// is theirs to make. Only 'ocr' is offered: re-reading a text layer that was already
// rejected would return the same characters.
//
// `pages` is required, not optional: the override is a request to re-read, not a licence to
// bill for pages the user already excluded. Omitting it would silently OCR the whole
// document, which is the exact behaviour page selection exists to remove.
export const ReextractDocumentRequestSchema = z.object({
  source: z.literal('ocr'),
  pages: z.array(z.number().int().positive()).min(1),
});
export type ReextractDocumentRequest = z.infer<
  typeof ReextractDocumentRequestSchema
>;

// The polled shape of a generic intake job (see apps/api/src/jobs/document-intake.ts).
// /translate has its own richer detail carrying translation progress and results; this is
// everything up to and including "the pages are ready to be used".
export const DocumentDetailSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  kind: DocumentKindSchema,
  status: DocumentIntakeStatusSchema,
  // The pages actually READ. On a scanned document this holds only what the user selected
  // and paid for, so it is a subset of pageCount by design — and empty while 'selecting'.
  pages: z.array(DocumentPageSchema),
  // Every page the document HAS, from the free probe. The selection list is drawn from
  // this, which is why it is known before anything is read.
  pageCount: z.number().int().nonnegative().nullable(),
  // True when reading this document will cost OCR credits, i.e. the text layer was not
  // usable. It is why a scanned document's page list shows numbers only: rendering its
  // text would mean running the very OCR being authorised.
  needsOcr: z.boolean(),
  source: PdfTextSourceSchema.nullable(),
  extractProgress: DocumentExtractProgressSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

// The upload response. Carries the probe's findings so the client can draw the page
// picker immediately instead of waiting for a poll.
export const CreateDocumentResponseSchema = z.object({
  id: z.string(),
  kind: DocumentKindSchema,
  pageCount: z.number().int().nonnegative(),
  needsOcr: z.boolean(),
});
export type CreateDocumentResponse = z.infer<
  typeof CreateDocumentResponseSchema
>;
