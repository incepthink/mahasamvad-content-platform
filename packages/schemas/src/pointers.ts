// "Pointers": the fact-selection layer on /dlo. After the intake is transcribed/extracted,
// the officer is shown the note's facts as AI-summarized Marathi bullets grouped by 5W1H
// (कोण / काय / केव्हा / कुठे / का / कसे), each with a checkbox. Everything is checked by
// default; UNchecking a pointer tells the article pipeline to leave that fact out.
//
// Deselection is carried to generation as `excludedFacts` (the deselected bullets' text),
// threaded into the drafting prompt AND the coverage checkers so the loop cannot re-add a
// fact the officer deliberately dropped. Deselect nothing ⇒ empty list ⇒ today's article.
//
// Nothing here is persisted server-side: `POST /api/pointers` is synchronous and ad-hoc
// (the /proofread shape). The web holds the groups + the deselected set in React state.

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

export const PointersResultSchema = z.object({
  groups: z.array(PointerGroupSchema).max(POINTER_DIMENSIONS.length),
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
