-- Add the 'facebook' generation category. It runs the exact same pipeline as
-- 'twitter' (the external social-post-v2-api n8n workflow → poster + caption,
-- twitter master library, chrome stamped in code); it is a distinct value only so
-- the two social lanes are distinguishable in history and can diverge later
-- without a backfill. Extends the CHECK last set by 0006_social_post.sql.

alter table generations
  drop constraint if exists generations_category_check;

alter table generations
  add constraint generations_category_check
  check (category in ('news', 'scheme', 'twitter', 'facebook'));
