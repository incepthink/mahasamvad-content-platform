// Backfills reference_images.layout_spec (migration 0016) for masters uploaded
// before the vision pass existed. Until a row has a spec, the n8n social-post
// workflow falls back to assuming the master has a photo zone — which is exactly
// the bug this pipeline exists to fix — so run this once after applying 0016.
//
//   pnpm --filter @dgipr/content-engine analyze:references
//   pnpm --filter @dgipr/content-engine analyze:references -- --force     (re-analyze all)
//   pnpm --filter @dgipr/content-engine analyze:references -- --dry-run   (print, write nothing)
//
// --dry-run is worth reaching for first: hasPhotoZone is the field that decides
// whether a poster may contain photography at all, so it is worth reading the
// verdicts before they take effect.

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  downloadPng,
  listReferenceImageRows,
  setReferenceImageLayoutSpec,
} from '@dgipr/database';
import { analyzeReferenceTemplate } from '../references/analyze-template.js';

export async function analyzeReferenceLibrary(
  options: { force?: boolean; dryRun?: boolean } = {},
): Promise<void> {
  const { force = false, dryRun = false } = options;
  const client = createServiceRoleClient();
  const rows = await listReferenceImageRows(client);
  const targets =
    force || dryRun ? rows : rows.filter((row) => row.layoutSpec === null);

  if (targets.length === 0) {
    console.log(
      'Every reference image already has a layout spec. Nothing to do.',
    );
    return;
  }
  console.log(
    `Analyzing ${targets.length} of ${rows.length} reference images` +
      `${dryRun ? ' (dry run — nothing will be written)' : ''}...\n`,
  );

  let failed = 0;
  for (const row of targets) {
    const label = `${row.category}/${row.subtype} (${row.id})`;
    try {
      const png = await downloadPng(client, row.storagePath);
      const spec = await analyzeReferenceTemplate(png);
      if (!dryRun) {
        await setReferenceImageLayoutSpec(client, row.id, spec);
      }
      console.log(
        `${label}\n  photo zone: ${spec.hasPhotoZone ? 'YES' : 'no (text-only)'}` +
          `  |  body slots: ${spec.bulletSlots}\n  ${spec.layoutSummary}\n`,
      );
    } catch (error) {
      // One bad master must not abandon the rest of the backfill.
      failed += 1;
      console.error(`${label}: analysis failed —`, error);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} image(s) failed; re-run to retry just those.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  analyzeReferenceLibrary({
    force: process.argv.includes('--force'),
    dryRun: process.argv.includes('--dry-run'),
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
