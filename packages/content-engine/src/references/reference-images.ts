import { randomUUID } from 'node:crypto';
import {
  deleteReferenceImageRow,
  getReferenceImageRow,
  insertReferenceImageRow,
  listReferenceImageRows,
  publicUrl,
  removeObjects,
  setReferenceImageActive,
  uploadPng,
  type ReferenceImageRow,
  type SupabaseClient,
} from '@dgipr/database';
import type { ReferenceCategory, ReferenceImage } from '@dgipr/schemas';
import sharp from 'sharp';

export const MASTER_DIMENSIONS: Record<
  ReferenceCategory,
  Readonly<{ width: number; height: number }>
> = {
  // Matches the gpt-image-2 edit size in social-post-v2-api.
  twitter: { width: 1280, height: 1600 },
  // Matches the gpt-image-2 edit size in article-poster-v1-api.
  article: { width: 1536, height: 1024 },
};

export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

// Library objects are immutable and versioned; their public URLs are what the
// API sends to the n8n workflows in each generation's payload.
function newLibraryPath(category: ReferenceCategory, subtype: string): string {
  return `references/library/${category}/${subtype}/${Date.now()}-${randomUUID().slice(0, 8)}.png`;
}

export async function normalizeReferenceImage(
  input: Buffer,
  category: ReferenceCategory,
): Promise<Buffer> {
  const { width, height } = MASTER_DIMENSIONS[category];
  return sharp(input).resize(width, height, { fit: 'fill' }).png().toBuffer();
}

function withUrl(
  client: SupabaseClient,
  row: ReferenceImageRow,
): ReferenceImage {
  return { ...row, url: publicUrl(client, row.storagePath) };
}

export async function listReferenceLibrary(
  client: SupabaseClient,
): Promise<ReferenceImage[]> {
  const rows = await listReferenceImageRows(client);
  return rows.map((row) => withUrl(client, row));
}

// The subtype must be an existing reference_types slug — the route validates it
// against the catalog before calling this (the DB FK is the final guard).
export async function uploadReferenceImage(
  client: SupabaseClient,
  category: ReferenceCategory,
  subtype: string,
  file: Buffer,
): Promise<ReferenceImage> {
  const png = await normalizeReferenceImage(file, category);
  const storagePath = newLibraryPath(category, subtype);
  await uploadPng(client, storagePath, png);
  const row = await insertReferenceImageRow(client, {
    category,
    subtype,
    storagePath,
  });
  return withUrl(client, row);
}

// Toggles whether the image participates in the per-generation random rotation.
// Many images per type may be enabled at once; no canonical copy is involved.
export async function setReferenceImageEnabled(
  client: SupabaseClient,
  id: string,
  enabled: boolean,
): Promise<ReferenceImage | null> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return null;
  const updated = await setReferenceImageActive(client, id, enabled);
  return withUrl(client, updated);
}

// Enabled images are deletable too: a type that loses its last enabled image
// simply drops out of the catalog until another image is enabled.
export async function deleteReferenceImage(
  client: SupabaseClient,
  id: string,
): Promise<'deleted' | 'not_found'> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return 'not_found';

  await deleteReferenceImageRow(client, id);
  try {
    await removeObjects(client, [row.storagePath]);
  } catch (error) {
    // The DB row must not point at a missing object. A storage orphan is safe and
    // can be cleaned up separately if this best-effort removal fails.
    console.warn(
      `Failed to remove reference image object ${row.storagePath}:`,
      error,
    );
  }
  return 'deleted';
}
