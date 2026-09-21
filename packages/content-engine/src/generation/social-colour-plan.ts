// Fast, deterministic colour direction for from-scratch social posters.
//
// This is deliberately a colour-science step, not an AI step. It creates a broad set of
// candidates in OKLCH, maps them into sRGB, rejects inaccessible text pairings, and scores the
// survivors against colours measured from recent renders. The result is available synchronously
// in a few milliseconds and adds no provider call to the already-slow image workflow.

import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import Color from 'colorjs.io';
import type { PaletteFamily, PosterPalette } from './poster-palettes.js';

export type SocialPaletteAvoid = Readonly<{
  ids?: readonly string[] | undefined;
  families?: readonly PaletteFamily[] | undefined;
  recentDominantHexes?: readonly string[] | undefined;
  recentGroundHexes?: readonly string[] | undefined;
}>;

type Treatment = 'paper' | 'midnight' | 'tonal' | 'duotone' | 'vivid';
type Harmony = 'analogous' | 'complement' | 'split' | 'triad';

const TREATMENTS: readonly Treatment[] = [
  'paper',
  'midnight',
  'tonal',
  'duotone',
  'vivid',
];
const HARMONIES: readonly Harmony[] = [
  'analogous',
  'complement',
  'split',
  'triad',
];
const GOLDEN_ANGLE = 137.507764;
const CANDIDATE_COUNT = 32;
const SOCIAL_ID =
  /^social-v1-(paper|midnight|tonal|duotone|vivid)-(analogous|complement|split|triad)-(\d{1,3})$/;

const TREATMENT_NAMES: Readonly<Record<Treatment, string>> = {
  paper: 'Luminous editorial',
  midnight: 'Deep luminous',
  tonal: 'Layered tonal',
  duotone: 'Graphic duotone',
  vivid: 'Vivid colour field',
};

const TREATMENT_LABELS: Readonly<Record<Treatment, string>> = {
  paper: 'उजळ संपादकीय',
  midnight: 'गडद प्रकाशमान',
  tonal: 'स्तरीय एकरंगी',
  duotone: 'ठसठशीत द्विरंगी',
  vivid: 'उत्साही रंगक्षेत्र',
};
const PALETTE_CACHE = new Map<string, PosterPalette>();

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function oklch(lightness: number, chroma: number, colourHue: number): Color {
  return new Color('oklch', [lightness, chroma, hue(colourHue)]).toGamut({
    space: 'srgb',
    method: 'oklch.chroma',
  });
}

function hex(colour: Color): string {
  return colour.to('srgb').toString({ format: 'hex' }).toUpperCase();
}

function contrast(a: Color, b: Color): number {
  return a.contrastWCAG21(b);
}

function parseHex(value: string): Color | null {
  try {
    return new Color(value);
  } catch {
    return null;
  }
}

function readableInk(
  background: Color,
  colourHue: number,
  preferChromatic: boolean,
): Color {
  const candidates = [
    oklch(0.18, preferChromatic ? 0.055 : 0.025, colourHue),
    oklch(0.25, preferChromatic ? 0.1 : 0.04, colourHue),
    oklch(0.96, preferChromatic ? 0.035 : 0.012, colourHue),
    oklch(0.88, preferChromatic ? 0.105 : 0.025, colourHue),
  ];
  const passing = candidates.filter(
    (candidate) => contrast(background, candidate) >= 4.5,
  );
  const pool = passing.length > 0 ? passing : candidates;
  return pool.reduce((best, candidate) =>
    contrast(background, candidate) > contrast(background, best)
      ? candidate
      : best,
  );
}

function harmonyHues(
  baseHue: number,
  harmony: Harmony,
): readonly [number, number] {
  switch (harmony) {
    case 'analogous':
      return [hue(baseHue + 34), hue(baseHue - 34)];
    case 'complement':
      return [hue(baseHue + 180), hue(baseHue + 150)];
    case 'split':
      return [hue(baseHue + 145), hue(baseHue + 215)];
    case 'triad':
      return [hue(baseHue + 120), hue(baseHue + 240)];
  }
}

function familyForHue(baseHue: number, treatment: Treatment): PaletteFamily {
  if (treatment === 'duotone' && baseHue >= 345) return 'neutral';
  const h = hue(baseHue);
  if (h < 115 || h >= 345) return 'warm';
  if (h < 165) return 'green';
  if (h < 215) return 'teal';
  if (h < 285) return 'cool';
  return 'purple';
}

function createPalette(
  baseHue: number,
  treatment: Treatment,
  harmony: Harmony,
): PosterPalette {
  const roundedHue = Math.round(hue(baseHue)) % 360;
  const id = `social-v1-${treatment}-${harmony}-${roundedHue}`;
  const cached = PALETTE_CACHE.get(id);
  if (cached) return cached;
  const [secondHue, accentHue] = harmonyHues(roundedHue, harmony);
  let ground: Color;
  let panel: Color;
  let accent: Color;

  switch (treatment) {
    case 'paper':
      ground = oklch(0.955, 0.025, roundedHue);
      panel = oklch(0.49, 0.17, roundedHue);
      accent = oklch(0.65, 0.18, accentHue);
      break;
    case 'midnight':
      ground = oklch(0.205, 0.065, roundedHue);
      panel = oklch(0.47, 0.15, secondHue);
      accent = oklch(0.79, 0.16, accentHue);
      break;
    case 'tonal':
      ground = oklch(0.89, 0.065, roundedHue);
      panel = oklch(0.43, 0.14, roundedHue);
      accent = oklch(0.63, 0.18, accentHue);
      break;
    case 'duotone':
      ground = oklch(0.94, 0.018, secondHue);
      panel = oklch(0.39, 0.17, roundedHue);
      accent = oklch(0.58, 0.19, secondHue);
      break;
    case 'vivid':
      ground = oklch(0.44, 0.165, roundedHue);
      panel = oklch(0.8, 0.11, secondHue);
      accent = oklch(0.71, 0.18, accentHue);
      break;
  }

  // Chromatic typography is deliberately possible in some treatments. It is never assigned
  // merely because a hue is fashionable: Color.js still has to prove 4.5:1 contrast first.
  const preferChromaticInk = treatment === 'midnight' || treatment === 'tonal';
  const ink = readableInk(ground, accentHue, preferChromaticInk);
  const textOnPanel = readableInk(panel, secondHue, treatment === 'duotone');
  const family = familyForHue(roundedHue, treatment);
  const palette: PosterPalette = {
    id,
    name: `${TREATMENT_NAMES[treatment]} ${roundedHue}°`,
    label: `${TREATMENT_LABELS[treatment]} ${roundedHue}°`,
    family,
    hex: {
      ground: hex(ground),
      panel: hex(panel),
      ink: hex(ink),
      textOnPanel: hex(textOnPanel),
      accent: hex(accent),
    },
    palette: `${TREATMENT_NAMES[treatment].toLowerCase()} colour system at ${roundedHue}°, using ${harmony} harmony`,
    background: `${hex(ground)} as the principal ground`,
    accent: `${hex(accent)} as a flexible accent`,
  };
  PALETTE_CACHE.set(id, palette);
  return palette;
}

function minimumDistance(colour: string, previous: readonly Color[]): number {
  if (previous.length === 0) return 0.25;
  const current = new Color(colour);
  return Math.min(...previous.map((item) => current.deltaEOK(item)));
}

function paletteScore(
  palette: PosterPalette,
  seed: string,
  recentDominants: readonly Color[],
  recentGrounds: readonly Color[],
): number {
  const groundDistance = minimumDistance(palette.hex.ground, recentGrounds);
  const dominantDistance = minimumDistance(palette.hex.panel, recentDominants);
  const internalDistance = new Color(palette.hex.panel).deltaEOK(
    new Color(palette.hex.accent),
  );
  // This deterministic tie-breaker is intentionally large enough to vary treatment/harmony when
  // there is no history yet, but smaller than the measured-colour distance once history exists.
  const jitter = (hashString(`${seed}:${palette.id}`) % 10_000) / 55_000;
  return (
    groundDistance * 1.2 +
    dominantDistance * 2.4 +
    internalDistance * 0.3 +
    jitter
  );
}

/**
 * Select a procedural social palette without a model call.
 *
 * The picker samples the full hue circle with a golden-angle sequence, rotates through five
 * light/dark/tonal treatments and four harmony strategies, then chooses the candidate furthest
 * from colours measured on recent posters. Avoided families and ids are removed when possible;
 * this is recency control, not a permanent ban on any colour.
 */
export function pickSocialPalette(
  seed: string,
  avoid: SocialPaletteAvoid = {},
): PosterPalette {
  const seedHash = hashString(seed);
  const startHue = seedHash % 360;
  const candidates: PosterPalette[] = [];
  // Treatment and harmony are independent seeded choices. Candidate scoring then selects the hue
  // within that visual language. Letting the score choose all three made the mathematically most
  // separated treatment win too often, which is another kind of repetition.
  const treatment = TREATMENTS[
    hashString(`${seed}:treatment`) % TREATMENTS.length
  ] as Treatment;
  const harmony = HARMONIES[
    hashString(`${seed}:harmony`) % HARMONIES.length
  ] as Harmony;

  for (let index = 0; index < CANDIDATE_COUNT; index += 1) {
    const candidateHue = hue(startHue + index * GOLDEN_ANGLE);
    candidates.push(createPalette(candidateHue, treatment, harmony));
  }

  const avoidedFamilies = new Set(avoid.families ?? []);
  const familySpread = candidates.filter(
    (candidate) => !avoidedFamilies.has(candidate.family),
  );
  const familyPool = familySpread.length > 0 ? familySpread : candidates;

  const avoidedIds = new Set(avoid.ids ?? []);
  const idSpread = familyPool.filter(
    (candidate) => !avoidedIds.has(candidate.id),
  );
  const pool = idSpread.length > 0 ? idSpread : familyPool;
  const recentDominants = (avoid.recentDominantHexes ?? [])
    .map(parseHex)
    .filter((item): item is Color => item !== null);
  const recentGrounds = (avoid.recentGroundHexes ?? [])
    .map(parseHex)
    .filter((item): item is Color => item !== null);
  const scored = pool.map((palette) => ({
    palette,
    score: paletteScore(palette, seed, recentDominants, recentGrounds),
  }));
  return scored.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  ).palette;
}

// Reconstruct a persisted procedural palette. Encoding the three inputs in the id keeps the
// existing poster_style JSON shape backward compatible and avoids storing a second palette copy.
export function socialPaletteById(
  id: string | null | undefined,
): PosterPalette | null {
  const match = id?.match(SOCIAL_ID);
  if (!match) return null;
  const treatment = match[1] as Treatment;
  const harmony = match[2] as Harmony;
  const parsedHue = Number(match[3]);
  if (!Number.isInteger(parsedHue) || parsedHue < 0 || parsedHue > 359)
    return null;
  return createPalette(parsedHue, treatment, harmony);
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/social-colour-plan.ts
// No network, model call, or image generation. It checks accessibility, round trips, diversity,
// determinism, and the latency of the exact synchronous picker used in production.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const recentDominantHexes: string[] = [];
  const recentGroundHexes: string[] = [];
  const families: PaletteFamily[] = [];
  const palettes: PosterPalette[] = [];
  const coldStarted = performance.now();
  pickSocialPalette('cold-start-benchmark');
  const coldElapsed = performance.now() - coldStarted;

  for (let index = 0; index < 30; index += 1) {
    const palette = pickSocialPalette(`social-harness-${index}`, {
      families: families.slice(0, 3),
      recentDominantHexes: recentDominantHexes.slice(0, 5),
      recentGroundHexes: recentGroundHexes.slice(0, 5),
    });
    palettes.push(palette);
    if (
      contrast(new Color(palette.hex.ground), new Color(palette.hex.ink)) < 4.5
    ) {
      failures.push(`${palette.id}: ground text is below 4.5:1`);
    }
    if (
      !palette.hex.textOnPanel ||
      contrast(
        new Color(palette.hex.panel),
        new Color(palette.hex.textOnPanel),
      ) < 4.5
    ) {
      failures.push(`${palette.id}: panel text is below 4.5:1`);
    }
    if (socialPaletteById(palette.id)?.hex.accent !== palette.hex.accent) {
      failures.push(
        `${palette.id}: persisted id did not reconstruct the palette`,
      );
    }
    recentDominantHexes.unshift(palette.hex.panel);
    recentGroundHexes.unshift(palette.hex.ground);
    families.unshift(palette.family);
  }

  if (new Set(palettes.map((palette) => palette.hex.panel)).size < 24) {
    failures.push('30 runs produced fewer than 24 distinct dominant colours');
  }
  const treatments = new Set(
    palettes.map((palette) => palette.id.match(SOCIAL_ID)?.[1]).filter(Boolean),
  );
  if (treatments.size < 4) {
    failures.push(`30 runs produced only ${treatments.size} treatment types`);
  }
  const yellowish = palettes.filter((palette) => {
    const h = Number(new Color(palette.hex.accent).to('oklch').coords[2]);
    return h >= 75 && h <= 115;
  });
  if (yellowish.length === 0) {
    failures.push(
      'yellow/gold disappeared entirely; recency control became a ban',
    );
  }
  const deterministicA = pickSocialPalette('same-seed');
  const deterministicB = pickSocialPalette('same-seed');
  if (deterministicA.id !== deterministicB.id)
    failures.push('same seed was not deterministic');
  const recoloured = pickSocialPalette('same-seed', {
    families: [deterministicA.family],
    recentDominantHexes: [deterministicA.hex.panel],
    recentGroundHexes: [deterministicA.hex.ground],
  });
  if (recoloured.family === deterministicA.family) {
    failures.push('recolour request repeated the rejected family');
  }
  if (
    new Color(recoloured.hex.panel).deltaEOK(
      new Color(deterministicA.hex.panel),
    ) < 0.12
  ) {
    failures.push(
      'recolour request stayed perceptually too close to the rejected colour',
    );
  }

  const started = performance.now();
  for (let index = 0; index < 200; index += 1) {
    pickSocialPalette(`benchmark-${index}`, {
      recentDominantHexes,
      recentGroundHexes,
    });
  }
  const elapsed = performance.now() - started;
  if (coldElapsed > 250) {
    failures.push(`cold selection took ${coldElapsed.toFixed(1)} ms`);
  }
  if (elapsed / 200 > 50) {
    failures.push(`average selection took ${(elapsed / 200).toFixed(1)} ms`);
  }
  console.log(
    JSON.stringify(
      {
        sample: palettes.map((palette) => ({
          id: palette.id,
          family: palette.family,
          colours: palette.hex,
        })),
        uniqueDominants: new Set(palettes.map((palette) => palette.hex.panel))
          .size,
        treatmentTypes: treatments.size,
        yellowOrGoldAccents: yellowish.length,
        coldSelection: `${coldElapsed.toFixed(2)} ms`,
        benchmark: `${elapsed.toFixed(1)} ms / 200 selections (${(elapsed / 200).toFixed(2)} ms each)`,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll social colour-plan assertions passed.');
  }
}
