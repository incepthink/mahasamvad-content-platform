-- Generated-content persistence for the web product: one row per generation run
-- (note -> article and/or poster), plus a revision log for feedback/edit history.
-- Single shared workspace, no auth this phase — all access is server-side via the
-- service-role key (same pattern as 0001_mahasamvad_chunks.sql).

create table if not exists generations (
  id              uuid primary key default gen_random_uuid(),
  note            text not null,
  output_type     text not null check (output_type in ('article', 'poster', 'both')),
  status          text not null default 'queued'
                  check (status in ('queued', 'running', 'completed', 'failed')),
  -- Machine step key (see GenerationStepSchema); the UI maps it to Marathi labels.
  step            text,
  error           text,
  -- Latest article version.
  article         text,
  fact_check      text,
  reference_title text,
  reference_url   text,
  -- Latest poster version. copy is the validated Copy JSON (packages/schemas);
  -- scene_path/poster_path are storage object paths in the posters bucket.
  copy            jsonb,
  scene_prompt    text,
  scene_path      text,
  poster_path     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists generations_created_at_idx
  on generations (created_at desc);

-- Feedback log + post-revision snapshots. Each row records what a revision changed
-- (article text, poster copy, or scene) and the user feedback that drove it
-- (null for manual copy edits made in the poster text form).
create table if not exists generation_revisions (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null references generations(id) on delete cascade,
  target        text not null
                check (target in ('article', 'poster_copy', 'poster_scene', 'manual_copy')),
  feedback      text,
  -- Snapshots AFTER this revision (only the fields the revision touched are set).
  article       text,
  fact_check    text,
  copy          jsonb,
  scene_prompt  text,
  scene_path    text,
  poster_path   text,
  created_at    timestamptz not null default now()
);

create index if not exists generation_revisions_generation_idx
  on generation_revisions (generation_id, created_at);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table generations enable row level security;
alter table generation_revisions enable row level security;

-- Public bucket for poster + scene PNGs. Object paths are versioned per render
-- (generations/{id}/poster-v{n}.png) because public URLs are CDN-cached — never
-- overwrite an existing path.
insert into storage.buckets (id, name, public)
values ('posters', 'posters', true)
on conflict (id) do nothing;
