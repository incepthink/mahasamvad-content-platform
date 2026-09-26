// Plan a carousel (कॅरोसेल, migration 0059): one note → a cover slide plus two or three detail
// slides. ONE strict-JSON text call on POSTER_COPY_MODEL decides what goes on which slide; the
// image model never sees the note, only the plan.
//
// INSTRUCT, THEN GUARANTEE — the repo's standing shape. The prompt is the department's own two
// sentences; the json_schema's descriptions say what each field means, and the pure
// normalizeCarouselPlan below makes the parts that must hold hold:
//   - the slide count is clamped to 3-4 (or to exactly what the officer asked for);
//   - every digit run must occur in the note, or the line is DROPPED (never re-valued, and
//     never a failed run — the rest of the post is still good);
//   - no slide carries more than CAROUSEL_MAX_ITEMS_PER_SLIDE; overflow moves to the NEXT slide
//     rather than being dropped;
//   - verified scheme/org names are expanded to their full form (lockSchemeNames).
//
// The model returns items as plain strings; they are stored in the `{text, emphasis}` shape
// generate-poster-copy.ts uses for a bullet, with emphasis empty.
//
// Each slide also carries a short English `visual` — what its picture shows, drawn from that
// slide's own lines. Every slide is GENERATED FRESH (not edited from the cover), so this brief is
// what gives slide 3 its own image; the shared palette and series frame keep the set together.
//
// THE PLANNER IS ALSO THE ART DIRECTOR (2026-09-25). A flat bullet list can only be drawn as a
// bullet list, and a slide asked for "a title and some lines" comes back as the image model's one
// default shape — which is why every slide of a post looked the same. So the same one call now
// returns what a designer would decide before drawing: a shared design system for the whole post
// (stated identically in every slide's prompt), and per slide a subheading, the title words to
// colour, lines grouped under section headings, an optional attributed quote, a closing line and a
// LAYOUT (carousel-layouts.ts). No dateline is asked for — the department does not want one on a
// carousel slide (2026-09-25); `CarouselPlan.dateline` stays in the schema, always '', so stored
// plans still parse. Every new string passes the same guards as the lines: digits grounded in the
// note, a quote's speaker present in the note verbatim, emphasis a substring of its own text — and assignCarouselLayouts makes the layouts
// differ across slides whatever the model proposed.
//
// जसाच्या तसा मजकूर — VERBATIM MODE (2026-09-26). When the officer's text IS the slides' text, the
// planner must not write copy at all, so it is never given the chance: the note is split into
// numbered lines (segmentCarouselText — the officer's own line breaks, a long paragraph split at
// its sentence ends, list glyphs stripped) and the model answers with line NUMBERS — which line is
// each slide's title, subheading, section heading, list line or closing line. Every printed string
// is therefore one of the officer's lines by construction (the video planner's fact_index move).
// normalizeVerbatimPlan then guarantees COVERAGE: a line used twice keeps its first place, and a
// line the model left out is put back beside its neighbour in the text — nothing the officer wrote
// is dropped. No digit guard and no scheme-name lock run here: the text is the officer's, unchanged.

import { pathToFileURL } from 'node:url';
import {
  CAROUSEL_MAX_ITEMS_PER_SLIDE,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  type CarouselItem,
  type CarouselPlan,
  type CarouselQuote,
  type CarouselPlanSlide,
  type CarouselSlideCount,
} from '@dgipr/schemas';
import { chatComplete } from './openai-chat.js';
import {
  CAROUSEL_LAYOUTS,
  CAROUSEL_LAYOUT_ENUM,
  assignCarouselLayouts,
} from './carousel-layouts.js';
import { POSTER_COPY_MODEL } from './classify-poster-type.js';
import { digitsAreGrounded } from './digit-grounding.js';
import {
  lockSchemeNames,
  validateDeclaredSchemeNames,
} from './lock-scheme-names.js';

export type PlanCarouselInput = Readonly<{
  note: string;
  requestedSlides: CarouselSlideCount;
  // Full scheme/org names known to occur verbatim in the note (verified glossary rows).
  lockedSchemeNames?: readonly string[] | undefined;
  // जसाच्या तसा मजकूर: distribute the note's own lines, write nothing.
  verbatim?: boolean | undefined;
}>;

export type PlanCarouselResult = Readonly<{
  plan: CarouselPlan;
  // Lines the digit guard removed because they carried a number the note does not.
  droppedItems: readonly string[];
  // Scheme names left truncated, or declared by the model but absent from the note.
  unpreservedSchemeNames: readonly string[];
}>;

// The prompt itself is the department's own two sentences (2026-09-25). What each field MEANS is
// carried by the json_schema's descriptions rather than by more prompt text — structured output
// enforces the shape, and normalizeCarouselPlan below enforces what must hold.
const LAYOUT_GUIDE = CAROUSEL_LAYOUTS.map(
  (layout) => `${layout.id} = ${layout.purpose}`,
).join('; ');

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    series_title: {
      type: 'string',
      description:
        'A short Marathi series title naming what the whole post is about. It is NOT printed on the slides.',
    },
    design_system: {
      type: 'string',
      description:
        'One short English paragraph describing the ONE look every slide shares, as an art director would brief a designer: the background, how the two-tone headline is coloured, the card and panel style, and the colour scheme named in words. Colours by name only — no numbers or codes. Structure comes from spacing, alignment, typography and colour: no outline around every block, no divider lines between items, no coloured bars, borders, stripes or underlines under cards or headings. Icons only where they add meaning, small and plain. No header band or title bar across the top. No logos, emblems, maps, datelines or slide numbers.',
    },
    slides: {
      type: 'array',
      description:
        'The slides in order. The first slide is the cover; every later slide carries one idea of the text.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: 'The Marathi title of this slide.',
          },
          title_emphasis: {
            type: 'array',
            description:
              'One or two words copied exactly from this title to set in the accent colour (a two-tone headline). Empty for none.',
            items: { type: 'string' },
          },
          subtitle: {
            type: 'string',
            description:
              'A short Marathi subheading under the title, from the provided text. Empty for none.',
          },
          layout: {
            type: 'string',
            enum: CAROUSEL_LAYOUT_ENUM,
            description: `How this slide's body is arranged. Give each slide a DIFFERENT layout that suits its own content: ${LAYOUT_GUIDE}.`,
          },
          sections: {
            type: 'array',
            description:
              'The Marathi lines shown on this slide, one fact per line, grouped under short section headings where the content has natural groups (for example: villages visited, what was reviewed, instructions given). Use one section with an empty heading for a plain list.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                heading: { type: 'string' },
                items: { type: 'array', items: { type: 'string' } },
              },
              required: ['heading', 'items'],
            },
          },
          quote: {
            type: 'object',
            additionalProperties: false,
            description:
              'A statement the provided text attributes to a named person, with that person exactly as the text names them. Both empty when there is none.',
            properties: {
              text: { type: 'string' },
              speaker: { type: 'string' },
            },
            required: ['text', 'speaker'],
          },
          closing: {
            type: 'string',
            description:
              'A short Marathi closing line or call to action for this slide, from the provided text. Empty for none.',
          },
          visual: {
            type: 'string',
            description:
              "One short English sentence describing the photograph or illustration for THIS slide, drawn from this slide's own lines (for example: an officer explaining a health card to villagers at a stall). Each slide shows a different subject. Describe only the scene: no words, numbers, signs, logos or maps.",
          },
        },
        required: [
          'title',
          'title_emphasis',
          'subtitle',
          'layout',
          'sections',
          'quote',
          'closing',
          'visual',
        ],
      },
    },
    scheme_names_used: {
      type: 'array',
      description:
        'Every government scheme or programme name written anywhere in the slides, copied verbatim from the provided text. Empty if none.',
      items: { type: 'string' },
    },
  },
  required: ['series_title', 'design_system', 'slides', 'scheme_names_used'],
} as const;

function slideCountText(requested: CarouselSlideCount): string {
  return requested === 'auto'
    ? `${CAROUSEL_MIN_SLIDES}- or ${CAROUSEL_MAX_SLIDES}`
    : String(requested);
}

export function buildCarouselPlanSystemPrompt(
  requested: CarouselSlideCount,
): string {
  const n = slideCountText(requested);
  const article = /^(8|11|18)\b/.test(n) ? 'an' : 'a';
  return [
    'You are making a social media carousel for the Directorate General of Information and Public Relations (DGIPR), Government of Maharashtra.',
    `From the provided Marathi text, make the content for ${article} ${n}-slide post in Marathi.`,
  ].join('\n');
}

// --- deterministic normalisation (free; this is the guarantee half) ----------------------

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// A slide's visual brief is steering for the image model, never a fact — but a number in it is
// an invitation to paint that number, so an ungrounded digit drops the brief (the slide then
// falls back to a scene chosen from its own text). Capped so a runaway answer cannot crowd the
// department's rules out of the image prompt.
const VISUAL_MAX_CHARS = 300;

function cleanVisual(value: unknown, note: string): string {
  const visual = clean(value);
  if (!visual || !digitsAreGrounded(visual, note)) return '';
  if (visual.length <= VISUAL_MAX_CHARS) return visual;
  const cut = visual.slice(0, VISUAL_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > VISUAL_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trim();
}

// Emphasis must be a substring of its own text, or the image model is told to colour words that
// are not on the slide.
function cleanEmphasis(value: unknown, text: string): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map(clean)
        .filter((e) => e.length > 0 && text.includes(e)),
    ),
  ];
}

function cleanItems(value: unknown, section = ''): CarouselItem[] {
  const items = Array.isArray(value) ? value : [];
  const out: CarouselItem[] = [];
  for (const raw of items) {
    const record = (raw ?? {}) as Record<string, unknown>;
    const text = typeof raw === 'string' ? clean(raw) : clean(record.text);
    if (!text) continue;
    const emphasis = cleanEmphasis(record.emphasis, text);
    out.push({ text, emphasis, section: clean(record.section) || section });
  }
  return out;
}

// A slide's lines: the model's `sections` flattened, each line tagged with its heading — or, for
// a plan shaped the old way, its flat `items`.
function slideItems(record: Record<string, unknown>): CarouselItem[] {
  if (!Array.isArray(record.sections)) return cleanItems(record.items);
  return record.sections.flatMap((raw) => {
    const section = (raw ?? {}) as Record<string, unknown>;
    return cleanItems(section.items, clean(section.heading));
  });
}

// Whitespace-insensitive "does the note contain this", for names that must never be invented.
function inNote(text: string, note: string): boolean {
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return text.length > 0 && squash(note).includes(squash(text));
}

// A quote is kept only when its speaker is named in the note exactly as written and it carries
// no number the note does not — otherwise it is dropped, never repaired.
function cleanQuote(value: unknown, note: string): CarouselQuote | null {
  const record = (value ?? {}) as Record<string, unknown>;
  const text = clean(record.text)
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .trim();
  const speaker = clean(record.speaker);
  if (!text || !speaker) return null;
  if (!inNote(speaker, note) || !digitsAreGrounded(text, note)) return null;
  return { text, speaker };
}

// The shared look, stated identically in every slide's prompt. Steering, never printed — but a
// number in it is an invitation to paint that number, so an ungrounded digit drops it.
const DESIGN_SYSTEM_MAX_CHARS = 700;

function cleanDesignSystem(value: unknown, note: string): string {
  const design = clean(value);
  if (!design || !digitsAreGrounded(design, note)) return '';
  if (design.length <= DESIGN_SYSTEM_MAX_CHARS) return design;
  const cut = design.slice(0, DESIGN_SYSTEM_MAX_CHARS);
  const stop = cut.lastIndexOf('. ');
  return (
    stop > DESIGN_SYSTEM_MAX_CHARS / 2 ? cut.slice(0, stop + 1) : cut
  ).trim();
}

// A new detail slide carrying the rest of `slide`'s lines: same title and picture, its own
// (reassigned) layout, and none of the one-off parts — the quote and closing line stay where the
// model put them.
function continuationOf(
  slide: CarouselPlanSlide,
  items: CarouselItem[],
): CarouselPlanSlide {
  return {
    role: 'detail',
    title: slide.title,
    titleEmphasis: slide.titleEmphasis,
    subtitle: '',
    layout: '',
    items,
    quote: null,
    closing: '',
    visual: slide.visual,
  };
}

// Move overflow past the per-slide cap onto the NEXT slide — never drop it. The last slide may
// grow a new detail slide while there is room under the ceiling; at the ceiling it keeps the
// overflow (an over-full slide the officer can split beats a lost constituency).
function spreadOverflow(slides: CarouselPlanSlide[]): void {
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i]!;
    if (slide.items.length <= CAROUSEL_MAX_ITEMS_PER_SLIDE) continue;
    const excess = slide.items.slice(CAROUSEL_MAX_ITEMS_PER_SLIDE);
    const next = slides[i + 1];
    if (next && next.role === 'detail' && next.title === slide.title) {
      slide.items = slide.items.slice(0, CAROUSEL_MAX_ITEMS_PER_SLIDE);
      next.items = [...excess, ...next.items];
    } else if (slides.length < CAROUSEL_MAX_SLIDES) {
      slide.items = slide.items.slice(0, CAROUSEL_MAX_ITEMS_PER_SLIDE);
      slides.splice(i + 1, 0, continuationOf(slide, excess));
    }
  }
}

// Bring the slide count into range: merge surplus DETAIL slides into their predecessor, or
// split the fullest detail slide in half. Never merges into or out of the cover, and never
// invents a slide with no content — a thin note may end below the floor, which is reported by
// the caller's log rather than padded.
function fitSlideCount(
  slides: CarouselPlanSlide[],
  target: number,
  verbatim = false,
): void {
  while (slides.length > target && slides.length > 2) {
    const last = slides.pop()!;
    const previous = slides[slides.length - 1]!;
    // The merged lines keep their meaning as a group: untagged lines take their old slide's
    // title as their section heading.
    const moved = last.items.map((item) => ({
      ...item,
      section: item.section || last.title,
    }));
    // On a verbatim plan nothing the officer wrote may disappear in a merge: a subheading or a
    // closing line with no place left on the previous slide becomes one of its lines, and the
    // merged slide's title survives as their section heading (or as a line of its own).
    const keep = (text: string): CarouselItem[] =>
      verbatim && text ? [{ text, emphasis: [], section: last.title }] : [];
    const carried = [
      ...keep(last.subtitle),
      ...moved,
      ...(previous.closing ? keep(last.closing) : []),
    ];
    if (
      verbatim &&
      last.title &&
      !carried.some((item) => item.section === last.title)
    ) {
      carried.unshift({ text: last.title, emphasis: [], section: '' });
    }
    previous.items = [...previous.items, ...carried];
    if (!previous.quote) previous.quote = last.quote;
    if (!previous.closing) previous.closing = last.closing;
  }
  while (slides.length < target) {
    let pick = -1;
    for (let i = 1; i < slides.length; i += 1) {
      const items = slides[i]!.items.length;
      if (items >= 2 && (pick < 0 || items > slides[pick]!.items.length)) {
        pick = i;
      }
    }
    // A cover carrying a list is the other place content can be split from: its extra facts
    // become the first detail slide.
    if (pick < 0 && slides.length === 1 && slides[0]!.items.length > 3) {
      const cover = slides[0]!;
      slides.push(continuationOf(cover, cover.items.slice(3)));
      cover.items = cover.items.slice(0, 3);
      continue;
    }
    if (pick < 0) break;
    const slide = slides[pick]!;
    const half = Math.ceil(slide.items.length / 2);
    slides.splice(pick + 1, 0, continuationOf(slide, slide.items.slice(half)));
    slide.items = slide.items.slice(0, half);
  }
}

function targetSlideCount(
  requested: CarouselSlideCount,
  planned: number,
): number {
  return requested === 'auto'
    ? Math.min(CAROUSEL_MAX_SLIDES, Math.max(CAROUSEL_MIN_SLIDES, planned))
    : requested;
}

export function normalizeCarouselPlan(
  raw: unknown,
  input: PlanCarouselInput,
): PlanCarouselResult {
  if (input.verbatim) return normalizeVerbatimPlan(raw, input);
  const record = (raw ?? {}) as Record<string, unknown>;
  const note = input.note;
  const dropped: string[] = [];
  const grounded = (text: string): string =>
    text && digitsAreGrounded(text, note) ? text : '';

  let seriesTitle = grounded(clean(record.series_title));

  const rawSlides = Array.isArray(record.slides) ? record.slides : [];
  const slides: CarouselPlanSlide[] = [];
  for (const rawSlide of rawSlides) {
    const r = (rawSlide ?? {}) as Record<string, unknown>;
    const items: CarouselItem[] = [];
    for (const item of slideItems(r)) {
      if (digitsAreGrounded(item.text, note)) items.push(item);
      else dropped.push(item.text);
    }
    const title = grounded(clean(r.title));
    const subtitle = grounded(clean(r.subtitle));
    if (!title && items.length === 0) continue;
    const visual = cleanVisual(r.visual, note);
    const layout = CAROUSEL_LAYOUT_ENUM.find((id) => id === clean(r.layout));
    slides.push({
      role: 'detail',
      title,
      titleEmphasis: cleanEmphasis(r.title_emphasis, title),
      subtitle,
      layout: layout ?? '',
      items,
      quote: cleanQuote(r.quote, note),
      closing: grounded(clean(r.closing)),
      visual,
    });
  }
  if (slides.length === 0) {
    throw new Error('The carousel planner returned no usable slides.');
  }
  // The first slide IS the cover whatever the model labelled it; everything after is a detail.
  slides.forEach((slide, i) => {
    slide.role = i === 0 ? 'cover' : 'detail';
  });

  if (!seriesTitle) seriesTitle = slides[0]!.title;
  for (const slide of slides) {
    if (!slide.title) slide.title = seriesTitle;
  }

  spreadOverflow(slides);
  fitSlideCount(slides, targetSlideCount(input.requestedSlides, slides.length));
  slides.forEach((slide, i) => {
    slide.role = i === 0 ? 'cover' : 'detail';
  });
  // After every split and merge, so a continuation slide gets its own layout too.
  assignCarouselLayouts(slides);

  const lockedNames = [...new Set(input.lockedSchemeNames ?? [])].filter(
    (n) => n.trim().length > 0,
  );
  const locked = lockSchemeNames(
    {
      seriesTitle,
      verbatim: false,
      dateline: '',
      designSystem: cleanDesignSystem(record.design_system, note),
      slides,
    },
    lockedNames,
  );
  const declared = (
    Array.isArray(record.scheme_names_used) ? record.scheme_names_used : []
  ).filter((s): s is string => typeof s === 'string');
  const { invented } = validateDeclaredSchemeNames(note, declared);

  return {
    plan: locked.copy,
    droppedItems: dropped,
    unpreservedSchemeNames: [...locked.unpreserved, ...invented],
  };
}

// --- verbatim mode (जसाच्या तसा मजकूर) -----------------------------------------------------

// A pasted line longer than this is split at its sentence ends, so one paragraph can spread over
// slides; a shorter line is the officer's own unit and is never cut.
const VERBATIM_SPLIT_CHARS = 140;

// Abbreviations whose full stop does not end a sentence ("श्री. देवेंद्र फडणवीस", "दि. २५").
const ABBREVIATIONS = new Set([
  'श्री',
  'श्रीमती',
  'सौ',
  'कु',
  'डॉ',
  'दि',
  'क्र',
  'मा',
  'ना',
  'प्रा',
  'स',
  'रु',
  'Dr',
  'Mr',
  'Mrs',
  'Ms',
  'No',
  'St',
]);

function splitSentences(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    const next = line[i + 1];
    let end = false;
    if (ch === '।' || ch === '॥' || ch === '!' || ch === '?') {
      end = next === undefined || /\s/.test(next);
    } else if (ch === '.' && next !== undefined && /\s/.test(next)) {
      const word = /([^\s.]+)$/.exec(line.slice(start, i))?.[1] ?? '';
      // A bare number ("1." / "१.") or a known abbreviation does not end a sentence.
      end =
        word.length > 0 &&
        !/^[0-9०-९]+$/.test(word) &&
        !ABBREVIATIONS.has(word);
    }
    if (end) {
      const piece = line.slice(start, i + 1).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }
  const tail = line.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

// The officer's text as the lines a slide may print: their own line breaks, with list glyphs and
// Markdown markers removed (the slide sets its own list style), and a long paragraph split at its
// sentence ends. Nothing else about a line changes — its words, numerals and punctuation stay.
export function segmentCarouselText(note: string): string[] {
  const units: string[] = [];
  for (const rawLine of note.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*•●▪◦▸►➢➤✓✔·]\s*/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || /^[-=_*~.·]{3,}$/.test(line)) continue;
    if (line.length > VERBATIM_SPLIT_CHARS) units.push(...splitSentences(line));
    else units.push(line);
  }
  return units;
}

function numberedLines(units: readonly string[]): string {
  return units.map((unit, i) => `[${i}] ${unit}`).join('\n');
}

const VERBATIM_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    series_title: PLAN_SCHEMA.properties.series_title,
    design_system: PLAN_SCHEMA.properties.design_system,
    slides: {
      type: 'array',
      description:
        'The slides in order. The first slide is the cover. Every line number of the text is used exactly once across all slides.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title_line: {
            type: 'integer',
            description:
              "The number of a short heading line that is this slide's title (never a full sentence), or -1 when no line suits a title.",
          },
          title_emphasis: {
            type: 'array',
            description:
              'One or two words copied exactly from that title line to set in the accent colour. Empty for none.',
            items: { type: 'string' },
          },
          subtitle_line: {
            type: 'integer',
            description:
              'The number of a short line shown as the subheading under the title, or -1 for none.',
          },
          layout: PLAN_SCHEMA.properties.slides.items.properties.layout,
          sections: {
            type: 'array',
            description:
              'The lines shown on this slide, by number, in the order of the text, grouped under a heading line where the text has natural groups. heading_line is -1 for a plain list.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                heading_line: { type: 'integer' },
                lines: { type: 'array', items: { type: 'integer' } },
              },
              required: ['heading_line', 'lines'],
            },
          },
          closing_line: {
            type: 'integer',
            description:
              'The number of a line that closes this slide as a call to action, or -1 for none.',
          },
          visual: PLAN_SCHEMA.properties.slides.items.properties.visual,
        },
        required: [
          'title_line',
          'title_emphasis',
          'subtitle_line',
          'layout',
          'sections',
          'closing_line',
          'visual',
        ],
      },
    },
  },
  required: ['series_title', 'design_system', 'slides'],
} as const;

export function buildVerbatimCarouselPlanSystemPrompt(
  requested: CarouselSlideCount,
): string {
  const n = slideCountText(requested);
  const article = /^(8|11|18)\b/.test(n) ? 'an' : 'a';
  return [
    'You are making a social media carousel for the Directorate General of Information and Public Relations (DGIPR), Government of Maharashtra.',
    `The provided Marathi text is the FINAL text of ${article} ${n}-slide post and is printed exactly as written. It is split into numbered lines. Arrange ALL of the lines across the slides by their numbers: the cover carries the opening headline, and each later slide carries one part of the text, keeping the text's own order. Use every line exactly once; never rewrite, shorten, merge, translate or add text.`,
  ].join('\n');
}

// Where one of the officer's lines ended up — what a line the model left out is put back beside.
type LinePlace = {
  slide: CarouselPlanSlide;
  item?: CarouselItem;
  // The line is a section heading: its lines are the slide's items tagged with it.
  heading?: string;
  // The line is the slide's closing line (so anything after it goes at the end).
  closing?: boolean;
};

function emptySlide(): CarouselPlanSlide {
  return {
    role: 'detail',
    title: '',
    titleEmphasis: [],
    subtitle: '',
    layout: '',
    items: [],
    quote: null,
    closing: '',
    visual: '',
  };
}

// A line may be a slide's title only if it reads as one: short, and not a full sentence. A
// sentence set as a headline is the wrong emphasis for the officer's text, so the guard keeps it
// on the slide as its first line instead (the same text, in the right place).
const TITLE_MAX_CHARS = 90;

function readsAsTitle(line: string): boolean {
  return line.length <= TITLE_MAX_CHARS && !/[.।]$/.test(line);
}

export function normalizeVerbatimPlan(
  raw: unknown,
  input: PlanCarouselInput,
): PlanCarouselResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const note = input.note;
  const units = segmentCarouselText(note);
  if (units.length === 0) {
    throw new Error('The carousel text has no lines to place on slides.');
  }
  const places: Array<LinePlace | undefined> = new Array(units.length);
  // Claims a line for one place. A number out of range, or already used, claims nothing — so a
  // line can never be printed twice.
  const indexOf = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number.NaN;
    return Number.isInteger(n) && n >= 0 && n < units.length && !places[n]
      ? n
      : -1;
  };

  const slides: CarouselPlanSlide[] = [];
  const rawSlides = Array.isArray(record.slides) ? record.slides : [];
  for (const rawSlide of rawSlides) {
    const r = (rawSlide ?? {}) as Record<string, unknown>;
    const slide = emptySlide();
    const claim = (value: unknown, place: Omit<LinePlace, 'slide'>): string => {
      const n = indexOf(value);
      if (n < 0) return '';
      places[n] = { slide, ...place };
      return units[n]!;
    };
    const titleIndex = indexOf(r.title_line);
    slide.title = claim(r.title_line, {});
    // Not a title after all: it opens the slide's lines instead (unshifted below, once the
    // sections are in, so it stays first).
    let demoted: CarouselItem | null = null;
    if (slide.title && !readsAsTitle(slide.title)) {
      demoted = { text: slide.title, emphasis: [], section: '' };
      places[titleIndex] = { slide, item: demoted };
      slide.title = '';
    }
    slide.subtitle = claim(r.subtitle_line, {});
    for (const rawSection of Array.isArray(r.sections) ? r.sections : []) {
      const section = (rawSection ?? {}) as Record<string, unknown>;
      const headingIndex = indexOf(section.heading_line);
      const heading = claim(section.heading_line, {});
      const lines = Array.isArray(section.lines) ? section.lines : [];
      let placed = 0;
      for (const value of lines) {
        const item: CarouselItem = { text: '', emphasis: [], section: heading };
        item.text = claim(value, { item });
        if (item.text) {
          slide.items.push(item);
          placed += 1;
        }
      }
      if (headingIndex < 0) continue;
      if (placed > 0) {
        places[headingIndex] = { slide, heading };
      } else {
        // A heading with nothing under it is still the officer's text: it stays, as a line.
        const item: CarouselItem = { text: heading, emphasis: [], section: '' };
        slide.items.push(item);
        places[headingIndex] = { slide, item };
      }
    }
    if (demoted) slide.items.unshift(demoted);
    slide.closing = claim(r.closing_line, { closing: true });
    if (
      !slide.title &&
      !slide.subtitle &&
      slide.items.length === 0 &&
      !slide.closing
    ) {
      continue;
    }
    slide.titleEmphasis = cleanEmphasis(r.title_emphasis, slide.title);
    slide.visual = cleanVisual(r.visual, note);
    slide.layout =
      CAROUSEL_LAYOUT_ENUM.find((id) => id === clean(r.layout)) ?? '';
    slides.push(slide);
  }

  // COVERAGE: every line the model did not place goes back beside its nearest placed neighbour in
  // the text — after the line before it, else before the line after it.
  const missing: string[] = [];
  for (let u = 0; u < units.length; u += 1) {
    if (places[u]) continue;
    missing.push(units[u]!);
    if (slides.length === 0) slides.push(emptySlide());
    let before: LinePlace | undefined;
    for (let b = u - 1; b >= 0 && !before; b -= 1) before = places[b];
    let after: LinePlace | undefined;
    for (let a = u + 1; a < units.length && !after; a += 1) after = places[a];
    const item: CarouselItem = { text: units[u]!, emphasis: [], section: '' };
    let slide: CarouselPlanSlide;
    if (before?.item) {
      slide = before.slide;
      item.section = before.item.section;
      slide.items.splice(slide.items.indexOf(before.item) + 1, 0, item);
    } else if (before?.heading !== undefined) {
      const heading = before.heading;
      slide = before.slide;
      item.section = heading;
      const first = slide.items.findIndex((i) => i.section === heading);
      slide.items.splice(first < 0 ? slide.items.length : first, 0, item);
    } else if (before && !before.closing) {
      // Right after a title or subheading: that slide's lines start here. Checked before the
      // line AFTER it, which may already sit on the next slide.
      slide = before.slide;
      slide.items.unshift(item);
    } else if (after?.item) {
      slide = after.slide;
      item.section = after.item.section;
      slide.items.splice(slide.items.indexOf(after.item), 0, item);
    } else {
      slide = (before ?? after)?.slide ?? slides[slides.length - 1]!;
      if (after && !before) slide.items.unshift(item);
      else slide.items.push(item);
    }
    places[u] = { slide, item };
  }

  // The cover opens the post: with no title line chosen, its first short line becomes the title.
  const cover = slides[0]!;
  const lead = cover.items[0];
  if (!cover.title && lead && !lead.section && readsAsTitle(lead.text)) {
    cover.title = lead.text;
    cover.items.shift();
  }

  slides.forEach((slide, i) => {
    slide.role = i === 0 ? 'cover' : 'detail';
  });
  spreadOverflow(slides);
  fitSlideCount(
    slides,
    targetSlideCount(input.requestedSlides, slides.length),
    true,
  );
  slides.forEach((slide, i) => {
    slide.role = i === 0 ? 'cover' : 'detail';
  });
  assignCarouselLayouts(slides);

  const series = clean(record.series_title);
  const seriesTitle =
    (series && digitsAreGrounded(series, note) ? series : '') ||
    cover.title ||
    units[0]!;
  if (missing.length > 0) {
    console.warn(
      `[carousel-plan] verbatim: ${missing.length} line(s) the planner left out were put back: ${missing.join(' | ')}`,
    );
  }
  return {
    plan: {
      seriesTitle,
      verbatim: true,
      dateline: '',
      designSystem: cleanDesignSystem(record.design_system, note),
      slides,
    },
    droppedItems: [],
    unpreservedSchemeNames: [],
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error(`Carousel plan JSON parse failed: ${raw.slice(0, 400)}`);
  }
}

export async function planCarousel(
  input: PlanCarouselInput,
): Promise<PlanCarouselResult> {
  const verbatim = input.verbatim === true;
  const raw = await chatComplete(
    [
      {
        role: 'system',
        content: verbatim
          ? buildVerbatimCarouselPlanSystemPrompt(input.requestedSlides)
          : buildCarouselPlanSystemPrompt(input.requestedSlides),
      },
      {
        role: 'user',
        // Verbatim: the model sees the lines it may place, numbered, and answers with numbers.
        content: verbatim
          ? numberedLines(segmentCarouselText(input.note))
          : input.note,
      },
    ],
    {
      model: POSTER_COPY_MODEL,
      // It decides the text of every slide at once — worth deliberating over, like the poster copy.
      reasoningEffort: 'medium',
      // The art direction, sections and per-slide parts roughly double the answer.
      maxTokens: 8192,
      jsonSchema: verbatim
        ? { name: 'carousel_verbatim_plan', schema: VERBATIM_PLAN_SCHEMA }
        : { name: 'carousel_plan', schema: PLAN_SCHEMA },
    },
  );
  const result = normalizeCarouselPlan(parseJson(raw), input);
  if (result.droppedItems.length > 0) {
    console.warn(
      `[carousel-plan] dropped ${result.droppedItems.length} line(s) carrying a number not in the note: ${result.droppedItems.join(' | ')}`,
    );
  }
  if (result.unpreservedSchemeNames.length > 0) {
    console.warn(
      `[carousel-plan] scheme names not preserved in full: ${result.unpreservedSchemeNames.join(', ')}`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Harness:
//   npx tsx src/generation/plan-carousel.ts --check              (free — the guarantee half)
//   npx tsx --env-file=../../.env src/generation/plan-carousel.ts --file=note.txt [auto|3|4] [--verbatim]
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--check')) {
    let failures = 0;
    const check = (label: string, ok: boolean): void => {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
      if (!ok) failures += 1;
    };
    const note =
      'विधान परिषदेच्या ५ जागांसाठी मतदान १२ जून २०२६ रोजी होणार आहे. मुख्यमंत्री माझी लाडकी बहीण योजना सुरू आहे. मतमोजणी १५ जून रोजी.';
    const item = (text: string, emphasis: string[] = []) => ({
      text,
      emphasis,
    });
    const slide = (
      title: string,
      items: ReturnType<typeof item>[],
      visual = '',
    ) => ({
      role: 'detail',
      title,
      subtitle: '',
      items,
      visual,
    });
    // The shape the model answers in now: lines grouped under section headings.
    const richSlide = (
      title: string,
      sections: Array<[string, string[]]>,
      extra: Record<string, unknown> = {},
    ) => ({
      title,
      title_emphasis: [],
      subtitle: '',
      layout: 'icon_list',
      sections: sections.map(([heading, items]) => ({ heading, items })),
      quote: { text: '', speaker: '' },
      closing: '',
      visual: '',
      ...extra,
    });

    // 1. auto clamps 5 → 4, merging the surplus into its predecessor (nothing lost).
    const five = normalizeCarouselPlan(
      {
        series_title: 'निवडणूक कार्यक्रम',
        slides: [
          slide('विधान परिषद निवडणूक', [item('५ जागा')]),
          slide('मतदान', [item('१२ जून २०२६')]),
          slide('मतमोजणी', [item('१५ जून')]),
          slide('अ', [item('एक')]),
          slide('ब', [item('दोन')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check('auto: 5 slides clamp to 4', five.plan.slides.length === 4);
    check(
      'auto: merged items survive',
      five.plan.slides[3]!.items.map((i) => i.text).join(',') === 'एक,दोन',
    );
    check('first slide is the cover', five.plan.slides[0]!.role === 'cover');
    check(
      'later slides are details',
      five.plan.slides.slice(1).every((s) => s.role === 'detail'),
    );

    // 2. auto with 2 slides splits the fullest detail slide to reach 3.
    const two = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा')]),
          slide('यादी', [item('अ'), item('ब'), item('क'), item('ड')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check('auto: 2 slides split up to 3', two.plan.slides.length === 3);
    check(
      'split keeps every item in order',
      two.plan.slides
        .slice(1)
        .flatMap((s) => s.items.map((i) => i.text))
        .join('') === 'अबकड',
    );
    check('split slide keeps its title', two.plan.slides[2]!.title === 'यादी');

    // 3. explicit 4 is honoured.
    const four = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा')]),
          slide('यादी', [item('अ'), item('ब'), item('क'), item('ड')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 4 },
    );
    check('explicit 4 reached by splitting', four.plan.slides.length === 4);

    // 4. digit guard: an item with a number not in the note is dropped, grounded ones kept,
    //    and Latin digits match Devanagari in the note.
    const digits = normalizeCarouselPlan(
      {
        series_title: 'निवडणूक कार्यक्रम',
        slides: [
          slide('कव्हर', [item('५ जागा'), item('७ जागा'), item('12 जून')]),
          slide('मतमोजणी', [item('१५ जून')]),
          slide('तिसरी', [item('३३ जुलै')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    const coverTexts = digits.plan.slides[0]!.items.map((i) => i.text);
    check('digit guard keeps a grounded number', coverTexts.includes('५ जागा'));
    check(
      'digit guard drops an invented number',
      !coverTexts.includes('७ जागा'),
    );
    check(
      'digit guard compares across scripts (12 vs १२)',
      coverTexts.includes('12 जून'),
    );
    check(
      'digit guard reports what it dropped',
      digits.droppedItems.includes('७ जागा') &&
        digits.droppedItems.includes('३३ जुलै'),
    );
    check(
      'a slide left with a title keeps it',
      digits.plan.slides.some((s) => s.title === 'तिसरी'),
    );

    // 5. overflow: 14 items on one slide → 12 + 2 on the next slide.
    const many = Array.from({ length: 14 }, (_, i) =>
      item(`केंद्र ${'कखगघङचछजझञटठडढ'[i]}`),
    );
    const overflow = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा')]),
          slide('केंद्रे', many),
          slide('मतमोजणी', [item('१५ जून')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check(
      'overflow: no slide above the cap',
      overflow.plan.slides.every(
        (s) => s.items.length <= CAROUSEL_MAX_ITEMS_PER_SLIDE,
      ),
    );
    check(
      'overflow: every item survives',
      overflow.plan.slides.reduce((n, s) => n + s.items.length, 0) === 16,
    );
    check('overflow: stays within 4 slides', overflow.plan.slides.length <= 4);

    // 6. scheme lock expands a truncation to the full verified name.
    const locked = normalizeCarouselPlan(
      {
        series_title: 'लाडकी बहीण योजना',
        slides: [
          slide('कव्हर', [item('५ जागा')]),
          slide('योजना', [item('लाडकी बहीण योजना सुरू')]),
          slide('मतमोजणी', [item('१५ जून')]),
        ],
        scheme_names_used: [],
      },
      {
        note,
        requestedSlides: 'auto',
        lockedSchemeNames: ['मुख्यमंत्री माझी लाडकी बहीण योजना'],
      },
    );
    check(
      'scheme lock expands the series title',
      locked.plan.seriesTitle === 'मुख्यमंत्री माझी लाडकी बहीण योजना',
    );
    check(
      'scheme lock expands an item',
      locked.plan.slides[1]!.items[0]!.text.startsWith(
        'मुख्यमंत्री माझी लाडकी बहीण योजना',
      ),
    );

    // 7. emphasis must be a substring of its own line.
    const emphasis = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा', ['५', 'नाही'])]),
          slide('अ', [item('ब')]),
          slide('क', [item('ड')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check(
      'emphasis not in the line is removed',
      emphasis.plan.slides[0]!.items[0]!.emphasis.join() === '५',
    );

    // 8. a per-slide visual brief is kept, trimmed, and dropped when it carries a number the
    //    note does not (an invitation to paint that number).
    const visuals = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide(
            'कव्हर',
            [item('५ जागा')],
            '  Voters queueing   at a polling booth ',
          ),
          slide('अ', [item('ब')], 'A banner reading 99 seats'),
          slide('क', [item('ड')], `${'Officers at a counter '.repeat(30)}`),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check(
      'visual brief is whitespace-normalised',
      visuals.plan.slides[0]!.visual === 'Voters queueing at a polling booth',
    );
    check(
      'visual brief with an ungrounded number is dropped',
      visuals.plan.slides[1]!.visual === '',
    );
    check(
      'visual brief is capped',
      visuals.plan.slides[2]!.visual.length > 0 &&
        visuals.plan.slides[2]!.visual.length <= 300,
    );
    const splitVisual = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा')], 'A polling booth'),
          slide('यादी', [item('अ'), item('ब'), item('क'), item('ड')], 'A list'),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 'auto' },
    );
    check(
      'a split slide inherits its visual brief',
      splitVisual.plan.slides[2]!.visual === 'A list',
    );

    // 9. the art-direction fields: sections, emphasis, quote, layouts, design system.
    const placeNote = `${note} मुंबई येथे घोषणा.`;
    const rich = normalizeCarouselPlan(
      {
        series_title: 'निवडणूक कार्यक्रम',
        dateline: 'मुंबई, दि. १२',
        design_system: 'A deep blue header band over a light ground.',
        slides: [
          richSlide('विधान परिषद निवडणूक', [['', ['५ जागा']]], {
            title_emphasis: ['निवडणूक', 'नाही'],
            subtitle: 'मतदान १२ जून २०२६',
          }),
          richSlide(
            'कार्यक्रम',
            [
              ['मतदान', ['१२ जून २०२६']],
              ['मतमोजणी', ['१५ जून']],
            ],
            {
              quote: { text: '“सर्वांनी मतदान करावे”', speaker: 'मुख्यमंत्री' },
              closing: 'मतदान करा',
            },
          ),
          richSlide('योजना', [['', ['लाडकी बहीण योजना सुरू']]], {
            quote: { text: 'योजना सुरू आहे', speaker: 'श्री. काल्पनिक नाव' },
          }),
        ],
        scheme_names_used: [],
      },
      { note: placeNote, requestedSlides: 'auto' },
    );
    const [rCover, rTwo, rThree] = rich.plan.slides;
    check(
      'sections become per-line section tags',
      rTwo!.items.map((i) => `${i.section}:${i.text}`).join('|') ===
        'मतदान:१२ जून २०२६|मतमोजणी:१५ जून',
    );
    check(
      'title emphasis keeps only words of the title',
      rCover!.titleEmphasis.join() === 'निवडणूक',
    );
    check(
      'a grounded subheading is kept',
      rCover!.subtitle === 'मतदान १२ जून २०२६',
    );
    check('a closing line is kept', rTwo!.closing === 'मतदान करा');
    check(
      'a quote whose speaker is in the note is kept, its quote marks stripped',
      rTwo!.quote?.text === 'सर्वांनी मतदान करावे' &&
        rTwo!.quote.speaker === 'मुख्यमंत्री',
    );
    check(
      'a quote whose speaker is not in the note is dropped',
      rThree!.quote === null,
    );
    check(
      'three identical layout proposals become three different layouts',
      new Set(rich.plan.slides.map((s) => s.layout)).size === 3,
    );
    check(
      'a dateline the model returns anyway is never kept',
      rich.plan.dateline === '',
    );
    check(
      'the design system is kept',
      rich.plan.designSystem.startsWith('A deep blue header band'),
    );

    const badDesign = normalizeCarouselPlan(
      {
        series_title: 'x',
        design_system: 'Headline in colour #1A73E8.',
        slides: [
          richSlide('अ', [['', ['५ जागा']]]),
          richSlide('ब', [['', ['एक']]]),
          richSlide('क', [['', ['दोन']]]),
        ],
        scheme_names_used: [],
      },
      { note: placeNote, requestedSlides: 'auto' },
    );
    check(
      'a design system with an ungrounded number is dropped',
      badDesign.plan.designSystem === '',
    );
    check(
      'the planner schema asks for no dateline',
      !('dateline' in PLAN_SCHEMA.properties) &&
        !PLAN_SCHEMA.required.includes('dateline' as never),
    );

    const merged = normalizeCarouselPlan(
      {
        series_title: 'x',
        slides: [
          slide('कव्हर', [item('५ जागा')]),
          slide('अ', [item('एक')]),
          slide('ब', [item('दोन')]),
          slide('क', [item('तीन')]),
        ],
        scheme_names_used: [],
      },
      { note, requestedSlides: 3 },
    );
    check(
      "merged lines take their old slide's title as their section",
      merged.plan.slides[2]!.items.map((i) => i.section).join() === ',क',
    );

    // 9b. verbatim mode: the lines are the officer's, placed by number, and none is lost.
    const vNote = [
      'विधान परिषद निवडणूक २०२६',
      '- ५ जागांसाठी मतदान',
      '• अधिसूचना २ जून',
      '३. छाननी १० जून',
      'मतदान २५ जून रोजी सकाळी ८ ते सायंकाळी ४ या वेळेत होईल. मतमोजणी २८ जून रोजी होईल. श्री. पाटील यांनी सर्वांना मतदान करण्याचे आवाहन केले आणि दि. २५ रोजी सुट्टी जाहीर केली.',
      '',
      'मतदान करा',
    ].join('\n');
    const vUnits = segmentCarouselText(vNote);
    check(
      'segment: list glyphs are stripped, numbering is kept',
      vUnits[1] === '५ जागांसाठी मतदान' &&
        vUnits[2] === 'अधिसूचना २ जून' &&
        vUnits[3] === '३. छाननी १० जून',
    );
    check(
      'segment: a long paragraph splits at sentence ends, not at श्री./दि.',
      vUnits.length === 8 &&
        vUnits[6]!.startsWith('श्री. पाटील') &&
        vUnits[6]!.includes('दि. २५'),
    );
    const vPlan = normalizeCarouselPlan(
      {
        series_title: 'निवडणूक',
        design_system: '',
        slides: [
          {
            title_line: 0,
            title_emphasis: ['निवडणूक', 'नाही'],
            subtitle_line: 1,
            layout: 'hero_cards',
            sections: [],
            closing_line: -1,
            visual: 'A polling booth',
          },
          {
            title_line: -1,
            title_emphasis: [],
            subtitle_line: -1,
            layout: 'timeline',
            // 3 is left out by the model; 2 is claimed twice.
            sections: [{ heading_line: -1, lines: [2, 2, 99] }],
            closing_line: -1,
            visual: '',
          },
          {
            title_line: -1,
            title_emphasis: [],
            subtitle_line: -1,
            layout: 'icon_list',
            sections: [{ heading_line: -1, lines: [4, 5, 6] }],
            closing_line: 7,
            visual: '',
          },
        ],
      },
      { note: vNote, requestedSlides: 'auto', verbatim: true },
    );
    const printed = vPlan.plan.slides.flatMap((sl) => [
      sl.title,
      sl.subtitle,
      ...sl.items.map((i) => i.text),
      sl.closing,
    ]);
    check('verbatim plan is marked verbatim', vPlan.plan.verbatim === true);
    check(
      'verbatim: every printed string is one of the lines',
      printed.filter(Boolean).every((t) => vUnits.includes(t)),
    );
    check(
      'verbatim: every line is printed exactly once',
      vUnits.every((u) => printed.filter((t) => t === u).length === 1),
    );
    check(
      'verbatim: a left-out line goes back after its neighbour',
      vPlan.plan.slides[1]!.items.map((i) => i.text).join('|') ===
        'अधिसूचना २ जून|३. छाननी १० जून',
    );
    check(
      'verbatim: title emphasis is limited to the title line',
      vPlan.plan.slides[0]!.titleEmphasis.join() === 'निवडणूक',
    );
    check(
      'verbatim: no quote is ever attached',
      vPlan.plan.slides.every((sl) => sl.quote === null),
    );
    const vEmpty = normalizeCarouselPlan(
      { series_title: '', design_system: '', slides: [] },
      { note: vNote, requestedSlides: 3, verbatim: true },
    );
    const vEmptyPrinted = vEmpty.plan.slides.flatMap((sl) => [
      sl.title,
      sl.subtitle,
      ...sl.items.map((i) => i.text),
      sl.closing,
    ]);
    check(
      'verbatim: a plan with no slides still prints every line',
      vUnits.every((u) => vEmptyPrinted.includes(u)),
    );
    check(
      'verbatim: the cover takes the opening line as its title',
      vEmpty.plan.slides[0]!.title === 'विधान परिषद निवडणूक २०२६',
    );
    check(
      'verbatim: an explicit 3 is reached by splitting',
      vEmpty.plan.slides.length === 3,
    );
    const titled = (title: number, subtitle = -1, closing = -1) => ({
      title_line: title,
      title_emphasis: [],
      subtitle_line: subtitle,
      layout: 'icon_list',
      sections: [],
      closing_line: closing,
      visual: '',
    });
    const vMerge = normalizeCarouselPlan(
      {
        series_title: 'x',
        design_system: '',
        slides: [0, 1, 2, 3, 4].map((n) => titled(n)).concat(titled(5, 6, 7)),
      },
      { note: vNote, requestedSlides: 3, verbatim: true },
    );
    const vSentence = normalizeCarouselPlan(
      {
        series_title: 'x',
        design_system: '',
        slides: [
          titled(0),
          { ...titled(4), sections: [{ heading_line: -1, lines: [5] }] },
        ],
      },
      { note: vNote, requestedSlides: 'auto', verbatim: true },
    );
    check(
      'verbatim: a sentence chosen as a title is kept as the first line instead',
      vSentence.plan.slides[1]!.title === '' &&
        vSentence.plan.slides[1]!.items[0]!.text === vUnits[4] &&
        vSentence.plan.slides[1]!.items[1]!.text === vUnits[5],
    );
    // A merged slide's title is printed as the section heading of the lines it carried.
    const mergedPrinted = vMerge.plan.slides.flatMap((sl) => [
      sl.title,
      sl.subtitle,
      ...sl.items.flatMap((i) => [i.section, i.text]),
      sl.closing,
    ]);
    check(
      'verbatim: merging down to 3 slides loses no line',
      vMerge.plan.slides.length === 3 &&
        vUnits.every((u) => mergedPrinted.includes(u)),
    );

    // 10. an empty plan is an error, not an empty carousel.
    let threw = false;
    try {
      normalizeCarouselPlan(
        { series_title: '', slides: [], scheme_names_used: [] },
        { note, requestedSlides: 'auto' },
      );
    } catch {
      threw = true;
    }
    check('an empty plan throws', threw);

    console.log(
      failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  } else {
    const fileArg = process.argv.find((a) => a.startsWith('--file='));
    const countArg = process.argv.find((a) => /^(auto|3|4)$/.test(a));
    const note = fileArg
      ? (await import('node:fs')).readFileSync(
          fileArg.slice('--file='.length),
          'utf8',
        )
      : 'विधान परिषदेच्या ५ जागांसाठी निवडणूक कार्यक्रम जाहीर. अधिसूचना २ जून, अर्ज भरण्याची अंतिम मुदत ९ जून, छाननी १० जून, माघार १२ जून. मतदान २५ जून २०२६ रोजी सकाळी ८ ते सायंकाळी ४ या वेळेत होईल व मतमोजणी २८ जून रोजी होईल. मतदारसंघ: मुंबई, पुणे, नाशिक, नागपूर, औरंगाबाद.';
    const requestedSlides: CarouselSlideCount =
      countArg === '3' ? 3 : countArg === '4' ? 4 : 'auto';
    planCarousel({
      note,
      requestedSlides,
      verbatim: process.argv.includes('--verbatim'),
    })
      .then((r) => console.log(JSON.stringify(r, null, 2)))
      .catch((e: unknown) => {
        console.error(e);
        process.exitCode = 1;
      });
  }
}
