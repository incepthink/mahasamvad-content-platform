// Carousel posters (कॅरोसेल, migration 0059): ONE note becomes a multi-image post — a cover
// slide plus two or three detail slides, all in one look. The shapes shared by the engine
// (which plans the slides), the API (which stores and serves them) and the web (which shows a
// swipeable strip). apps/web cannot import content-engine, hence here.
//
// Why 3 to 4: Instagram and Facebook carousels want every slide at one aspect ratio (4:5,
// which the social poster already is), and X allows at most four images per post — so four is
// the ceiling any platform this department publishes to can carry in one post, and fewer than
// three is not a carousel worth the cover.

import { z } from 'zod';

export const CAROUSEL_MIN_SLIDES = 3;
export const CAROUSEL_MAX_SLIDES = 4;

// Items one slide may carry before the overflow moves to the next slide. A carousel slide is
// read on a phone, one idea per slide; past a dozen rows the type has to shrink below legible.
export const CAROUSEL_MAX_ITEMS_PER_SLIDE = 12;

// What the officer asked for on the create form: स्वयं (the planner decides from the amount of
// content), or exactly 3 or 4.
export const CarouselSlideCountSchema = z.union([
  z.literal('auto'),
  z.literal(3),
  z.literal(4),
]);
export type CarouselSlideCount = z.infer<typeof CarouselSlideCountSchema>;

export const CarouselSlideRoleSchema = z.enum(['cover', 'detail']);
export type CarouselSlideRole = z.infer<typeof CarouselSlideRoleSchema>;

// One line of slide content. The same `{text, emphasis}` shape generate-poster-copy.ts uses for
// a bullet, so the existing prompt formatters can print it unchanged.
export const CarouselItemSchema = z.object({
  text: z.string(),
  emphasis: z.array(z.string()).default([]),
  // The heading of the section this line belongs to on its slide ("भेट दिलेली गावे"), or '' for a
  // plain list. Carried PER LINE rather than as nested sections so that every operation that
  // moves lines between slides (overflow, merging, splitting) keeps the grouping for free.
  section: z.string().default(''),
});
export type CarouselItem = z.infer<typeof CarouselItemSchema>;

// The body layouts a slide can be given (content-engine's carousel-layouts.ts holds what each
// one means). Every slide of one post gets a DIFFERENT one where the content allows it — nothing
// asking for variety is what made every slide the same header + title + bullets + photo.
export const CAROUSEL_LAYOUT_IDS = [
  'hero_cards',
  'sectioned_cards',
  'icon_list',
  'timeline',
  'figures',
  'quote_panel',
  'split',
] as const;
export const CarouselLayoutIdSchema = z.enum(CAROUSEL_LAYOUT_IDS);
export type CarouselLayoutId = z.infer<typeof CarouselLayoutIdSchema>;

// A statement the note attributes to a named person. Both halves are checked against the note
// before it is kept (the speaker must occur in it verbatim), so a quote can never carry a name
// the officer did not write.
export const CarouselQuoteSchema = z.object({
  text: z.string(),
  speaker: z.string(),
});
export type CarouselQuote = z.infer<typeof CarouselQuoteSchema>;

export const CarouselPlanSlideSchema = z.object({
  role: CarouselSlideRoleSchema,
  title: z.string(),
  // Words of the title to set in the accent colour (the two-tone headline). Each is a substring
  // of the title.
  titleEmphasis: z.array(z.string()).default([]),
  subtitle: z.string().default(''),
  // '' on a plan made before layouts existed; the prompt then leaves the arrangement open.
  layout: z.union([CarouselLayoutIdSchema, z.literal('')]).default(''),
  items: z.array(CarouselItemSchema).default([]),
  quote: CarouselQuoteSchema.nullable().default(null),
  // A closing callout line for this slide ('' for none).
  closing: z.string().default(''),
  // What THIS slide's picture shows — a short ENGLISH description derived from the slide's own
  // items ("an officer explaining the Ayushman card to villagers at a stall"). Every slide is
  // generated fresh, so this is what makes slide 3 look like slide 3 rather than the cover with
  // new text. Never a fact source and never printed; '' on a plan made before it existed.
  visual: z.string().default(''),
});
export type CarouselPlanSlide = z.infer<typeof CarouselPlanSlideSchema>;

// The whole post, planned ONCE by one text call. `seriesTitle` is the line every slide's header
// band repeats ("निवडणूक कार्यक्रम"), which is most of what makes four images read as one post.
export const CarouselPlanSchema = z.object({
  seriesTitle: z.string(),
  // जसाच्या तसा मजकूर (2026-09-26): the officer's text IS the slides' text. The planner only
  // DISTRIBUTES it — every printed string is one of the note's own lines, chosen by number — and
  // every slide prompt is told to print its lines in full, exactly as written. False on every
  // plan made before it existed.
  verbatim: z.boolean().default(false),
  // "बुलढाणा, दि. २४" — the place and date from the note, printed in the same pill on every
  // slide. '' when the note gives no place, or on a plan made before it existed.
  dateline: z.string().default(''),
  // The post's shared look in one short English paragraph (header treatment, how the two-tone
  // headline is coloured, the card and panel style, the colour scheme by name), stated
  // IDENTICALLY in every slide's prompt. Steering only — never printed, never a fact source.
  designSystem: z.string().default(''),
  slides: z.array(CarouselPlanSlideSchema).min(1),
});
export type CarouselPlan = z.infer<typeof CarouselPlanSchema>;

// One stored render of one slide. Every render is a NEW immutable object (the public bucket is
// CDN-cached, so a path is never reused), so the history is just the list of them.
export const CarouselStoredVersionSchema = z.object({
  path: z.string(),
  plainPath: z.string().nullable().default(null),
  createdAt: z.string(),
  // The officer's own words for the redo or marker round that produced this render; null on
  // the first render. The slide's history, like the revision log is the poster's.
  feedback: z.string().nullable().default(null),
});
export type CarouselStoredVersion = z.infer<typeof CarouselStoredVersionSchema>;

// One slide as the row stores it. `path` null = not rendered yet, which is what lets a retry
// after a mid-render failure render ONLY the missing slides (the /video resume doctrine).
export const CarouselStoredSlideSchema = z.object({
  index: z.number().int().min(0),
  role: CarouselSlideRoleSchema,
  title: z.string(),
  path: z.string().nullable().default(null),
  // The same render WITHOUT the brand chrome — the plain-download copy. (Until 2026-09-25 the
  // COVER's copy was also the canvas every detail slide was edited from; slides are now each
  // generated fresh, so it is a convenience on every slide.)
  plainPath: z.string().nullable().default(null),
  version: z.number().int().min(0).default(0),
  versions: z.array(CarouselStoredVersionSchema).default([]),
});
export type CarouselStoredSlide = z.infer<typeof CarouselStoredSlideSchema>;

// The DESIGN DIRECTION of one post (content-engine's carousel-design-director.ts, 2026-09-26): the
// fresh social poster's open-ended director, applied at two levels. `brief` is the SERIES look —
// ground, colour roles, typography, panel and imagery treatment — stated identically in every
// slide's prompt, which is what holds the post together. Each slide then gets its OWN direction,
// chosen from that slide's content, for how it presents itself inside that look.
//
// The enum-like fields are plain strings here because their vocabularies live in content-engine
// (DESIGN_FORMS etc.), which apps/web cannot import; the engine parses them tolerantly on read.
// A null slide entry means the director gave that slide nothing usable, and the slide falls back
// to its assigned layout (carousel-layouts.ts) inside the same series look.
export const CarouselSlideDesignSchema = z.object({
  form: z.string(),
  composition: z.string(),
  imagery: z.string(),
  brief: z.string(),
});
export type CarouselSlideDesign = z.infer<typeof CarouselSlideDesignSchema>;

export const CarouselDesignSchema = z.object({
  colourMood: z.string(),
  brief: z.string(),
  slides: z.array(CarouselSlideDesignSchema.nullable()).default([]),
});
export type CarouselDesign = z.infer<typeof CarouselDesignSchema>;

// generations.carousel (jsonb). `requestedSlides` is written at INSERT, so a retry reproduces
// the officer's choice (the style_reference rule); the plan and the slides are written as the
// job produces them. `paletteId` is the ONE colour plan every slide is given (a
// pickSocialPalette id) — with each slide generated fresh, the shared palette is most of what
// holds the post together, so it is assigned once and reused by every later redo.
export const CarouselStateSchema = z.object({
  requestedSlides: CarouselSlideCountSchema.default('auto'),
  // The officer ticked जसाच्या तसा मजकूर: plan by distributing the note's own lines rather than
  // writing slide copy. Written at INSERT with requestedSlides, so a retry plans the same way.
  verbatim: z.boolean().default(false),
  plan: CarouselPlanSchema.nullable().default(null),
  slides: z.array(CarouselStoredSlideSchema).default([]),
  paletteId: z.string().nullable().default(null),
  // Decided once, before the first slide renders, and reused by every single-slide redo so a
  // redrawn slide stays in the post's look; "सर्व स्लाइड पुन्हा" asks for a new one. Null on a
  // carousel made before 2026-09-26, or when the director produced nothing — the prompts then use
  // the planner's `designSystem` and the assigned layouts, exactly as before.
  design: CarouselDesignSchema.nullable().default(null),
});
export type CarouselState = z.infer<typeof CarouselStateSchema>;

// One slide as the detail payload carries it.
export const CarouselSlideDetailSchema = z.object({
  // 1-based, the number the officer sees (१/४) and the address every slide route takes.
  index: z.number().int().min(1),
  role: CarouselSlideRoleSchema,
  title: z.string(),
  posterUrl: z.string().nullable(),
  plainUrl: z.string().nullable(),
  // Every render of this slide, oldest→newest; the last matches `posterUrl`.
  versions: z.array(
    z.object({
      posterUrl: z.string(),
      createdAt: z.string(),
      feedback: z.string().nullable().default(null),
    }),
  ),
});
export type CarouselSlideDetail = z.infer<typeof CarouselSlideDetailSchema>;

// The Marathi label every carousel route answers with when a phase-2 action is asked for.
// Kept here so the publish route, the Canva route and the web agree on one sentence.
export const CAROUSEL_PUBLISH_PENDING_MESSAGE =
  'कॅरोसेल थेट प्रकाशित करण्याची सुविधा लवकरच येत आहे. सध्या प्रत्येक स्लाइड डाउनलोड करून वापरा.';
