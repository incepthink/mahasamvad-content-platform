// A rotation of poster COMPOSITION archetypes, and a seeded, recency-aware picker.
//
// Why this exists: poster-palettes.ts fixed which colours a fully-AI-generated poster uses, but
// colour was never the whole complaint. Two posters in different palettes still read as "the
// same poster again" when both are a headline band across the top and a column of bullet rows
// beneath — and that is what the pipeline produced every time, because the only structural input
// was the selected master's `layoutSummary`, and masters are picked by topic fit, so similar
// notes reliably produced similar structures.
//
// So composition is rotated on its own axis, exactly like colour: an archetype is ASSIGNED per
// run, the art director composes within it rather than choosing it, and a recency ring keeps
// consecutive runs apart. Two independent rotations multiply — 18 palettes x 11 layouts is a far
// larger space than either alone, and the two axes are chosen independently so a repeated layout
// never coincides with a repeated palette.
//
// `coverage` is the field that carries the product decision behind all of this. Posters stay
// LIGHT-GROUND (see poster-palettes.ts), so the background cannot vary by going dark; what varies
// instead is how much of the canvas the colour block occupies and where it sits. A `band` poster
// and a `field` poster in the same palette look nothing alike.
//
// Every `instruction` is English STYLE guidance about geometry — never poster text, names or
// facts — so the never-invent rule is not at risk. The reserved chrome zones (top-right emblem,
// bottom footer strip) are asserted separately in build-poster-prompt.ts and every archetype here
// is written to leave them clear.

import { pathToFileURL } from 'node:url';

// How much of the canvas the dominant colour occupies. The recency ring spreads across these as
// well as across ids, because two `cards` layouts read alike even when their ids differ.
export type LayoutCoverage = 'band' | 'column' | 'field' | 'cards' | 'wedge';

// Whether the archetype needs a photograph. A text-only note must never be handed a layout whose
// whole point is a hero image, and vice versa — this is a hard filter, not a preference.
export type LayoutPhoto = 'required' | 'forbidden' | 'either';

export type PosterLayout = Readonly<{
  // Stable id — persisted per run and used by the recency ring. Never rename one.
  id: string;
  // Short English name, for logs.
  name: string;
  // Marathi label, shown to the officer on the generation detail page.
  label: string;
  coverage: LayoutCoverage;
  photo: LayoutPhoto;
  // Copy styles this composition suits. Absent = suits any. A quote poster genuinely needs its
  // own geometry; a timeline cannot be laid out as a 2x3 card grid.
  copyStyles?: readonly string[] | undefined;
  // The composition instruction, injected verbatim into the image prompt.
  instruction: string;
}>;

export const POSTER_LAYOUTS: readonly PosterLayout[] = [
  {
    id: 'banner_top',
    name: 'Top banner + stacked rows',
    label: 'वरची रुंद पट्टी',
    coverage: 'band',
    photo: 'either',
    instruction:
      'a solid full-width colour band across the top third holding the kicker and the headline in reversed-out type, and the body content stacked as full-width rows on the plain background beneath it. Keep a generous margin between the band and the first row.',
  },
  {
    id: 'left_rail',
    name: 'Left colour column',
    label: 'डावी रंगपट्टी',
    coverage: 'column',
    photo: 'either',
    instruction:
      'a full-height solid colour column down the LEFT third carrying the kicker and the headline set vertically stacked in reversed-out type; the body content occupies the remaining two-thirds on the plain background, aligned to a single left edge. Nothing crosses the column boundary.',
  },
  {
    id: 'bottom_anchor',
    name: 'Bottom colour anchor',
    label: 'खालचा रंगखंड',
    coverage: 'band',
    photo: 'either',
    instruction:
      'the headline sits large on the plain background across the upper half with plenty of air around it, and a solid colour block anchors the LOWER half holding the body content in reversed-out type. The block must stop clear of the reserved bottom strip.',
  },
  {
    id: 'framed_panel',
    name: 'Floating panel on a colour field',
    label: 'रंगपटलावर तरंगते पॅनेल',
    coverage: 'field',
    photo: 'either',
    instruction:
      'the dominant colour fills the whole canvas as a flat field, and ALL content sits inside one large rounded panel of the pale background colour floating in the middle with a wide, even colour margin on every side. The headline sits at the top of that panel.',
  },
  {
    id: 'card_grid',
    name: 'Card grid',
    label: 'कार्ड जाळी',
    coverage: 'cards',
    photo: 'either',
    copyStyles: ['info_bullets', 'generic', 'campaign', 'alert'],
    instruction:
      'the headline occupies a compact zone at the top, and the body content is laid out as a GRID of equal rounded cards (two per row) tinted in the colour, each holding one point with a simple line icon above its text. The grid is the visual weight of the poster, not the headline.',
  },
  {
    id: 'numbered_ladder',
    name: 'Numbered ladder',
    label: 'क्रमांकित पायऱ्या',
    coverage: 'column',
    photo: 'either',
    copyStyles: ['info_bullets', 'generic', 'campaign', 'timeline'],
    instruction:
      'the body content runs down the page as a numbered ladder — a large filled colour circle carrying each number on the left, joined by a continuous vertical rule, with the text of each step on the right. The headline sits above the ladder, left-aligned to the same edge.',
  },
  {
    id: 'stat_strip',
    name: 'Headline over a stat strip',
    label: 'आकडेवारी पट्टी',
    coverage: 'cards',
    photo: 'either',
    copyStyles: ['campaign', 'info_bullets', 'generic'],
    instruction:
      'an oversized headline dominates the upper half on the plain background, and the body content sits beneath it as a single horizontal strip of equal chips or callouts divided by thin rules, each with its figure set much larger than its label.',
  },
  {
    id: 'split_diagonal',
    name: 'Diagonal colour wedge',
    label: 'तिरपा रंगखंड',
    coverage: 'wedge',
    photo: 'either',
    instruction:
      'a large diagonal wedge of the dominant colour sweeps in from one top corner across roughly the upper 40% of the canvas, carrying the kicker and the headline in reversed-out type; the body content sits below the diagonal edge on the plain background, its rows aligned to the horizontal, never to the diagonal.',
  },
  {
    id: 'quote_slab',
    name: 'Quote slab',
    label: 'अवतरण फलक',
    coverage: 'field',
    photo: 'either',
    copyStyles: ['quote'],
    instruction:
      'one very large opening quotation mark in the accent colour sits at the upper left, the quotation runs across the centre of the canvas at large size on the plain background, and the attribution sits beneath it on a solid colour bar. Any supporting points are small and secondary, along the bottom above the reserved strip.',
  },
  {
    id: 'photo_top_bleed',
    name: 'Photo bleed across the top',
    label: 'वरती पूर्ण छायाचित्र',
    coverage: 'band',
    photo: 'required',
    instruction:
      'a photograph bleeds full-width across the TOP third of the canvas with no border, meeting a solid colour rule; the headline sits immediately below it on the plain background, and the body content fills the lower half. No text is placed over the photograph.',
  },
  {
    id: 'photo_side',
    name: 'Portrait photo column',
    label: 'बाजूचे छायाचित्र',
    coverage: 'column',
    photo: 'required',
    instruction:
      'a full-height photograph occupies the RIGHT third of the canvas, cropped to a clean vertical edge; the headline and all body content sit in the left two-thirds on the plain background, left-aligned, with a solid colour block behind the headline only. No text crosses onto the photograph.',
  },
];

// What the layout must suit. `hasPhoto` is a hard filter; `copyStyle` narrows to archetypes that
// can actually hold that copy shape.
export type LayoutNeed = Readonly<{
  hasPhoto: boolean;
  copyStyle: string;
}>;

// What the last few runs used, so this one differs. Coverage matters more than id: two `cards`
// layouts read as the same poster even when their ids differ.
export type LayoutAvoid = Readonly<{
  ids?: readonly string[] | undefined;
  coverages?: readonly LayoutCoverage[] | undefined;
}>;

// Deterministic 32-bit hash (FNV-1a), matching poster-palettes.ts and select-master.ts so the
// same seed reproduces the same pick on a retry.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Archetypes that can hold this note's shape. The photo rule is absolute (a hero-image layout
// with no photograph is a broken poster); the copyStyle rule relaxes if it would leave nothing,
// since a custom type's style slug may match no archetype's list.
function eligible(need: LayoutNeed): readonly PosterLayout[] {
  const byPhoto = POSTER_LAYOUTS.filter((l) =>
    need.hasPhoto ? l.photo !== 'forbidden' : l.photo !== 'required',
  );
  const byStyle = byPhoto.filter(
    (l) => !l.copyStyles || l.copyStyles.includes(need.copyStyle),
  );
  return byStyle.length > 0 ? byStyle : byPhoto;
}

// Pick one composition for a run. Deterministic in `seed`; spread away from the last few runs'
// coverages first, then their exact ids. Each filter is skipped only if it would empty the pool,
// so a narrow eligible set (a quote poster has few) still returns a layout rather than throwing.
export function pickLayout(
  seed: string,
  need: LayoutNeed,
  avoid: LayoutAvoid = {},
): PosterLayout {
  let pool = eligible(need);

  const coverages = new Set(avoid.coverages ?? []);
  if (coverages.size > 0) {
    const spread = pool.filter((l) => !coverages.has(l.coverage));
    if (spread.length > 0) pool = spread;
  }

  const ids = new Set(avoid.ids ?? []);
  if (ids.size > 0) {
    const spread = pool.filter((l) => !ids.has(l.id));
    if (spread.length > 0) pool = spread;
  }

  const index = hashString(seed) % pool.length;
  return pool[index] as PosterLayout;
}

// Look one up by id — used by the API to label a stored run's composition for the UI. Returns
// null for an id written by an older build whose archetype has since been removed.
export function layoutById(id: string | null | undefined): PosterLayout | null {
  if (!id) return null;
  return POSTER_LAYOUTS.find((l) => l.id === id) ?? null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/poster-layouts.ts
// Offline assertions: the photo filter is absolute, the copyStyle filter holds where it can, and
// the rotation actually spreads. No model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const COVERAGE_RING = 2;
  const ID_RING = 4;
  const RUNS = 24;
  const failures: string[] = [];

  console.log(`Library: ${POSTER_LAYOUTS.length} composition archetypes\n`);
  for (const l of POSTER_LAYOUTS) {
    console.log(
      `  ${l.id.padEnd(18)} ${l.coverage.padEnd(7)} photo=${l.photo.padEnd(9)} styles=${l.copyStyles ? l.copyStyles.join('/') : 'any'}`,
    );
  }

  // 1. The photo filter is absolute in both directions.
  for (const style of ['info_bullets', 'quote', 'campaign', 'timeline', 'alert', 'generic']) {
    for (let i = 0; i < 40; i += 1) {
      const noPhoto = pickLayout(`s${i}`, { hasPhoto: false, copyStyle: style });
      if (noPhoto.photo === 'required') {
        failures.push(`text-only ${style} run got photo-required layout ${noPhoto.id}`);
      }
      const withPhoto = pickLayout(`s${i}`, { hasPhoto: true, copyStyle: style });
      if (withPhoto.photo === 'forbidden') {
        failures.push(`photo ${style} run got photo-forbidden layout ${withPhoto.id}`);
      }
    }
  }

  // 2. A quote poster gets a quote-capable archetype.
  for (let i = 0; i < 40; i += 1) {
    const l = pickLayout(`q${i}`, { hasPhoto: false, copyStyle: 'quote' });
    if (l.copyStyles && !l.copyStyles.includes('quote')) {
      failures.push(`quote run got ${l.id}, which does not list quote`);
    }
  }

  // 3. An unknown (custom-type) copy style still returns something.
  const custom = pickLayout('custom-seed', { hasPhoto: false, copyStyle: 'custom_deadbeef' });
  if (!custom) failures.push('an unknown copy style returned no layout');

  // 4. The rotation spreads: no coverage repeats within COVERAGE_RING consecutive runs.
  console.log(`\nSimulating ${RUNS} runs (info_bullets, with photo):\n`);
  const coverageRing: LayoutCoverage[] = [];
  const idRing: string[] = [];
  const picks: PosterLayout[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const chosen = pickLayout(
      `harness-run-${i}`,
      { hasPhoto: true, copyStyle: 'info_bullets' },
      { coverages: coverageRing, ids: idRing },
    );
    picks.push(chosen);
    console.log(`run ${String(i).padStart(2)} -> ${chosen.coverage.padEnd(7)} ${chosen.id}`);
    coverageRing.unshift(chosen.coverage);
    coverageRing.splice(COVERAGE_RING);
    idRing.unshift(chosen.id);
    idRing.splice(ID_RING);
  }
  for (let i = 1; i < picks.length; i += 1) {
    const a = picks[i] as PosterLayout;
    const b = picks[i - 1] as PosterLayout;
    if (a.id === b.id) failures.push(`layout ${a.id} repeated back-to-back at run ${i}`);
    if (a.coverage === b.coverage) {
      failures.push(`coverage ${a.coverage} repeated back-to-back at run ${i}`);
    }
  }

  // 5. Determinism: the same seed and need reproduce the same pick (a retry must not redesign).
  const need: LayoutNeed = { hasPhoto: true, copyStyle: 'generic' };
  if (pickLayout('stable', need).id !== pickLayout('stable', need).id) {
    failures.push('pickLayout is not deterministic in its seed');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll layout-rotation assertions passed.');
  }
}
