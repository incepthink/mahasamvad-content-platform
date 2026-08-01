-- 0042: YouTube thumbnails as their own lane.
--
-- A thumbnail is not a poster and not a caption: it is a 1280x720 landscape frame read at a
-- glance on a phone tile, with its own reference library and its own brand chrome
-- (yt-footer.png + the emblem lockup). So 'youtube' is a real generations.category — a
-- distinct value, the 'facebook' precedent — rather than a flavour of the social lane, and
-- 'youtube' is a third reference_types/reference_images category beside 'twitter' and
-- 'article'.
--
-- Three CHECK widenings and one seed row. Apply BEFORE deploying the API: unlike the
-- omit-unless-present column migrations (0028/0029/0041), a CHECK cannot be worked around
-- from code — an un-applied 0042 fails every youtube create and every youtube reference
-- upload. Nothing else is affected: existing rows and categories are untouched.

-- 1. generations.category. Extends the CHECK last set by 0020_facebook_category.sql.
alter table generations
  drop constraint if exists generations_category_check;

alter table generations
  add constraint generations_category_check
  check (category in ('news', 'scheme', 'twitter', 'facebook', 'youtube'));

-- 2. The reference catalog. Both CHECKs were written by 0012/0013 as fixed two-value lists.
alter table reference_types
  drop constraint if exists reference_types_category_check;

alter table reference_types
  add constraint reference_types_category_check
  check (category in ('twitter', 'article', 'youtube'));

alter table reference_images
  drop constraint if exists reference_images_category_check;

alter table reference_images
  add constraint reference_images_category_check
  check (category in ('twitter', 'article', 'youtube'));

-- 3. The one builtin youtube type. A single type holding one rotation, deliberately: the
-- thumbnail is chosen by matching the officer's information against each master's cached
-- layout_spec (select-by-information.ts), so a type taxonomy would only narrow that pool
-- before anything had been looked at. copy_style is 'generic' because this lane never runs
-- the structured copy call at all — the officer's text goes to the image model verbatim.
insert into reference_types (category, slug, label_mr, description, copy_style, is_builtin) values
  ('youtube', 'youtube_thumbnail', 'यूट्यूब थंबनेल', 'YouTube video thumbnail: one dominant Marathi headline plus the event details, read at a glance on a small tile.', 'generic', true)
on conflict (category, slug) do nothing;

comment on constraint generations_category_check on generations is
  'news/scheme = article lane; twitter/facebook = social lane; youtube = thumbnail lane.';
