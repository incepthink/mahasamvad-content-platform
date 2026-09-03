-- 0053: the Dynamic Poster's output SHAPE, chosen by the officer.
--
-- The lane's motion prompt used to state the uploaded poster's exact pixel resolution and
-- demand it back. A video model does not deliver an arbitrary pixel size, so the prompt's
-- most emphatic requirement was the one thing the render could not honour. The create form
-- now asks instead — 9:16 (portrait) or 16:9 (landscape) — and the prompt states the ratio,
-- with the whole poster fitted inside it and nothing cropped away.
--
-- ONE additive nullable column. It lives on the row rather than travelling as a job
-- parameter for the reason source_image_path does: startDynamicPosterJob re-reads the row,
-- and so does every follow-up render, which regenerates the motion prompt — an aspect held
-- only in the create request would be lost on the first "make the background darker".
--
-- insertGeneration omits it unless the officer chose the NON-default ratio, and the job
-- falls back to '9:16' on null, so an un-applied 0053 costs exactly one thing: a landscape
-- request. Every portrait run, and every other lane, is untouched. Apply before the API
-- deploy anyway.
alter table generations
  add column if not exists motion_aspect text;

comment on column generations.motion_aspect is
  'Dynamic Poster only: the clip''s aspect ratio, ''9:16'' or ''16:9''. Null = 9:16 (the default, and every row created before this column).';
