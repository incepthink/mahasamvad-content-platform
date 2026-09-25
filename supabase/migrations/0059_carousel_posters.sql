-- 0059: Carousel posters (कॅरोसेल) — one note becomes a multi-image post: a cover slide plus
-- two or three detail slides, all 4:5, all in one look.
--
-- Its own generations.category, the 'dynamic_poster' precedent (0052): every single-poster
-- reader in the API (poster_path, the version strip, publish, Canva, pixel feedback) assumes
-- ONE poster per row, and a carousel has several. Keeping it a separate lane leaves all of that
-- untouched.
--
-- One CHECK widening plus one additive jsonb column. Apply BEFORE deploying the API: a CHECK
-- cannot be worked around from code, so an un-applied 0059 fails every carousel create. The
-- column follows the omit-unless-present rule (insertGeneration names it only on a carousel
-- run), so nothing else on the table is affected.

-- 1. The new category. Extends the CHECK last set by 0052_dynamic_posters.sql.
alter table generations
  drop constraint if exists generations_category_check;

alter table generations
  add constraint generations_category_check
  check (category in ('news', 'scheme', 'twitter', 'facebook', 'youtube', 'dynamic_poster', 'carousel'));

comment on constraint generations_category_check on generations is
  'news/scheme = article lane; twitter/facebook = social lane; youtube = thumbnail lane; dynamic_poster = motionised poster lane; carousel = multi-slide social post lane.';

-- 2. The lane's state.
--
-- carousel  { requestedSlides: 'auto' | 3 | 4,
--             plan: { seriesTitle, slides: [{ role, title, subtitle, items: [{ text, emphasis }] }] },
--             slides: [{ index, role, title, path, plainPath, version, versions: [{ path, plainPath, createdAt }] }],
--             paletteId }
--
--           requestedSlides is written at INSERT, so a retry reproduces the officer's choice. The
--           plan and the slides are written by the job as they land — each slide the moment it is
--           rendered, so a retry after a mid-render failure renders only the missing ones. Every
--           slide's history lives here rather than in generation_revisions, so the poster version
--           numbering (nextVersion) is untouched. poster_path carries the current COVER, which is
--           what keeps the history cards, the tasks panel and the gallery working unchanged.
alter table generations
  add column if not exists carousel jsonb;

comment on column generations.carousel is
  'Carousel lane only (0059): requested slide count, the slide plan, and every slide''s current render + version history. Null on every other lane.';
