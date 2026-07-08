// One-time (idempotent) seed: upload the 5 brand master templates to Supabase
// Storage so the n8n social-post workflow can fetch them over HTTPS instead of
// reading local disk (which doesn't exist on a self-hosted AWS n8n).
//
// Reuses the existing public `posters` bucket under a `references/` prefix, so no
// new bucket or migration is needed. Objects are uploaded with upsert: true so
// this can be re-run safely. Prints the public URLs to paste into the workflow's
// HTTP Request node.
//
//   pnpm --filter @dgipr/content-engine upload:references

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  uploadPng,
  publicUrl,
} from '@dgipr/database';

// post_type → filename stem is 1:1; these are the design_mode: onbrand/adaptive
// templates the workflow paints on top of (fresh mode uses no template).
export const REFERENCE_TYPES = [
  'alert',
  'campaign',
  'info_bullets',
  'quote',
  'timeline',
] as const;

export async function uploadReferences(): Promise<string[]> {
  const client = createServiceRoleClient();
  const referenceDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data/reference',
  );

  const urls: string[] = [];
  for (const type of REFERENCE_TYPES) {
    const fileName = `master-${type}.png`;
    const png = await readFile(resolve(referenceDir, fileName));
    const objectPath = `references/${fileName}`;
    await uploadPng(client, objectPath, png, true);
    urls.push(publicUrl(client, objectPath));
  }
  return urls;
}

// Run directly:
//   pnpm --filter @dgipr/content-engine upload:references
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  uploadReferences()
    .then((urls) => {
      console.log(`Uploaded ${urls.length} brand templates to posters/references/:`);
      for (const url of urls) console.log(`  ${url}`);
      const base = urls[0]?.replace(/master-alert\.png$/, '') ?? '';
      console.log(`\nBase URL for the n8n HTTP Request node:\n  ${base}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
