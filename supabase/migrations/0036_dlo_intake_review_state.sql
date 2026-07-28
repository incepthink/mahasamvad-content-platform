-- The officer's review-step state on a DLO intake, so leaving /dlo costs nothing already paid for.
--
-- review_state: everything the review step holds that is NOT already a column —
--   { v: 1,
--     edits: { "<sourceKey>": "<corrected text>" },   -- keys per apps/web/lib/dloReview.ts:
--     excluded: ["<sourceKey>", ...],                 --   'notes' | '<fileIndex>' | '<fileIndex>:<page>'
--     styleReference?, pointers?: { points, generatedAt },
--     designations?: { names, known, edits, extras },
--     writer, updatedAt }
--
-- Why it exists at all: before this, `intakeId` lived only in React state — no URL, no storage —
-- so a reload orphaned the intake outright, and the two PAID lookups on that screen (the pointer
-- summary, which is one model call per POINTERS_REQUEST_CHUNK_CHARS block of the source, and the
-- prepared-names call behind व्यक्ती व पदनाम) had to be bought again. Persisting the state is what
-- makes /dlo/[id] resumable by any officer, from any machine, for free.
--
-- Why its OWN column rather than a write-back into files[].text — three reasons, all load-bearing:
--   1. Disjoint columns are the concurrency story. `files` is rewritten WHOLESALE by
--      startDloExtractionJob / startDloFileReextractionJob, so an autosave landing inside it would
--      be a lost-update race against a live OCR job. updateDloIntake patches per field, so officer
--      writes and job writes can never clobber each other.
--   2. files[].text is the machine's answer and must stay readable as such. The client's
--      `edits[key] ?? page.text` overlay keeps both what Sarvam returned and what the officer
--      changed; overwriting the source destroys the ability to tell them apart.
--   3. forgetFile / forgetFileKeys already prune that overlay by file index after an OCR re-read,
--      and work unchanged on a restored blob.
--
-- category and heading deliberately do NOT live in here — they are existing columns (0018) and are
-- written directly, so they survive even on a database without this migration.
--
-- Additive + nullable. insertDloIntake never names the column, updateDloIntake writes it only when
-- the patch carries one, and the autosave is a SEPARATE route from create/extract/generate — so an
-- un-applied 0036 disables exactly one thing, durable review state, rather than breaking intake
-- (the 0028/0029/0030/0035 blast-radius principle). Apply before the API deploy anyway.
alter table public.dlo_intakes
  add column if not exists review_state jsonb;

comment on column public.dlo_intakes.review_state is
  'Officer review-step state: {v, edits, excluded, styleReference?, pointers?, designations?, writer, updatedAt}. Null = nothing saved yet.';
