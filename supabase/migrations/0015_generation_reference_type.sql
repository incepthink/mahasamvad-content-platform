-- Optional Twitter section pin: force a reference type while rolling one of
-- that type's enabled images afresh for each generation.
alter table generations
  add column if not exists reference_type_id uuid
    references reference_types (id) on delete set null;

