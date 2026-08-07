// The rule that keeps content out of the zones the API stamps its branding into, shared by
// every image-edit prompt that has such zones (social posters, YouTube thumbnails). Pure
// string assembly, no model call — the clear-space-rule.ts shape, and shared for the same
// reason: these blocks were "carried over verbatim" between the lanes once already, and a
// verbatim copy is a copy that drifts.
//
// WHY THIS EXISTS AS ITS OWN RULE, and not just as the geometry block below.
//
// A real render (generation cc283a63, 2026-08-04) laid its closing आवाहन paragraph across the
// footer band: three of its four columns were cut mid-word by branding stamped on afterwards.
// The reserve was not wrong — it asks for 120px on a 1600px canvas where the stamped footer is
// only 91px, i.e. 29px of slack. What was wrong is that the prompt gave the model no way to
// WIN that constraint and three separate reasons to lose it:
//
//   - the completeness rule offered "or use more of the canvas" when space is short, which is
//     a licence to enter the reserve;
//   - the structure rule demands the usable canvas be filled as densely as the reference;
//   - the item count is stated as a number to check the output against.
//
// Completeness was stated three times and the reserve once, in second-to-last position, so
// when a note ran long the model resolved the conflict against the reserve — by one line. It
// was never told which rule outranks the other, never told the consequence (an OPAQUE band is
// pasted over that strip; the words are not dimmed, they are gone), and never told the action
// that resolves it (make the type smaller, headline first). A coordinate — "end above y=1480"
// — is close to inert on its own: an image model has no ruler. What it can act on is a
// proportion it can see, a consequence, and an instruction about what to do when the content
// does not fit.
//
// So `fitToReserveRule` states the priority, the consequence and the action, and both callers
// put it LAST — the position these models weight most, and the position the clear-space rule
// is already harness-asserted to hold for the same reason.

import { pathToFileURL } from 'node:url';

/**
 * The canvas and the areas the API stamps branding into afterwards. Pixel figures are what
 * the PROMPT reserves, which is deliberately a little larger than what the chrome overlay
 * actually covers — the numbers to keep in sync are documented at each call site.
 */
export type ReservedZoneGeometry = Readonly<{
  width: number;
  height: number;
  /** Top-right emblem badge zone. */
  lockupWidth: number;
  lockupHeight: number;
  /** Full-width bottom strip. */
  footerHeight: number;
}>;

/** The lowest y-coordinate content may reach. */
export function contentBottomY(g: ReservedZoneGeometry): number {
  return g.height - g.footerHeight;
}

// A fraction the model can actually see, since it cannot measure pixels. Rendered as
// "one-thirteenth" rather than "7.5%" because these prompts are read as prose.
const ORDINALS = [
  '',
  '',
  'half',
  'third',
  'quarter',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
] as const;

function fractionOf(part: number, whole: number): string {
  const n = Math.round(whole / Math.max(1, part));
  const word = ORDINALS[n];
  return word
    ? `about one ${word} of`
    : `about ${Math.round((part / whole) * 100)}% of`;
}

/**
 * The decisive rule: the reserve outranks completeness, here is what happens if you cross it,
 * and here is what to do instead. Emit it LAST in the prompt.
 */
export type FitToReserveOptions = Readonly<{
  // Fixed-template social posters should keep the reference's visual idea, but the exact
  // column/panel geometry must yield when a longer source block would otherwise become tiny or
  // run under the footer. Other callers retain the stricter, pre-existing shrink-to-fit rule.
  allowStructuralReflow?: boolean | undefined;
}>;

export function fitToReserveRule(
  g: ReservedZoneGeometry,
  options: FitToReserveOptions = {},
): string {
  const recovery = options.allowStructuralReflow
    ? [
        'SMART REFLOW WHEN CONTENT DOES NOT FIT: before making important text too small, hiding it, cropping it, or allowing it to enter a reserved zone, adapt the layout inside the usable canvas.',
        'You MAY widen or extend a text component into adjacent usable space, including an adjacent image area; place an opaque or high-contrast panel over non-essential imagery; narrow, crop or reposition the image area; move components upward; tighten spacing; and change local column widths, component heights or section boundaries.',
        `For example, when a closing component in a narrow text column becomes too tall, extend that component sideways across the adjacent image instead of letting its final lines fall behind the footer. Keep the reference's overall visual concept recognisable, but do not preserve its exact geometry at the cost of hidden, cropped, tiny or unreadable information. The complete component, including its final line and padding, must end above y=${contentBottomY(g)}.`,
        'After smart reflow, if more room is still needed, use this order: Shrink the HEADLINE first because it is the largest block and the cheapest to reduce. Then tighten line spacing and reduce the body type only as much as needed while keeping it clearly readable. Lay the content out again and re-check the bottom.',
      ]
    : [
        `So lay the content out, then CHECK THE BOTTOM before you finish: read the last line of the lowest block and confirm it ends above y=${contentBottomY(g)} with clear space beneath it. If it does not, do not let it run under the band and do not crop it — reduce the type size and tighten the line spacing, and lay it out again.`,
        'Shrink the HEADLINE first: it is the largest block and the cheapest to reduce, it may take as many fewer lines as it needs, and there is no minimum size it has to keep. Then reduce the body type. Repeat until everything clears the band.',
      ];

  return [
    'FIT THE CONTENT INSIDE THE USABLE AREA — this rule OUTRANKS every completeness, density and canvas-filling instruction above.',
    `After you finish, software pastes an OPAQUE full-width band over the bottom ${g.footerHeight} pixels and an OPAQUE badge into the top-right corner. They are not transparent and they are not moved to suit your layout: any word, numeral, icon or subject you place under them is COVERED AND LOST — the reader never sees it, the sentence ends mid-word, and the whole image has to be thrown away.`,
    'Showing every point in SMALLER type is correct. Showing the same points in larger type with the last lines buried under the band is wrong, and is a worse failure than any amount of empty space.',
    ...recovery,
    'No quantity of content is ever a reason to cross into either reserved zone.',
  ].join(' ');
}

// --- the branding itself ---------------------------------------------------
//
// WHY A SECOND RULE, when the zone block above already says "no logos".
//
// A real render (generation cc283a63, 2026-08-04) came back carrying TWO महाराष्ट्र शासन
// badges: the crisp one overlayTwitterChrome stamps, and a larger painted one behind and
// below it. The officer had drawn a blue clear-space box to move text out from under the
// logo, and got a duplicated logo instead.
//
// The zone block was not what failed. Two prompts positively invited the branding:
//
//   - the FEEDBACK prompts said the badge and footer "are official branding stamped onto the
//     poster by software — do NOT alter, move, redraw or remove them". An image-edit model
//     repaints the whole canvas, so "do not remove it" is read as "reproduce it" — and its
//     reproduction is freehand. It lands at a different size and offset from the 160x154
//     badge the API stamps at a 6px margin, so the two do not coincide and BOTH are visible.
//   - the fixed-template (ठरलेले टेम्पलेट) prompt said only "Do not add a logo. Do not add a
//     footer." while calling the reference image the AUTHORITATIVE VISUAL STRUCTURE. The
//     reference is a finished poster carrying its own chrome, and nothing told the model that
//     chrome was placeholder. Every other DGIPR path says ERASE it (see PLACEHOLDER_WITH_PHOTO
//     in build-poster-prompt.ts); this branch never did.
//
// The fact that makes both fixable is the same one that makes the branding safe to erase:
// the chrome is composited in CODE after EVERY render, initial and feedback alike
// (overlayTwitterChrome / overlayArticleChrome / overlayCmoChrome / overlayYoutubeChrome).
// So a painted badge is never needed, is never used, and can only ever be a duplicate. Both
// rules therefore say the same three things: it is not yours, erase it / copy none of it, and
// here is what happens if you paint one anyway.
//
// The "does not free up space" clause travels WITH the rule rather than beside it. It was
// learned on the article path — told to erase the master's logo, the model treated the freed
// corner as usable and floated the headline up into it, where the stamped logo then clipped
// it — and it is the obvious way for this fix to cause the previous bug.

/** How one lane's stamped branding appears, in the words the model will read it in. */
export type StampedChrome = Readonly<{
  /** The noun for the image being produced: 'poster', 'thumbnail'. */
  surface: string;
  /** The corner/header badge, described as it looks. */
  lockup: string;
  /** The bottom strip, described as it looks. */
  footer: string;
}>;

// Why a painted copy is worse than nothing: it is not overwritten, it sits BESIDE the real
// one. This is the half neither prompt ever stated, and it is the whole reason the rule wins
// against "keep the input unchanged".
const CHROME_DUPLICATE_CONSEQUENCE =
  'Software composites that branding onto your output at a FIXED size and position AFTER you finish. Anything you paint that imitates it is NOT replaced by it and does NOT line up with it — it survives BESIDE the real branding as a second emblem, a second महाराष्ट्र शासन wordmark or a second footer band, which is a visible duplicate and makes the image unusable.';

// Shared by both rules: erasing branding is not a licence to move content into the space.
const CHROME_FREES_NO_SPACE =
  'Removing that branding does NOT free up usable space: do not move, enlarge, re-centre or reflow the headline, a photograph, a face, a focal subject or any other content into either reserved zone.';

/**
 * For a prompt that EDITS AN EXISTING RENDER (every pixel/marker/clear-space feedback round):
 * the branding is already visible on the input image, because the API stamped it there. It
 * will be stamped again on the output, so it must be erased rather than lovingly reproduced.
 */
export function stampedChromeRule(c: StampedChrome): string {
  return [
    `THE BRANDING ON THE INPUT IMAGE IS NOT PART OF THE DESIGN — DO NOT REPRODUCE IT. Two things you can see on the input image were stamped on by software after the ${c.surface} was designed, and are not elements you are editing: the ${c.lockup}, and the ${c.footer}.`,
    'ERASE both of them and leave those two areas as plain background continuing the surrounding design, with no emblem, wordmark, band, strip, panel, outline, boundary or text of your own.',
    'This OVERRIDES any instruction above to keep the input unchanged or to preserve its existing text: that branding is the one thing you must NOT preserve.',
    `Do not copy, redraw, re-typeset, imitate, move, resize, extend or duplicate it, and do not invent an emblem, government wordmark, department name, footer band, social-media handle, website address, QR code or logo of your own anywhere on the ${c.surface}.`,
    CHROME_FREES_NO_SPACE,
    CHROME_DUPLICATE_CONSEQUENCE,
  ].join(' ');
}

/**
 * For a prompt that PAINTS FROM SCRATCH with no input image at all (designMode 'fresh'):
 * there is nothing to erase and no reference whose chrome could be called placeholder, so
 * neither rule above is true of it — the only thing to say is "do not invent one, and here
 * is what happens if you do".
 *
 * The fresh branch carried a one-line version of this ("Do not paint any logos, emblems,
 * footer bands or social handles — the official branding is stamped on afterwards by
 * software"), which states the prohibition but not the CONSEQUENCE. That omission is what
 * the other two rules were rewritten to fix: a model has no reason to prefer leaving the
 * corner alone over painting a plausible badge unless it is told the painted one is not
 * replaced by the real one.
 */
export function paintNoChromeRule(c: StampedChrome): string {
  return [
    `PAINT NO BRANDING OF YOUR OWN. Official branding is composited onto this ${c.surface} by software after you finish: a ${c.lockup}, and a ${c.footer}.`,
    `You are NOT designing those. Paint no emblem, government wordmark, department name, ministry title, logo, badge, footer band, social-handle strip, website address or QR code anywhere on the ${c.surface}, inside the reserved zones or outside them, and do not draw a frame, plate, card, outline or placeholder box where you expect them to land.`,
    CHROME_DUPLICATE_CONSEQUENCE,
  ].join(' ');
}

/**
 * For a prompt that EDITS A REFERENCE TEMPLATE into a new render (the fixed-template lanes):
 * the reference is a finished poster carrying branding of its own, and the prompt has just
 * told the model to treat that reference as authoritative. Its chrome is placeholder, exactly
 * like its words and numbers — the REFERENCE-CONTENT FIREWALL applied to the branding.
 */
export function referenceChromeRule(c: StampedChrome): string {
  return [
    `THE REFERENCE IMAGE'S BRANDING IS PLACEHOLDER CHROME — COPY NONE OF IT. The reference carries branding of its own: a ${c.lockup} and a ${c.footer}. Treat it exactly as you treat the reference's words and numbers — it is not part of the structure you are reproducing, and it must not appear in your output.`,
    `Paint NO emblem, government wordmark, department name, logo, footer band, social-handle strip, website address or QR code anywhere on the ${c.surface}, in the reserved zones or outside them.`,
    CHROME_FREES_NO_SPACE,
    CHROME_DUPLICATE_CONSEQUENCE,
  ].join(' ');
}

/**
 * The geometry block: where the zones are, stated as pixels AND as a visible proportion, and
 * what may and may not occupy them.
 *
 * `footerNote` describes a multi-part footer where one exists — the social poster's band is a
 * navy title pill sitting above a white social strip, and a model told only "a footer strip"
 * reads the white strip alone as the footer and tucks a line under the pill.
 */
export function reservedZoneBlock(
  g: ReservedZoneGeometry,
  footerNote?: string,
): string {
  const parts = [
    `MANDATORY EMPTY COVER ZONES: only the top-right ${g.lockupWidth} x ${g.lockupHeight} pixels (a corner square ${fractionOf(g.lockupWidth, g.width)} the width) and the full-width bottom ${g.footerHeight} pixels (a strip ${fractionOf(g.footerHeight, g.height)} the height) of the ${g.width} x ${g.height} output are reserved for official branding added later by software.`,
  ];
  if (footerNote) parts.push(footerNote);
  parts.push(
    `All text, cards, panels, icons, photographs, subjects, and other meaningful content must END ABOVE y=${contentBottomY(g)} and must not sit behind the bottom strip or the corner badge.`,
    'These are the ONLY areas that may be intentionally empty: use all remaining space right up to their boundaries, following the reference structure.',
    "Leave both zones COMPLETELY EMPTY of content and continue the image's immediately surrounding background through them seamlessly, with the same colour and visual treatment as the adjacent background.",
    'Do NOT create a separate colour, white space, patch, box, panel, band, reserved-space marker, or visible boundary in either zone.',
    'ABSOLUTELY NO text, numbers, logos, footer, photographs, faces, people, objects, icons, borders, shapes, or decoration may enter, sit behind, or cross either zone.',
  );
  return parts.join(' ');
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/reserved-zone-rule.ts
// Pure string assembly — no model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const POSTER: ReservedZoneGeometry = {
    width: 1280,
    height: 1600,
    lockupWidth: 180,
    lockupHeight: 170,
    footerHeight: 120,
  };
  const THUMB: ReservedZoneGeometry = {
    width: 1280,
    height: 720,
    lockupWidth: 130,
    lockupHeight: 130,
    footerHeight: 70,
  };
  const failures: string[] = [];
  const need = (s: string, needle: string, why: string): void => {
    if (!s.includes(needle)) failures.push(`${why} (missing "${needle}")`);
  };

  if (contentBottomY(POSTER) !== 1480)
    failures.push('poster content floor drifted off y=1480');
  if (contentBottomY(THUMB) !== 650)
    failures.push('thumbnail content floor drifted off y=650');

  const posterFit = fitToReserveRule(POSTER);
  // The three things the failing render was never told.
  need(
    posterFit,
    'OUTRANKS',
    'fit rule does not resolve the priority conflict',
  );
  need(
    posterFit,
    'COVERED AND LOST',
    'fit rule does not state the consequence',
  );
  need(
    posterFit,
    'Shrink the HEADLINE first',
    'fit rule does not name the action that resolves the conflict',
  );
  need(posterFit, 'y=1480', 'fit rule lost the content floor');
  need(
    posterFit,
    'bottom 120 pixels',
    'fit rule lost the reserved footer height',
  );

  const posterSmartFit = fitToReserveRule(POSTER, {
    allowStructuralReflow: true,
  });
  need(
    posterSmartFit,
    'SMART REFLOW WHEN CONTENT DOES NOT FIT',
    'smart fit rule lost its structural-reflow priority',
  );
  need(
    posterSmartFit,
    'extend that component sideways across the adjacent image',
    'smart fit rule does not name the footer-overlap recovery action',
  );
  need(posterSmartFit, 'y=1480', 'smart fit rule lost the content floor');

  const posterZones = reservedZoneBlock(POSTER, 'FOOTER NOTE.');
  need(
    posterZones,
    'MANDATORY EMPTY COVER ZONES',
    'zone block lost its heading',
  );
  need(posterZones, 'top-right 180 x 170 pixels', 'poster lockup zone drifted');
  need(posterZones, 'bottom 120 pixels', 'poster footer zone drifted');
  need(posterZones, '1280 x 1600 output', 'poster canvas drifted');
  need(posterZones, 'y=1480', 'poster content floor drifted');
  need(
    posterZones,
    'FOOTER NOTE.',
    'the multi-part footer note did not reach the block',
  );
  // The proportion is the half a model can actually see; a pixel figure alone is close to inert.
  need(
    posterZones,
    'about one seventh of the width',
    'poster lockup proportion wrong',
  );
  need(
    posterZones,
    'about one thirteenth of the height',
    'poster footer proportion wrong',
  );
  if (reservedZoneBlock(POSTER).includes('FOOTER NOTE'))
    failures.push('zone block emitted a footer note that was not supplied');

  const thumbZones = reservedZoneBlock(THUMB);
  need(
    thumbZones,
    'top-right 130 x 130 pixels',
    'thumbnail lockup zone drifted',
  );
  need(thumbZones, 'bottom 70 pixels', 'thumbnail footer zone drifted');
  need(thumbZones, '1280 x 720 output', 'thumbnail canvas drifted');
  need(thumbZones, 'y=650', 'thumbnail content floor drifted');
  need(
    thumbZones,
    'about one tenth of the width',
    'thumbnail lockup proportion wrong',
  );
  need(
    thumbZones,
    'about one tenth of the height',
    'thumbnail footer proportion wrong',
  );

  // The chrome rules. What each one must say is exactly what the failing render was never
  // told — see the block comment above the two functions.
  const CHROME: StampedChrome = {
    surface: 'poster',
    lockup:
      'white rounded-square महाराष्ट्र शासन emblem-and-wordmark badge in the top-right corner',
    footer:
      'full-width department footer band and social-handle strip along the bottom',
  };
  const stamped = stampedChromeRule(CHROME);
  need(
    stamped,
    'DO NOT REPRODUCE IT',
    'stamped rule does not forbid redrawing',
  );
  need(stamped, 'ERASE both of them', 'stamped rule does not ask for erasure');
  need(
    stamped,
    'OVERRIDES any instruction above',
    'stamped rule does not beat the keep-unchanged rule it contradicts',
  );
  need(
    stamped,
    'survives BESIDE the real branding',
    'stamped rule does not state the duplicate consequence',
  );
  need(
    stamped,
    'does NOT free up usable space',
    'stamped rule lost the article path’s reflow guard',
  );
  need(stamped, CHROME.lockup, 'stamped rule lost the lockup description');
  need(stamped, CHROME.footer, 'stamped rule lost the footer description');

  const reference = referenceChromeRule(CHROME);
  need(
    reference,
    'PLACEHOLDER CHROME — COPY NONE OF IT',
    'reference rule does not mark the branding as placeholder',
  );
  need(
    reference,
    'survives BESIDE the real branding',
    'reference rule does not state the duplicate consequence',
  );
  need(
    reference,
    'does NOT free up usable space',
    'reference rule lost the reflow guard',
  );
  // A reference is not the input image being edited: it must not tell the model to erase
  // branding off something it is not editing, which is what makes the two rules distinct.
  if (reference.includes('ERASE both of them'))
    failures.push('reference rule copied the stamped rule’s erase wording');

  // The from-scratch variant. It must NOT claim there is an input image or a reference to
  // erase — that is what makes it a third rule rather than a reuse of either above — but it
  // must still carry the duplicate consequence and forbid a placeholder box in the corner.
  const paintNone = paintNoChromeRule(CHROME);
  need(
    paintNone,
    'PAINT NO BRANDING OF YOUR OWN',
    'paint-none rule lost its heading',
  );
  need(
    paintNone,
    'survives BESIDE the real branding',
    'paint-none rule does not state the duplicate consequence',
  );
  need(
    paintNone,
    'placeholder box',
    'paint-none rule does not forbid the placeholder box that appeared in the corner',
  );
  need(paintNone, CHROME.lockup, 'paint-none rule lost the lockup description');
  need(paintNone, CHROME.footer, 'paint-none rule lost the footer description');
  for (const wrong of ['ERASE both of them', 'REFERENCE IMAGE']) {
    if (paintNone.includes(wrong)) {
      failures.push(
        `paint-none rule claims something a from-scratch render has no input for ("${wrong}")`,
      );
    }
  }

  console.log(`${'='.repeat(78)}\nPOSTER\n${'='.repeat(78)}`);
  console.log(`${posterZones}\n\n${fitToReserveRule(POSTER)}`);
  console.log(`\n--- stamped chrome (feedback) ---\n${stamped}`);
  console.log(`\n--- reference chrome (initial) ---\n${reference}`);
  console.log(`\n${'='.repeat(78)}\nTHUMBNAIL\n${'='.repeat(78)}`);
  console.log(`${thumbZones}\n\n${fitToReserveRule(THUMB)}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll reserved-zone rule assertions passed.');
  }
}
