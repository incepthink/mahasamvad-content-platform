import type { SupabaseClient } from '@supabase/supabase-js';

export const REFERENCE_IMAGES_TABLE = 'reference_images';

export type ReferenceCategory = 'twitter' | 'article';
// A reference_types slug (builtin or custom); the composite FK added in
// migration 0013 is the source of truth, so this stays a plain string.
export type ReferenceSubtype = string;

// The master's layout as read off its pixels (migration 0016). Mirrors
// ReferenceLayoutSpecSchema in @dgipr/schemas; kept structural here so this
// package stays dependency-free.
export type ReferenceLayoutSpec = Readonly<{
  hasPhotoZone: boolean;
  bulletSlots: number;
  layoutSummary: string;
}>;

export type ReferenceImageRow = Readonly<{
  id: string;
  category: ReferenceCategory;
  subtype: ReferenceSubtype;
  storagePath: string;
  isActive: boolean;
  // null = not analyzed yet; callers must fall back rather than assume a layout.
  layoutSpec: ReferenceLayoutSpec | null;
  createdAt: string;
  updatedAt: string;
}>;

type ReferenceImageDbRow = {
  id: string;
  category: ReferenceCategory;
  subtype: ReferenceSubtype;
  storage_path: string;
  is_active: boolean;
  layout_spec: ReferenceLayoutSpec | null;
  created_at: string;
  updated_at: string;
};

function fromDbRow(row: ReferenceImageDbRow): ReferenceImageRow {
  return {
    id: row.id,
    category: row.category,
    subtype: row.subtype,
    storagePath: row.storage_path,
    isActive: row.is_active,
    layoutSpec: row.layout_spec ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listReferenceImageRows(
  client: SupabaseClient,
): Promise<ReferenceImageRow[]> {
  const { data, error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .select()
    .order('category')
    .order('subtype')
    .order('created_at', { ascending: false });
  if (error)
    throw new Error(`Failed to list reference images: ${error.message}`);
  return ((data ?? []) as ReferenceImageDbRow[]).map(fromDbRow);
}

export async function getReferenceImageRow(
  client: SupabaseClient,
  id: string,
): Promise<ReferenceImageRow | null> {
  const { data, error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to get reference image ${id}: ${error.message}`);
  return data ? fromDbRow(data as ReferenceImageDbRow) : null;
}

export async function insertReferenceImageRow(
  client: SupabaseClient,
  input: Readonly<{
    category: ReferenceCategory;
    subtype: ReferenceSubtype;
    storagePath: string;
    isActive?: boolean;
    layoutSpec?: ReferenceLayoutSpec | null;
  }>,
): Promise<ReferenceImageRow> {
  const { data, error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .insert({
      category: input.category,
      subtype: input.subtype,
      storage_path: input.storagePath,
      is_active: input.isActive ?? false,
      layout_spec: input.layoutSpec ?? null,
    })
    .select()
    .single();
  if (error)
    throw new Error(`Failed to insert reference image: ${error.message}`);
  return fromDbRow(data as ReferenceImageDbRow);
}

// Caches the vision-derived layout (or an operator's correction of it). The spec
// is what the n8n image prompt branches on, so a wrong value here silently
// produces a wrong poster — /references exposes both a re-check and a manual flip.
export async function setReferenceImageLayoutSpec(
  client: SupabaseClient,
  id: string,
  layoutSpec: ReferenceLayoutSpec,
): Promise<ReferenceImageRow> {
  const { data, error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .update({ layout_spec: layoutSpec, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error)
    throw new Error(
      `Failed to update reference image layout ${id}: ${error.message}`,
    );
  return fromDbRow(data as ReferenceImageDbRow);
}

// Toggles whether the image is enabled in the rotation (many rows per
// (category, subtype) may be active at once; see migration 0013).
export async function setReferenceImageActive(
  client: SupabaseClient,
  id: string,
  isActive: boolean,
): Promise<ReferenceImageRow> {
  const { data, error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error)
    throw new Error(`Failed to update reference image ${id}: ${error.message}`);
  return fromDbRow(data as ReferenceImageDbRow);
}

export async function deleteReferenceImageRow(
  client: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client
    .from(REFERENCE_IMAGES_TABLE)
    .delete()
    .eq('id', id);
  if (error)
    throw new Error(`Failed to delete reference image ${id}: ${error.message}`);
}
