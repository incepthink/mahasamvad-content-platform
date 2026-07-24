-- Facts the officer deselected in the /dlo "Pointers" step, stored on the generation they
-- created. Each is one AI-summarized 5W1H bullet; the article pipeline is instructed to leave
-- these out, and the coverage checkers are told not to re-add them (see extract-pointers.ts +
-- verify-coverage.ts). Null/empty = nothing excluded = the article the note would have produced
-- before this feature.
--
-- Why a column and not a job parameter (the poster_heading / 0029 precedent): startGenerationJob
-- re-reads everything from the row, so a failed-run retry must be able to reconstruct the
-- exclusions. Insert-only — the list is consumed once at draft time and never edited afterward.
--
-- Additive + nullable, but read at generation time — apply BEFORE deploying the API. insertGeneration
-- omits the column unless facts were actually deselected, so an un-applied 0030 disables only this
-- feature instead of failing every create (the 0028/0029 blast-radius principle).
alter table generations
  add column if not exists excluded_facts jsonb;
