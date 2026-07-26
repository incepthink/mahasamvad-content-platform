// Request/response schemas for the DLO intake API (apps/api parsing + apps/web
// typed fetch wrappers): uploaded meeting files + notes → transcribed/extracted
// combined text → (after the officer's review) a normal generation.

import { z } from 'zod';
import { PdfTextSourceSchema } from './document.js';
import { NameDesignationsSchema } from './designations.js';

export const DloIntakeStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
]);
export type DloIntakeStatus = z.infer<typeof DloIntakeStatusSchema>;

// Machine step keys written by the intake job; the web UI maps each to a Marathi
// progress label. Order mirrors pipeline order.
export const DloIntakeStepSchema = z.enum([
  'upload',
  'transcribe',
  'extract',
  'combine',
  'done',
]);
export type DloIntakeStep = z.infer<typeof DloIntakeStepSchema>;

// The article voices DLO can generate — 'twitter' is deliberately excluded.
export const DloCategorySchema = z.enum(['news', 'scheme']);
export type DloCategory = z.infer<typeof DloCategorySchema>;

// One extracted PDF page. `page` is the ORIGINAL document's page number (never a
// running index — see PdfPage in @dgipr/content-engine), because the review step
// lists and selects by it.
export const DloIntakePageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
});
export type DloIntakePage = z.infer<typeof DloIntakePageSchema>;

// One uploaded file's intake state. A failed file carries a Marathi error and
// does NOT fail the whole intake (the review step shows the warning instead).
//
// The text fields are what the review step edits, and they are only sent when the
// request asks for them (`?text=1`) — the 2.5 s poll would otherwise re-ship a
// whole meeting transcript on every tick.
export const DloIntakeFileSchema = z.object({
  name: z.string(),
  // 'txt' arrives only through the pre-read document path below — the intake job has no
  // reader for it, because a .txt is read locally and free at upload time.
  kind: z.enum(['audio', 'pdf', 'docx', 'txt']),
  // 'needs-selection': a scanned PDF that was probed but deliberately NOT read, because
  // reading it costs OCR credits per page. It waits here until the officer picks pages.
  status: z.enum(['pending', 'needs-selection', 'done', 'failed']),
  // How many characters this source contributed to the combined text.
  chars: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  // Audio/DOCX: the whole extracted text. PDFs use `pages` instead so the review
  // step can offer per-page selection.
  text: z.string().optional(),
  pages: z.array(DloIntakePageSchema).optional(),
  // Total pages in this PDF, from the free probe — what the page picker lists before
  // anything has been read. Always present on a 'needs-selection' file.
  pageCount: z.number().int().nonnegative().optional(),
  // Which backend read this PDF. Surfaced because OCR misreads names and amounts
  // while a text layer is exact — and it gates the "read it with OCR instead" offer.
  pdfSource: z.enum(['text-layer', 'ocr']).optional(),
  // Whether this file can still be re-read with OCR, i.e. its original bytes are in the
  // private bucket. False for a document whose ephemeral upload job had already expired
  // when the intake was created — there is nothing left to re-read, so the review step
  // hides the override rather than offering a button that can only fail.
  canReextract: z.boolean().optional(),
});
export type DloIntakeFile = z.infer<typeof DloIntakeFileSchema>;

// A document the officer uploaded and READ at the input step, through the shared ephemeral
// document service, before this intake existed. It arrives already extracted, so the intake
// job has nothing to do with it — the route stores it as a finished file entry and every
// downstream step (review cards, assembly, generation) treats it like any other source.
//
// `jobId` is the ephemeral job the text came from. The API looks it up IN PROCESS to archive
// the original bytes into the private bucket; an expired job simply means the archive (and
// with it the per-file OCR re-read) is skipped, never that the text is lost — the text is
// right here in the payload.
export const DloPreReadDocumentSchema = z.object({
  jobId: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(['pdf', 'docx', 'txt']),
  // Total pages in the source document, for the record. Not the number of pages read: a
  // scanned PDF ships only the pages the officer chose to pay for.
  pageCount: z.number().int().nonnegative().optional(),
  pdfSource: PdfTextSourceSchema.optional(),
  // PDFs carry the SELECTED pages, with the officer's corrections already applied, so the
  // review card lists exactly what was kept. DOCX/TXT carry one string.
  pages: z.array(DloIntakePageSchema).optional(),
  text: z.string().optional(),
  // Pages the officer chose but chose NOT to wait for ("न वाचता ही पृष्ठे वापरा"). The intake job
  // reads exactly these from the archived original during its extract phase, so the OCR wait
  // folds into प्रक्रिया instead of standing in front of the form. Mutually exclusive with
  // `pages`, and PDF-only — nothing else has pages to defer. It needs the original bytes, so a
  // document whose ephemeral job has expired cannot be deferred: the route marks that file
  // failed rather than dropping a source silently.
  pendingPages: z.array(z.number().int().positive()).min(1).optional(),
});
export type DloPreReadDocument = z.infer<typeof DloPreReadDocumentSchema>;

// Same ceiling as the multipart file limit — an intake is a meeting's worth of material,
// not a document library.
export const DloCreateDocumentsSchema = z.array(DloPreReadDocumentSchema).max(10);

export const DloIntakeDetailSchema = z.object({
  id: z.string(),
  status: DloIntakeStatusSchema,
  step: DloIntakeStepSchema.nullable(),
  notes: z.string(),
  category: DloCategorySchema,
  heading: z.string().nullable(),
  files: z.array(DloIntakeFileSchema),
  // The combined transcription/extraction output; null until status is 'ready'.
  combinedText: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DloIntakeDetail = z.infer<typeof DloIntakeDetailSchema>;

export const CreateDloIntakeResponseSchema = z.object({ id: z.string() });
export type CreateDloIntakeResponse = z.infer<
  typeof CreateDloIntakeResponseSchema
>;

// The review step's "generate" submission. combinedText is the officer-edited
// text and becomes the generation's note verbatim, so it shares the note field's
// bounds (min 20 / max 60_000 — see CreateGenerationRequestSchema).
export const DloGenerateRequestSchema = z.object({
  combinedText: z.string().trim().min(20).max(60_000),
  category: DloCategorySchema,
  heading: z.string().trim().max(200).optional(),
  // Facts the officer kept in the Pointers step. The dimension is persisted with each
  // bullet so the article pipeline can reuse the approved inventory as its 5W1H scaffold.
  selectedFacts: z
    .array(
      z.object({
        dimension: z.enum(['who', 'what', 'when', 'where', 'why', 'how']),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .max(60)
    .optional(),
  // Attributed statements the officer kept. Empty designation/venue fields mean the note
  // did not state them and are never filled by inference.
  statements: z
    .array(
      z.object({
        speaker: z.string().trim().min(1).max(200),
        designation: z.string().trim().max(200),
        venue: z.string().trim().max(300),
        claim: z.string().trim().min(1).max(1000),
      }),
    )
    .max(12)
    .optional(),
  // Facts the officer deselected in the Pointers step (their AI-summarized bullet text).
  // The generation pipeline is instructed to leave these out — see pointers.ts. Absent/empty
  // ⇒ nothing excluded ⇒ the article the intake would have produced before this feature.
  excludedFacts: z.array(z.string().trim().min(1).max(500)).max(60).optional(),
  // Person → पदनाम pairs the officer approved in the "व्यक्ती व पदनाम" step — see
  // designations.ts. The designation is printed before the name on its first mention in the
  // article, and both translations inherit it. Absent/empty ⇒ every name prints bare.
  designations: NameDesignationsSchema.optional(),
});
export type DloGenerateRequest = z.infer<typeof DloGenerateRequestSchema>;

export const DloGenerateResponseSchema = z.object({
  generationId: z.string(),
});
export type DloGenerateResponse = z.infer<typeof DloGenerateResponseSchema>;

// "Read these pages of these PDFs." One request covering every file the officer just chose
// pages for, since an intake can hold several scanned documents. This is the call that
// spends OCR credits, and it spends them only on the pages listed here.
export const DloExtractRequestSchema = z.object({
  selections: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        pages: z.array(z.number().int().positive()).min(1),
      }),
    )
    .min(1),
});
export type DloExtractRequest = z.infer<typeof DloExtractRequestSchema>;

// The re-read request: "this PDF's text came out wrong, read it with OCR instead."
// Only 'ocr' is accepted — going back to the text layer would just reproduce the
// text the user is rejecting. `pages` is required for the same reason it is on the
// /translate override: re-reading is not a licence to re-bill excluded pages.
export const DloReextractFileRequestSchema = z.object({
  source: z.literal('ocr'),
  pages: z.array(z.number().int().positive()).min(1),
});
export type DloReextractFileRequest = z.infer<
  typeof DloReextractFileRequestSchema
>;

// ---------- combining sources into the reviewable text ----------
//
// Lives here, not in @dgipr/content-engine, because BOTH sides build this string:
// the intake job writes the full combined text to the row, and the web review step
// re-assembles it from the officer's per-source edits and page selection. The
// `=== स्रोत: … ===` header format must be identical in both, and apps/web cannot
// import content-engine (pdfjs, sarvam, openai). Same reason tweetWeightedLength
// lives here rather than in @dgipr/social-publisher.

export type IntakeSource = Readonly<{
  // Display label, usually the uploaded file's name.
  label: string;
  text: string;
}>;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function combineIntakeSources(
  notes: string,
  sources: readonly IntakeSource[],
): string {
  const cleanNotes = normalize(notes);
  const cleanSources = sources
    .map((source) => ({ label: source.label, text: normalize(source.text) }))
    .filter((source) => source.text.length > 0);

  // A single source with no notes needs no header — keep the note clean.
  if (!cleanNotes && cleanSources.length === 1) return cleanSources[0]!.text;
  if (cleanNotes && cleanSources.length === 0) return cleanNotes;

  const parts: string[] = [];
  if (cleanNotes) parts.push(`=== टिपणी ===\n${cleanNotes}`);
  for (const source of cleanSources) {
    parts.push(`=== स्रोत: ${source.label} ===\n${source.text}`);
  }
  return parts.join('\n\n');
}
