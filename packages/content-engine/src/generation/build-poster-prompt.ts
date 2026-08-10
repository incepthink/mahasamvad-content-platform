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
import {
  clearSpaceRule,
  contentInventoryLines,
  DISPLACE_PRESERVE_RULE,
  type ClearAction,
} from './clear-space-rule.js';
import {
  fitToReserveRule,
  paintNoChromeRule,
  referenceChromeRule,
  reservedZoneBlock,
  stampedChromeRule,
  type ReservedZoneGeometry,
  type StampedChrome,
} from './reserved-zone-rule.js';

// The social canvas and the zones the API stamps branding into afterwards. Keep in sync with
// packages/poster-renderer/src/twitter-chrome.ts.
//
// The BADGE is still a destructive overlay, and its 180x170 is deliberately larger than the
// 160x154 the API actually stamps at a 6px margin — that slack is the model's margin of error.
//
// The FOOTER is not an overlay any more (2026-08-10). overlayTwitterChrome appends a strip
// below the artwork and stamps the band there, so the model cannot bury a line under it however
// it lays the poster out — the prompt had been strengthened once for exactly that failure and
// lost anyway. `footerHeight` is therefore the band's REAL height (~91px at this width, so the
// prose describing it is true) and `footerAppendedMargin` is a thin TEXT cushion, nothing more.
//
// IT WAS 48 AND THAT WAS STILL TOO MUCH (generation 97b64542, measured): asked for a 48px
// "calm plain background" margin, the model left 82, and footer-extension.ts then filled its
// 91px strip from that same flat grey — 173 dead pixels, a tenth of the poster, reading as a
// letterboxed image with a bar stuck on the end. An image model has no ruler, so it overshoots
// a pixel figure by whatever feels safe; the fix is therefore BOTH a smaller number and a rule
// that no longer asks for a void at all. reservedZoneBlock now tells the design to run off the
// bottom edge in any colour it likes, exactly as it must run into the badge corner, and 16px is
// only the gap between the last LINE OF TEXT and the band.
const SOCIAL_ZONES: ReservedZoneGeometry = {
  width: 1280,
  height: 1600,
  lockupWidth: 180,
  lockupHeight: 170,
  footerHeight: 91,
  footerAppendedMargin: 16,
};

// The stamped footer is a navy ministry title pill sitting ON TOP of a white social-handle
// strip. A model told only "a footer strip" reads the white strip alone as the footer and
// tucks its last line under the pill, which is where a real render lost three columns of its
// closing paragraph.
//
// STILL PASSED, DELIBERATELY IGNORED. reservedZoneBlock drops it in appended mode — nothing
// tucks under the pill any more, and on an initial render the pill is not even on the canvas
// the model is painting. It is left at the call sites so that clearing footerAppendedMargin
// (the one-line rollback to an overlaid footer) restores the old prompt intact, rather than
// restoring it with this hard-won sentence missing.
const SOCIAL_FOOTER_NOTE =
  'The software-added footer has TWO parts: a navy-blue ministry title pill that rises above a white social-media strip. Together they cover the full canvas width at the bottom; do NOT treat only the white strip as the footer.';

// What overlayTwitterChrome actually stamps, described as the model sees it — on the reference
// template it is editing (initial) and on the finished poster it is editing (feedback). Keep the
// wording matched to packages/poster-renderer/src/twitter-chrome.ts.
const SOCIAL_CHROME: StampedChrome = {
  surface: 'poster',
  lockup:
    'white rounded-square महाराष्ट्र शासन emblem-and-wordmark badge in the top-right corner',
  footer:
    'full-width department footer band and social-handle strip along the bottom',
};

// The CMO brand's chrome is a different shape — a full-width leader header rather than a corner
// badge — but it is stamped by overlayCmoChrome on exactly the same schedule, so it carries the
// same rule. Keep in sync with packages/poster-renderer/src/cmo-geometry.ts.
const CMO_CHROME: StampedChrome = {
  surface: 'poster',
  lockup:
    'full-width blue leader header band across the top, with its portraits and its महाराष्ट्र शासन emblem',
  footer:
    'full-width department footer band and social-handle strip along the bottom',
};

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
  // can check its own output against rather than a sentiment — and, since 2026-08-04, so it can
  // check the same number in the other direction: that many items and NOT ONE MORE.
  itemCount?: number | undefined;
  // NOTE: `slotShortfall` used to live here and told the model to "EXTEND the reference's item
  // pattern — repeat its rows/cards". It is deleted. The word "repeat" had no business in a
  // prompt whose one job is to reproduce the officer's text unchanged, and the officer's rule is
  // now the simpler one: show each item exactly once and leave any leftover space empty. The
  // shortfall is still MEASURED and still warns the officer (posterCapacityWarnings in
  // apps/api/src/jobs/runner.ts) — it just no longer instructs the image model.
  copyStyle: string;
  designMode: DesignMode;
  brand: TemplateBrand;
  // The master to edit (the chosen library image's public URL). Absent/empty is only valid for
  // design_mode 'fresh', which paints from scratch and resolves no reference at all — the
  // check below still throws for every mode that needs one. Optional because the runner has
  // nothing to pass on a fresh run; the body already tolerated it, only the type did not.
  masterUrl?: string | undefined;
  // The chosen master's vision-derived one-liner ('' = un-analysed → generic prompt). Reaches
  // the template-edit modes only: a 'fresh' run has no master, so the STRUCTURE INSPIRATION
  // block it used to feed is simply not emitted and the assigned COMPOSITION archetype is the
  // whole structural instruction — which it already outranked whenever both were present.
  layoutSummary?: string | undefined;
  hasPhoto: boolean;
  // RETIRED FROM THE PROMPT (2026-08-10) — all three were the fresh lane's design specification
  // and none of them reaches the image model any more. The fresh brief now names the client and
  // hands the design over; see the branch below for why.
  //
  // They are kept on the type, and the runner still ASSIGNS a palette and a layout, because
  // `generations.poster_style` (migration 0028) persists them and the UI reads them back as the
  // run's style label. Be honest about what that label now means: it records a rotation that no
  // longer influences the render. `artDirection` is no longer requested at all — the runner
  // skips that paid call rather than buying a treatment nothing consumes.
  artDirection?: ArtDirection | undefined;
  assignedPalette?: PosterPalette | undefined;
  assignedLayout?: PosterLayout | undefined;
}>;

// BRIGHTNESS. Only for the lane where the image model chooses the colours itself — the
// fixed-template branch, which tells it the reference controls structure and not colour.
//
// "Ensure strong contrast and easy readability" was the whole of the guidance there, and
// contrast is satisfied perfectly by white type on black: generation 97b64542 came back as a
// charcoal-and-near-black poster (mean luminance 153/255, 37% of its pixels below 80) with a
// full-height black column down one third of it. It is technically legible and it does not look
// like anything DGIPR publishes. The rule that was missing is not about contrast at all — it is
// about which SIDE of the contrast the large areas sit on, so this says the dominant ground is
// light and dark is an accent, rather than repeating "high contrast" a third time.
//
// Deliberately NOT emitted on the 'fresh' lane: there the palette rotation assigns exact hexes
// (every one of the 18 is a light ground already, by product decision), and a second voice
// telling the model to brighten things would be licence to depart from a specification whose
// whole point is that it is not negotiable.
const BRIGHT_LOOK_RULE =
  'MAKE IT BRIGHT, VIVID AND EYE-CATCHING. This poster is published on social media and read on a phone, so it must look light, fresh and inviting at a glance. Build it on a LIGHT, luminous ground — white, off-white, or a light clean tint of the chosen colour — covering most of the poster, and carry the design with clear, saturated, confident colour in the panels, bands, headings, figures, icons and accents. Dark tones are for small blocks, headings and accents only. Do NOT make the poster dark, black, charcoal, near-black, slate, night-mode, muted, dull, washed-out, greyscale, monochrome or moody, and do NOT let a black or very dark panel occupy a large part of the canvas or serve as the main background. Any photograph must be bright, colourful and naturally lit — never desaturated, greyscale, darkened or overlaid with a dark scrim. A dark, drab or low-energy poster is a failed poster even when every other rule is followed.';

// RETIRED (2026-08-07): CHROME_ZONE_GEOMETRY (280x270 / 130px) and its prose twin
// CHROME_ZONES. Both are gone and must not come back — SOCIAL_ZONES below is now the single
// geometry every DGIPR social prompt quotes, initial and feedback alike.
//
// They were the cause of two reported defects on fully-AI ('fresh') posters:
//
//   - "the logo left too much space with a different background, like a box in the top right".
//     280x270 is THREE TIMES the area of the 160x154 badge overlayTwitterChrome actually
//     stamps, so a model obeying the reserve correctly still left an obviously oversized gap;
//     and CHROME_ZONES described the badge it was reserving for ("a white rounded-square
//     महाराष्ट्र शासन emblem-and-wordmark badge"), which is an invitation to paint a white
//     rounded square there. Its only defence against that was a soft "do not leave them plain
//     or empty solely for the branding" — where reservedZoneBlock names the failure outright
//     ("Do NOT create a separate colour, white space, patch, box, panel, band, reserved-space
//     marker, or visible boundary in either zone").
//   - "the footer was hiding some text". CHROME_ZONES described the footer as one strip. The
//     stamped footer is a navy title pill sitting ABOVE a white social strip, and a model told
//     only "a footer strip" reads the white strip alone as the footer and tucks its last line
//     under the pill — the exact loss SOCIAL_FOOTER_NOTE was written for, which the fresh path
//     never received. CHROME_ZONES was also glued mid-prompt onto the "Compose it as a …
//     poster." line rather than emitted as its own block near the end.

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

    // COMPLETENESS. The officer's text is the poster's content, not source material to edit
    // down — so the two clauses that used to sit at the end of this prompt ("never paste the
    // entire input article", "select only the most important information") are gone: they were
    // an instruction to drop the officer's own points, and a seven-point note was coming back
    // as a four-point poster. The reference is now chosen for its capacity to hold every item
    // (select-by-information.ts), so "show all of it" is a request the layout can honour.
    //
    // "or use more of the canvas" used to be the third escape offered here and is deliberately
    // GONE: on this canvas the only unused space left is the reserved footer strip, so that
    // clause was a licence to put the officer's last paragraph where an opaque band is about to
    // land. Smart reflow inside the usable canvas, followed by shrinking if still needed, is the
    // answer — see reserved-zone-rule.ts.
    const completeness = [
      'SHOW ALL OF THE INFORMATION. Every distinct point, instruction, measure, figure and fact in the supplied information must appear on the poster. Do not omit any of it, do not summarise it, and do not merge two points into one because the layout feels tight. If space is short, reduce the type size and tighten the spacing until it fits — never drop content, and never run content into the reserved zones described at the end of these instructions.',
      // THE HEADLINE IS WHERE THE ROOM COMES FROM, and this had to be said here rather than
      // only in fitToReserveRule at the end. A real five-point poster came back with a
      // three-line headline taking roughly a third of the canvas and its last bullet pushed off
      // the bottom: the fit rule DOES say "shrink the headline first", but on this lane it is
      // reached through allowStructuralReflow, which offers a paragraph of re-layout options
      // ahead of it. Stating the proportion up here, beside the completeness pressure it has to
      // answer, is what makes it act before the layout is committed rather than as a remedy.
      'KEEP THE HEADLINE PROPORTIONATE TO THE REST. The headline is a title, not the poster: set it in at most two or three lines, and never let it and its eyebrow/subheadline together take more than about a quarter of the poster height. The longer the supplied information, the smaller the headline must be — reduce it BEFORE reducing anything else, because it is the largest block on the poster and the cheapest to shrink, and there is no minimum size it has to keep. Never enlarge a short headline to fill space that the body content needs.',
    ];
    if (typeof itemCount === 'number' && itemCount > 0) {
      completeness.push(
        `The supplied information contains ${itemCount} distinct item(s). The finished poster must show all ${itemCount}, and exactly ${itemCount} — no more. Count them in your output before finishing.`,
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
      // NO REPETITION. The other half of "use the officer's text as it is", and the one the
      // prompt was missing: generation 7c33fa93 came back with the same five dated alerts
      // written out twice — once as a left-hand paragraph column and again as right-hand dated
      // cards — because every pressure in this prompt pointed one way (show everything, match
      // the reference's density, do not leave slots empty) and NOTHING said each item appears
      // once. Repeating the officer's words is a change to their text just as much as
      // rewording it is.
      'USE EACH ITEM EXACTLY ONCE. Every point, instruction, figure, date and fact from the supplied information appears in ONE place on the poster and nowhere else. Do not repeat an item in a second column, panel, card, sidebar, banner, caption or summary. Do not restate the same fact in a shortened, expanded or reordered form elsewhere on the poster. Do not write the same item once as a sentence and again as a list row, a dated card or a callout — that is the same item twice, not two items. Do not add a heading, label, caption, tagline, footnote, recap or any other wording that is not in the supplied information.',
      // EMPTY IS ALLOWED, and it has to be said explicitly, because it contradicts the density
      // rule two lines below. Given a reference with more slots than the officer has items, a
      // model told to match its density and never leave gaps will fill the surplus with the only
      // material it has — the officer's own items, a second time.
      "LEAVING SPACE EMPTY IS CORRECT. If the supplied information does not fill the reference layout, that is the expected result: leave the surplus area as clean, plain background in the poster's own colours, or let the remaining content breathe with larger margins and spacing. Never repeat content, never invent extra content, and never split one item into several to fill space. Empty space is always better than a repeated or invented item.",
      "MAKE THE DESIGN SUIT THE MESSAGE. Judge from the supplied information what kind of poster this is — a public warning, a health advisory, a scheme launch, an achievement, an invitation, a deadline — and make the finished poster read unmistakably as that kind of poster through its colour choice, imagery and emphasis. Take this from the INFORMATION, never from whatever the reference image happens to be about: the reference's own topic is unrelated placeholder content.",
      // "Do not leave large blank or unused areas. Fill the usable canvas as efficiently as the
      // reference image does" used to close this clause, and against a reference with more slots
      // than the officer has items it is an instruction to find more content — of which there is
      // none, so the model reused what it already had (generation 7c33fa93). Density is now
      // explicitly subordinate to the exactly-once rule; the canvas definition stays, because it
      // is what keeps "usable" from meaning the full 1600px height.
      "Use the provided reference image as the PRIMARY STRUCTURAL GUIDE for the poster, not as a pixel-locked blueprint. Preserve its recognisable overall composition, visual hierarchy and design idea wherever they work for the supplied information. STRUCTURE means geometry and visual hierarchy—not the meaning, factual content, or element type of any reference slot. Content completeness, readability and reserved-zone safety OUTRANK the reference's exact widths, heights, proportions, section boundaries and imagery zones. You may intelligently resize, widen, move or extend components when the supplied information needs a different amount of space; do not redesign unnecessarily and do not compress everything onto one side. Distribute the supplied information across the usable canvas — the USABLE CANVAS is the area above the bottom margin described at the end of these instructions and outside the reserved top-right corner. Match the reference's density ONLY as far as the supplied information reaches: where it runs out, stop. Never repeat or invent content to match the reference's fullness.",
      "The reference image controls STRUCTURE ONLY, not colour. Choose the poster's colour palette freely and creatively; ensure strong contrast and easy readability for every Marathi word and Devanagari numeral.",
      // …and "strong contrast" alone is what let a real render come back charcoal-on-black.
      BRIGHT_LOOK_RULE,
      // "...or fill it only with other source-supported poster content" was the third licence to
      // duplicate, and the most direct of the three: by the time a slot is unsupported, every
      // source-supported item is already on the poster, so "other source-supported content" can
      // only mean an item shown a second time. An unsupported slot is now left empty or given
      // non-informational imagery — never text.
      "REFERENCE-CONTENT FIREWALL: treat every word, numeral, date, year, URL, domain, app name, contact detail, identifier, logo, emblem, QR code, barcode, and factual claim visible in the reference image as unrelated placeholder content. Copy NONE of it. Every textual, numeric, coded, or factual element in the output must be directly supported by the supplied information. Never invent or infer a missing date, link, QR code, identifier, or fact merely to fill a reference slot. If the supplied information has no matching content for a reference element, KEEP the successful reference layout and its surrounding spacing, and leave that slot EMPTY — visually neutral in the poster's background/design treatment, or carrying relevant non-informational imagery only. Do not fill it by repeating information shown elsewhere on the poster. Do not reflow or redesign the overall composition just because a reference slot is unsupported.",
      'DOCUMENT-ARTIFACT FILTER: never put source-document production metadata on the poster—page numbers, वृत्त. क्र., issue/report/file/document numbers, running headers or footers, filenames, scan marks, OCR artifacts, or similar administrative labels are not poster information, even if they appear in the supplied text.',
      // "Do not add a logo. / Do not add a footer." used to be the whole of this rule, and it
      // was not enough: the reference is a FINISHED poster carrying its own chrome, and the
      // block above has just called it the AUTHORITATIVE VISUAL STRUCTURE, so the model copied
      // the badge it could see and the API then stamped the real one beside it. Every other
      // DGIPR path says ERASE the master's chrome; this branch never did. See
      // reserved-zone-rule.ts.
      referenceChromeRule(SOCIAL_CHROME),
      'Use only Marathi text and Devanagari numerals in the output. Use Nirmala UI for all text.',
      // The zone geometry, then the rule that makes it win, LAST — the position these models
      // weight most, and the position the clear-space rule already holds for the same reason.
      // Before this the reserve sat second-to-last under three louder completeness clauses and
      // lost by one line on a long note (generation cc283a63).
      reservedZoneBlock(SOCIAL_ZONES, SOCIAL_FOOTER_NOTE),
      fitToReserveRule(SOCIAL_ZONES, { allowStructuralReflow: true }),
    ].join('\n');
  }

  if (designMode === 'fresh') {
    // NAME THE CLIENT, STATE WHAT CANNOT MOVE, THEN GET OUT OF THE WAY (2026-08-10).
    //
    // Everything that used to sit between those two things is gone: an assigned hex palette, a
    // COLOUR MANDATE, an art director's treatment, an assigned composition archetype, the
    // selected master's structure summary, a "clean, trustworthy, well-organised" house
    // aesthetic, and a `copyStyle` label telling the model which of six shapes to build. It was
    // a specification for a poster, not a brief for a designer, and the renders read exactly
    // like that — correct, legible, and interchangeable. The two libraries feeding it were the
    // giveaway: eleven composition archetypes that were ALL "a flat colour rectangle plus rows
    // of text" (two of them literally "photograph down one side, text down the other"), and
    // eighteen palettes that were all "light ground plus one colour block", because the ground
    // was a product decision rather than a design choice. No amount of rotation between those
    // makes an interesting poster; it only makes a differently-arranged boring one.
    //
    // WHAT STAYS IS THE SET OF THINGS THAT ARE NOT TASTE:
    //   - the Marathi must come out character-exact (a displaced matra is a different word);
    //   - the branding zones must survive, because the badge and footer are composited in code
    //     afterwards and a poster that ignores them ships with its own text destroyed;
    //   - the canvas is 4:5 and carries one poster.
    // Every other decision — composition, colour, imagery, illustration, texture, type — is the
    // model's, and the brief says so in as many words.
    //
    // ONE DELIBERATE EXCEPTION to "no colour guidance", and it is the opposite of a restriction.
    // gpt-image has a very strong "Indian government Marathi poster -> saffron on cream" prior.
    // Measured on eight consecutive live posters BEFORE the palette rotation existed: 5/8 warm
    // cream grounds, 5/8 orange-or-red dominants. Silence does not read as freedom to a prior
    // that strong — it reads as permission to default. So the brief names the two defaults and
    // asks for something other than them, without saying what that something is.
    const freshLines: string[] = [
      "You are an award-winning poster designer working for DGIPR — the Directorate General of Information and Public Relations, Government of Maharashtra, India. This poster goes out on the department's official social media and will be read on a phone by ordinary Maharashtra citizens.",
      '',
      'Design a single, complete 4:5 portrait poster for the Marathi content below. Design it from scratch, as an original piece of work.',
      '',
      'YOU HAVE FULL CREATIVE CONTROL, AND YOU SHOULD USE IT. The composition, the colour palette, the imagery, the illustration style, any photography, the texture and material, the typographic scale and hierarchy, the graphic devices — all of it is yours to decide, and you should decide it boldly. Build the poster around whatever serves THIS message: an illustration, a photograph, hand-drawn artwork, a symbolic graphic, a textured or patterned ground, a large colour field, a strong piece of typography. Give it one clear visual idea and a real focal point, with confident contrast between the largest element and the smallest. Craft, depth and personality are wanted here. Do NOT produce a safe, template-shaped layout of a coloured rectangle above a list of rows — that is the failure mode. A citizen scrolling past should stop because the poster is genuinely good to look at.',
      '',
      'Choose the colours yourself, freely, from the meaning and the mood of the content. Do NOT default to the saffron-orange-and-cream "government paper" look, and do NOT default to a generic government navy-blue-and-white — those are the tired defaults and this poster should not look like either unless the content genuinely calls for it. Light or dark, deep or high-key, vivid or restrained, duotone, gradient or flat are all open to you. The only requirement is that every Marathi word stays effortlessly readable against whatever sits behind it.',
      '',
      'It is an official government communication, so it must be accurate and legible. It does not have to be plain.',
      '',
      // The slot labels in `change` name each piece of text's ROLE. Left unqualified beside a
      // brief this open they read as a layout spec ("BULLET POINTS (in the body list zone)"),
      // which is half of where the row-stack habit came from.
      'CONTENT TO TYPESET — reproduce this Marathi text EXACTLY as written, character for character: every letter, every matra and vowel sign, every conjunct (जोडाक्षर), every anusvara, every Devanagari numeral. Do not re-spell, re-word, translate, transliterate, abbreviate, correct or add to it, and do not drop a line because the composition feels tight. Render it crisply. No English body text. The labels below name what each piece of text IS — they do not tell you where to put it, how large to set it, or what shape to give it; those are your decisions.',
      '',
      change,
    ];
    if (sceneBrief) {
      freshLines.push(
        '',
        // Was "BACKGROUND / HERO IMAGERY", i.e. a photograph in a rectangle behind the type, and
        // its else-branch banned illustration outright ("Do NOT include any photograph, portrait
        // or pictorial illustration") — so imagery was a binary with no middle, and the middle is
        // exactly where good public-information posters live.
        `SUBJECT MATTER — what this poster is about, if you want imagery: ${sceneBrief}`,
        'Treat that as subject, never as a specification. Render it as a photograph, an illustration, line art, a flat-vector scene, a symbolic graphic, a repeated motif, a textured ground — or leave it out entirely and carry the poster on typography and colour alone. Whichever you choose, imagery must never obscure, crowd or compete with the Marathi text.',
      );
    } else {
      freshLines.push(
        '',
        'No specific subject imagery is supplied. Carry the poster however you judge best — typography and colour alone, an abstract or geometric treatment, a symbolic graphic, a motif, or original illustration suited to the message. Nothing here restricts you to text on a plain ground.',
      );
    }
    // The chrome blocks, LAST and in the fixed-template path's order — that path is the one
    // whose posters come back with the branding sitting correctly, and these three blocks are
    // the whole of the difference. Nothing about the STAMP differs between the two modes:
    // both render through overlayTwitterChrome, so the badge and footer bytes are already
    // identical. What differed was only what the prompt reserved for them.
    //
    //   1. paintNoChromeRule — do not invent a badge; a painted one survives BESIDE the real
    //      one. Fresh had the prohibition without the consequence, and no word against the
    //      placeholder BOX that was actually showing up in the corner.
    //   2. reservedZoneBlock — the real 180x170 / 120px reserve, as a proportion the model can
    //      see, with SOCIAL_FOOTER_NOTE naming the footer's navy pill so its last line does not
    //      go under it, and the explicit ban on painting a patch/panel/boundary in either zone.
    //   3. fitToReserveRule — the priority, the consequence and the shrink-headline-first
    //      action. WITHOUT allowStructuralReflow, unlike the fixed-template path: that option
    //      exists to licence departing from a reference's geometry, and a from-scratch render
    //      has no reference geometry to depart from. Shrink-to-fit is the whole recovery here.
    freshLines.push(
      '',
      paintNoChromeRule(SOCIAL_CHROME),
      '',
      reservedZoneBlock(SOCIAL_ZONES, SOCIAL_FOOTER_NOTE),
      '',
      fitToReserveRule(SOCIAL_ZONES),
    );
    return freshLines.join('\n');
  }

  const layoutRule =
    designMode === 'adaptive'
      ? "You MAY re-arrange and resize the template's text zones to best fit the content, but keep its brand colours."
      : "KEEP the master template's overall layout, proportions, brand colour bands and safe margins EXACTLY as in the provided image.";
  const locked = [
    `You are editing a master template for an OFFICIAL DGIPR Maharashtra government poster (type: ${copyStyle}).`,
    layoutRule,
    // Already tells the model to ERASE the master's own chrome, so this branch needs the zone
    // geometry rather than a second erase rule.
    hasPhoto ? PLACEHOLDER_WITH_PHOTO : PLACEHOLDER_TEXT_ONLY,
    reservedZoneBlock(SOCIAL_ZONES, SOCIAL_FOOTER_NOTE),
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
    '',
    fitToReserveRule(SOCIAL_ZONES),
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

  // WHERE the zones are, followed by the rule about the branding ITSELF. The two used to be one
  // sentence, and that sentence said "do NOT alter, move, redraw or remove them" — which an
  // image-edit model, repainting the whole canvas, reads as an instruction to reproduce the
  // badge freehand. Its version does not coincide with the 160x154 badge the API stamps
  // afterwards, so both end up visible (generation cc283a63). The zone geometry also quoted
  // 280x270 for a badge that is really 160x154 at a 6px margin, which is a licence to paint one
  // half as wide again as the real thing; it now quotes the SOCIAL_ZONES reserve, the same
  // figures the initial fixed-template prompt uses.
  //
  // THE FOOTER IS A REAL RESERVE ON THIS LANE, unlike the initial prompts. Feedback edits a
  // FINISHED poster, which already carries its appended strip, and overlayTwitterChrome
  // re-stamps the band in place over the bottom of it rather than appending a second one — so
  // content drawn there really is covered. SOCIAL_ZONES.footerHeight is the band's true
  // footprint (~91px), which is what this lane needs; do not "restore" it to the old 120, which
  // would push content up by 30px on every feedback round and drift the layout.
  const reservedZones =
    input.brand === 'cmo'
      ? 'RESERVED ZONES: the TOP HEADER BAND (the full-width blue leader lockup and the महाराष्ट्र शासन emblem) occupies the top ~19% of the poster, the full-width BOTTOM ~8% footer strip, and the UPPER-RIGHT PHOTO CIRCLE — all three are placed onto the poster by software (the circle holds a photograph placed by software). Keep all three clear: leave the upper-right circle a quiet plain background with no text, subject, ring or outline, and do NOT move any text or important content into those areas.'
      : `RESERVED ZONES: the top-right ${SOCIAL_ZONES.lockupWidth} x ${SOCIAL_ZONES.lockupHeight} px corner and the full-width bottom ${SOCIAL_ZONES.footerHeight} px strip are reserved for official branding that software places onto the finished poster. Keep both clear, and do NOT move any text or important content into them.`;
  const chromeRule = stampedChromeRule(
    input.brand === 'cmo' ? CMO_CHROME : SOCIAL_CHROME,
  );

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
  const textException =
    clear.count > 0 ? ', except as the SPACE TO FREE block requires' : '';

  if (markerCount > 0) {
    return [
      'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single portrait poster.',
      `The input image carries ${markerCount} numbered red annotation marker(s): thin red outline rectangles, each with a small red circular badge showing its number. They were drawn onto the poster by editing software and are NOT part of the poster design.`,
      'Each marker is a pointing gesture showing where one requested change applies — not a hard boundary. For each marker, identify the design element at or around that spot and apply the correspondingly numbered change from the request below to that WHOLE element, even where the element extends beyond the rectangle.',
      `REQUESTED CHANGES: «${imageFeedback}».`,
      `Make ONLY these changes. ${keepRuleMarker}`,
      reservedZones,
      chromeRule,
      'ERASE every red marker rectangle and numbered badge completely from the output, restoring whatever they overlapped — no red outlines, red circles, or annotation numbers may remain anywhere on the poster.',
      `Add no new text, letters, numbers, captions, logos, borders, or decorative elements beyond the requested changes. Preserve all other existing Devanagari text exactly${textException}. Output ONE complete portrait poster filling the canvas, at exactly the same width and height as the input image.`,
      ...inventory,
      ...clear.lines,
    ].join('\n');
  }

  return [
    'You are editing an existing finished DGIPR Maharashtra government social-media poster provided as the input image: a single portrait poster.',
    ...(imageFeedback.length > 0
      ? [`Apply ONLY this requested change: «${imageFeedback}».`]
      : []),
    keepRule,
    reservedZones,
    chromeRule,
    `Add no new text, letters, numbers, captions, logos, borders, or decorative elements. Preserve all existing Devanagari text exactly${textException}. Output ONE complete portrait poster filling the canvas, at exactly the same width and height as the input image.`,
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

      // THE DESIGN SPECIFICATION MUST NOT REACH THE MODEL (2026-08-10). A palette, a layout, an
      // art direction AND a master summary are all supplied above precisely so this asserts they
      // are IGNORED — the fresh lane is a brief now, not a spec. If posters ever go back to
      // reading as one template in rotating colours, check whether these blocks came back.
      //
      // 1. Not one assigned hex may appear. The rotation is still recorded for poster_style; it
      //    just no longer decides what the poster looks like.
      for (const hex of [
        palette.hex.ground,
        palette.hex.panel,
        palette.hex.ink,
        palette.hex.accent,
      ]) {
        if (prompt.includes(hex))
          failures.push(
            `${seed}: assigned hex ${hex} is back in the prompt — the fresh lane chooses its own colours`,
          );
      }
      // 2. …nor any of the four blocks that carried the specification.
      for (const retired of [
        'COLOUR SPECIFICATION',
        'ART DIRECTION',
        'COMPOSITION —',
        'STRUCTURE INSPIRATION',
        // The art direction's own text, in case it is ever inlined without its heading.
        'calm, clinical, reassuring',
        // The assigned archetype's instruction, same reason.
        layout.instruction.slice(0, 40),
      ]) {
        if (prompt.includes(retired))
          failures.push(
            `${seed}: the retired design specification is back in the fresh prompt ("${retired}")`,
          );
      }
      // 3. WHO IT IS FOR is the one thing the brief must say, since it is now carrying the whole
      //    weight of "make it appropriate" that the specification used to carry.
      for (const needle of [
        'DGIPR',
        'Government of Maharashtra',
        'YOU HAVE FULL CREATIVE CONTROL',
      ]) {
        if (!prompt.includes(needle))
          failures.push(`${seed}: the fresh brief lost "${needle}"`);
      }
      // 4. THE FAILURE MODE, NAMED. These prompts respond far better to a described defect than
      //    to an abstraction — the same finding as reserved-zone-rule.ts's "DO NOT CUT A HOLE".
      //    The defect here is the poster the eleven retired archetypes all produced.
      if (!prompt.includes('coloured rectangle above a list of rows'))
        failures.push(
          `${seed}: the fresh brief does not name the template-shaped layout as the failure mode`,
        );
      // 5. THE ANTI-DEFAULT. Not a colour restriction — the opposite. gpt-image's "Indian
      //    government Marathi poster -> saffron on cream" prior measured 5/8 warm cream grounds
      //    across eight consecutive live posters before the rotation existed, and silence reads
      //    to that prior as permission. Removing the spec WITHOUT this is how the lane regresses
      //    to one colourway; it is the single most likely thing to be "cleaned up" by mistake.
      for (const needle of [
        'saffron-orange-and-cream',
        'navy-blue-and-white',
      ]) {
        if (!prompt.includes(needle))
          failures.push(
            `${seed}: the fresh brief no longer names the "${needle}" default it has to push away from`,
          );
      }
      // 6. TEXT FIDELITY IS NOT TASTE and survives the hand-over intact.
      for (const needle of [
        'reproduce this Marathi text EXACTLY',
        'जोडाक्षर',
        'No English body text',
      ]) {
        if (!prompt.includes(needle))
          failures.push(
            `${seed}: the fresh brief lost the text rule "${needle}"`,
          );
      }
      // 7. IMAGERY IS NO LONGER A BINARY. It was: a photograph in a rectangle, or an outright
      //    ban on "any photograph, portrait or pictorial illustration" — so the middle ground
      //    that good public-information posters live in (line art, flat-vector scenes, motifs)
      //    was unreachable by construction.
      if (!prompt.includes('an illustration, line art'))
        failures.push(
          `${seed}: the fresh brief does not offer illustration as an option`,
        );
      if (
        prompt.includes(
          'Do NOT include any photograph, portrait or pictorial illustration',
        )
      )
        failures.push(
          `${seed}: the illustration ban is back — imagery is a binary again`,
        );
    }

    // 4b. THE FIXED-TEMPLATE (ठरलेले टेम्पलेट) BRANCH — the one that renders the officer's
    //     information verbatim, and the one that put a closing paragraph under the footer in
    //     generation cc283a63. The properties below are the fix; if the overlap ever returns,
    //     check them FIRST. It had no assertions at all before.
    const onbrand = buildPosterPrompt({
      copy: {},
      information: 'मुंबई प्रादेशिक हवामान केंद्राने अंदाज जाहीर केला आहे.',
      itemCount: 7,
      copyStyle: 'info_bullets',
      designMode: 'onbrand',
      brand: 'dgipr',
      masterUrl: 'https://example.test/master.png',
      hasPhoto: true,
    });
    // (a) The reserve must WIN. It lost because nothing said it outranked completeness.
    if (!onbrand.includes('OUTRANKS'))
      failures.push(
        'fixed-template prompt does not rank the reserve over completeness',
      );
    // (b) The consequence. "Reserved for branding" never said the words are destroyed.
    if (!onbrand.includes('COVERED AND LOST'))
      failures.push(
        'fixed-template prompt does not state what happens under the band',
      );
    // (c) The action. Without it the model has a rule it cannot satisfy and no way out.
    if (!onbrand.includes('Shrink the HEADLINE first'))
      failures.push(
        'fixed-template prompt does not say to shrink the headline',
      );
    // The weather poster in generation 608037ba kept the reference's narrow text column even
    // though its closing advisory could have widened across the adjacent photograph. The
    // reference must guide the result without pixel-locking the geometry, and the fit rule must
    // name that concrete recovery rather than offering only smaller type.
    if (!onbrand.includes('PRIMARY STRUCTURAL GUIDE'))
      failures.push(
        'fixed-template prompt still treats the reference as a geometry lock',
      );
    if (!onbrand.includes('SMART REFLOW WHEN CONTENT DOES NOT FIT'))
      failures.push('fixed-template prompt lost the smart-reflow rule');
    if (
      !onbrand.includes(
        'extend that component sideways across the adjacent image',
      )
    )
      failures.push(
        'fixed-template prompt does not permit a closing panel to borrow image space',
      );
    if (onbrand.includes('AUTHORITATIVE VISUAL STRUCTURE'))
      failures.push(
        'fixed-template prompt restored the pixel-locked authoritative-structure wording',
      );
    // (d) The clause that was an explicit licence to use the footer strip.
    if (onbrand.includes('use more of the canvas'))
      failures.push(
        'fixed-template prompt still offers "use more of the canvas"',
      );
    // (e) "Fill the usable canvas" must not read as the full 1600px height.
    if (
      !onbrand.includes('the USABLE CANVAS is the area above the bottom margin')
    )
      failures.push('fixed-template prompt leaves "usable canvas" undefined');
    // (f) Position. It sat second-to-last under three louder rules; last is what these
    //     models weight most (the clear-space rule is asserted the same way below).
    if (!onbrand.trimEnd().endsWith('cross into either reserved zone.'))
      failures.push(
        'the fit rule is not the last block of the fixed-template prompt',
      );
    if (
      onbrand.indexOf('RESERVED BADGE CORNER') <
      onbrand.indexOf('SHOW ALL OF THE')
    )
      failures.push(
        'reserved zones precede the completeness rule they must outrank',
      );
    // (g) The geometry itself must survive, and must still match twitter-chrome.ts — plus the
    //     rule that keeps the badge corner from being cut OUT of the artwork. This lane is
    //     where that failed: a render stopped its navy header panel short of the corner and
    //     left a pale notch around the stamped badge, because the block forbade a "panel" from
    //     crossing the zone. See reserved-zone-rule.ts.
    for (const needle of [
      'top-right 180 x 170 pixels',
      '1280 x 1600 output',
      'y=1584',
      'THE BOTTOM EDGE IS A JOIN, NOT A COVER ZONE',
      'DO NOT CUT A HOLE IN IT',
      'continue through unbroken',
      'CLEAR OF CONTENT, NOT CLEAR OF DESIGN',
      // THE 173-PIXEL DEAD BAND (generation 97b64542): 82px of flat grey the model left above
      // the bottom edge, plus the 91px strip footer-extension.ts then filled from it. The
      // bottom is an edge the design runs off, not a reserve — see reserved-zone-rule.ts.
      'DESIGN ALL THE WAY DOWN TO THE VERY BOTTOM EDGE',
      'THERE IS NO COLOUR RESTRICTION AT THE BOTTOM',
      'the design itself must reach the bottom edge',
    ]) {
      if (!onbrand.includes(needle))
        failures.push(`fixed-template prompt lost "${needle}"`);
    }
    if (onbrand.includes('calm, plain, even background'))
      failures.push(
        'fixed-template prompt restored the plain-background bottom reserve that letterboxed the poster',
      );
    // THE DARK POSTER (same generation): mean luminance 153/255 with a black column over a third
    // of the canvas. "Strong contrast" is satisfied by white-on-black, so the rule that was
    // missing names which side of the contrast the large areas sit on.
    if (!onbrand.includes('MAKE IT BRIGHT, VIVID AND EYE-CATCHING'))
      failures.push(
        'fixed-template prompt lost the brightness rule, so free colour choice can go dark again',
      );
    if (
      onbrand.indexOf('MAKE IT BRIGHT') <
      onbrand.indexOf('controls STRUCTURE ONLY, not colour')
    )
      failures.push(
        'the brightness rule precedes the free-colour clause it has to qualify',
      );
    // (g2) THE OVERSIZED HEADLINE. The poster that prompted the appended footer carried a
    //      three-line headline over roughly a third of the canvas with its last bullet pushed
    //      off the bottom. fitToReserveRule does say "shrink the headline first", but on this
    //      lane it is reached through allowStructuralReflow, which offers a paragraph of
    //      re-layout options ahead of it — so the proportion is also stated up beside the
    //      completeness pressure it has to answer, where it acts before the layout is committed.
    if (!onbrand.includes('KEEP THE HEADLINE PROPORTIONATE TO THE REST'))
      failures.push(
        'fixed-template prompt lost the headline proportion cap, which is where the room comes from',
      );
    if (
      onbrand.indexOf('KEEP THE HEADLINE PROPORTIONATE') >
      onbrand.indexOf('REPRODUCE THE MARATHI TEXT EXACTLY')
    )
      failures.push(
        'the headline cap sits below the layout rules it has to constrain',
      );
    // (g3) Same appended-footer honesty check as the fresh lane below.
    for (const retired of [
      'navy-blue ministry title pill',
      'pastes an OPAQUE full-width band',
      'bottom 120 pixels',
    ]) {
      if (onbrand.includes(retired))
        failures.push(
          `fixed-template prompt still treats the footer as an overlay ("${retired}") — it is appended below the artwork by overlayTwitterChrome`,
        );
    }
    // (h) THE DUPLICATED BADGE (generation cc283a63). "Do not add a logo" was not enough
    //     against a reference the prompt calls authoritative and which carries real chrome:
    //     the model copied it and the API stamped the real one beside it. If a painted
    //     महाराष्ट्र शासन badge or footer ever comes back, check these three first.
    if (!onbrand.includes('PLACEHOLDER CHROME — COPY NONE OF IT'))
      failures.push(
        "fixed-template prompt does not mark the reference's branding as placeholder",
      );
    if (!onbrand.includes('survives BESIDE the real branding'))
      failures.push(
        'fixed-template prompt does not say a painted logo becomes a duplicate',
      );
    if (!onbrand.includes('does NOT free up usable space'))
      failures.push(
        'fixed-template prompt lost the guard against reflowing into the freed zone',
      );
    // The bare pair it replaces: too weak on its own, and their presence would mean the
    // stronger rule had been reverted rather than added to.
    if (/Do not add a logo\.\nDo not add a footer\./.test(onbrand))
      failures.push(
        'fixed-template prompt still relies on the bare no-logo/no-footer pair',
      );
    // (i) THE REPEATED INFORMATION (generation 7c33fa93 — five dated alerts rendered twice,
    //     once as a paragraph column and again as dated cards). The prompt said show
    //     everything, match the reference's density and do not leave slots empty, and never
    //     said each item appears ONCE. These five are the fix; if content ever comes back
    //     duplicated across two panels, check them FIRST.
    if (!onbrand.includes('USE EACH ITEM EXACTLY ONCE'))
      failures.push('fixed-template prompt lost the no-repetition rule');
    if (!onbrand.includes('LEAVING SPACE EMPTY IS CORRECT'))
      failures.push(
        'fixed-template prompt does not permit empty space, so surplus slots invite repetition',
      );
    if (!onbrand.includes('and exactly 7 — no more'))
      failures.push(
        'the item count is not stated as a ceiling as well as a floor',
      );
    // The three clauses that each licensed a duplicate. Their return is the regression.
    for (const licence of [
      'leave large blank or unused areas', // density rule with no upper bound
      'fill it only with other source-supported poster content', // by then, everything already shown
      "EXTEND the reference's item pattern", // the shortfall clause, deleted outright
    ]) {
      if (onbrand.includes(licence))
        failures.push(
          `fixed-template prompt still licences a repeat: "${licence}"`,
        );
    }
    // "repeat" may appear in this prompt ONLY as a prohibition. The one legitimate other use is
    // the shared fit rule's "Repeat until everything clears the band" (an iteration, about the
    // model's own layout passes, not about content), so the check is aimed at the shape the
    // deleted shortfall clause had: repeat + the reference's rows/cards/pattern.
    if (/repeat (its|the reference)/i.test(onbrand))
      failures.push(
        "fixed-template prompt tells the model to repeat the reference's rows/cards again",
      );

    // 4c. THE FULLY-AI ('fresh') BRANCH. Two reported defects on real posters — an oversized
    //     white box in the top-right corner, and a footer covering the last line of text — and
    //     both were the prompt, not the stamp: fresh and fixed-template render through the SAME
    //     overlayTwitterChrome. Fresh quoted a retired 280x270 / 130px reserve (three times the
    //     badge's real area), described the badge it was reserving for, called the two-part
    //     footer one strip, and buried the whole thing mid-prompt. It now emits the same three
    //     blocks as the fixed-template path. If either defect returns, check these FIRST.
    const freshPrompt = buildPosterPrompt({
      copy: COPY,
      copyStyle: 'info_bullets',
      designMode: 'fresh',
      brand: 'dgipr',
      masterUrl: '',
      hasPhoto: true,
    });
    if (!freshPrompt.trimEnd().endsWith('cross into either reserved zone.'))
      failures.push('the fresh prompt does not end on the fit rule');
    // (a) ONE geometry across the whole file, and it is the real one.
    for (const needle of [
      'top-right 180 x 170 pixels',
      '1280 x 1600 output',
      'y=1584',
      'DESIGN ALL THE WAY DOWN TO THE VERY BOTTOM EDGE',
    ]) {
      if (!freshPrompt.includes(needle))
        failures.push(`the fresh prompt lost "${needle}"`);
    }
    // The brightness rule is deliberately fixed-template ONLY: on this lane the palette rotation
    // assigns exact hexes, and a second voice telling the model to brighten them would licence
    // departing from a specification whose whole point is that it is not negotiable.
    if (freshPrompt.includes('MAKE IT BRIGHT'))
      failures.push(
        'the fresh prompt carries the brightness rule, which competes with its assigned hex palette',
      );
    for (const retired of ['280 x 270', 'bottom 130 pixels', '280x270']) {
      if (freshPrompt.includes(retired))
        failures.push(
          `the fresh prompt still quotes the retired reserve "${retired}" — it is 3x the stamped badge and is what left a box in the corner`,
        );
    }
    // (b) The footer is APPENDED on this lane, so the prompt must not present it as an
    //     overlay. The navy-pill note and the "band pasted over the bottom" consequence were
    //     both written for a footer that could bury a line; neither is true any more, and a
    //     threat the model's own render disproves teaches it that this prompt's threats are
    //     negotiable. It must also not ask for the ~120px void the band no longer occupies,
    //     which would letterboard the poster above its own footer.
    for (const retired of [
      'navy-blue ministry title pill',
      'pastes an OPAQUE full-width band',
      'bottom 120 pixels',
    ]) {
      if (freshPrompt.includes(retired))
        failures.push(
          `the fresh prompt still treats the footer as an overlay ("${retired}") — it is appended below the artwork by overlayTwitterChrome`,
        );
    }
    if (
      !freshPrompt.includes(
        'do not leave a large empty gap above the bottom edge',
      )
    )
      failures.push(
        'the fresh prompt does not ask for the full canvas height, so posters will letterbox above the appended footer',
      );
    // (c) The corner BOX. The old wording described the badge being reserved for and only
    //     softly discouraged leaving the zone plain; this names the artefact outright.
    if (!freshPrompt.includes('blank or differently-coloured rectangle, patch'))
      failures.push(
        'the fresh prompt does not forbid painting a box/panel in the reserved zones',
      );
    // (c2) …and the other half of the same problem: the corner must not be cut OUT of the
    //      artwork either. A real ठरलेले टेम्पलेट render stopped its header panel short of
    //      the badge and left a pale notch — see reserved-zone-rule.ts.
    for (const needle of [
      'DO NOT CUT A HOLE IN IT',
      'continue through unbroken',
    ]) {
      if (!freshPrompt.includes(needle))
        failures.push(
          `the fresh prompt does not require the background to continue under the badge ("${needle}")`,
        );
    }
    if (/white rounded-square[^.]*badge\) /.test(freshPrompt))
      failures.push(
        'the fresh prompt describes the badge inside its zone geometry, which invites painting one',
      );
    // (d) The duplicate consequence — the reason the model prefers an empty corner over a
    //     plausible painted badge. Fresh had the prohibition without it.
    if (!freshPrompt.includes('survives BESIDE the real branding'))
      failures.push(
        'the fresh prompt states the no-branding rule without its consequence',
      );
    // (e) Structural reflow is the fixed-template path's licence to depart from a REFERENCE's
    //     geometry. A from-scratch render has none, so fresh takes the strict shrink-to-fit.
    if (freshPrompt.includes('SMART REFLOW WHEN CONTENT DOES NOT FIT'))
      failures.push(
        'the fresh prompt carries the reference-geometry reflow licence, which it has no reference for',
      );
    if (!freshPrompt.includes('Shrink the HEADLINE first'))
      failures.push('the fresh prompt lost the shrink-to-fit recovery action');
    // (f) REFERENCE-FREE. As of 2026-08-07 the runner resolves no master for a fresh run, so
    //     the prompt must stand up with no masterUrl and no layoutSummary and must borrow no
    //     structure from anywhere: the assigned COMPOSITION is the whole structural
    //     instruction. `freshPrompt` above is already built that way — this asserts it is a
    //     supported shape rather than an accident, since the fixed-template branch still
    //     throws without a master.
    if (!freshPrompt.includes('Design it from scratch'))
      failures.push(
        'the reference-free fresh prompt no longer says the poster is designed from scratch',
      );
    if (freshPrompt.includes('STRUCTURE INSPIRATION'))
      failures.push(
        'the fresh prompt emitted a STRUCTURE INSPIRATION block with no master to take one from',
      );

    // (g) A run whose copy carries NO scene_brief must still be told it may use imagery. This
    //     was the else-branch that banned illustration outright, so a text-only note could only
    //     ever come back as type on a flat ground — the other half of "they all look the same".
    const freshNoSubject = buildPosterPrompt({
      copy: { ...COPY, scene_brief: '' } as unknown as PosterCopy,
      copyStyle: 'info_bullets',
      designMode: 'fresh',
      brand: 'dgipr',
      masterUrl: '',
      hasPhoto: false,
    });
    if (
      !freshNoSubject.includes(
        'Nothing here restricts you to text on a plain ground',
      )
    )
      failures.push(
        'a fresh run with no subject imagery is not told it may still use illustration or texture',
      );
    if (/TEXT-ONLY/.test(freshNoSubject))
      failures.push(
        'the fresh no-imagery branch restored the TEXT-ONLY lock, which banned illustration',
      );

    // 5. The clear-space (blue box) feedback path. The properties that matter are that the
    //    block only appears when asked for, that it survives beside red markers, that it can
    //    stand alone with no typed text at all, that it never proposes emptying the area
    //    into a panel or a different colour — and, above all, that a DISPLACE round does not
    //    also carry "keep the exact layout unchanged". It must instead require the minimum
    //    complete-parent movement and exact element multiplicity: shifting a row stack already
    //    moves its child icon, so painting that icon again elsewhere is a regression.
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

    // 4d. THE FEEDBACK BRANCH THAT PRODUCED THE DUPLICATE BADGE. The officer drew a blue box
    //     to move text out from under the logo and got a SECOND logo, because the reserved-zone
    //     sentence said "do NOT alter, move, redraw or remove them" — read by a model that
    //     repaints the whole canvas as "redraw the badge freehand". Every feedback shape must
    //     now carry the erase rule instead.
    for (const [label, prompt] of [
      ['plain', plainFeedback],
      [
        'marker',
        buildFeedbackPrompt({
          imageFeedback: 'शीर्षक मोठे करा',
          brand: 'dgipr',
          markerCount: 2,
        }),
      ],
      [
        'clear-space',
        buildFeedbackPrompt({
          imageFeedback: '',
          brand: 'dgipr',
          clearActions: ['displace'],
        }),
      ],
      [
        'cmo',
        buildFeedbackPrompt({ imageFeedback: 'तारीख बदला', brand: 'cmo' }),
      ],
    ] as const) {
      if (!prompt.includes('DO NOT REPRODUCE IT'))
        failures.push(
          `${label} feedback prompt does not forbid redrawing the chrome`,
        );
      if (!prompt.includes('ERASE both of them'))
        failures.push(
          `${label} feedback prompt does not ask for the chrome to be erased`,
        );
      if (!prompt.includes('survives BESIDE the real branding'))
        failures.push(
          `${label} feedback prompt does not state the duplicate consequence`,
        );
      // The erase rule contradicts "keep the input unchanged" / "preserve all existing
      // Devanagari text" (the footer band carries text), so it has to say which wins.
      if (!prompt.includes('OVERRIDES any instruction above'))
        failures.push(
          `${label} feedback prompt lets keep-unchanged beat the chrome rule`,
        );
      // The sentence that caused it. Its return is the regression.
      if (/do NOT alter, move, redraw or remove them/.test(prompt))
        failures.push(
          `${label} feedback prompt restored the "do not redraw" wording`,
        );
      if (!prompt.includes('does NOT free up usable space'))
        failures.push(`${label} feedback prompt lost the reflow guard`);
    }
    // The zone geometry now quotes the reserve the initial prompt uses, not a 280x270 badge
    // that does not exist — a figure that licensed a badge half as wide again as the real one.
    if (!plainFeedback.includes('top-right 180 x 170 px corner'))
      failures.push(
        'feedback reserve no longer matches the initial fixed-template reserve',
      );
    if (plainFeedback.includes('280x270'))
      failures.push('feedback prompt still describes the badge as 280x270');

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
      'TARGET AREA',
      'least disruptive complete-group movement',
      'Do not perform the move twice',
      'Preserve the original number of copies',
      'do NOT add another copy anywhere else',
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
    if (!cleared.includes('INFORMATION and ELEMENT COUNTS are fixed'))
      failures.push('displace round lost the exact-multiplicity replacement');
    if (
      !cleared.includes(
        'keeping every child icon, text block and image attached',
      )
    )
      failures.push('displace round lost the parent-child preservation rule');
    if (cleared.includes('visibly rearranged poster is a CORRECT result'))
      failures.push(
        'displace round kept the over-broad visible-redesign instruction',
      );

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
      contentInventory: [
        'पिण्याचे पाणी १५ मिनिटे उकळून घ्या',
        'शिळे अन्न टाळा',
      ],
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
