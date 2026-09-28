-- /new-video-workflow — two conversation MODES: the existing Gemini video conversation, and a
-- storyboard chat on OpenAI (scripts, storyboards, scene revisions, images when asked for).
--
-- ONE MODE PER CONVERSATION, fixed by its first turn. A storyboard answer and a rendered video
-- are different kinds of turn with different chain handles (an OpenAI response id versus a
-- Gemini interaction id, both kept in the existing `last_interaction_id` / `interaction_id`
-- columns), so mixing them in one conversation would hand one provider the other's handle.
-- The column is what lets the route refuse that and the rail say which kind a row is.
--
-- A storyboard conversation is stored as an ORDINARY CHAT, not as a structured storyboard:
-- the officer's message is `prompt`, their uploaded pictures are `images`, the assistant's
-- Markdown answer is `model_text`, and the pictures it generated are `generated_images`
-- below. There are deliberately no scene rows and no scene fields — a revision is simply the
-- next assistant message.
--
-- Additive and defaulted, so every existing conversation reads as 'video'. The API reads both
-- tables with `select *` and inserts `mode` only for a storyboard conversation, so an
-- un-applied 0060 fails a storyboard create and nothing else: video mode keeps working.

alter table new_video_conversations
  add column if not exists mode text not null default 'video'
    check (mode in ('video', 'storyboard'));

-- [{ id, url, label, prompt }] — pictures the storyboard assistant generated for this turn,
-- re-hosted in the public posters bucket. Always '[]' on a video turn.
alter table new_video_turns
  add column if not exists generated_images jsonb not null default '[]'::jsonb;

comment on column new_video_conversations.mode is
  'video = Gemini video conversation; storyboard = OpenAI storyboard chat. Fixed by the first turn.';
comment on column new_video_turns.generated_images is
  'Storyboard mode only: [{id,url,label,prompt}] images the assistant generated for this turn.';
