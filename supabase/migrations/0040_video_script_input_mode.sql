-- Ready-script video projects preserve officer-supplied Marathi narration
-- verbatim and derive their running time from that narration. Existing rows
-- remain note projects and keep the fixed 30-second authoring path.

alter table video_projects
  add column if not exists input_mode text not null default 'note'
  check (input_mode in ('note', 'script'));

