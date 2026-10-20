// Let browsers PUT recordings straight into the private uploads bucket.
//
//   pnpm --filter @dgipr/database storage:apply-upload-cors [--dry-run] [--origins=a,b]
//
// /transcribe uploads with a presigned PUT (storage.ts → signedUploadUrl). The signature is
// what authorises the upload; CORS only decides whether a BROWSER is allowed to send it from
// the web origin at all. Without this rule every direct upload fails its preflight and the web
// falls back to the ordinary multipart upload — nothing breaks, it is just not faster.
//
// The origins come from CORS_ORIGIN (the same list the API answers — cors-origins.ts) unless
// --origins is given. S3 accepts one `*` per origin, which is exactly the shape the Vercel
// preview patterns there already have.
//
// PutBucketCors REPLACES the whole configuration, so this reads the existing one first and
// swaps only the rule it owns (ID `dgipr-browser-upload`), leaving any other rule untouched.
//
// Needs `s3:GetBucketCORS` and `s3:PutBucketCORS` — the API's own IAM user may not have them;
// run it with an admin profile's keys in that case.

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3ServiceException,
  type CORSRule,
} from '@aws-sdk/client-s3';

import { getS3Client, resolveBucket } from '../s3-client.js';
import { DLO_UPLOADS_BUCKET } from '../storage.js';

const RULE_ID = 'dgipr-browser-upload';

function originsFromArgs(): string[] {
  const raw =
    process.argv
      .find((arg) => arg.startsWith('--origins='))
      ?.slice('--origins='.length) ??
    process.env.CORS_ORIGIN ??
    'http://localhost:3000,http://127.0.0.1:3000';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const bucket = resolveBucket(DLO_UPLOADS_BUCKET);
  const origins = originsFromArgs();
  const invalid = origins.filter((origin) => origin.split('*').length > 2);
  if (invalid.length > 0) {
    throw new Error(
      `S3 allows at most one '*' per origin; fix these: ${invalid.join(', ')}`,
    );
  }

  let existing: CORSRule[] = [];
  try {
    const current = await getS3Client().send(
      new GetBucketCorsCommand({ Bucket: bucket }),
    );
    existing = current.CORSRules ?? [];
  } catch (error) {
    // No configuration yet is the normal first run.
    if (
      !(error instanceof S3ServiceException) ||
      error.name !== 'NoSuchCORSConfiguration'
    ) {
      throw error;
    }
  }

  const rule: CORSRule = {
    ID: RULE_ID,
    AllowedMethods: ['PUT'],
    AllowedOrigins: origins,
    AllowedHeaders: ['content-type'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3000,
  };
  const rules = [...existing.filter((entry) => entry.ID !== RULE_ID), rule];

  console.log(`bucket: ${bucket}`);
  console.log(JSON.stringify(rules, null, 2));
  if (dryRun) {
    console.log('--dry-run: nothing written.');
    return;
  }
  await getS3Client().send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules },
    }),
  );
  console.log('CORS rule applied.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
