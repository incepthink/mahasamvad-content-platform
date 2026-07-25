-- The official designation (पदनाम) a person is named with in published copy.
--
-- A DLO's meeting recording says "देवेंद्र फडणवीस"; the published article must say
-- "मुख्यमंत्री देवेंद्र फडणवीस", because in government communication the designation is part
-- of how the person is officially named, not decoration. This column holds that link.
--
-- Meaningful on `person` rows only; null = no designation = the name prints bare (the pipeline
-- never infers one). The value is the MARATHI designation. Its English/Hindi are NOT stored
-- here: the designation is expected to also exist as its own `designation`-typed row in this
-- same table, which already carries english/hindi (0007 + 0025) and is seeded with 19 common
-- titles in 0010. That indirection is deliberate — "मुख्यमंत्री → Chief Minister" is then
-- corrected in ONE place rather than once per office-holder, and it is what makes the English
-- LOCKED TERMS table translate the designation with no new translation code.
--
-- Plain text rather than a foreign key: `marathi` is already unique, so the string IS a natural
-- key, and a text column leaves findGlossaryTermsInText (fetch-all + String.includes) untouched.
--
-- Additive + nullable. Null everywhere = today's behaviour, so an un-applied 0032 disables the
-- feature rather than breaking the glossary — but apply it before the API deploy anyway.
alter table glossary_terms
  add column if not exists designation text;

comment on column glossary_terms.designation is
  'Marathi designation (पदनाम) to print before this person''s name on first mention. Person rows only; null = print the name bare. Expected to also exist as a designation-typed row here, which supplies its English/Hindi.';
