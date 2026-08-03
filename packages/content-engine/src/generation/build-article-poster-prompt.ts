// Assemble the gpt-image-2 prompt for the LANDSCAPE article poster (news/scheme runs), and the
// prompt that applies a pixel-feedback edit to an existing one. Pure string assembly, no model
// call — the article twin of build-poster-prompt.ts.
//
// This file replaces the `Build Prompt` Code node that used to live inside the
// `article-poster-v1-api` n8n workflow. Two reasons it moved, both the same as for the social
// path: business logic does not belong in an n8n workflow (AGENTS.md), and the reserved-zone
// geometry must stay in sync with the chrome overlay that stamps those zones
// (poster-renderer/src/article-chrome.ts) — which it cannot do from inside a workflow JSON.
//
// The DEFAULT mode is now 'fresh': the poster is GENERATED from scratch by the API, and the
// selected master is only loose structure inspiration. The 'onbrand' mode (edit the master
// in place through n8n) is kept as a fallback and is what ARTICLE_POSTER_MODE=n8n selects.
//
// Two invariants an article poster has that a social poster does not, asserted throughout:
//   1. ONE headline is the entire text. No kicker, no subhead, no bullets, no statistics.
//   2. The reserved chrome is TOP-LEFT (the महासंवाद logo) plus the bottom strip — so the danger
//      is the headline drifting UP into the logo's rectangle, which is why the zones are stated
//      first, the "erasing branding does not free up space" clause exists, and the whole thing is
//      repeated as a final check. All three were learned from real renders; keep them.

import { pathToFileURL } from 'node:url';
import type { PosterPalette } from './poster-palettes.js';
import type { ArticlePosterLayout } from './article-poster-layouts.js';
import type { ArtDirection } from './art-direction.js';
import { stripColourMentions } from './strip-colour-words.js';
import {
  clearSpaceRule,
  contentInventoryLines,
  DISPLACE_PRESERVE_RULE,
  type ClearAction,
} from './clear-space-rule.js';

// 'fresh' generates the poster from scratch (no n8n); 'onbrand' edits the picked master.
export type ArticleDesignMode = 'fresh' | 'onbrand';

export type BuildArticlePosterPromptInput = Readonly<{
  // The single Marathi headline. On a text-locked run this IS the official name (or the line
  // the officer typed), reproduced verbatim rather than designed.
  headline: string;
  // English background-imagery description (Copy.scene_brief). Ignored when hasPhoto is false.
  sceneBrief?: string | undefined;
  designMode: ArticleDesignMode;
  // The master's public URL. Required for 'onbrand' (there is nothing to edit without it);
  // unused by 'fresh', where the master contributes only its layoutSummary.
  masterUrl?: string | undefined;
  // The master's vision-derived one-liner ('' / undefined = un-analysed → no structure hint). In
  // 'fresh' mode its colour words are STRIPPED before use — see stripColourMentions.
  layoutSummary?: string | undefined;
  // Whether this poster carries a photograph at all.
  hasPhoto: boolean;
  // The assigned colour palette (poster-palettes.ts, rotated per run). AUTHORITATIVE: when
  // present its exact hexes are emitted, never an art director's paraphrase of them.
  assignedPalette?: PosterPalette | undefined;
  // The assigned landscape composition (article-poster-layouts.ts, rotated per run).
  assignedLayout?: ArticlePosterLayout | undefined;
  // The per-run AI visual treatment. Describes HOW the assigned colours/composition are used.
  artDirection?: ArtDirection | undefined;
  // Set when the headline is an EXACT STRING rather than a designed editorial line: either the
  // officer typed the poster text by hand (generations.poster_heading) or
  // resolve-poster-subject.ts established the news's named subject (a scheme, award, campaign,
  // service, portal, project). The poster may then carry NOTHING else.
  textLocked?: boolean | undefined;
}>;

// The colour block. Identical in intent to build-poster-prompt.ts's fmtColourSpec and kept
// deliberately parallel to it: it goes FIRST, it speaks in hex, and it is emitted WHENEVER a
// palette is assigned. The social bug this mirrors was emitting the art director's paraphrase
// INSTEAD of the assignment, which made the whole rotation nearly inert — a paraphrase of "deep
// teal" is something gpt-image-2 will happily brand-correct back to saffron; #0E5C63 is not.
function fmtColourSpec(p: PosterPalette): string {
  return [
    'COLOUR SPECIFICATION — use these EXACT colours. This is a specification, not a suggestion:',
    `- Page background (the whole canvas outside the colour block): ${p.hex.ground}`,
    `- Dominant colour block / panel / band: ${p.hex.panel}`,
    `- Text sitting on the page background: ${p.hex.ink}`,
    // The accent is DELIBERATELY demoted here (unlike the social fmtColourSpec, which keeps it
    // as a general figures/icons/dividers colour). An article poster carries only a headline and
    // imagery — nothing an accent legitimately highlights — so a general-purpose accent colour is
    // an open invitation for the image model to scatter it as ornament, which (the accent being
    // warm in ~2/3 of palettes) came out as stray orange checkmarks, dashed connector lines and
    // panel/photo divider bars in real renders. It stays PRESENT (one layout wants a single bar,
    // and the hex must appear for the harness) but RESTRAINED, and NO_DECORATION backs it up.
    `- Accent — OPTIONAL and RESTRAINED, ${p.hex.accent}. Use it at most ONCE, and only if the composition explicitly calls for a single deliberate structural element (such as a short rule beneath the headline). It is NOT a decoration colour.`,
    `In words: ${p.palette}.`,
    'Do not substitute these values, do not warm them up, and do not "brand-correct" them toward a house style.',
  ].join('\n');
}

// Reinforces the palette against gpt-image-2's "Indian government Marathi poster -> saffron on
// cream" prior. The escape clause keeps it correct when the assigned family IS the house look.
const COLOUR_MANDATE =
  'MANDATORY: the colour specification above is required and must DOMINATE the poster, including the page background. Do NOT fall back to a saffron/orange + cream "government paper" look, and do NOT use a generic government navy-blue-and-white, unless the specification above explicitly calls for those colours.';

// Forbids the specific ornament the image model adds unbidden to an "official" poster: dashed
// connector lines, a tick/check-mark icon, small badges, a coloured divider between the panel and
// the photo. Because the assigned accent is a warm hue in ~2/3 of palettes, that ornament came out
// ORANGE and clashed with an otherwise cool poster — the exact defect this file was changed to
// kill. The failure modes are enumerated by name so the model cannot reintroduce them, and the
// string deliberately contains NO colour word (both so it reads as a design rule, not a palette
// instruction, and so the harness's "no colour word after the structure hint" assertion is safe —
// it is emitted BEFORE that block). A single deliberate accent the composition asks for is still
// allowed, matching the RESTRAINED accent in fmtColourSpec.
const NO_DECORATION =
  'CLEAN COMPOSITION — the poster is built almost entirely from three things: the page background, the dominant colour block, and the Marathi text. Do NOT add decorative or infographic ornament of any kind: no dashed or dotted connector lines, no tick / check-mark icons, no small badges or buttons, no bullet dots, no corner flourishes, no scattered geometric shapes, no ornamental symbols. Where the colour block meets the imagery, the boundary is simply where the two areas meet — do NOT draw a coloured divider line, bar or stripe along it. Add no accent mark unless the composition above explicitly calls for a single deliberate one.';

function fmtArtDirection(ad: ArtDirection): string {
  const lines = ['ART DIRECTION — the intended treatment for this poster:'];
  if (ad.palette) lines.push(`- Colour palette: ${ad.palette}`);
  if (ad.background) lines.push(`- Background handling: ${ad.background}`);
  if (ad.composition) lines.push(`- Composition detail: ${ad.composition}`);
  if (ad.mood) lines.push(`- Mood: ${ad.mood}`);
  // ad.accents is intentionally NOT emitted here. The art director is handed the palette's
  // (often warm) accent hex and duly describes accent decoration — dividers, icons, emphasis —
  // which is exactly what NO_DECORATION forbids on an article poster. generateArtDirection is
  // shared with the social lane and is left untouched; the social prompt (build-poster-prompt.ts)
  // still emits its accents line, because a stats/bullets poster has elements an accent serves.
  return lines.join('\n');
}

function fmtComposition(l: ArticlePosterLayout): string {
  return `COMPOSITION — build the poster to this arrangement: ${l.instruction}`;
}

// Ported byte-for-byte from the workflow's Build Prompt node. Keep the numbers in sync with
// poster-renderer/src/article-chrome.ts and apps/web's ARTICLE_RESERVED_ZONES.
const RESERVED_ZONES =
  'RESERVED ZONES — READ THIS FIRST. Two rectangles of this canvas are already spoken for: the official logo and footer graphics are stamped onto the finished poster afterwards by software, laid OVER whatever you paint there. (a) The TOP-LEFT rectangle from (0,0) to (420,180) — the leftmost ~27% of the width across the topmost ~18% of the height. (b) The FULL-WIDTH BOTTOM strip, approx 150 px tall. Place NO headline, text, letters, numbers, statistics, logos, faces, focal subjects or other important information inside these zones because the software-added branding will cover them. Ordinary background colour, gradients, textures, decorative shapes and non-informational background imagery SHOULD continue naturally through these zones; do not leave them plain, white, empty or cut away solely for the branding.';

const FINAL_CHECK =
  'FINAL CHECK before you output: the top-left 420x180 rectangle and the full-width bottom 150 px strip contain no headline, text, numbers, logos, faces, focal subjects or important information. Normal background colour, gradients, textures, decorative shapes and non-informational background imagery should continue through them without a blank or cut-out patch.';

// The headline-placement rule. The failure it prevents is specific and was seen in real renders:
// told to erase the master's logo, the model treated the freed corner as usable space and floated
// the headline up into it, where the stamped logo then clipped its first line.
const HEADLINE_RULE =
  'The FIRST line of the headline must START BELOW approx 190 px from the top of the canvas, entirely clear of the reserved top-left zone, and must not extend into the bottom strip. If the headline is long, reduce its type size or extend the block DOWNWARD — never upward or leftward into the reserved top-left zone.';

// What a locked-text run adds. The article poster already carries only a headline, so the change
// is not "less text" — it is that the headline must be reproduced as an EXACT STRING rather than
// rendered as a designed line the model may tidy, re-break at its own convenience, abbreviate, or
// "clean up" by dropping a trailing year.
//
// Deliberately does NOT say "scheme": the locked string may be the official name of an award,
// campaign, service, portal or project, or a line the officer typed by hand. Telling the model it
// is looking at a scheme name invites it to "correct" an award name into scheme-shaped wording.
function fmtTextLock(headline: string): string {
  return [
    "TEXT LOCK — the text below is an OFFICIAL NAME, reproduced exactly as given. It is the poster's entire text content.",
    `  «${headline}»`,
    'Reproduce it character for character in Devanagari, including every word, every honorific or personal-name prefix, every punctuation mark, and any year or phase number at the end. Do NOT shorten it, abbreviate it, drop leading or trailing words, translate it, transliterate it, re-spell it, or add words of your own.',
    'Add NOTHING else: no subtitle, no tagline, no summary line, no department name, no date, no English version of the name, no bullet points and no statistics. Set the name across as many lines as it needs and size the type so the WHOLE name fits comfortably inside the safe area.',
  ].join('\n');
}

export function buildArticlePosterPrompt(
  input: BuildArticlePosterPromptInput,
): string {
  const headline = input.headline.trim();
  if (headline.length === 0) {
    throw new Error('buildArticlePosterPrompt: no headline.');
  }
  const sceneBrief = (input.sceneBrief ?? '').trim();
  const layoutSummary = (input.layoutSummary ?? '').trim();
  const masterUrl = (input.masterUrl ?? '').trim();

  if (input.designMode === 'onbrand' && masterUrl.length === 0) {
    throw new Error(
      'buildArticlePosterPrompt: onbrand mode needs a master URL — the enabled article-master catalog is empty.',
    );
  }

  const photoLines = input.hasPhoto
    ? [
        '',
        `IMAGERY — REQUIRED AND VISIBLY PROMINENT. Include a realistic documentary photograph occupying the substantial image area defined by the composition, containing NO text, words, letters, numbers or logos, and never covering the headline: ${sceneBrief || 'a relevant Maharashtra public-welfare documentary scene'}`,
        'Do NOT replace the photograph with an empty colour field, gradient, texture, abstract shapes or extra blank space. If the composition wording permits either imagery or a plain field, choose IMAGERY.',
      ]
    : [
        '',
        'This poster is TEXT-ONLY: build it from typography, flat colour and simple geometric shapes. Do NOT include any photograph, portrait or pictorial illustration anywhere.',
      ];

  // --- fresh: generate the whole poster from scratch -----------------------------------------
  if (input.designMode === 'fresh') {
    const lines = [
      'Design a single, complete LANDSCAPE (3:2, 1536x1024) OFFICIAL DGIPR Maharashtra government ARTICLE poster FROM SCRATCH — an original composition, NOT a copy of any existing template.',
    ];

    // Colour LEADS, and it is the ASSIGNMENT that leads. Both blocks are emitted when both exist:
    // the spec says WHICH colours, the direction says HOW they are used.
    if (input.assignedPalette) {
      lines.push('', fmtColourSpec(input.assignedPalette), '', COLOUR_MANDATE);
      if (input.artDirection)
        lines.push('', fmtArtDirection(input.artDirection));
    } else if (input.artDirection) {
      lines.push('', fmtArtDirection(input.artDirection), '', COLOUR_MANDATE);
    } else {
      lines.push(
        '',
        'Choose an original colour palette suited to the topic and tone — vary it from the usual government navy-blue-and-white and from the saffron-orange + cream look; keep it dignified and legible.',
      );
    }

    if (input.assignedLayout)
      lines.push('', fmtComposition(input.assignedLayout));

    lines.push(
      '',
      NO_DECORATION,
      '',
      'Government public-information aesthetic: bold, high-contrast, highly legible Devanagari (Marathi) typography; a clean, trustworthy, well-organised layout.',
      '',
      RESERVED_ZONES,
    );

    // The master's own description is a SECONDARY hint and its colour words are REMOVED rather
    // than disclaimed — the article master library is as saffron/cream-heavy as the social one,
    // and telling a model to ignore words you have just given it is not a mechanism.
    const structureHint = stripColourMentions(layoutSummary);
    if (structureHint) {
      lines.push(
        '',
        `STRUCTURE INSPIRATION — a reference poster of this kind is built like this. Treat it ONLY as a loose idea of how such a poster is organised; where it conflicts with the COMPOSITION above, the COMPOSITION wins: ${structureHint}`,
      );
    }

    lines.push(
      '',
      'TEXT — the poster carries ONE Marathi headline and no other text of any kind. No kicker, no subhead, no bullet points, no statistics, no quotes, no dates, no captions, no English anywhere. Render it crisply and correctly in Devanagari, spelled EXACTLY as given.',
      `HEADLINE (verbatim, do not translate or alter): ${headline}`,
    );
    if (input.textLocked) lines.push('', fmtTextLock(headline));
    lines.push('', HEADLINE_RULE);

    lines.push(...photoLines);
    lines.push(
      '',
      'Do not paint any logos, emblems, footer bands or social handles — the official branding is stamped on afterwards by software. One poster filling the whole canvas, no outer border.',
      FINAL_CHECK,
    );
    return lines.join('\n');
  }

  // --- onbrand: edit the picked master in place (the legacy path, kept as a fallback) ---------
  const lines = [
    'You are editing an OFFICIAL DGIPR Maharashtra government ARTICLE poster: a single landscape banner on a 1536x1024 canvas.',
    RESERVED_ZONES,
    '',
    "KEEP THIS master template's layout EXACTLY as provided — the same composition, panel shapes, colour zones, decorative elements and arrangement THIS particular master has. Do NOT restructure it toward any other poster layout, do NOT add panels or shapes it does not have, and do NOT remove ones it does have.",
  ];
  if (layoutSummary) {
    lines.push(
      `THIS master's structure, read from the template itself: ${layoutSummary}`,
    );
  }
  lines.push(
    'ERASE the branding chrome the master carries: any महासंवाद logo card in the top-left and any department footer band or social-handle strip along the bottom. Fill those areas by continuing the surrounding panel colour, gradient, texture, decorative background or non-informational part of the photograph naturally, as if that branding was never there. Erasing that branding does NOT free up space for content: do NOT move, enlarge, re-centre or reflow the headline, a face, a focal subject or any important information into those zones. Do NOT leave a quiet, white, empty or cut-out patch solely for the branding.',
    '',
    "REPLACE the master's placeholder content, inside the master's OWN existing zones:",
    '',
    "1) HEADLINE — erase the master's existing main Marathi headline, wherever this master places it, and typeset THIS headline in that same zone, matching the master's headline placement, scale, alignment and weight, spelled EXACTLY as given, in correct Devanagari (Marathi). Large, bold and crisply legible. Also erase any OTHER placeholder Marathi wording the master carries (sub-lines, year badges, old scheme names) — stale placeholder text must not survive. The new headline is the ONLY text you add anywhere on the poster.",
    `HEADLINE (verbatim, do not translate or alter): ${headline}`,
    HEADLINE_RULE,
  );
  if (input.textLocked) lines.push('', fmtTextLock(headline));
  if (input.assignedPalette) {
    lines.push(
      '',
      `2) COLOUR — recolour the poster to the specification below, keeping every shape, size and position exactly as the master has them.`,
      fmtColourSpec(input.assignedPalette),
      COLOUR_MANDATE,
    );
  }
  lines.push(
    '',
    input.hasPhoto
      ? `3) PHOTO — this master has a photo zone. Erase the photograph currently inside it and fill that SAME zone — same shape, same position, same edges — with a NEW realistic documentary photograph matching the description below. Do not move, resize or reshape the zone. The photo must contain NO text, words, letters, numbers or logos.\nPHOTO (imagery only): ${sceneBrief || 'a relevant Maharashtra public-welfare documentary scene'}`
      : "3) NO PHOTOGRAPHY — this master is a text-and-graphics layout with NO photo zone. Do NOT add any photograph, portrait, illustration or pictorial scene anywhere on the poster; keep the master's text-and-graphics structure exactly.",
    '',
    'Add NO other text: no subhead, no bullet points, no statistics, no quotes, no logos of any kind, no captions, and no outer border. Output ONE complete poster filling the whole canvas.',
    FINAL_CHECK,
  );
  return lines.join('\n');
}

export type BuildArticleFeedbackPromptInput = Readonly<{
  imageFeedback: string;
  // 0-3 numbered red markers drawn on the current poster (annotated pixel feedback).
  markerCount?: number | undefined;
  // The lettered BLUE rectangles, in draw order (matching their A/B badges), each
  // saying what happens to the content inside: 'remove' deletes it and moves nothing
  // else, 'displace' keeps it on the poster and licenses a re-layout. Independent of
  // markerCount. Empty/absent = the pre-feature prompt, byte-for-byte.
  clearActions?: readonly ClearAction[] | undefined;
  // What the vision pass read off the CURRENT poster: the checklist a displace
  // re-layout must not lose. Only emitted when a displace box is present.
  contentInventory?: readonly string[] | undefined;
}>;

// The prompt that edits an EXISTING article poster to apply a requested visual change. Ported
// VERBATIM from the workflow's Build Prompt node, including the marker_count branch, so annotated
// and plain-text feedback both behave exactly as they did before this moved into code.
export function buildArticleFeedbackPrompt(
  input: BuildArticleFeedbackPromptInput,
): string {
  const imageFeedback = input.imageFeedback.trim();
  const markerCount = Math.max(
    0,
    Math.min(3, Math.trunc(Number(input.markerCount) || 0)),
  );
  const clear = clearSpaceRule(input.clearActions ?? []);
  // A clear-space round is a complete request on its own — the blue rectangles say
  // what to do and the note is optional — so text is required only without them.
  if (imageFeedback.length === 0 && clear.count === 0)
    throw new Error('No image feedback provided.');
  const inventory = clear.hasDisplace
    ? contentInventoryLines(input.contentInventory)
    : [];

  const reservedZones =
    'RESERVED ZONES: the महासंवाद logo in the top-left (approx 420x180 px) and the footer strip along the bottom (full width, approx 150 px tall) are official branding stamped onto the poster by software — do NOT alter, move, redraw or remove them, and do NOT move any text or important content into those areas.';

  // A DISPLACE round cannot keep the exact layout — that is the point of it — so the
  // keep-layout rule is REPLACED rather than hedged with an "except…" clause the
  // absolute-sounding half of the sentence would win against. DELETE-only keeps it.
  const exceptClause =
    clear.count > 0 ? ' or the SPACE TO FREE block below' : '';
  const keepRule = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, the poster's existing panels and accent shapes, existing Marathi headline text, colours, typography, and any photograph unchanged except where the requested change${exceptClause} explicitly requires it.`;
  const keepRuleMarker = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, the poster's existing panels and accent shapes, existing Marathi headline text, colours, typography, and any photograph unchanged except where a requested change${exceptClause} explicitly requires it.`;
  const textException =
    clear.count > 0 ? ', except as the SPACE TO FREE block requires' : '';

  if (markerCount > 0) {
    return [
      'You are editing an existing finished DGIPR Maharashtra government ARTICLE poster provided as the input image.',
      `The input image carries ${markerCount} numbered red annotation marker(s): thin red outline rectangles, each with a small red circular badge showing its number. They were drawn onto the poster by editing software and are NOT part of the poster design.`,
      'Each marker is a pointing gesture showing where one requested change applies — not a hard boundary. For each marker, identify the design element at or around that spot and apply the correspondingly numbered change from the request below to that WHOLE element, even where the element extends beyond the rectangle.',
      `REQUESTED CHANGES: «${imageFeedback}».`,
      `Make ONLY these changes. ${keepRuleMarker}`,
      'ERASE every red marker rectangle and numbered badge completely from the output, restoring whatever they overlapped — no red outlines, red circles, or annotation numbers may remain anywhere on the poster.',
      reservedZones,
      `Add no new text, letters, numbers, captions, logos, borders, or decorative elements beyond the requested changes. Preserve all other existing Devanagari text exactly${textException}. Output ONE complete landscape poster filling the canvas.`,
      ...inventory,
      ...clear.lines,
    ].join('\n');
  }

  return [
    'You are editing an existing finished DGIPR Maharashtra government ARTICLE poster provided as the input image.',
    ...(imageFeedback.length > 0
      ? [`Apply ONLY this requested change: «${imageFeedback}».`]
      : []),
    keepRule,
    reservedZones,
    `Add no new text, letters, numbers, captions, logos, borders, or decorative elements. Preserve all existing Devanagari text exactly${textException}. Output ONE complete landscape poster filling the canvas.`,
    ...inventory,
    ...clear.lines,
  ].join('\n');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/build-article-poster-prompt.ts
// Prints the assembled 'fresh' prompt for two differently-assigned runs plus a scheme-locked one,
// and asserts the properties the diversity fix and the scheme rule depend on. Pure string
// assembly — no model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const HEADLINE = 'चार प्राथमिक आरोग्य केंद्रांचे उन्नतीकरण';
  const SCHEME = 'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना २०२६';
  const SCENE =
    'A rural primary health centre with staff attending to visitors in daylight.';
  // A master summary in the shape analyze-template.ts really produces — colour theme and all.
  const MASTER_SUMMARY =
    'A bold headline on a curved orange side panel with a large photograph filling the right. The dominant colour theme is warm saffron, cream and maroon.';

  const failures: string[] = [];
  const { pickPalette } = await import('./poster-palettes.js');
  const { pickArticleLayout } = await import('./article-poster-layouts.js');

  for (const seed of ['run-alpha', 'run-beta']) {
    const palette = pickPalette(seed);
    const layout = pickArticleLayout(seed, { hasPhoto: true });
    const prompt = buildArticlePosterPrompt({
      headline: HEADLINE,
      sceneBrief: SCENE,
      designMode: 'fresh',
      layoutSummary: MASTER_SUMMARY,
      hasPhoto: true,
      assignedPalette: palette,
      assignedLayout: layout,
      artDirection: {
        palette: '',
        background:
          'a flat ground with a single crisp colour block, no gradients',
        composition:
          'the headline set tight, left-aligned, with wide outer margins',
        mood: 'calm, clinical, reassuring',
        accents: 'thin rules and simple geometry, one emphasis only',
      },
    });

    console.log(
      `\n${'='.repeat(78)}\nseed ${seed} · ${palette.id} (${palette.family}) · ${layout.id}\n${'='.repeat(78)}\n${prompt}`,
    );

    // 1. The assigned hexes must be present — the bug that made the social rotation inert.
    for (const hex of [
      palette.hex.ground,
      palette.hex.panel,
      palette.hex.ink,
      palette.hex.accent,
    ]) {
      if (!prompt.includes(hex))
        failures.push(`${seed}: assigned hex ${hex} missing`);
    }
    // 2. The colour spec must LEAD — before any art direction.
    const specAt = prompt.indexOf('COLOUR SPECIFICATION');
    const adAt = prompt.indexOf('ART DIRECTION');
    if (specAt === -1) failures.push(`${seed}: no COLOUR SPECIFICATION block`);
    if (adAt !== -1 && specAt > adAt) {
      failures.push(`${seed}: art direction precedes the colour spec`);
    }
    // 3. The assigned composition must precede the master's structure hint (it outranks it).
    const compAt = prompt.indexOf('COMPOSITION —');
    const structAt = prompt.indexOf('STRUCTURE INSPIRATION');
    if (compAt === -1) failures.push(`${seed}: no COMPOSITION block`);
    if (structAt !== -1 && compAt > structAt) {
      failures.push(`${seed}: structure hint precedes the composition`);
    }
    // 4. NO colour word from the master's summary may survive into the structure hint.
    if (structAt !== -1) {
      const hint = prompt.slice(structAt);
      for (const word of ['saffron', 'cream', 'maroon', 'orange']) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(hint)) {
          failures.push(
            `${seed}: master colour word "${word}" leaked into the hint`,
          );
        }
      }
    }
    // 5. Reserved zones stated first AND repeated as a final check.
    if (prompt.indexOf('RESERVED ZONES') === -1)
      failures.push(`${seed}: no reserved zones`);
    if (!prompt.includes('FINAL CHECK'))
      failures.push(`${seed}: no final check`);
    // 6. An ordinary run carries NO text lock.
    if (prompt.includes('TEXT LOCK'))
      failures.push(`${seed}: unexpected TEXT LOCK`);
    // 7. The one-headline rule is stated.
    if (!prompt.includes('no other text of any kind')) {
      failures.push(`${seed}: the headline-only rule is missing`);
    }
    // 8. Photo-bearing article posters explicitly reject the empty colour-field failure mode.
    if (
      !prompt.includes('REQUIRED AND VISIBLY PROMINENT') ||
      !prompt.includes(
        'Do NOT replace the photograph with an empty colour field',
      )
    ) {
      failures.push(`${seed}: the required-imagery guard is missing`);
    }
    // 9. The no-decoration rule is present (the fix for stray orange accents).
    if (!prompt.includes('CLEAN COMPOSITION')) {
      failures.push(
        `${seed}: the CLEAN COMPOSITION / no-decoration rule is missing`,
      );
    }
    if (!prompt.includes('no dashed or dotted connector lines')) {
      failures.push(
        `${seed}: the decoration ban does not enumerate the failure modes`,
      );
    }
    // 10. The accent is demoted to RESTRAINED — never the old general-purpose framing.
    if (!prompt.includes('Accent — OPTIONAL and RESTRAINED')) {
      failures.push(
        `${seed}: the accent is not marked OPTIONAL and RESTRAINED`,
      );
    }
    if (prompt.includes('Accent for rules, shapes and emphasis')) {
      failures.push(`${seed}: the old general-purpose accent framing survived`);
    }
    // 11. The art-direction block no longer feeds accent decoration back in. This seed passes
    //     an `accents` art-direction field, so a regression would surface here.
    if (prompt.includes('Panels / shapes / accents')) {
      failures.push(`${seed}: the art-direction accents line was re-emitted`);
    }
  }

  // 12. A scheme-locked run: the lock appears, and the FULL name (year included) is in it.
  {
    const palette = pickPalette('scheme-run');
    const layout = pickArticleLayout('scheme-run', { hasPhoto: true });
    const prompt = buildArticlePosterPrompt({
      headline: SCHEME,
      sceneBrief: SCENE,
      designMode: 'fresh',
      layoutSummary: MASTER_SUMMARY,
      hasPhoto: true,
      assignedPalette: palette,
      assignedLayout: layout,
      textLocked: true,
    });
    console.log(
      `\n${'='.repeat(78)}\nscheme-locked run\n${'='.repeat(78)}\n${prompt}`,
    );
    if (!prompt.includes('TEXT LOCK'))
      failures.push('scheme run: no TEXT LOCK block');
    if (!prompt.includes(SCHEME))
      failures.push('scheme run: full scheme name missing');
    if (!prompt.includes('२०२६'))
      failures.push('scheme run: the year was dropped');
    if (!prompt.includes('no subtitle')) {
      failures.push('scheme run: the "nothing else" rule is missing');
    }
  }

  // 13. A text-only run must forbid imagery and must never be handed a photo-required layout.
  {
    const layout = pickArticleLayout('text-only', { hasPhoto: false });
    if (layout.photo === 'required') {
      failures.push('text-only run was assigned a photo-required layout');
    }
    const prompt = buildArticlePosterPrompt({
      headline: HEADLINE,
      designMode: 'fresh',
      hasPhoto: false,
      assignedPalette: pickPalette('text-only'),
      assignedLayout: layout,
    });
    if (!prompt.includes('TEXT-ONLY'))
      failures.push('text-only run: no imagery lock');
  }

  // 14. onbrand without a master must fail loudly rather than edit nothing.
  {
    let threw = false;
    try {
      buildArticlePosterPrompt({
        headline: HEADLINE,
        designMode: 'onbrand',
        hasPhoto: true,
      });
    } catch {
      threw = true;
    }
    if (!threw) failures.push('onbrand with no master URL did not throw');
  }

  // 15. Feedback prompts: marker branch mentions the count and the erase rule; plain branch does
  //     not mention markers at all (the legacy prompt, byte-for-byte).
  {
    const marked = buildArticleFeedbackPrompt({
      imageFeedback: 'शीर्षक मोठे करा',
      markerCount: 2,
    });
    if (!marked.includes('2 numbered red annotation marker')) {
      failures.push('marker feedback prompt lost its count');
    }
    if (!marked.includes('ERASE every red marker')) {
      failures.push('marker feedback prompt lost the erase rule');
    }
    const plain = buildArticleFeedbackPrompt({
      imageFeedback: 'शीर्षक मोठे करा',
    });
    if (plain.includes('marker'))
      failures.push('plain feedback prompt mentions markers');
    if (!plain.includes('RESERVED ZONES')) {
      failures.push('plain feedback prompt lost the reserved zones');
    }
    if (/blue/i.test(plain))
      failures.push('plain feedback prompt mentions blue clear boxes');

    // The clear-space (blue box) path — the article twin of the social assertions.
    if (!plain.includes('Keep the exact layout'))
      failures.push('plain feedback prompt lost its keep-layout rule');

    const cleared = buildArticleFeedbackPrompt({
      imageFeedback: '',
      clearActions: ['displace'],
      contentInventory: ['मुख्यमंत्री देवेंद्र फडणवीस'],
    });
    for (const needle of [
      'SPACE TO FREE',
      '1 translucent BLUE rectangle',
      '(A)',
      'MOVE — blue box A',
      'TARGET AREA',
      'least disruptive complete-group movement',
      'Do not perform the move twice',
      'Preserve the original number of copies',
      'do NOT add another copy anywhere else',
      'PLAIN EMPTY BACKGROUND',
      'ERASE the blue rectangles',
      'RESERVED ZONES',
      'INFORMATION THAT MUST SURVIVE — 1 item(s)',
      'मुख्यमंत्री देवेंद्र फडणवीस',
    ]) {
      if (!cleared.includes(needle))
        failures.push(`clear-space prompt lost "${needle}"`);
    }
    if (cleared.includes('Apply ONLY this requested change'))
      failures.push('clear-space-only prompt invented a requested change');
    if (cleared.indexOf('SPACE TO FREE:') < cleared.indexOf('RESERVED ZONES'))
      failures.push('clear rule precedes the reserved zones it refers to');
    // THE regression this change exists to prevent: a displace must not also be told
    // to keep the exact layout.
    if (cleared.includes('Keep the exact layout'))
      failures.push('displace round kept the contradictory keep-layout rule');
    if (!cleared.includes('INFORMATION and ELEMENT COUNTS are fixed'))
      failures.push('displace round lost the exact-multiplicity replacement');
    if (!cleared.includes('keeping every child icon, text block and image attached'))
      failures.push('displace round lost the parent-child preservation rule');
    if (cleared.includes('visibly rearranged poster is a CORRECT result'))
      failures.push('displace round kept the over-broad visible-redesign instruction');
    if (!cleared.trimEnd().endsWith('may remain anywhere on the poster.'))
      failures.push('clear rule is not the last block of the prompt');

    // DELETE-only: the frozen-layout rule is correct there and must survive, and no
    // displace wording or inventory may leak in.
    const removeOnly = buildArticleFeedbackPrompt({
      imageFeedback: '',
      clearActions: ['remove'],
      contentInventory: ['मुख्यमंत्री देवेंद्र फडणवीस'],
    });
    if (!removeOnly.includes('Keep the exact layout'))
      failures.push('remove-only round dropped the keep-layout rule');
    if (!removeOnly.includes('or the SPACE TO FREE block below'))
      failures.push('remove-only round lost the keep-layout exception');
    if (removeOnly.includes('MOVE — blue box'))
      failures.push('remove-only round leaked the displace block');
    if (removeOnly.includes('INFORMATION THAT MUST SURVIVE'))
      failures.push('remove-only round emitted an inventory');

    const both = buildArticleFeedbackPrompt({
      imageFeedback: 'शीर्षक मोठे करा',
      markerCount: 2,
      clearActions: ['displace', 'remove'],
    });
    if (!both.includes('2 numbered red annotation marker'))
      failures.push('combined prompt lost the marker count');
    if (!both.includes('2 translucent BLUE rectangle'))
      failures.push('combined prompt lost the clear count');
    if (!both.includes('MOVE — blue box A') || !both.includes('DELETE — blue box B'))
      failures.push('combined prompt lost a per-letter action block');
    if (both.includes('Keep the exact layout'))
      failures.push('combined displace prompt kept the keep-layout rule');

    let threw = false;
    try {
      buildArticleFeedbackPrompt({ imageFeedback: '   ' });
    } catch {
      threw = true;
    }
    if (!threw)
      failures.push('empty feedback with no clear boxes was accepted');
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll article prompt-assembly assertions passed.');
  }
}
