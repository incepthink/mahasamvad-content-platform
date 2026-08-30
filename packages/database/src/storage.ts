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
import { Upload } from '@aws-sdk/lib-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

// STREAMING UPLOAD — the only way a recording of unbounded length may reach storage.
//
// WHY THIS EXISTS. putObject above takes a whole Buffer, and every upload route used to
// build one with @fastify/multipart's `part.toBuffer()`. That holds the ENTIRE file in the
// API process — twice at the moment busboy's chunks are concatenated — and then holds it
// again for the length of the PutObject. A 240 MB meeting recording therefore cost ~500 MB
// of resident memory on a box that also runs n8n, PostgREST and Chromium, and the officer
// watching the progress bar was the one who paid for it: the container was OOM-killed
// mid-upload, the browser saw the connection reset, and the recording was simply lost
// (2026-08-30). Small files hid it perfectly, which is why it survived so long.
//
// S3's multipart upload is the fix: the bytes are forwarded to S3 in fixed-size parts as
// they arrive and are never all resident at once. Peak memory is
// S3_UPLOAD_PART_BYTES x S3_UPLOAD_CONCURRENCY — ~16 MiB by default — WHATEVER the file's
// length. That is what makes "no size limit" a promise the box can actually keep.
//
// The part size is also a floor on what a multipart upload can be: S3 requires every part
// except the last to be at least 5 MiB, and caps an upload at 10,000 parts. 8 MiB therefore
// covers files up to 80 GB, which is far past anything this product accepts.
//
// NO `IfNoneMatch` HERE, unlike putObject. That guard exists because the PUBLIC buckets are
// CDN-cached and a reused versioned path serves stale bytes; this function writes only to
// the PRIVATE upload bucket, under a key that already carries a fresh row id, so there is
// nothing to collide with and nothing cached. (S3's conditional write is also not available
// on CompleteMultipartUpload, so it could not be honoured here anyway.)
//
// Returns the number of bytes stored. Callers persist it on the file entry: it is what lets
// a transcription job know how much memory a recording will cost BEFORE downloading it.
const DEFAULT_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
const DEFAULT_UPLOAD_CONCURRENCY = 2;
// S3's own floor for every part but the last. A smaller configured value would be rejected
// by the service partway through a large upload rather than up front, so it is clamped.
const MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024;

export async function uploadStream(
  _client: SupabaseClient,
  logicalBucket: string,
  path: string,
  body: Readable,
  contentType: string,
): Promise<number> {
  const partSize = Math.max(
    MIN_UPLOAD_PART_BYTES,
    readPositiveInt('S3_UPLOAD_PART_BYTES', DEFAULT_UPLOAD_PART_BYTES),
  );
  const queueSize = readPositiveInt(
    'S3_UPLOAD_CONCURRENCY',
    DEFAULT_UPLOAD_CONCURRENCY,
  );

  // Counted as the bytes pass through rather than asked of S3 afterwards: a HEAD request
  // would be a second round trip for a number we are already holding in our hands.
  //
  // A TRANSFORM, deliberately, not a PassThrough with a `data` listener. Attaching a `data`
  // listener switches a stream into flowing mode, which would put this counter in a fight
  // with the SDK's own pull-based reading of the same stream over who consumes it and when.
  // Counting inside `transform` is invisible to that: it neither changes the flow mode nor
  // touches backpressure.
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });

  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket: resolveBucket(logicalBucket),
      Key: path,
      Body: counter,
      ContentType: contentType,
    },
    partSize,
    queueSize,
    // Abort the multipart upload if anything fails, so a dead browser cannot leave parts
    // behind that S3 would keep billing for. This is the default; stated because it is the
    // one option here whose absence would cost money silently.
    leavePartsOnError: false,
  });

  // Both halves have to be awaited together, and BOTH need a handler attached up front.
  // Promise.all rejects the moment either one does, leaving the other's later rejection with
  // nobody listening — and an unhandled rejection takes the whole API process down, which is
  // a far worse outcome than the failed upload that triggered it.
  const pumped = pipeline(body, counter);
  const finished = upload.done();
  pumped.catch(() => undefined);
  finished.catch(() => undefined);

  try {
    // `pipeline` is what propagates a source failure — a browser that vanished mid-upload —
    // into the transform, which fails `upload.done()` and triggers the abort above. Without
    // it a truncated object could be COMPLETED and stored as if it were the whole recording.
    await Promise.all([pumped, finished]);
  } catch (error) {
    // Destroy the transform so the pump settles too. If S3 failed first the SDK has stopped
    // reading, and without this `pipeline` would stall forever holding the request's stream
    // open — the upload would be reported as failed while the connection stayed pinned.
    counter.destroy();
    // Best-effort: the abort may itself fail (the network is already unhappy), and a stranded
    // multipart upload must not turn into a failed request the officer cannot read.
    await upload.abort().catch(() => undefined);
    throw new Error(
      `Failed to upload ${logicalBucket}/${path}: ${describe(error)}`,
    );
  }
  return bytes;
}

// THE CLIENT'S requestTimeout DOES NOT COVER THE RESPONSE BODY, and that gap is
// what turned a stalled download into a job that hung forever rather than
// failing. GetObject resolves as soon as the HEADERS arrive; the SDK then clears
// the socket timeout and hands back a stream the caller drains itself, so a
// connection that goes silent mid-body is awaited indefinitely with no timer
// armed on it. Observed 2026-08-23 on a video scene still: 1.12 MB read, then
// two hours of nothing on a live socket, with the animate job's promise never
// settling — which also pinned the id in video-runner's `running` set, so the
// orphan reaper on the detail route correctly refused to rescue the row and the
// officer's page spun forever.
//
// So the body gets the idle timeout the headers already had. Idle, not total:
// a large video clip on a slow link makes steady progress and must never be cut
// off — only a stream that has stopped delivering bytes is. Aborting through the
// AbortController rather than just destroying the stream is what tears down the
// underlying request, so the dead socket does not linger in the SDK's pool.
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

class StalledDownloadError extends Error {}

// Drain an S3 body, restarting the watchdog on every chunk that arrives.
//
// `expectedBytes` is GetObject's own ContentLength. With it the result is written into ONE
// buffer allocated up front; without it the chunks are concatenated at the end, which
// briefly holds the whole object TWICE. On a 240 MB meeting recording that difference is
// ~240 MB of peak memory in the transcription job, for a number the response already gave
// us. It is a hint, never a contract: a body that does not match the declared length falls
// back to the concat, so a wrong header can cost memory but can never truncate a recording.
async function readBodyWithIdleTimeout(
  body: AsyncIterable<Uint8Array>,
  idleMs: number,
  onStall: () => void,
  expectedBytes?: number,
): Promise<Buffer> {
  const preallocated =
    expectedBytes !== undefined && expectedBytes > 0
      ? Buffer.allocUnsafe(expectedBytes)
      : null;
  let filled = 0;
  let overflowed = false;
  const chunks: Uint8Array[] = [];
  let timer: NodeJS.Timeout | undefined;
  let stalled = false;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      onStall();
    }, idleMs);
  };
  // Once the declared length is exceeded, `chunks` holds the prefix written so far plus
  // every later chunk, so it alone is the total; before that the buffer's fill mark is.
  const readSoFar = (): number =>
    preallocated !== null && !overflowed
      ? filled
      : chunks.reduce((sum, c) => sum + c.byteLength, 0);
  try {
    arm();
    for await (const chunk of body) {
      if (preallocated !== null && !overflowed) {
        if (filled + chunk.byteLength <= preallocated.length) {
          preallocated.set(chunk, filled);
          filled += chunk.byteLength;
        } else {
          // The body is longer than ContentLength said. Keep what was written (as a view,
          // so nothing is copied) and finish the ordinary way rather than dropping bytes.
          overflowed = true;
          chunks.push(preallocated.subarray(0, filled), chunk);
        }
      } else {
        chunks.push(chunk);
      }
      arm();
    }
  } catch (error) {
    // The abort surfaces here as whatever the stream throws; report the real
    // cause so a stall is not filed under a generic network error.
    if (stalled) {
      throw new StalledDownloadError(
        `no data for ${Math.round(idleMs / 1000)}s after ${readSoFar()} bytes`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (stalled) {
    throw new StalledDownloadError(`no data for ${Math.round(idleMs / 1000)}s`);
  }
  if (preallocated !== null && !overflowed) {
    // A body SHORTER than its declared length is the other anomaly; hand back only what
    // actually arrived rather than a tail of uninitialised memory.
    return filled === preallocated.length
      ? preallocated
      : preallocated.subarray(0, filled);
  }
  return Buffer.concat(chunks);
}

async function getObject(
  logicalBucket: string,
  path: string,
  range?: Readonly<{ start: number; endInclusive: number }>,
): Promise<Buffer> {
  const idleMs = readPositiveInt(
    'S3_DOWNLOAD_IDLE_TIMEOUT_MS',
    DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  );
  const attempts = readPositiveInt(
    'S3_DOWNLOAD_ATTEMPTS',
    DEFAULT_DOWNLOAD_ATTEMPTS,
  );
  let lastError: unknown;
  // A download is free and a stall is transient, so retry it here rather than
  // failing a job the officer would have to restart by hand. Bounded, and only
  // a STALL retries — a real error (missing key, denied) is thrown at once.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    try {
      const response = await getS3Client().send(
        new GetObjectCommand({
          Bucket: resolveBucket(logicalBucket),
          Key: path,
          // S3 ranges are INCLUSIVE at both ends, unlike every slice() in this codebase.
          // GetObject then answers 206 with a ContentLength covering just the range, which
          // is what keeps the preallocation below sized to the part and not to the object.
          ...(range
            ? { Range: `bytes=${range.start}-${range.endInclusive}` }
            : {}),
        }),
        { abortSignal: controller.signal },
      );
      if (!response.Body) {
        throw new Error('empty response body');
      }
      return await readBodyWithIdleTimeout(
        response.Body as unknown as AsyncIterable<Uint8Array>,
        idleMs,
        () => controller.abort(),
        response.ContentLength,
      );
    } catch (error) {
      lastError = error;
      if (!(error instanceof StalledDownloadError) || attempt === attempts) {
        break;
      }
      console.warn(
        `[storage] download of ${logicalBucket}/${path} stalled ` +
          `(${error.message}); retrying (attempt ${attempt + 1}/${attempts})`,
      );
    }
  }
  throw new Error(
    `Failed to download ${logicalBucket}/${path}: ${describe(lastError)}`,
  );
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

// ONE SLICE of a stored object, so a caller can forward a large file somewhere else without
// ever holding it whole. Added for /chat's File Search uploads: OpenAI's Uploads API takes a
// 512 MB PDF in <=64 MB parts, and buffering the document to feed it would reintroduce the
// exact memory failure the 2026-08-30 streaming work removed from the recording paths.
//
// `end` is INCLUSIVE, matching S3's own range semantics rather than JavaScript's — converted
// once, here, instead of at every call site. A range reaching past the end of the object is
// not an error: S3 returns what exists, so the last part simply comes back short.
export async function downloadFileRange(
  _client: SupabaseClient,
  bucket: string,
  path: string,
  start: number,
  endInclusive: number,
): Promise<Buffer> {
  if (!Number.isInteger(start) || start < 0 || endInclusive < start) {
    throw new Error(
      `Invalid range for ${bucket}/${path}: ${start}-${endInclusive}.`,
    );
  }
  return getObject(bucket, path, { start, endInclusive });
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
//
// Bucket-scoped variant below; this one keeps its exact signature so the ~4 reference-library
// callers are untouched.
export async function removeObjects(
  _client: SupabaseClient,
  paths: readonly string[],
): Promise<void> {
  return removeObjectsIn(_client, POSTERS_BUCKET, paths);
}

// The same, for any bucket. Added for the upload routes: when a multipart request fails
// partway (a rejected file type, a browser that vanished), the recordings already streamed
// to the private bucket belong to a row that will never exist, and nothing else would ever
// look at them again.
export async function removeObjectsIn(
  _client: SupabaseClient,
  logicalBucket: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length === 0) return;
  const bucket = resolveBucket(logicalBucket);
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
