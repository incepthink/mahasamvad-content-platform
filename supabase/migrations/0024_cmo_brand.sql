-- Template brand: a second axis on the social-poster flow, orthogonal to the
-- platform lane (twitter/facebook). 'dgipr' is the existing department; 'cmo'
-- renders the मंत्रिमंडळ निर्णय template family (fixed 3-leader header stamped in
-- code, DGIPR footer reused, 2 topic images painted by the model in the omega).
--
-- Two columns, both additive + defaulted, so this is safe (and required) to apply
-- BEFORE the API that reads/writes them is deployed:
--   * reference_types.brand   — tags which type slots belong to CMO. The default
--     ('dgipr') keeps every existing type — builtins and the user's custom types —
--     in the DGIPR pool, so the classifier never routes an ordinary Twitter run
--     into a CMO template, and CMO types are only used when explicitly selected.
--   * generations.template_brand — records the brand a run was created with, so the
--     job runner branches catalog selection + n8n image prompt + code-stamped chrome.

alter table reference_types
  add column if not exists brand text not null default 'dgipr'
    check (brand in ('dgipr', 'cmo'));

alter table generations
  add column if not exists template_brand text not null default 'dgipr'
    check (template_brand in ('dgipr', 'cmo'));

comment on column reference_types.brand is
  'Template brand family: dgipr (default, the classifier pool) or cmo (मंत्रिमंडळ निर्णय; used only when the run selects विभाग = CMO).';
comment on column generations.template_brand is
  'Which template brand this run was created with (dgipr default | cmo). Drives the runner''s catalog/prompt/chrome branch.';
