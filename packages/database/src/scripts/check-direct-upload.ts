// Does a BROWSER-style direct upload work against this deployment's bucket?
//
//   pnpm --filter @dgipr/database storage:check-direct-upload [--mb=2] [--origin=https://…]
//
// /transcribe uploads recordings with a presigned PUT straight into the private bucket
// (storage.ts → signedUploadUrl). Three things have to be true for that to work, and each fails
// differently, so this checks them one by one:
//
//   1. The signed URL is accepted: a PUT with the signed Content-Type and the declared size
//      lands, and storedObjectSize reads it back at exactly that size. (Also proves the
//      accelerate endpoint is enabled, when S3_BROWSER_UPLOAD_ACCELERATE is on.)
//   2. A body of a DIFFERENT size is refused — the URL is a capability for one object of one
//      size, not an open door into the bucket.
//   3. The bucket's CORS rule answers a browser preflight for the given --origin. Without it
//      every browser PUT fails and the web silently falls back to the multipart upload — the
//      product still works, just without the speed-up. Fix with storage:apply-upload-cors.
//
// Writes one throwaway object under `checks/` and deletes it.

import { randomUUID } from 'node:crypto';

import {
  DLO_UPLOADS_BUCKET,
  removeObjectsIn,
  signedUploadUrl,
  storedObjectSize,
} from '../storage.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const client = null as unknown as SupabaseClient;

function arg(name: string): string | undefined {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  return raw?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const mb = Number(arg('mb') ?? '2');
  const size = Math.max(
    1,
    Math.round((Number.isFinite(mb) ? mb : 2) * 1024 * 1024),
  );
  const origin = arg('origin') ?? 'http://localhost:3000';
  const path = `checks/direct-upload-${randomUUID()}.webm`;
  const contentType = 'audio/webm';
  const body = new Uint8Array(size).map((_, index) => index % 251);
  const results: Array<[string, boolean, string]> = [];

  const url = await signedUploadUrl(
    DLO_UPLOADS_BUCKET,
    path,
    contentType,
    size,
  );
  console.log(`endpoint: ${new URL(url).host}`);

  try {
    // 2. Wrong size first, so a successful (1) cannot be mistaken for it.
    const short = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: body.subarray(0, size - 1),
    });
    results.push([
      'a body of a different size is refused',
      !short.ok,
      `HTTP ${short.status}`,
    ]);

    // 1. The real upload.
    const started = Date.now();
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body,
    });
    const seconds = (Date.now() - started) / 1000;
    results.push([
      'signed PUT is accepted',
      put.ok,
      `HTTP ${put.status} in ${seconds.toFixed(1)}s ` +
        `(${(size / 1024 / 1024 / Math.max(seconds, 0.001)).toFixed(2)} MiB/s)` +
        (put.ok ? '' : ` — ${(await put.text()).slice(0, 300)}`),
    ]);
    const stored = await storedObjectSize(DLO_UPLOADS_BUCKET, path);
    results.push([
      'stored object has the declared size',
      stored === size,
      `stored ${stored ?? 'nothing'}, expected ${size}`,
    ]);

    // 3. The preflight a browser sends before that PUT.
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    const allowed = preflight.headers.get('access-control-allow-origin');
    results.push([
      `bucket CORS allows PUT from ${origin}`,
      preflight.ok && (allowed === origin || allowed === '*'),
      `HTTP ${preflight.status}, allow-origin: ${allowed ?? 'none'}`,
    ]);
  } finally {
    await removeObjectsIn(client, DLO_UPLOADS_BUCKET, [path]).catch(
      () => undefined,
    );
  }

  for (const [label, ok, detail] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  }
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

void main();
