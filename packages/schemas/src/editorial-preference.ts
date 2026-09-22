// Learned editorial preferences (migration 0057): the /dlo article lane's procedural memory,
// shared between the API that seeds and serves them and the web that will review them.
//
// WHAT A PREFERENCE IS. One short Marathi imperative about HOW to write — "शीर्षक १० शब्दांच्या
// आत ठेवा", "निर्णयाची तारीख पहिल्या परिच्छेदात द्या". It is the generalizable residue of an
// officer's feedback, not the feedback itself, and above all NOT A FACT: a rule may never
// introduce a name, date, amount, designation, scheme name or place. That fence is stated in
// the injected block (editorial-preferences-block.ts) because it is the one way this feature
// could damage a government article, and stating it once in prose is cheaper than any guard.
//
// MACHINE KEYS ONLY. Every Marathi label belongs in apps/web/lib/strings.ts; what travels
// here are the enum values the API and the database agree on.

import { z } from 'zod';

// Which article category a rule applies to. `both` is not a category — it means "applies
// whatever the article is", which is what an unscoped rule about house style really says.
export const EditorialPreferenceScopeSchema = z.enum([
  'news',
  'scheme',
  'both',
]);
export type EditorialPreferenceScope = z.infer<
  typeof EditorialPreferenceScopeSchema
>;

// active — injected into the next article. disabled — an officer turned it off, and it is
// kept so it can be turned back on. superseded — replaced, with `supersededBy` naming what
// replaced it. Nothing is deleted on supersession; see the migration.
export const EditorialPreferenceStatusSchema = z.enum([
  'active',
  'disabled',
  'superseded',
]);
export type EditorialPreferenceStatus = z.infer<
  typeof EditorialPreferenceStatusSchema
>;

export const EditorialPreferenceSourceSchema = z.enum(['learned', 'manual']);
export type EditorialPreferenceSource = z.infer<
  typeof EditorialPreferenceSourceSchema
>;

/**
 * How long one rule may be.
 *
 * 240 characters is roughly two Marathi sentences — enough to say what to do and when, and
 * short enough that twelve of them do not crowd out the source the article is written from.
 * It is also the length at which a rule stops being a rule: anything longer is an instruction
 * for ONE article, which is what `generations.instructions` (migration 0041) already is.
 */
export const PREFERENCE_RULE_MAX_CHARS = 240;

/**
 * How many rules reach one article.
 *
 * The binding constraint is the /dlo lane's context, not taste: on gemma the endpoint is set
 * to MAX_MODEL_LEN=32768 and the prompt already carries the officer's source and up to three
 * complete Mahasamvad exemplars. Twelve rules at 240 Marathi characters is ~2,880 characters
 * ≈ 760 tokens at Gemma's measured ~3.8 chars/token — comfortable, and it is this cap that
 * keeps it so.
 *
 * It is also an editorial ceiling. A model given forty standing rules follows none of them
 * particularly well, so the cap plus `reinforcement_count` ranking is what keeps the set
 * sharp. Rules past the cap are not deleted — they stay stored and inert.
 */
export const MAX_INJECTED_PREFERENCES = 12;

// One row as the API returns it. Timestamps are ISO strings, as everywhere else on the wire.
export const EditorialPreferenceSchema = z.object({
  id: z.string(),
  rule: z.string(),
  scope: EditorialPreferenceScopeSchema,
  status: EditorialPreferenceStatusSchema,
  source: EditorialPreferenceSourceSchema,
  reinforcementCount: z.number().int(),
  sourceFeedback: z.string().nullable(),
  sourceGenerationId: z.string().nullable(),
  supersededBy: z.string().nullable(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EditorialPreference = z.infer<typeof EditorialPreferenceSchema>;

// Seeding a rule by hand. `source` is not a request field: a rule that arrives through this
// route was typed by a person, which is exactly what `manual` records.
export const CreateEditorialPreferenceRequestSchema = z.object({
  rule: z.string().trim().min(1).max(PREFERENCE_RULE_MAX_CHARS),
  scope: EditorialPreferenceScopeSchema.optional(),
  status: EditorialPreferenceStatusSchema.optional(),
});
export type CreateEditorialPreferenceRequest = z.infer<
  typeof CreateEditorialPreferenceRequestSchema
>;

// Editing one. Every field optional, and at least one required — a PATCH that changes nothing
// is a request that was built wrong, and answering 200 to it hides that.
export const UpdateEditorialPreferenceRequestSchema = z
  .object({
    rule: z.string().trim().min(1).max(PREFERENCE_RULE_MAX_CHARS).optional(),
    scope: EditorialPreferenceScopeSchema.optional(),
    status: EditorialPreferenceStatusSchema.optional(),
  })
  .refine(
    (body) =>
      body.rule !== undefined ||
      body.scope !== undefined ||
      body.status !== undefined,
    { message: 'At least one field must be supplied.' },
  );
export type UpdateEditorialPreferenceRequest = z.infer<
  typeof UpdateEditorialPreferenceRequestSchema
>;

/**
 * Which rules actually reach the model right now — the "in use / beyond the cap" marker.
 *
 * WHY THE API ANSWERS THIS AND NOT THE PAGE. The set is not "the first twelve rows on
 * screen": it is `listActiveEditorialPreferences`'s own answer — active only, scope matched,
 * ranked by `reinforcement_count` then `last_seen_at`, capped at MAX_INJECTED_PREFERENCES —
 * and it is computed PER CATEGORY, because a `news` rule never competes with a `scheme` one
 * while a `both` rule competes in both pools. Re-implementing that ranking in the browser
 * would give the marker a second source of truth that drifts the day the ordering changes;
 * the route calls the very function the article is written with, so it cannot.
 *
 * An id absent from BOTH lists is stored and inert: nothing deletes it, and it starts
 * steering articles again the moment its reinforcement rises or an active rule above it is
 * disabled.
 */
export const InjectedPreferenceIdsSchema = z.object({
  news: z.array(z.string()),
  scheme: z.array(z.string()),
});
export type InjectedPreferenceIds = z.infer<typeof InjectedPreferenceIdsSchema>;

export const EditorialPreferenceListResponseSchema = z.object({
  items: z.array(EditorialPreferenceSchema),
  total: z.number().int(),
  // Defaulted, so an older API that does not send it leaves the page listing rules with no
  // marker rather than failing to parse — the `learnedPreferences` rule.
  injected: InjectedPreferenceIdsSchema.default({ news: [], scheme: [] }),
});
export type EditorialPreferenceListResponse = z.infer<
  typeof EditorialPreferenceListResponseSchema
>;

// ---------------------------------------------------------------------------------------
// PHASE 2 — what the learning pass did with one round of feedback
// ---------------------------------------------------------------------------------------

/**
 * What happened to one candidate rule.
 *
 * `added` — a genuinely new rule is now active. `reinforced` — the department had already
 * said this, so its `reinforcementCount` rose and it moved up the injection ranking instead
 * of a near-duplicate being stored beside it. `superseded` — this rule replaced an older one,
 * which is marked `superseded` and kept. `merged` — an existing rule was rewritten to cover
 * both, and nothing new was inserted.
 *
 * `dropped` is deliberately NOT a value here. A candidate the guard rejected is a factual
 * correction that belongs to one article, and telling the officer "your correction was not
 * learned" would invite them to rephrase it until it was — which is the one outcome this
 * feature must not make easy.
 */
export const LearnedPreferenceActionSchema = z.enum([
  'added',
  'reinforced',
  'superseded',
  'merged',
]);
export type LearnedPreferenceAction = z.infer<
  typeof LearnedPreferenceActionSchema
>;

/**
 * One line of the "memory updated" callout.
 *
 * Transient by design — it is reported from the API's in-process registry beside
 * `lengthWarning`, not from a column — because it is a "this is what I took from what you
 * just said" prompt that matters while the officer is looking at the revision they asked
 * for. The rule itself is durable: it is a row, and the review page is where it lives
 * afterwards. A note missed because the page was closed costs nothing.
 */
export const LearnedPreferenceNoteSchema = z.object({
  // The row it refers to, so the review page can be linked to the exact rule.
  id: z.string(),
  // The rule as it now stands — after a merge, that is the merged wording rather than what
  // the officer's feedback said, which is the point of showing it at all.
  rule: z.string(),
  action: LearnedPreferenceActionSchema,
  scope: EditorialPreferenceScopeSchema,
});
export type LearnedPreferenceNote = z.infer<typeof LearnedPreferenceNoteSchema>;
