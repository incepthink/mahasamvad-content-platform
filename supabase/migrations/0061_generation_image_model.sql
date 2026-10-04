-- The image model one run renders with, when the officer opted into the newer one with the
-- नवीन checkbox on the create form (OPENAI_IMAGE_MODEL_NEW, default gpt-image-2.5-flare).
--
-- A COLUMN rather than a job option: the retry path, पुन्हा तयार करा and every pixel-feedback
-- round rebuild the job by re-reading the row, so a choice held only in the create request
-- would quietly switch the poster back to the default model on the first redo.
--
-- Additive + nullable. Null (every run before this, and every run with the box unticked)
-- means the deployment default, OPENAI_IMAGE_MODEL. insertGeneration omits the column unless
-- the box was ticked, and the job's read of it is best-effort, so an un-applied 0061 costs
-- only a create that actually ticked it.

alter table public.generations
  add column if not exists image_model text;

comment on column public.generations.image_model is
  'Per-run OpenAI image model override (the नवीन checkbox). Null = OPENAI_IMAGE_MODEL.';
