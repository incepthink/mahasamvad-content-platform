-- Direct social publishing: a completed twitter/facebook run can be posted to the
-- official department X account / Facebook Page from the detail page. These columns
-- hold the LATEST live post only — re-publishing (e.g. after a poster image-feedback
-- round) overwrites both. null = never published. Additive and nullable, so this is
-- safe (and required) to apply before the API that writes it is deployed.

alter table generations
  add column if not exists published_url text,
  add column if not exists published_at timestamptz;
