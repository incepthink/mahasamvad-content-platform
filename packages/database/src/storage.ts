// Supabase Storage helpers for poster + scene PNGs (see the posters bucket in
// supabase/migrations/0002_generations.sql).
//
// The bucket is public and its URLs are CDN-cached, so object paths must be
// versioned per render (generations/{id}/poster-v{n}.png) and never overwritten.

import type { SupabaseClient } from '@supabase/supabase-js';

export const POSTERS_BUCKET = 'posters';

// PRIVATE bucket for DLO intake source files (mp3/pdf/docx) — see migration
// 0018_dlo_intakes.sql. Service-role access only; nothing here gets a public URL.
export const DLO_UPLOADS_BUCKET = 'dlo-uploads';

// Generic variants of the PNG helpers below, for buckets/content types beyond
// poster PNGs (first user: DLO intake uploads). Same error contract.
export async function uploadFile(
  client: SupabaseClient,
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage
    .from(bucket)
    .upload(path, data, { contentType, upsert: false });
  if (error) {
    throw new Error(`Failed to upload ${bucket}/${path}: ${error.message}`);
  }
}

export async function downloadFile(
  client: SupabaseClient,
  bucket: string,
  path: string,
): Promise<Buffer> {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) {
    throw new Error(`Failed to download ${bucket}/${path}: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

// Versioned poster/scene paths must never be overwritten (public bucket is
// CDN-cached), so upsert defaults to false. Pass upsert: true only for stable,
// intentionally-overwritten objects like the brand templates under references/.
export async function uploadPng(
  client: SupabaseClient,
  path: string,
  png: Buffer,
  upsert = false,
): Promise<void> {
  const { error } = await client.storage
    .from(POSTERS_BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert });
  if (error) {
    throw new Error(`Failed to upload ${path}: ${error.message}`);
  }
}

export function publicUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(POSTERS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function downloadPng(
  client: SupabaseClient,
  path: string,
): Promise<Buffer> {
  const { data, error } = await client.storage
    .from(POSTERS_BUCKET)
    .download(path);
  if (error) {
    throw new Error(`Failed to download ${path}: ${error.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

// Removes library objects when a gallery image (or a whole custom type) is
// deleted. The legacy canonical references/master-*.png objects are inert seed
// data for seed-reference-library — leave them alone.
export async function removeObjects(
  client: SupabaseClient,
  paths: readonly string[],
): Promise<void> {
  const { error } = await client.storage
    .from(POSTERS_BUCKET)
    .remove([...paths]);
  if (error) {
    throw new Error(`Failed to remove ${paths.join(', ')}: ${error.message}`);
  }
}
