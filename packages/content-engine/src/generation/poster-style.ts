// The visual style ONE social poster run was assigned, and what its render actually measured.
// This is the shape persisted in `generations.poster_style` (migration 0028).
//
// Why it exists as its own module: the palette rotation and the composition rotation each own
// their own library, but what a RUN is assigned is one thing, it is stored as one jsonb value,
// and the next run reads a list of them back to decide what to avoid. Putting the shape beside
// the two libraries whose ids it stores keeps the ids, the labels and the parser together — a
// duplicate definition in @dgipr/schemas would be free to drift from the union types here, and
// the web never needs the shape anyway (the API sends it a flattened Marathi label).
//
// Everything here tolerates junk. A row may have been written by an older build, by a build with
// a palette that has since been renamed, or (in principle) by hand — so `parsePosterStyle`
// returns null rather than throwing, and a null just means "no history for this run", which every
// caller already handles because that is what a pre-0028 row looks like.

import { pathToFileURL } from 'node:url';
import {
  paletteById,
  type PaletteFamily,
  type PosterPalette,
} from './poster-palettes.js';
import {
  layoutById,
  type LayoutCoverage,
  type PosterLayout,
} from './poster-layouts.js';
import {
  articleLayoutById,
  type ArticlePosterLayout,
} from './article-poster-layouts.js';
import {
  placementById,
  type PlacementFamily,
  type PosterPlacement,
} from './poster-placements.js';

// Both poster kinds store their assigned composition in the SAME `generations.poster_style`
// column, and they draw from two different libraries — portrait social archetypes
// (poster-layouts.ts) and landscape article ones (article-poster-layouts.ts). Article ids are
// namespaced `art_`, so one lookup across both is unambiguous, and everything below can stay
// kind-agnostic: it only ever needs an id's coverage, name and Marathi label.
type AnyLayout = PosterLayout | ArticlePosterLayout;

function anyLayoutById(id: string | null | undefined): AnyLayout | null {
  return layoutById(id) ?? articleLayoutById(id);
}

// What the rendered poster measured (poster-renderer's `measurePosterColours`). Redeclared
// structurally rather than imported because content-engine does not depend on poster-renderer —
// the API is what joins the two. Keep the field names identical to `PosterColours`.
export type MeasuredColours = Readonly<{
  groundHex: string;
  groundIsWarm: boolean;
  dominantHex: string;
  hueBucket: string;
  colourfulness: number;
}>;

export type PosterStyle = Readonly<{
  paletteId: string;
  family: PaletteFamily;
  layoutId: string;
  coverage: LayoutCoverage;
  // The ARRANGEMENT the fresh social lane was assigned (poster-placements.ts, 2026-08-14) —
  // optional because no row written before that date has one, because the article lane does not
  // use this library, and because the template-edit modes are assigned nothing at all. jsonb, so
  // adding it needed no migration: 0028's column has no column schema.
  //
  // Unlike `layoutId` beside it, this one DOES reach the image prompt, and that asymmetry is the
  // thing to know when reading a stored style. The layout is a rotation that no longer influences
  // the render (retired 2026-08-10, kept for the id history); the placement is what the poster was
  // actually asked to be arranged as. It is persisted for two readers: the recency ring, and the
  // redo button, which bars this exact id and family so the next version cannot repeat the shape.
  placementId?: string | undefined;
  placementFamily?: PlacementFamily | undefined;
  // Absent when the render failed before it could be measured, or on a CMO/edit-mode run.
  measured?: MeasuredColours | undefined;
}>;

// What the last few runs used, ready to hand to pickPalette + pickLayout. `measuredBuckets` is
// the one that matters most: it is what SHIPPED, so avoiding it works even when the image model
// ignores the assignment entirely — which avoiding intentions cannot do.
export type StyleHistory = Readonly<{
  paletteIds: readonly string[];
  families: readonly PaletteFamily[];
  layoutIds: readonly string[];
  coverages: readonly LayoutCoverage[];
  // The arrangements the last few fresh social posters were assigned. These are the ring that
  // most directly answers "why does every poster look the same shape", because unlike the layout
  // ids above them they describe something the image model was actually told.
  placementIds: readonly string[];
  placementFamilies: readonly PlacementFamily[];
  measuredBuckets: readonly string[];
  // One human-readable line per recent poster, newest first, for the art director's
  // "design something different from these" brief.
  treatments: readonly string[];
}>;

export const EMPTY_STYLE_HISTORY: StyleHistory = {
  paletteIds: [],
  families: [],
  layoutIds: [],
  coverages: [],
  placementIds: [],
  placementFamilies: [],
  measuredBuckets: [],
  treatments: [],
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMeasured(value: unknown): MeasuredColours | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  const groundHex = str(m.groundHex);
  const dominantHex = str(m.dominantHex);
  if (groundHex.length === 0 || dominantHex.length === 0) return null;
  return {
    groundHex,
    groundIsWarm: m.groundIsWarm === true,
    dominantHex,
    hueBucket: str(m.hueBucket) || 'neutral',
    colourfulness: typeof m.colourfulness === 'number' ? m.colourfulness : 0,
  };
}

// Read one stored style. Returns null for anything unusable — including a style whose palette or
// layout id no longer exists in the library, since an id we cannot resolve tells the next run
// nothing about what to avoid.
export function parsePosterStyle(value: unknown): PosterStyle | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const palette = paletteById(str(raw.paletteId));
  const layout = anyLayoutById(str(raw.layoutId));
  if (!palette || !layout) return null;
  const measured = parseMeasured(raw.measured);
  // An unresolvable or absent placement is NOT fatal to the style, unlike the palette and layout
  // above: every row written before 2026-08-14, every article run and every template-edit run
  // legitimately has none, and nulling those would throw away their colour history too.
  const placement = placementById(str(raw.placementId));
  return {
    paletteId: palette.id,
    // Trust the library over the stored copy: if a palette was re-classified, the CURRENT
    // family is what the rotation should spread against.
    family: palette.family,
    layoutId: layout.id,
    coverage: layout.coverage,
    // Same "trust the library" rule as the palette family — a re-classified anchor spreads
    // against where it sits now, not where it sat when the row was written.
    ...(placement
      ? { placementId: placement.id, placementFamily: placement.family }
      : {}),
    ...(measured ? { measured } : {}),
  };
}

// Build the style a run is about to render with. `measured` is folded in after the render.
export function buildPosterStyle(
  palette: PosterPalette,
  // Either library's archetype — the social and article paths both call this.
  layout: AnyLayout,
  measured?: MeasuredColours | undefined,
  // Fresh social runs only; the article lane and the template-edit modes pass nothing.
  placement?: PosterPlacement | undefined,
): PosterStyle {
  return {
    paletteId: palette.id,
    family: palette.family,
    layoutId: layout.id,
    coverage: layout.coverage,
    ...(placement
      ? { placementId: placement.id, placementFamily: placement.family }
      : {}),
    ...(measured ? { measured } : {}),
  };
}

// Which measured hue buckets count as "the assigned family was honoured".
//
// The mapping is deliberately GENEROUS, because it exists only to log a warning. A palette's
// dominant colour is whatever has the most chroma-weighted area, which for a mostly-neutral
// palette is usually its ACCENT rather than its panel — charcoal_mono's emerald accent, say. A
// tight mapping would cry wolf on posters that are perfectly correct. What it must catch is the
// real failure: a cool/green/purple assignment coming back saffron.
//
// 'neutral' accepts everything by design: its three palettes are a near-colourless panel plus one
// vivid accent of a deliberately different hue each, so no bucket is evidence of anything.
export const FAMILY_HUES: Readonly<Record<PaletteFamily, readonly string[]>> = {
  cool: ['blue', 'purple', 'teal'],
  teal: ['teal', 'blue', 'green'],
  green: ['green', 'teal', 'yellow'],
  purple: ['purple', 'blue', 'red'],
  neutral: ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'neutral'],
  warm: ['orange', 'red', 'yellow'],
};

// Did the render honour its assigned family? A 'neutral' measurement is never a violation — an
// almost colourless poster has no hue to disagree with.
export function familyHonoured(family: PaletteFamily, hueBucket: string): boolean {
  if (hueBucket === 'neutral') return true;
  return FAMILY_HUES[family].includes(hueBucket);
}

// One human-readable line describing a past poster, for the art director's negative memory.
// Names the intended treatment and, when they disagree, what actually shipped — a poster that
// was assigned a cool palette and came out warm should be avoided as WARM.
export function describePosterStyle(style: PosterStyle): string {
  const palette = paletteById(style.paletteId);
  const layout = anyLayoutById(style.layoutId);
  // The ARRANGEMENT is what the image model was told, so it describes the poster; the layout is a
  // rotation that has not reached a prompt since 2026-08-10. Prefer the one that is true.
  const placement = placementById(style.placementId);
  const parts = [
    palette?.palette ?? style.paletteId,
    placement?.name ?? layout?.name ?? style.layoutId,
  ];
  if (style.measured && style.measured.groundIsWarm) {
    parts.push('rendered with a warm cream background');
  }
  return parts.join(', ');
}

// Fold the newest-first list of stored styles into the avoid sets the pickers take.
//
// The ring depths differ on purpose, and the reasoning is the same each time: bar as much as can
// be barred without emptying the pool. There are 6 families, so barring 3 still leaves half the
// library; 5 coverages, so barring 2 leaves three; 18 palettes and 11 layouts, so their id rings
// are the deepest. A picker skips any filter that would leave nothing, so these are safe
// upper bounds rather than promises.
export const FAMILY_RING = 3;
export const COVERAGE_RING = 2;
export const PALETTE_ID_RING = 5;
export const LAYOUT_ID_RING = 4;
export const BUCKET_RING = 3;
export const TREATMENT_RING = 4;
// 14 anchors across 6 families, so barring 3 families still leaves at least half the library and
// barring 5 ids leaves nine. Both are upper bounds, not promises — pickPlacement skips any filter
// that would empty the pool.
export const PLACEMENT_FAMILY_RING = 3;
export const PLACEMENT_ID_RING = 5;

export function toStyleHistory(stored: readonly unknown[]): StyleHistory {
  const styles = stored
    .map(parsePosterStyle)
    .filter((s): s is PosterStyle => s !== null);
  if (styles.length === 0) return EMPTY_STYLE_HISTORY;

  // De-duplicate while preserving newest-first order: a family used three runs ago and again
  // last run should occupy ONE slot in the ring, not two, or a deep ring fills up with repeats
  // and stops barring anything new.
  const dedupe = <T,>(values: readonly T[], cap: number): T[] => {
    const seen = new Set<T>();
    const out: T[] = [];
    for (const value of values) {
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= cap) break;
    }
    return out;
  };

  return {
    paletteIds: dedupe(styles.map((s) => s.paletteId), PALETTE_ID_RING),
    families: dedupe(styles.map((s) => s.family), FAMILY_RING),
    layoutIds: dedupe(styles.map((s) => s.layoutId), LAYOUT_ID_RING),
    coverages: dedupe(styles.map((s) => s.coverage), COVERAGE_RING),
    // Filtered before de-duplication: a run with no placement (article, template-edit, or any
    // row older than 2026-08-14) must not occupy a ring slot with an empty string, or a few
    // legacy rows would fill the ring and stop it barring anything real.
    placementIds: dedupe(
      styles.map((s) => s.placementId ?? '').filter((id) => id.length > 0),
      PLACEMENT_ID_RING,
    ),
    placementFamilies: dedupe(
      styles
        .map((s) => s.placementFamily)
        .filter((f): f is PlacementFamily => f !== undefined),
      PLACEMENT_FAMILY_RING,
    ),
    measuredBuckets: dedupe(
      styles
        .map((s) => s.measured?.hueBucket ?? '')
        .filter((b) => b.length > 0 && b !== 'neutral'),
      BUCKET_RING,
    ),
    treatments: styles.slice(0, TREATMENT_RING).map(describePosterStyle),
  };
}

// The Marathi label shown to the officer on the generation detail page, e.g.
// "गडद नीलम व पोर्सिलेन · डावी रंगपट्टी". Returns null when the run has no usable style.
export function posterStyleLabel(value: unknown): string | null {
  const style = parsePosterStyle(value);
  if (!style) return null;
  const palette = paletteById(style.paletteId);
  const layout = anyLayoutById(style.layoutId);
  // Same choice as describePosterStyle, and here it matters to the officer rather than to a log:
  // the label sits under the poster on the detail page, so it must name the arrangement the
  // poster was actually asked for rather than a rotation nothing acted on.
  const placement = placementById(style.placementId);
  const parts = [palette?.label, placement?.label ?? layout?.label].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/poster-style.ts
// Offline assertions over the parse/history/label round trip, including the junk a real column
// will eventually contain. No model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures: string[] = [];
  const { POSTER_PALETTES } = await import('./poster-palettes.js');
  const { POSTER_LAYOUTS } = await import('./poster-layouts.js');

  const palette = POSTER_PALETTES[0] as PosterPalette;
  const layout = POSTER_LAYOUTS[0] as PosterLayout;

  // 1. Round trip.
  const built = buildPosterStyle(palette, layout, {
    groundHex: '#FAF2E2',
    groundIsWarm: true,
    dominantHex: '#B24B1D',
    hueBucket: 'orange',
    colourfulness: 0.65,
  });
  const parsed = parsePosterStyle(JSON.parse(JSON.stringify(built)));
  if (!parsed) failures.push('a freshly built style failed to parse back');
  if (parsed && parsed.measured?.hueBucket !== 'orange') {
    failures.push('measured colours were lost in the round trip');
  }

  // 2. Junk must yield null, never throw.
  for (const junk of [null, undefined, 0, 'x', {}, { paletteId: 'gone', layoutId: 'gone' }]) {
    if (parsePosterStyle(junk) !== null) failures.push(`junk ${JSON.stringify(junk)} parsed`);
  }

  // 3. History de-duplicates and respects the ring caps.
  const history = toStyleHistory([
    buildPosterStyle(POSTER_PALETTES[0] as PosterPalette, POSTER_LAYOUTS[0] as PosterLayout),
    buildPosterStyle(POSTER_PALETTES[1] as PosterPalette, POSTER_LAYOUTS[1] as PosterLayout),
    // Same family as [0] would be — force a duplicate by repeating the entry outright.
    buildPosterStyle(POSTER_PALETTES[0] as PosterPalette, POSTER_LAYOUTS[0] as PosterLayout),
    { garbage: true },
    buildPosterStyle(POSTER_PALETTES[5] as PosterPalette, POSTER_LAYOUTS[3] as PosterLayout),
  ]);
  if (new Set(history.paletteIds).size !== history.paletteIds.length) {
    failures.push('paletteIds contain duplicates');
  }
  if (new Set(history.families).size !== history.families.length) {
    failures.push('families contain duplicates');
  }
  if (history.families.length > FAMILY_RING) failures.push('family ring exceeded its cap');
  if (history.coverages.length > COVERAGE_RING) failures.push('coverage ring exceeded its cap');
  if (history.treatments.length === 0) failures.push('no treatments produced for the brief');
  console.log(JSON.stringify(history, null, 2));

  // 4. Empty / all-junk history is the neutral value, not a crash.
  if (toStyleHistory([]).families.length !== 0) failures.push('empty history was not empty');
  if (toStyleHistory([{ x: 1 }, null]).paletteIds.length !== 0) {
    failures.push('all-junk history was not empty');
  }

  // 5. The Marathi label resolves and is not just punctuation.
  const label = posterStyleLabel(built);
  if (!label || !label.includes('·')) failures.push(`unexpected label: ${label}`);
  console.log(`\nlabel: ${label}`);
  if (posterStyleLabel({ paletteId: 'gone' }) !== null) {
    failures.push('an unresolvable style produced a label');
  }

  // 6. An ARTICLE run's style resolves through the same functions — the layout id comes from the
  //    landscape library, and one column stores both kinds.
  {
    const { ARTICLE_POSTER_LAYOUTS } = await import('./article-poster-layouts.js');
    const articleLayout = ARTICLE_POSTER_LAYOUTS[0] as ArticlePosterLayout;
    const articleStyle = buildPosterStyle(palette, articleLayout, {
      groundHex: '#EEF1F7',
      groundIsWarm: false,
      dominantHex: '#26356B',
      hueBucket: 'blue',
      colourfulness: 0.4,
    });
    const back = parsePosterStyle(JSON.parse(JSON.stringify(articleStyle)));
    if (!back) failures.push('an article style failed to parse back');
    if (back && back.layoutId !== articleLayout.id) {
      failures.push(`article layout id lost in the round trip: ${back.layoutId}`);
    }
    const articleLabel = posterStyleLabel(articleStyle);
    if (!articleLabel || !articleLabel.includes(articleLayout.label)) {
      failures.push(`article style produced no Marathi label: ${articleLabel}`);
    }
    console.log(`article label: ${articleLabel}`);
    // The history helper must work over a MIXED list too (both kinds share the column, even if
    // the API queries them apart by category).
    const mixed = toStyleHistory([articleStyle, built]);
    if (mixed.layoutIds.length !== 2) {
      failures.push(`mixed history lost a layout: ${JSON.stringify(mixed.layoutIds)}`);
    }
  }

  // 7. THE ARRANGEMENT (2026-08-14). It shares the 0028 column with everything above and had no
  //    migration, so the two things that matter are that it survives a round trip and that its
  //    ABSENCE is harmless — every row written before it, every article run and every
  //    template-edit run legitimately has none, and nulling those would throw away their colour
  //    history as well.
  {
    const { POSTER_PLACEMENTS, placementById } = await import(
      './poster-placements.js'
    );
    const anchor = POSTER_PLACEMENTS[2] as PosterPlacement;
    const withPlacement = buildPosterStyle(palette, layout, undefined, anchor);
    const backP = parsePosterStyle(JSON.parse(JSON.stringify(withPlacement)));
    if (backP?.placementId !== anchor.id)
      failures.push(`the placement was lost in the round trip: ${backP?.placementId}`);
    if (backP?.placementFamily !== anchor.family)
      failures.push('the placement family was not resolved from the library');

    // A style with NO placement still parses — this is the pre-2026-08-14 row, and it is the
    // majority of the table.
    const legacy = parsePosterStyle(JSON.parse(JSON.stringify(built)));
    if (!legacy) failures.push('a style with no placement failed to parse');
    if (legacy?.placementId !== undefined)
      failures.push('a style with no placement invented one');
    // …and so does one naming an anchor the library no longer has: it loses the arrangement,
    // never the whole style.
    const stale = parsePosterStyle({
      ...JSON.parse(JSON.stringify(withPlacement)),
      placementId: 'retired_anchor',
    });
    if (!stale) failures.push('an unresolvable placement nulled the whole style');
    if (stale?.placementId !== undefined)
      failures.push('an unresolvable placement id survived the parse');

    // The label names the ARRANGEMENT, not the layout: the layout is a rotation that has not
    // reached a prompt since 2026-08-10, and the officer reads this under the poster.
    const labelled = posterStyleLabel(withPlacement);
    if (!labelled?.includes(anchor.label))
      failures.push(`the label does not name the arrangement: ${labelled}`);
    if (labelled?.includes(layout.label))
      failures.push(
        'the label still names the retired composition rotation beside the arrangement',
      );
    // An article/legacy row has no arrangement, so it keeps naming its layout rather than losing
    // half its label.
    if (!posterStyleLabel(built)?.includes(layout.label))
      failures.push('a style with no arrangement lost its layout label');

    // The history ring carries placements, and a run WITHOUT one must not occupy a slot — a few
    // legacy rows would otherwise fill the ring and stop it barring anything real.
    const mixedHistory = toStyleHistory([
      withPlacement,
      built,
      buildPosterStyle(
        POSTER_PALETTES[3] as PosterPalette,
        POSTER_LAYOUTS[2] as PosterLayout,
        undefined,
        POSTER_PLACEMENTS[7] as PosterPlacement,
      ),
    ]);
    if (mixedHistory.placementIds.length !== 2)
      failures.push(
        `placement ring took ${mixedHistory.placementIds.length} entries from 2 placed + 1 unplaced style`,
      );
    if (mixedHistory.placementIds.some((id) => placementById(id) === null))
      failures.push('the placement ring carries an id the library cannot resolve');
    if (mixedHistory.placementFamilies.length === 0)
      failures.push('the placement family ring came back empty');
    if (EMPTY_STYLE_HISTORY.placementIds.length !== 0)
      failures.push('the empty history is not empty for placements');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll poster-style assertions passed.');
  }
}
