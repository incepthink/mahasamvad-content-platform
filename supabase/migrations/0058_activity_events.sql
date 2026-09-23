-- Activity / audit log for the hidden /activity page: WHO did WHAT, live and historically.
--
-- The platform has no login and must not get one, so "who" is the best a server can say
-- without it: the caller's IP as Caddy observed it (apps/api trusts exactly one proxy hop)
-- plus a browser-scoped device id the web app sends on every request (`x-dgipr-device`).
-- Neither is AUTH. Nothing grants, filters or refuses anything on either value; they are
-- attribution labels for an admin reading a log.
--
-- WHY NOT usage_events (0043). That table's stated contract is "no content, no identity",
-- and /analytics reads it in aggregate. This one carries both an identity and a short
-- summary, so it is its own table — both doctrines stay intact, and an un-applied 0058 costs
-- the monitor page and nothing else (every write is fire-and-forget, see recordActivity in
-- @dgipr/database).
--
-- WHAT `summary` MAY HOLD: a title-like field or the opening words of one — a heading, a file
-- name, a glossary term, the first ~140 characters of a prompt. Never a note, article,
-- transcript or chat answer body. `activitySummary()` in @dgipr/schemas is the only way a
-- summary is built, and it enforces the 140-character ceiling.
--
-- Retention: keep everything. There is deliberately no pruning job.

create table if not exists activity_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  -- When an in_progress row reached its end (success/failed). Null for work that was
  -- recorded already finished, and for work still running.
  settled_at    timestamptz,
  -- Text so IPv4 and IPv6 are stored alike.
  ip            text not null,
  -- Null = the request carried none (an old tab, curl, a malformed value).
  device_id     text,
  -- Truncated to 300 characters by the writer.
  user_agent    text,
  -- creative | dlo | transcribe | translate | storyboard | video | glossary | chat.
  -- Text rather than an enum so adding one is a code change, not a migration.
  feature       text not null,
  -- A stable machine key; every Marathi label lives in apps/web/lib/strings.ts.
  action        text not null,
  -- in_progress | success | failed
  status        text not null,
  summary       text,
  -- The row the work lives on (generation / dlo_intake / transcription / video_project /
  -- nvw_turn …) — what a finished job settles against, and what the page deep-links to.
  subject_kind  text,
  subject_id    text,
  -- Small facts only: language, platform, byte count, page count.
  detail        jsonb not null default '{}'::jsonb,
  -- Short, only on failed.
  error         text
);

create index if not exists activity_events_created_at_idx
  on activity_events (created_at desc);

create index if not exists activity_events_ip_created_at_idx
  on activity_events (ip, created_at desc);

create index if not exists activity_events_device_created_at_idx
  on activity_events (device_id, created_at desc);

create index if not exists activity_events_feature_created_at_idx
  on activity_events (feature, created_at desc);

-- Settling looks up the ONE in-progress row a job started; the partial index keeps that
-- lookup cheap however large the history grows.
create index if not exists activity_events_settle_idx
  on activity_events (subject_kind, subject_id, action)
  where status = 'in_progress';

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table activity_events enable row level security;
