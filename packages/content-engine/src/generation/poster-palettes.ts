// A curated library of distinct, dignified colour palettes for fully-AI-generated social posters,
// plus a seeded, recency-aware picker.
//
// Why this exists: the fresh (fully-AI-generated) social poster asks an art director to invent a
// palette per run (art-direction.ts). In practice the output kept converging on the same
// saffron-orange + cream "government paper" look — the art director clustered on one safe warm
// palette across welfare/health/rural topics, and gpt-image-2's strong "Indian government Marathi
// poster" prior overrode the free-text colour words. There was also no memory of what recent runs
// used, so nothing stopped a colour family repeating run after run.
//
// The fix is a FORCING FUNCTION: each run is anchored to one of these families, chosen
// deterministically per run and spread away from what the last few runs used. The AI still designs
// the background treatment, composition, mood and accent styling WITHIN the assigned family — it
// just no longer chooses the colours.
//
// TWO LESSONS ARE BAKED INTO THE SHAPE OF THIS FILE, both learned from real renders:
//
//  1. COLOURS ARE HEX, NOT ADJECTIVES. The first version described a palette in words ("deep teal
//     and warm ivory"), which an image model treats as a suggestion it can "brand-correct" back
//     toward saffron. Every entry now carries four exact hex values, and build-poster-prompt.ts
//     emits them as a specification. The prose fields survive only for logs and for the
//     art-direction brief.
//
//  2. THE GROUND IS TINTED BY THE FAMILY. The first library's twelve entries were all "light
//     warm-neutral ground + one dark band" — ivory, cream, dove grey, blush, sand, off-white —
//     so even a perfectly-obeyed random draw produced the SAME BACKGROUND every time, which is
//     half of what "they all look alike" actually meant. A cool palette now gets a cool porcelain
//     ground, a green one a mint-grey ground, and so on. Only the `warm` family may use cream.
//
// Posters stay LIGHT-GROUND and official by product decision — variety comes from the hue family,
// the ground tint, and (via poster-layouts.ts) how much of the canvas the colour block covers.
//
// The descriptors are English STYLE words and hex codes only — never any poster text, names or
// facts — so the never-invent rule is not at risk.

import { pathToFileURL } from 'node:url';

// The hue families the rotation spreads across. `warm` is the DGIPR house look (saffron / maroon /
// gold on cream); it is ONE family of six and deliberately the one the picker treats as ordinary
// rather than default. Keep these values stable — they are persisted in generations.poster_style
// and read back to build the avoid set.
export type PaletteFamily =
  | 'cool'
  | 'teal'
  | 'green'
  | 'purple'
  | 'neutral'
  | 'warm';

export const PALETTE_FAMILIES: readonly PaletteFamily[] = [
  'cool',
  'teal',
  'green',
  'purple',
  'neutral',
  'warm',
];

// The four colours a poster is built from. Exact values, because an image model obeys `#1F3A5F`
// where it negotiates with "deep indigo".
export type PaletteHex = Readonly<{
  // The page background — the whole canvas outside the colour block. Tinted toward the family.
  ground: string;
  // The dominant colour block / band / column.
  panel: string;
  // Body text sitting on the ground.
  ink: string;
  // Emphasis: figures, icons, dividers, the one thing that should catch the eye.
  accent: string;
}>;

// One colour family member. The prose fields (`palette`/`background`/`accent`) are kept from the
// first version because the art-direction brief and the job log read better in words; the `hex`
// block is what actually reaches the image model.
export type PosterPalette = Readonly<{
  // Stable id — persisted per run and used by the recency ring. Never rename one.
  id: string;
  // Short English name, for logs.
  name: string;
  // Marathi label, shown to the officer on the generation detail page.
  label: string;
  // The hue family this belongs to; the picker spreads across families first.
  family: PaletteFamily;
  hex: PaletteHex;
  // The dominant colours, described concretely (for the art-direction brief).
  palette: string;
  // How the background should read in this family.
  background: string;
  // The accent / highlight colour, in words.
  accent: string;
}>;

// 18 palettes: THREE per family across SIX families. Within a family the three differ by how deep
// the panel sits (light / mid / deep), so even a repeated family does not repeat a poster.
//
// The DGIPR saffron/cream brand look is `dgipr_saffron` — one entry of eighteen, in a family of
// three of six, so it appears occasionally rather than dominating.
export const POSTER_PALETTES: readonly PosterPalette[] = [
  // --- cool: blue / indigo / slate, on a cool porcelain ground ------------------------------
  {
    id: 'royal_indigo',
    name: 'Royal indigo & porcelain',
    label: 'गडद नीलम व पोर्सिलेन',
    family: 'cool',
    hex: { ground: '#EEF1F7', panel: '#26356B', ink: '#1A2033', accent: '#D98324' },
    palette: 'a deep royal indigo panel on a cool porcelain ground, with a warm amber accent',
    background: 'a cool pale-porcelain background with a deep-indigo colour block',
    accent: 'warm amber',
  },
  {
    id: 'slate_steel',
    name: 'Slate blue & mist',
    label: 'करडा निळा व धुरकट',
    family: 'cool',
    hex: { ground: '#EDF1F4', panel: '#3F6491', ink: '#1F2A33', accent: '#E2603F' },
    palette: 'a mid slate-blue panel on a misty blue-grey ground, with a burnt-coral accent',
    background: 'a misty blue-grey background with a slate-blue colour block',
    accent: 'burnt coral',
  },
  {
    id: 'sky_cobalt',
    name: 'Cobalt & ice',
    label: 'कोबाल्ट व हिमधवल',
    family: 'cool',
    hex: { ground: '#EAF0F8', panel: '#1668C4', ink: '#152233', accent: '#F2B705' },
    palette: 'a bright cobalt panel on an icy pale-blue ground, with a golden-yellow accent',
    background: 'an icy pale-blue background with a bright cobalt colour block',
    accent: 'golden yellow',
  },

  // --- teal: teal / cyan / aqua, on a pale aqua-grey ground ---------------------------------
  {
    id: 'deep_teal',
    name: 'Deep teal & pale aqua',
    label: 'गडद निळसर हिरवा',
    family: 'teal',
    hex: { ground: '#E9F2F1', panel: '#0E5C63', ink: '#16292B', accent: '#E2603F' },
    palette: 'a deep teal panel on a pale aqua-grey ground, with a coral accent',
    background: 'a pale aqua-grey background with a deep-teal colour block',
    accent: 'coral',
  },
  {
    id: 'sea_green',
    name: 'Sea green & shell',
    label: 'सागरी हिरवा व शंखधवल',
    family: 'teal',
    hex: { ground: '#EBF4F2', panel: '#1C7F72', ink: '#182A28', accent: '#E8A33D' },
    palette: 'a sea-green panel on a shell-white ground tinted green, with a soft-gold accent',
    background: 'a green-tinted shell-white background with a sea-green colour block',
    accent: 'soft gold',
  },
  {
    id: 'petrol_cyan',
    name: 'Petrol & cyan mist',
    label: 'पेट्रोल निळा',
    family: 'teal',
    hex: { ground: '#E8F1F4', panel: '#134E5B', ink: '#14262C', accent: '#4FC3C7' },
    palette: 'a dark petrol-blue panel on a cyan-tinted mist ground, with a bright cyan accent',
    background: 'a cyan-tinted pale background with a dark petrol-blue colour block',
    accent: 'bright cyan',
  },

  // --- green: forest / olive / emerald, on a mint-grey ground -------------------------------
  {
    id: 'forest_green',
    name: 'Forest green & mint grey',
    label: 'वनहिरवा व पुदिना',
    family: 'green',
    hex: { ground: '#EDF3EE', panel: '#245B3A', ink: '#1B2A20', accent: '#C9992B' },
    palette: 'a forest-green panel on a mint-grey ground, with a brass-gold accent',
    background: 'a mint-grey background with a forest-green colour block',
    accent: 'brass gold',
  },
  {
    id: 'warm_sage',
    name: 'Sage & pale moss',
    label: 'ऋषिहिरवा व शेवाळ',
    family: 'green',
    hex: { ground: '#EFF2EA', panel: '#6B8259', ink: '#242A1E', accent: '#B4552D' },
    palette: 'a muted sage panel on a pale moss ground, with a soft rust accent',
    background: 'a pale moss-tinted background with a sage-green colour block',
    accent: 'soft rust',
  },
  {
    id: 'emerald_lime',
    name: 'Emerald & pale lime',
    label: 'पाचू व फिकट लिंबू',
    family: 'green',
    hex: { ground: '#EDF4E9', panel: '#0F7A4E', ink: '#152A20', accent: '#1F3A5F' },
    palette: 'a vivid emerald panel on a pale lime-tinted ground, with a deep-navy accent',
    background: 'a pale lime-tinted background with a vivid emerald colour block',
    accent: 'deep navy',
  },

  // --- purple: plum / violet / aubergine, on a lilac-grey ground -----------------------------
  {
    id: 'deep_plum',
    name: 'Deep plum & lilac grey',
    label: 'गडद जांभळा व फिकट लिलाक',
    family: 'purple',
    hex: { ground: '#F0EDF4', panel: '#4A2A5E', ink: '#241C2B', accent: '#D9A441' },
    palette: 'a deep plum panel on a lilac-grey ground, with a champagne-gold accent',
    background: 'a lilac-grey background with a deep-plum colour block',
    accent: 'champagne gold',
  },
  {
    id: 'violet_ash',
    name: 'Violet & ash',
    label: 'जांभळा व राखाडी',
    family: 'purple',
    hex: { ground: '#EFEEF3', panel: '#5B4B9E', ink: '#221F2E', accent: '#3AA8A0' },
    palette: 'a muted violet panel on an ash-lilac ground, with a teal accent',
    background: 'an ash-lilac background with a muted violet colour block',
    accent: 'teal',
  },
  {
    id: 'aubergine_rose',
    name: 'Aubergine & dusty rose',
    label: 'वांगी व फिकट गुलाबी',
    family: 'purple',
    hex: { ground: '#F3EEF0', panel: '#5A2745', ink: '#2A1D24', accent: '#C98B6B' },
    palette: 'a dark aubergine panel on a dusty-rose ground, with a muted-clay accent',
    background: 'a dusty-rose background with a dark aubergine colour block',
    accent: 'muted clay',
  },

  // --- neutral: charcoal / graphite / stone, one vivid accent doing all the work -------------
  {
    id: 'charcoal_mono',
    name: 'Charcoal monochrome',
    label: 'कोळसा एकरंगी',
    family: 'neutral',
    hex: { ground: '#EFF0F1', panel: '#2C3033', ink: '#1A1D1F', accent: '#12A57A' },
    palette: 'a charcoal panel on a light neutral-grey ground, with a vivid emerald accent',
    background: 'a light neutral-grey background with charcoal colour blocks',
    accent: 'vivid emerald',
  },
  {
    id: 'graphite_ink',
    name: 'Graphite & bone',
    label: 'ग्रॅफाइट व हस्तिदंत',
    family: 'neutral',
    hex: { ground: '#F1F0EE', panel: '#3D4247', ink: '#1D2023', accent: '#C0392B' },
    palette: 'a graphite panel on a bone-white ground, with a signal-red accent',
    background: 'a bone-white background with a graphite colour block',
    accent: 'signal red',
  },
  {
    id: 'stone_navy',
    name: 'Stone & deep navy',
    label: 'पाषाण व गडद निळा',
    family: 'neutral',
    hex: { ground: '#EDEEEF', panel: '#1E2A3A', ink: '#191E24', accent: '#8FA9C4' },
    palette: 'a near-black navy panel on a cool stone-grey ground, with a pale-blue accent',
    background: 'a cool stone-grey background with a near-black navy colour block',
    accent: 'pale steel blue',
  },

  // --- warm: the DGIPR house look and its neighbours. THREE of eighteen, on purpose. ----------
  {
    id: 'dgipr_saffron',
    name: 'DGIPR saffron & cream (brand default)',
    label: 'डीजीआयपीआर भगवा व क्रीम',
    family: 'warm',
    hex: { ground: '#FAF3E6', panel: '#E07A22', ink: '#2B2117', accent: '#7C1F1F' },
    palette: 'the DGIPR brand saffron-orange panel on a warm cream ground, with a deep-maroon accent',
    background: 'a warm cream / paper background with saffron-orange colour bands',
    accent: 'deep maroon',
  },
  {
    id: 'deep_burgundy',
    name: 'Burgundy & antique gold',
    label: 'गडद लाल व सोनेरी',
    family: 'warm',
    hex: { ground: '#F6F1EA', panel: '#6E1F2E', ink: '#281C1C', accent: '#B78B32' },
    palette: 'a deep burgundy panel on an off-white warm ground, with an antique-gold accent',
    background: 'an off-white warm background with deep-burgundy colour bands',
    accent: 'antique gold',
  },
  {
    id: 'terracotta_sand',
    name: 'Terracotta & sand',
    label: 'विटकरी व वाळू',
    family: 'warm',
    hex: { ground: '#F7EFE4', panel: '#B4552D', ink: '#2B211A', accent: '#0E5C63' },
    palette: 'a terracotta panel on a warm sand ground, with a deep-teal accent',
    background: 'a warm sand background with terracotta colour blocks',
    accent: 'deep teal',
  },
];

// What the caller wants kept away from this run: the palette ids and the hue FAMILIES the last few
// posters used. Families matter more than ids — `terracotta -> dgipr_saffron -> deep_burgundy` are
// three different ids and one indistinguishable look, which is exactly the failure this replaces.
export type PaletteAvoid = Readonly<{
  ids?: readonly string[] | undefined;
  families?: readonly PaletteFamily[] | undefined;
}>;

// Deterministic 32-bit hash of a string (FNV-1a), matching references/select-master.ts so the
// same seed always yields the same palette while different seeds spread across the library.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Pick one palette for a run. Deterministic in `seed` (so a run is reproducible and a retry
// re-picks the same family), while `avoid` — what the last few runs used — is filtered out.
//
// The two filters are applied in order of importance and each is skipped only if it would empty
// the pool: FAMILY first (the look), then id (the exact entry). So a caller that has barred every
// family still gets a poster, just a less-spread one, and a tiny future library cannot deadlock.
export function pickPalette(
  seed: string,
  avoid: PaletteAvoid | readonly string[] = {},
): PosterPalette {
  // Back-compat: the first version took a bare id list.
  const normalized: PaletteAvoid = Array.isArray(avoid)
    ? { ids: avoid as readonly string[] }
    : (avoid as PaletteAvoid);

  let pool: readonly PosterPalette[] = POSTER_PALETTES;

  const families = new Set(normalized.families ?? []);
  if (families.size > 0) {
    const spread = pool.filter((p) => !families.has(p.family));
    if (spread.length > 0) pool = spread;
  }

  const ids = new Set(normalized.ids ?? []);
  if (ids.size > 0) {
    const spread = pool.filter((p) => !ids.has(p.id));
    if (spread.length > 0) pool = spread;
  }

  const index = hashString(seed) % pool.length;
  return pool[index] as PosterPalette;
}

// Look one up by id — used by the API to label a stored run's palette for the UI. Returns null for
// an id written by an older build whose entry has since been removed.
export function paletteById(id: string | null | undefined): PosterPalette | null {
  if (!id) return null;
  return POSTER_PALETTES.find((p) => p.id === id) ?? null;
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/poster-palettes.ts
// Simulates a run of picks with rolling family + id recency rings and asserts the properties the
// rotation exists to guarantee. No model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Bar the last 3 families and the last 5 ids — what the runner uses.
  const FAMILY_RING = 3;
  const ID_RING = 5;
  const RUNS = 30;

  const familyRing: PaletteFamily[] = [];
  const idRing: string[] = [];
  const picks: PosterPalette[] = [];
  const counts = new Map<string, number>();
  const familyCounts = new Map<PaletteFamily, number>();

  console.log(
    `Library: ${POSTER_PALETTES.length} palettes across ${PALETTE_FAMILIES.length} families\n`,
  );
  for (const p of POSTER_PALETTES) {
    console.log(
      `  ${p.id.padEnd(18)} ${p.family.padEnd(8)} ground ${p.hex.ground}  panel ${p.hex.panel}  ink ${p.hex.ink}  accent ${p.hex.accent}`,
    );
  }

  console.log(`\nSimulating ${RUNS} runs:\n`);
  for (let i = 0; i < RUNS; i += 1) {
    const chosen = pickPalette(`harness-run-${i}`, {
      families: familyRing,
      ids: idRing,
    });
    picks.push(chosen);
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    familyCounts.set(chosen.family, (familyCounts.get(chosen.family) ?? 0) + 1);
    console.log(
      `run ${String(i).padStart(2)} -> ${chosen.family.padEnd(8)} ${chosen.id.padEnd(18)} ground ${chosen.hex.ground}`,
    );
    familyRing.unshift(chosen.family);
    familyRing.splice(FAMILY_RING);
    idRing.unshift(chosen.id);
    idRing.splice(ID_RING);
  }

  // Assertions — the properties the whole file exists for.
  const failures: string[] = [];

  // 1. No family repeats within FAMILY_RING consecutive runs.
  for (let i = 1; i <= FAMILY_RING; i += 1) {
    for (let j = i; j < picks.length; j += 1) {
      const a = picks[j] as PosterPalette;
      const b = picks[j - i] as PosterPalette;
      if (a.family === b.family) {
        failures.push(`family ${a.family} repeated at runs ${j - i} and ${j} (gap ${i})`);
      }
    }
  }

  // 2. The warm (house-look) family must not dominate.
  const warm = familyCounts.get('warm') ?? 0;
  if (warm > Math.ceil(RUNS / 4)) {
    failures.push(`warm family used ${warm}/${RUNS} times — should be near ${RUNS / 6}`);
  }

  // 3. Consecutive runs must differ in GROUND colour (the "same background" complaint).
  for (let i = 1; i < picks.length; i += 1) {
    const a = picks[i] as PosterPalette;
    const b = picks[i - 1] as PosterPalette;
    if (a.hex.ground === b.hex.ground) {
      failures.push(`ground ${a.hex.ground} repeated back-to-back at run ${i}`);
    }
  }

  // 4. Only the warm family may use a cream/sand ground (every other family is tinted to itself).
  for (const p of POSTER_PALETTES) {
    const g = p.hex.ground.toUpperCase();
    const red = parseInt(g.slice(1, 3), 16);
    const blue = parseInt(g.slice(5, 7), 16);
    if (p.family !== 'warm' && red - blue > 8) {
      failures.push(`${p.id} (${p.family}) has a warm ground ${p.hex.ground} — should be tinted to its family`);
    }
  }

  console.log('\nFamily histogram:');
  for (const f of PALETTE_FAMILIES) {
    console.log(`  ${f.padEnd(8)} ${familyCounts.get(f) ?? 0}`);
  }
  console.log('\nPalette usage:');
  for (const p of POSTER_PALETTES) {
    console.log(`  ${p.id.padEnd(18)} ${counts.get(p.id) ?? 0}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll rotation assertions passed.');
  }
}
