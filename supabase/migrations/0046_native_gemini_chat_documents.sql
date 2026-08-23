-- Native PDF attachments for /chat.
--
-- A chat PDF is no longer reduced to extracted text before the question can leave. The
-- original is retained in the existing private source bucket and uploaded to Gemini Files;
-- chat_messages carries only this row's UUID. Gemini's file expires, while a conversation
-- does not, so the retained storage_path is what lets the API refresh the provider handle.

create table if not exists chat_files (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid references chat_threads(id) on delete cascade,
  display_name        text not null,
  mime_type           text not null check (mime_type = 'application/pdf'),
  storage_path        text not null unique,
  gemini_file_name    text not null,
  gemini_file_uri     text not null,
  gemini_expires_at   timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists chat_files_thread_idx
  on chat_files (thread_id, created_at);

alter table chat_files enable row level security;

-- The provider-side conversation chain. Stored on the assistant row that completed the
-- interaction, so the latest successful assistant message is always the safe continuation
-- point; a failed user turn cannot advance it.
alter table chat_messages
  add column if not exists gemini_interaction_id text;

