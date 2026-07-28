// Marathi->English glossary of proper nouns (see
// supabase/migrations/0007_glossary_terms.sql). Verified entries are locked into
// the English translation prompt so a known name is never mistranslated; unverified
// rows are auto-extracted candidates awaiting human review. Lookups are
// deterministic substring matches, not vector similarity.

import type { SupabaseClient } from '@supabase/supabase-js';

export const GLOSSARY_TERMS_TABLE = 'glossary_terms';

export type TermType =
  'person' | 'designation' | 'scheme' | 'place' | 'org' | 'other';

export type TermSource = 'auto' | 'manual' | 'seed';

// One row in glossary_terms.
export type GlossaryTerm = Readonly<{
  id: string;
  marathi: string;
  english: string;
  // Optional corrected Hindi spelling. Null = the Hindi translation locks the name
  // to its Marathi form (the default; see translate-article.ts).
  hindi: string | null;
  // Marathi designation (पदनाम) to print before this person's name on first mention
  // (migration 0032). Person rows only; null = print the name bare. The designation's own
  // English/Hindi live on ITS row in this table, not here — see designations.ts.
  designation: string | null;
  termType: TermType;
  verified: boolean;
  source: TermSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}>;

// Input for creating a term. Only marathi/english are required; the rest fall back
// to the column defaults (term_type 'other', verified false, source 'auto').
export type NewGlossaryTerm = Readonly<{
  marathi: string;
  english: string;
  hindi?: string | null;
  designation?: string | null;
  termType?: TermType;
  verified?: boolean;
  source?: TermSource;
  notes?: string | null;
}>;

// Shape returned by selects (snake_case column names). `designation` is optional on the
// type because a database without 0032 simply does not return the column.
type GlossaryDbRow = {
  id: string;
  marathi: string;
  english: string;
  hindi: string | null;
  designation?: string | null;
  term_type: TermType;
  verified: boolean;
  source: TermSource;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: GlossaryDbRow): GlossaryTerm {
  return {
    id: row.id,
    marathi: row.marathi,
    english: row.english,
    hindi: row.hindi,
    designation: row.designation ?? null,
    termType: row.term_type,
    verified: row.verified,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Maps a NewGlossaryTerm to an insertable db row, applying the same defaults the
// column definitions use so upserts are explicit and predictable.
//
// `designation` is the one field written ONLY when the caller supplied it: on a database
// without 0032 an explicit `designation: null` would fail every insert, whereas omitting it
// costs nothing (the 0028/0029/0030 blast-radius principle). Passing `null` explicitly is
// still honoured — that is how the /glossary form clears a designation.
function newTermToDbRow(term: NewGlossaryTerm): Record<string, unknown> {
  return {
    marathi: term.marathi,
    english: term.english,
    hindi: term.hindi ?? null,
    ...(term.designation !== undefined
      ? { designation: term.designation }
      : {}),
    term_type: term.termType ?? 'other',
    verified: term.verified ?? false,
    source: term.source ?? 'auto',
    notes: term.notes ?? null,
  };
}

// Fields a caller may change after creation (never id/marathi/created_at here —
// marathi is the conflict key, so changing it is a delete + re-insert concern).
export type GlossaryTermPatch = Partial<
  Pick<
    GlossaryTerm,
    | 'english'
    | 'hindi'
    | 'designation'
    | 'termType'
    | 'verified'
    | 'source'
    | 'notes'
  >
>;

function patchToDbRow(patch: GlossaryTermPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.english !== undefined) row.english = patch.english;
  if (patch.hindi !== undefined) row.hindi = patch.hindi;
  if (patch.designation !== undefined) row.designation = patch.designation;
  if (patch.termType !== undefined) row.term_type = patch.termType;
  if (patch.verified !== undefined) row.verified = patch.verified;
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.notes !== undefined) row.notes = patch.notes;
  return row;
}

type GlossaryFilters = Readonly<{
  verifiedOnly?: boolean;
  verified?: boolean;
  type?: TermType;
  search?: string;
}>;

// Keep list/count filtering in one place so the total always describes the rows
// the corresponding list query can return.
function applyGlossaryFilters<
  Q extends {
    eq(column: string, value: unknown): Q;
    or(filter: string): Q;
  },
>(query: Q, opts: GlossaryFilters): Q {
  if (opts.verifiedOnly) {
    query = query.eq('verified', true);
  }
  if (opts.verified !== undefined) {
    query = query.eq('verified', opts.verified);
  }
  if (opts.type) {
    query = query.eq('term_type', opts.type);
  }
  if (opts.search) {
    // Match any script; escape LIKE wildcards in the user's search term.
    const escaped = opts.search.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(
      `marathi.ilike.%${escaped}%,english.ilike.%${escaped}%,hindi.ilike.%${escaped}%`,
    );
  }
  return query;
}

export async function listGlossaryTerms(
  client: SupabaseClient,
  opts: GlossaryFilters &
    Readonly<{
      limit?: number;
      offset?: number;
    }> = {},
): Promise<GlossaryTerm[]> {
  const baseQuery = client.from(GLOSSARY_TERMS_TABLE).select();
  const query = applyGlossaryFilters(baseQuery, opts);
  // Unverified first (needs review), most recently touched first within each group.
  const ordered = query
    .order('verified', { ascending: true })
    .order('updated_at', { ascending: false });
  const limit = opts.limit ?? 200;
  const { data, error } =
    opts.offset !== undefined
      ? await ordered.range(opts.offset, opts.offset + limit - 1)
      : await ordered.limit(limit);
  if (error) {
    throw new Error(`Failed to list glossary terms: ${error.message}`);
  }
  return ((data ?? []) as GlossaryDbRow[]).map(fromDbRow);
}

export async function countGlossaryTerms(
  client: SupabaseClient,
  opts: GlossaryFilters = {},
): Promise<number> {
  const baseQuery = client
    .from(GLOSSARY_TERMS_TABLE)
    .select('*', { count: 'exact', head: true });
  const query = applyGlossaryFilters(baseQuery, opts);
  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count glossary terms: ${error.message}`);
  }
  return count ?? 0;
}

// Returns the glossary terms whose Marathi form appears verbatim in `text`, sorted
// by Marathi length descending so longer, more-specific terms win when they overlap
// (e.g. a full name before a bare first name). Defaults to verified terms only —
// only human-confirmed mappings should be locked into a translation. The verified
// set is small, so we fetch it and filter in JS rather than query per term.
export async function findGlossaryTermsInText(
  client: SupabaseClient,
  text: string,
  opts: Readonly<{ verifiedOnly?: boolean }> = {},
): Promise<GlossaryTerm[]> {
  const verifiedOnly = opts.verifiedOnly ?? true;
  const terms = await listGlossaryTerms(
    client,
    verifiedOnly ? { verifiedOnly: true, limit: 5000 } : { limit: 5000 },
  );
  return terms
    .filter((t) => text.includes(t.marathi))
    .sort((a, b) => b.marathi.length - a.marathi.length);
}

// The designation → person map, built from the person rows that carry one (0032).
//
// `glossary_terms.designation` has only ever been read in one direction: given a person's name
// found in the text, print their title. But a meeting transcript often names the OFFICE and not
// the person — "मुख्यमंत्री" with the name lost to STT — and the dictionary already knows,
// verified, that मुख्यमंत्री is देवेंद्र फडणवीस. Nobody had written the query, so that answer sat
// unused while the article fell back to agentless prose.
//
// Verified person rows only: this feeds a SUGGESTION an officer confirms, and an unverified
// auto-extracted row is not a good enough basis even for that.
//
// Titles are returned with EVERY holder, never pre-resolved to one, because ambiguity is the
// whole risk: Maharashtra has two उपमुख्यमंत्री, and office-holders change. Deciding what to do
// when a title maps to several people is the caller's job — see prepareDesignations, which
// proposes nothing at all in that case.
export async function mapDesignationsToPersons(
  client: SupabaseClient,
): Promise<Map<string, string[]>> {
  const rows = await listGlossaryTerms(client, {
    type: 'person',
    verifiedOnly: true,
    limit: 5000,
  });

  const byDesignation = new Map<string, string[]>();
  for (const row of rows) {
    const designation = (row.designation ?? '').trim();
    const name = row.marathi.trim();
    if (!designation || !name) continue;
    const holders = byDesignation.get(designation);
    if (holders) {
      if (!holders.includes(name)) holders.push(name);
    } else {
      byDesignation.set(designation, [name]);
    }
  }
  return byDesignation;
}

// Bulk-inserts auto-extracted candidates, skipping any Marathi term that already
// exists. ignoreDuplicates ensures an existing (possibly verified / human-edited)
// row is never clobbered by an auto candidate.
export async function insertGlossaryCandidates(
  client: SupabaseClient,
  terms: readonly NewGlossaryTerm[],
): Promise<void> {
  if (terms.length === 0) return;
  const rows = terms.map(newTermToDbRow);
  const { error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .upsert(rows, { onConflict: 'marathi', ignoreDuplicates: true });
  if (error) {
    throw new Error(`Failed to insert glossary candidates: ${error.message}`);
  }
}

// Remembers "this person is named with this designation" without disturbing anything else on
// their row. Used by the pre-generation name check when the officer ticks "यापुढेही हेच वापरा".
//
// Deliberately NOT upsertGlossaryTerm: that is a create-or-REPLACE and would overwrite a
// human-reviewed English/Hindi spelling with whatever this caller happens to be holding. So an
// existing row is patched in place (designation only), and only a person the dictionary has
// never seen is inserted — as an UNVERIFIED row carrying the extractor's proposed English,
// because the officer confirmed the पदनाम, not the English spelling. The pre-translation name
// check still asks for that separately, which is exactly the intended division of labour.
//
// Pass `designation: null` to clear it back to "print this name bare".
export async function setPersonDesignation(
  client: SupabaseClient,
  marathi: string,
  designation: string | null,
  fallbackEnglish: string,
): Promise<void> {
  const { data, error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .update({ designation, updated_at: new Date().toISOString() })
    .eq('marathi', marathi)
    .select('id');
  if (error) {
    throw new Error(
      `Failed to set designation for "${marathi}": ${error.message}`,
    );
  }
  if ((data ?? []).length > 0) return;

  await insertGlossaryCandidates(client, [
    {
      marathi,
      english: fallbackEnglish,
      designation,
      termType: 'person',
      verified: false,
      source: 'auto',
    },
  ]);
}

// Marks a person's row verified, disturbing nothing else on it. Used by the pre-generation
// "व्यक्ती व पदनाम" card's per-row "तपासले म्हणून खूण करा".
//
// Same shape and same reasoning as setPersonDesignation: an existing row is patched in place
// (never upsertGlossaryTerm, which is create-or-REPLACE and would overwrite a human-reviewed
// English/Hindi spelling), and only a person the dictionary has never seen is inserted. That
// insert is VERIFIED, because ticking the box IS the human review this flag records — the
// difference from setPersonDesignation, where the officer had confirmed the पदनाम rather than
// the name.
export async function markPersonVerified(
  client: SupabaseClient,
  marathi: string,
  fallbackEnglish: string,
): Promise<void> {
  const { data, error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .update({ verified: true, updated_at: new Date().toISOString() })
    .eq('marathi', marathi)
    .select('id');
  if (error) {
    throw new Error(`Failed to verify "${marathi}": ${error.message}`);
  }
  if ((data ?? []).length > 0) return;

  await insertGlossaryCandidates(client, [
    {
      marathi,
      english: fallbackEnglish,
      termType: 'person',
      verified: true,
      source: 'manual',
    },
  ]);
}

// Manual create-or-replace by Marathi key: overwrites english/type/verified/source/
// notes for an existing term (unlike insertGlossaryCandidates, which skips it).
// Used when a human adds/replaces a term directly.
export async function upsertGlossaryTerm(
  client: SupabaseClient,
  term: NewGlossaryTerm,
): Promise<GlossaryTerm> {
  const row = { ...newTermToDbRow(term), updated_at: new Date().toISOString() };
  const { data, error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .upsert(row, { onConflict: 'marathi' })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to upsert glossary term: ${error.message}`);
  }
  return fromDbRow(data as GlossaryDbRow);
}

export async function updateGlossaryTerm(
  client: SupabaseClient,
  id: string,
  patch: GlossaryTermPatch,
): Promise<GlossaryTerm> {
  const row = patchToDbRow(patch);
  row.updated_at = new Date().toISOString();
  const { data, error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to update glossary term ${id}: ${error.message}`);
  }
  return fromDbRow(data as GlossaryDbRow);
}

export async function deleteGlossaryTerm(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from(GLOSSARY_TERMS_TABLE)
    .delete()
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to delete glossary term ${id}: ${error.message}`);
  }
}
