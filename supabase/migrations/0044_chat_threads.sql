-- The general assistant behind apps/web/app/chat — the platform's one surface that is not a
-- pipeline. Every other feature turns a specific input into a specific deliverable; this one
-- just answers, with the file intake the rest of the product already has.
--
-- TWO TABLES, not a `messages` jsonb column on one row. Every other feature in this repo keeps
-- its per-item state in jsonb (dlo_intakes.files, transcriptions.files, video_projects.scenes)
-- and that is right for them: the whole array is produced by one job. A chat is the opposite —
-- it GROWS, one turn at a time, forever. A jsonb array would be read and rewritten WHOLESALE on
-- every turn, which is both quadratic in a long conversation and the exact lost-update hazard
-- 0036 avoided by giving review_state its own column instead of writing back into `files`.
--
-- The denormalized columns on chat_threads (title, message_count, last_message_at) exist so the
-- rail's list query never has to touch chat_messages at all — the transcriptions.char_count
-- precedent. A chat's messages are the largest text in the table and the rail polls.
--
-- Self-contained and additive: nothing outside /chat reads either table, so an un-applied 0044
-- disables that page and nothing else.

create table if not exists chat_threads (
  id           uuid primary key default gen_random_uuid(),
  -- What the rail calls this chat: derived from the first user message and truncated. Set
  -- once, best-effort, by the turn route. Empty until the first message lands.
  title        text not null default '',
  message_count integer not null default 0,
  -- Ordering key for the rail. Distinct from updated_at, which also moves when the title is
  -- backfilled — "most recently talked to" is the useful sort, not "most recently touched".
  last_message_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists chat_threads_last_message_at_idx
  on chat_threads (last_message_at desc nulls last, created_at desc);

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references chat_threads (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  -- The visible text of the turn. For a user turn this is what was TYPED — the attached
  -- files' text lives in `attachments` below and is folded in only when the request to the
  -- model is assembled, so the bubble can render chips instead of a wall of extracted text.
  content    text not null default '',
  -- [{ kind: 'image'|'document'|'audio'|'youtube', name, imageUrl?, text?, chars?,
  --    sourceUrl? }]. Only images keep bytes (a public URL); every other kind is reduced to
  -- text at attach time, so reopening a chat re-extracts nothing and re-transcribes nothing.
  attachments jsonb not null default '[]'::jsonb,
  -- Which model answered, and what the turn cost. Recorded per message rather than summed on
  -- the thread so a model swap mid-conversation stays legible, and so /analytics can adopt
  -- this feature later without a backfill.
  model      text,
  cost_usd   numeric(10, 6),
  -- An assistant turn that failed PART WAY. The text that did arrive is still stored above:
  -- those tokens are paid for, and this repo does not discard paid work.
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_idx
  on chat_messages (thread_id, created_at);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
