// Per-generation reference catalog: which poster types exist and which enabled
// library image each one uses for this run. The API sends this to the n8n
// workflows in the webhook payload, so the workflows stay data-driven (no
// hardcoded type lists or master URLs). Entries use snake_case keys because
// this IS the wire shape n8n receives.

import {
  findReferenceTypeRow,
  getReferenceImageRow,
  listReferenceImageRows,
  listReferenceTypeRows,
  publicUrl,
  type ReferenceImageRow,
  type SupabaseClient,
} from '@dgipr/database';
import type { ReferenceCategory } from '@dgipr/schemas';

// generations.error is shown raw in the UI, so this user-facing failure is Marathi.
const EMPTY_CATALOG_ERROR =
  'एकही संदर्भ टेम्पलेट चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर किमान एक चित्र सुरू करा.';

export type ReferenceCatalogEntry = Readonly<{
  slug: string;
  label: string;
  description: string;
  copy_style: string;
  reference_url: string;
}>;

export type PinnedReference = Readonly<{
  url: string;
  category: ReferenceCategory;
  subtype: string;
}>;

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function enabledImagesFor(
  images: readonly ReferenceImageRow[],
  category: ReferenceCategory,
  slug?: string,
): ReferenceImageRow[] {
  return images.filter(
    (image) =>
      image.category === category &&
      image.isActive &&
      (slug === undefined || image.subtype === slug),
  );
}

// One enabled image is picked at random per type; types with zero enabled
// images drop out of the catalog (the classifier then can't route to them).
// With a pin the catalog may be empty apart from the pinned type — the pinned
// entry is appended if its type was excluded, and classification is skipped
// anyway. Without a pin an entirely empty catalog fails the job loudly.
export async function buildTwitterCatalog(
  client: SupabaseClient,
  pinned?: PinnedReference,
): Promise<ReferenceCatalogEntry[]> {
  const [types, images] = await Promise.all([
    listReferenceTypeRows(client),
    listReferenceImageRows(client),
  ]);

  const entries: ReferenceCatalogEntry[] = [];
  for (const type of types) {
    if (type.category !== 'twitter') continue;
    const enabled = enabledImagesFor(images, 'twitter', type.slug);
    if (enabled.length === 0) continue;
    entries.push({
      slug: type.slug,
      label: type.labelMr,
      description: type.description,
      copy_style: type.copyStyle,
      reference_url: publicUrl(client, pickRandom(enabled).storagePath),
    });
  }

  if (pinned) {
    if (!entries.some((entry) => entry.slug === pinned.subtype)) {
      const type = await findReferenceTypeRow(
        client,
        'twitter',
        pinned.subtype,
      );
      if (!type) {
        // The composite FK makes this unreachable; fail loudly if it ever isn't.
        throw new Error(`Reference type twitter/${pinned.subtype} not found.`);
      }
      entries.push({
        slug: type.slug,
        label: type.labelMr,
        description: type.description,
        copy_style: type.copyStyle,
        reference_url: pinned.url,
      });
    }
    return entries;
  }

  if (entries.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  return entries;
}

// Random pick among the enabled article masters (same rotation semantics).
export async function pickArticleReferenceUrl(
  client: SupabaseClient,
): Promise<string> {
  const images = await listReferenceImageRows(client);
  const enabled = enabledImagesFor(images, 'article');
  if (enabled.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  return publicUrl(client, pickRandom(enabled).storagePath);
}

// A pinned image is honored even if it was disabled after pinning; only a
// deleted row returns null (callers fall back to the automatic rotation).
export async function resolvePinnedReference(
  client: SupabaseClient,
  id: string,
): Promise<PinnedReference | null> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return null;
  return {
    url: publicUrl(client, row.storagePath),
    category: row.category,
    subtype: row.subtype,
  };
}
