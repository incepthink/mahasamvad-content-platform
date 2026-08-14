// A rotation of poster PLACEMENT ANCHORS for the fully-AI ('fresh') social lane, and a seeded,
// recency-aware picker.
//
// WHY THIS IS NOT poster-layouts.ts REBUILT. That library was retired from the prompt on
// 2026-08-10 for a reason that still stands: its eleven archetypes were all "a flat colour
// rectangle plus rows of text", two of them literally "photograph down one side, text down the
// other", and each `instruction` specified the whole poster — where the kicker goes, what the
// body list looks like, what sits behind the headline. Rotating between eleven spellings of one
// poster produced eleven spellings of one poster. Handing the design over instead produced
// genuinely better craft, which is what the officer reported.
//
// What handing it over did NOT produce is variety in ARRANGEMENT. An image model given a
// headline, a list of points and a scene brief has two habits — the band-over-rows stack and the
// canvas halved with a picture down one side — and with nothing said about arrangement it reaches
// for one of them almost every time. Naming both as failure modes in the brief (2026-08-14) is a
// negative, and this repo has already learned once that image models answer negatives badly:
// `NO_TEXT_RULE` had to be rewritten as a positive instruction because "no signage" made the
// model paint signage and fill it with gibberish. "Do not default to those two shapes" leaves
// nothing to execute, so the model executes the default.
//
// So each entry here states ONE THING POSITIVELY: where the visual weight sits and how the canvas
// is divided. Nothing else. It does not name a kicker, a body list, a card grid, a panel behind
// the headline, a colour or a medium — every one of those stays the model's, which is what keeps
// the 2026-08-10 hand-over intact. An anchor is roughly a sentence; an archetype was a spec.
//
// AND EACH ONE IS FILTERED AGAINST THE CONTENT BEFORE IT CAN BE ASSIGNED. That is the answer to
// the obvious objection — that a firmly-stated arrangement the content cannot carry produces a
// worse poster than the boring default. A full-bleed-imagery anchor is simply not in the pool for
// a nine-point run, and an imagery-led anchor is not in the pool for a poster with no imagery. The
// assigned anchor is satisfiable BY CONSTRUCTION, which is what lets the prompt state it firmly
// instead of hedging it into uselessness. Same doctrine as poster-layouts.ts's photo filter: a
// hard filter, not a preference.
//
// Every `instruction` is English GEOMETRY guidance — never poster text, names or facts — so the
// never-invent rule is not at risk. The reserved chrome zones (top-right emblem, bottom footer
// strip) are asserted separately in build-poster-prompt.ts, and no anchor here may push content
// into them: the fit rule that ends every fresh prompt outranks this block and says so.

import { pathToFileURL } from 'node:url';

// The shape of the arrangement, one level above the individual anchor. The recency ring spreads
// across families FIRST, because two `anchored` posters read alike even when one bleeds off the
// lower-right and the other off the upper-left.
export type PlacementFamily =
  // Imagery is the ground itself; type sits on or within it.
  | 'immersive'
  // The visual weight is pinned to one corner or edge and cropped by it.
  | 'anchored'
  // A single non-orthogonal edge cuts the canvas into unequal parts.
  | 'divided'
  // One contained shape at the optical centre, with the ground reading around it.
  | 'centred'
  // Clear horizontal registers, with the weight in one of them.
  | 'stacked'
  // The type IS the image; imagery is incidental.
  | 'typographic';

// Whether the anchor needs the poster to carry substantial imagery. 'either' anchors work on a
// poster carried by type, colour and graphic devices alone.
export type PlacementImagery = 'required' | 'either';

export type PosterPlacement = Readonly<{
  // Stable id — persisted in generations.poster_style and used by the recency ring and by the
  // redo, which bars the previous run's id. Never rename one.
  id: string;
  // Short English name, for logs.
  name: string;
  // Marathi label, shown to the officer on the generation detail page.
  label: string;
  family: PlacementFamily;
  imagery: PlacementImagery;
  // The most content items this arrangement can hold well. Absent = no ceiling. This is the
  // filter that makes a firmly-stated anchor safe: an arrangement that gives most of the canvas
  // to imagery cannot also carry nine points, so it is never offered a nine-point run.
  maxItems?: number | undefined;
  // The arrangement instruction, injected verbatim into the fresh image prompt. PLACEMENT ONLY —
  // if a sentence here starts naming what goes in a zone, it has become an archetype again.
  instruction: string;
}>;

export const POSTER_PLACEMENTS: readonly PosterPlacement[] = [
  {
    id: 'full_bleed_ground',
    name: 'Full-bleed imagery as the ground',
    label: 'पूर्ण पडद्यावर प्रतिमा',
    family: 'immersive',
    imagery: 'required',
    maxItems: 5,
    instruction:
      "the imagery fills the ENTIRE canvas edge to edge as the poster's own ground — no border, no panel, no rectangle around it — with the focal subject placed deliberately off-centre, and the Marathi type set directly on the image in its calmest region.",
  },
  {
    id: 'layered_overlap',
    name: 'Overlapping layers',
    label: 'एकावर एक थर',
    family: 'immersive',
    imagery: 'either',
    maxItems: 6,
    instruction:
      'the elements deliberately OVERLAP instead of sitting in separate zones: the main image or a large colour shape passes partly behind and partly in front of the type, with a clear front-to-back order, so the poster reads in layers rather than in blocks.',
  },
  {
    id: 'corner_lower_right',
    name: 'Weight in the lower-right corner',
    label: 'उजवा-खालचा कोपरा',
    family: 'anchored',
    imagery: 'either',
    instruction:
      'the visual weight anchors in the LOWER-RIGHT corner, with the focal element set large and cropped off both the right and the bottom edge; the Marathi type occupies the diagonally opposite upper-left, so the poster reads across one open diagonal.',
  },
  {
    id: 'corner_upper_left',
    name: 'Weight in the upper-left corner',
    label: 'डावा-वरचा कोपरा',
    family: 'anchored',
    imagery: 'either',
    instruction:
      'the visual weight anchors in the UPPER-LEFT corner, with the focal element cropped off both the top and the left edge; the Marathi type gathers towards the lower-right against open ground.',
  },
  {
    id: 'base_weighted',
    name: 'Weighted along the base',
    label: 'तळाशी वजन',
    family: 'anchored',
    imagery: 'either',
    instruction:
      'the lower part of the canvas carries the weight — the focal imagery or a heavy colour mass runs the full width along the bottom and bleeds off the bottom and both side edges — while the Marathi type sits above it in a distinctly airier upper area.',
  },
  {
    id: 'diagonal_cut',
    name: 'Unequal diagonal cut',
    label: 'तिरपा छेद',
    family: 'divided',
    imagery: 'either',
    instruction:
      'one straight ANGLED edge cuts the canvas into two clearly UNEQUAL parts — never a halving, and never a plain horizontal or vertical line; the focal imagery or colour mass takes the larger part and the Marathi type the smaller, with the type itself staying level rather than set along the angle.',
  },
  {
    id: 'curved_divide',
    name: 'Sweeping curve',
    label: 'वळणदार विभाजन',
    family: 'divided',
    imagery: 'either',
    instruction:
      "one broad CURVE or arc sweeps right across the canvas and separates the imagery or colour mass from the type; that curve is the poster's main graphic gesture, and the Marathi type sits clear of it rather than being set along it.",
  },
  {
    id: 'centre_medallion',
    name: 'Centred medallion',
    label: 'मध्यवर्ती वर्तुळ',
    family: 'centred',
    imagery: 'required',
    maxItems: 5,
    instruction:
      'one contained subject sits at the optical centre inside a strong geometric aperture — a circle, an arch, a rounded window — with the ground reading clearly all around it, and the Marathi type set in balanced registers above and below rather than beside it.',
  },
  {
    id: 'arch_window',
    name: 'Tall arched window',
    label: 'कमानी चौकट',
    family: 'centred',
    imagery: 'required',
    maxItems: 6,
    instruction:
      'the imagery sits inside a tall arch-topped window occupying roughly two-thirds of the height on ONE side only, so open ground breathes around it, and the Marathi type wraps around that arch rather than forming a straight column beside it.',
  },
  {
    id: 'inset_frame',
    name: 'Content inset in a broad frame',
    label: 'चौफेर कड',
    family: 'centred',
    imagery: 'either',
    instruction:
      'a broad band of colour, pattern, texture or imagery runs around all four edges as a frame, and the whole of the content sits inset within it with a generous, even margin on every side.',
  },
  {
    id: 'top_bleed_dominant',
    name: 'Imagery dominating the top',
    label: 'वरून पूर्ण प्रतिमा',
    family: 'stacked',
    imagery: 'required',
    maxItems: 6,
    instruction:
      'the imagery dominates the UPPER two-thirds of the canvas, bleeding off the top and both side edges with no border or frame, and every piece of Marathi type gathers into the lower third.',
  },
  {
    id: 'horizon_band',
    name: 'Central horizontal band',
    label: 'मधली आडवी पट्टी',
    family: 'stacked',
    imagery: 'required',
    instruction:
      'one strong horizontal band of imagery runs edge to edge across the MIDDLE of the canvas, with Marathi type both above it and below it, so the image is the centre of the poster rather than its background.',
  },
  {
    id: 'low_horizon',
    name: 'Low subject, open field above',
    label: 'खालचे क्षितिज',
    family: 'stacked',
    imagery: 'either',
    instruction:
      'the focal subject sits LOW in the frame and comparatively small, with a large open field of colour, sky or texture above it, and that open field carries the headline at generous size.',
  },
  {
    id: 'type_dominant',
    name: 'Type as the image',
    label: 'अक्षरेच मुख्य',
    family: 'typographic',
    imagery: 'either',
    maxItems: 4,
    instruction:
      'the Marathi headline IS the image: set enormous, filling most of the canvas and shaped deliberately as a graphic object, with any imagery reduced to a small supporting element, a motif, or a texture behind the letterforms.',
  },
];

// What the content can actually carry. Both fields are derived deterministically and free — no
// model call decides eligibility.
export type PlacementNeed = Readonly<{
  // Whether this poster will carry substantial imagery. On the fresh lane the model invents the
  // imagery, so this is normally true; it exists for the text-only case rather than as decoration.
  hasImagery: boolean;
  // How many distinct content items the poster must show. 0 = unknown/none, which bars nothing.
  itemCount: number;
}>;

// What the last few runs used, so this one differs. Family matters more than id, for the same
// reason coverage did in poster-layouts.ts: two `anchored` posters read alike.
export type PlacementAvoid = Readonly<{
  ids?: readonly string[] | undefined;
  families?: readonly PlacementFamily[] | undefined;
}>;

// Deterministic 32-bit hash (FNV-1a), matching poster-palettes.ts / poster-layouts.ts so the same
// seed reproduces the same pick on a retry.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Anchors this content can carry. Both rules are absolute in the direction that matters — an
// imagery-led arrangement with no imagery, or a five-item arrangement carrying nine items, is a
// worse poster than the default this whole module exists to displace. The pool is never allowed
// to empty: if a filter would leave nothing, it is skipped, exactly as pickLayout does.
export function eligiblePlacements(
  need: PlacementNeed,
): readonly PosterPlacement[] {
  const byImagery = need.hasImagery
    ? POSTER_PLACEMENTS
    : POSTER_PLACEMENTS.filter((p) => p.imagery !== 'required');
  const pool = byImagery.length > 0 ? byImagery : POSTER_PLACEMENTS;
  if (need.itemCount <= 0) return pool;
  const byCapacity = pool.filter(
    (p) => p.maxItems === undefined || need.itemCount <= p.maxItems,
  );
  return byCapacity.length > 0 ? byCapacity : pool;
}

// Pick one arrangement for a run. Deterministic in `seed` (a retry must reproduce the same poster
// rather than redesign it); spread away from the recent runs' families first, then their exact
// ids. `avoid` is also how the redo button guarantees a different shape — the runner passes the
// current version's placement and family, so the next render cannot be handed either.
export function pickPlacement(
  seed: string,
  need: PlacementNeed,
  avoid: PlacementAvoid = {},
): PosterPlacement {
  let pool = eligiblePlacements(need);

  const families = new Set(avoid.families ?? []);
  if (families.size > 0) {
    const spread = pool.filter((p) => !families.has(p.family));
    if (spread.length > 0) pool = spread;
  }

  const ids = new Set(avoid.ids ?? []);
  if (ids.size > 0) {
    const spread = pool.filter((p) => !ids.has(p.id));
    if (spread.length > 0) pool = spread;
  }

  const index = hashString(seed) % pool.length;
  return pool[index] as PosterPlacement;
}

// Look one up by id — used to label a stored run's arrangement for the UI, and by the redo to
// turn the stored id back into the family it has to avoid. Returns null for an id written by an
// older build whose anchor has since been removed.
export function placementById(
  id: string | null | undefined,
): PosterPlacement | null {
  if (!id) return null;
  return POSTER_PLACEMENTS.find((p) => p.id === id) ?? null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/poster-placements.ts
// Offline assertions: the content filters are absolute, the rotation spreads, and a redo that
// bars the current anchor cannot return it. No model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const FAMILY_RING = 3;
  const ID_RING = 5;
  const RUNS = 24;
  const failures: string[] = [];

  console.log(`Library: ${POSTER_PLACEMENTS.length} placement anchors\n`);
  for (const p of POSTER_PLACEMENTS) {
    console.log(
      `  ${p.id.padEnd(20)} ${p.family.padEnd(12)} imagery=${p.imagery.padEnd(8)} maxItems=${p.maxItems ?? '-'}`,
    );
  }

  // 0. Every family is represented, or the ring can bar the library down to one entry.
  const families = new Set(POSTER_PLACEMENTS.map((p) => p.family));
  if (families.size < 5)
    failures.push(`only ${families.size} placement families exist`);

  // 1. THE CONTENT FILTERS ARE ABSOLUTE. This is what lets the prompt state the arrangement
  //    firmly instead of hedging it: an anchor is only ever assigned to content that can carry
  //    it. If either of these ever fails, the block in build-poster-prompt.ts must be softened
  //    or the library fixed — a firm instruction the content cannot satisfy is the one failure
  //    mode worse than the boring default.
  for (let items = 1; items <= 12; items += 1) {
    for (let i = 0; i < 30; i += 1) {
      const noImagery = pickPlacement(`s${i}-${items}`, {
        hasImagery: false,
        itemCount: items,
      });
      if (noImagery.imagery === 'required')
        failures.push(
          `a text-only poster (${items} items) was assigned imagery-led anchor ${noImagery.id}`,
        );
      const withImagery = pickPlacement(`s${i}-${items}`, {
        hasImagery: true,
        itemCount: items,
      });
      for (const chosen of [noImagery, withImagery]) {
        if (chosen.maxItems !== undefined && items > chosen.maxItems)
          failures.push(
            `${items} items were assigned ${chosen.id}, which holds ${chosen.maxItems}`,
          );
      }
    }
  }

  // 2. A long note must still get an anchor — the capacity filter narrows the pool, it never
  //    empties it. 12 items exceeds every cap in the library except the uncapped anchors.
  const long = pickPlacement('long-note', { hasImagery: true, itemCount: 12 });
  if (long.maxItems !== undefined)
    failures.push(`a 12-item run got capped anchor ${long.id}`);
  // …and a text-only twelve-item run, the narrowest case there is, still resolves.
  const narrow = pickPlacement('narrow', { hasImagery: false, itemCount: 12 });
  if (!narrow) failures.push('the narrowest need returned no anchor');

  // 3. An unknown item count (the verbatim lane before anything is counted) bars nothing.
  if (
    eligiblePlacements({ hasImagery: true, itemCount: 0 }).length !==
    POSTER_PLACEMENTS.length
  )
    failures.push('itemCount 0 narrowed the pool; it should bar nothing');

  // 4. THE ROTATION SPREADS. No family repeats back to back, which is the whole point — two
  //    `anchored` posters read alike even when one bleeds off a different corner.
  console.log(`\nSimulating ${RUNS} runs (imagery, 4 items):\n`);
  const familyRing: PlacementFamily[] = [];
  const idRing: string[] = [];
  const picks: PosterPlacement[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const chosen = pickPlacement(
      `harness-run-${i}`,
      { hasImagery: true, itemCount: 4 },
      { families: familyRing, ids: idRing },
    );
    picks.push(chosen);
    console.log(
      `run ${String(i).padStart(2)} -> ${chosen.family.padEnd(12)} ${chosen.id}`,
    );
    familyRing.unshift(chosen.family);
    familyRing.splice(FAMILY_RING);
    idRing.unshift(chosen.id);
    idRing.splice(ID_RING);
  }
  for (let i = 1; i < picks.length; i += 1) {
    const a = picks[i] as PosterPlacement;
    const b = picks[i - 1] as PosterPlacement;
    if (a.id === b.id)
      failures.push(`anchor ${a.id} repeated back-to-back at run ${i}`);
    if (a.family === b.family)
      failures.push(`family ${a.family} repeated back-to-back at run ${i}`);
  }
  const distinct = new Set(picks.map((p) => p.id)).size;
  if (distinct < 6)
    failures.push(`only ${distinct} distinct anchors across ${RUNS} runs`);

  // 5. THE REDO GUARANTEE. Barring the current anchor AND its family must change the shape, at
  //    every seed — this is the mechanism behind "the reload button must produce a different
  //    poster", and it must not depend on a new seed happening to land elsewhere.
  for (const current of POSTER_PLACEMENTS) {
    for (let v = 2; v <= 6; v += 1) {
      const redo = pickPlacement(
        `gen-id:v${v}`,
        { hasImagery: true, itemCount: 4 },
        { ids: [current.id], families: [current.family] },
      );
      if (redo.id === current.id)
        failures.push(
          `a redo of ${current.id} at v${v} returned the same anchor`,
        );
      if (redo.family === current.family)
        failures.push(
          `a redo of ${current.id} at v${v} stayed in family ${current.family}`,
        );
    }
  }

  // 6. Determinism: the same seed and need reproduce the same pick.
  const need: PlacementNeed = { hasImagery: true, itemCount: 3 };
  if (pickPlacement('stable', need).id !== pickPlacement('stable', need).id)
    failures.push('pickPlacement is not deterministic in its seed');

  // 7. Lookup round trip, and junk is null rather than a throw.
  for (const p of POSTER_PLACEMENTS) {
    if (placementById(p.id)?.id !== p.id)
      failures.push(`placementById lost ${p.id}`);
  }
  for (const junk of [null, undefined, '', 'gone']) {
    if (placementById(junk) !== null)
      failures.push(`placementById(${String(junk)}) did not return null`);
  }

  // 8. AN ANCHOR IS NOT AN ARCHETYPE. The retired composition library specified the whole poster;
  //    if a sentence here starts naming what goes in a zone, this module has become
  //    poster-layouts.ts again and the 2026-08-10 hand-over is undone. Cheap lexical guard, aimed
  //    at the vocabulary that spec was written in.
  for (const p of POSTER_PLACEMENTS) {
    for (const banned of [
      'kicker',
      'reversed-out',
      'bullet',
      'card',
      'icon above',
      'rounded panel',
      'thin rules',
    ]) {
      if (p.instruction.toLowerCase().includes(banned))
        failures.push(
          `${p.id} specifies poster contents ("${banned}") — an anchor states placement only`,
        );
    }
    if (p.instruction.length > 420)
      failures.push(
        `${p.id} is ${p.instruction.length} chars — an anchor is a sentence, not a spec`,
      );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll placement-rotation assertions passed.');
  }
}
