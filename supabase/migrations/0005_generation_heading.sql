-- Add the optional editorial angle / heading the user supplies for a generation run.
-- Nullable with no default: existing rows and any request that omits it stay null,
-- preserving the original behaviour (the model picks its own angle). The heading is a
-- title/emphasis directive only, never a factual source — see AGENTS.md and
-- packages/content-engine generate-article.ts.

alter table generations
  add column if not exists heading text;
