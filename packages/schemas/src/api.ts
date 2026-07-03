// Request/response schemas for the generation API, shared by apps/api (request
// parsing) and apps/web (typed fetch wrappers + client-side validation).

import { z } from 'zod';
import { CopySchema } from './copy.js';

export const OutputTypeSchema = z.enum(['article', 'poster', 'both']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

export const GenerationStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

// Machine step keys written by the API job runner; the web UI maps each to a
// Marathi progress label. Order here mirrors pipeline order.
export const GenerationStepSchema = z.enum([
  'retrieve',
  'draft',
  'coverage',
  'faithfulness',
  'copy',
  'scene',
  'render',
  'revise_article',
  'revise_copy',
  'revise_scene',
  'done',
]);
export type GenerationStep = z.infer<typeof GenerationStepSchema>;

export const RevisionTargetSchema = z.enum([
  'article',
  'poster_copy',
  'poster_scene',
  'manual_copy',
]);
export type RevisionTarget = z.infer<typeof RevisionTargetSchema>;

export const CreateGenerationRequestSchema = z.object({
  // The Marathi note (टिपणी) — sole factual source for everything generated.
  note: z.string().trim().min(20).max(60_000),
  outputType: OutputTypeSchema,
});
export type CreateGenerationRequest = z.infer<
  typeof CreateGenerationRequestSchema
>;

export const CreateGenerationResponseSchema = z.object({ id: z.string() });
export type CreateGenerationResponse = z.infer<
  typeof CreateGenerationResponseSchema
>;

export const ArticleFeedbackRequestSchema = z.object({
  feedback: z.string().trim().min(3).max(4_000),
});
export type ArticleFeedbackRequest = z.infer<
  typeof ArticleFeedbackRequestSchema
>;

// Poster feedback is routed explicitly by the user: 'copy' revises the Marathi
// text (cheap re-render, cached scene), 'scene' regenerates the background image.
export const PosterFeedbackRequestSchema = z.object({
  target: z.enum(['copy', 'scene']),
  feedback: z.string().trim().min(3).max(4_000),
});
export type PosterFeedbackRequest = z.infer<typeof PosterFeedbackRequestSchema>;

// Manual poster text edit: the full edited Copy JSON.
export const UpdateCopyRequestSchema = CopySchema;

export const UpdateCopyResponseSchema = z.object({
  posterUrl: z.string(),
});
export type UpdateCopyResponse = z.infer<typeof UpdateCopyResponseSchema>;

// History card.
export const GenerationSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  outputType: OutputTypeSchema,
  status: GenerationStatusSchema,
  noteExcerpt: z.string(),
  headline: z.string().nullable(),
  posterUrl: z.string().nullable(),
});
export type GenerationSummary = z.infer<typeof GenerationSummarySchema>;

export const GenerationRevisionSchema = z.object({
  id: z.string(),
  target: RevisionTargetSchema,
  feedback: z.string().nullable(),
  createdAt: z.string(),
});
export type GenerationRevision = z.infer<typeof GenerationRevisionSchema>;

export const GenerationDetailSchema = z.object({
  id: z.string(),
  status: GenerationStatusSchema,
  step: GenerationStepSchema.nullable(),
  outputType: OutputTypeSchema,
  note: z.string(),
  article: z.string().nullable(),
  factCheck: z.string().nullable(),
  copy: CopySchema.nullable(),
  posterUrl: z.string().nullable(),
  sceneUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revisions: z.array(GenerationRevisionSchema),
});
export type GenerationDetail = z.infer<typeof GenerationDetailSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
