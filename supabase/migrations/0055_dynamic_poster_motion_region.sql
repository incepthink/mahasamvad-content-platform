-- 0055: the Dynamic Poster's MOVING REGION — the part of the poster allowed to change.
--
-- A video model repaints every pixel of every frame it returns. It does not preserve the
-- officer's Devanagari on the poster it is handed; it redraws it — survivable on a headline,
-- garbled on a 26px card line, which is this lane's reported defect. No prompt can fix that:
-- MOTION_BRIEF already asks for the text to be left unchanged and a stronger sentence was
-- tried on this lane once and ignored.
--
-- So the text is put back instead. The officer marks the one rectangle that should MOVE, and
-- everything outside it is composited back over every frame of the clip from the poster they
-- uploaded. What comes out is their own artwork rather than a model's redrawing of it.
--
-- ONE additive nullable column, holding the rectangle as fractions of the poster's own width
-- and height ({x, y, width, height}, each 0..1) — the same convention the hand trim and the
-- poster feedback markers use, because a box drawn over a browser-scaled picture cannot speak
-- pixels. NOTE the difference in MEANING from motion_crop's rectangle even though the shape is
-- identical and the validator is shared: a trim is a CUT, keeping what is inside, while this
-- is a HOLE, keeping what is outside.
--
-- It lives on the row rather than travelling as a job parameter for the reason
-- source_image_path and motion_aspect do: renderAndStoreMotion re-reads the row on every
-- render and a follow-up regenerates the motion prompt, so a region held only in the create
-- request would be lost on the officer's first "make the background darker" — and it is what
-- makes the retry button reproduce the same hole after a failed render.
--
-- insertGeneration omits the column unless a region was actually marked, so an un-applied 0055
-- costs exactly one thing: a Dynamic Poster create that carries one. Every other create, on
-- every lane, still succeeds — PostgREST would otherwise refuse an insert naming a column that
-- does not exist. Apply before the API deploy anyway.
alter table generations
  add column if not exists motion_region jsonb;

comment on column generations.motion_region is
  'Dynamic Poster only: the part of the poster allowed to MOVE, as {x, y, width, height} fractions of its own size. Everything outside it is composited back from the uploaded poster after the render, so the officer''s Devanagari is their own rather than the model''s. Null = no restore; the clip is stored exactly as it came back.';
