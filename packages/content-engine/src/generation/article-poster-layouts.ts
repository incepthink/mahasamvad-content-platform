// A rotation of composition archetypes for the LANDSCAPE article poster, and a seeded,
// recency-aware picker. The article twin of poster-layouts.ts.
//
// Why this is a separate library rather than a flag on the social one: three things differ, and
// every one of them changes what an archetype may say.
//
//  1. THE CANVAS. The article poster is 1536x1024 landscape; the social poster is 4:5 portrait.
//     "a full-height colour column down the LEFT third" is a different poster in each.
//  2. THE CONTENT. An article poster carries ONE Marathi headline and nothing else — no kicker,
//     no bullets, no stat chips, no cards. Every social archetype describes where the body list
//     goes, which here would invite the image model to invent one. So each instruction below
//     states that the headline is the only text, and describes how the REST of the canvas is
//     filled (imagery, colour mass, negative space) instead of what other copy sits there.
//  3. THE RESERVED ZONES. The article chrome is stamped top-LEFT (the महासंवाद logo, ~420x180)
//     plus the full-width bottom strip (~150px); the social chrome is a top-RIGHT emblem plus its
//     own bottom strip. Every instruction here is written to leave the article zones clear, and
//     in particular never to place the headline in the top-left corner.
//
// Ids are prefixed `art_` so an article layout id can never be confused with a social one — they
// share one `generations.poster_style` column (migration 0028) and one label lookup.
//
// The colour PALETTE is NOT duplicated: poster-palettes.ts is shared verbatim, because colour is
// aspect-ratio-agnostic and the whole point of that library is that one rotation spreads across
// everything the department publishes.
//
// Every `instruction` is English STYLE guidance about geometry — never poster text, names or
// facts — so the never-invent rule is not at risk.

import { pathToFileURL } from 'node:url';
import type { LayoutCoverage } from './poster-layouts.js';

// Whether the archetype needs a photograph. Absolute filter, exactly as in poster-layouts.ts: an
// archetype whose whole point is a full-bleed photo is a broken poster without one.
export type LayoutPhoto = 'required' | 'forbidden' | 'either';

export type ArticlePosterLayout = Readonly<{
  // Stable id — persisted per run and used by the recency ring. Never rename one.
  id: string;
  // Short English name, for logs.
  name: string;
  // Marathi label, shown to the officer on the generation detail page.
  label: string;
  // How much of the canvas the dominant colour occupies / where it sits. The recency ring spreads
  // across these as well as across ids: two `panel` posters read alike even with different ids.
  coverage: LayoutCoverage;
  photo: LayoutPhoto;
  // The composition instruction, injected verbatim into the image prompt.
  instruction: string;
}>;

// One headline, many anatomies. The first entry reproduces the look the old hardcoded prompt
// forced onto every master (a left panel + right photo); it is now ONE of eleven rather than the
// only outcome.
export const ARTICLE_POSTER_LAYOUTS: readonly ArticlePosterLayout[] = [
  {
    id: 'art_left_panel',
    name: 'Left colour panel, imagery right',
    label: 'डावे रंगपटल',
    coverage: 'panel',
    photo: 'either',
    instruction:
      'a solid colour panel filling the LEFT ~40% of the canvas from top edge to bottom edge, carrying the headline in large reversed-out type, vertically centred with generous margins; the remaining right ~60% is filled edge to edge by the imagery. The boundary between them is a single clean vertical edge or a gentle curve. The headline is the ONLY text on the poster. Start the headline block well below the top-left reserved rectangle.',
  },
  {
    id: 'art_right_panel',
    name: 'Right colour panel, imagery left',
    label: 'उजवे रंगपटल',
    coverage: 'panel',
    photo: 'either',
    instruction:
      'a solid colour panel filling the RIGHT ~40% of the canvas from top edge to bottom edge, carrying the headline in large reversed-out type, vertically centred with generous margins; the imagery fills the LEFT ~60% edge to edge. Placing the headline on the right leaves the top-left reserved rectangle naturally clear. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_split_half',
    name: 'Clean vertical half-and-half',
    label: 'सरळ अर्धविभागणी',
    coverage: 'split',
    photo: 'required',
    instruction:
      'an exact 50/50 vertical split with a hard straight edge down the centre: a flat colour field on the RIGHT half holding the headline in large reversed-out type, vertically centred, and a full-bleed photograph filling the LEFT half completely. Nothing crosses the centre line and there is no frame or border around either half. Putting the headline on the right keeps it clear of the top-left reserved rectangle; keep the photograph free of any subject matter in that corner too. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_photo_bleed_scrim',
    name: 'Full-bleed photo with a headline scrim',
    label: 'पूर्ण छायाचित्र व रंगपट्टी',
    coverage: 'field',
    photo: 'required',
    instruction:
      'a photograph bleeding across the ENTIRE canvas, with a solid opaque colour band running full width across the lower-middle of the poster holding the headline in reversed-out type. The band must stop clear of the reserved bottom strip and must not reach the top-left reserved rectangle. Keep the photograph legible above and below the band; the headline is the ONLY text on the poster.',
  },
  {
    id: 'art_top_band',
    name: 'Headline band over imagery',
    label: 'वरची रंगपट्टी',
    coverage: 'band',
    photo: 'either',
    instruction:
      'a solid full-width colour band across the upper part of the canvas holding the headline in large reversed-out type, and the imagery or a flat colour field filling everything beneath it. The band must START BELOW the top-left reserved rectangle rather than at the very top edge, so the stamped logo sits on quiet background above it. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_bottom_anchor',
    name: 'Imagery above, colour anchor below',
    label: 'खालचा रंगखंड',
    coverage: 'band',
    photo: 'either',
    instruction:
      'the imagery or a plain field occupies the upper half of the canvas, and a solid colour block anchors the lower half carrying the headline in large reversed-out type, left-aligned with a wide margin. The colour block must stop clear of the reserved bottom strip. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_diagonal_wedge',
    name: 'Diagonal colour wedge',
    label: 'तिरपा रंगखंड',
    coverage: 'wedge',
    photo: 'either',
    instruction:
      'a large diagonal wedge of the dominant colour sweeping in from the RIGHT edge across roughly half the canvas, carrying the headline in reversed-out type set horizontally (never rotated to follow the diagonal); the imagery or a plain field fills the area on the other side of the diagonal. The wedge must not intrude into the top-left reserved rectangle. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_centre_slab',
    name: 'Full-bleed photo, centred headline slab',
    label: 'मध्यवर्ती फलक',
    coverage: 'field',
    photo: 'required',
    instruction:
      'a photograph bleeding across the ENTIRE canvas, with ONE solid rectangular colour slab floating in the centre-right of the composition — comfortably inset from every edge — holding the headline in reversed-out type. The slab must clear the top-left reserved rectangle and the reserved bottom strip on every side. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_circle_cutout',
    name: 'Circular photo cutout',
    label: 'वर्तुळाकार छायाचित्र',
    coverage: 'panel',
    photo: 'required',
    instruction:
      'a flat colour field covering the whole canvas, with the photograph cropped inside ONE large circle or heavily rounded shape occupying the RIGHT third of the poster, and the headline set large on the flat colour field to its left, vertically centred. Draw exactly one such shape, never two. The headline block must start below the top-left reserved rectangle. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_type_field',
    name: 'Typographic colour field',
    label: 'अक्षरप्रधान रंगपट',
    coverage: 'field',
    photo: 'forbidden',
    instruction:
      'no photograph at all: the dominant colour fills the whole canvas as a flat field, and the headline is set very large across the vertical centre in reversed-out type, occupying most of the width, with one simple geometric accent — a thick rule, a bar, or a plain shape in the accent colour — anchoring it. Generous empty space above and below, which is what keeps the headline clear of the top-left reserved rectangle and the reserved bottom strip; the accent shape must not enter either. The headline is the ONLY text on the poster.',
  },
  {
    id: 'art_edge_stripe',
    name: 'Pale ground with a colour edge stripe',
    label: 'कडेची रंगपट्टी',
    coverage: 'band',
    photo: 'either',
    instruction:
      'a pale page-background ground carrying the headline in large dark type on the LEFT, with a thick solid colour stripe running the full height of the RIGHT edge, and the imagery (if any) held as a clean rectangular inset between the two rather than bleeding off the canvas. The headline must begin below the top-left reserved rectangle. The headline is the ONLY text on the poster.',
  },
];

// What the composition must suit. `hasPhoto` is a hard filter; there is no copyStyle axis here
// because an article poster has exactly one copy shape (a single headline).
export type ArticleLayoutNeed = Readonly<{
  hasPhoto: boolean;
}>;

// What the last few ARTICLE runs used, so this one differs. Coverage matters more than id.
export type ArticleLayoutAvoid = Readonly<{
  ids?: readonly string[] | undefined;
  coverages?: readonly LayoutCoverage[] | undefined;
}>;

// Deterministic 32-bit hash (FNV-1a), matching poster-palettes.ts / poster-layouts.ts /
// select-master.ts so the same seed reproduces the same pick on a retry.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function eligible(need: ArticleLayoutNeed): readonly ArticlePosterLayout[] {
  return ARTICLE_POSTER_LAYOUTS.filter((l) =>
    need.hasPhoto ? l.photo !== 'forbidden' : l.photo !== 'required',
  );
}

// Pick one composition for a run. Deterministic in `seed`; spread away from the last few runs'
// coverages first, then their exact ids. Each filter is skipped only if it would empty the pool.
export function pickArticleLayout(
  seed: string,
  need: ArticleLayoutNeed,
  avoid: ArticleLayoutAvoid = {},
): ArticlePosterLayout {
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
  return pool[index] as ArticlePosterLayout;
}

// Look one up by id — used by poster-style.ts to label a stored article run. Returns null for an
// id written by an older build whose archetype has since been removed.
export function articleLayoutById(
  id: string | null | undefined,
): ArticlePosterLayout | null {
  if (!id) return null;
  return ARTICLE_POSTER_LAYOUTS.find((l) => l.id === id) ?? null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/article-poster-layouts.ts
// Offline assertions: the photo filter is absolute, ids stay namespaced and unique, the rotation
// spreads, and every instruction respects the article poster's two invariants (one headline, and
// the reserved zones). No model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const COVERAGE_RING = 2;
  const ID_RING = 4;
  const RUNS = 24;
  const failures: string[] = [];

  console.log(`Library: ${ARTICLE_POSTER_LAYOUTS.length} landscape archetypes\n`);
  for (const l of ARTICLE_POSTER_LAYOUTS) {
    console.log(`  ${l.id.padEnd(24)} ${l.coverage.padEnd(7)} photo=${l.photo}`);
  }

  // 1. Ids are unique and namespaced (they share one poster_style column with the social library).
  const ids = new Set<string>();
  for (const l of ARTICLE_POSTER_LAYOUTS) {
    if (ids.has(l.id)) failures.push(`duplicate id ${l.id}`);
    ids.add(l.id);
    if (!l.id.startsWith('art_')) failures.push(`${l.id} is not namespaced with art_`);
  }

  // 2. The photo filter is absolute in both directions.
  for (let i = 0; i < 60; i += 1) {
    const noPhoto = pickArticleLayout(`s${i}`, { hasPhoto: false });
    if (noPhoto.photo === 'required') {
      failures.push(`text-only run got photo-required layout ${noPhoto.id}`);
    }
    const withPhoto = pickArticleLayout(`s${i}`, { hasPhoto: true });
    if (withPhoto.photo === 'forbidden') {
      failures.push(`photo run got photo-forbidden layout ${withPhoto.id}`);
    }
  }

  // 3. A text-only run still has real variety (not one archetype by default).
  const textOnly = new Set(
    Array.from({ length: 60 }, (_, i) => pickArticleLayout(`t${i}`, { hasPhoto: false }).id),
  );
  if (textOnly.size < 2) {
    failures.push(`text-only runs only ever produce ${[...textOnly].join(', ')}`);
  }

  // 4. Every instruction states the one-headline rule and mentions a reserved zone or its edge —
  //    the two things an article archetype must never leave to the image model's judgement.
  for (const l of ARTICLE_POSTER_LAYOUTS) {
    if (!/ONLY text on the poster/.test(l.instruction)) {
      failures.push(`${l.id} does not state the headline-only rule`);
    }
    if (!/reserved/i.test(l.instruction)) {
      failures.push(`${l.id} never mentions the reserved zones`);
    }
  }

  // 5. The rotation spreads: no coverage or id repeats back-to-back.
  console.log(`\nSimulating ${RUNS} runs (with photo):\n`);
  const coverageRing: LayoutCoverage[] = [];
  const idRing: string[] = [];
  const picks: ArticlePosterLayout[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const chosen = pickArticleLayout(
      `harness-run-${i}`,
      { hasPhoto: true },
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
    const a = picks[i] as ArticlePosterLayout;
    const b = picks[i - 1] as ArticlePosterLayout;
    if (a.id === b.id) failures.push(`layout ${a.id} repeated back-to-back at run ${i}`);
    if (a.coverage === b.coverage) {
      failures.push(`coverage ${a.coverage} repeated back-to-back at run ${i}`);
    }
  }

  // 6. Determinism: the same seed and need reproduce the same pick (a retry must not redesign).
  if (
    pickArticleLayout('stable', { hasPhoto: true }).id !==
    pickArticleLayout('stable', { hasPhoto: true }).id
  ) {
    failures.push('pickArticleLayout is not deterministic in its seed');
  }

  // 7. Lookup round trip.
  if (articleLayoutById('art_left_panel')?.coverage !== 'panel') {
    failures.push('articleLayoutById did not resolve a known id');
  }
  if (articleLayoutById('banner_top') !== null) {
    failures.push('articleLayoutById resolved a SOCIAL layout id');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll article-layout rotation assertions passed.');
  }
}
