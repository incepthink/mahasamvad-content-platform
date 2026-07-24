// Invent an ORIGINAL visual treatment for one social poster — its background handling, mood and
// accent styling — inside a colour palette and a composition that have already been ASSIGNED.
//
// Why this exists: the social poster used to be a near-clone of its master template (the
// image-EDIT endpoint + a "keep the master's colours/panels/icons" prompt). The default now
// GENERATES the poster from scratch, using the master only as a loose structural idea. That
// leaves the look undetermined — and an image model, told merely to "choose colours suited to
// the topic", drifts to the same government saffron-and-cream every time.
//
// WHAT CHANGED, AND WHY IT MATTERS: the first version of this file let the art director CHOOSE
// the palette, with the assigned family passed in as a suggestion it "may refine". Two things
// went wrong. It refined toward warm every time — the model has the same house-style prior the
// image model does — and, worse, build-poster-prompt.ts then emitted the art director's PROSE
// rather than the assigned palette, so the forcing function was laundered through a paraphrase
// before it ever reached the image model. The assignment now travels as exact hex values and is
// stated to this call as fact. The art director designs WITHIN it and never names a colour of
// its own; `palette` is no longer one of the fields it returns when a palette is assigned.
//
// It emits STYLE descriptors only (English words: treatment, mood, accents) — never any poster
// text, names, numbers or facts — so the never-invent rule is not at risk. A failure returns null
// and the caller renders from the assigned palette + layout alone (which is the load-bearing
// part); art direction is a quality lever, never a gate — the same stance as rank-master.ts.

import { pathToFileURL } from 'node:url';
import { chatComplete } from './openai-chat.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';
import type { PaletteFamily, PosterPalette } from './poster-palettes.js';
import type { LayoutCoverage, PosterLayout } from './poster-layouts.js';

// A fresh visual treatment for one poster. All fields are English style descriptors.
export type ArtDirection = Readonly<{
  // The colour scheme, described in words. Present ONLY on the legacy un-assigned path — when a
  // palette is assigned, colour is not this call's to decide and the field comes back empty.
  palette: string;
  // The background treatment/concept WITHIN the assigned palette and composition (how the flat
  // ground, the colour block and any texture/gradient are handled).
  background: string;
  // How the assigned composition is realised — proportions, alignment, hierarchy, spacing.
  composition: string;
  // Tone / mood adjectives suited to the topic.
  mood: string;
  // Panel / card / icon / divider / headline accent styling.
  accents: string;
}>;

// What recent posters looked like, so this one can be told to differ. Human-readable fragments
// ("cool porcelain with indigo, left colour column"), newest first. This is real signal, unlike
// the opaque creative seed the first version relied on — a model cannot diversify against a hash
// it has never seen the outputs of, but it can against a list of what was just made.
export type RecentTreatment = string;

export type GenerateArtDirectionInput = Readonly<{
  note: string;
  // The resolved copy layout ('info_bullets' | 'alert' | 'campaign' | 'quote' | 'timeline' |
  // 'generic'); steers tone and hierarchy, not colour.
  copyStyle: string;
  // A loose structural idea from the selected reference master (its layoutSummary), ALREADY
  // stripped of colour words by the caller. Used only as "what sections a poster like this has".
  referenceHint?: string | undefined;
  // Biases the model toward a different treatment per run. Any stable-per-run string: the
  // generation id on a first render, `${id}:v${n}` on a regenerate (so a redo looks new).
  seed: string;
  // The colour family this run is anchored to (poster-palettes.ts, rotated per run by the
  // caller). When present the art director designs WITHIN it and chooses no colours at all —
  // this is the forcing function that stops every poster converging on the same warm default.
  // Absent = the legacy "choose the colours yourself" behaviour.
  assignedPalette?: PosterPalette | undefined;
  // The composition archetype this run is anchored to (poster-layouts.ts, rotated per run).
  // Present on the same path as assignedPalette; the art director realises it rather than
  // inventing a layout, which is what stops two differently-coloured posters reading alike.
  assignedLayout?: PosterLayout | undefined;
  // What the last few posters looked like, newest first, so this one is designed away from them.
  recentTreatments?: readonly RecentTreatment[] | undefined;
}>;

// The classifier already read the whole note; art direction only needs enough to judge
// subject and tone.
const NOTE_MAX_CHARS = 1500;

function buildSystemPrompt(input: GenerateArtDirectionInput): string {
  const { copyStyle, referenceHint, assignedPalette, assignedLayout } = input;

  // When a palette is assigned the colour choice is GIVEN, stated as exact hex so there is
  // nothing to negotiate; otherwise fall back to the legacy free-choice instruction.
  const colourRule = assignedPalette
    ? [
        'THE COLOUR PALETTE FOR THIS POSTER IS ALREADY DECIDED. It is not yours to choose, refine, warm up, or brand-correct. These are the exact colours:',
        `  - Page background: ${assignedPalette.hex.ground}`,
        `  - Dominant colour block / band: ${assignedPalette.hex.panel}`,
        `  - Body text on the background: ${assignedPalette.hex.ink}`,
        `  - Accent (figures, icons, dividers): ${assignedPalette.hex.accent}`,
        `  In words: ${assignedPalette.palette}.`,
        '- Do NOT name any colour in your answer. Describe HOW the given colours are used — proportions, which element gets the accent, how flat or textured the ground reads — never WHICH colours to use.',
      ].join('\n')
    : '- CHOOSE THE COLOURS YOURSELF from the topic and tone. Do NOT default to the generic government navy-blue-and-white or the saffron-orange-and-cream look every time. Vary the palette widely from post to post — warm, cool, earthy, vivid, or a restrained monochrome with one accent — while staying appropriate to the subject.';

  const lines = [
    'You are an award-winning art director for DGIPR Maharashtra, a government public-information department.',
    'For each post you design the visual treatment of a single 4:5 portrait poster: how its background reads, how its assigned composition is realised, its mood, and its accent styling.',
    'Hard rules:',
    '- The poster is an OFFICIAL government communication. The look must stay dignified, trustworthy and highly legible — strong contrast, clean structure, no gimmicks, no clutter.',
    colourRule,
  ];

  if (assignedLayout) {
    lines.push(
      `- THE COMPOSITION IS ALSO ALREADY DECIDED: ${assignedLayout.instruction}`,
      '- Your "composition" answer must REALISE that arrangement — proportions, alignment, spacing, type hierarchy, how the eye moves through it. Do NOT propose a different arrangement.',
    );
  }

  lines.push(
    '- Make THIS treatment clearly DIFFERENT from the recent posters listed in the user message. The creative seed there exists only to help you diversify; never mention or describe it.',
    '- Output STYLE ONLY. Never write any poster text, headline, caption, names, numbers, dates or scheme names. Use English style descriptors only.',
    `- The post format is "${copyStyle}"; suit the treatment to it (a quote poster reads differently from an urgent alert or a stats-heavy campaign).`,
    'Respond with STRICT JSON only.',
  );

  if (referenceHint && referenceHint.trim().length > 0) {
    lines.push(
      '',
      `A reference poster that works for THIS KIND of post is built like this. Use it ONLY as a loose idea of which sections a poster like this has — the composition above governs the arrangement: ${referenceHint.trim()}`,
    );
  }
  return lines.join('\n');
}

function buildUserPrompt(input: GenerateArtDirectionInput): string {
  const lines: string[] = [];
  const recent = (input.recentTreatments ?? []).filter((t) => t.trim().length > 0);
  if (recent.length > 0) {
    lines.push(
      'The most recent posters this department published looked like this (newest first). Design something clearly different from ALL of them:',
      ...recent.map((t, i) => `  ${i + 1}. ${t}`),
      '',
    );
  }
  lines.push(
    `Creative seed (for diversification only — do not mention it): ${input.seed}`,
    '',
    'Meeting notes (the topic and tone to design for — do NOT quote or reproduce any of this text on the poster):',
    input.note.trim().slice(0, NOTE_MAX_CHARS),
  );
  return lines.join('\n');
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error(`Art director did not return JSON: ${raw.slice(0, 400)}`);
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Generate a fresh art direction, or null if the pass could not produce a usable one. Never
// throws for a model slip — the render must proceed without direction rather than fail, and with
// a palette + layout assigned there is plenty left to render from.
export async function generateArtDirection(
  input: GenerateArtDirectionInput,
): Promise<ArtDirection | null> {
  const note = input.note.trim();
  if (note.length === 0) return null;

  // With a palette assigned, colour is not this call's output. Asking for it anyway is what let
  // the model re-open a decision that had already been made.
  const assigned = Boolean(input.assignedPalette);
  const properties: Record<string, { type: 'string' }> = {
    background: { type: 'string' },
    composition: { type: 'string' },
    mood: { type: 'string' },
    accents: { type: 'string' },
  };
  const required = ['background', 'composition', 'mood', 'accents'];
  if (!assigned) {
    properties.palette = { type: 'string' };
    required.unshift('palette');
  }

  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: buildSystemPrompt(input) },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      {
        model: POSTER_COPY_MODEL,
        // This brief decides the poster's whole look; a bland or incoherent treatment is
        // visible in the shipped artwork.
        reasoningEffort: 'medium',
        maxTokens: 700,
        jsonSchema: {
          name: 'art_direction',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties,
            required,
          },
        },
      },
    );
    const parsed = parseJson(raw);
    const direction: ArtDirection = {
      palette: assigned ? '' : str(parsed.palette),
      background: str(parsed.background),
      composition: str(parsed.composition),
      mood: str(parsed.mood),
      accents: str(parsed.accents),
    };
    // Usability differs by path: without an assignment the palette IS the output, so an empty
    // one is unusable; with an assignment the colours are already settled and what this adds is
    // the treatment, so a background/composition line is what must be there.
    if (assigned) {
      if (direction.background.length === 0 && direction.composition.length === 0) return null;
    } else if (direction.palette.length === 0) {
      return null;
    }
    return direction;
  } catch (error) {
    console.warn('[art-direction] generation failed (rendering without direction):', error);
    return null;
  }
}

// --- CLI harness -----------------------------------------------------------
//   tsx --env-file=../../.env src/generation/art-direction.ts
// Prints five directions for the same note, each anchored to a different assigned palette AND
// composition, with a rolling "recent treatments" memory. They should differ structurally, and
// NONE may name a colour — the palette is not the art director's to choose any more.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const NOTE = [
    'अमरावती जिल्ह्यातील माहुली, जहांगीर, नेर आणि पिंगळाई येथील प्राथमिक आरोग्य केंद्रांच्या',
    'उन्नतीकरणाचा बृहद आराखड्यात समावेश करून त्यावर सकारात्मक विचार करण्यात येईल.',
  ].join(' ');
  const REFERENCE_HINT =
    'A calm clinical headline on a band with five stat callouts and a hospital photo zone on the right.';

  void Promise.all([import('./poster-palettes.js'), import('./poster-layouts.js')])
    .then(async ([{ pickPalette }, { pickLayout }]) => {
      const paletteIds: string[] = [];
      const families: PaletteFamily[] = [];
      const layoutIds: string[] = [];
      const coverages: LayoutCoverage[] = [];
      const recent: string[] = [];
      const colourWord =
        /\b(red|orange|yellow|green|teal|blue|indigo|purple|plum|maroon|saffron|cream|ivory|white|black|grey|gray|gold|amber|coral|navy|sage|terracotta|burgundy)\b/i;

      for (let i = 0; i < 5; i += 1) {
        const seed = `harness-seed-${i}`;
        const assignedPalette = pickPalette(seed, { ids: paletteIds, families });
        const assignedLayout = pickLayout(
          seed,
          { hasPhoto: true, copyStyle: 'info_bullets' },
          { ids: layoutIds, coverages },
        );

        const ad = await generateArtDirection({
          note: NOTE,
          copyStyle: 'info_bullets',
          referenceHint: REFERENCE_HINT,
          seed,
          assignedPalette,
          assignedLayout,
          recentTreatments: recent,
        });

        console.log(
          `\n=== seed ${i} · ${assignedPalette.name} (${assignedPalette.family}) · ${assignedLayout.name} (${assignedLayout.coverage}) ===`,
        );
        console.log(JSON.stringify(ad, null, 2));
        if (ad) {
          const blob = [ad.background, ad.composition, ad.mood, ad.accents].join(' ');
          const leak = colourWord.exec(blob);
          if (leak) console.log(`  !! named a colour: "${leak[0]}" (the palette is assigned)`);
          if (ad.palette) console.log('  !! returned a palette field despite an assignment');
        }

        recent.unshift(`${assignedPalette.palette}, ${assignedLayout.name}`);
        recent.splice(4);
        paletteIds.unshift(assignedPalette.id);
        paletteIds.splice(5);
        families.unshift(assignedPalette.family);
        families.splice(3);
        layoutIds.unshift(assignedLayout.id);
        layoutIds.splice(4);
        coverages.unshift(assignedLayout.coverage);
        coverages.splice(2);
      }
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    });
}
