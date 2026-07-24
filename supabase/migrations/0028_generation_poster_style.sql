-- The visual style a social poster run was assigned: its colour palette family, its composition
-- archetype, and what the rendered poster ACTUALLY measured.
--
-- Why a column and not an in-process ring: the rotation that keeps consecutive posters looking
-- different was kept in a Map inside the API process, so it reset on every restart (constant
-- under `tsx watch`) and was invisible to a second process. A run could therefore be assigned the
-- same colour family as the one before it, which is exactly the failure the rotation exists to
-- prevent. Reading the last few rows back from here makes the spread real.
--
-- Shape (jsonb so the rotation can gain axes without another migration, the scenes/files
-- precedent): { paletteId, family, layoutId, coverage,
--               measured: { groundHex, groundIsWarm, dominantHex, hueBucket, colourfulness } }
--
-- Additive + nullable: null on every existing row and on every non-social run, which the readers
-- already treat as "no history", so an older API is unaffected. Apply BEFORE deploying the API.
alter table generations
  add column if not exists poster_style jsonb;

-- The recency read is "the newest N social rows that have a style", so it walks created_at
-- descending and filters on the column being present.
create index if not exists generations_poster_style_recent_idx
  on generations (created_at desc)
  where poster_style is not null;
