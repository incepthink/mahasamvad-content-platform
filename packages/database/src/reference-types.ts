// Row helpers for the reference_types catalog (builtin + custom poster type
// slots; see supabase/migrations/0013_reference_types.sql). Mirrors the
// reference-images.ts style: thin CRUD, camelCase rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceCategory } from './reference-images.js';

export const REFERENCE_TYPES_TABLE = 'reference_types';

export type CopyStyle =
  'alert' | 'campaign' | 'info_bullets' | 'quote' | 'timeline' | 'generic';

export type ReferenceTypeRow = Readonly<{
  id: string;
  category: ReferenceCategory;
  slug: string;
  labelMr: string;
  description: string;
  copyStyle: CopyStyle;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}>;

type ReferenceTypeDbRow = {
  id: string;
  category: ReferenceCategory;
  slug: string;
  label_mr: string;
  description: string;
  copy_style: CopyStyle;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: ReferenceTypeDbRow): ReferenceTypeRow {
  return {
    id: row.id,
    category: row.category,
    slug: row.slug,
    labelMr: row.label_mr,
    description: row.description,
    copyStyle: row.copy_style,
    isBuiltin: row.is_builtin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listReferenceTypeRows(
  client: SupabaseClient,
): Promise<ReferenceTypeRow[]> {
  const { data, error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .select()
    .order('category')
    // Builtins first, then customs in creation order — a stable, meaningful order
    // for both the catalog payload and the UI.
    .order('is_builtin', { ascending: false })
    .order('created_at', { ascending: true });
  if (error)
    throw new Error(`Failed to list reference types: ${error.message}`);
  return ((data ?? []) as ReferenceTypeDbRow[]).map(fromDbRow);
}

export async function getReferenceTypeRow(
  client: SupabaseClient,
  id: string,
): Promise<ReferenceTypeRow | null> {
  const { data, error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to get reference type ${id}: ${error.message}`);
  return data ? fromDbRow(data as ReferenceTypeDbRow) : null;
}

export async function findReferenceTypeRow(
  client: SupabaseClient,
  category: ReferenceCategory,
  slug: string,
): Promise<ReferenceTypeRow | null> {
  const { data, error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .select()
    .eq('category', category)
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to find reference type ${category}/${slug}: ${error.message}`,
    );
  }
  return data ? fromDbRow(data as ReferenceTypeDbRow) : null;
}

export async function insertReferenceTypeRow(
  client: SupabaseClient,
  input: Readonly<{
    category: ReferenceCategory;
    slug: string;
    labelMr: string;
    description: string;
    copyStyle: CopyStyle;
    isBuiltin: boolean;
  }>,
): Promise<ReferenceTypeRow> {
  const { data, error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .insert({
      category: input.category,
      slug: input.slug,
      label_mr: input.labelMr,
      description: input.description,
      copy_style: input.copyStyle,
      is_builtin: input.isBuiltin,
    })
    .select()
    .single();
  if (error)
    throw new Error(`Failed to insert reference type: ${error.message}`);
  return fromDbRow(data as ReferenceTypeDbRow);
}

export type ReferenceTypePatch = Readonly<{
  labelMr?: string | undefined;
  description?: string | undefined;
}>;

export async function updateReferenceTypeRow(
  client: SupabaseClient,
  id: string,
  patch: ReferenceTypePatch,
): Promise<ReferenceTypeRow> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.labelMr !== undefined) row.label_mr = patch.labelMr;
  if (patch.description !== undefined) row.description = patch.description;
  const { data, error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error)
    throw new Error(`Failed to update reference type ${id}: ${error.message}`);
  return fromDbRow(data as ReferenceTypeDbRow);
}

export async function deleteReferenceTypeRow(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from(REFERENCE_TYPES_TABLE)
    .delete()
    .eq('id', id);
  if (error)
    throw new Error(`Failed to delete reference type ${id}: ${error.message}`);
}
