-- Add the article category (news vs scheme) chosen by the user for a generation run.
-- Defaults to 'scheme' so existing rows and any request that omits it keep the original
-- behaviour. The category selects the generation voice + style example (see
-- packages/content-engine generate-article.ts / category-prompt.ts).

alter table generations
  add column if not exists category text not null default 'scheme'
  check (category in ('news', 'scheme'));
