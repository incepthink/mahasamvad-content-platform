-- /new-video-workflow — Gemini conversational video, promoted from an in-process experiment
-- to a real product surface.
--
-- WHAT THIS REPLACES. The feature shipped on 2026-09-01 holding its conversations in a Map
-- inside the API (jobs/new-video-workflow.ts): a 3-hour TTL, 50 conversations, everything lost
-- on restart, a single API process, and — the reason this migration exists — no history at all.
-- The page could not list past conversations because there was nothing to list. Officers now
-- reopen and share their video conversations the way they do their chats, so the state of
-- record moves into the database and the Map becomes a cache of nothing.
--
-- TWO TABLES, for the reason 0044 gives: a conversation GROWS a turn at a time, so a `turns`
-- jsonb array would be read and rewritten wholesale on every status change — quadratic, and a
-- lost-update race between the polling route and the running job. Every other feature here
-- keeps per-item state in jsonb because one job produces the whole array at once; this one and
-- /chat are the two that do not.
--
-- The denormalized columns on new_video_conversations (title, turn_count, last_turn_at) exist
-- so the rail's list query never touches new_video_turns — the chat_threads / transcriptions
-- precedent. A turn's prompt can be 20,000 characters and the rail polls while a render runs.
--
-- Self-contained and additive: nothing outside /new-video-workflow reads these tables, so an
-- un-applied 0050 disables that page and nothing else.

create table if not exists new_video_conversations (
  id           uuid primary key default gen_random_uuid(),
  -- What the rail calls this conversation: derived from the first prompt and truncated. Set
  -- once, best-effort, by the turn route.
  title        text not null default '',
  turn_count   integer not null default 0,
  -- Ordering key for the rail. Distinct from updated_at, which also moves when a turn
  -- finishes generating — "most recently asked for" is the useful sort.
  last_turn_at timestamptz,
  -- THE CHAIN POINT: the last SUCCESSFUL Gemini interaction id, which becomes the next turn's
  -- previous_interaction_id. Advanced only by a turn that produced a video (see
  -- markTurnCompleted) — a failed turn must never become the state the next instruction edits
  -- from, or every later "change the background" edits something nobody saw.
  --
  -- NEVER LEAVES THE API. It is a provider-side handle authenticated by our key; the browser
  -- sees public bucket URLs and ids this API minted, and nothing else.
  last_interaction_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists new_video_conversations_last_turn_at_idx
  on new_video_conversations (last_turn_at desc nulls last, created_at desc);

create table if not exists new_video_turns (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references new_video_conversations (id) on delete cascade,
  -- Exactly what was typed. This string travels to Gemini VERBATIM — no trimming, no
  -- normalising, no house style — which is the whole contract of this lane, so it is stored
  -- the same way.
  prompt          text not null,
  -- [{ id, name, url }] — the reference pictures this turn carried, denormalized off
  -- new_video_images so rendering a past turn needs no join and survives an image row being
  -- swept. The storage path and mime type stay in new_video_images and never appear here.
  images          jsonb not null default '[]'::jsonb,
  -- 'queued' is written by the ROUTE before it answers 202: the client refreshes the instant
  -- the 202 lands, and a conversation with no new turn in it would read as finished.
  status          text not null default 'queued'
    check (status in ('queued', 'generating', 'completed', 'failed')),
  -- A public URL for the re-hosted MP4. The Gemini URI is authenticated by our API key and
  -- must never reach a browser, so the bytes are copied into our own public bucket.
  video_url       text,
  -- This turn's own interaction id, recorded whether or not it produced a video. Promoted to
  -- the conversation's last_interaction_id only on success.
  interaction_id  text,
  -- Any prose the model returned beside the video — a refusal explains itself here.
  model_text      text,
  -- The provider's own words on failure, stored and shown VERBATIM. Every other surface
  -- replaces an internal English message with a canned Marathi sentence; here, reading what
  -- the API actually said (a safety-filter reason, a rejected parameter, a quota wall) is the
  -- point of the page.
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists new_video_turns_conversation_idx
  on new_video_turns (conversation_id, created_at);

-- Reference pictures, uploaded while the officer is still typing and named by id on the turn
-- request. Its own table rather than a column on the turn because an image is uploaded BEFORE
-- the turn exists, and because resolving an id is what stops a browser pointing the model at
-- an object this API never accepted.
create table if not exists new_video_images (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  -- The public object URL: what the thumbnail renders and what a stored turn echoes.
  url          text not null,
  -- The bucket path and content type the JOB needs to fetch the bytes back at generation
  -- time. Server-side only; neither is ever put on the wire.
  storage_path text not null,
  mime_type    text not null,
  created_at   timestamptz not null default now()
);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table new_video_conversations enable row level security;
alter table new_video_turns enable row level security;
alter table new_video_images enable row level security;
