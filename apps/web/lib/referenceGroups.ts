// Derived SHAPE grouping for the master-template library.
//
// /references used to be organised by `reference_type` — 15 groups for 84 twitter masters,
// whose labels describe the poster's SUBJECT ("Information about insects, reptiles, animals,
// etc") rather than its shape, and one of which is a builtin renamed प्रायोगिक now holding 17
// images whose slot counts span 0 to 10. That taxonomy predicted nothing about the image, and
// it had stopped steering anything: capacity-first selection ranks the WHOLE library and gates
// on `bulletSlots` (see `enforceCapacity` in content-engine's select-by-information.ts), so
// which group an image sits in has not decided a poster since 2026-07-31.
//
// The bands below are that same axis, read straight off `layoutSpec`. So the operator browses
// the library the way the picker sees it, and — the point — the question they must answer at
// upload time ("which group?") stops being a judgement call about topic.
//
// NOTHING IS STORED AND NOTHING IS RE-ANALYSED. `reference_types`, `reference_images.subtype`,
// `copy_style` and every storage path are untouched; the types survive as the upload
// destination and the pin target. This module is pure and derived, so it cannot drift from the
// data and cannot affect a render.

import type { ReferenceImage } from '@dgipr/schemas';

export type ShapeBandId = 'unanalyzed' | 'single' | 'few' | 'medium' | 'many';

export type ShapeBand = Readonly<{
  id: ShapeBandId;
  /** Inclusive slot floor. Not meaningful for 'unanalyzed'. */
  min: number;
  /** Inclusive slot ceiling; Infinity on the open top band. */
  max: number;
}>;

// Page order. 'unanalyzed' LEADS, and that is deliberate: it is an action queue rather than a
// size. A freshly uploaded master lands there carrying no summary until the vision pass runs,
// and putting it last would make an upload look as though it had failed. It renders only when
// non-empty, so on a fully analysed library (all 114 masters, today) it is invisible.
export const SHAPE_BANDS: readonly ShapeBand[] = [
  { id: 'unanalyzed', min: 0, max: 0 },
  { id: 'single', min: 0, max: 0 },
  { id: 'few', min: 1, max: 3 },
  { id: 'medium', min: 4, max: 6 },
  { id: 'many', min: 7, max: Number.POSITIVE_INFINITY },
];

/**
 * Which band an image belongs to.
 *
 * `bulletSlots: 0` is not "empty" — the vision pass uses it to mean "the body is not a
 * repeating list", which is a real and common poster shape (a quotation, a single
 * announcement). It therefore gets its own band rather than being folded into the small one.
 */
export function bandOf(image: ReferenceImage): ShapeBandId {
  const spec = image.layoutSpec;
  if (!spec) return 'unanalyzed';
  const slots = spec.bulletSlots;
  if (slots <= 0) return 'single';
  if (slots <= 3) return 'few';
  if (slots <= 6) return 'medium';
  return 'many';
}

/**
 * Bucket `images` by band, preserving each caller's incoming order inside a band.
 *
 * Every band gets a key, including empty ones — the page decides what to render, and a
 * caller asking for a band it can see in SHAPE_BANDS should never get `undefined` back.
 */
export function groupByBand(
  images: readonly ReferenceImage[],
): Map<ShapeBandId, ReferenceImage[]> {
  const groups = new Map<ShapeBandId, ReferenceImage[]>(
    SHAPE_BANDS.map((band) => [band.id, [] as ReferenceImage[]]),
  );
  for (const image of images) {
    (groups.get(bandOf(image)) as ReferenceImage[]).push(image);
  }
  return groups;
}
