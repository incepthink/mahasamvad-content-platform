-- Learned editorial preferences for the /dlo article lane.
--
-- WHY THIS TABLE EXISTS AT ALL. This platform already has two of LangMem's three memory
-- types: semantic (glossary_terms — names, spellings, designations) and episodic
-- (selectStyleReference + the pgvector exemplars — "an article like this one"). The third,
-- procedural memory — HOW to write — exists only as a hand-written TypeScript constant,
-- DGIPR_EDITORIAL_SYSTEM_PROMPT in dlo-article-prompt.ts. An officer's feedback on an
-- article is used once by reviseArticle and then thrown away; tomorrow's article repeats the
-- same mistake until a developer edits that constant and redeploys. This table is that loop
-- made automatic, officer-driven and persistent.
--
-- ITS OWN TABLE, AND NO COLUMN ON `generations`. That is the whole blast-radius argument. A
-- new column on an existing table has to be named in a column-list constant
-- (GENERATION_CARD_COLUMNS and its siblings), so an un-applied migration breaks EVERY read of
-- that table. A new table nothing else reads means an un-applied 0057 disables learned
-- preferences ALONE: a /dlo article still generates and feedback still revises, because the
-- runner's read is best-effort and degrades to "no preferences".
--
-- NOTHING IS EVER DELETED ON SUPERSESSION. A replaced rule is marked `superseded` with
-- `superseded_by` pointing at the rule that replaced it (Zep's temporal-annotation approach,
-- and this repo's standing insert-only doctrine). That is what makes "why does the article
-- write it this way?" answerable after the fact, and what lets a bad consolidation be undone.
--
-- NO OWNER COLUMN, AND NONE IS IMPLIED. There is no auth in this phase, so a rule learned
-- from one officer's feedback binds the whole department. That is structural rather than a
-- choice; `scope` (news | scheme | both) is the one distinction that is editorially real.

create table if not exists editorial_preferences (
  id                   uuid primary key default gen_random_uuid(),
  -- The rule itself, in Marathi, imperative, short. Kept under PREFERENCE_RULE_MAX_CHARS
  -- (240, @dgipr/schemas) by the writer rather than by a constraint: a rule that arrives one
  -- character over should be trimmed at the seam, not rejected into a failed feedback round.
  rule                 text not null,
  -- Which article category this applies to: news | scheme | both. Plain text rather than an
  -- enum so a new category is a code change and not a migration, and an unknown value read
  -- back is simply never selected instead of breaking the query.
  scope                text not null default 'both',
  -- active | disabled | superseded. Only `active` rules are injected; the other two are the
  -- history, kept readable (see the supersession note above).
  status               text not null default 'active',
  -- learned | manual. `manual` is a rule an officer typed on the review page or an operator
  -- seeded through the API; `learned` came out of a feedback round.
  source               text not null default 'learned',
  -- How many times this rule has been observed. The ranking key when more rules are active
  -- than MAX_INJECTED_PREFERENCES allows, so a repeatedly-asked-for preference outranks a
  -- one-off. Starts at 1 — it was observed once to exist at all.
  reinforcement_count  integer not null default 1,
  -- Provenance: the officer's own words that produced this rule. Already stored on
  -- generation_revisions.feedback, copied here so the review page can show WHY a rule exists
  -- without a join through a generation that may since have been deleted.
  source_feedback      text,
  -- The run whose feedback taught this. `on delete set null` rather than cascade: deleting a
  -- generation must not delete what was learned from it.
  source_generation_id uuid references generations (id) on delete set null,
  -- Set when this rule was replaced. Self-referential, so the chain is walkable.
  superseded_by        uuid references editorial_preferences (id) on delete set null,
  -- When this rule was last reinforced by a fresh piece of feedback. The tie-break under
  -- reinforcement_count, so a stale rule sinks below an equally-reinforced recent one.
  last_seen_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- The injection query is always "the active rules for this category", on every /dlo article.
create index if not exists editorial_preferences_status_scope_idx
  on editorial_preferences (status, scope);

-- And the review page lists everything, newest first.
create index if not exists editorial_preferences_created_at_idx
  on editorial_preferences (created_at desc);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table editorial_preferences enable row level security;
