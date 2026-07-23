-- Optional corrected Hindi spelling for a glossary proper noun.
-- The Hindi translation path locks names to their Marathi Devanagari form by
-- default; this column lets an officer override a name whose correct Hindi spelling
-- differs from the Marathi one (e.g. कोल्हापूर → कोल्हापुर). Nullable, no default:
-- null = keep locking the name to its Marathi form (existing behaviour). Additive —
-- apply before the API deploy.
alter table glossary_terms
  add column if not exists hindi text;

comment on column glossary_terms.hindi is
  'Optional corrected Hindi spelling of the name. Null = the Hindi translation locks the name to its Marathi form (default).';
