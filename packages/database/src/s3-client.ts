// AWS S3 client + bucket configuration. This is the replacement for Supabase
// Storage; the helpers that use it live in storage.ts.
//
// THE PATHS DID NOT CHANGE. The database stores object paths, never URLs
// (generations/{id}/poster-v3.png), and those paths are used verbatim as S3
// keys — which is why this migration needed no SQL and no row rewrites. Keep it
// that way: an S3 key must stay byte-identical to what the row holds.
//
// The three logical buckets keep their Supabase names as CODE identifiers
// (POSTERS_BUCKET etc in storage.ts) because ~30 call sites pass them around.
// S3 bucket names are globally unique across all AWS accounts, so 'posters' is
// certainly taken by someone else — the real names are supplied by env and
// resolved here.

import { S3Client } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in (see repo README).',
    );
  }
  return value;
}

let cachedClient: S3Client | undefined;

// S3 Transfer Acceleration: uploads enter AWS at the nearest CloudFront edge and
// cross to the bucket's region over AWS's own backbone instead of the public
// internet. OFF by default, because the API runs on EC2 in us-east-2 beside the
// buckets, where it would buy nothing and cost $0.04/GB.
//
// Turn it on for a machine that is FAR from us-east-2 — i.e. local development
// from India, where a single TCP connection to the bucket is loss-limited to
// ~26 KiB/s. Measured 2026-08-10 on a 6.4 MB poster: 198 s and an intermittent
// ECONNRESET without it, 2.3 s with. That reset is not cosmetic — it fails the
// job AFTER gpt-image has been billed, throwing away a paid render.
//
// The buckets have Status=Enabled, which only ADDS the s3-accelerate endpoint;
// the normal one is untouched, so production is unaffected either way and this
// is a per-machine env choice rather than a deployment-wide one.
function useAccelerate(): boolean {
  return (process.env.S3_USE_ACCELERATE ?? '').trim().toLowerCase() === 'true';
}

// One client for the process. The SDK pools connections internally, and
// rebuilding it per call would drop that pool on every poster upload.
export function getS3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: requireEnv('AWS_REGION'),
      credentials: {
        accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      },
      useAccelerateEndpoint: useAccelerate(),
      // Both default to 0 = wait forever, which is how a stalled upload became a
      // job that sat there for minutes before failing. These BOUND the hang; they
      // do not slow a healthy upload down.
      //
      // requestTimeout is an IDLE timeout on the socket, not a total-duration cap
      // (it maps to ClientRequest.setTimeout), so a large video that keeps making
      // progress is never cut off — only a connection that has gone silent is.
      requestHandler: {
        connectionTimeout: 6_000,
        requestTimeout: 60_000,
      },
    });
  }
  return cachedClient;
}

// Test seam: drop the cached client so a changed env is picked up.
export function resetS3Client(): void {
  cachedClient = undefined;
}

// Logical bucket name (as used in code) -> the env var holding its real S3 name.
const BUCKET_ENV: Readonly<Record<string, string>> = {
  posters: 'S3_BUCKET_POSTERS',
  videos: 'S3_BUCKET_VIDEOS',
  'dlo-uploads': 'S3_BUCKET_DLO_UPLOADS',
};

export function resolveBucket(logical: string): string {
  const envName = BUCKET_ENV[logical];
  if (!envName) {
    throw new Error(
      `Unknown storage bucket '${logical}'. ` +
        `Known buckets: ${Object.keys(BUCKET_ENV).join(', ')}.`,
    );
  }
  return requireEnv(envName);
}

// Logical bucket -> the env var holding the CloudFront domain serving it.
//
// dlo-uploads is deliberately ABSENT, not empty: that bucket holds officers'
// meeting recordings and source documents and must never be publicly
// reachable. Asking it for a public URL is a bug, so it throws below rather
// than returning something that would 404 (or, worse, work).
const PUBLIC_BASE_ENV: Readonly<Record<string, string>> = {
  posters: 'CLOUDFRONT_POSTERS_URL',
  videos: 'CLOUDFRONT_VIDEOS_URL',
};

// Base URL for a PUBLIC bucket's objects.
//
// Falls back to the direct S3 endpoint when the CloudFront var is unset, so the
// stack works the moment the buckets exist and CloudFront can be switched on
// later by setting one env var — no code change, no redeploy of anything else.
// That fallback is for bring-up only; leaving it in place in production means
// paying S3 egress rates and serving Indian users from the bucket's region.
export function publicBaseUrl(logical: string): string {
  const envName = PUBLIC_BASE_ENV[logical];
  if (!envName) {
    throw new Error(
      `Bucket '${logical}' is private and has no public URL. ` +
        'Read it server-side with downloadFile instead.',
    );
  }
  const configured = process.env[envName];
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `https://${resolveBucket(logical)}.s3.${requireEnv('AWS_REGION')}.amazonaws.com`;
}

// Percent-encodes an object path for use in a URL while leaving the '/'
// separators intact. Supabase's getPublicUrl did this for us; S3 keys in this
// repo are ASCII (ids, versioned filenames) but reference-library uploads carry
// operator-supplied names, so encoding is not optional.
export function encodeObjectPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
