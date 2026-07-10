// Request/response schemas for the generation API, shared by apps/api (request
// parsing) and apps/web (typed fetch wrappers + client-side validation).

import { z } from 'zod';
import { CopySchema, DesignModeSchema } from './copy.js';

export const OutputTypeSchema = z.enum(['article', 'poster', 'both']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

// Which Mahasamvad voice to write in: 'scheme' (योजना-लेख feature), 'news' (बातमी
// report), or 'twitter' (n8n-backed poster + X caption, background task).
export const CategorySchema = z.enum(['news', 'scheme', 'twitter']);
export type Category = z.infer<typeof CategorySchema>;

// Poster design mode for the Twitter flow ('onbrand'/'adaptive' reuse master
// templates, 'fresh' paints a new background) is imported from copy.ts above —
// same values, single source of truth. The package barrel re-exports it via copy.js.

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
  // Extract the 5W1H (कोण/काय/केव्हा/कुठे/का/कसे) fact scaffold from the note
  // before drafting; runs right after retrieval.
  'extract_5w1h',
  // Derive the editorial brief (angle, fact tiers, arc + subheading plan) from the
  // note before drafting; runs right after 5W1H extraction.
  'editorial_brief',
  'draft',
  'coverage',
  'faithfulness',
  // Twitter (n8n social-post) stages: classify → copy (reused) → image → caption.
  'classify',
  'copy',
  'image',
  'caption',
  'scene',
  'render',
  'revise_article',
  'revise_copy',
  'revise_scene',
  // On-demand English translation of a completed article (Sarvam + locked
  // glossary). A post-completion action, not part of the main pipeline.
  'translate',
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
  // The Mahasamvad voice to write in. Defaults to 'scheme' (the original behaviour).
  category: CategorySchema.default('scheme'),
  // Poster design mode for the Twitter flow (ignored for news/scheme). The runner
  // defaults it to 'onbrand' when absent for a twitter request.
  designMode: DesignModeSchema.optional(),
  // Optional editorial angle / title directive supplied by the user. NOT a fact
  // source — only steers emphasis + heading. Empty/absent ⇒ the model picks its
  // own angle (today's behaviour). Consumed by the engine in later parts.
  heading: z.string().trim().max(200).optional(),
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

// History card. `category` + `step` let the web tasks panel filter to twitter
// runs and drive the staged progress bar from the list endpoint on refresh.
export const GenerationSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  outputType: OutputTypeSchema,
  category: CategorySchema,
  status: GenerationStatusSchema,
  step: GenerationStepSchema.nullable(),
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

// 5W1H (कोण/काय/केव्हा/कुठे/का/कसे) extracted from the note before drafting, as a
// fact-grounding + inverted-pyramid scaffold. Every field is a Marathi string;
// "" means the note did not state it (never inferred/invented — see AGENTS.md).
export const FiveWOneHSchema = z.object({
  who: z.string(),
  what: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  how: z.string(),
});
export type FiveWOneH = z.infer<typeof FiveWOneHSchema>;

export const GenerationDetailSchema = z.object({
  id: z.string(),
  status: GenerationStatusSchema,
  step: GenerationStepSchema.nullable(),
  outputType: OutputTypeSchema,
  category: CategorySchema,
  // Poster design mode the run was created with (null for non-twitter rows).
  designMode: DesignModeSchema.nullable(),
  note: z.string(),
  // Optional editorial angle the run was created with (null for pre-heading rows).
  heading: z.string().nullable(),
  article: z.string().nullable(),
  // On-demand English translation of `article`; null until the user requests it.
  articleEnglish: z.string().nullable(),
  factCheck: z.string().nullable(),
  copy: CopySchema.nullable(),
  fiveWOneH: FiveWOneHSchema.nullable(),
  posterUrl: z.string().nullable(),
  sceneUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revisions: z.array(GenerationRevisionSchema),
});
export type GenerationDetail = z.infer<typeof GenerationDetailSchema>;

// ---------- Glossary (Marathi->English proper-noun lock dictionary) ----------
// Mirrors the glossary_terms row shape in @dgipr/database. Verified terms are locked
// into the Sarvam translation prompt so a known name is never mistranslated; unverified
// rows are auto-mined candidates awaiting review on the /glossary page.

export const TermTypeSchema = z.enum([
  'person',
  'designation',
  'scheme',
  'place',
  'org',
  'other',
]);
export type TermType = z.infer<typeof TermTypeSchema>;

export const TermSourceSchema = z.enum(['auto', 'manual', 'seed']);
export type TermSource = z.infer<typeof TermSourceSchema>;

export const GlossaryTermSchema = z.object({
  id: z.string(),
  marathi: z.string(),
  english: z.string(),
  termType: TermTypeSchema,
  verified: z.boolean(),
  source: TermSourceSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

// Manual add of a term (the review form or a direct add). marathi is the conflict key.
export const CreateGlossaryTermRequestSchema = z.object({
  marathi: z.string().trim().min(1).max(200),
  english: z.string().trim().min(1).max(200),
  termType: TermTypeSchema.optional(),
  verified: z.boolean().optional(),
  notes: z.string().trim().max(1_000).optional(),
});
export type CreateGlossaryTermRequest = z.infer<
  typeof CreateGlossaryTermRequestSchema
>;

// Edit an existing term by id. marathi (the conflict key) is intentionally not editable
// here — changing it is a delete + re-add concern. At least one field should be present.
export const UpdateGlossaryTermRequestSchema = z.object({
  english: z.string().trim().min(1).max(200).optional(),
  termType: TermTypeSchema.optional(),
  verified: z.boolean().optional(),
  notes: z.string().trim().max(1_000).nullable().optional(),
});
export type UpdateGlossaryTermRequest = z.infer<
  typeof UpdateGlossaryTermRequestSchema
>;

export const ApiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
