// Person → designation (पदनाम): the officer-approved official title a person is named with
// in the published article.
//
// A DLO's meeting recording says "देवेंद्र फडणवीस"; the article must say "मुख्यमंत्री देवेंद्र
// फडणवीस", because in government communication the designation is part of how the person is
// officially named. Before generating, the officer is shown every person the note mentions and
// the designation that will be printed — pre-filled from the नाव-शब्दकोश (glossary_terms.designation,
// migration 0032), editable per run, blank when the dictionary does not know the person.
//
// The pairs travel to the generation as `designations` and are stored on the row
// (generations.name_designations, migration 0033) so a retry or a feedback revision cannot
// silently drop them. The designation is inserted into the MARATHI article; both translations
// then inherit it through the existing glossary locks with no translation-side code — which is
// why the API also ensures each designation exists as its own `designation`-typed glossary row
// (that row is what supplies "मुख्यमंत्री → Chief Minister" to the English LOCKED TERMS table).
//
// Nothing here is a fact source. A designation is never inferred from the note: unknown means
// the name prints bare.

import { z } from 'zod';

// One approved pair. Both sides are Marathi: `name` is the person's name exactly as it appears
// in the note/article (the string the deterministic pass matches on), `designation` is the title
// to print before it on FIRST mention.
export const NameDesignationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  designation: z.string().trim().min(1).max(120),
  // Request-only: "यापुढेही हेच वापरा" — also save this pairing to the नाव-शब्दकोश so the next
  // article about this person starts pre-filled. Absent/false = use it for THIS run only,
  // which is the right default when someone is named in a one-off capacity. Stripped before
  // the pairs are persisted on the generation row; the engine never reads it.
  remember: z.boolean().optional(),
});
export type NameDesignation = z.infer<typeof NameDesignationSchema>;

// A meeting note names a handful of officials, not a directory. The cap bounds the prompt block
// and the deterministic pass alike.
export const NameDesignationsSchema = z.array(NameDesignationSchema).max(30);

// ---------- the pre-generation review card ----------

// Same bounds as a generation's note — the card runs on the assembled DLO text or the media
// room's combined note.
export const PrepareDesignationsRequestSchema = z.object({
  text: z.string().trim().min(20).max(60_000),
});
export type PrepareDesignationsRequest = z.infer<
  typeof PrepareDesignationsRequestSchema
>;

// One person proposed for review. `designation` is '' when the dictionary has no entry — the
// card then shows an empty field for the officer to fill in, and an untouched empty row simply
// means "print this name bare". `inGlossary` distinguishes a person the dictionary already
// knows from one the extractor just found; `verified` renders the same reassurance badge the
// translation name-check uses.
export const PreparedNameSchema = z.object({
  marathi: z.string(),
  designation: z.string(),
  inGlossary: z.boolean(),
  verified: z.boolean(),
});
export type PreparedName = z.infer<typeof PreparedNameSchema>;

// A designation the dictionary already knows, offered as autocomplete in the card. `english` is
// shown as a hint so the officer can see the title has a confirmed English form (and therefore
// that the English translation will render it correctly).
export const KnownDesignationSchema = z.object({
  marathi: z.string(),
  english: z.string(),
});
export type KnownDesignation = z.infer<typeof KnownDesignationSchema>;

export const PrepareDesignationsResponseSchema = z.object({
  names: z.array(PreparedNameSchema),
  knownDesignations: z.array(KnownDesignationSchema),
  // Designation surface forms that occur in the analyzed text itself. This is separate
  // from the verified autocomplete dictionary: the generation detail page uses it only
  // to report the title that was actually printed beside a person, never as a fact source.
  // Defaulted so a web build can roll out before the matching API.
  mentionedDesignations: z.array(z.string()).default([]),
});
export type PrepareDesignationsResponse = z.infer<
  typeof PrepareDesignationsResponseSchema
>;

// ---------- what the article pipeline reports back ----------

// Why a designation did not reach the article. Reported, never fatal — the pipeline ships the
// article and the officer sees the notice, because a SILENTLY unapplied designation is exactly
// the failure this feature exists to prevent.
export const DesignationWarningSchema = z.object({
  name: z.string(),
  designation: z.string(),
  // 'not-found': the full name never appears in the article (often it used only the surname,
  // which is deliberately NOT matched — two people can share one).
  // 'corrected': the article carried a DIFFERENT title before the name and it was replaced.
  reason: z.enum(['not-found', 'corrected']),
  // The title that was replaced; only set for 'corrected'.
  replaced: z.string().optional(),
});
export type DesignationWarning = z.infer<typeof DesignationWarningSchema>;
