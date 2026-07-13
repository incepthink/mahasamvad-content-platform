-- Vision-derived layout of each master template, cached on the row.
--
-- The n8n social-post workflow used to assert that every master carries a photo
-- zone ("erase the existing photo/illustration, then paint a NEW scene"), so a
-- text-only master still came back with a hero photograph. The structural signal
-- has to come from the master's pixels, not from the type's prose description, so
-- a gpt-4o-mini vision pass runs once per uploaded image and its result rides
-- along in the webhook catalog.
--
-- Shape: { hasPhotoZone: boolean, bulletSlots: number, layoutSummary: string }.
--
-- Nullable is load-bearing: NULL means "not analyzed yet" and the workflow must
-- fall back to its previous behaviour, so existing rows keep working until the
-- backfill (pnpm --filter @dgipr/content-engine analyze:references) has run.
alter table reference_images
  add column if not exists layout_spec jsonb;
