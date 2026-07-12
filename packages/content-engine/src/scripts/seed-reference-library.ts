// Seeds the reference-image library for a fresh environment: every builtin
// reference type that has no library images yet gets one, copied from the legacy
// canonical references/master-<slug>.png storage object. Those canonical objects
// are inert seed data — nothing reads them at runtime any more (the n8n
// workflows receive immutable library URLs in each generation's payload) — but
// they stay in storage so this script can bootstrap new environments.

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  downloadPng,
  insertReferenceImageRow,
  listReferenceImageRows,
  listReferenceTypeRows,
  uploadPng,
} from '@dgipr/database';

export async function seedReferenceLibrary(): Promise<void> {
  const client = createServiceRoleClient();

  const builtins = (await listReferenceTypeRows(client)).filter(
    (type) => type.isBuiltin,
  );
  const images = await listReferenceImageRows(client);

  for (const type of builtins) {
    const existing = images.filter(
      (image) =>
        image.category === type.category && image.subtype === type.slug,
    );
    if (existing.length > 0) {
      console.log(
        `Skipping ${type.category}/${type.slug}: library images exist.`,
      );
      continue;
    }

    let seed: Buffer;
    try {
      seed = await downloadPng(client, `references/master-${type.slug}.png`);
    } catch {
      console.warn(
        `No canonical seed object for ${type.category}/${type.slug}; skipping.`,
      );
      continue;
    }

    const storagePath = `references/library/${type.category}/${type.slug}/${Date.now()}-seed.png`;
    await uploadPng(client, storagePath, seed);
    await insertReferenceImageRow(client, {
      category: type.category,
      subtype: type.slug,
      storagePath,
      isActive: true,
    });
    console.log(
      `Seeded ${type.category}/${type.slug} from its canonical master.`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  seedReferenceLibrary().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
