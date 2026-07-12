// Business logic for the reference-type catalog (builtin + custom poster type
// slots). Custom types are twitter-only; the article category keeps its single
// fixed builtin type.

import { randomUUID } from 'node:crypto';
import {
  deleteReferenceImageRow,
  deleteReferenceTypeRow,
  getReferenceTypeRow,
  insertReferenceTypeRow,
  listReferenceImageRows,
  listReferenceTypeRows,
  removeObjects,
  updateReferenceTypeRow,
  type SupabaseClient,
} from '@dgipr/database';
import type {
  CreateReferenceTypeRequest,
  ReferenceType,
  UpdateReferenceTypeRequest,
} from '@dgipr/schemas';

export async function listReferenceTypes(
  client: SupabaseClient,
): Promise<ReferenceType[]> {
  return listReferenceTypeRows(client);
}

// Slugs are server-generated: labels are Devanagari, but slugs feed OpenAI
// json_schema enums and storage paths, so the charset stays ^[a-z0-9_]+$.
export async function createReferenceType(
  client: SupabaseClient,
  input: CreateReferenceTypeRequest,
): Promise<ReferenceType> {
  return insertReferenceTypeRow(client, {
    category: 'twitter',
    slug: `custom_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    labelMr: input.labelMr,
    description: input.description,
    copyStyle: 'generic',
    isBuiltin: false,
  });
}

// labelMr/description are editable on ALL types — editing a builtin's
// description deliberately tunes the classifier. slug/copyStyle are immutable.
export async function updateReferenceType(
  client: SupabaseClient,
  id: string,
  patch: UpdateReferenceTypeRequest,
): Promise<ReferenceType | null> {
  const type = await getReferenceTypeRow(client, id);
  if (!type) return null;
  return updateReferenceTypeRow(client, id, patch);
}

// Deleting a custom type takes its whole image library with it: image rows go
// first (the composite FK requires it), then their storage objects best-effort.
export async function deleteReferenceType(
  client: SupabaseClient,
  id: string,
): Promise<'deleted' | 'not_found' | 'builtin'> {
  const type = await getReferenceTypeRow(client, id);
  if (!type) return 'not_found';
  if (type.isBuiltin) return 'builtin';

  const images = (await listReferenceImageRows(client)).filter(
    (image) => image.category === type.category && image.subtype === type.slug,
  );
  for (const image of images) {
    await deleteReferenceImageRow(client, image.id);
  }
  if (images.length > 0) {
    try {
      await removeObjects(
        client,
        images.map((image) => image.storagePath),
      );
    } catch (error) {
      // Same trade-off as deleteReferenceImage: rows must go, orphaned storage
      // objects are safe and can be cleaned up separately.
      console.warn(
        `Failed to remove reference image objects for type ${type.slug}:`,
        error,
      );
    }
  }

  await deleteReferenceTypeRow(client, id);
  return 'deleted';
}
