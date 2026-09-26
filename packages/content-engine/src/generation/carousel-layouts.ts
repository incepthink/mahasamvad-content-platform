// The body LAYOUTS a carousel slide can be given (कॅरोसेल, migration 0059), and the deterministic
// assignment that makes every slide of one post a different one.
//
// WHY THIS EXISTS. Every slide used to ask gpt-image for "a title and some lines", and each slide
// is a separate render that cannot see the others — so the model fell back to its one default
// shape (header, title, bullet column, photo) on every slide and the post read as one template
// repeated. The detail prompt said the body "need not match" the other slides, which PERMITS a
// different layout and asks for none. Now each slide is ASSIGNED one, stated as a decision (the
// poster-placements.ts shape for the social poster).
//
// INSTRUCT, THEN GUARANTEE. The planner proposes a layout per slide; `assignCarouselLayouts`
// keeps a proposal only when the slide's content can carry it and no earlier slide already has
// it, and otherwise hands out the first eligible unused one. So the variety is structural: two
// slides share a layout only when the content leaves no other eligible choice.
//
// Each instruction states WHERE things sit and nothing about colour, typeface or icon size —
// those belong to the series frame and to the social poster's rule blocks (ICONS keeps icons
// small, which is why no layout here asks for large icon badges).

import { pathToFileURL } from 'node:url';
import type { CarouselLayoutId, CarouselPlanSlide } from '@dgipr/schemas';
import { CAROUSEL_LAYOUT_IDS } from '@dgipr/schemas';

export type CarouselLayout = Readonly<{
  id: CarouselLayoutId;
  // One line for the planner's schema description: what the layout is FOR.
  purpose: string;
  // What the image prompt states as the slide's arrangement.
  instruction: string;
  // Whether this slide's content can carry the layout. A layout the content cannot fill is
  // never assigned — an arrangement stated firmly and then left half-empty is worse than none.
  fits: (slide: CarouselPlanSlide) => boolean;
}>;

const hasDigit = (text: string): boolean => /[0-9०-९]/.test(text);

function sectionCount(slide: CarouselPlanSlide): number {
  return new Set(
    slide.items.map((item) => item.section.trim()).filter((s) => s.length > 0),
  ).size;
}

export const CAROUSEL_LAYOUTS: readonly CarouselLayout[] = [
  {
    id: 'hero_cards',
    purpose:
      'a large photograph plus the key facts as two or three blocks — best for the cover',
    instruction:
      'A large photograph takes about half of the body. The title (and subheading, if any) sits beside or above it, and the lines are set as two or three side-by-side blocks separated by spacing or a plain tint; any line that does not fit a card follows as a short paragraph.',
    fits: (slide) => slide.items.length <= 6,
  },
  {
    id: 'sectioned_cards',
    purpose:
      'two or more titled sections, each with its own short list — for content grouped under headings',
    instruction:
      'The body is divided into titled SECTIONS, one per section heading, stacked or side by side and set apart by spacing or a plain tint rather than outlines; each section shows its heading and its own lines as a short list. The photograph sits as a circular inset between or beside the sections.',
    fits: (slide) => sectionCount(slide) >= 2,
  },
  {
    id: 'icon_list',
    purpose:
      'a vertical list of well-spaced rows, ending in a plain closing panel',
    instruction:
      'The lines form ONE vertical list of well-spaced rows, separated by spacing rather than lines or boxes; a small plain icon leads a row only where it adds meaning the words do not. The photograph is a narrower panel to one side or a band above the list. A plain panel at the end carries the closing line, if there is one.',
    fits: (slide) => slide.items.length >= 2,
  },
  {
    id: 'timeline',
    purpose:
      'ordered steps or dated events along a line — for schedules and processes',
    instruction:
      'The lines are steps along ONE timeline (vertical, or horizontal if there are few), in the order given, with a marker on each step. The photograph is a smaller panel above or beside the timeline.',
    fits: (slide) => slide.items.length >= 3,
  },
  {
    id: 'figures',
    purpose:
      'the numbers are the heroes: each figure set large with its words small beneath — for statistics',
    instruction:
      'Each line becomes a block whose FIGURE is set large with the rest of its words small beneath it; the blocks sit in a grid. The photograph is a background panel under a soft overlay or a smaller side panel.',
    fits: (slide) =>
      slide.items.filter((item) => hasDigit(item.text)).length >= 2,
  },
  {
    id: 'quote_panel',
    purpose:
      "a large quotation panel with the speaker's name beneath it — for a slide carrying a quote",
    instruction:
      "A large quotation panel carries the quote with the speaker's name beneath it; the remaining lines sit below it as a short list. The photograph is a side panel.",
    fits: (slide) => slide.quote !== null,
  },
  {
    id: 'split',
    purpose:
      'the slide split in two: the photograph fills one side edge to edge, the text the other',
    instruction:
      'The slide is split vertically: the photograph fills one side from edge to edge, and the title and lines fill the other side as a clean list.',
    fits: () => true,
  },
];

export function carouselLayoutById(
  id: string | null | undefined,
): CarouselLayout | null {
  return CAROUSEL_LAYOUTS.find((layout) => layout.id === id) ?? null;
}

// The layout ids, for the planner's json_schema enum.
export const CAROUSEL_LAYOUT_ENUM: readonly CarouselLayoutId[] =
  CAROUSEL_LAYOUT_IDS;

// Give every slide a layout, in place. A proposal is kept when it fits and is unused; otherwise
// the first fitting unused layout is taken; only when every fitting layout is already used does a
// slide repeat one (the least-used fitting layout). `split` always fits, so a slide always gets
// a layout.
export function assignCarouselLayouts(slides: CarouselPlanSlide[]): void {
  const used = new Map<CarouselLayoutId, number>();
  const take = (slide: CarouselPlanSlide, id: CarouselLayoutId): void => {
    slide.layout = id;
    used.set(id, (used.get(id) ?? 0) + 1);
  };
  for (const slide of slides) {
    const proposed = carouselLayoutById(slide.layout);
    if (proposed && proposed.fits(slide) && !used.has(proposed.id)) {
      take(slide, proposed.id);
      continue;
    }
    const fitting = CAROUSEL_LAYOUTS.filter((layout) => layout.fits(slide));
    const unused = fitting.find((layout) => !used.has(layout.id));
    if (unused) {
      take(slide, unused.id);
      continue;
    }
    const leastUsed = [...fitting].sort(
      (a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0),
    )[0];
    take(slide, leastUsed?.id ?? 'split');
  }
}

// ---------------------------------------------------------------------------
// Free harness:  npx tsx src/generation/carousel-layouts.ts
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
  const slide = (
    layout: string,
    items: Array<[string, string?]>,
    quote = false,
  ): CarouselPlanSlide => ({
    role: 'detail',
    title: 't',
    titleEmphasis: [],
    subtitle: '',
    layout: layout as CarouselPlanSlide['layout'],
    items: items.map(([text, section]) => ({
      text,
      emphasis: [],
      section: section ?? '',
    })),
    quote: quote ? { text: 'q', speaker: 's' } : null,
    closing: '',
    visual: '',
  });

  check(
    'the library covers every schema id',
    CAROUSEL_LAYOUT_IDS.every((id) => carouselLayoutById(id) !== null),
  );
  check(
    'no instruction names a colour, asks for large icons or invites stock decoration',
    CAROUSEL_LAYOUTS.every(
      (l) =>
        !/colou?r|saffron|navy|large icon|big icon|badge|border|underline|accent|stripe|highlighted/i.test(
          `${l.purpose} ${l.instruction}`,
        ),
    ),
  );

  const same = [
    slide('icon_list', [['अ'], ['ब'], ['क']]),
    slide('icon_list', [['अ'], ['ब'], ['क']]),
    slide('icon_list', [['अ'], ['ब'], ['क']]),
    slide('icon_list', [['अ'], ['ब'], ['क']]),
  ];
  assignCarouselLayouts(same);
  check(
    'four identical proposals become four different layouts',
    new Set(same.map((s) => s.layout)).size === 4,
  );
  check('the first proposal is kept', same[0]!.layout === 'icon_list');

  const unfit = [slide('quote_panel', [['अ'], ['ब']])];
  assignCarouselLayouts(unfit);
  check(
    'a quote layout without a quote is replaced',
    unfit[0]!.layout !== 'quote_panel',
  );

  const quoted = [slide('quote_panel', [['अ']], true)];
  assignCarouselLayouts(quoted);
  check(
    'a quote layout with a quote is kept',
    quoted[0]!.layout === 'quote_panel',
  );

  const sections = [
    slide('sectioned_cards', [
      ['अ', 'गावे'],
      ['ब', 'गावे'],
      ['क', 'सूचना'],
    ]),
  ];
  assignCarouselLayouts(sections);
  check(
    'sectioned cards kept with two section headings',
    sections[0]!.layout === 'sectioned_cards',
  );
  const oneSection = [
    slide('sectioned_cards', [
      ['अ', 'गावे'],
      ['ब', 'गावे'],
    ]),
  ];
  assignCarouselLayouts(oneSection);
  check(
    'sectioned cards refused with one heading',
    oneSection[0]!.layout !== 'sectioned_cards',
  );

  const figures = [slide('figures', [['५ जागा'], ['मतदान']])];
  assignCarouselLayouts(figures);
  check('figures refused with one figure', figures[0]!.layout !== 'figures');

  const empty = [slide('', [])];
  assignCarouselLayouts(empty);
  check('an empty slide still gets a layout', empty[0]!.layout !== '');

  const unknown = [slide('nonsense', [['अ'], ['ब']])];
  assignCarouselLayouts(unknown);
  check(
    'an unknown proposal is replaced by a real layout',
    carouselLayoutById(unknown[0]!.layout) !== null,
  );

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}
