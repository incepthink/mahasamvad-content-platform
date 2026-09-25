// The image prompts for a carousel (कॅरोसेल, migration 0059). Pure string assembly, no model call.
//
// The NUMBERS / TEXT ACCURACY / ICONS / DO NOT USE / HEADLINE & MARGINS / AREA RULES blocks are
// the fresh social poster's OWN constants (`minimal-creative-prompt.ts`), imported rather than
// copied (2026-09-25). The hand-shortened copies this file used to carry had drifted, and one of
// them — "keep the top-right 180 × 170 px area clear" on the detail slide — made the model paint an
// empty rounded box around the badge corner. The social rule speaks about TEXT only (size or wrap
// the headline so no text reaches that corner), and the badge then sits on the artwork. ICONS and
// DO NOT USE (no maps) are kept VERBATIM by the department's decision, even though the carousel
// now asks for more designed slides.
//
// COLOUR is the model's, as on the fresh social poster: no palette block is emitted. What the
// slides share is the planner's DESIGN SYSTEM paragraph (background, two-tone headline,
// panel style, colour scheme by name), stated identically in every prompt. There is NO header
// band and the series title is not printed (the department removed both, 2026-09-25).
//
// EVERY SLIDE IS A NEW POSTER, and the SYSTEM is what is shared. Detail slides were once EDITS of
// the cover's raw render with a "keep the background" prompt, and gpt-image kept the cover's
// photograph and layout on every slide (generation 4b18548a). Then every slide became a blind,
// independent generation, and — asked for "a title and some lines" with nothing requesting
// variety — each came back in the model's one default shape. So now (2026-09-25):
//   - each slide is ASSIGNED a body LAYOUT (carousel-layouts.ts), different across the post;
//   - the series frame carries NO dateline and NO slide number (the department removed both,
//     2026-09-25) and states a flat-styling rule, since "a card with a coloured bar under its
//     icon" is the model's stock decoration and read as generic AI design;
//   - detail slides may be given slide 1 as a CONTEXT image (`seriesReference`) with an explicit
//     rule — keep its FRAME, never its photograph or body layout — the /video world-reference
//     move. The job can turn that off (CAROUSEL_SERIES_REFERENCE=off), falling back to blind
//     generation with the same prompt minus the reference paragraph.

import { pathToFileURL } from 'node:url';
import type { CarouselPlan, CarouselPlanSlide } from '@dgipr/schemas';
import { SOCIAL_ZONES } from './build-poster-prompt.js';
import { carouselLayoutById } from './carousel-layouts.js';
import {
  DO_NOT_USE_RULE,
  ICONS_RULE,
  NUMBERS_RULE,
  TEXT_ACCURACY_RULE,
  buildAreaRule,
  buildHeadlineMarginsRule,
} from './minimal-creative-prompt.js';

const SIZE = `${SOCIAL_ZONES.width} × ${SOCIAL_ZONES.height}`;

// The social poster's rule blocks, in its order. Identical in the cover and every detail slide.
function socialRules(): string[] {
  return [
    NUMBERS_RULE,
    '',
    TEXT_ACCURACY_RULE,
    '',
    ICONS_RULE,
    '',
    DO_NOT_USE_RULE,
    '',
    buildHeadlineMarginsRule(
      SOCIAL_ZONES.lockupWidth,
      SOCIAL_ZONES.lockupHeight,
    ),
    '',
    buildAreaRule(SOCIAL_ZONES.width, SOCIAL_ZONES.height),
  ];
}

// The TEXT TO PUT ON THE POSTER block every prompt ends with. Only text that is PRINTED goes
// here — instructions about how to set it (emphasis, layout) live in the layout block, or the
// model paints the instruction. No dateline and no slide number: whatever is listed here is
// printed, so leaving either in would paint it whatever the frame says.
export function carouselSlideText(
  plan: CarouselPlan,
  slide: CarouselPlanSlide,
): string {
  // The series title is NOT printed (2026-09-25): it was the text of a header band across the
  // top of every slide, level with the badge, which the department removed. Printing it anywhere
  // would bring the band back. It stays on the plan as the title fallback.
  const lines = [`Title: ${slide.title}`];
  if (slide.subtitle) lines.push(`Subheading: ${slide.subtitle}`);
  // Consecutive lines of one section share one heading; untagged lines sit under "Items:".
  let current: string | null = null;
  for (const item of slide.items) {
    if (item.section !== current) {
      current = item.section;
      lines.push(current ? `Section: ${current}` : 'Items:');
    }
    lines.push(`- ${item.text}`);
  }
  if (slide.quote) {
    lines.push(`Quote: “${slide.quote.text}” — ${slide.quote.speaker}`);
  }
  if (slide.closing) lines.push(`Closing: ${slide.closing}`);
  return lines.join('\n');
}

// Stated positively, as NO_TEXT_RULE is: what to show instead of the stock decoration.
export const FLAT_STYLE_RULE =
  '- Clean, flat styling: icons sit plainly beside their own text — no coloured bar, border strip, underline or accent rule beneath icons, cards, headings or titles, and no decorative ribbons or stripes. Separate blocks with spacing and a plain background tint only.';

// What stays the same on every slide. Identical text in every prompt of one carousel — the
// frame is only a frame if each slide is told the same thing.
// Stated positively and AFTER the planner's look paragraph, because a plan written before
// 2026-09-25 may still describe a header band there and this line has to win.
export const NO_HEADER_BAND_RULE =
  '- No header band, title bar or coloured strip across the top of the slide: the background runs up to the top edge, and the slide title is the first text on the poster, set in the poster itself.';

export function carouselSeriesFrame(plan: CarouselPlan): string {
  return [
    'SERIES FRAME — identical on every slide of this carousel:',
    '- The same typeface and type hierarchy: slide title, subheading, section headings, then the lines.',
    '- The same icon style (small, simple, one line weight), the same margins and the same corner/panel treatment.',
    '- The same colour scheme on every slide.',
    FLAT_STYLE_RULE,
    ...(plan.designSystem ? [`- THE POST'S LOOK: ${plan.designSystem}`] : []),
    NO_HEADER_BAND_RULE,
  ].join('\n');
}

// This slide's body arrangement, stated as a decision, plus how to set the parts the text block
// only lists (the two-tone title, highlighted words, section labels, the quote, the closing line).
function slideLayout(slide: CarouselPlanSlide): string {
  const layout = carouselLayoutById(slide.layout);
  const lines = ['THIS SLIDE’S LAYOUT (decided for this slide — use it):'];
  lines.push(
    layout
      ? `- ${layout.instruction}`
      : '- Arrange this slide’s lines in the way that suits them best (a list, cards, a timeline, figures), inside the series frame.',
  );
  if (slide.titleEmphasis.length > 0) {
    lines.push(
      `- Two-tone title: set ${slide.titleEmphasis.map((w) => `“${w}”`).join(' and ')} in the accent colour and the rest of the title in the main text colour.`,
    );
  }
  const highlights = slide.items.flatMap((item) => item.emphasis);
  if (highlights.length > 0) {
    lines.push(
      `- In the lines, highlight ${highlights.map((w) => `“${w}”`).join(', ')} in bold or the accent colour.`,
    );
  }
  if (slide.items.some((item) => item.section)) {
    lines.push(
      '- Set each section heading as a short label above its own lines, so the groups read as separate blocks.',
    );
  }
  if (slide.quote && slide.layout !== 'quote_panel') {
    lines.push(
      "- Set the quote in its own quotation panel with the speaker's name beneath it.",
    );
  }
  if (slide.closing) {
    lines.push('- End the slide with the closing line in a plain panel.');
  }
  return lines.join('\n');
}

// This slide's own picture. Without a planned brief the model is still told to choose a picture
// from THIS slide's text, never to reuse another slide's.
function slidePicture(slide: CarouselPlanSlide): string {
  const visual = slide.visual.trim();
  return [
    'THIS SLIDE’S PICTURE:',
    visual
      ? `- Picture for this slide: ${visual}`
      : '- Picture for this slide: a photograph or illustration that shows this slide’s own text.',
    '- The picture carries no words, numbers, signs, logos or maps.',
  ].join('\n');
}

// The paragraph a detail slide gets when slide 1 is attached as context. It must say what to
// take (the frame) AND what not to take (the photograph, the scene, the body) — the edit endpoint
// keeps whatever it is not told to change, which is how 4b18548a became four copies of the cover.
export const SERIES_REFERENCE_RULE =
  'The attached image is SLIDE 1 of this same carousel, attached ONLY so this slide matches its series frame. Keep its colour scheme, typeface, title treatment, icon style and panel style exactly. Do NOT reuse its photograph, its scene, its title, its lines or its body layout: this slide is a NEW poster with a NEW photograph and the body layout described below. It shares no text with slide 1.';

function opening(position: string): string {
  return `Make a creative poster for social media platforms in the size ${SIZE}. ${position} It must look very professional.`;
}

export type CarouselCoverPromptInput = Readonly<{
  plan: CarouselPlan;
  // True when a master template is pinned: the model EDITS that image, so one line tells it the
  // image is a layout reference whose own words and branding must not be copied.
  editsReference?: boolean | undefined;
}>;

export function buildCarouselCoverPrompt(
  input: CarouselCoverPromptInput,
): string {
  const { plan } = input;
  const count = plan.slides.length;
  const cover = plan.slides[0];
  if (!cover) throw new Error('A carousel plan needs at least one slide.');

  return [
    ...(input.editsReference
      ? [
          'The attached image is a LAYOUT REFERENCE only: follow its structure, but copy none of its words, numbers, photographs, logos or branding.',
          '',
        ]
      : []),
    opening(
      `It is SLIDE 1 (the cover) of ${count === 8 || count === 11 || count === 18 ? 'an' : 'a'} ${count}-slide carousel for Maharashtra DGIPR.`,
    ),
    '',
    carouselSeriesFrame(plan),
    '',
    // A pinned master already decides the cover's structure; an assigned layout would contradict it.
    ...(input.editsReference ? [] : [slideLayout(cover), '']),
    slidePicture(cover),
    '',
    ...socialRules(),
    '',
    'TEXT TO PUT ON THE POSTER:',
    carouselSlideText(plan, cover),
  ].join('\n');
}

export type CarouselDetailPromptInput = Readonly<{
  plan: CarouselPlan;
  // 0-based position of the slide being made (1..N-1; 0 is the cover).
  index: number;
  // True when slide 1's raw render is attached as a context image (see SERIES_REFERENCE_RULE).
  seriesReference?: boolean | undefined;
}>;

export function buildCarouselDetailPrompt(
  input: CarouselDetailPromptInput,
): string {
  const { plan, index } = input;
  const count = plan.slides.length;
  const slide = plan.slides[index];
  if (!slide || index < 1) {
    throw new Error(
      `Carousel slide ${index + 1} is not a detail slide of this plan.`,
    );
  }

  return [
    ...(input.seriesReference ? [SERIES_REFERENCE_RULE, ''] : []),
    opening(
      `It is SLIDE ${index + 1} OF ${count} of a Maharashtra DGIPR social media carousel.`,
    ),
    '',
    'KEEP CONSISTENT WITH THE OTHER SLIDES:',
    carouselSeriesFrame(plan),
    '',
    'CHANGE ON THIS SLIDE:',
    slideLayout(slide),
    '',
    slidePicture(slide),
    '- Use a NEW picture made for this slide’s content — not the photograph or scene of any other slide.',
    '',
    ...socialRules(),
    '',
    'TEXT TO PUT ON THE POSTER:',
    carouselSlideText(plan, slide),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Free harness:  npx tsx src/generation/build-carousel-prompt.ts
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures += 1;
  };
  const line = (text: string, section = '', emphasis: string[] = []) => ({
    text,
    emphasis,
    section,
  });
  const base = {
    titleEmphasis: [] as string[],
    subtitle: '',
    quote: null,
    closing: '',
  };
  const plan: CarouselPlan = {
    seriesTitle: 'निवडणूक कार्यक्रम',
    dateline: 'मुंबई, दि. २',
    designSystem: 'A deep blue header band over a light ground.',
    slides: [
      {
        ...base,
        role: 'cover',
        title: 'विधान परिषदेच्या ५ जागांसाठी निवडणूक',
        titleEmphasis: ['निवडणूक'],
        subtitle: 'मतदान २५ जून २०२६',
        layout: 'hero_cards',
        items: [line('मतदान २५ जून २०२६', '', ['२५ जून २०२६'])],
        visual: 'Voters queueing outside a rural polling booth',
      },
      {
        ...base,
        role: 'detail',
        title: 'वेळापत्रक',
        layout: 'sectioned_cards',
        items: [
          line('अधिसूचना २ जून', 'सुरुवात'),
          line('छाननी १० जून', 'छाननी'),
        ],
        quote: { text: 'सर्वांनी मतदान करावे', speaker: 'मुख्यमंत्री' },
        closing: 'मतदान करा',
        visual: 'An election officer checking nomination papers at a desk',
      },
      {
        ...base,
        role: 'detail',
        title: 'मतमोजणी',
        layout: '',
        items: [line('मतमोजणी २८ जून')],
        visual: '',
      },
    ],
  };
  const cover = buildCarouselCoverPrompt({ plan });
  check(
    "cover opens with the department's sentence",
    cover.startsWith(
      'Make a creative poster for social media platforms in the size 1280 × 1504. It is SLIDE 1 (the cover) of a 3-slide carousel for Maharashtra DGIPR. It must look very professional.',
    ),
  );
  check(
    'no prompt asks for an uncongested (sparse) layout',
    !cover.includes('congested') &&
      !buildCarouselDetailPrompt({ plan, index: 1 }).includes('congested'),
  );
  check(
    'cover names the 180 × 170 badge corner',
    cover.includes('An official emblem badge (180 × 170 px)'),
  );
  check(
    'series frame asks for NO header band, after the look paragraph so it wins',
    carouselSeriesFrame(plan).endsWith(NO_HEADER_BAND_RULE) &&
      !carouselSeriesFrame(plan).includes('A header band across the top'),
  );
  check(
    'the series title is not printed on any slide',
    [cover, buildCarouselDetailPrompt({ plan, index: 1 })].every(
      (prompt) =>
        !prompt.includes('Series Title') &&
        !prompt.split('TEXT TO PUT ON THE POSTER:')[1]!.includes('निवडणूक कार्यक्रम'),
    ),
  );
  check(
    'cover ends with the slide text block, with no dateline and no slide number',
    cover.endsWith(
      'TEXT TO PUT ON THE POSTER:\nTitle: विधान परिषदेच्या ५ जागांसाठी निवडणूक\nSubheading: मतदान २५ जून २०२६\nItems:\n- मतदान २५ जून २०२६',
    ),
  );
  check(
    'cover states its assigned layout',
    cover.includes(
      'THIS SLIDE’S LAYOUT (decided for this slide — use it):\n- A large photograph',
    ),
  );
  check(
    'two-tone title and highlight are instructions, not printed text',
    cover.includes('Two-tone title: set “निवडणूक” in the accent colour') &&
      cover.includes('highlight “२५ जून २०२६”') &&
      !cover.split('TEXT TO PUT ON THE POSTER:')[1]!.includes('accent'),
  );
  check(
    "cover does not carry a detail slide's text",
    !cover.includes('छाननी १० जून'),
  );
  check('cover has no reference line', !cover.includes('LAYOUT REFERENCE'));

  const pinned = buildCarouselCoverPrompt({ plan, editsReference: true });
  check(
    'pinned cover opens with the reference line',
    pinned.startsWith('The attached image is a LAYOUT REFERENCE only'),
  );
  check(
    'pinned cover does not state a competing layout',
    !pinned.includes('THIS SLIDE’S LAYOUT'),
  );

  const middle = buildCarouselDetailPrompt({ plan, index: 1 });
  check(
    'detail names its position',
    middle.startsWith(
      'Make a creative poster for social media platforms in the size 1280 × 1504. It is SLIDE 2 OF 3 of a Maharashtra DGIPR social media carousel.',
    ),
  );
  check(
    'detail without a reference has no reference paragraph',
    !middle.includes('attached image'),
  );
  check(
    'detail states its own layout',
    middle.includes('titled SECTION CARDS') &&
      !middle.includes('A large photograph takes about half'),
  );
  check(
    'section headings, the quote and the closing line are printed',
    middle.includes(
      'Section: सुरुवात\n- अधिसूचना २ जून\nSection: छाननी\n- छाननी १० जून',
    ) &&
      middle.includes('Quote: “सर्वांनी मतदान करावे” — मुख्यमंत्री') &&
      middle.endsWith('Closing: मतदान करा'),
  );
  check(
    'a quote outside a quote layout gets its panel instruction',
    middle.includes('quotation panel with the speaker'),
  );
  check(
    'detail prints no slide number and no dateline',
    !middle.includes('Slide Number') &&
      !middle.includes('२/३') &&
      !middle.includes('Dateline') &&
      !middle.includes('मुंबई, दि. २'),
  );
  check(
    'detail carries its own planned picture',
    middle.includes(
      'Picture for this slide: An election officer checking nomination papers at a desk',
    ),
  );
  check(
    "detail does not carry the cover's picture",
    !middle.includes('Voters queueing'),
  );
  check(
    'detail asks for a new picture',
    middle.includes('not the photograph or scene of any other slide'),
  );

  const referenced = buildCarouselDetailPrompt({
    plan,
    index: 1,
    seriesReference: true,
  });
  check(
    'with a series reference the rule leads the prompt',
    referenced.startsWith(SERIES_REFERENCE_RULE),
  );
  check(
    'the reference rule keeps the frame and forbids the photograph and body',
    !SERIES_REFERENCE_RULE.includes('header band') &&
      SERIES_REFERENCE_RULE.includes('Keep its colour scheme') &&
      SERIES_REFERENCE_RULE.includes('Do NOT reuse its photograph') &&
      SERIES_REFERENCE_RULE.includes('body layout'),
  );

  check(
    'series frame is identical in the cover and the detail prompt',
    middle.includes(carouselSeriesFrame(plan)) &&
      cover.includes(carouselSeriesFrame(plan)),
  );
  check(
    'series frame carries the design system and the flat-styling rule',
    carouselSeriesFrame(plan).includes(
      "THE POST'S LOOK: A deep blue header band",
    ) && carouselSeriesFrame(plan).includes(FLAT_STYLE_RULE),
  );
  check(
    'no prompt asks for a dateline or a slide number, even when the plan has a dateline',
    [cover, middle, referenced].every(
      (prompt) => !/dateline|slide number|pill|१\/३/i.test(prompt),
    ),
  );
  check(
    'the flat-styling rule reaches the cover and the detail slides',
    [cover, middle, referenced].every((prompt) =>
      prompt.includes(
        'no coloured bar, border strip, underline or accent rule beneath icons',
      ),
    ),
  );
  check(
    'no highlighted callout is requested',
    ![cover, middle, referenced].some((prompt) => prompt.includes('callout')),
  );
  check(
    'no colour block in either prompt (the model chooses colours, as on social)',
    !cover.includes('COLOUR') && !middle.includes('COLOUR'),
  );
  const shared = [
    NUMBERS_RULE,
    TEXT_ACCURACY_RULE,
    ICONS_RULE,
    DO_NOT_USE_RULE,
    buildHeadlineMarginsRule(180, 170),
    buildAreaRule(1280, 1504),
  ];
  check(
    "the social poster's rule blocks (incl. ICONS and the no-maps rule) appear verbatim in the cover",
    shared.every((rule) => cover.includes(rule)),
  );
  check(
    "the social poster's rule blocks appear verbatim in the detail slide",
    shared.every((rule) => referenced.includes(rule)),
  );
  check(
    'no prompt asks for the badge AREA to be kept clear (the painted-box cause)',
    ![cover, middle, referenced].some(
      (prompt) =>
        /area clear/i.test(prompt) || prompt.includes('Keep the top-right'),
    ),
  );
  const last = buildCarouselDetailPrompt({ plan, index: 2 });
  check(
    'a slide with no brief is told to picture its own text',
    last.includes('illustration that shows this slide’s own text'),
  );
  check(
    'a legacy slide with no layout leaves the arrangement open',
    last.includes('Arrange this slide’s lines in the way that suits them best'),
  );
  check(
    'detail does not carry the cover items',
    !middle.includes('मतदान २५ जून २०२६'),
  );
  check(
    'detail gets the social headline-sizing rule',
    middle.includes('reduce its font size or wrap it across multiple lines'),
  );

  let threw = false;
  try {
    buildCarouselDetailPrompt({ plan, index: 0 });
  } catch {
    threw = true;
  }
  check('the cover cannot be built as a detail slide', threw);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}
