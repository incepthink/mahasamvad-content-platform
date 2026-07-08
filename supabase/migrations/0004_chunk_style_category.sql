-- Tag each RAG chunk with the coarse style bucket it belongs to (news vs scheme), so
-- retrieval can be SCOPED to one voice. Until now the store held only कर्जमुक्ती (scheme)
-- chunks and the match RPC searched the whole table; adding the वृत्त विशेष (news) corpus
-- to the same table means news and scheme references would cross-contaminate without a
-- filter. Existing rows are all scheme, so the column defaults to 'scheme' (no backfill
-- needed); news chunks are ingested with style_category = 'news'.

alter table mahasamvad_chunks
  add column if not exists style_category text not null default 'scheme'
  check (style_category in ('news', 'scheme'));

-- Replace the match function with a category-scoped variant. Drop the old 2-arg signature
-- first so PostgREST does not see two overloads and fail to pick one.
drop function if exists match_mahasamvad_chunks(halfvec(3072), int);

-- Similarity search used by retrieval (PROJECT_CONTEXT step 11). `filter_category` is
-- optional: null keeps the original global behaviour; 'news' / 'scheme' restricts the
-- search to that style bucket so news pulls only news references and scheme only scheme.
create or replace function match_mahasamvad_chunks(
  query_embedding halfvec(3072),
  match_count int default 5,
  filter_category text default null
)
returns table (
  id         text,
  article_id integer,
  text       text,
  title      text,
  url        text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.article_id,
    c.text,
    c.title,
    c.url,
    1 - (c.embedding <=> query_embedding) as similarity
  from mahasamvad_chunks c
  where filter_category is null or c.style_category = filter_category
  order by c.embedding <=> query_embedding
  limit match_count
$$;
