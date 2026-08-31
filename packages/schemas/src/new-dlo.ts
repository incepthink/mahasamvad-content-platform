// The new /dlo lane's wire shapes.
//
// Three steps, and the schemas are small because that is the point of the redesign: the
// officer uploads, confirms the names, and generates. There is no page selection, no
// per-source text to send back, and no assembled note — the documents themselves are the
// source, and they are already on OpenAI by the time any of these requests is made.
//
// WHAT IS NOT HERE, and why. `DloGenerateRequestSchema` (the old lane) requires a
// `combinedText` of at least 20 characters, because there the officer's corrected transcript
// IS the article's factual source and the client is what assembles it. Here there is nothing
// for the client to assemble: the note is whatever was typed plus whatever the recordings
// transcribed to, and the server already holds both on the intake row. Sending it back would
// let the browser rewrite the source of a government article, which the old lane accepts
// deliberately (the officer edited it) and this one has no reason to.

import { z } from 'zod';
import { ARTICLE_INSTRUCTIONS_MAX_CHARS } from './api.js';
import { NameDesignationsSchema } from './designations.js';
import { DloCategorySchema } from './dlo.js';

// ---------- step 2: which people do the sources name? ----------

// The request carries nothing: the intake id in the path is enough, because the files and the
// typed note are both already on the row. It is a POST rather than a GET because it SPENDS —
// one model call that reads the attached documents — and a GET that bills is a GET a browser,
// a proxy or a prefetch will eventually make on its own.
export const NewDloNamesRequestSchema = z.object({});
export type NewDloNamesRequest = z.infer<typeof NewDloNamesRequestSchema>;

// ---------- step 3: write the article ----------

export const NewDloGenerateRequestSchema = z.object({
  // Optional so the lane's simplest path — attach a file, confirm names, generate — sends an
  // empty body. Every field here is the officer's, and none is a factual source except
  // `instructions`, which is trusted for the same reason it is on the old lane.
  category: DloCategorySchema.optional(),
  heading: z.string().trim().max(200).optional(),
  // Person → पदनाम pairs approved in step 2. The designation is printed before the name on
  // its first mention and both translations inherit it — the same contract as the old lane,
  // reached through the same review card and applied by the same deterministic pass.
  designations: NameDesignationsSchema.optional(),
  // A published article pasted as the STYLE model. Style and structure only, never a factual
  // source.
  styleReference: z.string().trim().optional(),
  // The officer's trusted request for this article: writing direction plus any facts or
  // corrections supplied directly here.
  instructions: z
    .string()
    .trim()
    .max(ARTICLE_INSTRUCTIONS_MAX_CHARS)
    .optional(),
});
export type NewDloGenerateRequest = z.infer<typeof NewDloGenerateRequestSchema>;
