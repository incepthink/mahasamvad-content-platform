// Assemble the gpt-image-2 prompt that edits a master template into a finished social poster,
// and the prompt that applies a pixel-feedback edit to an existing poster. Pure string
// assembly, no model call — ported verbatim from the n8n `Build Image Prompt` and
// `Build Feedback Prompt` nodes so the rendered posters do not change, and moved into code so
// the reserved-zone geometry lives beside the chrome overlays it must stay in sync with
// (twitter-chrome.ts / cmo-geometry.ts).

import { pathToFileURL } from 'node:url';
import type { PosterCopy, TemplateBrand } from './generate-poster-copy.js';
import type { ArtDirection } from './art-direction.js';
import type { PosterPalette } from './poster-palettes.js';
import type { PosterLayout } from './poster-layouts.js';
import { stripColourMentions } from './strip-colour-words.js';
import {
  clearSpaceRule,
  contentInventoryLines,
  DISPLACE_PRESERVE_RULE,
  type ClearAction,
} from './clear-space-rule.js';

export type DesignMode = 'fresh' | 'adaptive' | 'onbrand';

export type BuildPosterPromptInput = Readonly<{
  copy: PosterCopy;
  // The officer's information, VERBATIM. In social DGIPR 'onbrand' mode this is passed to the
  // image model with the reference image; no generated poster-copy or design rules are added.
  //
  // On that path this string is not a "note about" the poster — it IS the poster's content, and
  // every item of it must appear. See the onbrand branch below.
  information?: string | undefined;
  // How many distinct items `information` contains, counted by the reference selector
  // (select-by-information.ts). Stated to the image model so "show all of it" is a number it
  // can check its own output against rather than a sentiment.
  itemCount?: number | undefined;
  // Set only when NO reference in the library can show that many items. The model is then told
  // to extend the reference's item pattern — explicitly, because its default response to too
  // much content is to drop some, which is the failure this whole path exists to prevent.
  slotShortfall?: { needed: number; available: number } | undefined;
  copyStyle: string;
  designMode: DesignMode;
  brand: TemplateBrand;
  // The master to edit (the chosen library image's public URL). Empty is only valid for
  // design_mode 'fresh', which paints from scratch.
  masterUrl: string;
  // The chosen master's vision-derived one-liner ('' = un-analysed → generic prompt). In
  // 'fresh' mode this is loose STRUCTURE inspiration (which sections a poster like this has),
  // never colours to copy — the art direction owns the palette.
  layoutSummary?: string | undefined;
  hasPhoto: boolean;
  // The per-run AI-chosen visual treatment (art-direction.ts). Applied in 'fresh' mode so the
  // fully-AI-generated poster looks different every render. Absent = render from the assignment
  // alone, which is deliberately sufficient — see fmtColourSpec.
  artDirection?: ArtDirection | undefined;
  // The colour family this run is anchored to (poster-palettes.ts, rotated per run). In 'fresh'
  // mode this is the AUTHORITATIVE colour source and is always emitted when present — art
  // direction describes how the colours are used, never which they are.
  assignedPalette?: PosterPalette | undefined;
  // The composition archetype this run is anchored to (poster-layouts.ts, rotated per run).
  // Emitted in 'fresh' mode above the master's structure hint, which it outranks.
  assignedLayout?: PosterLayout | undefined;
}>;

// The colour block. This is the load-bearing part of the whole diversity fix, so it goes FIRST in
// the prompt and it speaks in hex.
//
// The bug this replaces: art direction was emitted INSTEAD of the assignment whenever it
// succeeded (which is almost always), so the palette the rotation had carefully chosen reached
// the image model only as an art director's paraphrase — and a paraphrase of "deep teal" is
// something gpt-image-2 will happily brand-correct back to saffron. Exact hex values are not
// negotiable in the same way; the model either matches #0E5C63 or it does not, which is also
// what makes the rendered result measurable afterwards (poster-colours.ts).
function fmtColourSpec(p: PosterPalette): string {
  return [
    'COLOUR SPECIFICATION — use these EXACT colours. This is a specification, not a suggestion:',
    `- Page background (the whole canvas outside the colour block): ${p.hex.ground}`,
    `- Dominant colour block / band / column: ${p.hex.panel}`,
    `- Body text sitting on the page background: ${p.hex.ink}`,
    `- Accent for figures, icons, dividers and emphasis: ${p.hex.accent}`,
    `In words: ${p.palette}.`,
    'Do not substitute these values, do not warm them up, and do not "brand-correct" them toward a house style.',
  ].join('\n');
}

// The art director's treatment — HOW the assigned colours and composition are handled. Kept here
// (rather than in art-direction.ts) so all image-prompt string assembly lives in one file. The
// `palette` line only appears on the legacy un-assigned path, where colour really was its call.
function fmtArtDirection(ad: ArtDirection): string {
  const lines = ['ART DIRECTION — the intended treatment for this poster:'];
  if (ad.palette) lines.push(`- Colour palette: ${ad.palette}`);
  if (ad.background) lines.push(`- Background handling: ${ad.background}`);
  if (ad.composition) lines.push(`- Composition detail: ${ad.composition}`);
  if (ad.mood) lines.push(`- Mood: ${ad.mood}`);
  if (ad.accents)
    lines.push(`- Panels / cards / icons / accents: ${ad.accents}`);
  return lines.join('\n');
}

// The assigned composition archetype. Emitted above the master's structure hint because it
// OUTRANKS it: the master is topic-matched, so leaving it in charge of structure is what made
// two differently-coloured posters still read as the same poster.
function fmtComposition(l: PosterLayout): string {
  return `COMPOSITION — build the poster to this arrangement: ${l.instruction}`;
}

// Reinforces the palette against gpt-image-2's strong "Indian government Marathi poster ->
// saffron/cream" prior. Appended whenever a palette is present; the "unless the specification
// above explicitly calls for" clause keeps it correct when the assigned family IS the
// saffron/cream brand look (its one rotation slot in eighteen).
const COLOUR_MANDATE =
  'MANDATORY: the colour specification above is required and must DOMINATE the poster, including the page background. Do NOT fall back to a saffron/orange + cream "government paper" look, and do NOT use a generic government navy-blue-and-white, unless the specification above explicitly calls for those colours.';

// Keep the reserved-zone numbers in sync with packages/poster-renderer/src/twitter-chrome.ts.
const CHROME_ZONES =
  'RESERVED ZONES — the official branding is stamped onto the finished poster afterwards by software: the top-right corner (approx 280x270 px; a white rounded-square महाराष्ट्र शासन emblem-and-wordmark badge) and the full-width bottom strip (approx 130 px tall; the department footer band and social-handle strip). Place NO text, numbers, statistics, logos, emblems, faces, focal subjects or other important information inside these zones because the software-added branding will cover them. Ordinary background colour, gradients, textures, decorative shapes and non-informational background imagery SHOULD continue naturally through these zones; do not leave them plain or empty solely for the branding.';

const PLACEHOLDER_WITH_PHOTO =
  'The master template you are editing still carries PLACEHOLDER content from a previous poster: sample Marathi text in every text zone (headline, tag, bullets, figures, dates) and a sample photo/illustration in the image zone. NONE of that content relates to this poster. ERASE every piece of existing sample text and ERASE the existing photo/illustration completely before adding the new content — no word, number, person, or pictorial element from the placeholder may survive into the output. ALSO ERASE the branding chrome the master carries: the महाराष्ट्र शासन emblem-and-wordmark lockup in the top-right and the department footer band + social-handle strip along the bottom — fill those areas by continuing the surrounding colour band or background naturally, as if that branding was never there. Only the layout frame stays: colour bands and panel shapes.';
const PLACEHOLDER_TEXT_ONLY =
  'The master template you are editing still carries PLACEHOLDER text from a previous poster in every text zone (headline, tag, cards, bullets, figures, dates). NONE of that wording relates to this poster. ERASE every piece of existing sample text before adding the new content — no word or number from the placeholder may survive into the output. ALSO ERASE the branding chrome the master carries: the महाराष्ट्र शासन emblem-and-wordmark lockup in the top-right and the department footer band + social-handle strip along the bottom — fill those areas by continuing the surrounding colour band or background naturally, as if that branding was never there. Everything else stays exactly as it is: colour bands, card shapes, icons, and the existing background.';
const TEXT_ONLY_LOCK =
  "THIS MASTER IS A TEXT-ONLY TEMPLATE: it has NO photograph, NO portrait and NO illustration zone. Do NOT add any photograph, person, hero image, or pictorial subject anywhere on the poster. Keep the master's existing background exactly as it is (including any faded or ghosted backdrop wash) and keep its existing icons, symbols and card shapes. The ONLY things you change are the Marathi text inside the existing text zones and the branding-chrome erasure described above.";

function fmtBullets(arr: unknown): string {
  const items = Array.isArray(arr) ? arr : [];
  return items
    .map((b, i) => {
      const bullet = b as { text?: string; emphasis?: unknown[] };
      const e = (Array.isArray(bullet.emphasis) ? bullet.emphasis : []).filter(
        Boolean,
      );
      return `  ${i + 1}. ${bullet.text ?? ''}${e.length ? `  [emphasise: ${e.join(' | ')}]` : ''}`;
    })
    .join('\n');
}

// Render the copy object into the layout instruction block. Dispatches on copy_style (not the
// type slug), so custom types render with the generic headline + points layout.
function buildChange(copyStyle: string, c: PosterCopy): string {
  const get = <T>(k: string): T => c[k] as T;
  let lines: string[];
  if (copyStyle === 'alert') {
    lines = [
      `KICKER (small alert tag near the top): ${get<string>('kicker')}`,
      `HEADLINE (largest text block): ${get<string>('headline')}`,
      `SUBHEAD (line under the headline): ${get<string>('subhead')}`,
      'BULLET POINTS (exactly 3, in the body list zone):',
      fmtBullets(get('bullets')),
    ];
  } else if (copyStyle === 'campaign') {
    const sch =
      (get<Record<string, string>>('schedule') as Record<string, string>) || {};
    const stats = Array.isArray(get('stats'))
      ? (get('stats') as Record<string, string>[])
      : [];
    lines = [
      `KICKER (small tag near the top): ${get<string>('kicker')}`,
      `HEADLINE (largest block, the campaign name): ${get<string>('headline')}`,
      `SUBHEAD: ${get<string>('subhead')}`,
      `DATE: ${sch.date || ''}`,
      `TIME: ${sch.time || ''}`,
      `AUDIENCE / ELIGIBILITY: ${get<string>('audience') || ''}`,
      `CALL TO ACTION (make it prominent): ${get<string>('cta') || ''}`,
      'STAT CALLOUTS (each as icon + figure + label):',
      stats
        .map(
          (s, i) =>
            `  ${i + 1}. ${s.value} — ${s.label}  [icon: ${s.icon_hint}]`,
        )
        .join('\n'),
    ];
  } else if (copyStyle === 'quote') {
    const at =
      (get<Record<string, string>>('attribution') as Record<string, string>) ||
      {};
    const points = Array.isArray(get('points'))
      ? (get('points') as Record<string, string>[])
      : [];
    lines = [
      `TOPIC LABEL (small tag near the top): ${get<string>('topic_label')}`,
      `HEADLINE (subject line): ${get<string>('headline')}`,
      `QUOTE (main text, inside large quotation marks): ${get<string>('quote_text')}`,
      `ATTRIBUTION (name then designation): ${at.name || ''}, ${at.title || ''}`,
      'SUPPORTING POINTS (each as icon + text):',
      points
        .map((p, i) => `  ${i + 1}. ${p.text}  [icon: ${p.icon_hint}]`)
        .join('\n'),
    ];
  } else if (copyStyle === 'timeline') {
    const milestones = Array.isArray(get('milestones'))
      ? (get('milestones') as Record<string, string>[])
      : [];
    lines = [
      `SIDE LABEL (bold side/left emphasis text): ${get<string>('side_label') || ''}`,
      `HEADLINE (top): ${get<string>('headline')}`,
      `INTRO: ${get<string>('intro') || ''}`,
      'TIMELINE MILESTONES (dated, top to bottom):',
      milestones.map((m, i) => `  ${i + 1}. [${m.date}] ${m.text}`).join('\n'),
    ];
  } else {
    // info_bullets and generic share the headline + points layout.
    lines = [
      `KICKER (small tag): ${get<string>('kicker')}`,
      `HEADLINE (largest block): ${get<string>('headline')}`,
      `SUBHEAD: ${get<string>('subhead')}`,
      'BULLET POINTS (in the body list zone):',
      fmtBullets(get('bullets')),
    ];
  }
  return lines.join('\n');
}

// Keep the reserved-zone numbers in sync with packages/poster-renderer/src/cmo-geometry.ts.
const CMO_ZONES =
  'RESERVED ZONES — official CMO branding AND the photograph are stamped onto the finished poster afterwards by software, so keep them clear: (1) the TOP HEADER BAND — the full-width blue leader lockup with the three leaders and the महाराष्ट्र शासन emblem — occupies the TOP ~19% of the poster height; place NO headline, text, figures, faces or logos inside that band, and START the headline BELOW it. (2) the full-width BOTTOM ~8% strip (the footer and social-handle band); place nothing there. (3) the UPPER-RIGHT PHOTO CIRCLE — the round photo window in the upper-right area — is filled with a photograph by software afterwards; leave it a QUIET, PLAIN background (a soft solid colour or a gentle continuation of the design), place NO text, faces, subjects or important content inside it, and do NOT draw any circle, ring, border or outline there. The left-column headline and the body points must NOT overlap that circle. FINAL CHECK before finishing: nothing important may sit inside the top ~19% header band, the bottom ~8% footer strip, or the upper-right photo circle.';

// The prompt that edits the master into a finished poster. Throws if a non-fresh render has
// no master URL (the workflow used to fail loudly on the same condition).
export function buildPosterPrompt(input: BuildPosterPromptInput): string {
  const { copy, copyStyle, brand, hasPhoto } = input;
  const designMode = input.designMode;
  const masterFile = (input.masterUrl ?? '').trim();
  const layoutSummary = (input.layoutSummary ?? '').trim();
  if (designMode !== 'fresh' && brand !== 'cmo' && !masterFile) {
    throw new Error(
      `No master URL for copy_style "${copyStyle}" — the enabled-image catalog is empty.`,
    );
  }

  const change = buildChange(copyStyle, copy);
  const sceneBrief =
    typeof copy.scene_brief === 'string' ? copy.scene_brief : '';

  if (brand === 'cmo') {
    return [
      'You are editing a master template for an OFFICIAL मंत्रिमंडळ निर्णय (Cabinet Decision) poster of the Chief Minister Office, Government of Maharashtra.',
      'KEEP the master template overall layout, proportions, colour bands and safe margins EXACTLY as in the provided image.',
      'The master carries PLACEHOLDER content from a previous decision: sample Marathi text (headline, numbered points, date, department name) and sample photographs in the upper-right circle area. NONE of it relates to this poster. ERASE every piece of that sample text, and CLEAR the upper-right circle area to a quiet, plain background — the real photograph is placed there by software afterwards.',
      CMO_ZONES,
      'Single 4:5 portrait poster. Typography: bold, high-contrast, highly legible Devanagari (Marathi). Serious, trustworthy government-notice aesthetic. Keep the HEADLINE modest — at most about two lines, clearly smaller than a full-bleed banner — and set the numbered points COMPACT but clearly legible. Size the text so that ALL of the points fit comfortably in the body area BELOW the header band without spilling into the header or the footer; do NOT enlarge a short headline to fill empty space.',
      'Render ALL Marathi text crisply and correctly in Devanagari, spelled exactly as below.',
      '',
      'REPLACE the editable content with the following, fitting the existing text zones of the master:',
      '',
      change,
      '',
      'Do not add any English body text. Do not repaint the leader header band, the emblem, the footer, or paint any photograph, frame, ring or border in the upper-right circle — that branding and the photograph are stamped on afterwards by software. Keep one single poster within the canvas, no outer borders.',
    ].join('\n');
  }

  if (designMode === 'onbrand' && input.information !== undefined) {
    const information = input.information.trim();
    const itemCount = input.itemCount;
    const shortfall = input.slotShortfall;

    // COMPLETENESS. The officer's text is the poster's content, not source material to edit
    // down — so the two clauses that used to sit at the end of this prompt ("never paste the
    // entire input article", "select only the most important information") are gone: they were
    // an instruction to drop the officer's own points, and a seven-point note was coming back
    // as a four-point poster. The reference is now chosen for its capacity to hold every item
    // (select-by-information.ts), so "show all of it" is a request the layout can honour.
    const completeness = [
      'SHOW ALL OF THE INFORMATION. Every distinct point, instruction, measure, figure and fact in the supplied information must appear on the poster. Do not omit any of it, do not summarise it, and do not merge two points into one because the layout feels tight. If space is short, reduce type size, tighten spacing, or use more of the canvas — never drop content.',
    ];
    if (typeof itemCount === 'number' && itemCount > 0) {
      completeness.push(
        `The supplied information contains ${itemCount} distinct item(s). The finished poster must show all ${itemCount}. Count them in your output before finishing.`,
      );
    }
    if (shortfall) {
      completeness.push(
        `IMPORTANT: the reference image lays out about ${shortfall.available} item(s), but there are ${shortfall.needed} to show. EXTEND the reference's item pattern — repeat its rows/cards to the number needed, keeping their styling, alignment and spacing consistent, and shrink them proportionally so all ${shortfall.needed} fit within the usable canvas. Adding rows in the reference's own style is correct here; dropping items is not.`,
      );
    }

    return [
      'Using the given reference image, generate an image for this information:',
      '',
      information,
      '',
      ...completeness,
      // TEXT FIDELITY. The officer's requirement is that not one character or matra is
      // misplaced, and Marathi is unforgiving here: a misplaced matra or a broken conjunct
      // changes or destroys the word. This is the strongest instruction the prompt can give —
      // note that it is an instruction, not a guarantee. The repo's poster doctrine (paint no
      // text; typeset Devanagari with Chromium) is what would make it a guarantee, and this
      // template-editing path deliberately trades that away for design fidelity.
      'REPRODUCE THE MARATHI TEXT EXACTLY. Copy every word character for character from the supplied information: every Devanagari letter, every matra and vowel sign, every conjunct (जोडाक्षर), every anusvara and every numeral, exactly as written and in the same order. Do not re-spell, re-word, translate, transliterate, correct, abbreviate, or "improve" any word. Do not drop or reposition a matra. Do not break a conjunct into separate letters. Marathi words rendered with a misplaced or missing matra are wrong even if they look plausible — re-read each word against the supplied text before finishing.',
      "MAKE THE DESIGN SUIT THE MESSAGE. Judge from the supplied information what kind of poster this is — a public warning, a health advisory, a scheme launch, an achievement, an invitation, a deadline — and make the finished poster read unmistakably as that kind of poster through its colour choice, imagery and emphasis. Take this from the INFORMATION, never from whatever the reference image happens to be about: the reference's own topic is unrelated placeholder content.",
      "Use the provided reference image as the AUTHORITATIVE VISUAL STRUCTURE for the poster. Preserve its overall composition, section placement, proportions, content distribution, imagery zones, visual balance, and density while replacing its information. STRUCTURE means only geometry and visual hierarchy—not the meaning, factual content, or element type of any reference slot. Do not redesign the structure, compress everything onto one side, or leave large blank or unused areas. Fill the usable canvas as efficiently as the reference image does.",
      "The reference image controls STRUCTURE ONLY, not colour. Choose the poster's colour palette freely and creatively; ensure strong contrast and easy readability for every Marathi word and Devanagari numeral.",
      "REFERENCE-CONTENT FIREWALL: treat every word, numeral, date, year, URL, domain, app name, contact detail, identifier, logo, emblem, QR code, barcode, and factual claim visible in the reference image as unrelated placeholder content. Copy NONE of it. Every textual, numeric, coded, or factual element in the output must be directly supported by the supplied information. Never invent or infer a missing date, link, QR code, identifier, or fact merely to fill a reference slot. If the supplied information has no matching content for a reference element, KEEP the successful reference layout and its surrounding spacing, but make that slot visually neutral using the poster's background/design treatment, or fill it only with other source-supported poster content or relevant non-informational imagery. Do not reflow or redesign the overall composition just because a reference slot is unsupported.",
      "DOCUMENT-ARTIFACT FILTER: never put source-document production metadata on the poster—page numbers, वृत्त. क्र., issue/report/file/document numbers, running headers or footers, filenames, scan marks, OCR artifacts, or similar administrative labels are not poster information, even if they appear in the supplied text.",
      'Do not add a logo.',
      'Do not add a footer.',
      "MANDATORY EMPTY COVER ZONES: only the top-right 180 × 170 pixels and the full-width bottom 120 pixels of the 1280 × 1600 output are reserved for branding added later by software. The software-added footer has TWO parts: a navy-blue ministry title pill that rises above a white social-media strip. Together they cover the full canvas width at the bottom; do NOT treat only the white strip as the footer. All text, cards, panels, icons, photographs, subjects, and other meaningful content must end above y=1480 and must not sit behind either footer part. These are the ONLY areas that may be intentionally empty: use all remaining space right up to their boundaries, following the reference structure. Leave both zones COMPLETELY EMPTY of content and continue the poster's immediately surrounding background through them seamlessly, with the same colour and visual treatment as the adjacent background. Do NOT create a separate colour, white space, patch, box, panel, band, reserved-space marker, or visible boundary in either zone. ABSOLUTELY NO text, numbers, logos, footer, photographs, faces, people, objects, icons, borders, shapes, or decoration may enter, sit behind, or cross either zone.",
      'Use only Marathi text and Devanagari numerals in the output. Use Nirmala UI for all text.',
    ].join('\n');
  }

  if (designMode === 'fresh') {
    const freshLines = [
      'Design a single, complete 4:5 portrait OFFICIAL DGIPR Maharashtra government poster FROM SCRATCH — an original composition, NOT a copy of any existing template.',
    ];
    // Colour LEADS, and it is the ASSIGNMENT that leads — not the art director's paraphrase of
    // it. Both are emitted when both exist: the spec says which colours, the direction says how
    // they are used. Only a run with no assignment at all falls back to free choice.
    if (input.assignedPalette) {
      freshLines.push(
        '',
        fmtColourSpec(input.assignedPalette),
        '',
        COLOUR_MANDATE,
      );
      if (input.artDirection)
        freshLines.push('', fmtArtDirection(input.artDirection));
    } else if (input.artDirection) {
      freshLines.push(
        '',
        fmtArtDirection(input.artDirection),
        '',
        COLOUR_MANDATE,
      );
    } else {
      freshLines.push(
        '',
        'Choose an original colour palette and layout suited to the topic and tone — vary it from the usual government navy-blue-and-white and from the saffron-orange + cream look; keep it dignified and legible.',
      );
    }
    if (input.assignedLayout) {
      freshLines.push('', fmtComposition(input.assignedLayout));
    }
    freshLines.push(
      '',
      'Government public-information aesthetic: bold, high-contrast, highly legible Devanagari (Marathi) typography; a clean, trustworthy, well-organised layout.',
      `Compose it as a "${copyStyle}" poster. ${CHROME_ZONES}`,
    );
    // The master's own description is a SECONDARY hint here and its colour words are removed
    // outright rather than disclaimed: the previous "IGNORE any colours it mentions" sat next to
    // a sentence naming this library's saffron/maroon/cream house look, and telling a model to
    // ignore words you have just given it is not a mechanism. See strip-colour-words.ts.
    const structureHint = stripColourMentions(layoutSummary);
    if (structureHint) {
      freshLines.push(
        '',
        `STRUCTURE INSPIRATION — a reference poster that suits this kind of post is built like this. Treat it ONLY as a loose idea of which sections to include (headline, points, a photo area, etc.); where it conflicts with the COMPOSITION above, the COMPOSITION wins: ${structureHint}`,
      );
    }
    freshLines.push(
      '',
      'Render ALL Marathi text crisply and correctly in Devanagari, spelled EXACTLY as given. Do not add any English body text. Do not paint any logos, emblems, footer bands or social handles — the official branding is stamped on afterwards by software. One poster, no outer border.',
      '',
      'CONTENT TO TYPESET:',
      change,
    );
    if (hasPhoto) {
      freshLines.push(
        '',
        `BACKGROUND / HERO IMAGERY (must never cover the text): ${sceneBrief}`,
      );
    } else {
      freshLines.push(
        '',
        'This poster is TEXT-ONLY: build it from typography, colour blocks, cards and simple icons. Do NOT include any photograph, portrait or pictorial illustration.',
      );
    }
    return freshLines.join('\n');
  }

  const layoutRule =
    designMode === 'adaptive'
      ? "You MAY re-arrange and resize the template's text zones to best fit the content, but keep its brand colours."
      : "KEEP the master template's overall layout, proportions, brand colour bands and safe margins EXACTLY as in the provided image.";
  const locked = [
    `You are editing a master template for an OFFICIAL DGIPR Maharashtra government poster (type: ${copyStyle}).`,
    layoutRule,
    hasPhoto ? PLACEHOLDER_WITH_PHOTO : PLACEHOLDER_TEXT_ONLY,
    CHROME_ZONES,
  ];
  if (!hasPhoto) locked.push(TEXT_ONLY_LOCK);
  locked.push(
    'Single 4:5 portrait poster. Typography: bold, high-contrast, highly legible Devanagari (Marathi). Government public-notice aesthetic: clean, serious, trustworthy.',
  );
  locked.push(
    'Render ALL Marathi text crisply and correctly in Devanagari, spelled exactly as below.',
  );

  const lines = [locked.join(' ')];
  if (layoutSummary) {
    lines.push('', `STRUCTURE OF THE MASTER YOU ARE EDITING: ${layoutSummary}`);
  }
  lines.push(
    '',
    "REPLACE the editable content of the poster with the following, fitting the master's existing text zones:",
    '',
    change,
  );
  if (hasPhoto) {
    lines.push(
      '',
      `BACKGROUND IMAGERY — first erase the master's existing photo/illustration, then paint a NEW scene in the image zone (must never cover the text): ${sceneBrief}`,
    );
  }
  lines.push(
    '',
    'Do not add any English text. Do not paint any logos, emblems, footer bands or social handles — the official branding is stamped on afterwards by software. Keep one single poster within the canvas, no outer borders.',
  );
  return lines.join('\n');
}

export type BuildFeedbackPromptInput = Readonly<{
  imageFeedback: string;
  brand: TemplateBrand;
  // 0-3 numbered red markers drawn on the current poster (annotated pixel feedback).
  markerCount?: number | undefined;
  // The lettered BLUE rectangles, in the order they were drawn (which is the order
  // their A/B badges were painted on the poster), each saying what happens to the
  // content inside: 'remove' deletes it and moves nothing else, 'displace' keeps it
  // on the poster and licenses a re-layout. Independent of markerCount — one round
  // may carry both gestures. Empty/absent = the pre-feature prompt, byte-for-byte.
  clearActions?: readonly ClearAction[] | undefined;
  // What the vision pass read off the CURRENT poster: the checklist a displace
  // re-layout must not lose. Only emitted when a displace box is present.
  contentInventory?: readonly string[] | undefined;
}>;

// The prompt that edits an EXISTING poster to apply a requested visual change. Mirrors the
// n8n Build Feedback Prompt node, including the marker_count branch (0 = the legacy prompt
// byte-for-byte).
export function buildFeedbackPrompt(input: BuildFeedbackPromptInput): string {
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
  // The inventory anchors a re-layout; a delete-only round needs no such licence,
  // so it is not paid for in prompt length there.
  const inventory = clear.hasDisplace
    ? contentInventoryLines(input.contentInventory)
    : [];

  const reservedZones =
    input.brand === 'cmo'
      ? 'RESERVED ZONES: the TOP HEADER BAND (the full-width blue leader lockup and the महाराष्ट्र शासन emblem) occupies the top ~19% of the poster, the full-width BOTTOM ~8% footer strip, and the UPPER-RIGHT PHOTO CIRCLE — all three are stamped onto the poster by software (the circle holds a photograph placed by software). Do NOT alter, move, redraw or remove them; keep the upper-right circle a quiet plain background with no text, subject, ring or outline; and do NOT move any text or important content into those areas.'
      : 'RESERVED ZONES: the white rounded-square महाराष्ट्र शासन emblem-and-wordmark badge in the top-right (approx 280x270 px) and the footer strip along the bottom (full width, approx 130 px tall) are official branding stamped onto the poster by software — do NOT alter, move, redraw or remove them, and do NOT move any text or important content into those areas.';

  // A DISPLACE round cannot keep the exact layout — that is the point of it — so the
  // keep-layout rule is REPLACED rather than hedged. Hedging it with a subordinate
  // "except…" clause is what made the gesture a no-op: the absolute-sounding half won.
  // With only DELETE boxes the rule is correct as it stands and only needs the except.
  const exceptClause =
    clear.count > 0 ? ' or the SPACE TO FREE block below' : '';
  const keepRule = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where the requested change${exceptClause} explicitly requires it.`;
  const keepRuleMarker = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where a requested change${exceptClause} explicitly requires it.`;
  // "Preserve all existing Devanagari text exactly" is true of a displace (the words
  // survive, their positions change) but flatly contradicts a delete, so it gains the
  // exception whenever any blue box is present.
  const textException = clear.count > 0 ? ', except as the SPACE TO FREE block requires' : '';

  if (markerCount > 0) {
    return [
      'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single 4:5 portrait poster.',
      `The input image carries ${markerCount} numbered red annotation marker(s): thin red outline rectangles, each with a small red circular badge showing its number. They were drawn onto the poster by editing software and are NOT part of the poster design.`,
      'Each marker is a pointing gesture showing where one requested change applies — not a hard boundary. For each marker, identify the design element at or around that spot and apply the correspondingly numbered change from the request below to that WHOLE element, even where the element extends beyond the rectangle.',
      `REQUESTED CHANGES: «${imageFeedback}».`,
      `Make ONLY these changes. ${keepRuleMarker}`,
      reservedZones,
      'ERASE every red marker rectangle and numbered badge completely from the output, restoring whatever they overlapped — no red outlines, red circles, or annotation numbers may remain anywhere on the poster.',
      `Add no new text, letters, numbers, captions, logos, borders, or decorative elements beyond the requested changes. Preserve all other existing Devanagari text exactly${textException}. Output ONE complete 4:5 portrait poster filling the canvas.`,
      ...inventory,
      ...clear.lines,
    ].join('\n');
  }

  return [
    'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single 4:5 portrait poster.',
    ...(imageFeedback.length > 0
      ? [`Apply ONLY this requested change: «${imageFeedback}».`]
      : []),
    keepRule,
    reservedZones,
    `Add no new text, letters, numbers, captions, logos, borders, or decorative elements. Preserve all existing Devanagari text exactly${textException}. Output ONE complete 4:5 portrait poster filling the canvas.`,
    ...inventory,
    ...clear.lines,
  ].join('\n');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/build-poster-prompt.ts
// Prints the assembled 'fresh' prompt for two differently-assigned runs and asserts the
// properties the colour-diversity fix depends on. Pure string assembly — no model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const COPY: PosterCopy = {
    kicker: 'आरोग्य सेवा',
    headline: 'चार प्राथमिक आरोग्य केंद्रांचे उन्नतीकरण',
    subhead: 'बृहद आराखड्यात समावेश',
    bullets: [
      { text: 'माहुली येथे नवीन तपासणी कक्ष', emphasis: ['माहुली'] },
      { text: 'नेर येथे २४ तास सेवा', emphasis: ['२४ तास'] },
      { text: 'पिंगळाई येथे रुग्णवाहिका', emphasis: [] },
    ],
    scene_brief:
      'A rural primary health centre with staff attending to visitors in daylight.',
  } as unknown as PosterCopy;

  // A master summary in the shape analyze-template.ts really produces — colour theme and all.
  const MASTER_SUMMARY =
    'A friendly headline on a soft orange panel with five rounded benefit cards and a smiling portrait at the lower right. The dominant colour theme is warm saffron, cream and maroon.';

  const failures: string[] = [];

  void Promise.all([
    import('./poster-palettes.js'),
    import('./poster-layouts.js'),
  ]).then(([{ pickPalette }, { pickLayout }]) => {
    for (const seed of ['run-alpha', 'run-beta']) {
      const palette = pickPalette(seed);
      const layout = pickLayout(seed, {
        hasPhoto: true,
        copyStyle: 'info_bullets',
      });
      const prompt = buildPosterPrompt({
        copy: COPY,
        copyStyle: 'info_bullets',
        designMode: 'fresh',
        brand: 'dgipr',
        masterUrl: '',
        layoutSummary: MASTER_SUMMARY,
        hasPhoto: true,
        assignedPalette: palette,
        assignedLayout: layout,
        artDirection: {
          palette: '',
          background:
            'a flat ground with a single crisp colour block, no gradients',
          composition: 'the headline set tight over three evenly spaced rows',
          mood: 'calm, clinical, reassuring',
          accents: 'thin rules and simple line icons, one emphasis per row',
        },
      });

      console.log(
        `\n${'='.repeat(78)}\nseed ${seed} · ${palette.id} (${palette.family}) · ${layout.id}\n${'='.repeat(78)}\n${prompt}`,
      );

      // 1. The assigned hexes must be present — this is the bug that made the whole rotation inert.
      for (const hex of [
        palette.hex.ground,
        palette.hex.panel,
        palette.hex.ink,
        palette.hex.accent,
      ]) {
        if (!prompt.includes(hex))
          failures.push(`${seed}: assigned hex ${hex} missing from the prompt`);
      }
      // 2. The colour spec must come BEFORE the art direction, so the spec is what leads.
      const specAt = prompt.indexOf('COLOUR SPECIFICATION');
      const adAt = prompt.indexOf('ART DIRECTION');
      if (specAt === -1)
        failures.push(`${seed}: no COLOUR SPECIFICATION block`);
      if (adAt !== -1 && specAt > adAt)
        failures.push(`${seed}: art direction precedes the colour spec`);
      // 3. The assigned composition must be present and precede the master's structure hint.
      const compAt = prompt.indexOf('COMPOSITION —');
      const structAt = prompt.indexOf('STRUCTURE INSPIRATION');
      if (compAt === -1) failures.push(`${seed}: no COMPOSITION block`);
      if (structAt !== -1 && compAt > structAt)
        failures.push(`${seed}: structure hint precedes the composition`);
      // 4. NO colour word from the master's summary may survive into the structure hint.
      if (structAt !== -1) {
        const hint = prompt.slice(structAt);
        for (const word of ['saffron', 'cream', 'maroon', 'orange']) {
          if (new RegExp(`\b${word}\b`, 'i').test(hint)) {
            failures.push(
              `${seed}: master colour word "${word}" leaked into the structure hint`,
            );
          }
        }
      }
    }

    // 5. The clear-space (blue box) feedback path. The properties that matter are that the
    //    block only appears when asked for, that it survives beside red markers, that it can
    //    stand alone with no typed text at all, that it never proposes emptying the area
    //    into a panel or a different colour — and, above all, that a DISPLACE round does not
    //    also carry "keep the exact layout unchanged". That contradiction is what made the
    //    gesture a no-op on a full poster, so it is asserted in both branches.
    const plainFeedback = buildFeedbackPrompt({
      imageFeedback: 'शीर्षक मोठे करा',
      brand: 'dgipr',
    });
    if (/blue/i.test(plainFeedback))
      failures.push('plain feedback prompt mentions blue clear boxes');
    if (!plainFeedback.includes('Keep the exact layout'))
      failures.push('plain feedback prompt lost its keep-layout rule');
    if (plainFeedback.includes('SPACE TO FREE block'))
      failures.push('plain feedback prompt gained a clear-space exception');

    const cleared = buildFeedbackPrompt({
      imageFeedback: '',
      brand: 'dgipr',
      clearActions: ['displace', 'remove'],
    });
    for (const needle of [
      'SPACE TO FREE',
      '2 translucent BLUE rectangle',
      '(A, B)',
      'MOVE — blue box A',
      'DELETE — blue box B',
      'PLAIN EMPTY BACKGROUND',
      'ERASE the blue rectangles',
      'RESERVED ZONES',
    ]) {
      if (!cleared.includes(needle))
        failures.push(`clear-space prompt lost "${needle}"`);
    }
    if (cleared.includes('Apply ONLY this requested change'))
      failures.push('clear-space-only prompt invented a requested change');
    // THE regression this whole change exists to prevent.
    if (cleared.includes('Keep the exact layout'))
      failures.push('displace round kept the contradictory keep-layout rule');
    if (!cleared.includes("INFORMATION is fixed but its ARRANGEMENT is not"))
      failures.push('displace round lost the preserve-information replacement');

    // A DELETE-only round is the opposite case: keeping the layout frozen is correct
    // there, so the rule must survive — with the exception clause, since the delete
    // itself changes the poster.
    const removeOnly = buildFeedbackPrompt({
      imageFeedback: '',
      brand: 'dgipr',
      clearActions: ['remove'],
    });
    if (!removeOnly.includes('Keep the exact layout'))
      failures.push('remove-only round dropped the keep-layout rule');
    if (!removeOnly.includes('or the SPACE TO FREE block below'))
      failures.push('remove-only round lost the keep-layout exception');
    if (removeOnly.includes('MOVE — blue box'))
      failures.push('remove-only round leaked the displace block');
    if (removeOnly.includes('INFORMATION THAT MUST SURVIVE'))
      failures.push('remove-only round paid for a displace inventory');

    // The survival inventory only rides a displace, and reaches the prompt verbatim.
    const withInventory = buildFeedbackPrompt({
      imageFeedback: '',
      brand: 'dgipr',
      clearActions: ['displace'],
      contentInventory: ['पिण्याचे पाणी १५ मिनिटे उकळून घ्या', 'शिळे अन्न टाळा'],
    });
    if (!withInventory.includes('INFORMATION THAT MUST SURVIVE — 2 item(s)'))
      failures.push('displace round lost its survival inventory');
    if (!withInventory.includes('1. पिण्याचे पाणी १५ मिनिटे उकळून घ्या'))
      failures.push('inventory item did not reach the prompt verbatim');
    if (
      buildFeedbackPrompt({
        imageFeedback: '',
        brand: 'dgipr',
        clearActions: ['remove'],
        contentInventory: ['शिळे अन्न टाळा'],
      }).includes('INFORMATION THAT MUST SURVIVE')
    )
      failures.push('remove-only round emitted an inventory');

    const both = buildFeedbackPrompt({
      imageFeedback: 'शीर्षक मोठे करा',
      brand: 'dgipr',
      markerCount: 2,
      clearActions: ['displace'],
    });
    if (!both.includes('2 numbered red annotation marker'))
      failures.push('combined prompt lost the marker count');
    if (!both.includes('1 translucent BLUE rectangle'))
      failures.push('combined prompt lost the clear count');
    if (both.includes('Keep the exact layout'))
      failures.push('combined displace prompt kept the keep-layout rule');
    // The clear rule must come AFTER the reserved zones it refers to, and LAST of all —
    // last position is what these models weight most, and it is the officer's real ask.
    if (both.indexOf('SPACE TO FREE:') < both.indexOf('RESERVED ZONES'))
      failures.push('clear rule precedes the reserved zones it refers to');
    if (!both.trimEnd().endsWith('may remain anywhere on the poster.'))
      failures.push('clear rule is not the last block of the prompt');
    if (both.indexOf('SPACE TO FREE:') < both.indexOf('Output ONE complete'))
      failures.push('clear rule precedes the canvas/closing line');

    let threw = false;
    try {
      buildFeedbackPrompt({ imageFeedback: '   ', brand: 'dgipr' });
    } catch {
      threw = true;
    }
    if (!threw)
      failures.push('empty feedback with no clear boxes was accepted');

    if (failures.length > 0) {
      console.error(`\n${failures.length} FAILURE(S):`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\nAll prompt-assembly assertions passed.');
    }
  });
}
