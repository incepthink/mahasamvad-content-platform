-- 0041: free-text instructions the officer attached to one article run.
--
-- An INSTRUCTION, not a fact. It steers emphasis, ordering, tone and length for this article
-- only; the note remains the sole factual source and the prompt says so explicitly, so a fact
-- typed here is not published.
--
-- Insert-only, like style_reference (0035) and for the same reason: startGenerationJob re-reads
-- everything from the row, so a retry must reproduce the same instructions rather than silently
-- writing a differently-directed article.
--
-- Additive and nullable, and insertGeneration omits the column unless something was typed — so
-- an un-applied 0041 disables this one field instead of failing every create.

alter table generations
  add column if not exists instructions text;

comment on column generations.instructions is
  'Officer''s free-text direction for this article run. Never a factual source.';
