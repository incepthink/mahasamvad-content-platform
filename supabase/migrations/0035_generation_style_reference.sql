-- The style reference used by the simplified article generator (ARTICLE_GENERATION_MODE=simple).
--
-- style_reference: a published article the officer PASTED as the style/structure model for this
-- run — tier 1 of the reference hierarchy, above vector retrieval. It is a style reference only
-- and never a factual source; the runtime prompt states that boundary explicitly and the note
-- remains the sole factual authority.
--
-- Why a column and not a job parameter (the poster_heading / 0029 and excluded_facts / 0030
-- precedent): startGenerationJob re-reads everything from the row, so a failed-run retry must be
-- able to reconstruct the reference. A parameter would be silently lost on the first retry and
-- the retry would quietly produce a differently-styled article. Insert-only.
--
-- style_reference_meta: what was ACTUALLY used, written after generation —
--   { source: 'officer' | 'retrieval' | 'none', articleId?, title?, url?, similarity?,
--     chars, mode, promptVersion }
-- Two jobs. It is the calibration telemetry for the retrieval similarity floor (how often does
-- tier 2 fire, and at what similarity?), which cannot be tuned from logs alone; and it is the
-- join key for the future approved-example learning loop, which needs to know which reference
-- tier and which prompt version produced a given article. Patchable, unlike the insert-only
-- pointer columns, because it is only knowable once the reference has been resolved.
--
-- Both additive + nullable. insertGeneration omits style_reference unless the officer actually
-- pasted one and the meta write is a separate best-effort update after the article write, so an
-- un-applied 0035 costs the officer-reference tier and the telemetry rather than a generated
-- article (the 0028/0029/0030 blast-radius principle). Apply before the API deploy anyway.
alter table public.generations
  add column if not exists style_reference text,
  add column if not exists style_reference_meta jsonb;

comment on column public.generations.style_reference is
  'Officer-pasted style-reference article (style/structure only, never a fact source).';

comment on column public.generations.style_reference_meta is
  'Which style reference the run actually used: {source, articleId?, title?, url?, similarity?, chars, mode, promptVersion}.';
