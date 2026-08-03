-- Usage events for the analytics page (apps/web/app/analytics).
--
-- WHY THIS TABLE EXISTS AT ALL. Most of the product already leaves a row behind that can be
-- counted after the fact: `generations`, `dlo_intakes`, `transcriptions`, `video_projects`.
-- Three things do not, by deliberate design elsewhere in the repo:
--   * /proofread is ad-hoc and stores NOTHING ("nothing stored" is its stated contract),
--   * /translate on pasted text is likewise ad-hoc,
--   * exports and publishes (article PDF, poster download, post to X/Facebook) are actions
--     against an existing row, not rows of their own.
-- Those are exactly the numbers a department head asks about, so without this table the
-- analytics page would read "not tracked" against three of its six features.
--
-- WHAT IT MAY NEVER CONTAIN: content. No note, no article, no caption, no transcript, no
-- file name, no URL. Only WHICH feature was used, WHAT was done, WHEN, and size/count
-- integers. That keeps official material out of a table whose whole purpose is to be read in
-- aggregate, and it is why `detail` below is restricted to small enumerable values. If a
-- future event needs to carry text to be useful, it does not belong here.
--
-- Writes are FIRE-AND-FORGET (see recordUsageEvent in @dgipr/database): a logging failure
-- must never fail an officer's run, and an un-applied 0043 must cost the analytics page
-- rather than /proofread. Same blast-radius principle as 0028's poster_style write.
--
-- No auth exists in this phase, so there is no owner column and none is implied: analytics
-- are department-wide totals per feature, which is what was asked for.

create table if not exists usage_events (
  id          uuid primary key default gen_random_uuid(),
  -- Which sidebar feature this belongs to. Matches AnalyticsFeatureKey in @dgipr/schemas:
  -- social | article | transcribe | translate | proofread | video. Text rather than an enum
  -- so adding a feature is a code change, not a migration — and an unknown value read back
  -- is simply ignored by the aggregator instead of breaking the page.
  feature     text not null,
  -- What happened, e.g. translate_text | proofread_check | article_pdf | poster_download |
  -- publish. Free text for the same reason.
  action      text not null,
  -- Size of the work, where a size is meaningful (characters translated/checked). 0 when it
  -- is not — never null, so every aggregate is a plain sum.
  char_count  integer not null default 0,
  -- How many units this one event stands for (pages, files, posters). Almost always 1.
  count       integer not null default 1,
  -- Small enumerable facts ONLY: {"language":"hi"}, {"platform":"twitter"},
  -- {"source":"file"}. Never content. Kept jsonb so a new dimension needs no migration.
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- The analytics query is always "everything in a time window", then a group-by in Node.
create index if not exists usage_events_created_at_idx
  on usage_events (created_at desc);

-- And the per-feature drill-downs scan one feature's window.
create index if not exists usage_events_feature_created_at_idx
  on usage_events (feature, created_at desc);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table usage_events enable row level security;
