-- Cheap non-vector fallback for article style references.
--
-- Semantic retrieval uses the halfvec index and can be cancelled by Supabase's statement
-- timeout. Article generation must still be able to choose a real Mahasamvad exemplar without
-- repeating that expensive query, so the fallback reads one `chunk_index = 0` row per article
-- in the requested style category, newest first.
create index if not exists mahasamvad_chunks_style_fallback_idx
  on public.mahasamvad_chunks (style_category, chunk_index, published_time desc);
