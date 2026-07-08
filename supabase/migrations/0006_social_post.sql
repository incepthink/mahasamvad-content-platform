-- Support the Twitter flow (n8n-backed poster + X caption, background task).
-- Extend the generations.category CHECK (originally from 0003_generation_category.sql)
-- to allow 'twitter', and add the poster design_mode input it carries.
-- design_mode is write-once at insert and stays null for news/scheme rows.

alter table generations
  drop constraint if exists generations_category_check;

alter table generations
  add constraint generations_category_check
  check (category in ('news', 'scheme', 'twitter'));

alter table generations
  add column if not exists design_mode text;
