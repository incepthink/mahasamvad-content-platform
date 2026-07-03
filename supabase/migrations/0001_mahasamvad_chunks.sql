-- Mahasamvad RAG store (PROJECT_CONTEXT step 6/8): chunks + metadata + embeddings.
--
-- Embeddings come from OpenAI text-embedding-3-large (3072 dims). We store them as
-- halfvec, not vector: pgvector can only build an ANN index on vectors up to 2000
-- dims, but HNSW over halfvec supports up to 4000 dims. halfvec (16-bit floats)
-- also halves storage with negligible recall loss, which is the recommended pattern
-- for 3072-dim OpenAI embeddings on Supabase.

create extension if not exists vector;

create table if not exists mahasamvad_chunks (
  id             text primary key,          -- `${article_id}-${chunk_index}`
  article_id     integer not null,
  chunk_index    integer not null,
  text           text not null,
  title          text,
  url            text,
  published_time timestamptz,
  categories     text[] not null default '{}',
  tags           text[] not null default '{}',
  embedding      halfvec(3072) not null,
  created_at     timestamptz not null default now()
);

-- Cosine ANN index. For 184 rows this is not strictly needed (exact scan is fast),
-- but it keeps queries fast as the corpus scales to the full site.
create index if not exists mahasamvad_chunks_embedding_idx
  on mahasamvad_chunks
  using hnsw (embedding halfvec_cosine_ops);

-- No public policies: all access is server-side via the service-role key, which
-- bypasses RLS. Enabling RLS keeps the anon key from reading the table by default.
alter table mahasamvad_chunks enable row level security;

-- Similarity search used by retrieval (PROJECT_CONTEXT step 11). Returns the
-- closest chunks by cosine similarity. security definer + a pinned search_path so
-- it can be called safely via RPC.
create or replace function match_mahasamvad_chunks(
  query_embedding halfvec(3072),
  match_count int default 5
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
  order by c.embedding <=> query_embedding
  limit match_count
$$;
