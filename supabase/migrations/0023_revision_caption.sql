-- Record edits to a social post's caption (the `article` column on a twitter/
-- facebook row). Two targets, mirroring the poster's poster_copy / manual_copy pair:
--   'caption'        — AI revision from the caption feedback box
--   'manual_caption' — the officer typed the caption themselves
-- No new snapshot columns are needed: generation_revisions.article already stores
-- the resulting text.
alter table generation_revisions
  drop constraint if exists generation_revisions_target_check;

alter table generation_revisions
  add constraint generation_revisions_target_check
  check (
    target in (
      'article',
      'poster_copy',
      'poster_scene',
      'manual_copy',
      'poster_image',
      'caption',
      'manual_caption'
    )
  );
