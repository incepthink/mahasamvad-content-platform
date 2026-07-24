// Content-aware master-template selection.
//
// Replaces the old pickRandom(enabled) — which chose a master before the note was even
// classified, so nothing about the content could influence it. `info_bullets` has 13 enabled
// masters with 0-8 body slots; a 6-bullet note landed on a 3-slot template as often as not.
//
// The scorer matches a master against what the note needs (how many body points, whether it
// wants a photograph) and keeps every master within 1 point of the best. Within that
// structurally-equal band the winner is chosen by SUBJECT/TONE fit: a small LLM ranks the band
// members' vision-derived descriptions against the note (rank-master.ts). When there is no note,
// fewer than two band members carry descriptions, or the ranker fails, the pick falls back to
// hashing the generation id — reproducible (a retry re-renders the same template), variety
// preserved across runs, and the library stays a real rotation rather than one template winning.
//
// The master's structure comes from reference_images.layout_spec (a vision pass at upload,
// migration 0016). Most of the library is un-analysed; when the picked master has no spec we
// analyse it once here and PERSIST it, so the next run reads it from the DB for free.

import {
  downloadPng,
  publicUrl,
  setReferenceImageLayoutSpec,
  type ReferenceImageRow,
  type ReferenceLayoutSpec,
  type SupabaseClient,
} from '@dgipr/database';
import { analyzeReferenceTemplate } from './analyze-template.js';
import { rankMasterByNote, type MasterCandidate } from './rank-master.js';

// What the note needs, read off the classifier. Absent on pinned/CMO runs (no classification),
// in which case selection falls back to seeded variety alone.
export type MasterNeed = Readonly<{
  // Body points the note supports (classifier point_count).
  points: number;
  // Whether the note wants a photograph (classifier wants_photo).
  wantsPhoto: boolean;
}>;

export type SelectedMaster = Readonly<{
  id: string;
  url: string;
  layoutSpec: ReferenceLayoutSpec | null;
  // A short human-readable explanation of the pick, for the job log.
  reason: string;
}>;

// Score a master against the need. Higher is better.
// - slots: how close the master's body-slot count is to what the note needs, with overflow
//   (too few slots for the content) penalised twice as hard as underfill (empty slots).
// - photo: a strong bonus when the master's photo-zone presence matches what the note wants.
// - unknown: an un-analysed master is a last resort (we cannot tell if it fits), never excluded.
export function scoreMaster(
  spec: ReferenceLayoutSpec | null,
  need: MasterNeed,
): number {
  if (!spec) return -2;
  let score = 0;
  const diff = spec.bulletSlots - need.points;
  score += diff < 0 ? diff * 2 : -diff; // overflow (diff<0) doubly penalised
  if (spec.hasPhotoZone === need.wantsPhoto) score += 3;
  return score;
}

// Deterministic 32-bit hash of a string (FNV-1a). Used to pick within the top band so the
// same generation id always yields the same master, while different ids spread across it.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Analyse one master and persist its spec (best-effort). Returns the spec, or null if the
// vision pass failed — a failure must never sink a render, so the caller falls back to the
// un-analysed behaviour.
async function analyzeAndPersist(
  client: SupabaseClient,
  image: ReferenceImageRow,
): Promise<ReferenceLayoutSpec | null> {
  try {
    const png = await downloadPng(client, image.storagePath);
    const spec = await analyzeReferenceTemplate(png);
    await setReferenceImageLayoutSpec(client, image.id, spec);
    return spec;
  } catch (error) {
    console.warn(
      `[select-master] on-demand analysis of ${image.storagePath} failed (using it un-analysed):`,
      error,
    );
    return null;
  }
}

// A band member the description ranker can reason over: it must already carry vision-derived
// summaries (a null-spec master has nothing to match on). contentSummary is optional because
// masters analysed before that field existed still have a layoutSummary.
function candidateFor(image: ReferenceImageRow): MasterCandidate | null {
  const spec = image.layoutSpec;
  if (!spec) return null;
  if (!spec.layoutSummary && !spec.contentSummary) return null;
  return {
    id: image.id,
    layoutSummary: spec.layoutSummary,
    contentSummary: spec.contentSummary,
    hasPhotoZone: spec.hasPhotoZone,
    bulletSlots: spec.bulletSlots,
  };
}

// Choose one master from the enabled images of a type. `need` steers best-fit scoring; when it
// is absent (pinned type / CMO run — no classification), the band is all images. Within the
// band the pick is CONTENT-AWARE when a `note` is given AND at least two band members have
// descriptions: a small LLM ranks them by subject/tone (rank-master.ts) and its winner is used;
// otherwise (no note, <2 analysed, or a ranker failure) the seeded hash pick is used, so the
// behaviour degrades cleanly to the old reproducible rotation.
// At most ONE vision analysis is spent per call: the picked master is always analysed if it has
// no spec (so copy/prompt get real structure); otherwise one other un-analysed image is warmed
// opportunistically, so the library fills over time — and ranking quality improves with it.
export async function selectMaster(
  client: SupabaseClient,
  images: readonly ReferenceImageRow[],
  need: MasterNeed | undefined,
  seed: string,
  note?: string,
  // Master ids used by recent runs of this type, to avoid landing on the same one again
  // (across-run variety). Dropped from the band unless that would empty it. Best-effort:
  // the caller keeps this in an in-process ring, so it degrades to today's behaviour on
  // restart or when only one master fits.
  avoidIds?: readonly string[],
  // Set on a from-scratch ('fresh') render, where the master is structure inspiration and the
  // palette is assigned separately: colour is then excluded from the ranking criterion and
  // filtered out of the descriptions the ranker reads.
  options: Readonly<{ ignoreColour?: boolean | undefined }> = {},
): Promise<SelectedMaster> {
  if (images.length === 0) {
    throw new Error('selectMaster called with no enabled images.');
  }

  // Rank by score (need-based) or leave flat (seeded-only). Ties/band are broken by createdAt
  // for determinism.
  const byRecency = [...images].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  let band: ReferenceImageRow[];
  let reasonPrefix: string;
  if (need) {
    const scored = byRecency.map((image) => ({
      image,
      score: scoreMaster(image.layoutSpec, need),
    }));
    const best = Math.max(...scored.map((s) => s.score));
    band = scored.filter((s) => s.score >= best - 1).map((s) => s.image);
    reasonPrefix = `best-fit (need points=${need.points} photo=${need.wantsPhoto}, band=${band.length}/${images.length}, top=${best})`;
  } else {
    band = byRecency;
    reasonPrefix = `seeded rotation (band=${band.length})`;
  }

  // Across-run variety: drop masters this type used recently, unless that empties the band
  // (a single-fit band, or every master used lately, still gets a poster).
  if (avoidIds && avoidIds.length > 0) {
    const avoid = new Set(avoidIds);
    const spread = band.filter((image) => !avoid.has(image.id));
    if (spread.length > 0 && spread.length < band.length) {
      band = spread;
      reasonPrefix += ` +spread(-${avoid.size})`;
    }
  }

  // Content-aware pick within the band, over the members that carry descriptions. Falls back to
  // the seeded hash pick when there is no note, fewer than two rankable members, or the ranker
  // returns nothing usable.
  const seededPick = band[hashString(seed) % band.length] as ReferenceImageRow;
  let picked = seededPick;
  let pickMethod = 'seeded';
  if (note) {
    const candidates = band
      .map(candidateFor)
      .filter((c): c is MasterCandidate => c !== null);
    if (candidates.length >= 2) {
      const ranked = await rankMasterByNote(note, candidates, {
        ignoreColour: options.ignoreColour,
      });
      const match = ranked && band.find((img) => img.id === ranked.id);
      if (match) {
        picked = match;
        pickMethod = `LLM-ranked (${ranked?.reason ?? ''})`;
      }
    }
  }

  let layoutSpec = picked.layoutSpec;
  let analysisSpent = false;
  if (!layoutSpec) {
    layoutSpec = await analyzeAndPersist(client, picked);
    analysisSpent = true;
  }
  // Opportunistically warm one other un-analysed master so the cache fills over time.
  if (!analysisSpent) {
    const stale = byRecency.find((img) => img.id !== picked.id && !img.layoutSpec);
    if (stale) await analyzeAndPersist(client, stale);
  }

  return {
    id: picked.id,
    url: publicUrl(client, picked.storagePath),
    layoutSpec,
    reason: `${reasonPrefix} → ${pickMethod} → ${picked.storagePath}`,
  };
}
