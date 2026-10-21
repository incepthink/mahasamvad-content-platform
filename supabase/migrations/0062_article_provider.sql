-- Which model writes an article, per run rather than per deployment.
--
-- One API now serves production and staging, and staging's /dlo is written on the self-hosted
-- gemma endpoint while production stays on ARTICLE_PROVIDER. The API resolves the provider
-- from the request's Origin (ARTICLE_PROVIDER_BY_ORIGIN) and STORES it here, because:
--
--   * on dlo_intakes it decided how the uploads were stored at create time (gemma keeps the
--     archived bytes, openai uploads a file id), so every later route on that intake must use
--     the same provider; and
--   * on generations the retry path and every job re-read the row, so a provider held only in
--     the request would switch a staging run back to the default on its first retry.
--
-- Additive + nullable. Null = the deployment default (ARTICLE_PROVIDER). Both inserts omit the
-- column unless set and the job's read is best-effort, so an un-applied 0062 costs only a
-- create from a mapped origin.

alter table public.dlo_intakes
  add column if not exists article_provider text;

alter table public.generations
  add column if not exists article_provider text;

comment on column public.dlo_intakes.article_provider is
  'Article provider this intake was created under (openai|qwen|gemma). Null = ARTICLE_PROVIDER.';
comment on column public.generations.article_provider is
  'Article provider this run writes its draft on (openai|qwen|gemma). Null = ARTICLE_PROVIDER.';
