// The DESIGN DIRECTOR for a carousel (कॅरोसेल, 2026-09-26): the fresh social poster's open-ended
// director (poster-design-director.ts), applied to a multi-slide post at TWO levels.
//
// WHY. Until now a carousel's look came from the planner's one `designSystem` sentence plus a
// FIXED body recipe per slide from a seven-entry library (carousel-layouts.ts). The single social
// poster had just moved the other way — no recipes, a per-poster design brief chosen from what the
// content contains — and it is the looser one that produced the more varied, better-designed
// posters. A carousel has a constraint a single poster does not: every slide is painted by a
// SEPARATE image call that cannot see the others, so the only thing that makes four renders one
// set is text that is identical in all four prompts. Hence two levels:
//
//   - the SERIES LOOK (`brief`): ground, colour roles, typography and title treatment, panel
//     language, imagery treatment, spacing rhythm — never an arrangement. Stated word for word in
//     every slide's prompt. This is the continuity.
//   - each SLIDE's design: form, where the weight sits, imagery — chosen from THAT slide's own
//     content, inside the look. This is the content-appropriate variation.
//
// Variety is instructed, then checked: a direction whose slides all share one arrangement is asked
// again once with a sharper note. A whole-post redo ("सर्व स्लाइड पुन्हा") is told to move to a new
// colour family and a new cover arrangement, and is asked again once if it does not.
//
// SAFETY is the social director's, reused rather than re-implemented: the same principles
// (DESIGN_PRINCIPLES), the same enums, and the same sentence-level sanitiser — any sentence with
// Devanagari, a digit, a quotation, a hex code, a map/wave/logo or a dark ground is dropped. A
// series brief left too thin makes the whole direction null; a slide brief left too thin makes only
// that slide null, and that slide falls back to its assigned layout inside the same look.
//
// NEVER A GATE. Every failure returns null and the carousel renders exactly as it did before this
// file existed: the planner's designSystem and the assigned layouts.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import type {
  CarouselDesign,
  CarouselPlan,
  CarouselPlanSlide,
  CarouselSlideDesign,
} from '@dgipr/schemas';
import {
  chatComplete,
  UTILITY_MODEL,
  type ReasoningEffort,
} from './openai-chat.js';
import {
  BRIEF_MIN_WORDS,
  COLOUR_MOODS,
  DESIGN_COMPOSITIONS,
  DESIGN_FORMS,
  DESIGN_IMAGERY,
  DESIGN_PRINCIPLES,
  oneOf,
  parseJson,
  parsePosterDesign,
  sanitizeBrief,
  type PosterDesign,
} from './poster-design-director.js';

// One env read, so rollback is a single line (the SOCIAL_POSTER_DESIGN_DIRECTION precedent).
export function carouselDesignDirectionEnabled(): boolean {
  return (
    (process.env.CAROUSEL_DESIGN_DIRECTION ?? '').trim().toLowerCase() !== 'off'
  );
}

// The social director's tier — this is the same kind of decision, made once per post.
const DESIGN_MODEL =
  process.env.OPENAI_POSTER_DESIGN_MODEL?.trim() || UTILITY_MODEL;
const DESIGN_EFFORT: ReasoningEffort = 'low';
const SLIDE_TEXT_MAX_CHARS = 500;
// A slide brief is shorter than a poster brief: it only has to say how THIS slide arranges itself
// inside a look the series brief already fixed.
export const SLIDE_BRIEF_MIN_WORDS = 12;
export const SLIDE_BRIEF_MAX_WORDS = 70;

const SYSTEM_PROMPT = [
  'You are the design director for DGIPR, the Directorate General of Information and Public Relations, Government of Maharashtra. For each social-media CAROUSEL — a cover slide and two or three detail slides that a reader swipes through as one post — you decide its visual direction in English sentences. Each slide is then painted SEPARATELY by an image model that cannot see the other slides, so the only thing that makes them one set is what you write. You never write the slide text: that is supplied separately and is not yours to touch.',
  '',
  ...DESIGN_PRINCIPLES,
  '',
  'A CAROUSEL IS DIRECTED AT TWO LEVELS:',
  "- THE SERIES LOOK (one paragraph, repeated word for word in every slide's instructions): the light ground; the colour mood and exactly which role each colour plays (titles, accents, panels, figures); the character of the typeface and how every slide title is set; the panel and block language; how imagery is treated on every slide (the kind of photography or illustration, its crop shape and edge treatment); the spacing rhythm. Make it concrete enough that separately painted slides are unmistakably one set. It describes the LOOK, never an arrangement: it does not say where things sit on a slide.",
  "- EACH SLIDE'S DESIGN (one per slide, in order): how THIS slide presents ITS OWN content inside the series look — its form, where its visual weight sits, and its imagery — chosen from what that slide contains, by the principles above. Let the arrangement change from slide to slide wherever the content allows, so the post never reads as one template repeated; never give every slide the same form. The cover leads with one strong, striking idea. A slide design never introduces a new colour, typeface, panel style or imagery treatment: the variation lives in the arrangement, never in the look.",
  '',
  'OUTPUT RULES: style only, in English. Never write any slide text, headline, words to print, numbers, names, dates or places, and never quote anything. Where the content allows, make this post clearly different from the recent posters listed in the message.',
  '',
  'Answer with STRICT JSON: colourMood (the hue family of the saturated colours), series (about 70 to 90 words: the series look), and slides — exactly one entry per slide, in order, each with form, composition (where that slide’s visual weight sits), imagery, and brief (about 30 to 50 words of direction for that slide, in plain sentences).',
].join('\n');

type Messages = readonly { role: 'system' | 'user'; content: string }[];
// The one model call, injectable so the offline harness can exercise the retries for free.
export type CarouselDirectorCall = (messages: Messages) => Promise<string>;

export type DirectCarouselDesignInput = Readonly<{
  plan: CarouselPlan;
  // The last few stored directions (single posters and carousel covers), newest first.
  recent?: readonly PosterDesign[] | undefined;
  // The hue buckets recent renders were MEASURED in, newest first.
  recentMeasuredBuckets?: readonly string[] | undefined;
  // The post's current direction, on a whole-post redo. Absent on a first render.
  previous?: CarouselDesign | null | undefined;
  call?: CarouselDirectorCall | undefined;
}>;

const hasDigit = (text: string): boolean => /[0-9०-९]/.test(text);

function describe(design: PosterDesign): string {
  return `form=${design.form}, weight=${design.composition}, imagery=${design.imagery}, colour=${design.colourMood}`;
}

// What each slide carries, as facts the director can design from — counts, not wording — plus
// the text itself for its shape. The planned picture subject is English and style-safe.
function slideSummary(
  slide: CarouselPlanSlide,
  index: number,
  count: number,
): string {
  const sections = new Set(
    slide.items.map((i) => i.section.trim()).filter((s) => s.length > 0),
  ).size;
  const figures = slide.items.filter((i) => hasDigit(i.text)).length;
  const facts = [
    `${slide.items.length} line(s)`,
    `${figures} carrying a figure`,
    sections > 0 ? `${sections} section heading(s)` : 'no section headings',
    slide.quote ? 'a quotation' : 'no quotation',
    slide.closing ? 'a closing line' : 'no closing line',
  ];
  const text = [
    slide.title,
    slide.subtitle,
    ...slide.items.map((i) => `- ${i.text}`),
    slide.quote ? `“${slide.quote.text}”` : '',
    slide.closing,
  ]
    .filter((t) => t.trim().length > 0)
    .join('\n')
    .slice(0, SLIDE_TEXT_MAX_CHARS);
  return [
    `SLIDE ${index + 1} OF ${count} (${slide.role === 'cover' ? 'the cover' : 'a detail slide'}): ${facts.join(', ')}.`,
    ...(slide.visual.trim()
      ? [`Planned picture subject: ${slide.visual.trim()}`]
      : []),
    'Its text, ONLY so you can judge its shape — never copy any of it:',
    text,
  ].join('\n');
}

// Exported for the harness, which prints it for review.
export function buildCarouselDirectorUserPrompt(
  input: DirectCarouselDesignInput,
  sharper: 'variety' | 'redo' | null = null,
): string {
  const lines: string[] = [];
  const recent = input.recent ?? [];
  if (recent.length > 0) {
    lines.push(
      'Recent posters from this department, newest first:',
      ...recent.map((d, i) => `  ${i + 1}. ${describe(d)}`),
    );
  }
  const measured = (input.recentMeasuredBuckets ?? []).filter(
    (b) => b && b !== 'neutral',
  );
  if (measured.length > 0) {
    lines.push(
      `Colours recent posters actually came out in: ${measured.join(', ')}.`,
    );
  }
  if (lines.length > 0) {
    lines.push('Differ from these where the content allows.', '');
  }

  const previous = input.previous;
  if (previous) {
    const cover = previous.slides[0];
    lines.push(
      `THIS IS A REDO OF THE WHOLE POST. The officer rejected a post in colour mood ${previous.colourMood}` +
        (cover
          ? `, whose cover was designed as form=${cover.form}, weight=${cover.composition}`
          : '') +
        '.',
      `It asked for a NEW LOOK: your colourMood MUST differ from "${previous.colourMood}"` +
        (cover
          ? `, and the cover must not repeat both form "${cover.form}" and weight "${cover.composition}".`
          : '.'),
    );
    if (sharper === 'redo') {
      lines.push(
        'Your previous answer kept the rejected colour family or cover arrangement. Choose a genuinely different look this time.',
      );
    }
    lines.push('');
  }
  if (sharper === 'variety') {
    lines.push(
      'Your previous answer gave every slide the same arrangement. Give each slide the form that suits ITS content, so the slides differ from one another inside the one look.',
      '',
    );
  }

  const count = input.plan.slides.length;
  lines.push(
    `This carousel has ${count} slides. Give exactly ${count} slide designs, in this order.`,
    '',
    ...input.plan.slides.flatMap((slide, i) => [
      slideSummary(slide, i, count),
      '',
    ]),
  );
  return lines.join('\n').trimEnd();
}

function parseSlideDesign(value: unknown): CarouselSlideDesign | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const composition = oneOf(DESIGN_COMPOSITIONS, raw.composition);
  const imagery = oneOf(DESIGN_IMAGERY, raw.imagery);
  if (!composition || !imagery) return null;
  const brief = sanitizeBrief(typeof raw.brief === 'string' ? raw.brief : '', {
    minWords: SLIDE_BRIEF_MIN_WORDS,
    maxWords: SLIDE_BRIEF_MAX_WORDS,
  });
  if (!brief) return null;
  return {
    form: oneOf(DESIGN_FORMS, raw.form) ?? 'other',
    composition,
    imagery,
    brief,
  };
}

// Parse the director's answer for a plan of `slideCount` slides. Null when the SERIES look is
// unusable — without it there is nothing holding the slides together. The slide list is always
// exactly `slideCount` long: extra entries are dropped, missing or unusable ones are null.
export function parseCarouselDesign(
  raw: string,
  slideCount: number,
): CarouselDesign | null {
  const parsed = parseJson(raw);
  if (!parsed) return null;
  const colourMood = oneOf(COLOUR_MOODS, parsed.colourMood);
  const series = sanitizeBrief(
    typeof parsed.series === 'string' ? parsed.series : '',
    { minWords: BRIEF_MIN_WORDS },
  );
  if (!colourMood || !series) return null;
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];
  return {
    colourMood,
    brief: series,
    slides: Array.from({ length: slideCount }, (_, i) =>
      parseSlideDesign(rawSlides[i]),
    ),
  };
}

// Did the director give a post of three or more slides one arrangement throughout?
export function lacksVariety(design: CarouselDesign): boolean {
  const directed = design.slides.filter(
    (s): s is CarouselSlideDesign => s !== null,
  );
  if (directed.length < 3) return false;
  return new Set(directed.map((s) => `${s.form}/${s.composition}`)).size < 2;
}

// Did a whole-post redo keep what it was asked to change?
export function repeatsPreviousLook(
  design: CarouselDesign,
  previous: CarouselDesign | null | undefined,
): boolean {
  if (!previous) return false;
  if (design.colourMood === previous.colourMood) return true;
  const a = design.slides[0];
  const b = previous.slides[0];
  return !!a && !!b && a.form === b.form && a.composition === b.composition;
}

// The cover's direction as a single-poster design, for generations.poster_style — which is what
// lets the NEXT carousel and the social director see what this post looked like.
export function carouselCoverDesign(
  design: CarouselDesign | null | undefined,
): PosterDesign | null {
  const cover = design?.slides[0];
  if (!design || !cover) return null;
  return parsePosterDesign({ ...cover, colourMood: design.colourMood });
}

const defaultCall: CarouselDirectorCall = (messages) =>
  chatComplete(messages, {
    model: DESIGN_MODEL,
    reasoningEffort: DESIGN_EFFORT,
    maxTokens: 1400,
    jsonSchema: {
      name: 'carousel_design_direction',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          colourMood: { type: 'string', enum: [...COLOUR_MOODS] },
          series: { type: 'string' },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                form: { type: 'string', enum: [...DESIGN_FORMS] },
                composition: { type: 'string', enum: [...DESIGN_COMPOSITIONS] },
                imagery: { type: 'string', enum: [...DESIGN_IMAGERY] },
                brief: { type: 'string' },
              },
              required: ['form', 'composition', 'imagery', 'brief'],
            },
          },
        },
        required: ['colourMood', 'series', 'slides'],
      },
    },
  });

// Decide this post's direction, or null. Never throws.
export async function directCarouselDesign(
  input: DirectCarouselDesignInput,
): Promise<CarouselDesign | null> {
  const count = input.plan.slides.length;
  if (count === 0) return null;
  const call = input.call ?? defaultCall;
  const ask = async (
    sharper: 'variety' | 'redo' | null,
  ): Promise<CarouselDesign | null> =>
    parseCarouselDesign(
      await call([
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildCarouselDirectorUserPrompt(input, sharper),
        },
      ]),
      count,
    );
  try {
    const first = await ask(null);
    if (!first) return null;
    const problem = repeatsPreviousLook(first, input.previous)
      ? 'redo'
      : lacksVariety(first)
        ? 'variety'
        : null;
    if (!problem) return first;
    // ONE retry with a sharper note, then accept whatever comes back: a direction that still
    // repeats is better than none.
    const second = await ask(problem).catch(() => null);
    return second ?? first;
  } catch (error) {
    console.warn(
      '[carousel-design] direction failed (rendering without one):',
      error,
    );
    return null;
  }
}

// --- CLI harness ----------------------------------------------------------------------------
//   tsx src/generation/carousel-design-director.ts --check              (free, offline)
//   tsx --env-file=../../.env src/generation/carousel-design-director.ts --file=note.txt [3|4]
// The live run plans the carousel (one call), directs it (one call), and prints both plus the
// assembled cover and slide-2 prompts. Use --file: npx truncates a multi-line argv on Windows.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  const SERIES =
    'Set every slide on a clean white ground with a deep teal for titles and a warm coral for accents and figures. Titles are bold, confident and left aligned. Panels are soft pale teal tints with generous rounded corners and no outlines. Photographs are bright, naturally lit documentary images cropped into tall rounded rectangles. Spacing is generous and even across the set.';
  const SLIDE =
    'Lead with one large photograph filling the upper half and set the title boldly beneath it with the lines as a calm short list.';
  const SLIDE_B =
    'Let the figures carry this slide as large confident numerals in a two by two grid with their labels small beneath each.';
  const line = (text: string) => ({ text, emphasis: [], section: '' });
  const base = {
    titleEmphasis: [] as string[],
    subtitle: '',
    quote: null,
    closing: '',
    layout: '' as const,
    visual: '',
  };
  const plan: CarouselPlan = {
    seriesTitle: 'मालिका',
    verbatim: false,
    dateline: '',
    designSystem: '',
    slides: [
      {
        ...base,
        role: 'cover',
        title: 'सौर कृषी पंप योजना',
        items: [line('२५ लाख शेतकरी')],
        visual: 'A farmer beside a solar pump in a green field',
      },
      {
        ...base,
        role: 'detail',
        title: 'लाभ',
        items: [line('९०% अनुदान'), line('दिवसा वीज')],
      },
      {
        ...base,
        role: 'detail',
        title: 'अर्ज कसा करावा',
        items: [line('नोंदणी'), line('कागदपत्रे'), line('मंजुरी')],
      },
    ],
  };
  const slideAnswer = (d: Partial<CarouselSlideDesign> = {}) => ({
    form: 'image_led',
    composition: 'top',
    imagery: 'photo_large',
    brief: SLIDE,
    ...d,
  });
  const answer = (
    slides: unknown[],
    colourMood = 'teal',
    series = SERIES,
  ): string => JSON.stringify({ colourMood, series, slides });

  if (process.argv.includes('--check')) {
    // 1. Parsing.
    const varied = [
      slideAnswer(),
      slideAnswer({
        form: 'figure_led',
        composition: 'centre',
        brief: SLIDE_B,
      }),
      slideAnswer({ form: 'sequence', composition: 'left' }),
    ];
    const parsed = parseCarouselDesign(`Sure: ${answer(varied)} done`, 3);
    check(parsed?.colourMood === 'teal', 'prosy JSON did not parse');
    check(parsed?.brief === SERIES, 'a clean series brief was altered');
    check(
      parsed?.slides.length === 3 && parsed.slides.every((s) => s !== null),
      'three good slides did not all parse',
    );
    check(parseCarouselDesign('nope', 3) === null, 'junk parsed');
    check(
      parseCarouselDesign(answer(varied, 'magenta'), 3) === null,
      'an unknown colour mood was accepted',
    );
    check(
      parseCarouselDesign(answer(varied, 'teal', 'A pale ground.'), 3) === null,
      'a thin series brief did not null the whole direction',
    );
    const short = parseCarouselDesign(answer([varied[0]]), 3);
    check(
      short?.slides.length === 3 &&
        short.slides[0] !== null &&
        short.slides[1] === null &&
        short.slides[2] === null,
      'missing slide entries were not padded with null',
    );
    const long = parseCarouselDesign(answer([...varied, ...varied]), 3);
    check(long?.slides.length === 3, 'extra slide entries were not dropped');
    const unsafe = parseCarouselDesign(
      answer([
        slideAnswer({
          brief: 'Print शासन निर्णय large. Show the 25 lakh total.',
        }),
        varied[1],
        varied[2],
      ]),
      3,
    );
    check(
      unsafe?.slides[0] === null && unsafe.slides[1] !== null,
      'an all-forbidden slide brief was kept, or nulled its neighbours',
    );
    const newForm = parseCarouselDesign(
      answer([slideAnswer({ form: 'brand_new' }), varied[1], varied[2]]),
      3,
    );
    check(
      newForm?.slides[0]?.form === 'other',
      'an unknown form was not folded to other',
    );

    // 2. Variety and redo tests.
    check(!lacksVariety(parsed!), 'a varied post was flagged');
    const flat = parseCarouselDesign(
      answer([slideAnswer(), slideAnswer(), slideAnswer()]),
      3,
    )!;
    check(lacksVariety(flat), 'a one-arrangement post was not flagged');
    check(
      !lacksVariety({ ...flat, slides: flat.slides.slice(0, 2) }),
      'a two-slide direction was held to the three-slide rule',
    );
    check(
      repeatsPreviousLook(parsed!, parsed) &&
        !repeatsPreviousLook(parsed!, null) &&
        repeatsPreviousLook({ ...parsed!, colourMood: 'green' }, parsed) &&
        !repeatsPreviousLook(
          {
            ...parsed!,
            colourMood: 'green',
            slides: [varied[1] as CarouselSlideDesign, null, null],
          },
          parsed,
        ),
      'the redo test is wrong',
    );

    // 3. The retries, on a stubbed call.
    const run = async (
      answers: string[],
      previous?: CarouselDesign | null,
    ): Promise<[CarouselDesign | null, number, string[]]> => {
      const prompts: string[] = [];
      let calls = 0;
      const result = await directCarouselDesign({
        plan,
        previous,
        call: async (messages) => {
          prompts.push(messages[1]?.content ?? '');
          const a = answers[calls] ?? answers[answers.length - 1] ?? '';
          calls += 1;
          return a;
        },
      });
      return [result, calls, prompts];
    };
    const [same, sameCalls, samePrompts] = await run([
      answer([slideAnswer(), slideAnswer(), slideAnswer()]),
      answer(varied),
    ]);
    check(sameCalls === 2, `a flat post made ${sameCalls} call(s), expected 2`);
    check(!!same && !lacksVariety(same), 'the varied retry was not used');
    check(
      samePrompts[1]?.includes('gave every slide the same arrangement') ??
        false,
      'the variety retry carried no sharper note',
    );
    const [, fineCalls] = await run([answer(varied)]);
    check(fineCalls === 1, 'a varied first answer was retried');
    const [, redoCalls, redoPrompts] = await run(
      [answer(varied), answer(varied, 'green')],
      parsed,
    );
    check(redoCalls === 2, 'a redo keeping the colour mood was not retried');
    check(
      redoPrompts[0]?.includes('colourMood MUST differ from "teal"') ?? false,
      'the redo note is missing',
    );
    const [failed] = await run(['{broken']);
    check(failed === null, 'a broken answer did not return null');
    const threw = await directCarouselDesign({
      plan,
      call: async () => {
        throw new Error('boom');
      },
    });
    check(threw === null, 'a throwing call did not return null');

    // 4. The user prompt describes each slide's shape, and the cover design reaches history.
    const prompt = buildCarouselDirectorUserPrompt({
      plan,
      recent: [
        {
          form: 'icon_list',
          composition: 'left',
          imagery: 'photo_inset',
          colourMood: 'orange',
        },
      ],
      recentMeasuredBuckets: ['orange', 'neutral'],
    });
    console.log(`--- user prompt ---\n${prompt}\n-------------------`);
    check(
      prompt.includes('Give exactly 3 slide designs'),
      'the slide count is not stated',
    );
    check(
      prompt.includes(
        'SLIDE 2 OF 3 (a detail slide): 2 line(s), 1 carrying a figure',
      ),
      'a slide shape summary is wrong',
    );
    check(
      prompt.includes('Planned picture subject: A farmer'),
      'the planned picture subject is missing',
    );
    check(
      prompt.includes('1. form=icon_list, weight=left'),
      'recent designs are not listed',
    );
    check(
      carouselCoverDesign(parsed)?.form === 'image_led' &&
        carouselCoverDesign(parsed)?.colourMood === 'teal' &&
        carouselCoverDesign(null) === null,
      'the cover design for history is wrong',
    );
    check(
      SYSTEM_PROMPT.includes('overused default') &&
        SYSTEM_PROMPT.includes('LIGHT ground') &&
        SYSTEM_PROMPT.includes('never an arrangement') &&
        SYSTEM_PROMPT.includes('never in the look'),
      'the system prompt lost a principle or the two-level rule',
    );

    if (failures.length > 0) {
      console.error(`\n${failures.length} FAILURE(S):`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\nAll carousel-design-director assertions passed.');
    }
  } else {
    const fileArg = process.argv.find((a) => a.startsWith('--file='));
    if (!fileArg) {
      console.error(
        'Usage: tsx src/generation/carousel-design-director.ts --check | --file=note.txt [3|4]',
      );
      process.exitCode = 1;
    } else {
      const note = await readFile(fileArg.slice('--file='.length), 'utf8');
      const countArg = process.argv.find((a) => a === '3' || a === '4');
      const { planCarousel } = await import('./plan-carousel.js');
      const { buildCarouselCoverPrompt, buildCarouselDetailPrompt } =
        await import('./build-carousel-prompt.js');
      const { plan: live } = await planCarousel({
        note,
        requestedSlides: countArg ? (Number(countArg) as 3 | 4) : 'auto',
      });
      const design = await directCarouselDesign({ plan: live });
      console.log(`=== direction ===\n${JSON.stringify(design, null, 2)}`);
      console.log(
        `\n=== cover prompt ===\n${buildCarouselCoverPrompt({ plan: live, design })}`,
      );
      if (live.slides.length > 1) {
        console.log(
          `\n=== slide 2 prompt ===\n${buildCarouselDetailPrompt({ plan: live, index: 1, design, seriesReference: true })}`,
        );
      }
    }
  }
}
