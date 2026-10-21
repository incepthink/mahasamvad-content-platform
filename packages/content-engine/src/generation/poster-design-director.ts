// A DESIGN DIRECTOR for the fully-AI ('fresh' / 'fresh_verbatim') social poster: one small
// strict-JSON call that decides, in plain English words, how THIS poster should present its
// information — the form, where the visual weight sits, what imagery, and a colour mood on a light
// ground. Its `brief` is the only thing that reaches the image model.
//
// WHY IT EXISTS (2026-09-26). A contact sheet of the last 13 fresh renders showed the same poster
// almost every time: headline top-left, one column of lines each with a small icon, a photograph
// bottom-right, warm cream with saffron and maroon. The fresh prompt (minimal-creative-prompt.ts)
// says nothing about design, so gpt-image falls back to its own default for "headline + points".
// The runner still PICKED a palette, a layout and a placement, but none of the three ever reached
// the prompt — they were only written to generations.poster_style, which is why a poster could be
// labelled with a palette the model never saw.
//
// WHAT IT IS NOT. Not a template library and not a colour picker: no hex codes, no assigned
// archetype. It reads the SHAPE of the content (figures, dates, one message, many points, a place
// or people) and chooses a presentation from a vocabulary of principles, steering gently away from
// what recent posters did. The four enums exist only so a direction can be remembered and
// compared; the brief is free prose.
//
// SAFETY. The brief is style-only English and is sanitised in code: any sentence carrying
// Devanagari, a digit, a quotation, a hex code, a map/wave/logo, or a dark-ground phrase is
// dropped, and a brief left too thin returns null. It can never supply poster text or a fact, and
// the image prompt states that it never overrides the text, numbers, icons or zone rules.
//
// NEVER A GATE. Every failure returns null and the poster renders without a direction — exactly
// the prompt that shipped before this file existed, plus the light-ground rule.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  chatComplete,
  UTILITY_MODEL,
  type ReasoningEffort,
} from './openai-chat.js';
import { traceSpan } from '../tracing/job-trace.js';

// How the information is presented. `icon_list` is the overused default this module exists to
// break; it stays in the vocabulary because for some content it genuinely is right.
export const DESIGN_FORMS = [
  'figure_led',
  'sequence',
  'statement',
  'grouped_sections',
  'split_columns',
  'feature_and_supporting',
  'image_led',
  'icon_list',
  'other',
] as const;
// Where the visual weight sits.
export const DESIGN_COMPOSITIONS = [
  'top',
  'bottom',
  'left',
  'right',
  'centre',
  'full_bleed',
  'layered',
] as const;
export const DESIGN_IMAGERY = [
  'photo_large',
  'photo_inset',
  'photo_cutout',
  'illustration',
  'graphic_only',
  'none',
] as const;
// The HueBucket names from poster-renderer/src/poster-colours.ts, verbatim, so a chosen mood can
// be compared directly with what the render MEASURED. Redeclared rather than imported because
// content-engine does not depend on poster-renderer (the API joins the two).
export const COLOUR_MOODS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'neutral',
] as const;

export type DesignForm = (typeof DESIGN_FORMS)[number];
export type DesignComposition = (typeof DESIGN_COMPOSITIONS)[number];
export type DesignImagery = (typeof DESIGN_IMAGERY)[number];
export type ColourMood = (typeof COLOUR_MOODS)[number];

// What is remembered about a direction (generations.poster_style.design). No brief: prose is not
// comparable, and the enums are what the next run is told to differ from.
export type PosterDesign = Readonly<{
  form: DesignForm;
  composition: DesignComposition;
  imagery: DesignImagery;
  colourMood: ColourMood;
}>;

export type PosterDesignDirection = PosterDesign &
  Readonly<{
    // English style prose, sanitised. The only field that reaches the image model.
    brief: string;
  }>;

export type RedoKind = 'arrangement' | 'colour';

type Messages = readonly { role: 'system' | 'user'; content: string }[];
// The one model call, injectable so the offline harness can exercise the redo retry for free.
export type DesignDirectorCall = (messages: Messages) => Promise<string>;

export type DirectPosterDesignInput = Readonly<{
  // The text the poster will actually print (the officer's note on fresh_verbatim, the copy
  // manifest on fresh). Read for its SHAPE only; truncated.
  text: string;
  // How many distinct items that text carries besides its headline (0 = unknown).
  itemCount: number;
  // Whether the text opens with a headline, which `itemCount` does not include.
  hasHeadline?: boolean | undefined;
  // The last few stored directions, newest first.
  recent?: readonly PosterDesign[] | undefined;
  // The hue buckets recent renders were MEASURED in, newest first — what actually shipped.
  recentMeasuredBuckets?: readonly string[] | undefined;
  // The direction of the version being redone. Absent on a first render.
  previous?: PosterDesign | undefined;
  // What that previous render measured, for a colour redo.
  previousMeasuredBucket?: string | undefined;
  redoKind?: RedoKind | undefined;
  // Overrides DESIGN_MODEL for this call (the जसाच्या तसा मजकूर lane runs on
  // VERBATIM_DESIGN_MODEL). Ignored when `call` is supplied.
  model?: string | undefined;
  call?: DesignDirectorCall | undefined;
}>;

// One env read, so rollback is a single line.
export function posterDesignDirectionEnabled(): boolean {
  return (
    (process.env.SOCIAL_POSTER_DESIGN_DIRECTION ?? '').trim().toLowerCase() !==
    'off'
  );
}

const DESIGN_MODEL =
  process.env.OPENAI_POSTER_DESIGN_MODEL?.trim() || UTILITY_MODEL;
// The जसाच्या तसा मजकूर (fresh_verbatim) lane's director model.
export const VERBATIM_DESIGN_MODEL =
  process.env.OPENAI_POSTER_DESIGN_VERBATIM_MODEL?.trim() || 'gpt-6-luna';
const DESIGN_EFFORT: ReasoningEffort = 'low';
const TEXT_MAX_CHARS = 1500;
// Below this many words, what survived sanitising is not a direction worth sending.
export const BRIEF_MIN_WORDS = 25;
// The prompt asks for ~90; this is the hard ceiling, trimmed at a sentence boundary.
export const BRIEF_MAX_WORDS = 120;

// What no DGIPR director may ever propose — the single poster's and the carousel's
// (carousel-design-director.ts). Emitted FIRST, straight after each director's role line, because
// these are the rules a direction must never break. The two reserved areas lead the list: the
// badge corner and the footer strip are covered by code-stamped branding afterwards, so anything
// placed there is lost. The footer item still says the background runs to the bottom edge, or the
// model answers it by leaving a blank strip — the very emptiness officers complain about.
export const NEVER_PROPOSE: readonly string[] = [
  'NEVER PROPOSE:',
  '- Anything in the top-right corner (about 180 × 170). An official badge is stamped there afterwards.',
  '- Any information in the footer pill area: a small navy footer pill is placed afterwards over the bottom-centre of the poster (roughly the middle three-fifths of the width, the last ~55 pixels). No text, numbers or icons there. The bottom-left and bottom-right corners beside it stay visible and are free to use.',
  '- A footer band, bar, strip or coloured panel painted across the bottom, or an empty band above the footer. The footer is added by software; the design itself simply continues to the bottom edge.',
  '- Maps or state/territory outlines.',
  '- Waves, swooshes or curved ribbons along the bottom.',
  '- Large or bulky icons (icons stay small).',
  '- Outlined boxes around every block, decorative divider lines, or an icon beside every heading or point.',
  '- More than one marker on a single point: a point carries a number OR a small icon OR a plain bullet, never a number tile together with an icon. Every point in a list uses the same kind of marker.',
  '- Logos, emblems, seals or QR codes.',
  '- A dark, black, charcoal, navy or night-mode background.',
];

// The design principles every DGIPR director works to — the single poster's and the carousel's.
// One list, so the two lanes cannot drift about what "creative but official" means, what the
// overused default is, or how much of the canvas a design should use.
export const DESIGN_PRINCIPLES: readonly string[] = [
  'TONE: official government communication. Dignified, uncluttered, trustworthy, and easy to read on a phone at a glance. Professional and contemporary, never gimmicky.',
  '',
  'CHOOSE HOW THE INFORMATION IS SHOWN FROM WHAT IT CONTAINS:',
  '- Numbers-heavy content (amounts, counts, percentages): let the figures carry the design as large, confident type.',
  '- Dated or ordered content (a schedule, steps, a deadline): a sequence the eye can follow.',
  '- A single message: a strong typographic statement set large enough to command the canvas.',
  '- Many mixed points: grouped sections with clear headings.',
  '- Content about a place or about people: led by imagery.',
  '- One column of lines each with a small icon beside it is ONE option among many, and it is the overused default. Use it only when nothing else suits the content and the recent posters did not use it.',
  '',
  'COMPOSITION: decide where the visual weight sits and how the canvas is divided. The shape that has been repeated far too often is: headline at the top left, a list down the left, a photograph at the bottom right. Do not fall back on it.',
  '',
  // Officers reported designs with too much blank space. "Generous space" was the old single-
  // message wording, and the image prompt opened with "not be congested", so nothing pushed the
  // other way. That opening line now asks for the whole canvas too (minimal-creative-prompt.ts).
  'USE THE WHOLE CANVAS: the design should fill the poster from edge to edge. Text, imagery, panels and colour fields together occupy most of the canvas; no large empty areas, no empty quadrant or half, and no small block of content floating in a big plain field. Scale the type and the imagery up until the space is well used. Space is used BETWEEN groups to separate them, never as leftover emptiness. A poster with few lines gets larger type and a larger image, not more blank space.',
  '',
  'IMAGERY: decide whether to use any, of what kind (photograph, illustration, or purely graphic), and how large. Imagery is bright and naturally lit.',
  '',
  'Also direct typography and hierarchy (what is largest, what is secondary), spacing, and graphic treatment (panels, blocks, texture).',
  '',
  'RESTRAINT: build structure with spacing, alignment, typography, colour and imagery. Use a border, divider or icon only where it has a clear function (separating genuinely distinct sections, or telling the reader something the words do not); never icons alongside imagery that already gives the visual context. A numbered list is numbered, an icon list uses icons — never both on the same point. The look is clean and editorial, like a well-designed government publication.',
  '',
  'COLOUR: describe a colour mood in words, ALWAYS on a LIGHT ground (white, off-white, or a pale tint). Saturated colour belongs in panels, headings and accents. Never give hex codes. Do not default to cream with saffron and maroon.',
];

// The single poster's own blocks. Kept out of the shared lists: the carousel has its own canvas
// wording and plans its slide text itself.
const CANVAS_RULE =
  'THE CANVAS: a tall portrait poster, about 4:5 (1280 wide × 1552 high). Apart from the two reserved areas above, the whole canvas is yours to design.';
const TEXT_RULE =
  'THE TEXT: every line of the poster text is printed in full, in Marathi (Devanagari script). Nothing is dropped or shortened. Choose a presentation that can hold all of it comfortably, and direct the typography for Devanagari: weight, size and line spacing that keep matras and conjuncts clear.';
// How many of the most recent posters the variety rule compares against.
const VARIETY_WINDOW = 3;

const SYSTEM_PROMPT = [
  'You are the design director for DGIPR, the Directorate General of Information and Public Relations, Government of Maharashtra. For each social-media poster you decide its visual direction in a few English sentences, which an image model then follows. You never write the poster text: that is supplied separately and is not yours to touch.',
  '',
  ...NEVER_PROPOSE,
  '',
  CANVAS_RULE,
  '',
  TEXT_RULE,
  '',
  ...DESIGN_PRINCIPLES,
  '',
  'OUTPUT RULES: style only, in English. Never write any poster text, headline, words to print, numbers, names, dates or places, and never quote anything.',
  `VARIETY RULE: compare your choice with each of the three most recent posters in the message. Against each of them, at least two of form, composition, imagery and colourMood must be different. Your colourMood must not be any colour already used by a listed poster or listed as a colour recent posters came out in, unless every colour mood is already used.`,
  '',
  'Answer with STRICT JSON: form, composition (where the visual weight sits), imagery, colourMood (the hue family of the saturated colours), and brief (about 70 to 90 words of direction for the image model, in plain sentences).',
].join('\n');

function describe(design: PosterDesign): string {
  return `form=${design.form}, weight=${design.composition}, imagery=${design.imagery}, colour=${design.colourMood}`;
}

function measuredColours(input: DirectPosterDesignInput): string[] {
  return (input.recentMeasuredBuckets ?? []).filter(
    (b) => b && b !== 'neutral',
  );
}

// The colour moods recent posters used — chosen or measured — and those still free. When every
// mood is used, `available` is empty and the colour half of the variety rule lapses.
export function colourAvailability(input: DirectPosterDesignInput): {
  used: ColourMood[];
  available: ColourMood[];
} {
  const used = new Set<string>([
    ...(input.recent ?? []).map((d) => d.colourMood),
    ...measuredColours(input),
  ]);
  return {
    used: COLOUR_MOODS.filter((c) => used.has(c)),
    available: COLOUR_MOODS.filter((c) => !used.has(c)),
  };
}

function sharedFields(a: PosterDesign, b: PosterDesign): number {
  return (
    Number(a.form === b.form) +
    Number(a.composition === b.composition) +
    Number(a.imagery === b.imagery) +
    Number(a.colourMood === b.colourMood)
  );
}

// Did a direction break the variety rule? Too close to one of the last three posters (fewer than
// two of the four fields differ), or a used colour while unused ones remain.
export function breaksVariety(
  direction: PosterDesign,
  input: DirectPosterDesignInput,
): boolean {
  const tooClose = (input.recent ?? [])
    .slice(0, VARIETY_WINDOW)
    .some((r) => sharedFields(direction, r) > 2);
  const { used, available } = colourAvailability(input);
  return (
    tooClose || (available.length > 0 && used.includes(direction.colourMood))
  );
}

function describeContent(input: DirectPosterDesignInput): string {
  const n = input.itemCount;
  if (n <= 0) {
    return input.hasHeadline
      ? 'The poster carries a headline; the number of other items is not known.'
      : 'The number of items is not known.';
  }
  const points = `${n} point${n === 1 ? '' : 's'}`;
  return `The poster carries ${input.hasHeadline ? `a headline and ${points}` : points}. All of it is printed in full.`;
}

// Exported for the harness, which prints it for review.
export function buildDesignDirectorUserPrompt(
  input: DirectPosterDesignInput,
  sharper = false,
  varietyRetry = false,
): string {
  const lines: string[] = [];
  const recent = input.recent ?? [];
  if (recent.length > 0) {
    lines.push(
      'Recent posters from this department, newest first:',
      ...recent.map((d, i) => `  ${i + 1}. ${describe(d)}`),
    );
  }
  const measured = measuredColours(input);
  if (measured.length > 0) {
    lines.push(
      `Colours recent posters actually came out in: ${measured.join(', ')}.`,
    );
  }
  const { used, available } = colourAvailability(input);
  if (used.length > 0 && available.length > 0) {
    lines.push(
      `Colours already used: ${used.join(', ')}. Choose from: ${available.join(', ')}.`,
    );
  } else if (used.length > 0 && recent.length > 0) {
    lines.push(
      "Every colour mood has been used recently; choose a colour different from poster 1's.",
    );
  }
  const window = Math.min(VARIETY_WINDOW, recent.length);
  if (window > 0) {
    const which =
      window === 1
        ? 'poster 1'
        : `posters ${Array.from({ length: window }, (_, i) => i + 1)
            .join(', ')
            .replace(/, (\d)$/, ' and $1')}`;
    lines.push(
      `Against ${which}, at least two of form, composition, imagery and colourMood must differ.`,
    );
  }
  if (varietyRetry) {
    lines.push(
      'Your previous answer was too close to a recent poster or reused a recent colour. Follow the two rules above exactly.',
    );
  }
  if (lines.length > 0) lines.push('');

  if (input.previous && input.redoKind === 'arrangement') {
    lines.push(
      `THIS IS A REDO. The officer rejected a poster designed as: ${describe(input.previous)}.`,
      `It asked for a different ARRANGEMENT: your form MUST differ from "${input.previous.form}" AND your composition MUST differ from "${input.previous.composition}".`,
    );
    if (sharper) {
      lines.push(
        'Your previous answer repeated that form and composition. Choose a genuinely different presentation this time — a different way of showing the information and a different place for the visual weight.',
      );
    }
    lines.push('');
  } else if (input.previous && input.redoKind === 'colour') {
    const bucket = input.previousMeasuredBucket
      ? ` (it measured ${input.previousMeasuredBucket})`
      : '';
    lines.push(
      `THIS IS A REDO in DIFFERENT COLOURS. The rejected poster's colour mood was ${input.previous.colourMood}${bucket}. Your colourMood MUST be a different hue family; the arrangement may stay similar.`,
    );
    if (sharper) {
      lines.push(
        'Your previous answer kept the same colour family. Choose a different one.',
      );
    }
    lines.push('');
  }

  lines.push(
    describeContent(input),
    'The poster text follows, ONLY so you can judge the shape of its content (figures, dates, one message, many points, places, people). Never copy any of it into your answer:',
    input.text.trim().slice(0, TEXT_MAX_CHARS),
  );
  return lines.join('\n');
}

// Exported for carousel-design-director.ts, which answers in the same tolerant JSON.
export function parseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | null {
  const v =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
      : '';
  return (values as readonly string[]).includes(v) ? (v as T) : null;
}

// Parse a stored or returned design. Null for anything unusable; `form` alone tolerates an
// unknown value (as 'other'), because a new form word is still a direction worth remembering.
export function parsePosterDesign(value: unknown): PosterDesign | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const composition = oneOf(DESIGN_COMPOSITIONS, raw.composition);
  const imagery = oneOf(DESIGN_IMAGERY, raw.imagery);
  const colourMood = oneOf(COLOUR_MOODS, raw.colourMood);
  if (!composition || !imagery || !colourMood) return null;
  return {
    form: oneOf(DESIGN_FORMS, raw.form) ?? 'other',
    composition,
    imagery,
    colourMood,
  };
}

// --- The sanitiser ------------------------------------------------------------------------
//
// Cheap guards, no second model. A sentence is dropped whole rather than edited: a half-cleaned
// sentence is a worse instruction than a missing one.
const DROP_SENTENCE: readonly RegExp[] = [
  /[ऀ-ॿ]/, // Devanagari — any poster text
  /\d/, // a number of any kind
  /["“”«»„]/, // a double quotation
  /(^|[\s(])['‘][^'’]{2,}['’](?=[\s.,;:!?)]|$)/, // a single-quoted span
  /#[0-9a-f]{3,8}\b/i, // a hex colour
  /\b(maps?|outlines? of (the )?(state|country|district|maharashtra|india))\b/i,
  /\b(waves?|wavy|swoosh\w*|ribbons?)\b/i,
  /\b(logos?|emblems?|seals?|qr|barcodes?|watermarks?)\b/i,
  // A dark ground, in either word order.
  /\b(dark|black|charcoal|navy|night|midnight|near-black|deep)(\s|-)+(\w+\s+){0,2}(background|ground|canvas|backdrop|base|page|field)\b/i,
  /\b(background|ground|canvas|backdrop|page)\s+(is\s+|of\s+|in\s+)?(\w+\s+)?(dark|black|charcoal|navy|midnight)\b/i,
  /\b(dark|night)[\s-]mode\b/i,
];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Returns the cleaned brief, or null when too little survives. The limits default to the single
// poster's; the carousel's per-slide briefs are shorter and pass their own.
export function sanitizeBrief(
  brief: string,
  limits: Readonly<{ minWords?: number; maxWords?: number }> = {},
): string | null {
  const minWords = limits.minWords ?? BRIEF_MIN_WORDS;
  const maxWords = limits.maxWords ?? BRIEF_MAX_WORDS;
  const sentences = brief
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    if (DROP_SENTENCE.some((re) => re.test(sentence))) continue;
    const n = wordCount(sentence);
    if (words + n > maxWords) break;
    kept.push(sentence);
    words += n;
  }
  if (words < minWords) return null;
  return kept.join(' ');
}

function parseDirection(raw: string): PosterDesignDirection | null {
  const parsed = parseJson(raw);
  if (!parsed) return null;
  const design = parsePosterDesign(parsed);
  if (!design) return null;
  const brief = sanitizeBrief(
    typeof parsed.brief === 'string' ? parsed.brief : '',
  );
  if (!brief) return null;
  return { ...design, brief };
}

// Did a redo ignore what it was asked to change?
export function repeatsPrevious(
  direction: PosterDesign,
  previous: PosterDesign | undefined,
  redoKind: RedoKind | undefined,
): boolean {
  if (!previous || !redoKind) return false;
  if (redoKind === 'arrangement') {
    return (
      direction.form === previous.form &&
      direction.composition === previous.composition
    );
  }
  return direction.colourMood === previous.colourMood;
}

const callWithModel =
  (model: string): DesignDirectorCall =>
  (messages) =>
  chatComplete(messages, {
    model,
    reasoningEffort: DESIGN_EFFORT,
    maxTokens: 500,
    jsonSchema: {
      name: 'poster_design_direction',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          form: { type: 'string', enum: [...DESIGN_FORMS] },
          composition: { type: 'string', enum: [...DESIGN_COMPOSITIONS] },
          imagery: { type: 'string', enum: [...DESIGN_IMAGERY] },
          colourMood: { type: 'string', enum: [...COLOUR_MOODS] },
          brief: { type: 'string' },
        },
        required: ['form', 'composition', 'imagery', 'colourMood', 'brief'],
      },
    },
  });

// Decide this poster's direction, or null. Never throws.
// Traced at the definition: one span per decision, with the model call and any guard it ran
// nested inside it. A plain call outside a traced job.
export function directPosterDesign(
  ...args: Parameters<typeof directPosterDesignUntraced>
): ReturnType<typeof directPosterDesignUntraced> {
  return traceSpan('decision: poster design director', () => directPosterDesignUntraced(...args), {
    input: args[0],
  });
}

async function directPosterDesignUntraced(
  input: DirectPosterDesignInput,
): Promise<PosterDesignDirection | null> {
  if (input.text.trim().length === 0) return null;
  const call = input.call ?? callWithModel(input.model ?? DESIGN_MODEL);
  const ask = async (
    sharper: boolean,
    varietyRetry: boolean,
  ): Promise<PosterDesignDirection | null> =>
    parseDirection(
      await call([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildDesignDirectorUserPrompt(input, sharper, varietyRetry),
        },
      ]),
    );
  try {
    const first = await ask(false, false);
    if (!first) return first;
    const repeated = repeatsPrevious(first, input.previous, input.redoKind);
    const unvaried = breaksVariety(first, input);
    if (!repeated && !unvaried) return first;
    // ONE retry with a sharper note, then accept whatever comes back: a direction that still
    // repeats is better than no direction at all. The prompt alone has been seen to repeat a
    // recent poster's imagery and colour, which is why the variety rule is checked in code too.
    const second = await ask(repeated, unvaried).catch(() => null);
    return second ?? first;
  } catch (error) {
    console.warn(
      '[poster-design] direction failed (rendering without one):',
      error,
    );
    return null;
  }
}

// --- CLI harness ----------------------------------------------------------------------------
//   tsx src/generation/poster-design-director.ts --check              (free, offline)
//   tsx --env-file=../../.env src/generation/poster-design-director.ts --file=note.txt   (cents)
// The live run makes five sequential directions with a rolling recent memory, then one
// arrangement redo of the last. Use --file: npx truncates a multi-line argv on Windows.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  const GOOD_BRIEF =
    'Let the figures carry the design as large confident numerals set against a pale sky-tinted ground. Arrange the information as three grouped sections stacked with generous spacing and a clear heading for each. Use a bright naturally lit photograph as a wide band across the lower third. Keep panels flat with thin rules between sections and small line icons only. The headline sits centred and bold with ample breathing room.';

  if (process.argv.includes('--check')) {
    // 1. The tolerant parser + enum coercion.
    const direction = parseDirection(
      `Here you go: ${JSON.stringify({
        form: 'Figure-Led',
        composition: 'centre',
        imagery: 'photo_large',
        colourMood: 'blue',
        brief: GOOD_BRIEF,
      })} thanks`,
    );
    check(
      direction?.form === 'figure_led',
      'fenced/prosy JSON did not parse with enum coercion',
    );
    check(
      direction?.brief === GOOD_BRIEF,
      'a clean brief was altered by the sanitiser',
    );
    check(parseDirection('not json') === null, 'junk parsed');
    check(
      parseDirection(
        JSON.stringify({
          form: 'x',
          composition: 'diagonal',
          imagery: 'none',
          colourMood: 'blue',
          brief: GOOD_BRIEF,
        }),
      ) === null,
      'an unknown composition was accepted',
    );
    check(
      parsePosterDesign({
        form: 'brand_new',
        composition: 'top',
        imagery: 'none',
        colourMood: 'teal',
      })?.form === 'other',
      'an unknown form was not folded to other',
    );

    // 2. The sanitiser drops each forbidden kind of sentence.
    for (const [kind, bad] of [
      ['Devanagari', 'Put शेतकरी in the headline.'],
      ['digits', 'Show the 25 lakh figure large.'],
      ['hex', 'Use #1E3A8A for the panels.'],
      ['quote', 'Headline it "Solar pumps for all".'],
      ['single quote', "Title the band 'Solar pumps' in bold."],
      ['map', 'Place a map of Maharashtra behind the text.'],
      ['wave', 'Finish with a soft wave along the bottom.'],
      ['logo', 'Add the government logo near the heading.'],
      ['dark ground', 'Set everything on a deep navy background.'],
      ['dark ground reversed', 'The background is charcoal with white type.'],
      ['night mode', 'Give it a night-mode feel.'],
    ] as const) {
      const out = sanitizeBrief(`${GOOD_BRIEF} ${bad}`);
      check(
        out === GOOD_BRIEF,
        `the sanitiser kept a ${kind} sentence: ${out}`,
      );
    }
    check(
      sanitizeBrief(
        "Use the poster's main figure large and bright on a white ground with calm spacing throughout the canvas and small icons beside each section heading for clarity and a light airy feel overall.",
      ) !== null,
      'an apostrophe was mistaken for a quotation',
    );
    // 3. The null floor.
    check(
      sanitizeBrief('Large figures on a pale ground.') === null,
      'a thin brief passed the floor',
    );
    check(
      sanitizeBrief(
        'Show 12 points. Use #FFF. Put शासन at top. A dark navy background.',
      ) === null,
      'an all-forbidden brief did not return null',
    );
    // The ceiling trims at a sentence boundary.
    const long = sanitizeBrief(
      Array.from({ length: 12 }, () => GOOD_BRIEF.split('. ')[0] + '.').join(
        ' ',
      ),
    );
    check(
      long !== null && wordCount(long) <= BRIEF_MAX_WORDS,
      'the word ceiling was not applied',
    );

    // 4. The redo retry, on a stubbed call.
    const previous: PosterDesign = {
      form: 'icon_list',
      composition: 'left',
      imagery: 'photo_inset',
      colourMood: 'orange',
    };
    const answer = (d: Partial<PosterDesign>): string =>
      JSON.stringify({ ...previous, ...d, brief: GOOD_BRIEF });
    const run = async (
      answers: string[],
      redoKind?: RedoKind,
    ): Promise<[PosterDesignDirection | null, number, string[]]> => {
      const prompts: string[] = [];
      let calls = 0;
      const result = await directPosterDesign({
        text: 'राज्यातील २५ लाख शेतकऱ्यांना सौर कृषी पंप',
        itemCount: 3,
        previous: redoKind ? previous : undefined,
        redoKind,
        call: async (messages) => {
          prompts.push(messages[1]?.content ?? '');
          const a = answers[calls] ?? answers[answers.length - 1] ?? '';
          calls += 1;
          return a;
        },
      });
      return [result, calls, prompts];
    };
    const [same, sameCalls, samePrompts] = await run(
      [answer({}), answer({ form: 'figure_led', composition: 'top' })],
      'arrangement',
    );
    check(
      sameCalls === 2,
      `a repeating arrangement redo made ${sameCalls} call(s), expected 2`,
    );
    check(same?.form === 'figure_led', 'the retry answer was not used');
    check(
      samePrompts[1]?.includes('Your previous answer repeated') ?? false,
      'the retry carried no sharper note',
    );
    const [, fineCalls] = await run(
      [answer({ form: 'sequence' })],
      'arrangement',
    );
    check(fineCalls === 1, 'a redo that already differed was retried');
    const [stubborn, stubbornCalls] = await run(
      [answer({}), answer({})],
      'arrangement',
    );
    check(
      stubbornCalls === 2 && stubborn?.form === 'icon_list',
      'a second repeat was not accepted',
    );
    const [, colourCalls] = await run(
      [answer({ form: 'sequence' }), answer({ colourMood: 'teal' })],
      'colour',
    );
    check(
      colourCalls === 2,
      'a colour redo keeping the colour mood was not retried',
    );
    const [, firstCalls] = await run([answer({})]);
    check(firstCalls === 1, 'a first render was retried');
    const [failed] = await run(['{broken']);
    check(failed === null, 'a broken answer did not return null');
    const threw = await directPosterDesign({
      text: 'x',
      itemCount: 1,
      call: async () => {
        throw new Error('boom');
      },
    });
    check(threw === null, 'a throwing call did not return null');

    // 5. The recent/previous notes.
    const prompt = buildDesignDirectorUserPrompt({
      text: 'मजकूर',
      itemCount: 4,
      recent: [
        previous,
        {
          form: 'image_led',
          composition: 'full_bleed',
          imagery: 'photo_large',
          colourMood: 'green',
        },
      ],
      recentMeasuredBuckets: ['orange', 'neutral', 'red'],
      previous,
      redoKind: 'arrangement',
    });
    console.log(`--- user prompt ---\n${prompt}\n-------------------`);
    check(
      prompt.includes('1. form=icon_list, weight=left'),
      'recent designs not listed',
    );
    check(
      prompt.includes('came out in: orange, red.'),
      'measured buckets not listed (or neutral kept)',
    );
    check(
      prompt.includes('form MUST differ from "icon_list"'),
      'the arrangement redo note is missing',
    );
    check(
      !buildDesignDirectorUserPrompt({ text: 'x', itemCount: 0 }).includes(
        'Recent posters',
      ),
      'an empty history rendered a heading',
    );
    check(
      SYSTEM_PROMPT.includes('overused default'),
      'the system prompt lost the icon-list warning',
    );
    check(
      SYSTEM_PROMPT.includes('LIGHT ground'),
      'the system prompt lost the light-ground rule',
    );

    // 6. The 2026-10-21 revision: bans first, footer named, whole canvas, variety rule.
    const neverAt = SYSTEM_PROMPT.indexOf('NEVER PROPOSE:');
    check(
      neverAt > 0 &&
        neverAt < SYSTEM_PROMPT.indexOf('THE CANVAS:') &&
        neverAt < SYSTEM_PROMPT.indexOf('TONE:'),
      'NEVER PROPOSE is not the first block after the role line',
    );
    check(
      SYSTEM_PROMPT.includes('Any information in the footer pill area') &&
        SYSTEM_PROMPT.includes('continues to the bottom edge') &&
        SYSTEM_PROMPT.includes('never a number tile together with an icon'),
      'the footer ban (and its run-to-the-edge clause) is missing',
    );
    check(
      SYSTEM_PROMPT.includes('USE THE WHOLE CANVAS') &&
        !SYSTEM_PROMPT.includes('generous space.'),
      'the whole-canvas rule is missing or "generous space" survived',
    );
    check(
      SYSTEM_PROMPT.includes('VARIETY RULE') &&
        SYSTEM_PROMPT.includes('printed in full, in Marathi'),
      'the variety rule or the text rule is missing',
    );
    check(
      prompt.includes('Colours already used: red, orange, green.') &&
        prompt.includes('Choose from: yellow, teal, blue, purple, neutral.'),
      'the colour availability line is wrong',
    );
    check(
      prompt.includes(
        'Against posters 1 and 2, at least two of form, composition, imagery and colourMood must differ.',
      ),
      'the variety line does not name the recent posters',
    );
    check(
      !prompt.includes('where the content allows'),
      'the soft variety sentence survived',
    );
    check(
      buildDesignDirectorUserPrompt({
        text: 'x',
        itemCount: 5,
        hasHeadline: true,
      }).includes('The poster carries a headline and 5 points.'),
      'the headline was not separated from the points',
    );
    const fiveRecent: PosterDesign[] = [
      'purple',
      'blue',
      'teal',
      'red',
      'orange',
    ].map((colourMood, i) => ({
      form: (['feature_and_supporting', 'sequence', 'grouped_sections', 'split_columns', 'sequence'] as const)[i]!,
      composition: (['centre', 'left', 'centre', 'right', 'top'] as const)[i]!,
      imagery: (['illustration', 'graphic_only', 'graphic_only', 'photo_inset', 'photo_large'] as const)[i]!,
      colourMood: colourMood as ColourMood,
    }));
    const realRun = buildDesignDirectorUserPrompt({
      text: 'मजकूर',
      itemCount: 5,
      hasHeadline: true,
      recent: fiveRecent,
      recentMeasuredBuckets: ['purple', 'blue', 'teal'],
    });
    console.log(`--- 46186e60-shaped prompt ---\n${realRun}\n-------------------`);
    check(
      realRun.includes('Choose from: yellow, green, neutral.') &&
        realRun.includes('Against posters 1, 2 and 3,'),
      'the reported run would not have been told which colours and posters to avoid',
    );
    // The reported run's own answer breaks the rule (orange was poster 5's colour).
    check(
      breaksVariety(
        {
          form: 'image_led',
          composition: 'layered',
          imagery: 'photo_large',
          colourMood: 'orange',
        },
        { text: 'x', itemCount: 5, recent: fiveRecent },
      ),
      'the reported answer was not caught by the variety check',
    );

    // 7. A first render that breaks variety is asked once more.
    const varietyRun = async (
      answers: string[],
    ): Promise<[PosterDesignDirection | null, number, string[]]> => {
      const prompts: string[] = [];
      let calls = 0;
      const result = await directPosterDesign({
        text: 'राज्यातील २५ लाख शेतकऱ्यांना सौर कृषी पंप',
        itemCount: 3,
        recent: [previous],
        call: async (messages) => {
          prompts.push(messages[1]?.content ?? '');
          const a = answers[calls] ?? answers[answers.length - 1] ?? '';
          calls += 1;
          return a;
        },
      });
      return [result, calls, prompts];
    };
    const [closeFix, closeCalls, closePrompts] = await varietyRun([
      answer({ colourMood: 'teal' }),
      answer({ form: 'figure_led', composition: 'top', colourMood: 'teal' }),
    ]);
    check(
      closeCalls === 2 && closeFix?.form === 'figure_led',
      'a first render too close to poster 1 was not retried',
    );
    check(
      closePrompts[1]?.includes('too close to a recent poster') ?? false,
      'the variety retry carried no note',
    );
    const [, reusedCalls] = await varietyRun([
      answer({
        form: 'figure_led',
        composition: 'top',
        imagery: 'none',
        colourMood: 'orange',
      }),
    ]);
    check(reusedCalls === 2, 'a reused colour was not retried');
    const [, variedCalls] = await varietyRun([
      answer({
        form: 'figure_led',
        composition: 'top',
        imagery: 'none',
        colourMood: 'teal',
      }),
    ]);
    check(variedCalls === 1, 'a varied first render was retried');

    if (failures.length > 0) {
      console.error(`\n${failures.length} FAILURE(S):`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\nAll poster-design-director assertions passed.');
    }
  } else {
    const fileArg = process.argv.find((a) => a.startsWith('--file='));
    if (!fileArg) {
      console.error(
        'Usage: tsx src/generation/poster-design-director.ts --check | --file=note.txt',
      );
      process.exitCode = 1;
    } else {
      const text = await readFile(fileArg.slice('--file='.length), 'utf8');
      const { analyzeInformationShape } = await import(
        '../references/select-by-information.js'
      );
      const { itemCount, hasExplicitHeadline: hasHeadline } =
        analyzeInformationShape(text);
      const recent: PosterDesign[] = [];
      let last: PosterDesignDirection | null = null;
      for (let i = 0; i < 5; i += 1) {
        const d = await directPosterDesign({
          text,
          itemCount,
          hasHeadline,
          recent,
        });
        console.log(`\n=== run ${i + 1} ===\n${JSON.stringify(d, null, 2)}`);
        if (d) {
          recent.unshift(d);
          recent.splice(5);
          last = d;
        }
      }
      if (last) {
        const redo = await directPosterDesign({
          text,
          itemCount,
          hasHeadline,
          recent,
          previous: last,
          redoKind: 'arrangement',
        });
        console.log(
          `\n=== arrangement redo of run ${recent.length} ===\n${JSON.stringify(redo, null, 2)}`,
        );
        if (redo && repeatsPrevious(redo, last, 'arrangement')) {
          console.log('!! the redo kept both form and composition');
        }
      }
    }
  }
}
