-- Move /chat's native PDF and conversation state from Gemini to OpenAI Responses.
--
-- The durable private storage object remains the source of truth. Existing Gemini-era rows
-- have no OpenAI file id; the API lazily uploads their stored PDF on the first new turn and
-- fills this column. New rows use OpenAI immediately. Old Gemini columns stay in place for a
-- safe rolling deploy, but are nullable because no new write populates them.

alter table chat_files
  alter column gemini_file_name drop not null,
  alter column gemini_file_uri drop not null,
  alter column gemini_expires_at drop not null;

alter table chat_files
  add column if not exists openai_file_id text,
  add column if not exists byte_size bigint check (byte_size is null or byte_size >= 0);

-- Stored on the successful assistant row. A normal follow-up sends only its new user turn
-- with previous_response_id; after any failed assistant row the bounded transcript is replayed.
alter table chat_messages
  add column if not exists openai_response_id text;
