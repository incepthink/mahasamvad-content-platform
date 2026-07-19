-- DLO intake runs (apps/web/app/dlo): free-text notes + uploaded meeting files
-- (mp3/pdf/docx) are transcribed/extracted into one combined Marathi text that the
-- officer reviews and edits before it becomes the `note` of a normal generation.
-- Same access pattern as generations: no auth this phase, service-role only.

create table if not exists dlo_intakes (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'ready', 'failed')),
  -- Machine step key (see DloIntakeStepSchema); the UI maps it to Marathi labels.
  step          text,
  error         text,
  -- The free-text notes field from the DLO form ('' when only files were sent).
  notes         text not null default '',
  -- Defaults the review step's category/heading; the officer can still change
  -- both before generating (the generate request carries the final values).
  category      text not null default 'news' check (category in ('news', 'scheme')),
  heading       text,
  -- Per-file intake state: [{ name, storagePath, kind, status, chars?, error? }]
  -- (kind: audio|pdf|docx; status: pending|done|failed). A failed file keeps its
  -- Marathi error here so the review step can show which source dropped out.
  files         jsonb not null default '[]'::jsonb,
  -- The combined transcription/extraction output the review step edits.
  combined_text text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists dlo_intakes_created_at_idx
  on dlo_intakes (created_at desc);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table dlo_intakes enable row level security;

-- PRIVATE bucket for the uploaded source files (unlike the public 'posters'
-- bucket): meeting recordings and official documents are internal source
-- material, downloaded only server-side with the service-role key. Paths:
-- intakes/{id}/{index}-{sanitized-filename}.
insert into storage.buckets (id, name, public)
values ('dlo-uploads', 'dlo-uploads', false)
on conflict (id) do nothing;

-- Lineage/audit: which intake a generation's note came from (null = the home
-- form or a detail-page follow-up). Deleting an intake keeps the generation.
alter table generations
  add column if not exists dlo_intake_id uuid references dlo_intakes(id) on delete set null;
