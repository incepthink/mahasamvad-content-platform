-- Lineage for follow-up generations spawned from a run's detail page ("next
-- step" actions + failed-run retry). source_generation_id is the direct parent
-- (provenance, drives the note-changed marker); thread_root_id is the thread's
-- first generation, denormalized so membership is one indexed query
-- (id = root OR thread_root_id = root). Both null on thread roots and on all
-- pre-feature rows; the root is computed server-side at create time as
-- parent.thread_root_id ?? parent.id, so chains (A -> B -> C) stay flat.
alter table generations
  add column if not exists source_generation_id uuid
    references generations (id) on delete set null,
  add column if not exists thread_root_id uuid
    references generations (id) on delete set null;

-- Partial: most rows are thread-less roots with a null value.
create index if not exists generations_thread_root_idx
  on generations (thread_root_id)
  where thread_root_id is not null;
