// One-off: copy every object from the Supabase Storage buckets into their S3
// counterparts. Run this BEFORE pointing the API at S3.
//
//   pnpm --filter @dgipr/database storage:migrate -- --dry-run
//   pnpm --filter @dgipr/database storage:migrate
//   pnpm --filter @dgipr/database storage:migrate -- --bucket=videos
//
// It talks to Supabase Storage DIRECTLY rather than through storage.ts, because
// that module now resolves to S3 — it is the thing being migrated away from.
//
// IDEMPOTENT: every object is HEADed in S3 first and skipped if already there,
// so an interrupted run is resumed by re-running it. That matters — this pulls
// ~2 GB across the wire and the download side is metered by Supabase.
//
// It never deletes anything from Supabase. Verify the app against S3 first;
// emptying the old buckets is a separate, deliberate act.

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getS3Client, resolveBucket } from '../s3-client.js';

// Supabase's list() is paginated and NOT recursive; this is its page size.
const PAGE = 100;

type Plan = { readonly logical: string; readonly supabase: string };

// logical name (code) -> Supabase bucket name. They happen to match today, but
// the S3 side is resolved separately through resolveBucket().
const BUCKETS: readonly Plan[] = [
  { logical: 'posters', supabase: 'posters' },
  { logical: 'videos', supabase: 'videos' },
  { logical: 'dlo-uploads', supabase: 'dlo-uploads' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function supabaseClient(): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type RemoteObject = { readonly path: string; readonly contentType: string };

// Walks a bucket depth-first. Supabase models prefixes as pseudo-directories:
// an entry with a null `id` is a folder, anything else is an object.
async function listObjects(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<RemoteObject[]> {
  const found: RemoteObject[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset });
    if (error) {
      throw new Error(`Failed to list ${bucket}/${prefix}: ${error.message}`);
    }
    const page = data ?? [];
    if (page.length === 0) break;

    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        found.push(...(await listObjects(client, bucket, path)));
      } else {
        const mime =
          (entry.metadata?.['mimetype'] as string | undefined) ??
          'application/octet-stream';
        found.push({ path, contentType: mime });
      }
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return found;
}

async function existsInS3(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function migrateBucket(
  client: SupabaseClient,
  plan: Plan,
  dryRun: boolean,
): Promise<{ copied: number; skipped: number; bytes: number }> {
  const target = resolveBucket(plan.logical);
  process.stdout.write(`\n=== ${plan.supabase} -> ${target} ===\n`);

  const objects = await listObjects(client, plan.supabase, '');
  process.stdout.write(`  ${objects.length} object(s) found\n`);

  let copied = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [index, object] of objects.entries()) {
    const position = `[${index + 1}/${objects.length}]`;

    if (await existsInS3(target, object.path)) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      process.stdout.write(`  ${position} WOULD COPY ${object.path}\n`);
      copied += 1;
      continue;
    }

    const { data, error } = await client.storage
      .from(plan.supabase)
      .download(object.path);
    if (error || !data) {
      // One bad object must not sink a 2 GB migration — report and continue.
      process.stdout.write(
        `  ${position} FAILED ${object.path}: ${error?.message ?? 'no data'}\n`,
      );
      continue;
    }

    const body = Buffer.from(await data.arrayBuffer());
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: target,
        Key: object.path,
        Body: body,
        ContentType: object.contentType,
      }),
    );

    copied += 1;
    bytes += body.byteLength;
    process.stdout.write(
      `  ${position} copied ${object.path} (${mb(body.byteLength)})\n`,
    );
  }

  process.stdout.write(
    `  done: ${copied} copied, ${skipped} already present, ${mb(bytes)} transferred\n`,
  );
  return { copied, skipped, bytes };
}

// Emits `srcBucket <TAB> s3Bucket <TAB> key <TAB> urlEncodedKey <TAB>
// contentType` for every object, so the copy itself can be run somewhere with
// real bandwidth (the EC2 box in us-east-2) by a script that needs only curl
// and the AWS CLI. Listing is cheap; it was only the upload leg that was slow
// from a home connection.
async function listOnly(client: SupabaseClient, plans: readonly Plan[]) {
  for (const plan of plans) {
    const target = resolveBucket(plan.logical);
    for (const object of await listObjects(client, plan.supabase, '')) {
      const encoded = object.path.split('/').map(encodeURIComponent).join('/');
      process.stdout.write(
        `${plan.supabase}\t${target}\t${object.path}\t${encoded}\t${object.contentType}\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listMode = args.includes('--list-only');
  const only = args
    .find((arg) => arg.startsWith('--bucket='))
    ?.slice('--bucket='.length);

  const plans = only
    ? BUCKETS.filter((plan) => plan.logical === only)
    : BUCKETS;
  if (plans.length === 0) {
    throw new Error(
      `Unknown --bucket=${only}. Known: ${BUCKETS.map((b) => b.logical).join(', ')}.`,
    );
  }

  const client = supabaseClient();

  if (listMode) {
    await listOnly(client, plans);
    return;
  }

  if (dryRun) {
    process.stdout.write('DRY RUN — nothing will be written to S3.\n');
  }

  let copied = 0;
  let skipped = 0;
  let bytes = 0;

  for (const plan of plans) {
    const result = await migrateBucket(client, plan, dryRun);
    copied += result.copied;
    skipped += result.skipped;
    bytes += result.bytes;
  }

  process.stdout.write(
    `\nTOTAL: ${copied} copied, ${skipped} already present, ${mb(bytes)} transferred\n`,
  );
  process.stdout.write(
    'Nothing was deleted from Supabase. Verify the app against S3 before emptying it.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
