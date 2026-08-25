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
//     official the video is about. WHO that is comes from the officer's text
//     (resolve-thumbnail-people.ts) and is named in the prompt; the reference supplies only
//     WHERE and HOW the portrait sits. Until 2026-08-25 the identity was inherited from the
//     reference's own pixels, which is how a thumbnail about the Chief Minister shipped with
//     a stranger's face — see peopleRule() and buildYoutubeThumbnailPrompt below.
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
import type { ThumbnailPerson } from './resolve-thumbnail-people.js';

/**
 * The FINISHED thumbnail the officer receives, and the canvas a pixel-feedback round
 * re-edits: 1280x720, a true 16:9.
 */
export const YOUTUBE_THUMBNAIL_DIMENSIONS = {
  width: 1280,
  height: 720,
} as const;

/**
 * The canvas an INITIAL render is asked for.
 *
 * The department strip is no longer pasted OVER the artwork — it is stamped onto a 64px strip
 * joined BELOW it (poster-renderer's footer-extension.ts), so the model paints 656 rows and is
 * never handed the band's height to give back. That is the whole fix for a thumbnail shipping
 * with its own information under the footer: the reserve was a request an image model with no
 * ruler kept losing against "fill the frame", and the height now comes out of the REQUEST.
 *
 * Keep in sync with YOUTUBE_ARTWORK_HEIGHT in poster-renderer/src/youtube-chrome.ts. It must
 * stay divisible by 16 — gpt-image-2 rejects anything else — which is why it is 656 and not
 * 720 - 52.
 */
export const YOUTUBE_ARTWORK_DIMENSIONS = {
  width: 1280,
  height: 656,
} as const;

// Keep in sync with poster-renderer/src/youtube-chrome.ts. The harness there measures the
// stamped chrome against these very numbers, so a drift is caught for free rather than
// shipping as a headline sitting behind the footer band.
const RESERVED_LOCKUP_WIDTH = 130;
const RESERVED_LOCKUP_HEIGHT = 130;
// What the band actually occupies: yt-footer.png measured at 1280 wide. On the INITIAL prompt
// it is quoted only so the model knows how much branding arrives BELOW its artwork; it is a
// genuine reserve on the FEEDBACK lane, where the band really is re-stamped over a finished
// frame. It was 70 while the band was an overlay — a deliberate 18px of slack that bought
// nothing, since the rule protecting it was the thing being ignored.
const RESERVED_FOOTER_HEIGHT = 52;
// The typographic cushion at the bottom edge, matching the social lane's 16px. NOT a background
// reserve: the design must run off the bottom edge in whatever colours it uses, or the finished
// thumbnail comes back letterboxed above its own footer — the failure a real poster (97b64542)
// shipped when this margin was phrased as a plain-background void. See reserved-zone-rule.ts.
const FOOTER_APPENDED_MARGIN = 16;

// The same shape the poster lane uses, so the two cannot drift apart on a rule that was
// already copied verbatim between them once. `height` is the ARTWORK the model paints, never
// the 720-tall frame the officer receives — exactly as SOCIAL_ZONES.height is 1504 and not
// 1600. See reserved-zone-rule.ts.
const THUMBNAIL_ZONES: ReservedZoneGeometry = {
  width: YOUTUBE_ARTWORK_DIMENSIONS.width,
  height: YOUTUBE_ARTWORK_DIMENSIONS.height,
  lockupWidth: RESERVED_LOCKUP_WIDTH,
  lockupHeight: RESERVED_LOCKUP_HEIGHT,
  footerHeight: RESERVED_FOOTER_HEIGHT,
  footerAppendedMargin: FOOTER_APPENDED_MARGIN,
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
  // Whose photograph the thumbnail should carry, most important first, as resolved from the
  // officer's own text by resolve-thumbnail-people.ts. Empty or absent means NOBODY — which
  // is a real answer (a scheme, a deadline, an advisory), not a missing value, and produces a
  // portrait-free thumbnail rather than an invented official.
  people?: readonly ThumbnailPerson[] | undefined;
}>;

// --- the blocks carried over verbatim from the onbrand poster prompt -------------------

const TEXT_FIDELITY =
  'REPRODUCE THE MARATHI TEXT EXACTLY. Copy every word character for character from the supplied information: every Devanagari letter, every matra and vowel sign, every conjunct (जोडाक्षर), every anusvara and every numeral, exactly as written and in the same order. Do not re-spell, re-word, translate, transliterate, correct, abbreviate, or "improve" any word. Do not drop or reposition a matra. Do not break a conjunct into separate letters. Marathi words rendered with a misplaced or missing matra are wrong even if they look plausible — re-read each word against the supplied text before finishing.';

const STRUCTURE_ONLY =
  'Use the provided reference image as the AUTHORITATIVE VISUAL STRUCTURE for the thumbnail. Preserve its overall composition, section placement, proportions, content distribution, imagery zones, visual balance, and density while replacing its information. STRUCTURE means only geometry and visual hierarchy—not the meaning, factual content, or element type of any reference slot. Do not redesign the structure, compress everything onto one side, or leave large blank or unused areas. Fill the usable canvas as efficiently as the reference image does — the USABLE CANVAS is the area above the bottom margin described at the end of these instructions and outside the reserved top-right corner.';

const COLOUR_FREE =
  "The reference image controls STRUCTURE ONLY, not colour. Choose the thumbnail's colour palette freely and creatively; ensure strong contrast and easy readability for every Marathi word and Devanagari numeral, including when the frame is viewed small.";

// NOTE — "person, face, portrait" was added to this list on 2026-08-25 and is load-bearing.
// The firewall named every KIND of placeholder the reference carries except the one occupying
// the largest area of it: the official in the photograph. So the rule that makes a template's
// phone number placeholder did not make the template's FACE placeholder, and the face was the
// thing being wrongly reproduced. See peopleRule() below, which states the positive half.
const CONTENT_FIREWALL =
  'REFERENCE-CONTENT FIREWALL: treat every word, numeral, date, year, URL, domain, app name, contact detail, identifier, logo, emblem, QR code, barcode, person, face, portrait, and factual claim visible in the reference image as unrelated placeholder content. Copy NONE of it. Every textual, numeric, coded, or factual element in the output must be directly supported by the supplied information. Never invent or infer a missing date, link, QR code, identifier, or fact merely to fill a reference slot. If the supplied information has no matching content for a reference element, KEEP the successful reference layout and its surrounding spacing, but make that slot visually neutral using the thumbnail’s background/design treatment, or fill it only with other source-supported content or relevant non-informational imagery. Do not reflow or redesign the overall composition just because a reference slot is unsupported.';

const ARTEFACT_FILTER =
  'DOCUMENT-ARTIFACT FILTER: never put source-document production metadata on the thumbnail—page numbers, वृत्त. क्र., issue/report/file/document numbers, running headers or footers, filenames, scan marks, OCR artifacts, or similar administrative labels are not thumbnail information, even if they appear in the supplied text.';

// --- the blocks specific to a thumbnail ------------------------------------------------

// The brevity rule. A 4:5 poster is read held in the hand; a thumbnail is read at ~320px
// wide in a list. Stated as a legibility test rather than a word count, because the
// information's own length varies and a count would either truncate it or pad it.
const THUMBNAIL_FORM = [
  // The size named here is the ARTWORK, not the finished thumbnail: the footer band is joined
  // on below afterwards. Saying "16:9" would be false of this canvas and is deliberately gone —
  // the poster lane dropped its own "4:5" for the same reason when its footer was appended.
  `THIS IS A YOUTUBE THUMBNAIL, NOT A POSTER. One single ${YOUTUBE_ARTWORK_DIMENSIONS.width} x ${YOUTUBE_ARTWORK_DIMENSIONS.height} landscape frame, read at a glance on a small phone tile once the official footer band is joined on below it.`,
  'Set the text with THUMBNAIL WEIGHT: one dominant Marathi headline as the largest element by far, with any remaining supplied details (date, time, venue, a short supporting line) set clearly smaller beneath or beside it. Every word must still be readable when the whole frame is shrunk to 320 pixels wide — if a line would not survive that, it is set too small or there is too much of it competing. Never fill the frame with paragraphs or with running body text.',
].join('\n');

const DESIGN_SUITS_MESSAGE =
  'MAKE THE DESIGN SUIT THE MESSAGE. Judge from the supplied information what kind of video this is — a live broadcast, an inauguration or लोकार्पण, a scheme launch, an announcement, a review meeting, an interview — and make the finished thumbnail read unmistakably as that through its colour choice, imagery and emphasis. Take this from the INFORMATION, never from whatever the reference image happens to be about: the reference’s own topic is unrelated placeholder content.';

// People.
//
// These thumbnails conventionally carry a cut-out portrait of the official the video is
// about. Until now the prompt inherited that face from the REFERENCE — it called the template
// "the attached minister's photo" and said to preserve it exactly — so a thumbnail about the
// Chief Minister shipped with the face of whoever happened to stand on the template. The
// reference is a finished poster from an unrelated post; its person is placeholder in exactly
// the sense every word and logo on it is placeholder.
//
// So WHO is now named explicitly, resolved from the officer's own text
// (resolve-thumbnail-people.ts), and the reference supplies only WHERE and HOW the portrait
// sits. Two rules, and both halves matter:
//   - name the person and ask for their real likeness;
//   - say in the same breath that the reference's own person must GO, because STRUCTURE ONLY
//     above has just called that image authoritative and the model will otherwise keep the
//     face it can see. That is the same failure the chrome rule fixes for the badge.
// Empty list = nobody, which is a real answer for a scheme/deadline/advisory thumbnail. The
// model is told to leave the area to the design rather than invent an official.
function peopleRule(people: readonly ThumbnailPerson[]): string {
  if (people.length === 0) {
    return 'PEOPLE: this thumbnail is NOT about any one person. Do not place a portrait, a face, a cut-out figure or a photograph of a person on it. If the reference image shows a person, that person belongs to an unrelated earlier post — REMOVE them completely and use that area for the thumbnail’s own design treatment, or for imagery the supplied information actually supports. Never invent an official, a politician or a spokesperson to fill the space.';
  }

  const described = people
    .map((person) =>
      person.designation.length > 0
        ? `${person.name} (${person.designation}, Government of Maharashtra)`
        : `${person.name} (Government of Maharashtra)`,
    )
    .join(' and ');

  const principal = people[0] as ThumbnailPerson;

  return [
    `PEOPLE — WHOSE FACE THIS THUMBNAIL CARRIES: ${described}. ${
      people.length === 1
        ? 'This is the ONLY person who may appear on the thumbnail.'
        : `These are the ONLY people who may appear, with ${principal.name} the larger and more prominent of the two.`
    }`,
    // The whole point of the change, and it has to outrank STRUCTURE ONLY explicitly.
    'THE PERSON IN THE REFERENCE IMAGE IS NOT THIS PERSON. Whoever appears in the reference belongs to an unrelated earlier post and is placeholder content exactly like its words and logos. Remove them completely — do not keep, trace, age, restyle or partially reuse their face, hair, build or clothing. Their POSITION, SCALE and cut-out treatment are what you inherit; their IDENTITY is not.',
    `Render a photorealistic cut-out portrait of ${principal.name} as they actually look — an accurate, recognisable likeness of this specific real public figure, in the formal dress a senior Maharashtra government figure wears, lit and cut out to sit cleanly against the thumbnail's background.`,
    'Place the portrait where the reference places its own — same side of the frame, same rough scale, same treatment against the background — so the composition still works.',
    'Do not add any other person, face, crowd or silhouette beyond the one(s) named above.',
    'Never place a face, a person or a portrait inside the reserved zones below.',
  ].join('\n');
}

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
 * The initial thumbnail prompt: edit the chosen reference template into the officer's
 * 1280x656 ARTWORK, which the API then joins the footer band below to make a finished
 * 1280x720 thumbnail.
 *
 * HISTORY — until 2026-08-25 this function returned a four-line prompt and the body below was
 * unreachable after an early `return`, so none of the blocks the poster lane proved out (the
 * completeness rule, text fidelity, structure-only, the content firewall, the artefact filter,
 * the chrome rule, the people rule) had ever actually run on this lane. That short prompt also
 * opened by calling the attached reference "the attached minister's photo" and instructing the
 * model to preserve that face exactly — while the only image ever attached is the TEMPLATE.
 * That single sentence is why a thumbnail about the Chief Minister shipped with a stranger's
 * face: the model was doing as it was told. Both are gone; whose face the thumbnail carries is
 * now stated explicitly by peopleRule() from names resolved out of the officer's own text.
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
    peopleRule(input.people ?? []),
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

  // The person resolve-thumbnail-people.ts would return for that text.
  const CM: ThumbnailPerson = {
    name: 'देवेंद्र फडणवीस',
    designation: 'मुख्यमंत्री',
    source: 'note',
  };

  const prompt = buildYoutubeThumbnailPrompt({
    information: INFORMATION,
    itemCount: 5,
    people: [CM],
  });
  // The same text with nobody at its centre — a scheme/deadline thumbnail.
  const facelessPrompt = buildYoutubeThumbnailPrompt({
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
  need(prompt, 'PEOPLE — WHOSE FACE', 'lost the people rule');
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
  // "above the reserved bottom strip" was true while the band was an overlay and is false now:
  // the design runs off the bottom edge and only text stops short. The social lane's onbrand
  // prompt asserts the same sentence for the same reason.
  need(
    prompt,
    'the USABLE CANVAS is the area above the bottom margin',
    'the usable canvas still describes a reserved bottom strip',
  );
  // The ARTWORK canvas, not the 720-tall frame the officer receives: the footer band is joined
  // on below it. Asking the model for 720 is precisely what buried the officer's own text.
  need(prompt, '1280 x 656 output', 'artwork canvas drifted');
  need(prompt, 'y=640', 'content bottom drifted');
  // The bottom is a JOIN now, so the old cover-zone wording must be GONE: left in place it asks
  // for a void the band no longer occupies, and the thumbnail comes back letterboxed above its
  // own footer.
  for (const gone of ['bottom 70 pixels', 'bottom 52 pixels']) {
    if (prompt.includes(gone))
      failures.push(
        `the bottom is still described as a cover zone ("${gone}")`,
      );
  }

  // The two clauses that made the poster path drop the officer's own points must NOT be here.
  if (/select only (the|its) most important/i.test(prompt))
    failures.push('re-introduced the "select only the most important" clause');
  if (/never paste the entire/i.test(prompt))
    failures.push('re-introduced the "never paste the entire input" clause');

  // Order matters: the model weights late blocks most, so the reserved zones — the one rule
  // whose violation cannot be repaired afterwards — sit near the end.
  if (
    prompt.indexOf('RESERVED BADGE CORNER') <
    prompt.indexOf('PEOPLE — WHOSE FACE')
  )
    failures.push('reserved zones no longer follow the content rules');

  // The zone must be kept clear of CONTENT, not cut out of the artwork — a social poster came
  // back with its header panel stopped short of the badge corner (see reserved-zone-rule.ts).
  for (const needle of [
    'DO NOT CUT A HOLE IN IT',
    'continue through unbroken',
  ]) {
    if (!prompt.includes(needle))
      failures.push(
        `the thumbnail prompt does not require the background to continue under the branding ("${needle}")`,
      );
  }

  // --- the geometry contract with poster-renderer ----------------------------------------
  //
  // The bottom is a JOIN: the band is stamped on a strip added below the artwork, so a bottom
  // RESERVE would letterbox the thumbnail above its own footer, and asking for the finished
  // 720-tall frame would bury the officer's own text under the band. Both shapes are denied.
  need(
    prompt,
    'THE BOTTOM EDGE IS A JOIN, NOT A COVER ZONE',
    'the prompt still treats the bottom as a cover zone',
  );
  for (const gone of ['1280x720', '1280×720', 'y=650', 'bottom 70 px']) {
    if (prompt.includes(gone))
      failures.push(
        `the prompt still quotes the pre-append geometry ("${gone}")`,
      );
  }

  // --- WHOSE FACE: the reported bug ------------------------------------------------------
  //
  // A thumbnail about the Chief Minister shipped carrying the face of the person who happened
  // to be on the reference template, because the prompt called that template "the attached
  // minister's photo" and said to preserve the face exactly — while the template is the ONLY
  // image ever attached. These assertions pin both halves of the fix: the person is named, and
  // the reference's own person is explicitly disowned.
  need(
    prompt,
    'देवेंद्र फडणवीस',
    'the resolved person is not named in the prompt',
  );
  need(
    prompt,
    'मुख्यमंत्री',
    'the resolved designation is not given as an identity hint',
  );
  need(
    prompt,
    'THE PERSON IN THE REFERENCE IMAGE IS NOT THIS PERSON',
    'the prompt no longer disowns the reference’s own face',
  );
  need(
    prompt,
    'recognisable likeness of this specific real public figure',
    'the prompt no longer asks for the named person’s real likeness',
  );
  need(
    prompt,
    'person, face, portrait',
    'the content firewall no longer treats the reference’s person as placeholder',
  );
  // The exact sentences that caused the bug. If either comes back, so does the wrong face.
  for (const gone of [
    'attached minister',
    'Preserve the minister',
    'do not alter facial features',
  ]) {
    if (prompt.includes(gone))
      failures.push(`the prompt re-inherits the reference’s face ("${gone}")`);
  }
  // The portrait must be placed where the reference places one — that is the only thing the
  // reference still supplies about the person — without inheriting who they are.
  need(
    prompt,
    'their IDENTITY is not',
    'the prompt no longer separates the reference’s arrangement from its identity',
  );

  // --- nobody named: a scheme/deadline thumbnail -----------------------------------------
  //
  // An empty list is a real answer, not a missing value. The model must be told to remove the
  // reference's person and NOT to invent a replacement — inventing an official is exactly the
  // failure mode a "there should be a face here" template invites.
  need(
    facelessPrompt,
    'NOT about any one person',
    'a person-free thumbnail does not say so',
  );
  need(
    facelessPrompt,
    'Never invent an official',
    'a person-free thumbnail may still invent an official',
  );
  // NOTE: not a search for the name itself — the officer's own INFORMATION names him, and it
  // is reproduced verbatim by design. What must be absent is the block that DIRECTS a portrait.
  if (facelessPrompt.includes('WHOSE FACE THIS THUMBNAIL CARRIES'))
    failures.push('a person-free prompt still directs a portrait');
  if (facelessPrompt.includes('recognisable likeness'))
    failures.push('a person-free prompt still asks for a portrait');

  let threw = false;
  try {
    buildYoutubeThumbnailPrompt({ information: '   ' });
  } catch {
    threw = true;
  }
  if (!threw) failures.push('empty information was accepted');

  let threwDetailed = false;
  try {
    buildYoutubeThumbnailPrompt({ information: '   ' });
  } catch {
    threwDetailed = true;
  }
  if (!threwDetailed)
    failures.push('empty information was accepted by the detailed builder');

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
  need(
    marked,
    'do NOT add another copy anywhere else',
    'lost the no-duplicate example',
  );
  need(
    marked,
    'INFORMATION THAT MUST SURVIVE — 1 item(s)',
    'lost the inventory',
  );
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
    failures.push(
      'displace round kept the over-broad visible-redesign instruction',
    );
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
