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
import {
  parsePosterDesign,
  type DesignComposition,
  type DesignForm,
  type PosterDesign,
} from './poster-design-director.js';

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
  // Mean OKLab L and the share of dark pixels (2026-09-26). Optional: every row measured before
  // then lacks them, and they are monitoring only.
  lightness?: number | undefined;
  darkShare?: number | undefined;
}>;

// The design director's remembered direction (poster-design-director.ts), tagged with a version so
// a later change to the vocabulary can tell old rows apart.
export type StoredPosterDesign = PosterDesign & Readonly<{ v: 1 }>;

export type PosterStyle = Readonly<{
  // The palette and layout ASSIGNMENT. Optional since 2026-09-26: a fresh social run no longer
  // picks one (neither ever reached its prompt) and records `design` instead. The article lane
  // and every row written before that date still carry both.
  paletteId?: string | undefined;
  family?: PaletteFamily | undefined;
  layoutId?: string | undefined;
  coverage?: LayoutCoverage | undefined;
  // The fresh social lane's design direction — what the image model was actually told.
  design?: StoredPosterDesign | undefined;
  // The ARRANGEMENT the fresh social lane was assigned (poster-placements.ts, 2026-08-14) —
  // optional because no row written before that date has one, because the article lane does not
  // use this library, and because the template-edit modes are assigned nothing at all. jsonb, so
  // adding it needed no migration: 0028's column has no column schema.
  //
  // Like `layoutId` beside it, this no longer reaches the image prompt. Both values remain as
  // backward-compatible metadata while the fresh prompt keeps composition fully content-led.
  placementId?: string | undefined;
  placementFamily?: PlacementFamily | undefined;
  // Absent when the render failed before it could be measured, or on a CMO/edit-mode run.
  measured?: MeasuredColours | undefined;
}>;

// What the last few runs used, ready for the palette/layout history readers. Measured colours are
// what matter most: they describe what shipped even when the image model drifted from its prompt.
export type StyleHistory = Readonly<{
  paletteIds: readonly string[];
  families: readonly PaletteFamily[];
  layoutIds: readonly string[];
  coverages: readonly LayoutCoverage[];
  // Legacy arrangement rotation retained for older stored rows and redo compatibility.
  placementIds: readonly string[];
  placementFamilies: readonly PlacementFamily[];
  measuredBuckets: readonly string[];
  // Actual sampled colours, not merely the palette we asked for. The procedural social picker
  // uses perceptual distance from these values, so a model that drifted from its assigned palette
  // still teaches the next run what not to repeat.
  measuredDominantHexes: readonly string[];
  measuredGroundHexes: readonly string[];
  // The last few design directions, newest first, NOT de-duplicated — a repeated shape is exactly
  // the signal the design director needs to steer away from.
  designs: readonly PosterDesign[];
  // One human-readable line per recent poster, newest first. The article art director is the
  // remaining consumer; the fresh social lane makes no paid art-direction call.
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
  measuredDominantHexes: [],
  measuredGroundHexes: [],
  designs: [],
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
    ...(typeof m.lightness === 'number' ? { lightness: m.lightness } : {}),
    ...(typeof m.darkShare === 'number' ? { darkShare: m.darkShare } : {}),
  };
}

function parseStoredDesign(value: unknown): StoredPosterDesign | null {
  const design = parsePosterDesign(value);
  return design ? { ...design, v: 1 } : null;
}

// Read one stored style. Returns null for anything unusable — including a style whose palette or
// layout id no longer exists in the library, since an id we cannot resolve tells the next run
// nothing about what to avoid.
//
// A row carrying a `design` (a fresh social run since 2026-09-26) is usable on its own, with or
// without resolvable palette/layout ids — that direction is what the next run steers away from.
export function parsePosterStyle(value: unknown): PosterStyle | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const palette = paletteById(str(raw.paletteId));
  const layout = anyLayoutById(str(raw.layoutId));
  const design = parseStoredDesign(raw.design);
  const measured = parseMeasured(raw.measured);
  if (!palette || !layout) {
    if (!design) return null;
    return { design, ...(measured ? { measured } : {}) };
  }
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
    ...(design ? { design } : {}),
    ...(measured ? { measured } : {}),
  };
}

// The fresh social lane's style: the director's direction and what the render measured, with no
// palette or layout — neither reached the prompt, so recording them would be recording a fiction.
// Null when the director produced nothing: a measurement alone has no label to show.
export function buildDesignPosterStyle(
  design: PosterDesign | null | undefined,
  measured?: MeasuredColours | undefined,
): PosterStyle | null {
  if (!design) return null;
  return {
    design: {
      form: design.form,
      composition: design.composition,
      imagery: design.imagery,
      colourMood: design.colourMood,
      v: 1,
    },
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
  neutral: [
    'red',
    'orange',
    'yellow',
    'green',
    'teal',
    'blue',
    'purple',
    'neutral',
  ],
  warm: ['orange', 'red', 'yellow'],
};

// Did the render honour its assigned family? A 'neutral' measurement is never a violation — an
// almost colourless poster has no hue to disagree with.
export function familyHonoured(
  family: PaletteFamily,
  hueBucket: string,
): boolean {
  if (hueBucket === 'neutral') return true;
  return FAMILY_HUES[family].includes(hueBucket);
}

// One human-readable line describing a past poster, for the art director's negative memory.
// Names the intended treatment and, when they disagree, what actually shipped — a poster that
// was assigned a cool palette and came out warm should be avoided as WARM.
export function describePosterStyle(style: PosterStyle): string {
  if (style.design && !style.paletteId) {
    const d = style.design;
    const parts = [
      `${d.form.replace(/_/g, ' ')} poster, weight ${d.composition.replace(/_/g, ' ')}, ${d.colourMood} colour`,
    ];
    if (style.measured && style.measured.groundIsWarm) {
      parts.push('rendered with a warm cream background');
    }
    return parts.join(', ');
  }
  const palette = paletteById(style.paletteId);
  const layout = anyLayoutById(style.layoutId);
  // A stored placement marks a social run, where composition is now fully model-led. Do not claim
  // that unused metadata describes the render. Article runs have no placement and still use their
  // assigned landscape layout, so retain that description there.
  const placement = placementById(style.placementId);
  const parts = [
    palette?.palette ?? style.paletteId ?? '',
    ...(placement ? [] : [layout?.name ?? style.layoutId ?? '']),
  ].filter((p) => p.length > 0);
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
export const MEASURED_COLOUR_RING = 5;
export const TREATMENT_RING = 4;
// 14 anchors across 6 families, so barring 3 families still leaves at least half the library and
// barring 5 ids leaves nine. Both are upper bounds, not promises — pickPlacement skips any filter
// that would empty the pool.
export const PLACEMENT_FAMILY_RING = 3;
export const PLACEMENT_ID_RING = 5;
// The design director is shown the last five directions.
export const DESIGN_RING = 5;

export function toStyleHistory(stored: readonly unknown[]): StyleHistory {
  const styles = stored
    .map(parsePosterStyle)
    .filter((s): s is PosterStyle => s !== null);
  if (styles.length === 0) return EMPTY_STYLE_HISTORY;

  // De-duplicate while preserving newest-first order: a family used three runs ago and again
  // last run should occupy ONE slot in the ring, not two, or a deep ring fills up with repeats
  // and stops barring anything new.
  const dedupe = <T>(values: readonly T[], cap: number): T[] => {
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

  // A design-only row (fresh social, 2026-09-26) has no assignment and must not occupy a
  // palette/layout ring slot with an empty value.
  const defined = <T>(values: readonly (T | undefined)[]): T[] =>
    values.filter((v): v is T => v !== undefined && v !== '');

  return {
    paletteIds: dedupe(
      defined(styles.map((s) => s.paletteId)),
      PALETTE_ID_RING,
    ),
    families: dedupe(defined(styles.map((s) => s.family)), FAMILY_RING),
    layoutIds: dedupe(defined(styles.map((s) => s.layoutId)), LAYOUT_ID_RING),
    coverages: dedupe(defined(styles.map((s) => s.coverage)), COVERAGE_RING),
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
    measuredDominantHexes: dedupe(
      styles
        .map((s) => s.measured?.dominantHex ?? '')
        .filter((value) => value.length > 0),
      MEASURED_COLOUR_RING,
    ),
    measuredGroundHexes: dedupe(
      styles
        .map((s) => s.measured?.groundHex ?? '')
        .filter((value) => value.length > 0),
      MEASURED_COLOUR_RING,
    ),
    designs: defined(styles.map((s) => s.design))
      .slice(0, DESIGN_RING)
      .map(({ form, composition, imagery, colourMood }) => ({
        form,
        composition,
        imagery,
        colourMood,
      })),
    treatments: styles.slice(0, TREATMENT_RING).map(describePosterStyle),
  };
}

// The Marathi label shown to the officer on the generation detail page, e.g.
// "गडद नीलम व पोर्सिलेन · डावी रंगपट्टी". Returns null when the run has no usable style.
// Marathi names for the design director's vocabulary: form · where the visual weight sits.
const DESIGN_FORM_LABELS: Readonly<Record<DesignForm, string>> = {
  figure_led: 'आकडे ठळक',
  sequence: 'क्रमवार मांडणी',
  statement: 'एकच ठळक संदेश',
  grouped_sections: 'गटवार विभाग',
  split_columns: 'दोन स्तंभ',
  feature_and_supporting: 'मुख्य मुद्दा व पूरक माहिती',
  image_led: 'छायाचित्र-प्रधान',
  icon_list: 'चिन्हांसह यादी',
  other: 'मुक्त रचना',
};
const DESIGN_COMPOSITION_LABELS: Readonly<Record<DesignComposition, string>> = {
  top: 'वरचा भाग प्रधान',
  bottom: 'खालचा भाग प्रधान',
  left: 'डावी बाजू प्रधान',
  right: 'उजवी बाजू प्रधान',
  centre: 'मध्यवर्ती',
  full_bleed: 'पूर्ण कॅनव्हास',
  layered: 'स्तरित',
};

export function posterStyleLabel(value: unknown): string | null {
  const style = parsePosterStyle(value);
  if (!style) return null;
  // A fresh social run names what its image model was actually told — never a palette it did not
  // see (the "गडद प्रकाशमान" label on generation c0e28c9d was exactly that).
  if (style.design) {
    return `${DESIGN_FORM_LABELS[style.design.form]} · ${DESIGN_COMPOSITION_LABELS[style.design.composition]}`;
  }
  const palette = paletteById(style.paletteId);
  const layout = anyLayoutById(style.layoutId);
  // Do not show unused composition metadata beneath a fresh social poster. Article posters have
  // no placement record and continue to show the landscape layout that actually reached them.
  const placement = placementById(style.placementId);
  const parts = [palette?.label, ...(placement ? [] : [layout?.label])].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/poster-style.ts
// Offline assertions over the parse/history/label round trip, including the junk a real column
// will eventually contain. No model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
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
  for (const junk of [
    null,
    undefined,
    0,
    'x',
    {},
    { paletteId: 'gone', layoutId: 'gone' },
  ]) {
    if (parsePosterStyle(junk) !== null)
      failures.push(`junk ${JSON.stringify(junk)} parsed`);
  }

  // 3. History de-duplicates and respects the ring caps.
  const history = toStyleHistory([
    built,
    buildPosterStyle(
      POSTER_PALETTES[1] as PosterPalette,
      POSTER_LAYOUTS[1] as PosterLayout,
    ),
    // Same family as [0] would be — force a duplicate by repeating the entry outright.
    buildPosterStyle(
      POSTER_PALETTES[0] as PosterPalette,
      POSTER_LAYOUTS[0] as PosterLayout,
    ),
    { garbage: true },
    buildPosterStyle(
      POSTER_PALETTES[5] as PosterPalette,
      POSTER_LAYOUTS[3] as PosterLayout,
    ),
  ]);
  if (new Set(history.paletteIds).size !== history.paletteIds.length) {
    failures.push('paletteIds contain duplicates');
  }
  if (new Set(history.families).size !== history.families.length) {
    failures.push('families contain duplicates');
  }
  if (history.families.length > FAMILY_RING)
    failures.push('family ring exceeded its cap');
  if (history.coverages.length > COVERAGE_RING)
    failures.push('coverage ring exceeded its cap');
  if (history.treatments.length === 0)
    failures.push('no treatments produced for the brief');
  if (history.measuredDominantHexes[0] !== '#B24B1D') {
    failures.push('actual dominant colour was not carried into history');
  }
  if (history.measuredGroundHexes[0] !== '#FAF2E2') {
    failures.push('actual ground colour was not carried into history');
  }
  console.log(JSON.stringify(history, null, 2));

  // 4. Empty / all-junk history is the neutral value, not a crash.
  if (toStyleHistory([]).families.length !== 0)
    failures.push('empty history was not empty');
  if (toStyleHistory([{ x: 1 }, null]).paletteIds.length !== 0) {
    failures.push('all-junk history was not empty');
  }

  // 5. The Marathi label resolves and is not just punctuation.
  const label = posterStyleLabel(built);
  if (!label || !label.includes('·'))
    failures.push(`unexpected label: ${label}`);
  console.log(`\nlabel: ${label}`);
  if (posterStyleLabel({ paletteId: 'gone' }) !== null) {
    failures.push('an unresolvable style produced a label');
  }

  // A procedural id contains enough information to survive persistence without duplicating the
  // palette inside poster_style.
  {
    const { pickSocialPalette } = await import('./social-colour-plan.js');
    const socialPalette = pickSocialPalette('style-round-trip');
    const socialStyle = buildPosterStyle(socialPalette, layout);
    const back = parsePosterStyle(JSON.parse(JSON.stringify(socialStyle)));
    if (back?.paletteId !== socialPalette.id) {
      failures.push('a procedural social palette failed to parse back');
    }
    if (!posterStyleLabel(socialStyle)?.includes(socialPalette.label)) {
      failures.push('a procedural social palette produced no label');
    }
  }

  // 6. An ARTICLE run's style resolves through the same functions — the layout id comes from the
  //    landscape library, and one column stores both kinds.
  {
    const { ARTICLE_POSTER_LAYOUTS } =
      await import('./article-poster-layouts.js');
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
      failures.push(
        `article layout id lost in the round trip: ${back.layoutId}`,
      );
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
      failures.push(
        `mixed history lost a layout: ${JSON.stringify(mixed.layoutIds)}`,
      );
    }
  }

  // 7. THE ARRANGEMENT (2026-08-14). It shares the 0028 column with everything above and had no
  //    migration, so the two things that matter are that it survives a round trip and that its
  //    ABSENCE is harmless — every row written before it, every article run and every
  //    template-edit run legitimately has none, and nulling those would throw away their colour
  //    history as well.
  {
    const { POSTER_PLACEMENTS, placementById } =
      await import('./poster-placements.js');
    const anchor = POSTER_PLACEMENTS[2] as PosterPlacement;
    const withPlacement = buildPosterStyle(palette, layout, undefined, anchor);
    const backP = parsePosterStyle(JSON.parse(JSON.stringify(withPlacement)));
    if (backP?.placementId !== anchor.id)
      failures.push(
        `the placement was lost in the round trip: ${backP?.placementId}`,
      );
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
    if (!stale)
      failures.push('an unresolvable placement nulled the whole style');
    if (stale?.placementId !== undefined)
      failures.push('an unresolvable placement id survived the parse');

    // Neither stored social composition id reaches the prompt now, so the officer sees only the
    // procedural palette that did influence the poster.
    const labelled = posterStyleLabel(withPlacement);
    if (labelled?.includes(anchor.label))
      failures.push(`the label names an unused arrangement: ${labelled}`);
    if (labelled?.includes(layout.label))
      failures.push(
        'the label still names the retired social composition rotation',
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
      failures.push(
        'the placement ring carries an id the library cannot resolve',
      );
    if (mixedHistory.placementFamilies.length === 0)
      failures.push('the placement family ring came back empty');
    if (EMPTY_STYLE_HISTORY.placementIds.length !== 0)
      failures.push('the empty history is not empty for placements');
  }

  // 8. THE DESIGN DIRECTION (2026-09-26). A fresh social run records a design and NO palette or
  //    layout, so a design-only row must parse, feed the designs ring, stay out of the palette
  //    rings, and label itself from the design rather than from a palette nobody saw.
  {
    const design = {
      form: 'figure_led',
      composition: 'centre',
      imagery: 'photo_large',
      colourMood: 'teal',
    } as const;
    const measured = {
      groundHex: '#F2F7F8',
      groundIsWarm: false,
      dominantHex: '#1F7A80',
      hueBucket: 'teal',
      colourfulness: 0.3,
      lightness: 0.86,
      darkShare: 0.08,
    };
    const designStyle = buildDesignPosterStyle(design, measured);
    const back = parsePosterStyle(JSON.parse(JSON.stringify(designStyle)));
    if (
      !back?.design ||
      back.design.form !== 'figure_led' ||
      back.design.v !== 1
    )
      failures.push('a design-only style did not round-trip');
    if (back?.paletteId !== undefined)
      failures.push('a design-only style invented a palette');
    if (back?.measured?.darkShare !== 0.08)
      failures.push('darkShare was lost in the round trip');
    if (buildDesignPosterStyle(null, measured) !== null)
      failures.push('a missing design still built a style');
    // Junk design fields do not rescue an otherwise unusable row.
    if (
      parsePosterStyle({ design: { form: 'x', composition: 'nowhere' } }) !==
      null
    )
      failures.push('a junk design parsed');
    const designLabel = posterStyleLabel(designStyle);
    if (designLabel !== 'आकडे ठळक · मध्यवर्ती')
      failures.push(`unexpected design label: ${designLabel}`);
    console.log(`design label: ${designLabel}`);
    const ring = toStyleHistory([
      designStyle,
      built,
      buildDesignPosterStyle({
        ...design,
        form: 'icon_list',
        composition: 'left',
      }),
      designStyle,
      designStyle,
      designStyle,
    ]);
    if (ring.designs.length !== DESIGN_RING)
      failures.push(
        `designs ring took ${ring.designs.length}, expected ${DESIGN_RING}`,
      );
    if (
      ring.designs[0]?.form !== 'figure_led' ||
      ring.designs[1]?.form !== 'icon_list'
    )
      failures.push('designs ring is not newest first');
    if (ring.paletteIds.length !== 1 || ring.paletteIds[0] !== palette.id)
      failures.push('a design-only row occupied a palette ring slot');
    if (!ring.measuredBuckets.includes('teal'))
      failures.push("a design-only row's measured colour was not remembered");
    if (!ring.treatments[0]?.includes('figure led poster'))
      failures.push(`design treatment not described: ${ring.treatments[0]}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll poster-style assertions passed.');
  }
}
