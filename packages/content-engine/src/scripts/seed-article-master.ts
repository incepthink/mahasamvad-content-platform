// One-time (idempotent) seed: upload the article-poster master template to
// Supabase Storage so the n8n `article-poster-v1-api` workflow can fetch it over
// HTTPS (host-independent, exactly like the 5 Twitter brand masters seeded by
// upload-references.ts).
//
// The master is a committed image asset (assets/master-article.jpeg) carrying the
// article theme — महासंवाद frame, cream left panel with a maroon Marathi headline,
// full-bleed documentary photo, department footer strip. We only normalise it to
// PNG at the workflow's edit size (1536x1024, gpt-image-2's nearest landscape) and
// upload it under the same `references/` prefix with upsert: true so re-runs are
// safe. Prints the public URL to paste into the workflow's "Read Master Template"
// node.
//
//   pnpm --filter @dgipr/content-engine upload:article-master

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  createServiceRoleClient,
  uploadPng,
  publicUrl,
} from '@dgipr/database';

// gpt-image-2 has no 16:9 size; 1536x1024 (3:2) is the nearest landscape and the
// size the edit workflow requests, so the edit base matches the output (no crop —
// fit: 'fill' preserves every layout element; a small aspect stretch is accepted
// per the plan's locked decision).
const MASTER_WIDTH = 1536;
const MASTER_HEIGHT = 1024;
const OBJECT_PATH = 'references/master-article.png';

export async function uploadArticleMaster(): Promise<string> {
  const client = createServiceRoleClient();
  const sourcePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'assets/master-article.jpeg',
  );

  const source = await readFile(sourcePath);
  const png = await sharp(source)
    .resize(MASTER_WIDTH, MASTER_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();

  await uploadPng(client, OBJECT_PATH, png, true);
  return publicUrl(client, OBJECT_PATH);
}

// Run directly:
//   pnpm --filter @dgipr/content-engine upload:article-master
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  uploadArticleMaster()
    .then((url) => {
      console.log('Uploaded article master template to posters/references/:');
      console.log(`  ${url}`);
      console.log(
        '\nPaste this URL into the article-poster-v1-api workflow\'s "Read Master Template" node.',
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
