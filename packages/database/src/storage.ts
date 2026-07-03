// Supabase Storage helpers for poster + scene PNGs (see the posters bucket in
// supabase/migrations/0002_generations.sql).
//
// The bucket is public and its URLs are CDN-cached, so object paths must be
// versioned per render (generations/{id}/poster-v{n}.png) and never overwritten.

import type { SupabaseClient } from '@supabase/supabase-js';

export const POSTERS_BUCKET = 'posters';

export async function uploadPng(
  client: SupabaseClient,
  path: string,
  png: Buffer,
): Promise<void> {
  const { error } = await client.storage
    .from(POSTERS_BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: false });
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
