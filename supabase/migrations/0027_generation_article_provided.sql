-- Media-room flow: the run's note IS a finished article the user pasted, so the
-- runner uses it verbatim and skips generateArticle (the poster copy is derived
-- straight from it). false for every ordinary run. Additive + defaulted, so an
-- old API is unaffected — apply this before the API deploy.
alter table generations
  add column if not exists article_provided boolean not null default false;
