// Does a streaming (multipart) upload actually work against THIS deployment's bucket?
//
//   pnpm --filter @dgipr/database storage:check-upload [--mb=24]
//
// Worth having as its own check because a multipart upload is not the same S3 operation as
// a PutObject: it needs CreateMultipartUpload, UploadPart, CompleteMultipartUpload and
// AbortMultipartUpload, and an IAM policy or bucket policy that grants only `s3:PutObject`
// will pass every existing upload in the product and fail every recording. That failure
// would otherwise surface as "the officer's meeting recording did not upload", in production,
// which is the exact thing streaming was introduced to stop happening.
//
// It writes a throwaway object under `checks/`, verifies the bytes came back identical, and
// deletes it. Costs a few fractions of a cent of transfer and leaves nothing behind.

import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  DLO_UPLOADS_BUCKET,
  downloadFile,
  removeObjectsIn,
  uploadStream,
} from '../storage.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Every storage helper still takes the Supabase client it no longer uses (see storage.ts).
const client = null as unknown as SupabaseClient;

function sizeArg(): number {
  const raw = process.argv.find((arg) => arg.startsWith('--mb='));
  const value = raw ? Number(raw.slice('--mb='.length)) : NaN;
  // 24 MiB by default: with the 8 MiB part size that is three parts, so the multipart path
  // is genuinely exercised rather than collapsing to a single PutObject.
  return Number.isFinite(value) && value > 0 ? value : 24;
}

// A source that produces the requested size WITHOUT ever holding it — the whole point of the
// thing being tested. Deterministic content so the round trip can be checked by hash.
function syntheticSource(totalBytes: number): {
  stream: Readable;
  hash: Promise<string>;
} {
  const CHUNK = 64 * 1024;
  const block = Buffer.alloc(CHUNK);
  for (let i = 0; i < CHUNK; i++) block[i] = i % 251;
  const digest = createHash('sha256');
  let sent = 0;
  const stream = new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      const size = Math.min(CHUNK, totalBytes - sent);
      const chunk = size === CHUNK ? block : block.subarray(0, size);
      digest.update(chunk);
      sent += size;
      this.push(chunk);
    },
  });
  const hash = new Promise<string>((resolve, reject) => {
    stream.on('end', () => resolve(digest.digest('hex')));
    stream.on('error', reject);
  });
  return { stream, hash };
}

async function main(): Promise<void> {
  const megabytes = sizeArg();
  const totalBytes = Math.round(megabytes * 1024 * 1024);
  const path = `checks/upload-stream-${Date.now()}.bin`;
  const { stream, hash } = syntheticSource(totalBytes);

  console.log(
    `uploading ${megabytes} MiB to ${DLO_UPLOADS_BUCKET}/${path} as a stream…`,
  );
  const started = Date.now();
  const before = process.memoryUsage().rss;
  const written = await uploadStream(
    client,
    DLO_UPLOADS_BUCKET,
    path,
    stream,
    'application/octet-stream',
  );
  const seconds = (Date.now() - started) / 1000;
  const peak = process.memoryUsage().rss;
  const expected = await hash;

  const failures: string[] = [];
  if (written !== totalBytes) {
    failures.push(`reported ${written} bytes, expected ${totalBytes}`);
  }

  console.log(`uploaded in ${seconds.toFixed(1)}s; verifying…`);
  const round = await downloadFile(client, DLO_UPLOADS_BUCKET, path);
  if (round.byteLength !== totalBytes) {
    failures.push(
      `downloaded ${round.byteLength} bytes, expected ${totalBytes}`,
    );
  }
  const actual = createHash('sha256').update(round).digest('hex');
  if (actual !== expected) failures.push('the round trip changed the bytes');

  await removeObjectsIn(client, DLO_UPLOADS_BUCKET, [path]);
  console.log(`cleaned up ${path}`);

  // Informational, not asserted: RSS moves for reasons that have nothing to do with this
  // upload, and a threshold here would fail for the wrong reasons on a busy machine. It is
  // printed because the whole point of the change is that this number does NOT track the
  // file's size — a run at --mb=24 and one at --mb=240 should look about the same.
  console.log(
    `rss ${(before / 1024 / 1024).toFixed(0)} MiB → ` +
      `${(peak / 1024 / 1024).toFixed(0)} MiB during a ${megabytes} MiB upload`,
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('ok   streaming multipart upload works against this bucket');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
