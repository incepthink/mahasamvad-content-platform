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
  'revise_image',
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
  'poster_image',
]);
export type RevisionTarget = z.infer<typeof RevisionTargetSchema>;

export const CreateGenerationRequestSchema = z
  .object({
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
    // Optional pin: use exactly this reference image (from the master-template
    // library) for the run's poster instead of the per-type random rotation.
    // Pinning a twitter image also pins the post type (classification is skipped).
    referenceImageId: z.string().uuid().optional(),
    // Optional Twitter section pin: classification is skipped, but one enabled
    // image from the selected type is rolled independently for every run.
    referenceTypeId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.referenceImageId && value.referenceTypeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Reference image and reference type pins are mutually exclusive.',
        path: ['referenceTypeId'],
      });
    }
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

// Pixel-level feedback for an already rendered poster. Unlike the legacy
// copy/scene route, this edits the latest complete poster through n8n and works
// for both article and Twitter generations.
export const PosterImageFeedbackRequestSchema = z.object({
  feedback: z.string().trim().min(3).max(4_000),
});
export type PosterImageFeedbackRequest = z.infer<
  typeof PosterImageFeedbackRequestSchema
>;

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
  // Total USD the run has cost so far (null for pre-feature rows). Estimate: text is
  // measured from OpenAI usage, image is a fixed per-render tier price.
  costUsd: z.number().nullable(),
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
  // The reference image the run was pinned to (null = automatic rotation, or the
  // image was later deleted — the FK sets null).
  referenceImageId: z.string().nullable(),
  // The Twitter reference type pinned at creation (null = classifier chooses).
  referenceTypeId: z.string().nullable(),
  article: z.string().nullable(),
  // On-demand English translation of `article`; null until the user requests it.
  articleEnglish: z.string().nullable(),
  factCheck: z.string().nullable(),
  copy: CopySchema.nullable(),
  fiveWOneH: FiveWOneHSchema.nullable(),
  posterUrl: z.string().nullable(),
  sceneUrl: z.string().nullable(),
  error: z.string().nullable(),
  // The on-demand English translation runs alongside the main job (the article is
  // final before the poster phase starts), so it cannot own status/step/error —
  // those belong to the main job. Its liveness and failure are reported here
  // instead, from the API's in-process job registry (both reset on restart).
  translating: z.boolean(),
  translateError: z.string().nullable(),
  // Total USD the run has cost so far (null for pre-feature rows). `costBreakdown` carries
  // the audit detail (token counts + text-vs-image split); shape is intentionally loose.
  costUsd: z.number().nullable(),
  costBreakdown: z.unknown().nullable(),
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

// ---------- Standalone text translation (not tied to a generation) ----------

// Translation is one sequential Sarvam call per ~2500 chars, so the input is capped to keep
// a synchronous request bounded (~4 blocks). Shared with the web form's character counter so
// the client and the API agree on the limit.
export const TRANSLATE_TEXT_MAX_CHARS = 10_000;

export const TranslateTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(TRANSLATE_TEXT_MAX_CHARS),
  // Opt-in: also mine proper-noun candidates from this text into the glossary review queue.
  mineTerms: z.boolean().optional(),
});
export type TranslateTextRequest = z.infer<typeof TranslateTextRequestSchema>;

export const TranslateTextResponseSchema = z.object({
  english: z.string(),
  // Transparency for the UI: how many verified glossary terms were locked, and how many new
  // candidates were mined (0 when mineTerms is off, or when mining failed — it's best-effort).
  lockedTermCount: z.number().int().nonnegative(),
  minedTermCount: z.number().int().nonnegative(),
});
export type TranslateTextResponse = z.infer<typeof TranslateTextResponseSchema>;

// ---------- Reference types + images ----------

export const ReferenceCategorySchema = z.enum(['twitter', 'article']);
export type ReferenceCategory = z.infer<typeof ReferenceCategorySchema>;

// Which copy schema/layout the n8n social-post workflow renders a type with.
// Builtin twitter types keep their bespoke layout; custom types are 'generic'
// (headline + points, info_bullets-shaped).
export const CopyStyleSchema = z.enum([
  'alert',
  'campaign',
  'info_bullets',
  'quote',
  'timeline',
  'generic',
]);
export type CopyStyle = z.infer<typeof CopyStyleSchema>;

// One poster type slot (builtin, or a user-created custom twitter type). Slugs
// are server-generated and machine-safe (^[a-z0-9_]+$) because they feed OpenAI
// json_schema enums and storage paths; labelMr carries the Devanagari.
export const ReferenceTypeSchema = z.object({
  id: z.string(),
  category: ReferenceCategorySchema,
  slug: z.string(),
  labelMr: z.string(),
  description: z.string(),
  copyStyle: CopyStyleSchema,
  isBuiltin: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReferenceType = z.infer<typeof ReferenceTypeSchema>;

export const CreateReferenceTypeRequestSchema = z.object({
  labelMr: z.string().trim().min(1).max(60),
  // Required: the n8n classifier routes notes to this type by its description.
  description: z.string().trim().min(3).max(300),
});
export type CreateReferenceTypeRequest = z.infer<
  typeof CreateReferenceTypeRequestSchema
>;

export const UpdateReferenceTypeRequestSchema = z.object({
  labelMr: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().min(3).max(300).optional(),
});
export type UpdateReferenceTypeRequest = z.infer<
  typeof UpdateReferenceTypeRequestSchema
>;

export const ReferenceImageSchema = z.object({
  id: z.string(),
  category: ReferenceCategorySchema,
  // A reference_types slug; validated against the catalog server-side.
  subtype: z.string(),
  storagePath: z.string(),
  url: z.string(),
  // Enabled in the rotation: many images per type may be enabled at once; one
  // is picked at random per generation.
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
