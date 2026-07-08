// Marathi->English glossary of proper nouns (see
// supabase/migrations/0007_glossary_terms.sql). Verified entries are locked into
// the English translation prompt so a known name is never mistranslated; unverified
// rows are auto-extracted candidates awaiting human review. Lookups are
// deterministic substring matches, not vector similarity.

import type { SupabaseClient } from '@supabase/supabase-js';

export const GLOSSARY_TERMS_TABLE = 'glossary_terms';

export type TermType =
  | 'person'
  | 'designation'
  | 'scheme'
  | 'place'
  | 'org'
  | 'other';

export type TermSource = 'auto' | 'manual' | 'seed';

// One row in glossary_terms.
export type GlossaryTerm = Readonly<{
  id: string;
  marathi: string;
  english: string;
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
  termType?: TermType;
  verified?: boolean;
  source?: TermSource;
  notes?: string | null;
}>;

// Shape returned by selects (snake_case column names).
type GlossaryDbRow = {
  id: string;
  marathi: string;
  english: string;
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
function newTermToDbRow(term: NewGlossaryTerm): Record<string, unknown> {
  return {
    marathi: term.marathi,
    english: term.english,
    term_type: term.termType ?? 'other',
    verified: term.verified ?? false,
    source: term.source ?? 'auto',
    notes: term.notes ?? null,
  };
}

// Fields a caller may change after creation (never id/marathi/created_at here —
// marathi is the conflict key, so changing it is a delete + re-insert concern).
export type GlossaryTermPatch = Partial<
  Pick<GlossaryTerm, 'english' | 'termType' | 'verified' | 'source' | 'notes'>
>;

function patchToDbRow(patch: GlossaryTermPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.english !== undefined) row.english = patch.english;
  if (patch.termType !== undefined) row.term_type = patch.termType;
  if (patch.verified !== undefined) row.verified = patch.verified;
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.notes !== undefined) row.notes = patch.notes;
  return row;
}

export async function listGlossaryTerms(
  client: SupabaseClient,
  opts: Readonly<{
    verifiedOnly?: boolean;
    type?: TermType;
    search?: string;
    limit?: number;
  }> = {},
): Promise<GlossaryTerm[]> {
  let query = client.from(GLOSSARY_TERMS_TABLE).select();
  if (opts.verifiedOnly) {
    query = query.eq('verified', true);
  }
  if (opts.type) {
    query = query.eq('term_type', opts.type);
  }
  if (opts.search) {
    // Match either side; escape LIKE wildcards in the user's search term.
    const escaped = opts.search.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`marathi.ilike.%${escaped}%,english.ilike.%${escaped}%`);
  }
  // Unverified first (needs review), most recently touched first within each group.
  const { data, error } = await query
    .order('verified', { ascending: true })
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) {
    throw new Error(`Failed to list glossary terms: ${error.message}`);
  }
  return ((data ?? []) as GlossaryDbRow[]).map(fromDbRow);
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
