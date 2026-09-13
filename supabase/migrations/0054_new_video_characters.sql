-- /new-video-workflow's character & voice registry — this repo's answer to Flow's
-- "Ingredients", and the structural fix for the complaint that characters and their voices
-- are not consistent "when chats are switched".
--
-- WHAT "SWITCHING CHATS" ACTUALLY IS, because the fix follows from it. A new chat in the
-- Gemini app carries NOTHING over: it has no memory of the old one. Consistency there comes
-- from the user re-supplying the same reference picture and the same description by hand, or
-- from Flow's saved Ingredients doing it for them. So the thing that reproduces the good case
-- here is not forking an interaction — it is a stored cast that a FRESH conversation can be
-- seeded from, which is what these two tables are.
--
-- WHY A CHARACTER IS ITS OWN ROW rather than a jsonb blob on a conversation: a registry entry
-- is reusable ACROSS conversations by definition (that is the whole feature), so it cannot
-- belong to one of them. It is the reference_images master library in miniature.
--
-- WHY THE CAST IS A LINK TABLE rather than a `character_ids` column on
-- new_video_conversations: adding a column means naming it in CONVERSATION_COLUMNS, and every
-- existing read of that table would then fail on a database without this migration — which
-- would take the whole page down rather than this feature. Nothing here touches an existing
-- table, so an un-applied 0054 disables the registry ALONE: conversations, turns, images and
-- every render keep working exactly as they do today. Apply it before the API deploy anyway.

create table if not exists new_video_characters (
  id           uuid primary key default gen_random_uuid(),
  -- The canonical name the prompt block binds a reference tag and a voice to. Officer-typed
  -- and reproduced into a block that carries <IMAGE_REF_n> syntax, which is why the API
  -- refuses the four characters that syntax is made of.
  name         text not null,
  -- What the character looks like, in words. Emitted on the turn that ESTABLISHES the
  -- character; a later edit turn is told to keep everything the same rather than handed the
  -- description again, because re-describing a reference on an edit is a documented cause of
  -- unintended changes.
  appearance   text not null default '',
  -- THE FIELD THIS TABLE EXISTS FOR. Google's documented technique for voice consistency is
  -- to repeat the whole voice description, unchanged, on EVERY turn — and voice editing is
  -- not supported by the model at all, so a wrong voice cannot be corrected afterwards, only
  -- prevented. Our follow-ups send just the new instruction (that is what
  -- previous_interaction_id is for), so before this column the description was stated once
  -- and never again. That is exactly the reported symptom.
  voice        text not null default '',
  -- The reference portrait, denormalized off new_video_images rather than pointed at by a
  -- foreign key: a registry entry outlives any one upload, and this repo joins nowhere.
  -- `portrait_path` and `portrait_mime` are server-side only — the job fetches the bytes with
  -- them and neither is ever put on the wire. All three are null together for a character
  -- described in words alone.
  portrait_url  text,
  portrait_path text,
  portrait_mime text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists new_video_characters_created_at_idx
  on new_video_characters (created_at desc);

-- Who is in a conversation. SET ON ITS FIRST TURN AND FIXED THEREAFTER: a character's
-- portrait is attached on the turn that establishes it, and stacking a new reference into the
-- middle of an edit chain is a documented failure mode — so changing the cast is what
-- starting a new conversation is for, which is cheap precisely because the registry re-seeds
-- it automatically.
create table if not exists new_video_conversation_characters (
  conversation_id uuid not null
    references new_video_conversations (id) on delete cascade,
  character_id    uuid not null
    references new_video_characters (id) on delete cascade,
  -- The order the officer picked them in, which is the order their <IMAGE_REF_n> tags are
  -- assigned in. A set with no order would re-bind a portrait to a different character
  -- between reads.
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, character_id)
);

create index if not exists new_video_conversation_characters_conversation_idx
  on new_video_conversation_characters (conversation_id, position);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table new_video_characters enable row level security;
alter table new_video_conversation_characters enable row level security;
