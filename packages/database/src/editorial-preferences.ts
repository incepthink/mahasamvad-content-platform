// Learned editorial preferences (see supabase/migrations/0057_editorial_preferences.sql):
// the /dlo article lane's PROCEDURAL memory — how the department wants its articles written,
// learned from officer feedback rather than hand-written into a TypeScript constant.
//
// Three rules this module enforces rather than documents:
//   1. NOTHING IS DELETED ON SUPERSESSION. `supersedePreference` marks the old row
//      `superseded` and points `superseded_by` at its replacement. `deleteEditorialPreference`
//      exists for the review page's explicit "remove this" and for nothing else.
//   2. THE INJECTION READ IS THE ONLY HOT-PATH QUERY, and it is scoped and capped at the
//      database rather than in Node: `listActiveEditorialPreferences` selects `active` rows
//      whose scope matches the run's category or is `both`, ordered by reinforcement then
//      recency. Anything past the caller's limit stays stored and inert.
//   3. READS THROW, so the caller decides. The runner's read is best-effort and degrades to
//      "no preferences" — a database without 0057 must cost the learning, never the article
//      (the 0028 principle) — but that decision belongs at the seam, not hidden here.

import type { SupabaseClient } from '@supabase/supabase-js';

export const EDITORIAL_PREFERENCES_TABLE = 'editorial_preferences';

// Which article category a rule applies to. Mirrors EditorialPreferenceScope in
// @dgipr/schemas — duplicated rather than imported because @dgipr/database does not depend on
// @dgipr/schemas.
export type EditorialPreferenceScope = 'news' | 'scheme' | 'both';

// active  — injected into the next article.
// disabled — an officer turned it off; kept so it can be turned back on.
// superseded — replaced by a newer rule, which `supersededBy` names.
export type EditorialPreferenceStatus = 'active' | 'disabled' | 'superseded';

export type EditorialPreferenceSource = 'learned' | 'manual';

export type EditorialPreferenceRow = Readonly<{
  id: string;
  rule: string;
  scope: EditorialPreferenceScope;
  status: EditorialPreferenceStatus;
  source: EditorialPreferenceSource;
  reinforcementCount: number;
  // Provenance. Null on a hand-seeded rule, which had no feedback behind it.
  sourceFeedback: string | null;
  sourceGenerationId: string | null;
  supersededBy: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}>;

type PreferenceDbRow = {
  id: string;
  rule: string | null;
  scope: string | null;
  status: string | null;
  source: string | null;
  reinforcement_count: number | null;
  source_feedback: string | null;
  source_generation_id: string | null;
  superseded_by: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: PreferenceDbRow): EditorialPreferenceRow {
  return {
    id: row.id,
    rule: row.rule ?? '',
    // Cast rather than validate: the column is plain text precisely so a new scope is a code
    // change and not a migration, and an unknown value simply never matches a query below.
    scope: (row.scope ?? 'both') as EditorialPreferenceScope,
    status: (row.status ?? 'active') as EditorialPreferenceStatus,
    source: (row.source ?? 'learned') as EditorialPreferenceSource,
    reinforcementCount: row.reinforcement_count ?? 1,
    sourceFeedback: row.source_feedback ?? null,
    sourceGenerationId: row.source_generation_id ?? null,
    supersededBy: row.superseded_by ?? null,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PREFERENCE_COLUMNS =
  'id,rule,scope,status,source,reinforcement_count,source_feedback,' +
  'source_generation_id,superseded_by,last_seen_at,created_at,updated_at';

export type NewEditorialPreference = Readonly<{
  rule: string;
  scope?: EditorialPreferenceScope;
  status?: EditorialPreferenceStatus;
  source?: EditorialPreferenceSource;
  reinforcementCount?: number;
  sourceFeedback?: string | null;
  sourceGenerationId?: string | null;
}>;

export async function insertEditorialPreference(
  client: SupabaseClient,
  preference: NewEditorialPreference,
): Promise<EditorialPreferenceRow> {
  const { data, error } = await client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .insert({
      rule: preference.rule,
      scope: preference.scope ?? 'both',
      status: preference.status ?? 'active',
      source: preference.source ?? 'learned',
      reinforcement_count: Math.max(
        1,
        Math.round(preference.reinforcementCount ?? 1),
      ),
      // Written omit-unless-supplied, the newTermToDbRow rule: an explicit null is a legitimate
      // value ("this rule has no feedback behind it"), and omitting keeps the insert minimal.
      ...(preference.sourceFeedback !== undefined
        ? { source_feedback: preference.sourceFeedback }
        : {}),
      ...(preference.sourceGenerationId !== undefined
        ? { source_generation_id: preference.sourceGenerationId }
        : {}),
    })
    .select(PREFERENCE_COLUMNS)
    .single();
  if (error) {
    throw new Error(`Failed to insert editorial preference: ${error.message}`);
  }
  return fromDbRow(data as unknown as PreferenceDbRow);
}

// What a caller may change after creation. `rule` is editable on purpose — the review page's
// whole point is that an officer can sharpen a rule the extractor phrased badly — while
// `source`, the provenance fields and `createdAt` are not: they record what happened.
export type EditorialPreferencePatch = Partial<
  Pick<
    EditorialPreferenceRow,
    | 'rule'
    | 'scope'
    | 'status'
    | 'reinforcementCount'
    | 'supersededBy'
    | 'lastSeenAt'
  >
>;

export async function updateEditorialPreference(
  client: SupabaseClient,
  id: string,
  patch: EditorialPreferencePatch,
): Promise<EditorialPreferenceRow | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.rule !== undefined) row.rule = patch.rule;
  if (patch.scope !== undefined) row.scope = patch.scope;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.reinforcementCount !== undefined) {
    row.reinforcement_count = Math.max(1, Math.round(patch.reinforcementCount));
  }
  if (patch.supersededBy !== undefined) row.superseded_by = patch.supersededBy;
  if (patch.lastSeenAt !== undefined) row.last_seen_at = patch.lastSeenAt;
  const { data, error } = await client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .update(row)
    .eq('id', id)
    .select(PREFERENCE_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to update editorial preference ${id}: ${error.message}`,
    );
  }
  return data ? fromDbRow(data as unknown as PreferenceDbRow) : null;
}

export async function getEditorialPreference(
  client: SupabaseClient,
  id: string,
): Promise<EditorialPreferenceRow | null> {
  const { data, error } = await client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .select(PREFERENCE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to fetch editorial preference ${id}: ${error.message}`,
    );
  }
  return data ? fromDbRow(data as unknown as PreferenceDbRow) : null;
}

export type EditorialPreferenceFilters = Readonly<{
  status?: EditorialPreferenceStatus;
  scope?: EditorialPreferenceScope;
}>;

// The review page's listing: everything, newest first, optionally filtered. Deliberately NOT
// the injection query — that one is below, and keeping them separate is what stops a display
// filter silently changing what an article is written with.
export async function listEditorialPreferences(
  client: SupabaseClient,
  opts: EditorialPreferenceFilters &
    Readonly<{ limit?: number; offset?: number }> = {},
): Promise<EditorialPreferenceRow[]> {
  let query = client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .select(PREFERENCE_COLUMNS);
  if (opts.status !== undefined) query = query.eq('status', opts.status);
  if (opts.scope !== undefined) query = query.eq('scope', opts.scope);
  const ordered = query.order('created_at', { ascending: false });
  // Paged with `.range` rather than `.limit` when an offset is given — the glossary list's
  // shape, and the reason it matters is PostgREST's own: an unbounded select is silently
  // capped at 1000 rows, so a review page that grew past one screen without paging would
  // stop listing rules that are nonetheless steering every article.
  const limit = opts.limit ?? 200;
  const { data, error } =
    opts.offset !== undefined
      ? await ordered.range(opts.offset, opts.offset + limit - 1)
      : await ordered.limit(limit);
  if (error) {
    throw new Error(`Failed to list editorial preferences: ${error.message}`);
  }
  return (data ?? []).map((row) =>
    fromDbRow(row as unknown as PreferenceDbRow),
  );
}

/**
 * The rules a /dlo article is actually written with.
 *
 * `active` only, and `scope` either the run's own category or `both` — a scheme rule must not
 * reach a news article. Ordered `reinforcement_count desc, last_seen_at desc`, so when more
 * rules are active than `limit` allows, the ones the department has asked for most often and
 * most recently are the ones that reach the model. Nothing is deleted to make room; a rule
 * past the cap stays stored and inert until its reinforcement rises.
 *
 * THROWS on a read failure. The caller (runner.ts) catches and degrades to no preferences —
 * see this module's header on why that decision is the seam's and not this function's.
 */
export async function listActiveEditorialPreferences(
  client: SupabaseClient,
  scope: EditorialPreferenceScope,
  limit: number,
): Promise<EditorialPreferenceRow[]> {
  if (limit <= 0) return [];
  const { data, error } = await client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .select(PREFERENCE_COLUMNS)
    .eq('status', 'active')
    // `both` is not a category — it is "applies to every category", so it is always in the
    // pool. A caller asking for scope 'both' explicitly gets the always-applicable rules only.
    .in('scope', scope === 'both' ? ['both'] : [scope, 'both'])
    .order('reinforcement_count', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(
      `Failed to list active editorial preferences: ${error.message}`,
    );
  }
  return (data ?? []).map((row) =>
    fromDbRow(row as unknown as PreferenceDbRow),
  );
}

export async function countEditorialPreferences(
  client: SupabaseClient,
  opts: EditorialPreferenceFilters = {},
): Promise<number> {
  let query = client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .select('*', { count: 'exact', head: true });
  if (opts.status !== undefined) query = query.eq('status', opts.status);
  if (opts.scope !== undefined) query = query.eq('scope', opts.scope);
  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count editorial preferences: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Replaces one rule with another WITHOUT losing the first.
 *
 * The old row is marked `superseded` and pointed at its replacement; it is never deleted.
 * That is what makes a consolidation reversible and "why does the article write it this way?"
 * answerable months later. Phase 2's consolidation step is the caller this exists for; it is
 * here in Phase 1 so the table's insert-only doctrine is enforced by the module from the
 * start rather than added on top of code that had already learned to delete.
 */
export async function supersedeEditorialPreference(
  client: SupabaseClient,
  id: string,
  supersededBy: string,
): Promise<EditorialPreferenceRow | null> {
  return updateEditorialPreference(client, id, {
    status: 'superseded',
    supersededBy,
  });
}

// The review page's explicit "remove this". Supersession is the ordinary path — see above —
// so this is for a rule that should never have existed, not for one that was replaced.
export async function deleteEditorialPreference(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from(EDITORIAL_PREFERENCES_TABLE)
    .delete()
    .eq('id', id);
  if (error) {
    throw new Error(
      `Failed to delete editorial preference ${id}: ${error.message}`,
    );
  }
}
