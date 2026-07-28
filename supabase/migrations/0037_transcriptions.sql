-- Standalone transcription runs (apps/web/app/transcribe): meeting recordings uploaded on
-- their own, transcribed by Sarvam batch STT, and handed straight back as Marathi text. No
-- article, no review contract, no generation lineage — this is the transcript as the
-- deliverable, which is why it is its OWN table rather than a flavour of dlo_intakes (whose
-- every column past `files` exists to serve the article pipeline).
--
-- The recordings themselves are ARCHIVED, in the existing PRIVATE `dlo-uploads` bucket under
-- a `transcriptions/{id}/…` prefix — created by 0018, so this migration provisions no bucket.
-- Same access story: service-role only, never a public URL.
--
-- Transcripts are still content-addressed through audio_transcript_cache (0031), so a
-- recording already transcribed on /dlo comes back here instantly and free, and vice versa.
--
-- Additive and self-contained: nothing else reads this table, so an un-applied 0037 disables
-- only the transcription page.

create table if not exists transcriptions (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'ready', 'failed')),
  error        text,
  -- What the list card calls this run: the single recording's name, or "N ध्वनिमुद्रणे".
  -- Denormalized so the list never has to read the files jsonb (see below).
  title        text not null default '',
  -- Per-file state: [{ name, storagePath, status, chars?, error?, text?, cached? }].
  -- The transcript lives here per recording, so a failed file is isolated to its own row
  -- while every other recording still delivers.
  files        jsonb not null default '[]'::jsonb,
  -- Every transcript under its own Marathi header (one recording ⇒ the bare transcript).
  combined_text text,
  -- List-card counters, maintained by the job. They exist so the list query can skip
  -- `files` and `combined_text` entirely — a meeting transcript is tens of thousands of
  -- characters and the list polls while work runs.
  file_count   integer not null default 0,
  failed_count integer not null default 0,
  char_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists transcriptions_created_at_idx
  on transcriptions (created_at desc);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table transcriptions enable row level security;
