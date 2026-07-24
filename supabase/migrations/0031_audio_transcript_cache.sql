-- Content-addressed cache of Sarvam STT transcripts (see packages/database/src/stt-cache.ts).
-- Keyed by the SHA-256 of the raw audio bytes, so re-uploading the SAME MP3 on /dlo (in any
-- intake, now or later) reuses the transcript instead of paying for a second batch STT job.
-- The transcribe phase of the DLO intake job (jobs/dlo-runner.ts) consults this before Sarvam.
--
-- Only successful, non-empty transcripts are written, so a transient Sarvam failure never
-- poisons the cache. Content stored is opaque: a hash + Marathi text, no filenames.
--
-- Additive + self-contained. The runner treats a cache-lookup error (e.g. this table missing)
-- as an empty cache and transcribes as before, so an un-applied 0031 disables only the
-- optimization instead of breaking intake (the 0028/0029/0030 blast-radius principle) — but
-- apply it before the API deploy anyway.

create table if not exists audio_transcript_cache (
  content_hash text primary key,      -- lowercase SHA-256 hex of the raw audio bytes
  transcript   text not null,         -- Marathi transcript (Sarvam saaras:v3, transcribe mode)
  char_count   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table audio_transcript_cache enable row level security;
