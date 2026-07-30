-- Style-reference retrieval currently scans every 1024-dimension vector. The corpus has grown
-- enough that the Supabase statement timeout is reached before match_mahasamvad_chunks returns,
-- forcing generation onto the non-semantic category fallback. Restore ANN search at the slimmed
-- 1024 dimensions introduced by migration 0019.
--
-- This is deliberately one global index: match_mahasamvad_chunks accepts a nullable category
-- parameter, and the planner can use this index for both filtered and unfiltered calls.

create index if not exists mahasamvad_chunks_embedding_hnsw_1024_idx
  on public.mahasamvad_chunks
  using hnsw (embedding halfvec_cosine_ops);

analyze public.mahasamvad_chunks;
