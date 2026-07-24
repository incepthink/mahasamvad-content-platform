// Reference-template resolution for the social + article render paths.
//
// The classify/copy/prompt steps now run in the API (content-engine), not in n8n, so this
// module no longer builds an n8n wire catalog. Instead it surfaces, for a brand, the poster
// types and their ENABLED master images, so the runner can:
//   1. classify the note against the type descriptions (classify-poster-type.ts),
//   2. pick the best-fit master within the chosen type (select-master.ts),
//   3. build the copy + image prompt from that master's real layout_spec.
//
// pickRandom is gone: master selection is content-aware and seeded (see select-master.ts).
// Pins short-circuit classification exactly as before — an exact-image pin fixes the master,
// a type pin forces the type and rolls one of its enabled images by seed.

import {
  getReferenceImageRow,
  getReferenceTypeRow,
  listReferenceImageRows,
  listReferenceTypeRows,
  publicUrl,
  type ReferenceImageRow,
  type ReferenceTypeRow,
  type SupabaseClient,
  type TemplateBrand,
} from '@dgipr/database';
import { selectMaster, type MasterNeed, type SelectedMaster } from './select-master.js';

export type { MasterNeed, SelectedMaster };

// generations.error is shown raw in the UI, so these user-facing failures are Marathi.
const EMPTY_CATALOG_ERROR =
  'एकही संदर्भ टेम्पलेट चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर किमान एक चित्र सुरू करा.';
const EMPTY_TYPE_ERROR = (label: string) =>
  `«${label}» प्रकारात एकही चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर किमान एक चित्र सुरू करा.`;
const EMPTY_CMO_ERROR =
  'CMO विभागाचे एकही टेम्पलेट चित्र वापरात नाही. कृपया "मास्टर टेम्पलेट" पानावर CMO प्रकारात किमान एक चित्र सुरू करा.';

// A social poster type and its enabled master images. The classifier routes by `slug` +
// `description`; the copy step reads `copyStyle` + `description`; `images` is the pool the
// master selector picks from.
export type SocialTypeInfo = Readonly<{
  slug: string;
  label: string;
  description: string;
  copyStyle: string;
  brand: TemplateBrand;
  images: ReferenceImageRow[];
}>;

// The type context of a resolved master (for the copy step), without its image pool.
export type ResolvedType = Readonly<{
  slug: string;
  label: string;
  description: string;
  copyStyle: string;
  brand: TemplateBrand;
}>;

function typeContext(type: ReferenceTypeRow): ResolvedType {
  return {
    slug: type.slug,
    label: type.labelMr,
    description: type.description,
    copyStyle: type.copyStyle,
    brand: type.brand,
  };
}

function enabledImagesFor(
  images: readonly ReferenceImageRow[],
  slug: string,
): ReferenceImageRow[] {
  return images.filter(
    (image) => image.category === 'twitter' && image.isActive && image.subtype === slug,
  );
}

// Every social (twitter/facebook) type of `brand` that has at least one enabled image, with
// its image pool. The DGIPR build is the classifier pool and MUST exclude CMO types so an
// ordinary run never routes into a CMO template; the 'cmo' build includes only CMO types.
export async function listSocialTypes(
  client: SupabaseClient,
  brand: TemplateBrand = 'dgipr',
): Promise<SocialTypeInfo[]> {
  const [types, images] = await Promise.all([
    listReferenceTypeRows(client),
    listReferenceImageRows(client),
  ]);

  const out: SocialTypeInfo[] = [];
  for (const type of types) {
    if (type.category !== 'twitter' || type.brand !== brand) continue;
    const enabled = enabledImagesFor(images, type.slug);
    if (enabled.length === 0) continue;
    out.push({ ...typeContext(type), images: enabled });
  }
  if (out.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  return out;
}

// The resolution of a run's reference: which type it is, and which master to edit. `forced`
// is true when a pin (image or type) or the CMO brand fixed the type, so classification is
// skipped. `title` is set only on a classified run (the classifier's working title).
export type ResolvedReference = Readonly<{
  type: ResolvedType;
  master: SelectedMaster;
  forced: boolean;
  title?: string | undefined;
}>;

// A pinned EXACT image: honored even if it was disabled after pinning (only a deleted row is
// missing). Classification is skipped and this exact master is used. The pinned image may
// still be un-analysed, so route it through selectMaster (over a one-image pool) to get the
// analyse-on-demand + spec persistence for free.
export async function resolvePinnedImage(
  client: SupabaseClient,
  imageId: string,
  seed: string,
): Promise<ResolvedReference | null> {
  const image = await getReferenceImageRow(client, imageId);
  if (!image) return null;
  const types = await listReferenceTypeRows(client);
  const type = types.find(
    (t) => t.category === image.category && t.slug === image.subtype,
  );
  if (!type) return null;
  const master = await selectMaster(client, [image], undefined, seed);
  return { type: typeContext(type), master, forced: true };
}

// A pinned TYPE: forces the type, then picks one of its enabled images. With `note` the pick is
// content-aware (best subject/tone fit); without it, seeded rotation. No classification either way.
export async function resolvePinnedType(
  client: SupabaseClient,
  typeId: string,
  seed: string,
  note?: string,
): Promise<ResolvedReference | null> {
  const type = await getReferenceTypeRow(client, typeId);
  if (!type || type.category !== 'twitter') return null;
  const images = await listReferenceImageRows(client);
  const enabled = enabledImagesFor(images, type.slug);
  if (enabled.length === 0) throw new Error(EMPTY_TYPE_ERROR(type.labelMr));
  const master = await selectMaster(client, enabled, undefined, seed, note);
  return { type: typeContext(type), master, forced: true };
}

// A CMO run has no classifier — the brand IS the choice. Pick one enabled master across every
// CMO-brand type (content-aware when `note` is given, else seeded), then resolve that master's
// own type for the copy step.
export async function resolveCmoReference(
  client: SupabaseClient,
  seed: string,
  note?: string,
): Promise<ResolvedReference> {
  const [types, images] = await Promise.all([
    listReferenceTypeRows(client),
    listReferenceImageRows(client),
  ]);
  const cmoTypes = types.filter((t) => t.category === 'twitter' && t.brand === 'cmo');
  const cmoSlugs = new Set(cmoTypes.map((t) => t.slug));
  const enabled = images.filter(
    (image) =>
      image.category === 'twitter' && image.isActive && cmoSlugs.has(image.subtype),
  );
  if (enabled.length === 0) throw new Error(EMPTY_CMO_ERROR);
  const master = await selectMaster(client, enabled, undefined, seed, note);

  const pickedImage = enabled.find((img) => img.id === master.id) as ReferenceImageRow;
  const type = cmoTypes.find((t) => t.slug === pickedImage.subtype) as ReferenceTypeRow;
  return { type: typeContext(type), master, forced: true };
}

// The article path (news/scheme posters). There is no classification step here, so there is no
// structural `need`; with `content` (the finished article prose, which is what the poster
// depicts) the pick is content-aware over the enabled article masters, else seeded rotation.
export async function pickArticleReference(
  client: SupabaseClient,
  seed: string,
  content?: string,
): Promise<SelectedMaster> {
  const images = await listReferenceImageRows(client);
  const enabled = images.filter(
    (image) => image.category === 'article' && image.isActive,
  );
  if (enabled.length === 0) throw new Error(EMPTY_CATALOG_ERROR);
  return selectMaster(client, enabled, undefined, seed, content);
}

// Small helper kept for callers that only need a master's public URL.
export function masterUrl(client: SupabaseClient, storagePath: string): string {
  return publicUrl(client, storagePath);
}
