-- 0045: the officer's OWN image prompt for one social poster run ("AI Prompt").
--
-- When set, the platform's assembled poster prompt is NOT used at all. The image model
-- receives only: the DGIPR designer persona line, this text verbatim, the poster's text
-- verbatim, and the reserved-zone block (which stays because the badge and footer are
-- composited in code afterwards and would otherwise land on top of the officer's own text).
-- No palette, no arrangement anchor, no reference-structure block, no copy rewrite.
--
-- Insert-only, like style_reference (0035) and instructions (0041), and for the same reason:
-- startGenerationJob and startPosterRegenerateJob both re-read everything from the row, so a
-- retry or a पुन्हा तयार करा must reproduce the same prompt rather than silently falling back
-- to the built one.
--
-- Additive and nullable, and insertGeneration omits the column unless something was typed — so
-- an un-applied 0045 disables this one field instead of failing every create.

alter table generations
  add column if not exists image_prompt text;

comment on column generations.image_prompt is
  'Officer''s own prompt for the image model on a social poster run. When set it REPLACES the platform-built poster prompt.';
