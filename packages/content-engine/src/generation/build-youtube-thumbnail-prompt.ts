// Assemble the gpt-image prompt that edits a reference template into a finished YouTube
// thumbnail, and the prompt that applies a pixel-feedback edit to an existing one.
// Pure string assembly, no model call.
//
// This is the ट्विटर 'onbrand' fixed-template prompt (build-poster-prompt.ts) re-cut for a
// 1280x720 frame. Five blocks are carried over VERBATIM and must stay that way — they are
// the ones that path proved out, each fixing a specific observed failure:
//
//   COMPLETENESS      the officer's text IS the content, not source material to edit down
//   TEXT FIDELITY     a misplaced Marathi matra changes the word
//   STRUCTURE ONLY    the reference supplies geometry, never meaning or colour
//   CONTENT FIREWALL  every word/number/QR/logo in the reference is unrelated placeholder
//   ARTEFACT FILTER   वृत्त. क्र., page numbers and scan marks are not poster information
//
// What is genuinely different, and why:
//   - a thumbnail is read at a glance on a phone tile, so it carries FAR less text than a
//     4:5 poster. The completeness rule and the brevity rule pull against each other on
//     purpose: show every item, but as headline-weight text, not paragraphs.
//   - the reserved zones are the youtube ones (top-right 130x130 lockup, bottom 70px
//     yt-footer.png) and must stay in sync with poster-renderer/src/youtube-chrome.ts,
//     whose free harness (`poster:preview:chrome:youtube`) ASSERTS the stamped chrome
//     fits inside exactly these numbers.
//   - a PEOPLE rule. These thumbnails conventionally carry a cut-out portrait of the
//     official the video is about; the reference supplies that arrangement, and the model
//     is told to introduce a person ONLY where the supplied information names one.
//
// KNOWN TRADE, stated so nobody "fixes" it by accident: on this path gpt-image paints the
// Devanagari, which opts out of the repo's poster doctrine (paint no text; typeset it with
// Chromium). TEXT FIDELITY below is therefore an INSTRUCTION, not a guarantee. If misplaced
// matras become a real problem the fix is the Chromium path, not a stronger sentence.

import { pathToFileURL } from 'node:url';
import {
  clearSpaceRule,
  contentInventoryLines,
  DISPLACE_PRESERVE_RULE,
  type ClearAction,
} from './clear-space-rule.js';
import {
  fitToReserveRule,
  referenceChromeRule,
  reservedZoneBlock,
  stampedChromeRule,
  type ReservedZoneGeometry,
  type StampedChrome,
} from './reserved-zone-rule.js';

/** The canvas every thumbnail prompt, render and chrome overlay on this lane assumes. */
export const YOUTUBE_THUMBNAIL_DIMENSIONS = {
  width: 1280,
  height: 720,
} as const;

// Keep in sync with poster-renderer/src/youtube-chrome.ts. The harness there measures the
// stamped chrome against these very numbers, so a drift is caught for free rather than
// shipping as a headline sitting behind the footer band.
const RESERVED_LOCKUP_WIDTH = 130;
const RESERVED_LOCKUP_HEIGHT = 130;
const RESERVED_FOOTER_HEIGHT = 70;

// The same shape the poster lane uses, so the two cannot drift apart on a rule that was
// already copied verbatim between them once. See reserved-zone-rule.ts.
const THUMBNAIL_ZONES: ReservedZoneGeometry = {
  width: YOUTUBE_THUMBNAIL_DIMENSIONS.width,
  height: YOUTUBE_THUMBNAIL_DIMENSIONS.height,
  lockupWidth: RESERVED_LOCKUP_WIDTH,
  lockupHeight: RESERVED_LOCKUP_HEIGHT,
  footerHeight: RESERVED_FOOTER_HEIGHT,
};

export type BuildYoutubeThumbnailPromptInput = Readonly<{
  // The officer's information, VERBATIM. Not a "note about" the thumbnail — it IS the
  // thumbnail's content, and every item of it must appear.
  information: string;
  // How many distinct items `information` contains, counted by the reference selector
  // (select-by-information.ts). Stated as a number the model can check its own output
  // against rather than as a sentiment.
  itemCount?: number | undefined;
  // Set only when no reference in the library can show that many items. The model is then
  // told to extend the reference's item pattern — explicitly, because its default response
  // to too much content is to drop some.
  slotShortfall?: { needed: number; available: number } | undefined;
}>;

// --- the blocks carried over verbatim from the onbrand poster prompt -------------------

const TEXT_FIDELITY =
  'REPRODUCE THE MARATHI TEXT EXACTLY. Copy every word character for character from the supplied information: every Devanagari letter, every matra and vowel sign, every conjunct (जोडाक्षर), every anusvara and every numeral, exactly as written and in the same order. Do not re-spell, re-word, translate, transliterate, correct, abbreviate, or "improve" any word. Do not drop or reposition a matra. Do not break a conjunct into separate letters. Marathi words rendered with a misplaced or missing matra are wrong even if they look plausible — re-read each word against the supplied text before finishing.';

const STRUCTURE_ONLY =
  'Use the provided reference image as the AUTHORITATIVE VISUAL STRUCTURE for the thumbnail. Preserve its overall composition, section placement, proportions, content distribution, imagery zones, visual balance, and density while replacing its information. STRUCTURE means only geometry and visual hierarchy—not the meaning, factual content, or element type of any reference slot. Do not redesign the structure, compress everything onto one side, or leave large blank or unused areas. Fill the usable canvas as efficiently as the reference image does — the USABLE CANVAS is the area above the reserved bottom strip and outside the reserved top-right corner, never the full height of the frame.';

const COLOUR_FREE =
  "The reference image controls STRUCTURE ONLY, not colour. Choose the thumbnail's colour palette freely and creatively; ensure strong contrast and easy readability for every Marathi word and Devanagari numeral, including when the frame is viewed small.";

const CONTENT_FIREWALL =
  'REFERENCE-CONTENT FIREWALL: treat every word, numeral, date, year, URL, domain, app name, contact detail, identifier, logo, emblem, QR code, barcode, and factual claim visible in the reference image as unrelated placeholder content. Copy NONE of it. Every textual, numeric, coded, or factual element in the output must be directly supported by the supplied information. Never invent or infer a missing date, link, QR code, identifier, or fact merely to fill a reference slot. If the supplied information has no matching content for a reference element, KEEP the successful reference layout and its surrounding spacing, but make that slot visually neutral using the thumbnail’s background/design treatment, or fill it only with other source-supported content or relevant non-informational imagery. Do not reflow or redesign the overall composition just because a reference slot is unsupported.';

const ARTEFACT_FILTER =
  'DOCUMENT-ARTIFACT FILTER: never put source-document production metadata on the thumbnail—page numbers, वृत्त. क्र., issue/report/file/document numbers, running headers or footers, filenames, scan marks, OCR artifacts, or similar administrative labels are not thumbnail information, even if they appear in the supplied text.';

// --- the blocks specific to a thumbnail ------------------------------------------------

// The brevity rule. A 4:5 poster is read held in the hand; a thumbnail is read at ~320px
// wide in a list. Stated as a legibility test rather than a word count, because the
// information's own length varies and a count would either truncate it or pad it.
const THUMBNAIL_FORM = [
  `THIS IS A YOUTUBE THUMBNAIL, NOT A POSTER. One single ${YOUTUBE_THUMBNAIL_DIMENSIONS.width} x ${YOUTUBE_THUMBNAIL_DIMENSIONS.height} landscape 16:9 frame, read at a glance on a small phone tile.`,
  'Set the text with THUMBNAIL WEIGHT: one dominant Marathi headline as the largest element by far, with any remaining supplied details (date, time, venue, a short supporting line) set clearly smaller beneath or beside it. Every word must still be readable when the whole frame is shrunk to 320 pixels wide — if a line would not survive that, it is set too small or there is too much of it competing. Never fill the frame with paragraphs or with running body text.',
].join('\n');

const DESIGN_SUITS_MESSAGE =
  'MAKE THE DESIGN SUIT THE MESSAGE. Judge from the supplied information what kind of video this is — a live broadcast, an inauguration or लोकार्पण, a scheme launch, an announcement, a review meeting, an interview — and make the finished thumbnail read unmistakably as that through its colour choice, imagery and emphasis. Take this from the INFORMATION, never from whatever the reference image happens to be about: the reference’s own topic is unrelated placeholder content.';

// People. The convention these thumbnails follow is a cut-out portrait of the official the
// video concerns, so the arrangement is inherited from the reference — but a person is
// introduced only where the information names one, or the model will invent an official
// for a thumbnail that is about a department, a scheme or a deadline.
const PEOPLE_RULE =
  'PEOPLE: if the reference image places a cut-out portrait of a person, keep that arrangement — same side, same scale, same cut-out treatment against the background — and depict the person the supplied information names, dressed and presented as a senior Maharashtra government figure would be. Introduce a person ONLY where the supplied information names one; where it names nobody, use that area for the thumbnail’s own design treatment or supported imagery instead of inventing an official. Never place a face, a person or a portrait inside the reserved zones below.';

// What youtube-chrome.ts stamps, described as the model sees it — on the reference template it
// is editing (initial) and on the finished thumbnail it is editing (feedback). The sixth block
// carried over from the poster lane, and for the same reason as the other five: it fixes an
// observed failure there (a duplicated महाराष्ट्र शासन badge, generation cc283a63).
const THUMBNAIL_CHROME: StampedChrome = {
  surface: 'thumbnail',
  lockup: 'महाराष्ट्र शासन emblem-and-wordmark badge in the top-right corner',
  footer: 'full-width department strip along the bottom',
};

const RESERVED_ZONES = reservedZoneBlock(
  THUMBNAIL_ZONES,
  'That branding is a government emblem badge in the top-right corner and a full-width department strip along the bottom.',
);

/**
 * The initial thumbnail prompt: edit the chosen reference template into a finished
 * 1280x720 frame carrying the officer's information.
 */
export function buildYoutubeThumbnailPrompt(
  input: BuildYoutubeThumbnailPromptInput,
): string {
  const information = input.information.trim();
  if (information.length === 0)
    throw new Error('No information provided for the thumbnail.');

  // COMPLETENESS. The officer's text is the thumbnail's content, not source material to
  // edit down — the poster path lost points this way, a seven-item note coming back as a
  // four-item poster, and the two clauses that caused it ("never paste the entire input",
  // "select only the most important information") are deliberately absent here too.
  const completeness = [
    // "or use more of the canvas" is deliberately GONE — the only space left over on this
    // frame is the reserved footer strip, so that clause invited content under branding that
    // is stamped on afterwards. See reserved-zone-rule.ts.
    'SHOW ALL OF THE INFORMATION. Every distinct point, name, designation, date, time, venue, figure and fact in the supplied information must appear on the thumbnail. Do not omit any of it, do not summarise it, and do not merge two points into one because the layout feels tight. If space is short, reduce the type size within the legibility rule above and tighten the spacing until it fits — never drop content, and never run content into the reserved zones described at the end of these instructions.',
  ];
  const itemCount = input.itemCount;
  if (typeof itemCount === 'number' && itemCount > 0) {
    completeness.push(
      `The supplied information contains ${itemCount} distinct item(s). The finished thumbnail must show all ${itemCount}. Count them in your output before finishing.`,
    );
  }
  const shortfall = input.slotShortfall;
  if (shortfall) {
    completeness.push(
      `IMPORTANT: the reference image lays out about ${shortfall.available} item(s), but there are ${shortfall.needed} to show. EXTEND the reference's item pattern — repeat its rows/lines to the number needed, keeping their styling, alignment and spacing consistent, and shrink them proportionally so all ${shortfall.needed} fit within the usable canvas. Adding rows in the reference's own style is correct here; dropping items is not.`,
    );
  }

  return [
    'Using the given reference image, generate a YouTube video thumbnail for this information:',
    '',
    information,
    '',
    THUMBNAIL_FORM,
    ...completeness,
    TEXT_FIDELITY,
    DESIGN_SUITS_MESSAGE,
    STRUCTURE_ONLY,
    COLOUR_FREE,
    PEOPLE_RULE,
    CONTENT_FIREWALL,
    ARTEFACT_FILTER,
    // "Do not add a logo. Do not add a footer." was the whole of this rule and did not hold on
    // the poster lane: the reference is a finished frame carrying its own chrome, STRUCTURE ONLY
    // above has just called it authoritative, and the model copied the badge it could see.
    `${referenceChromeRule(THUMBNAIL_CHROME)} Do not add a channel name either.`,
    'Use only Marathi text and Devanagari numerals in the output. Use Nirmala UI for all text.',
    // Geometry, then the rule that makes it outrank the completeness clauses above — LAST,
    // which is the position these models weight most.
    RESERVED_ZONES,
    fitToReserveRule(THUMBNAIL_ZONES),
  ].join('\n');
}

export type BuildYoutubeFeedbackPromptInput = Readonly<{
  imageFeedback: string;
  markerCount?: number | undefined;
  // The lettered BLUE rectangles in draw order, each saying what happens to the
  // content inside ('remove' deletes it, 'displace' keeps it and licenses a
  // re-layout). Empty/absent = the pre-feature prompt, byte-for-byte.
  clearActions?: readonly ClearAction[] | undefined;
  // The checklist a displace re-layout must not lose, read off the current thumbnail.
  contentInventory?: readonly string[] | undefined;
}>;

/**
 * Pixel/marker feedback on an existing thumbnail. The twin of buildFeedbackPrompt, with
 * the youtube canvas and reserved zones; the marker and clear-space semantics are shared
 * (clearSpaceRule) so the lanes cannot drift apart on the gesture the officer drew.
 */
export function buildYoutubeFeedbackPrompt(
  input: BuildYoutubeFeedbackPromptInput,
): string {
  const imageFeedback = input.imageFeedback.trim();
  const markerCount = Math.max(
    0,
    Math.min(3, Math.trunc(Number(input.markerCount) || 0)),
  );
  const clear = clearSpaceRule(input.clearActions ?? []);
  // A clear-space round is a complete request on its own — the blue rectangles say what to
  // do and the note is optional — so text is required only without them.
  if (imageFeedback.length === 0 && clear.count === 0)
    throw new Error('No image feedback provided.');
  const inventory = clear.hasDisplace
    ? contentInventoryLines(input.contentInventory)
    : [];

  // Geometry, then the branding itself. The old single sentence ended "do NOT alter, move,
  // redraw or remove them", which an image-edit model repainting the whole frame reads as
  // "reproduce them" — and a freehand copy does not coincide with what the chrome overlay
  // stamps afterwards, so both stay visible. See reserved-zone-rule.ts.
  const reservedZones = `RESERVED ZONES: the top-right ${RESERVED_LOCKUP_WIDTH} x ${RESERVED_LOCKUP_HEIGHT} px corner and the full-width bottom ${RESERVED_FOOTER_HEIGHT} px strip are reserved for official branding that software places onto the finished thumbnail. Keep both clear, and do NOT move any text or important content into those areas.`;
  const chromeRule = stampedChromeRule(THUMBNAIL_CHROME);

  // A DISPLACE round cannot keep the exact layout — that is the point of it — so the
  // keep-layout rule is REPLACED rather than hedged. DELETE-only keeps it, with the
  // exception clause, since the delete itself changes the thumbnail.
  const exceptClause =
    clear.count > 0 ? ' or the SPACE TO FREE block below' : '';
  const keepRule = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where the requested change${exceptClause} explicitly requires it.`;
  const keepRuleMarker = clear.hasDisplace
    ? DISPLACE_PRESERVE_RULE
    : `Keep the exact layout, existing Marathi text and figures, colours, typography, and imagery unchanged except where a requested change${exceptClause} explicitly requires it.`;
  const textException =
    clear.count > 0 ? ', except as the SPACE TO FREE block requires' : '';
  const opening = `You are editing an existing finished DGIPR Maharashtra government YouTube thumbnail provided as the input image: a single ${YOUTUBE_THUMBNAIL_DIMENSIONS.width} x ${YOUTUBE_THUMBNAIL_DIMENSIONS.height} landscape 16:9 frame.`;
  const closing = `Output ONE complete ${YOUTUBE_THUMBNAIL_DIMENSIONS.width} x ${YOUTUBE_THUMBNAIL_DIMENSIONS.height} landscape 16:9 thumbnail filling the canvas.`;

  if (markerCount > 0) {
    return [
      opening,
      `The input image carries ${markerCount} numbered red annotation marker(s): thin red outline rectangles, each with a small red circular badge showing its number. They were drawn onto the thumbnail by editing software and are NOT part of the design.`,
      'Each marker is a pointing gesture showing where one requested change applies — not a hard boundary. For each marker, identify the design element at or around that spot and apply the correspondingly numbered change from the request below to that WHOLE element, even where the element extends beyond the rectangle.',
      `REQUESTED CHANGES: «${imageFeedback}».`,
      `Make ONLY these changes. ${keepRuleMarker}`,
      reservedZones,
      chromeRule,
      'ERASE every red marker rectangle and numbered badge completely from the output, restoring whatever they overlapped — no red outlines, red circles, or annotation numbers may remain anywhere on the thumbnail.',
      `Add no new text, letters, numbers, captions, logos, borders, or decorative elements beyond the requested changes. Preserve all other existing Devanagari text exactly${textException}. ${closing}`,
      ...inventory,
      ...clear.lines,
    ].join('\n');
  }

  return [
    opening,
    ...(imageFeedback.length > 0
      ? [`Apply ONLY this requested change: «${imageFeedback}».`]
      : []),
    keepRule,
    reservedZones,
    chromeRule,
    `Add no new text, letters, numbers, captions, logos, borders, or decorative elements. Preserve all existing Devanagari text exactly${textException}. ${closing}`,
    ...inventory,
    ...clear.lines,
  ].join('\n');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/build-youtube-thumbnail-prompt.ts
// Pure string assembly — no model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const INFORMATION = [
    'मुख्यमंत्री देवेंद्र फडणवीस यांच्या हस्ते',
    "'गोदाम लॉजिस्टिक पार्क'चे लोकार्पण",
    'दि. २१ मे २०२६',
    'वेळ : दुपारी ३.०० वाजता',
    'स्थळ : सह्याद्री राज्य अतिथीगृह, मुंबई',
  ].join('\n');

  const prompt = buildYoutubeThumbnailPrompt({
    information: INFORMATION,
    itemCount: 5,
  });
  console.log('--- initial prompt ---\n');
  console.log(prompt);

  const failures: string[] = [];
  const need = (haystack: string, needle: string, label: string): void => {
    if (!haystack.includes(needle)) failures.push(label);
  };

  // The officer's text must reach the model byte for byte, and each of the five carried-over
  // blocks must be present — those are the ones that fixed a specific observed failure.
  need(prompt, INFORMATION, 'the information is not reproduced verbatim');
  need(prompt, 'SHOW ALL OF THE INFORMATION', 'lost the completeness rule');
  need(prompt, 'contains 5 distinct item(s)', 'lost the item count');
  need(prompt, 'REPRODUCE THE MARATHI TEXT EXACTLY', 'lost text fidelity');
  need(prompt, 'AUTHORITATIVE VISUAL STRUCTURE', 'lost the structure rule');
  need(prompt, 'REFERENCE-CONTENT FIREWALL', 'lost the content firewall');
  need(prompt, 'DOCUMENT-ARTIFACT FILTER', 'lost the artefact filter');
  need(prompt, 'STRUCTURE ONLY, not colour', 'lost the colour-freedom rule');
  need(
    prompt,
    'MAKE THE DESIGN SUIT THE MESSAGE',
    'lost the design/message rule',
  );
  need(prompt, 'PEOPLE:', 'lost the people rule');
  need(
    prompt,
    'THIS IS A YOUTUBE THUMBNAIL, NOT A POSTER',
    'lost the form rule',
  );
  need(prompt, '320 pixels wide', 'lost the small-tile legibility test');
  // The chrome rule that replaced the bare "Do not add a logo. Do not add a footer." pair —
  // too weak on the poster lane against a reference the prompt calls authoritative, which is
  // how a duplicated महाराष्ट्र शासन badge shipped (generation cc283a63).
  need(
    prompt,
    'PLACEHOLDER CHROME — COPY NONE OF IT',
    "does not mark the reference's branding as placeholder",
  );
  need(
    prompt,
    'survives BESIDE the real branding',
    'does not say a painted logo becomes a duplicate',
  );
  need(
    prompt,
    'does NOT free up usable space',
    'lost the guard against reflowing into the freed zone',
  );
  need(prompt, 'Do not add a channel name', 'lost the channel-name rule');
  need(prompt, 'QR code', 'lost the QR-code rule');
  need(prompt, 'Devanagari numerals', 'lost the Marathi-only rule');

  // The reserved-zone numbers are the contract with youtube-chrome.ts. Assert the literal
  // values rather than the interpolation, so editing one constant without the other fails.
  need(prompt, 'top-right 130 x 130 pixels', 'reserved lockup zone drifted');
  need(prompt, 'bottom 70 pixels', 'reserved footer zone drifted');
  need(prompt, '1280 x 720 output', 'canvas size drifted');
  need(prompt, 'y=650', 'content bottom drifted');

  // The two clauses that made the poster path drop the officer's own points must NOT be here.
  if (/select only (the|its) most important/i.test(prompt))
    failures.push('re-introduced the "select only the most important" clause');
  if (/never paste the entire/i.test(prompt))
    failures.push('re-introduced the "never paste the entire input" clause');

  // Order matters: the model weights late blocks most, so the reserved zones — the one rule
  // whose violation cannot be repaired afterwards — sit near the end.
  if (prompt.indexOf('MANDATORY EMPTY COVER ZONES') < prompt.indexOf('PEOPLE:'))
    failures.push('reserved zones no longer follow the content rules');

  let threw = false;
  try {
    buildYoutubeThumbnailPrompt({ information: '   ' });
  } catch {
    threw = true;
  }
  if (!threw) failures.push('empty information was accepted');

  // Shortfall wording appears only when a shortfall was reported.
  const shortfallPrompt = buildYoutubeThumbnailPrompt({
    information: INFORMATION,
    itemCount: 9,
    slotShortfall: { needed: 9, available: 5 },
  });
  need(
    shortfallPrompt,
    "EXTEND the reference's item pattern",
    'lost the shortfall rule',
  );
  if (/EXTEND the reference/.test(prompt))
    failures.push('shortfall wording leaked into a run with no shortfall');

  // Feedback: the marker and clear-space gestures must behave exactly as on the poster lane.
  const plain = buildYoutubeFeedbackPrompt({
    imageFeedback: 'शीर्षक मोठे करा',
  });
  if (/blue/i.test(plain))
    failures.push('plain feedback prompt mentions blue clear boxes');
  need(plain, 'RESERVED ZONES', 'feedback prompt lost the reserved zones');
  need(plain, '16:9', 'feedback prompt lost the aspect');
  need(plain, 'Keep the exact layout', 'feedback prompt lost keep-layout');

  // The thumbnail twin of the social duplicated-badge fix. The old reserved-zone sentence
  // ended "do NOT alter, move, redraw or remove them", which a model repainting the whole
  // frame reads as "redraw the badge freehand"; the chrome overlay then stamps the real one
  // beside it. Asserted on every feedback shape.
  for (const [label, p] of [
    ['plain', plain],
    [
      'marker+clear',
      buildYoutubeFeedbackPrompt({
        imageFeedback: 'तारीख बदला',
        markerCount: 1,
        clearActions: ['displace'],
      }),
    ],
  ] as const) {
    need(
      p,
      'DO NOT REPRODUCE IT',
      `${label} feedback allows redrawing the chrome`,
    );
    need(
      p,
      'ERASE both of them',
      `${label} feedback does not erase the chrome`,
    );
    need(
      p,
      'survives BESIDE the real branding',
      `${label} feedback lost the duplicate consequence`,
    );
    need(
      p,
      'OVERRIDES any instruction above',
      `${label} feedback lets keep-unchanged beat the chrome rule`,
    );
    need(
      p,
      'does NOT free up usable space',
      `${label} feedback lost the reflow guard`,
    );
    if (/do NOT alter, move, redraw or remove them/.test(p))
      failures.push(`${label} feedback restored the "do not redraw" wording`);
  }

  const marked = buildYoutubeFeedbackPrompt({
    imageFeedback: 'तारीख बदला',
    markerCount: 2,
    clearActions: ['displace'],
    contentInventory: ['दि. २१ मे २०२६'],
  });
  need(marked, '2 numbered red annotation marker', 'lost the marker count');
  need(marked, '1 translucent BLUE rectangle', 'lost the clear count');
  need(marked, 'MOVE — blue box A', 'lost the displace block');
  need(marked, 'TARGET AREA', 'lost target-area semantics');
  need(
    marked,
    'least disruptive complete-group movement',
    'lost the minimum-change group rule',
  );
  need(marked, 'Do not perform the move twice', 'lost the double-move guard');
  need(
    marked,
    'Preserve the original number of copies',
    'lost the exact-multiplicity guard',
  );
  need(marked, 'do NOT add another copy anywhere else', 'lost the no-duplicate example');
  need(marked, 'INFORMATION THAT MUST SURVIVE — 1 item(s)', 'lost the inventory');
  need(marked, 'दि. २१ मे २०२६', 'inventory item did not reach the prompt');
  // THE regression this change exists to prevent.
  if (marked.includes('Keep the exact layout'))
    failures.push('displace round kept the contradictory keep-layout rule');
  need(
    marked,
    'INFORMATION and ELEMENT COUNTS are fixed',
    'lost the exact-multiplicity replacement',
  );
  need(
    marked,
    'keeping every child icon, text block and image attached',
    'lost the parent-child preservation rule',
  );
  if (marked.includes('visibly rearranged poster is a CORRECT result'))
    failures.push('displace round kept the over-broad visible-redesign instruction');
  if (marked.indexOf('SPACE TO FREE:') < marked.indexOf('RESERVED ZONES'))
    failures.push('clear rule precedes the reserved zones it refers to');
  if (!marked.trimEnd().endsWith('may remain anywhere on the poster.'))
    failures.push('clear rule is not the last block of the prompt');

  // DELETE-only keeps the frozen-layout rule and buys no inventory.
  const removeOnly = buildYoutubeFeedbackPrompt({
    imageFeedback: '',
    clearActions: ['remove'],
    contentInventory: ['दि. २१ मे २०२६'],
  });
  need(removeOnly, 'DELETE — blue box A', 'lost the remove block');
  need(removeOnly, 'Keep the exact layout', 'remove-only dropped keep-layout');
  need(
    removeOnly,
    'or the SPACE TO FREE block below',
    'remove-only lost the keep-layout exception',
  );
  if (removeOnly.includes('MOVE — blue box'))
    failures.push('remove-only round leaked the displace block');
  if (removeOnly.includes('INFORMATION THAT MUST SURVIVE'))
    failures.push('remove-only round emitted an inventory');

  let feedbackThrew = false;
  try {
    buildYoutubeFeedbackPrompt({ imageFeedback: '  ' });
  } catch {
    feedbackThrew = true;
  }
  if (!feedbackThrew)
    failures.push('empty feedback with no clear boxes was accepted');

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll YouTube-thumbnail prompt assertions passed.');
  }
}
