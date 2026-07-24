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

export type DesignMode = 'fresh' | 'adaptive' | 'onbrand';

export type BuildPosterPromptInput = Readonly<{
  copy: PosterCopy;
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
  const lines = [
    'ART DIRECTION — the intended treatment for this poster:',
  ];
  if (ad.palette) lines.push(`- Colour palette: ${ad.palette}`);
  if (ad.background) lines.push(`- Background handling: ${ad.background}`);
  if (ad.composition) lines.push(`- Composition detail: ${ad.composition}`);
  if (ad.mood) lines.push(`- Mood: ${ad.mood}`);
  if (ad.accents) lines.push(`- Panels / cards / icons / accents: ${ad.accents}`);
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
  'RESERVED ZONES — the official branding is stamped onto the finished poster afterwards by software: the top-right corner (approx 220x180 px; the महाराष्ट्र शासन emblem) and the full-width bottom strip (approx 130 px tall; the department footer band and social-handle strip). Place NO text, logos, emblems, statistics, faces or important visual subject matter inside these zones; plain flat colour or quiet background continuation there is expected and correct. Compose the poster the way a human designer would who knows the emblem and footer will cover those areas and must not hide any information.';

const PLACEHOLDER_WITH_PHOTO =
  'The master template you are editing still carries PLACEHOLDER content from a previous poster: sample Marathi text in every text zone (headline, tag, bullets, figures, dates) and a sample photo/illustration in the image zone. NONE of that content relates to this poster. ERASE every piece of existing sample text and ERASE the existing photo/illustration completely before adding the new content — no word, number, person, or pictorial element from the placeholder may survive into the output. ALSO ERASE the branding chrome the master carries: the महाराष्ट्र शासन emblem in the top-right and the department footer band + social-handle strip along the bottom — fill those areas by continuing the surrounding colour band or background naturally, as if that branding was never there. Only the layout frame stays: colour bands and panel shapes.';
const PLACEHOLDER_TEXT_ONLY =
  'The master template you are editing still carries PLACEHOLDER text from a previous poster in every text zone (headline, tag, cards, bullets, figures, dates). NONE of that wording relates to this poster. ERASE every piece of existing sample text before adding the new content — no word or number from the placeholder may survive into the output. ALSO ERASE the branding chrome the master carries: the महाराष्ट्र शासन emblem in the top-right and the department footer band + social-handle strip along the bottom — fill those areas by continuing the surrounding colour band or background naturally, as if that branding was never there. Everything else stays exactly as it is: colour bands, card shapes, icons, and the existing background.';
const TEXT_ONLY_LOCK =
  "THIS MASTER IS A TEXT-ONLY TEMPLATE: it has NO photograph, NO portrait and NO illustration zone. Do NOT add any photograph, person, hero image, or pictorial subject anywhere on the poster. Keep the master's existing background exactly as it is (including any faded or ghosted backdrop wash) and keep its existing icons, symbols and card shapes. The ONLY things you change are the Marathi text inside the existing text zones and the branding-chrome erasure described above.";

function fmtBullets(arr: unknown): string {
  const items = Array.isArray(arr) ? arr : [];
  return items
    .map((b, i) => {
      const bullet = b as { text?: string; emphasis?: unknown[] };
      const e = (Array.isArray(bullet.emphasis) ? bullet.emphasis : []).filter(Boolean);
      return `  ${i + 1}. ${bullet.text ?? ''}${e.length ? `  [emphasise: ${e.join(' | ')}]` : ''}`;
    })
    .join('\n');
}

// Render the copy object into the layout instruction block. Dispatches on copy_style (not the
// type slug), so custom types render with the generic headline + points layout.
function buildChange(copyStyle: string, c: PosterCopy): string {
  const get = <T,>(k: string): T => c[k] as T;
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
    const sch = (get<Record<string, string>>('schedule') as Record<string, string>) || {};
    const stats = Array.isArray(get('stats')) ? (get('stats') as Record<string, string>[]) : [];
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
        .map((s, i) => `  ${i + 1}. ${s.value} — ${s.label}  [icon: ${s.icon_hint}]`)
        .join('\n'),
    ];
  } else if (copyStyle === 'quote') {
    const at = (get<Record<string, string>>('attribution') as Record<string, string>) || {};
    const points = Array.isArray(get('points'))
      ? (get('points') as Record<string, string>[])
      : [];
    lines = [
      `TOPIC LABEL (small tag near the top): ${get<string>('topic_label')}`,
      `HEADLINE (subject line): ${get<string>('headline')}`,
      `QUOTE (main text, inside large quotation marks): ${get<string>('quote_text')}`,
      `ATTRIBUTION (name then designation): ${at.name || ''}, ${at.title || ''}`,
      'SUPPORTING POINTS (each as icon + text):',
      points.map((p, i) => `  ${i + 1}. ${p.text}  [icon: ${p.icon_hint}]`).join('\n'),
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
  const sceneBrief = typeof copy.scene_brief === 'string' ? copy.scene_brief : '';

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

  if (designMode === 'fresh') {
    const freshLines = [
      'Design a single, complete 4:5 portrait OFFICIAL DGIPR Maharashtra government poster FROM SCRATCH — an original composition, NOT a copy of any existing template.',
    ];
    // Colour LEADS, and it is the ASSIGNMENT that leads — not the art director's paraphrase of
    // it. Both are emitted when both exist: the spec says which colours, the direction says how
    // they are used. Only a run with no assignment at all falls back to free choice.
    if (input.assignedPalette) {
      freshLines.push('', fmtColourSpec(input.assignedPalette), '', COLOUR_MANDATE);
      if (input.artDirection) freshLines.push('', fmtArtDirection(input.artDirection));
    } else if (input.artDirection) {
      freshLines.push('', fmtArtDirection(input.artDirection), '', COLOUR_MANDATE);
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
      freshLines.push('', `BACKGROUND / HERO IMAGERY (must never cover the text): ${sceneBrief}`);
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
  locked.push('Render ALL Marathi text crisply and correctly in Devanagari, spelled exactly as below.');

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
}>;

// The prompt that edits an EXISTING poster to apply a requested visual change. Mirrors the
// n8n Build Feedback Prompt node, including the marker_count branch (0 = the legacy prompt
// byte-for-byte).
export function buildFeedbackPrompt(input: BuildFeedbackPromptInput): string {
  const imageFeedback = input.imageFeedback.trim();
  if (imageFeedback.length === 0) throw new Error('No image feedback provided.');
  const markerCount = Math.max(0, Math.min(3, Math.trunc(Number(input.markerCount) || 0)));

  const reservedZones =
    input.brand === 'cmo'
      ? 'RESERVED ZONES: the TOP HEADER BAND (the full-width blue leader lockup and the महाराष्ट्र शासन emblem) occupies the top ~19% of the poster, the full-width BOTTOM ~8% footer strip, and the UPPER-RIGHT PHOTO CIRCLE — all three are stamped onto the poster by software (the circle holds a photograph placed by software). Do NOT alter, move, redraw or remove them; keep the upper-right circle a quiet plain background with no text, subject, ring or outline; and do NOT move any text or important content into those areas.'
      : 'RESERVED ZONES: the महाराष्ट्र शासन emblem in the top-right (approx 220x180 px) and the footer strip along the bottom (full width, approx 130 px tall) are official branding stamped onto the poster by software — do NOT alter, move, redraw or remove them, and do NOT move any text or important content into those areas.';

  if (markerCount > 0) {
    return [
      'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single 4:5 portrait poster.',
      `The input image carries ${markerCount} numbered red annotation marker(s): thin red outline rectangles, each with a small red circular badge showing its number. They were drawn onto the poster by editing software and are NOT part of the poster design.`,
      'Each marker is a pointing gesture showing where one requested change applies — not a hard boundary. For each marker, identify the design element at or around that spot and apply the correspondingly numbered change from the request below to that WHOLE element, even where the element extends beyond the rectangle.',
      `REQUESTED CHANGES: «${imageFeedback}».`,
      'Make ONLY these changes. Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where a requested change explicitly requires it.',
      reservedZones,
      'ERASE every red marker rectangle and numbered badge completely from the output, restoring whatever they overlapped — no red outlines, red circles, or annotation numbers may remain anywhere on the poster.',
      'Add no new text, letters, numbers, captions, logos, borders, or decorative elements beyond the requested changes. Preserve all other existing Devanagari text exactly. Output ONE complete 4:5 portrait poster filling the canvas.',
    ].join('\n');
  }

  return [
    'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single 4:5 portrait poster.',
    `Apply ONLY this requested change: «${imageFeedback}».`,
    'Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where the requested change explicitly requires it.',
    reservedZones,
    'Add no new text, letters, numbers, captions, logos, borders, or decorative elements. Preserve all existing Devanagari text exactly. Output ONE complete 4:5 portrait poster filling the canvas.',
  ].join('\n');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/build-poster-prompt.ts
// Prints the assembled 'fresh' prompt for two differently-assigned runs and asserts the
// properties the colour-diversity fix depends on. Pure string assembly — no model call, no spend.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const COPY: PosterCopy = {
    kicker: 'आरोग्य सेवा',
    headline: 'चार प्राथमिक आरोग्य केंद्रांचे उन्नतीकरण',
    subhead: 'बृहद आराखड्यात समावेश',
    bullets: [
      { text: 'माहुली येथे नवीन तपासणी कक्ष', emphasis: ['माहुली'] },
      { text: 'नेर येथे २४ तास सेवा', emphasis: ['२४ तास'] },
      { text: 'पिंगळाई येथे रुग्णवाहिका', emphasis: [] },
    ],
    scene_brief: 'A rural primary health centre with staff attending to visitors in daylight.',
  } as unknown as PosterCopy;

  // A master summary in the shape analyze-template.ts really produces — colour theme and all.
  const MASTER_SUMMARY =
    'A friendly headline on a soft orange panel with five rounded benefit cards and a smiling portrait at the lower right. The dominant colour theme is warm saffron, cream and maroon.';

  const failures: string[] = [];

  void Promise.all([import('./poster-palettes.js'), import('./poster-layouts.js')]).then(
    ([{ pickPalette }, { pickLayout }]) => {
      for (const seed of ['run-alpha', 'run-beta']) {
        const palette = pickPalette(seed);
        const layout = pickLayout(seed, { hasPhoto: true, copyStyle: 'info_bullets' });
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
            background: 'a flat ground with a single crisp colour block, no gradients',
            composition: 'the headline set tight over three evenly spaced rows',
            mood: 'calm, clinical, reassuring',
            accents: 'thin rules and simple line icons, one emphasis per row',
          },
        });

        console.log(`\n${'='.repeat(78)}\nseed ${seed} · ${palette.id} (${palette.family}) · ${layout.id}\n${'='.repeat(78)}\n${prompt}`);

        // 1. The assigned hexes must be present — this is the bug that made the whole rotation inert.
        for (const hex of [palette.hex.ground, palette.hex.panel, palette.hex.ink, palette.hex.accent]) {
          if (!prompt.includes(hex)) failures.push(`${seed}: assigned hex ${hex} missing from the prompt`);
        }
        // 2. The colour spec must come BEFORE the art direction, so the spec is what leads.
        const specAt = prompt.indexOf('COLOUR SPECIFICATION');
        const adAt = prompt.indexOf('ART DIRECTION');
        if (specAt === -1) failures.push(`${seed}: no COLOUR SPECIFICATION block`);
        if (adAt !== -1 && specAt > adAt) failures.push(`${seed}: art direction precedes the colour spec`);
        // 3. The assigned composition must be present and precede the master's structure hint.
        const compAt = prompt.indexOf('COMPOSITION —');
        const structAt = prompt.indexOf('STRUCTURE INSPIRATION');
        if (compAt === -1) failures.push(`${seed}: no COMPOSITION block`);
        if (structAt !== -1 && compAt > structAt) failures.push(`${seed}: structure hint precedes the composition`);
        // 4. NO colour word from the master's summary may survive into the structure hint.
        if (structAt !== -1) {
          const hint = prompt.slice(structAt);
          for (const word of ['saffron', 'cream', 'maroon', 'orange']) {
            if (new RegExp(`\b${word}\b`, 'i').test(hint)) {
              failures.push(`${seed}: master colour word "${word}" leaked into the structure hint`);
            }
          }
        }
      }

      if (failures.length > 0) {
        console.error(`\n${failures.length} FAILURE(S):`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exitCode = 1;
      } else {
        console.log('\nAll prompt-assembly assertions passed.');
      }
    },
  );
}
