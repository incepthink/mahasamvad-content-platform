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
// to print before it — on the full name's first mention, and before every standalone mention of
// its surname. `name` may itself BE a bare surname: the dictionary resolves "बावनकुळे" against
// the चंद्रशेखर बावनकुळे row, and the pair is then approved for the surname the text actually uses,
// never for a first name the source does not have.
export const NameDesignationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // The officer sees and approves this value in the designation review before it reaches the
  // article. Do not reject a legitimate long official title at submit time with a raw length
  // error; the review itself is the authority for what should be printed.
  designation: z.string().trim().min(1),
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
// room's combined note, and that text is no longer capped. `extractGlossaryCandidates`
// chunks long input itself, so length costs more extraction calls rather than a 400.
export const PrepareDesignationsRequestSchema = z.object({
  text: z.string().trim().min(20),
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
  // True when the person's NAME does not occur in the text at all: the text names a TITLE
  // (मुख्यमंत्री) that exactly one verified person in the dictionary holds, so they were proposed
  // by reverse lookup. This is common on DLO transcripts, where STT loses the name but keeps the
  // office — and it is precisely the case where the article otherwise falls back to agentless
  // prose because it has nobody to attribute a directive to.
  //
  // The card renders these TICKED and labelled "शब्दकोशातून सुचवलेले", so the officer sees the
  // proposed name before anything is paid for and unticks it if this meeting was not that
  // officeholder's. They were rendered unticked at first, which sounded safer and measured
  // worse: the officer ticks it on the run where they happen to notice, and every later run
  // drops the name silently — so the article falls back to the agentless prose this feature
  // exists to prevent, with no notice that it did. Review is preserved by making the
  // suggestion visible and reversible, not by making it inert.
  // Defaulted so an older API (which omits the field) still parses against a newer web build.
  suggested: z.boolean().default(false),
  // True when `designation` was READ OFF THE NOTE rather than the dictionary: the note writes
  // the title immediately before the name ("उपमुख्यमंत्री एकनाथ शिंदे"), so the officer's own
  // text is the source. This is not an inference — the invention rule is about producing a
  // title nobody wrote, and here the officer wrote it. The dictionary still wins when it has
  // an entry; this only ever fills a field that would otherwise be blank, and the card labels
  // it so the officer can see where it came from.
  fromText: z.boolean().default(false),
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

// ---------- marking a name checked, from the review card ----------

// "तपासले म्हणून खूण करा": confirm this person's नाव-शब्दकोश row is spelled correctly, without
// making the officer leave the review step for /glossary. A verified person row is what locks
// the spelling into every future translation, so this is the same assertion the glossary page's
// verified toggle makes — only reachable at the moment the officer is actually looking at the
// name. It touches `verified` alone: the English/Hindi spellings are the pre-translation name
// check's business, and a person the dictionary has never met is inserted with the Marathi form
// as its English fallback exactly as `setPersonDesignation` does.
export const VerifyNameRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type VerifyNameRequest = z.infer<typeof VerifyNameRequestSchema>;

export const VerifyNameResponseSchema = z.object({
  name: z.string(),
  verified: z.literal(true),
});
export type VerifyNameResponse = z.infer<typeof VerifyNameResponseSchema>;

// ---------- what the article pipeline reports back ----------

// Why a designation did not reach the article. Reported, never fatal — the pipeline ships the
// article and the officer sees the notice, because a SILENTLY unapplied designation is exactly
// the failure this feature exists to prevent.
export const DesignationWarningSchema = z.object({
  name: z.string(),
  designation: z.string(),
  // 'not-found': neither the full name nor a standalone mention of its surname appears in the
  // article. Since 2026-07-28 a bare surname DOES count, so this now means the article really
  // does not name the person — or two approved people share that surname, which disables it for
  // both rather than attributing a directive to the wrong official.
  // 'corrected': the article carried a DIFFERENT title before the name and it was replaced.
  reason: z.enum(['not-found', 'corrected']),
  // The title that was replaced; only set for 'corrected'.
  replaced: z.string().optional(),
});
export type DesignationWarning = z.infer<typeof DesignationWarningSchema>;
