-- 5W1H (कोण/काय/केव्हा/कुठे/का/कसे) extracted from the note before drafting, as a
-- fact-grounding + inverted-pyramid scaffold. Derived output (not user-supplied),
-- so it is nullable with no default: existing rows and pre-feature runs stay null.
-- Stored as jsonb like the `copy` column; the database package keeps it typed as
-- `unknown` and callers validate with FiveWOneHSchema. See the plan in
-- .claude/plans and AGENTS.md — values come only from the note, never invented.

alter table generations
  add column if not exists five_w_one_h jsonb;
