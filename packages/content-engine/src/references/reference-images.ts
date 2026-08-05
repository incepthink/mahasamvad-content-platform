import { randomUUID } from 'node:crypto';
import {
  deleteReferenceImageRow,
  downloadPng,
  getReferenceImageRow,
  insertReferenceImageRow,
  listReferenceImageRows,
  publicUrl,
  removeObjects,
  setReferenceImageActive,
  setReferenceImageLayoutSpec,
  uploadPng,
  type ReferenceImageRow,
  type SupabaseClient,
} from '@dgipr/database';
import {
  REFERENCE_BAND_SLOTS,
  type ReferenceCategory,
  type ReferenceImage,
  type ReferenceLayoutSpec,
  type ReferenceShapeBand,
} from '@dgipr/schemas';
import sharp from 'sharp';
import { analyzeReferenceTemplate } from './analyze-template.js';

export const MASTER_DIMENSIONS: Record<
  ReferenceCategory,
  Readonly<{ width: number; height: number }>
> = {
  // Matches the gpt-image-2 edit size in social-post-v2-api.
  twitter: { width: 1280, height: 1600 },
  // Matches the gpt-image-2 edit size in article-poster-v1-api.
  article: { width: 1536, height: 1024 },
  // The YouTube thumbnail frame (migration 0042). Uploaded references are normalised to it,
  // so an operator can upload the 4000x2250 export they already have and the model is
  // handed the aspect it must answer in. Keep in sync with YOUTUBE_THUMBNAIL_DIMENSIONS
  // (build-youtube-thumbnail-prompt.ts) and youtube-chrome.ts.
  youtube: { width: 1280, height: 720 },
};

export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

// Library objects are immutable and versioned; their public URLs are what the
// API sends to the n8n workflows in each generation's payload.
function newLibraryPath(category: ReferenceCategory, subtype: string): string {
  return `references/library/${category}/${subtype}/${Date.now()}-${randomUUID().slice(0, 8)}.png`;
}

export async function normalizeReferenceImage(
  input: Buffer,
  category: ReferenceCategory,
): Promise<Buffer> {
  const { width, height } = MASTER_DIMENSIONS[category];
  return sharp(input).resize(width, height, { fit: 'fill' }).png().toBuffer();
}

function withUrl(
  client: SupabaseClient,
  row: ReferenceImageRow,
): ReferenceImage {
  return { ...row, url: publicUrl(client, row.storagePath) };
}

export async function listReferenceLibrary(
  client: SupabaseClient,
): Promise<ReferenceImage[]> {
  const rows = await listReferenceImageRows(client);
  return rows.map((row) => withUrl(client, row));
}

// The subtype must be an existing reference_types slug — the route validates it
// against the catalog before calling this (the DB FK is the final guard).
//
// `band` is the operator's own answer to "how much does this template hold?", asked as
// the upload form's one question. It OVERRIDES the vision pass's slot count and is
// marked as theirs, so neither this upload nor any later re-check re-files the master
// out of the band they filed it under.
export async function uploadReferenceImage(
  client: SupabaseClient,
  category: ReferenceCategory,
  subtype: string,
  file: Buffer,
  band?: ReferenceShapeBand,
): Promise<ReferenceImage> {
  const png = await normalizeReferenceImage(file, category);
  const storagePath = newLibraryPath(category, subtype);
  await uploadPng(client, storagePath, png);
  const row = await insertReferenceImageRow(client, {
    category,
    subtype,
    storagePath,
    // Uploaded masters join the rotation immediately — the operator no longer
    // has to click वापरा. The old "one active per (category, subtype)" unique
    // index was dropped in 0013, so many active images per type are fine.
    isActive: true,
    // The normalized buffer is already in hand, so the vision pass costs no
    // extra download. Best-effort: a null spec makes the workflow fall back to
    // its old behaviour, which is a worse poster — never a failed upload.
    //
    // A failed analysis stays null even when a band was declared, rather than being
    // fabricated around it: hasPhotoZone is the field that decides whether the image
    // model may paint a photograph at all, and guessing `false` there is a claim about
    // the master nobody made. The row lands in अजून तपासलेली नाहीत and one re-check
    // fixes it — which is exactly what a null spec has always meant.
    layoutSpec: withOperatorBand(await analyzeQuietly(png, storagePath), band),
  });
  return withUrl(client, row);
}

// Stamps the operator's declared band onto a vision-derived spec. Null in, null out.
function withOperatorBand(
  spec: ReferenceLayoutSpec | null,
  band: ReferenceShapeBand | undefined,
): ReferenceLayoutSpec | null {
  if (!spec || !band) return spec;
  return {
    ...spec,
    bulletSlots: REFERENCE_BAND_SLOTS[band],
    slotsLockedByOperator: true,
  };
}

async function analyzeQuietly(png: Buffer, label: string) {
  try {
    return await analyzeReferenceTemplate(png);
  } catch (error) {
    console.warn(
      `Failed to analyze reference template ${label} (it will render with the ` +
        'legacy photo-zone assumption until re-checked):',
      error,
    );
    return null;
  }
}

// Re-runs the vision pass against the stored master. Backs the re-check action on
// /references, and the analyze:references backfill for rows uploaded before 0016.
// Throws on failure — unlike upload, the operator asked for this and wants the error.
export async function reanalyzeReferenceImage(
  client: SupabaseClient,
  id: string,
): Promise<ReferenceImage | null> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return null;

  const png = await downloadPng(client, row.storagePath);
  const spec = await analyzeReferenceTemplate(png);
  // An operator-declared band survives the re-read. The re-check exists to correct a bad
  // photo-zone call or a vague subject line; the slot count is not a reading of the
  // pixels here but the answer given at upload, and silently overwriting it would move
  // the master to another section of the library as a side effect of fixing its summary.
  const locked = row.layoutSpec?.slotsLockedByOperator === true;
  return withUrl(
    client,
    await setReferenceImageLayoutSpec(
      client,
      id,
      locked
        ? {
            ...spec,
            bulletSlots: row.layoutSpec!.bulletSlots,
            slotsLockedByOperator: true,
          }
        : spec,
    ),
  );
}

// Manual correction of a bad vision read. Deliberately a PATCH of the cached spec,
// not a replace: the rest of it (bulletSlots, layoutSummary) usually still describes
// the master accurately, so only the named fields move.
//
// hasPhotoZone is the field that gates imagery; contentSummary is the field the
// information-first reference ranker matches a note against (select-by-information.ts),
// so a vague read there quietly costs the wrong master on every future run — an
// operator's correction is worth more than another vision roll. An empty summary is
// stored as absent, which is exactly how a never-analysed row behaves at the ranker.
export async function overrideReferenceImageLayoutSpec(
  client: SupabaseClient,
  id: string,
  patch: Readonly<{
    hasPhotoZone?: boolean | undefined;
    contentSummary?: string | undefined;
  }>,
): Promise<ReferenceImage | null> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return null;
  if (!row.layoutSpec) {
    throw new Error(
      'This template has not been analyzed yet — run a re-check before overriding it.',
    );
  }

  const contentSummary =
    patch.contentSummary === undefined
      ? row.layoutSpec.contentSummary
      : patch.contentSummary.trim() || undefined;

  // contentSummary is assigned rather than spread-merged, so clearing it actually
  // removes it instead of falling back to the value being cleared.
  const updated = await setReferenceImageLayoutSpec(client, id, {
    ...row.layoutSpec,
    ...(patch.hasPhotoZone === undefined
      ? {}
      : { hasPhotoZone: patch.hasPhotoZone }),
    contentSummary,
  });
  return withUrl(client, updated);
}

// Toggles whether the image participates in the per-generation random rotation.
// Many images per type may be enabled at once; no canonical copy is involved.
export async function setReferenceImageEnabled(
  client: SupabaseClient,
  id: string,
  enabled: boolean,
): Promise<ReferenceImage | null> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return null;
  const updated = await setReferenceImageActive(client, id, enabled);
  return withUrl(client, updated);
}

// Enabled images are deletable too: a type that loses its last enabled image
// simply drops out of the catalog until another image is enabled.
export async function deleteReferenceImage(
  client: SupabaseClient,
  id: string,
): Promise<'deleted' | 'not_found'> {
  const row = await getReferenceImageRow(client, id);
  if (!row) return 'not_found';

  await deleteReferenceImageRow(client, id);
  try {
    await removeObjects(client, [row.storagePath]);
  } catch (error) {
    // The DB row must not point at a missing object. A storage orphan is safe and
    // can be cleaned up separately if this best-effort removal fails.
    console.warn(
      `Failed to remove reference image object ${row.storagePath}:`,
      error,
    );
  }
  return 'deleted';
}
