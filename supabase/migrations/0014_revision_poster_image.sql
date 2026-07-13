-- Record iterative pixel-level edits of a completed article or Twitter poster.
-- No new snapshot columns are needed: poster_path already stores the version.
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
      'poster_image'
    )
  );
