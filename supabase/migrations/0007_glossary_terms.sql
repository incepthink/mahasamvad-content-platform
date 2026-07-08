-- Marathi->English glossary of proper nouns (person names, designations, scheme
-- names, places, organizations). Verified entries are locked into the English
-- translation prompt so a known term is never "creatively" mistranslated.
-- Candidates are auto-extracted per translation (verified=false) and a human
-- reviews/corrects them; verified rows are authoritative forever. This is a plain
-- relational table (NOT the vector store) — short proper nouns embed poorly and
-- match fuzzily, so lookups are deterministic substring matches, not similarity.
-- All access is server-side via the service-role key (same pattern as
-- 0001_mahasamvad_chunks.sql / 0002_generations.sql).

create table if not exists glossary_terms (
  id         uuid primary key default gen_random_uuid(),
  marathi    text not null unique,
  english    text not null,
  term_type  text not null default 'other'
             check (term_type in ('person', 'designation', 'scheme', 'place', 'org', 'other')),
  -- Only verified rows lock into translations.
  verified   boolean not null default false,
  -- Provenance: 'auto' (LLM candidate) | 'manual' (human add) | 'seed' (bootstrap).
  source     text not null default 'auto',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists glossary_terms_verified_idx on glossary_terms (verified);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table glossary_terms enable row level security;
