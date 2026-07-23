// Request/response schemas for the DLO intake API (apps/api parsing + apps/web
// typed fetch wrappers): uploaded meeting files + notes → transcribed/extracted
// combined text → (after the officer's review) a normal generation.

import { z } from 'zod';

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
  kind: z.enum(['audio', 'pdf', 'docx']),
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
});
export type DloIntakeFile = z.infer<typeof DloIntakeFileSchema>;

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
