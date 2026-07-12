-- Versioned reference-image library for the fixed poster master templates.
-- Gallery objects are immutable; activating one copies its bytes to the stable
-- references/master-<subtype>.png path consumed by n8n.
-- All access is server-side via the service-role key.

create table if not exists reference_images (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('twitter', 'article')),
  subtype      text not null,
  storage_path text not null unique,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reference_images_category_subtype_check check (
    (category = 'twitter' and subtype in ('alert', 'campaign', 'info_bullets', 'quote', 'timeline'))
    or (category = 'article' and subtype = 'article')
  )
);

-- At most one active master per folder.
create unique index if not exists reference_images_one_active_idx
  on reference_images (category, subtype) where is_active;

create index if not exists reference_images_folder_idx
  on reference_images (category, subtype, created_at desc);

-- RLS on, no public policies: anon key locked out; service-role key bypasses.
alter table reference_images enable row level security;
