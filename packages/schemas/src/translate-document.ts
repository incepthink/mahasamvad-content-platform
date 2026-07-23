// Request/response schemas for the /translate PDF path: an uploaded document is probed for
// free, the user picks pages (by hand or via a free-text instruction), ONLY those pages are
// read — by text layer or by paid OCR — and they are then translated into English and/or
// Hindi in the background.
//
// Nothing here is persisted — the API holds the job in memory for a TTL, mirroring the
// rest of /translate ("ad-hoc text is not stored"). These schemas exist so apps/api and
// apps/web agree on the job's shape while it is alive.

import { z } from 'zod';
import {
  TranslationLanguageSchema,
  TranslationTermInputSchema,
} from './api.js';

// 25 MiB is generous for a scanned 20-page government PDF and keeps the in-memory job
// bounded; the route sets the same value as its multipart limit.
export const TRANSLATE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

// Ceiling on the SELECTED text of one translation run. Unlike the pasted-text route's
// 10,000 (which is a synchronous-request budget), this one only exists to bound a
// background job — a 20-page Marathi document lands around 40k.
export const TRANSLATE_DOCUMENT_MAX_CHARS = 60_000;

export const TRANSLATE_DOCUMENT_INSTRUCTION_MAX_CHARS = 500;

// selecting → extracting → ready → translating → completed. 'ready' is where the user
// reviews pages and picks a selection, and a run that has already produced a translation
// returns there on request so a second language can be added.
//
// 'selecting' comes FIRST and is the point of the whole arrangement: the document has been
// probed (page count known, text layer tried — all free) but nothing has been sent to OCR
// yet, because OCR is billed per page. The user picks pages here, and only those pages are
// ever paid for. Like 'ready' it is an idle, user-gated state, not a running one.
export const TranslateDocumentStatusSchema = z.enum([
  'selecting',
  'extracting',
  'ready',
  'translating',
  'completed',
  'failed',
]);
export type TranslateDocumentStatus = z.infer<
  typeof TranslateDocumentStatusSchema
>;

// One OCR'd source page. `language` is the deterministic Devanagari-ratio verdict; the UI
// badges it because an English page behaves differently per target (passthrough for
// English, en→hi for Hindi).
export const TranslateDocumentPageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
  chars: z.number().int().nonnegative(),
  language: z.enum(['mr', 'en']),
});
export type TranslateDocumentPage = z.infer<typeof TranslateDocumentPageSchema>;

// Progress is counted in PAGES, not translation blocks — it is what the user can see on
// screen and match against the document.
export const TranslateDocumentProgressSchema = z.object({
  language: TranslationLanguageSchema,
  pageIndex: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
});
export type TranslateDocumentProgress = z.infer<
  typeof TranslateDocumentProgressSchema
>;

// Which backend produced the page text. Shown to the user because it changes how hard the
// review step has to work: OCR misreads names and amounts, a text layer is exact.
export const PdfTextSourceSchema = z.enum(['text-layer', 'ocr']);
export type PdfTextSourceValue = z.infer<typeof PdfTextSourceSchema>;

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
// document, which is the exact behaviour this feature exists to remove.
export const ReextractDocumentRequestSchema = z.object({
  source: z.literal('ocr'),
  pages: z.array(z.number().int().positive()).min(1),
});
export type ReextractDocumentRequest = z.infer<
  typeof ReextractDocumentRequestSchema
>;

export const TranslatedDocumentPageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
  // 'passthrough' = an English page under an English target, copied verbatim rather than
  // re-written by the Marathi→English model.
  mode: z.enum(['translated', 'passthrough']),
  // Locked names the Hindi output could not be made to carry on this page. The page is
  // still delivered; the UI names them so a human checks them. Empty for English.
  unpreservedNames: z.array(z.string()),
});
export type TranslatedDocumentPage = z.infer<
  typeof TranslatedDocumentPageSchema
>;

export const TranslateDocumentResultSchema = z.object({
  language: TranslationLanguageSchema,
  pages: z.array(TranslatedDocumentPageSchema),
  lockedTermCount: z.number().int().nonnegative(),
  // Union of every page's unpreservedNames, deduplicated — one banner for the result
  // rather than one per page.
  unpreservedNames: z.array(z.string()),
});
export type TranslateDocumentResult = z.infer<
  typeof TranslateDocumentResultSchema
>;

export const TranslateDocumentDetailSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  status: TranslateDocumentStatusSchema,
  // Populated once extraction finishes; empty while extracting or on failure. Also
  // populated during 'selecting' on a born-digital document, whose text layer cost
  // nothing to read — that is what lets the user pick pages while seeing them.
  pages: z.array(TranslateDocumentPageSchema),
  // Total pages in the uploaded PDF, known from the free probe before anything is read.
  // On a scanned document this is all the selection list has to go on.
  pageCount: z.number().int().nonnegative().nullable(),
  // True when reading this document will cost OCR credits, i.e. the text layer was not
  // usable. The selection step warns on it, and it is why a scanned document's page list
  // shows numbers only: rendering its text would mean running the very OCR being authorised.
  needsOcr: z.boolean(),
  source: PdfTextSourceSchema.nullable(),
  extractProgress: DocumentExtractProgressSchema.nullable(),
  progress: TranslateDocumentProgressSchema.nullable(),
  // One entry per completed target language; a re-run replaces its own language only.
  results: z.array(TranslateDocumentResultSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type TranslateDocumentDetail = z.infer<
  typeof TranslateDocumentDetailSchema
>;

export const CreateTranslateDocumentResponseSchema = z.object({
  id: z.string(),
  // From the free probe, so the selection list can render on the upload response without
  // waiting for a poll.
  pageCount: z.number().int().nonnegative(),
  needsOcr: z.boolean(),
});
export type CreateTranslateDocumentResponse = z.infer<
  typeof CreateTranslateDocumentResponseSchema
>;

// The free-text page instruction. Structural only by design: it resolves to page numbers
// and never reaches the translator (see interpret-document-instruction.ts).
export const InterpretDocumentInstructionRequestSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(TRANSLATE_DOCUMENT_INSTRUCTION_MAX_CHARS),
});
export type InterpretDocumentInstructionRequest = z.infer<
  typeof InterpretDocumentInstructionRequestSchema
>;

export const InterpretDocumentInstructionResponseSchema = z.object({
  // Empty when the instruction could not be resolved — the UI says so and leaves the
  // user's own selection untouched.
  pages: z.array(z.number().int().positive()),
  source: z.enum(['rule', 'model']),
  explanation: z.string(),
});
export type InterpretDocumentInstructionResponse = z.infer<
  typeof InterpretDocumentInstructionResponseSchema
>;

// Pages the user corrected in the review list, keyed by page number as a string. Only
// edited pages are sent; anything absent uses the OCR text held server-side.
const PageEditsSchema = z.record(z.string(), z.string()).optional();

// Selection + edits, shared by the prepare (name check) and translate requests so both
// operate on exactly the same text.
export const PrepareDocumentTranslationRequestSchema = z.object({
  pages: z.array(z.number().int().positive()).min(1),
  pageEdits: PageEditsSchema,
});
export type PrepareDocumentTranslationRequest = z.infer<
  typeof PrepareDocumentTranslationRequestSchema
>;

export const TranslateDocumentRequestSchema = z.object({
  // One or both targets. Both run in a single job (English first), because delivering a
  // document in two languages is the normal ask, not an edge case.
  languages: z.array(TranslationLanguageSchema).min(1).max(2),
  pages: z.array(z.number().int().positive()).min(1),
  pageEdits: PageEditsSchema,
  // User-confirmed names from the review card; saved verified and locked into this run,
  // exactly like the pasted-text route.
  terms: z.array(TranslationTermInputSchema).max(500).optional(),
});
export type TranslateDocumentRequest = z.infer<
  typeof TranslateDocumentRequestSchema
>;
