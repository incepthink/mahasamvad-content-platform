-- The officer's own direction for ONE video project, plus the reference
-- pictures they attached to it.
--
-- It replaces `heading` on the create form (which asked for a title/angle and
-- was threaded into the planners as one). An AI prompt is a different thing:
-- free text telling the script/storyboard model what to do with the supplied
-- material. `heading` is deliberately LEFT IN PLACE and still read on the
-- detail payload — legacy rows carry one and the list cards name themselves
-- from it.
--
-- Both are insert-only in effect: startVideoScriptJob re-reads the row, so a
-- direction held only in the create request would be lost by any later re-plan.
-- `prompt_image_paths` holds objects in the existing PUBLIC `videos` bucket
-- (projects/{id}/prompt/...), so the planner is handed ordinary public URLs and
-- nothing new has to be provisioned.
--
-- Additive and nullable, and insertVideoProject omits `ai_prompt` unless
-- something was typed (the 0029/0041 principle), so an un-applied 0051 fails
-- only a create that actually carries a prompt or a picture and leaves every
-- other video run working.

alter table video_projects
  add column if not exists ai_prompt text,
  add column if not exists prompt_image_paths jsonb;
