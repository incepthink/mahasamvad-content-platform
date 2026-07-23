// Request/response schemas for the generation API, shared by apps/api (request
// parsing) and apps/web (typed fetch wrappers + client-side validation).

import { z } from 'zod';
import { CopySchema, DesignModeSchema } from './copy.js';

export const OutputTypeSchema = z.enum(['article', 'poster', 'both']);
export type OutputType = z.infer<typeof OutputTypeSchema>;

// Which Mahasamvad voice to write in: 'scheme' (योजना-लेख feature), 'news' (बातमी
// report), or the social lanes 'twitter'/'facebook' (n8n-backed poster + caption,
// background task).
export const CategorySchema = z.enum(['news', 'scheme', 'twitter', 'facebook']);
export type Category = z.infer<typeof CategorySchema>;

// Categories rendered by the external social-post n8n workflow (poster + caption,
// background task, twitter master library) rather than the in-process article
// pipeline. 'facebook' runs the identical workflow today and exists as its own
// value so the two can diverge later; every social/article branch in apps/api and
// apps/web routes through this predicate.
export function isSocialCategory(category: Category): boolean {
  return category === 'twitter' || category === 'facebook';
}

// Template brand family for the social-poster flow, orthogonal to the platform lane
// (twitter/facebook). 'dgipr' is the default department; 'cmo' renders the
// मंत्रिमंडळ निर्णय template family (a fixed 3-leader header stamped in code, the DGIPR
// footer reused, 2 topic images painted by the model). The runner branches catalog
// selection, the n8n image prompt, and the chrome overlay on this; migration 0024.
export const TemplateBrandSchema = z.enum(['dgipr', 'cmo']);
export type TemplateBrand = z.infer<typeof TemplateBrandSchema>;

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
  // On-demand translation of a completed article (Sarvam + locked glossary).
  // A post-completion action, not part of the main pipeline.
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
  // A social run's caption (stored in the same `article` column): 'caption' is an AI
  // revision from the feedback box, 'manual_caption' a hand edit — the same pair as
  // poster_copy / manual_copy. Migration 0023.
  'caption',
  'manual_caption',
]);
export type RevisionTarget = z.infer<typeof RevisionTargetSchema>;

// Languages a Marathi article/text can be translated into on demand. Marathi itself is
// never a target — it is always the source of record. Both targets share one engine and
// one नाव-शब्दकोश; Hindi locks the glossary's Devanagari forms verbatim rather than
// mapping them to English (see translate-article.ts).
export const TranslationLanguageSchema = z.enum(['en', 'hi']);
export type TranslationLanguage = z.infer<typeof TranslationLanguageSchema>;

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
    // Template brand for a social run (ignored for news/scheme, and for a CMO run the
    // design mode is inert — CMO just follows its template). Absent ⇒ 'dgipr'.
    templateBrand: TemplateBrandSchema.optional(),
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
    // Lineage: the generation this run was spawned from (detail-page "next
    // step" actions + failed-run retry). The API validates it exists and
    // derives the thread root server-side. Absent = a new thread root (the
    // home form).
    sourceGenerationId: z.string().uuid().optional(),
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

// Feedback on a social run's caption. Same shape as the article's, but a different
// engine (a caption is one short social post, not a Mahasamvad article) and a
// different route — the article pipeline rejects social categories by design.
export const CaptionFeedbackRequestSchema = z.object({
  feedback: z.string().trim().min(3).max(4_000),
});
export type CaptionFeedbackRequest = z.infer<
  typeof CaptionFeedbackRequestSchema
>;

// Hand edit of a social run's caption: the officer typed it themselves, so it is
// stored verbatim with no model call.
export const UpdateCaptionRequestSchema = z.object({
  caption: z.string().trim().min(1).max(4_000),
});
export type UpdateCaptionRequest = z.infer<typeof UpdateCaptionRequestSchema>;

export const UpdateCaptionResponseSchema = z.object({ caption: z.string() });
export type UpdateCaptionResponse = z.infer<typeof UpdateCaptionResponseSchema>;

// Attach a poster to an existing article run (same row, no new generation) —
// article-only and DLO runs, plus the retry after a failed poster phase.
// Optional pin: use exactly this article-category reference image.
export const CreateArticlePosterRequestSchema = z.object({
  referenceImageId: z.string().uuid().optional(),
});
export type CreateArticlePosterRequest = z.infer<
  typeof CreateArticlePosterRequestSchema
>;

// Poster feedback is routed explicitly by the user: 'copy' revises the Marathi
// text (cheap re-render, cached scene), 'scene' regenerates the background image.
export const PosterFeedbackRequestSchema = z.object({
  target: z.enum(['copy', 'scene']),
  feedback: z.string().trim().min(3).max(4_000),
});
export type PosterFeedbackRequest = z.infer<typeof PosterFeedbackRequestSchema>;

// A rectangle on the poster, normalized to 0..1 of the image's width/height so
// it is independent of the displayed size (article 1536x1024, twitter 1280x1600).
// Placed in the web UI by a click (default-size box) or a drag (exact box).
export const FeedbackRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.005).max(1),
    height: z.number().min(0.005).max(1),
  })
  .superRefine((r, ctx) => {
    // Small epsilon: client-side float math may land exactly on the edge.
    if (r.x + r.width > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Region exceeds the right edge.',
        path: ['width'],
      });
    }
    if (r.y + r.height > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Region exceeds the bottom edge.',
        path: ['height'],
      });
    }
  });
export type FeedbackRegion = z.infer<typeof FeedbackRegionSchema>;

// One numbered pointing gesture plus its instruction. A marker tells the model
// WHERE the user is looking — the change applies to the element at/around it,
// never "only inside the box".
export const PosterFeedbackAnnotationSchema = z.object({
  region: FeedbackRegionSchema,
  note: z.string().trim().min(3).max(500),
});
export type PosterFeedbackAnnotation = z.infer<
  typeof PosterFeedbackAnnotationSchema
>;

export const POSTER_FEEDBACK_MAX_MARKERS = 3;

// Pixel-level feedback for an already rendered poster. Unlike the legacy
// copy/scene route, this edits the latest complete poster through n8n and works
// for both article and Twitter generations. Either free text, numbered marker
// annotations, or both; clients omit empty keys (min lengths reject '' / []).
export const PosterImageFeedbackRequestSchema = z
  .object({
    feedback: z.string().trim().min(3).max(4_000).optional(),
    annotations: z
      .array(PosterFeedbackAnnotationSchema)
      .min(1)
      .max(POSTER_FEEDBACK_MAX_MARKERS)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.feedback && !v.annotations?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide feedback text or at least one annotation.',
        path: ['feedback'],
      });
    }
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

// POST /api/generations/:id/publish — posts the poster + caption to the official
// account of the run's own platform (twitter → X, facebook → Page). No request
// body; returns the live post's URL.
export const PublishGenerationResponseSchema = z.object({
  postUrl: z.string(),
});
export type PublishGenerationResponse = z.infer<
  typeof PublishGenerationResponseSchema
>;

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

// One node in a generation thread (all runs spawned from the same note via the
// detail page, root first): a summary plus the lineage fields the thread strip
// needs. noteChanged = this run's note differs from its direct source's (an
// edit-note rerun), computed server-side.
export const ThreadItemSchema = GenerationSummarySchema.extend({
  sourceGenerationId: z.string().nullable(),
  noteChanged: z.boolean(),
});
export type ThreadItem = z.infer<typeof ThreadItemSchema>;

export const GenerationRevisionSchema = z.object({
  id: z.string(),
  target: RevisionTargetSchema,
  feedback: z.string().nullable(),
  createdAt: z.string(),
});
export type GenerationRevision = z.infer<typeof GenerationRevisionSchema>;

// One stored poster render. Every render writes a new immutable versioned PNG
// (the public bucket is CDN-cached, paths are never reused), so the full history
// stays downloadable. Ordered oldest→newest; the last entry is the current poster.
export const PosterVersionSchema = z.object({
  posterUrl: z.string(),
  createdAt: z.string(),
});
export type PosterVersion = z.infer<typeof PosterVersionSchema>;

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
  // Template brand the run was created with. Defaulted so a pre-0024 row (no column)
  // still parses; 'dgipr' for every non-social row.
  templateBrand: TemplateBrandSchema.default('dgipr'),
  note: z.string(),
  // Optional editorial angle the run was created with (null for pre-heading rows).
  heading: z.string().nullable(),
  // The reference image the run was pinned to (null = automatic rotation, or the
  // image was later deleted — the FK sets null).
  referenceImageId: z.string().nullable(),
  // The Twitter reference type pinned at creation (null = classifier chooses).
  referenceTypeId: z.string().nullable(),
  article: z.string().nullable(),
  // On-demand translations of `article`; each null until the user requests it. The two
  // are independent — translating to Hindi never touches the English text or vice versa.
  articleEnglish: z.string().nullable(),
  articleHindi: z.string().nullable(),
  factCheck: z.string().nullable(),
  copy: CopySchema.nullable(),
  fiveWOneH: FiveWOneHSchema.nullable(),
  posterUrl: z.string().nullable(),
  sceneUrl: z.string().nullable(),
  // Every poster render of this generation, oldest→newest (empty when the run has
  // no poster). The last entry always matches `posterUrl`.
  posterVersions: z.array(PosterVersionSchema),
  // Latest live social post of this run (social categories only; null = never
  // published). Re-publishing after a poster re-render overwrites both.
  publishedUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  error: z.string().nullable(),
  // The on-demand translation runs alongside the main job (the article is
  // final before the poster phase starts), so it cannot own status/step/error —
  // those belong to the main job. Its liveness and failure are reported here
  // instead, from the API's in-process job registry (both reset on restart).
  // Only one translation runs at a time per row; `translatingLanguage` names which
  // one, so a reload mid-run still labels the spinner correctly (null when idle).
  translating: z.boolean(),
  translatingLanguage: TranslationLanguageSchema.nullable(),
  translateError: z.string().nullable(),
  // Locked names the most recent Hindi translation could not preserve. The translation
  // still succeeded and is stored on the row; this is a review prompt, not a failure.
  // Transient like translateError — from the in-process registry, lost on restart and on
  // a reload long after the run — because the doubt matters when the officer reads the
  // fresh output. Empty array = translated cleanly; null = no translation attempted.
  translateWarnings: z.array(z.string()).nullable(),
  // Article revision can also run alongside the main job: while the poster is still
  // rendering the article is already final, so the user may refine it without waiting
  // out the render. Like `translating`, it can't own status/step/error and is reported
  // here from the API's in-process registry (both reset on restart).
  articleRevising: z.boolean(),
  articleReviseError: z.string().nullable(),
  // A social run's caption revision is reported the same way, and for the same reason:
  // it must NOT own status/step, or the finished post would be replaced by a progress
  // bar (and a caption edit could not run beside a poster re-render). Also from the
  // API's in-process registry, so both reset on restart.
  captionRevising: z.boolean(),
  captionReviseError: z.string().nullable(),
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
  // Optional corrected Hindi spelling; null = the Hindi lock keeps the Marathi form.
  hindi: z.string().nullable(),
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
  hindi: z.string().trim().max(200).optional(),
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
  hindi: z.string().trim().max(200).nullable().optional(),
  termType: TermTypeSchema.optional(),
  verified: z.boolean().optional(),
  notes: z.string().trim().max(1_000).nullable().optional(),
});
export type UpdateGlossaryTermRequest = z.infer<
  typeof UpdateGlossaryTermRequestSchema
>;

// ---------- Pre-translation name check ----------
// Every translation starts with a "check the names" step: the API extracts the text's
// proper nouns (merged with any glossary rows found in it) and the user confirms/corrects
// the English spellings IN PLACE before translating. Confirmed terms are saved as verified
// glossary rows and locked into the translation — so a wrong name (संवाद वारी → "dialogue
// van") never reaches the English output, and the dictionary grows verified as a side
// effect instead of via a separate /glossary visit. The check runs before a HINDI
// translation too: there the confirmed `hindi` spelling is used as the identity lock (it
// defaults to the Marathi Devanagari form, and the officer can correct it where the Hindi
// spelling should differ, e.g. कोल्हापूर → कोल्हापुर), so the same review keeps names right
// in both languages and keeps growing one shared dictionary.

// One user-confirmed name mapping sent along with a translate request. `english` feeds the
// English lock; `hindi` (optional) feeds the Hindi lock, falling back to the Marathi form.
export const TranslationTermInputSchema = z.object({
  marathi: z.string().trim().min(1).max(200),
  english: z.string().trim().min(1).max(200),
  hindi: z.string().trim().max(200).optional(),
  termType: TermTypeSchema.optional(),
});
export type TranslationTermInput = z.infer<typeof TranslationTermInputSchema>;

// A term proposed for review: extracted from the text and/or already in the glossary.
// `verified` renders the reassurance badge — those rows arrive pre-locked. `hindi` is the
// pre-filled Hindi spelling shown on a Hindi run (prepare defaults it to the Marathi form).
export const PrepareTranslationResponseSchema = z.object({
  terms: z.array(
    z.object({
      marathi: z.string(),
      english: z.string(),
      hindi: z.string(),
      termType: TermTypeSchema,
      verified: z.boolean(),
    }),
  ),
});
export type PrepareTranslationResponse = z.infer<
  typeof PrepareTranslationResponseSchema
>;

// Body of POST /generations/:id/translate. `terms` is the user-confirmed name list from
// the review step; optional so a bare request (older client) still translates. `language`
// defaults to 'en' for the same reason — a bare body means the original English path.
export const TranslateGenerationRequestSchema = z.object({
  terms: z.array(TranslationTermInputSchema).max(200).optional(),
  language: TranslationLanguageSchema.default('en'),
});
export type TranslateGenerationRequest = z.infer<
  typeof TranslateGenerationRequestSchema
>;

// ---------- Standalone text translation (not tied to a generation) ----------

// Translation is one sequential Sarvam call per ~2500 chars, so the input is capped to keep
// a synchronous request bounded (~4 blocks). Shared with the web form's character counter so
// the client and the API agree on the limit.
export const TRANSLATE_TEXT_MAX_CHARS = 10_000;

export const PrepareTranslateTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(TRANSLATE_TEXT_MAX_CHARS),
});
export type PrepareTranslateTextRequest = z.infer<
  typeof PrepareTranslateTextRequestSchema
>;

export const TranslateTextRequestSchema = z.object({
  text: z.string().trim().min(1).max(TRANSLATE_TEXT_MAX_CHARS),
  // User-confirmed names from the review step. When present they are saved as verified
  // glossary rows and locked into this translation; when absent the legacy path mines
  // candidates into the review queue instead.
  terms: z.array(TranslationTermInputSchema).max(200).optional(),
  language: TranslationLanguageSchema.default('en'),
});
export type TranslateTextRequest = z.infer<typeof TranslateTextRequestSchema>;

export const TranslateTextResponseSchema = z.object({
  // The translation, in `language`. Read this, not `english`.
  translated: z.string(),
  language: TranslationLanguageSchema,
  // Legacy mirror of `translated`, sent only for language 'en'. Kept (optional) so a web
  // build deployed ahead of the API still parses the response; drop once both are current.
  english: z.string().optional(),
  // Transparency for the UI: how many verified glossary terms were locked, and how many new
  // candidates were mined (always 0 when `terms` was sent — the confirmed-names path skips
  // mining; nonzero only on the legacy no-terms path, and 0 there too if mining failed).
  lockedTermCount: z.number().int().nonnegative(),
  minedTermCount: z.number().int().nonnegative(),
  // Locked names the Hindi output could not be made to carry (see translate-article.ts).
  // The translation is still returned; the UI flags these for a human check. Empty for
  // English and for a clean Hindi run.
  unpreservedNames: z.array(z.string()),
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
  // Template brand family (migration 0024). Defaulted so pre-0024 rows (no column)
  // parse; the home template picker filters on it so CMO types never appear in the
  // DGIPR flow and vice versa.
  brand: TemplateBrandSchema.default('dgipr'),
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
  // Flip a type between the DGIPR pool and the CMO template family (migration 0024).
  brand: TemplateBrandSchema.optional(),
});
export type UpdateReferenceTypeRequest = z.infer<
  typeof UpdateReferenceTypeRequestSchema
>;

// What a master template actually looks like, read off its pixels by a vision
// pass at upload time (migration 0016). This — not the type's prose description —
// is what tells the n8n image prompt whether the template has a photo to repaint,
// so a text-only master is never given a hero photograph it never had.
export const ReferenceLayoutSpecSchema = z.object({
  // A distinct photograph/portrait/illustration of a subject. A faded background
  // wash or watermark is NOT a photo zone — see analyze-template.ts.
  hasPhotoZone: z.boolean(),
  // Repeating body slots (cards / bullets / rows); 0 if the template has none.
  // Pins the bullet count in the copy prompt so copy can't overflow the master.
  bulletSlots: z.number().int().min(0).max(12),
  layoutSummary: z.string(),
});
export type ReferenceLayoutSpec = z.infer<typeof ReferenceLayoutSpecSchema>;

// Manual override for a bad vision read: rewrites the cached jsonb in place.
export const UpdateLayoutSpecRequestSchema = z.object({
  hasPhotoZone: z.boolean(),
});
export type UpdateLayoutSpecRequest = z.infer<
  typeof UpdateLayoutSpecRequestSchema
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
  // null = not analyzed yet (pre-0016 rows). The workflow falls back to its
  // previous behaviour rather than failing.
  layoutSpec: ReferenceLayoutSpecSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
