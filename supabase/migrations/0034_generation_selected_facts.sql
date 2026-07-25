-- Preserve the fact inventory approved in the /dlo Pointers step.
--
-- selected_facts carries [{ dimension, text }] so generation can build its 5W1H scaffold
-- without re-extracting the raw note. statements carries the selected attributed statements
-- as [{ speaker, designation, venue, claim }]. Both are insert-only job inputs.

alter table public.generations
  add column if not exists selected_facts jsonb,
  add column if not exists statements jsonb;

comment on column public.generations.selected_facts is
  'Officer-approved DLO pointer inventory: [{dimension,text}].';

comment on column public.generations.statements is
  'Officer-approved attributed statements: [{speaker,designation,venue,claim}].';
