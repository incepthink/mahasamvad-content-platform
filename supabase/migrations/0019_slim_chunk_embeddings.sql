-- Slim the RAG store to fit the Supabase free tier. mahasamvad_chunks reached 659 MB at
-- 37.8k rows, ~80% of it embeddings: halfvec(3072) heap vectors plus an HNSW index that
-- stores a second copy of every vector. Two changes:
--
--   1. Drop the ANN index. A brute-force halfvec cosine scan over ~38k rows is fast
--      enough, and retrieval runs once per generation — not per keystroke. Re-add an HNSW
--      index at the new 1024 dims (~1/3 the old size) only if scans ever slow down.
--   2. Truncate stored vectors 3072 → 1024 dims. text-embedding-3-large is
--      Matryoshka-trained: truncating + l2-renormalizing is exactly what OpenAI does
--      server-side when asked for `dimensions: 1024`, so existing rows stay comparable
--      with future query/ingest embeddings (openai-embeddings.ts now sends that param).
--
-- Requires pgvector >= 0.7 (halfvec, subvector, l2_normalize):
--   select extversion from pg_extension where extname = 'vector';
--
-- Deploy note: apply together with the code that sets EMBEDDING_DIMENSIONS = 1024 —
-- either side alone makes the match RPC reject the query vector's dimension.

-- Index first: frees ~half the table's footprint immediately and gives the column
-- rewrite below disk headroom (ALTER ... USING rewrites the whole table).
drop index if exists mahasamvad_chunks_embedding_idx;

alter table mahasamvad_chunks
  alter column embedding type halfvec(1024)
  using l2_normalize(subvector(embedding, 1, 1024));

-- Recreate the match RPC at the new dimension. Drop the 3072 signature first so
-- PostgREST does not see two overloads and fail to pick one (same trap as 0004).
drop function if exists match_mahasamvad_chunks(halfvec(3072), int, text);

create or replace function match_mahasamvad_chunks(
  query_embedding halfvec(1024),
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
