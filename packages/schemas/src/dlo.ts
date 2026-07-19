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

// One uploaded file's intake state. A failed file carries a Marathi error and
// does NOT fail the whole intake (the review step shows the warning instead).
export const DloIntakeFileSchema = z.object({
  name: z.string(),
  kind: z.enum(['audio', 'pdf', 'docx']),
  status: z.enum(['pending', 'done', 'failed']),
  // How many characters this source contributed to the combined text.
  chars: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
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
