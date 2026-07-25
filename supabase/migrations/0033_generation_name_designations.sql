-- The person → designation pairs the officer approved FOR THIS RUN, in the pre-generation
-- "व्यक्ती व पदनाम" review card. Shape: [{ "name": "देवेंद्र फडणवीस", "designation": "मुख्यमंत्री" }].
--
-- Why a per-run copy when glossary_terms.designation (0032) already stores the default: a
-- designation is genuinely run-specific — an office changes hands, and a note may refer to
-- someone in a different capacity than their dictionary entry. The card pre-fills from the
-- dictionary and the officer may override for this article only (the "यापुढेही हेच वापरा"
-- checkbox is what promotes an override back into the dictionary).
--
-- Why a column and not a job parameter (the poster_heading/0029 and excluded_facts/0030
-- precedent): startGenerationJob re-reads everything from the row, so pairs held only in the
-- create request would vanish on a retry — and an article that silently loses a designation on
-- re-run is exactly the failure this feature exists to prevent.
--
-- Insert-only: the list is consumed at draft time (and again by the feedback path, which reads
-- it back off the row so a revision cannot drop the designation). Not part of GenerationPatch.
--
-- Additive + nullable, but read at generation time — apply BEFORE deploying the API.
-- insertGeneration omits the column unless pairs were actually approved, so an un-applied 0033
-- disables only this feature instead of failing every create (the 0028/0029/0030 principle).
alter table generations
  add column if not exists name_designations jsonb;

comment on column generations.name_designations is
  'Officer-approved [{name, designation}] pairs (both Marathi) for this run. Null/empty = no designations applied = the article this note would have produced before the feature.';
