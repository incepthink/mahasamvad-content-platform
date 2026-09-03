-- 0052: Dynamic Posters — a still poster the officer already has, motionised into a
-- short looping clip.
--
-- Its own generations.category, the 'youtube' precedent (0042) rather than a flavour of
-- an existing lane: it shares no reference library, no copy call, no chrome, no caption
-- and no publishing with any of them. The officer supplies the IMAGE (not a note), the
-- API writes a motion prompt with gpt-5.6-sol, and gemini-omni renders the clip.
--
-- One CHECK widening on each of the two tables plus five additive columns. Apply BEFORE
-- deploying the API: a CHECK cannot be worked around from code, so an un-applied 0052
-- fails every dynamic-poster create and every follow-up. The columns follow the
-- omit-unless-present rule (insertGeneration never names them unless a value is given),
-- so nothing else on either table is affected.

-- 1. The new category. Extends the CHECK last set by 0042_youtube_thumbnails.sql.
alter table generations
  drop constraint if exists generations_category_check;

alter table generations
  add constraint generations_category_check
  check (category in ('news', 'scheme', 'twitter', 'facebook', 'youtube', 'dynamic_poster'));

comment on constraint generations_category_check on generations is
  'news/scheme = article lane; twitter/facebook = social lane; youtube = thumbnail lane; dynamic_poster = motionised poster lane.';

-- 2. The lane's own columns.
--
-- source_image_path      the poster the officer uploaded (public posters bucket). Kept so a
--                        follow-up, a retry and the detail page all read the same object
--                        rather than asking the browser to re-upload it.
-- motion_path            the current clip (public videos bucket), versioned per render.
-- motion_gif_path        the same render as a GIF, for wherever a video file will not go.
-- motion_prompt          the prompt gpt-5.6-sol wrote for gemini-omni. Stored because it is
--                        what actually produced the clip — without it a bad render cannot be
--                        told apart from a bad prompt.
-- motion_interaction_id  the Gemini interaction the next follow-up continues from. THE CHAIN
--                        POINT: only a render that produced a clip advances it, so a failed
--                        follow-up leaves the chain on the video the officer can actually see
--                        (the /new-video-workflow rule).
alter table generations
  add column if not exists source_image_path     text,
  add column if not exists motion_path           text,
  add column if not exists motion_gif_path       text,
  add column if not exists motion_prompt         text,
  add column if not exists motion_interaction_id text;

-- 3. Follow-ups are revisions, so each render stays downloadable exactly as a poster
-- version does. 'motion' joins the target list last widened by 0023_revision_caption.sql.
alter table generation_revisions
  drop constraint if exists generation_revisions_target_check;

alter table generation_revisions
  add constraint generation_revisions_target_check
  check (target in (
    'article', 'poster_copy', 'poster_scene', 'manual_copy', 'poster_image',
    'caption', 'manual_caption', 'motion'
  ));

-- The snapshot columns for that target. Separate from poster_path deliberately: that column
-- is a PNG every poster reader in the API treats as one, and an .mp4 sitting in it would be
-- listed as a poster version by posterVersionPaths.
alter table generation_revisions
  add column if not exists motion_path     text,
  add column if not exists motion_gif_path text;
