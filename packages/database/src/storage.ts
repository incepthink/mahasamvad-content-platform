// Object storage helpers for poster + scene PNGs, video assets and DLO intake
// uploads. Backed by AWS S3 (see s3-client.ts); this was Supabase Storage until
// the 2026-08-09 migration.
//
// The public buckets are served through CloudFront and object paths are
// versioned per render (generations/{id}/poster-v{n}.png), so a path must never
// be reused — a CDN that has cached v3 will keep serving the old bytes. That
// rule is enforced structurally by uploadPng's `upsert` flag, see below.
//
// EVERY FUNCTION HERE KEEPS ITS SUPABASE-ERA SIGNATURE, including the leading
// `client` argument, which S3 does not need. That is deliberate: it kept the
// migration to this one file instead of the ~30 call sites in runner.ts,
// video-runner.ts, routes/generations.ts, routes/video.ts and references/*.
// Dropping the dead argument is a separate, mechanical commit.

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  encodeObjectPath,
  getS3Client,
  publicBaseUrl,
  resolveBucket,
} from './s3-client.js';

export const POSTERS_BUCKET = 'posters';

// PRIVATE bucket for DLO intake source files (mp3/pdf/docx) — see migration
// 0018_dlo_intakes.sql. Server-side access only; nothing here gets a public URL.
export const DLO_UPLOADS_BUCKET = 'dlo-uploads';

// PUBLIC bucket for explainer-video assets (stills/clips/final MP4s/SRTs) — see
// migration 0026_video_projects.sql. Same CDN rule as posters: versioned paths,
// never reused.
export const VIDEOS_BUCKET = 'videos';

// S3 has no atomic create-if-absent flag, but it does honour a conditional
// write: If-None-Match: * fails with 412 when the key already exists. That is
// what reproduces Supabase's `upsert: false`, and it matters — silently
// overwriting a CDN-cached poster path is the exact failure the versioning
// scheme exists to prevent.
function isPreconditionFailed(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'PreconditionFailed' ||
      error.$metadata.httpStatusCode === 412)
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function putObject(
  logicalBucket: string,
  path: string,
  data: Buffer,
  contentType: string,
  upsert: boolean,
): Promise<void> {
  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: resolveBucket(logicalBucket),
        Key: path,
        Body: data,
        ContentType: contentType,
        ...(upsert ? {} : { IfNoneMatch: '*' }),
      }),
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw new Error(
        `Failed to upload ${logicalBucket}/${path}: object already exists. ` +
          'Versioned storage paths must never be overwritten (the CDN caches them).',
      );
    }
    throw new Error(
      `Failed to upload ${logicalBucket}/${path}: ${describe(error)}`,
    );
  }
}

async function getObject(logicalBucket: string, path: string): Promise<Buffer> {
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: resolveBucket(logicalBucket),
        Key: path,
      }),
    );
    if (!response.Body) {
      throw new Error('empty response body');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  } catch (error) {
    throw new Error(
      `Failed to download ${logicalBucket}/${path}: ${describe(error)}`,
    );
  }
}

// Generic variants of the PNG helpers below, for buckets/content types beyond
// poster PNGs (first user: DLO intake uploads). Same error contract.
export async function uploadFile(
  _client: SupabaseClient,
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  await putObject(bucket, path, data, contentType, false);
}

export async function downloadFile(
  _client: SupabaseClient,
  bucket: string,
  path: string,
): Promise<Buffer> {
  return getObject(bucket, path);
}

// Versioned poster/scene paths must never be overwritten (public bucket is
// CDN-cached), so upsert defaults to false. Pass upsert: true only for stable,
// intentionally-overwritten objects like the brand templates under references/.
export async function uploadPng(
  _client: SupabaseClient,
  path: string,
  png: Buffer,
  upsert = false,
): Promise<void> {
  await putObject(POSTERS_BUCKET, path, png, 'image/png', upsert);
}

// Synchronous string building, exactly as the Supabase helper was. Keep it that
// way: this is called inline inside route response objects and inside .map()s
// over scenes, and it is handed to n8n in webhook payloads. Presigned URLs
// would make it async (rippling through ~20 call sites) and give it an expiry
// that would break n8n's fetch of the reference masters.
export function publicUrl(_client: SupabaseClient, path: string): string {
  return `${publicBaseUrl(POSTERS_BUCKET)}/${encodeObjectPath(path)}`;
}

// Generic variant for public buckets beyond posters (first user: videos).
export function publicUrlIn(
  _client: SupabaseClient,
  bucket: string,
  path: string,
): string {
  return `${publicBaseUrl(bucket)}/${encodeObjectPath(path)}`;
}

export async function downloadPng(
  _client: SupabaseClient,
  path: string,
): Promise<Buffer> {
  return getObject(POSTERS_BUCKET, path);
}

// S3 caps DeleteObjects at 1000 keys per request, where Supabase's remove()
// took an unbounded array — so chunk it. Reachable in practice: deleting a
// whole custom reference type removes every master under it.
const DELETE_BATCH = 1000;

// Removes library objects when a gallery image (or a whole custom type) is
// deleted. The legacy canonical references/master-*.png objects are inert seed
// data for seed-reference-library — leave them alone.
export async function removeObjects(
  _client: SupabaseClient,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  const bucket = resolveBucket(POSTERS_BUCKET);
  for (let i = 0; i < paths.length; i += DELETE_BATCH) {
    const batch = paths.slice(i, i + DELETE_BATCH);
    try {
      const response = await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      // DeleteObjects reports per-key failures in the body rather than throwing,
      // so an unchecked call can drop objects and still look successful.
      const failed = response.Errors ?? [];
      if (failed.length > 0) {
        const detail = failed
          .map((entry) => `${entry.Key ?? '?'} (${entry.Message ?? '?'})`)
          .join(', ');
        throw new Error(detail);
      }
    } catch (error) {
      throw new Error(
        `Failed to remove ${batch.join(', ')}: ${describe(error)}`,
      );
    }
  }
}
