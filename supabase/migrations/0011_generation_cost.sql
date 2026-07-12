-- Per-generation cost tracking. `cost_usd` is the headline total dollars a generation
-- has cost (easy to ORDER BY / SUM); `cost_breakdown` holds the audit detail — token
-- counts and the text-vs-image split — so the number can be re-priced and verified.
-- Both are derived outputs accumulated by the job runner (text measured from OpenAI
-- usage; image attributed as a fixed per-render tier price). Nullable, no default, so
-- existing rows and pre-feature runs stay null (same convention as 0005/0008/0009).
alter table generations
  add column if not exists cost_usd numeric(10, 4);

alter table generations
  add column if not exists cost_breakdown jsonb;
