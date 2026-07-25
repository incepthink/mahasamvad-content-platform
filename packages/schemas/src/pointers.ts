// "Pointers": the fact-selection layer on /dlo. After the intake is transcribed/extracted,
// the officer is shown the note's facts as AI-summarized Marathi bullets grouped by 5W1H
// (कोण / काय / केव्हा / कुठे / का / कसे), each with a checkbox. Everything is checked by
// default; UNchecking a pointer tells the article pipeline to leave that fact out.
//
// Selection is carried to generation as `selectedFacts` ({ dimension, text }) and becomes the
// bounded completeness contract; deselection is also carried as `excludedFacts` so no later
// draft/revision can re-add a fact the officer deliberately dropped.
//
// `POST /api/pointers` itself is synchronous and ad-hoc (the /proofread shape). Once the
// officer generates, the checked inventory is persisted on that generation so retries and
// article feedback use the same contract.

import { z } from 'zod';
import { DloCategorySchema } from './dlo.js';

// The 5W1H dimensions a group can belong to. Keys are stable/machine; the web maps each to
// a Marathi label (कोण/काय/…). The extractor is told to use exactly these six keys.
export const POINTER_DIMENSIONS = [
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
] as const;
export const PointerDimensionSchema = z.enum(POINTER_DIMENSIONS);
export type PointerDimension = z.infer<typeof PointerDimensionSchema>;

// One 5W1H group: a dimension and its AI-summarized bullets. `points` may be empty (a note
// need not state every dimension); the web simply renders no rows for an empty group.
export const PointerGroupSchema = z.object({
  dimension: PointerDimensionSchema,
  points: z.array(z.string().trim().min(1).max(500)).max(20),
});
export type PointerGroup = z.infer<typeof PointerGroupSchema>;

// One pointer the officer kept for the article. Keeping its dimension beside the text lets
// the generation pipeline build the 5W1H scaffold deterministically instead of paying for a
// second model to rediscover the grouping that this extraction already produced.
export const SelectedFactSchema = z.object({
  dimension: PointerDimensionSchema,
  text: z.string().trim().min(1).max(500),
});
export type SelectedFact = z.infer<typeof SelectedFactSchema>;
export const SelectedFactsSchema = z.array(SelectedFactSchema).max(60);

// A statement the note explicitly attributes to a named speaker. It is kept separate from
// the 5W1H bullets so the speaker/claim relationship cannot be lost during summarisation.
// Empty designation/venue means the source did not state one; downstream prompts may never
// infer either field.
export const AttributedStatementSchema = z.object({
  speaker: z.string().trim().min(1).max(200),
  designation: z.string().trim().max(200),
  venue: z.string().trim().max(300),
  claim: z.string().trim().min(1).max(1000),
});
export type AttributedStatement = z.infer<typeof AttributedStatementSchema>;
export const AttributedStatementsSchema = z
  .array(AttributedStatementSchema)
  .max(12);

export const PointersResultSchema = z.object({
  groups: z.array(PointerGroupSchema).max(POINTER_DIMENSIONS.length),
  statements: AttributedStatementsSchema.default([]),
});
export type PointersResult = z.infer<typeof PointersResultSchema>;

// The extraction request. `text` is the current assembled note (same 60k bound as a DLO
// generation's note); `category` steers the extractor's tone the way the article voice does.
export const PointersRequestSchema = z.object({
  text: z.string().trim().min(20).max(60_000),
  category: DloCategorySchema,
  heading: z.string().trim().max(200).optional(),
});
export type PointersRequest = z.infer<typeof PointersRequestSchema>;
