-- Reference types: the catalog of poster type slots (six builtins + user-created
-- custom twitter types). reference_images rows hang off a type via a composite FK,
-- and the API sends the full enabled catalog to n8n per generation, so the
-- workflows stay data-driven (no hardcoded type lists or master URLs).
--
-- Deploy ordering: apply this migration BEFORE deploying API code that reads
-- reference_types (the old API ignores the new table; the new API requires it).

create table if not exists reference_types (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('twitter', 'article')),
  -- Slug charset stays machine-safe: slugs feed OpenAI json_schema enums and
  -- storage paths (label_mr carries the Devanagari).
  slug        text not null check (slug ~ '^[a-z0-9_]+$'),
  label_mr    text not null,
  -- The n8n classifier routes notes to a type by this description.
  description text not null default '',
  -- Which copy schema/layout the n8n social-post workflow renders this type
  -- with. Builtins keep their bespoke layout; custom types use 'generic'.
  copy_style  text not null default 'generic'
    check (copy_style in ('alert', 'campaign', 'info_bullets', 'quote', 'timeline', 'generic')),
  is_builtin  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (category, slug)
);

-- RLS on, no public policies: anon key locked out; service-role key bypasses.
alter table reference_types enable row level security;

-- Seed the six builtins BEFORE adding the FK so the existing reference_images
-- rows (0012's check constraint allowed exactly these six pairs) satisfy it.
-- Descriptions are the verbatim classifier lines the n8n workflow used to hardcode.
insert into reference_types (category, slug, label_mr, description, copy_style, is_builtin) values
  ('twitter', 'alert', 'सूचना (Alert)', 'urgent public-safety warning or advisory (caution, dos and donts, helpline). Kicker + a few action points.', 'alert', true),
  ('twitter', 'campaign', 'मोहीम (Campaign)', 'a drive / event / service / vaccination / scheme that has a date, an audience, a call-to-action and figures.', 'campaign', true),
  ('twitter', 'info_bullets', 'माहिती-मुद्दे (Info)', 'general information, achievements or arrangements conveyed as a headline plus a list of points.', 'info_bullets', true),
  ('twitter', 'quote', 'अवतरण (Quote)', 'a statement or quote by a leader/official (e.g. the Chief Minister), with attribution and supporting points.', 'quote', true),
  ('twitter', 'timeline', 'कालक्रम (Timeline)', 'a chronological sequence of dated milestones or achievements.', 'timeline', true),
  ('article', 'article', 'लेख', '', 'generic', true)
on conflict (category, slug) do nothing;

-- The fixed-six check constraint is replaced by the FK into the catalog.
alter table reference_images
  drop constraint if exists reference_images_category_subtype_check;

-- Rotation replaces single-active: many images per (category, subtype) may be
-- enabled at once; one enabled image is picked at random per generation.
drop index if exists reference_images_one_active_idx;

alter table reference_images
  add constraint reference_images_type_fkey
  foreign key (category, subtype) references reference_types (category, slug);

comment on column reference_images.is_active is
  'Enabled in the rotation: many images per (category, subtype) may be true; one enabled image is picked at random per generation.';

-- Optional pin: the exact reference image a generation was asked to use.
-- Deleting a library image never breaks history (set null).
alter table generations
  add column if not exists reference_image_id uuid references reference_images (id) on delete set null;
