// Per-generation reference catalog: which poster types exist and which enabled
// library image each one uses for this run. The API sends this to the n8n
// workflows in the webhook payload, so the workflows stay data-driven (no
// hardcoded type lists or master URLs). Entries use snake_case keys because
// this IS the wire shape n8n receives.

import {
  findReferenceTypeRow,
  getReferenceImageRow,
  getReferenceTypeRow,
  listReferenceImageRows,
  listReferenceTypeRows,
  publicUrl,
  type ReferenceImageRow,
  type ReferenceLayoutSpec,
  type SupabaseClient,
} from '@dgipr/database';
import type { ReferenceCategory } from '@dgipr/schemas';

// generations.error is shown raw in the UI, so this user-facing failure is Marathi.
const EMPTY_CATALOG_ERROR =
  'एकही संदर्भ टेम्पलेट चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर किमान एक चित्र सुरू करा.';
const EMPTY_TYPE_ERROR = (label: string) =>
  `«${label}» प्रकारात एकही चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर किमान एक चित्र सुरू करा.`;

// snake_case: this IS the wire shape. layout_spec describes the exact image at
// reference_url (not the type), because two images of one type can have different
// structures — it is what stops the workflow painting a photo onto a text-only
// master. null = un-analyzed, and the workflow falls back to its old behaviour.
export type ReferenceCatalogEntry = Readonly<{
  slug: string;
  label: string;
  description: string;
  copy_style: string;
  reference_url: string;
  layout_spec: ReferenceLayoutSpec | null;
}>;

export type PinnedReference = Readonly<{
  url: string;
  category: ReferenceCategory;
  subtype: string;
  layoutSpec: ReferenceLayoutSpec | null;
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
    // The spec must describe the image we actually rolled, so pick once.
    const image = pickRandom(enabled);
    entries.push({
      slug: type.slug,
      label: type.labelMr,
      description: type.description,
      copy_style: type.copyStyle,
      reference_url: publicUrl(client, image.storagePath),
      layout_spec: image.layoutSpec,
    });
  }

  if (pinned) {
    // The pinned image — not the one this loop happened to roll for that type —
    // is what gets rendered (n8n prefers forced_reference_url). Its entry must
    // therefore carry the PINNED url and spec, or the workflow would branch on
    // the layout of a different image than the one it edits.
    const index = entries.findIndex((entry) => entry.slug === pinned.subtype);
    if (index >= 0) {
      const entry = entries[index] as ReferenceCatalogEntry;
      entries[index] = {
        ...entry,
        reference_url: pinned.url,
        layout_spec: pinned.layoutSpec,
      };
      return entries;
    }

    const type = await findReferenceTypeRow(client, 'twitter', pinned.subtype);
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
      layout_spec: pinned.layoutSpec,
    });
    return entries;
  }

  if (entries.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  return entries;
}

// Random pick among the enabled article masters (same rotation semantics).
// Returns the picked image's layoutSpec too so the article workflow can be told
// what THIS master actually looks like (null = un-analyzed, workflow falls back
// to its generic prompt) — same contract as the twitter catalog entries.
export async function pickArticleReference(
  client: SupabaseClient,
): Promise<Readonly<{ url: string; layoutSpec: ReferenceLayoutSpec | null }>> {
  const images = await listReferenceImageRows(client);
  const enabled = enabledImagesFor(images, 'article');
  if (enabled.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  const image = pickRandom(enabled);
  return { url: publicUrl(client, image.storagePath), layoutSpec: image.layoutSpec };
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
    layoutSpec: row.layoutSpec,
  };
}

// A pinned section forces the Twitter type but rolls one of its enabled images
// afresh at job start. Returning PinnedReference keeps every downstream caller
// and the n8n webhook contract identical to an exact-image pin.
export async function resolvePinnedTypeReference(
  client: SupabaseClient,
  typeId: string,
): Promise<PinnedReference | null> {
  const type = await getReferenceTypeRow(client, typeId);
  if (!type || type.category !== 'twitter') return null;

  const images = await listReferenceImageRows(client);
  const enabled = enabledImagesFor(images, 'twitter', type.slug);
  if (enabled.length === 0) throw new Error(EMPTY_TYPE_ERROR(type.labelMr));

  const image = pickRandom(enabled);
  return {
    url: publicUrl(client, image.storagePath),
    category: 'twitter',
    subtype: type.slug,
    layoutSpec: image.layoutSpec,
  };
}
