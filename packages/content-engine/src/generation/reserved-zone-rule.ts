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
  /**
   * Set this and the footer stops being a DESTRUCTIVE overlay: the band is joined onto a strip
   * added below the artwork in code (poster-renderer/footer-extension.ts), so nothing the model
   * paints can be covered by it. The value is then a small TEXT margin at the bottom edge — a
   * typographic cushion so the last line is not jammed against the band, and nothing more.
   *
   * It is NOT a background reserve. The design — colour blocks, panels, gradients, photographs —
   * must run right off the bottom edge in whatever colours it uses, exactly as it must run into
   * the badge corner. Asking for a "calm plain background margin" here is what produced a real
   * poster (generation 97b64542) with an 82px flat grey band above a 91px strip filled from it:
   * 173 dead pixels, a tenth of the poster, reading as a letterboxed image. The model overshot
   * the margin it was given by 1.7x, which is the ordinary behaviour of an image model handed a
   * pixel figure — so the figure is now small AND the sentence around it no longer asks for a
   * void.
   *
   * The social lane sets it. Overlay lanes (article poster, YouTube thumbnail) leave it unset
   * and keep the pre-existing behaviour byte-for-byte.
   */
  footerAppendedMargin?: number | undefined;
}>;

/** True when the footer is joined on below the artwork rather than pasted over it. */
export function footerIsAppended(g: ReservedZoneGeometry): boolean {
  return typeof g.footerAppendedMargin === 'number';
}

/** The lowest y-coordinate content may reach. */
export function contentBottomY(g: ReservedZoneGeometry): number {
  return g.height - (g.footerAppendedMargin ?? g.footerHeight);
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
  // What crossing the floor DOES, in one phrase, reused by both recovery shapes. It has to be
  // true of the lane: on an appended footer nothing falls "behind" anything.
  const crossing = footerIsAppended(g)
    ? 'run into the bottom margin'
    : 'fall behind the footer';

  const recovery = options.allowStructuralReflow
    ? [
        'SMART REFLOW WHEN CONTENT DOES NOT FIT: before making important text too small, hiding it, cropping it, or allowing it to enter a reserved zone, adapt the layout inside the usable canvas.',
        'You MAY widen or extend a text component into adjacent usable space, including an adjacent image area; place an opaque or high-contrast panel over non-essential imagery; narrow, crop or reposition the image area; move components upward; tighten spacing; and change local column widths, component heights or section boundaries.',
        `For example, when a closing component in a narrow text column becomes too tall, extend that component sideways across the adjacent image instead of letting its final lines ${crossing}. Keep the reference's overall visual concept recognisable, but do not preserve its exact geometry at the cost of hidden, cropped, tiny or unreadable information. The complete component, including its final line and padding, must end above y=${contentBottomY(g)}.`,
        'After smart reflow, if more room is still needed, use this order: Shrink the HEADLINE first because it is the largest block and the cheapest to reduce. Then tighten line spacing and reduce the body type only as much as needed while keeping it clearly readable. Lay the content out again and re-check the bottom.',
      ]
    : [
        `So lay the content out, then CHECK THE BOTTOM before you finish: read the last line of the lowest block and confirm it ends above y=${contentBottomY(g)} with clear space beneath it. If it does not, do not let it ${crossing} and do not crop it — reduce the type size and tighten the line spacing, and lay it out again.`,
        'Shrink the HEADLINE first: it is the largest block and the cheapest to reduce, it may take as many fewer lines as it needs, and there is no minimum size it has to keep. Then reduce the body type. Repeat until everything clears the band.',
      ];

  // The consequence, which is what makes the rule outrank the completeness clauses above it,
  // differs by lane and must be TRUE of the lane it is given to. On an overlay lane crossing the
  // floor destroys the words. On an appended lane it cannot — saying it would be a bluff the
  // model's own rendering contradicts, and a rule caught overstating one consequence weakens
  // every rule beside it. What is true there is that the band arrives hard against whatever the
  // artwork ends on, which is a visibly broken poster rather than a lost one.
  const consequence = footerIsAppended(g)
    ? [
        `After you finish, software pastes an OPAQUE badge into the top-right corner — any word, numeral, icon or subject you place under it is COVERED AND LOST, the sentence ends mid-word, and the whole image has to be thrown away. Along the bottom, a full-width branding band about ${g.footerHeight} pixels tall is joined on DIRECTLY BELOW this image; it takes no space out of this canvas and covers nothing you draw.`,
        `So the design itself must reach the bottom edge in whatever colours it uses — only TEXT stops short, ${g.footerAppendedMargin} pixels above it, so the last line is not jammed against the band. Ending the design early and leaving a plain empty strip above the bottom edge is a broken, letterboxed poster, and is a worse result than slightly smaller type.`,
        'Showing every point in SMALLER type is correct. Showing the same points in larger type with the last lines jammed against the bottom edge is wrong.',
      ]
    : [
        `After you finish, software pastes an OPAQUE full-width band over the bottom ${g.footerHeight} pixels and an OPAQUE badge into the top-right corner. They are not transparent and they are not moved to suit your layout: any word, numeral, icon or subject you place under them is COVERED AND LOST — the reader never sees it, the sentence ends mid-word, and the whole image has to be thrown away.`,
        'Showing every point in SMALLER type is correct. Showing the same points in larger type with the last lines buried under the band is wrong, and is a worse failure than any amount of empty space.',
      ];

  return [
    'FIT THE CONTENT INSIDE THE USABLE AREA — this rule OUTRANKS every completeness, density and canvas-filling instruction above.',
    ...consequence,
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
//
// "or any other content" used to close this sentence, and that over-reach is the same one the
// zone block was carrying — read literally it forbids the background layer from being there
// either, which is how a corner ends up notched out of the artwork. It now names TEXT AND FOCAL
// content, and says outright that the background beneath must still continue through.
const CHROME_FREES_NO_SPACE =
  'Removing that branding does NOT free up usable space: do not move, enlarge, re-centre or reflow the headline, a photograph, a face, a focal subject or any other text or focal content into a reserved zone. The background layer underneath — the colour block, panel, gradient or photograph the design already puts there — must still continue through the zone unbroken.';

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

// WHY THE ZONE RULE SAYS "CONTINUE THE DESIGN", NOT "LEAVE IT EMPTY".
//
// A real render (2026-08-10, a ठरलेले टेम्पलेट social poster) came back with the navy header
// panel STOPPING SHORT of the top-right corner, leaving a pale notch of page ground around the
// stamped badge — a visibly broken corner on an otherwise correct poster.
//
// The prompt asked for it. This block used to pair two contradictory sentences:
//
//   "Leave that corner COMPLETELY EMPTY of content and continue the image's immediately
//    surrounding background through it seamlessly …"
//   "Do NOT create a separate colour, white space, patch, box, panel, band, reserved-space
//    marker, or visible boundary there, and NO text, numbers, logos, photographs, faces,
//    people, objects, icons, borders, shapes, or decoration may enter, sit behind, or CROSS it."
//
// A header block IS a "panel"/"band"/"shape", and to reach the right edge it must CROSS the
// corner — so the second sentence forbids in as many words the thing the first one asks for.
// The list is concrete and the word "background" is not (a model reads it as the page ground,
// not as whatever layer happens to occupy that edge), so the list won.
//
// The rule is therefore split along the axis that actually matters — INFORMATION vs GROUND:
//
//   - background layers (colour blocks, panels, bands, gradients, photographs, textures) MUST
//     run into the zone and continue through it unbroken. The branding is opaque and lands ON
//     TOP, so there is nothing to make room for;
//   - only content that carries meaning or draws the eye must stay out;
//   - and the failure is NAMED (a notch, step, inset, gap, or a paler rectangle), because these
//     prompts respond to a described defect far better than to a prohibition.
//
// `panel`, `band`, `borders` and `shapes` survive only in the "do not CREATE something new
// there" sense, which is a different sentence from "do not let an existing element reach it".

/**
 * The three sentences that keep the design continuous under stamped branding. Shared by both
 * lanes so the wording cannot drift between them.
 *
 * `zone` is the noun phrase the sentences refer to ("the reserved corner" / "the reserved
 * zones"), so this reads correctly whether one zone or two are being described.
 */
function continuityRules(zone: string): readonly string[] {
  return [
    `THE DESIGN CONTINUES UNDERNEATH — DO NOT CUT A HOLE IN IT. Whatever the design places along that edge of the image — a solid colour block, a header or footer panel, a band, a gradient, a photograph, a texture — must extend all the way into ${zone} and continue through unbroken, in exactly the same colour, tone and treatment it has immediately beside it. The branding is opaque and is composited ON TOP of your finished design afterwards, so there is nothing to make room for and nothing to move aside.`,
    `NEVER shorten, inset, notch, step, clip, shrink or stop a panel, band, colour block, photograph, gradient or background short of ${zone}, and never leave a lighter, paler, white, blank or differently-coloured rectangle, patch, box, gap, frame, outline, reserved-space marker or visible boundary there. An area that does not match the design immediately around it reads as a mistake, and the image has to be thrown away.`,
    `KEEP IT CLEAR OF CONTENT, NOT CLEAR OF DESIGN: no text, numerals, logos, emblems, wordmarks, icons, QR codes, badges, captions, decorative marks, faces, people or the focal subject of a photograph may sit inside ${zone}, behind the branding, or cross into it — but the background layer beneath them must.`,
  ];
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
  // APPENDED FOOTER. The band is joined on below the artwork, so it is not a cover zone at all
  // and calling it one would be false — worse, it would ask for a void the band no longer
  // occupies, leaving the finished poster visibly letterboxed above its own footer. That is not
  // hypothetical: the first wording here asked for a "calm, plain, even background" margin and
  // listed panels and photographs among the things that must END above the floor, and a real
  // render (97b64542) answered it with an 82px flat grey band on top of the 91px strip filled
  // from it. So the bottom is now the same shape of rule as the badge corner — the DESIGN runs
  // off the edge, only TEXT stops short — and the colour it runs off in is explicitly the
  // design's own business.
  //
  // `footerNote` (which names the band's navy title pill so a last line does not tuck under it)
  // is not emitted here: nothing tucks under anything any more, and the pill is no longer on the
  // canvas the model is painting.
  if (footerIsAppended(g)) {
    return [
      `RESERVED BADGE CORNER: the top-right ${g.lockupWidth} x ${g.lockupHeight} pixels (a corner square ${fractionOf(g.lockupWidth, g.width)} the width) of the ${g.width} x ${g.height} output is reserved for an official badge composited on later by software.`,
      ...continuityRules('the reserved corner'),
      `THE BOTTOM EDGE IS A JOIN, NOT A COVER ZONE: the official footer band is attached directly BELOW this image afterwards and takes NO space out of this canvas, so nothing has to be kept clear for it. DESIGN ALL THE WAY DOWN TO THE VERY BOTTOM EDGE: colour blocks, panels, bands, gradients, background and photographs must reach the last row of pixels and run off the edge, exactly as they do at the left and right edges.`,
      `THERE IS NO COLOUR RESTRICTION AT THE BOTTOM: that edge may be any colour the design uses — dark, saturated, patterned or photographic — and it does NOT have to be pale, white, neutral, plain or empty. Do NOT end the design early, do not leave a large empty gap above the bottom edge, and do not park a blank or lighter strip there: an empty band above the footer makes the finished poster look letterboxed and broken.`,
      `Keep only TEXT away from the very bottom: no words, numerals, captions, icons or logos below y=${contentBottomY(g)} — that last ${g.footerAppendedMargin} pixels is a thin typographic cushion so the final line is not jammed against the band, and the background, colour and imagery continue through it as normal.`,
      'Apart from keeping that corner clear of content and that thin text cushion at the bottom, use all remaining space right up to the edges, following the reference structure.',
    ].join(' ');
  }

  const parts = [
    `RESERVED BRANDING ZONES: only the top-right ${g.lockupWidth} x ${g.lockupHeight} pixels (a corner square ${fractionOf(g.lockupWidth, g.width)} the width) and the full-width bottom ${g.footerHeight} pixels (a strip ${fractionOf(g.footerHeight, g.height)} the height) of the ${g.width} x ${g.height} output are reserved for official branding composited on later by software.`,
  ];
  if (footerNote) parts.push(footerNote);
  parts.push(
    `All text, numerals, cards, icons, captions, faces, subjects and other meaningful content must END ABOVE y=${contentBottomY(g)} and must not sit behind the bottom strip or the corner badge — only background may continue below that line.`,
    'These are the ONLY areas that must be kept clear of content: use all remaining space right up to their boundaries, following the reference structure.',
    ...continuityRules('the reserved zones'),
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
  // The social lane, whose footer is APPENDED below the artwork rather than pasted over it.
  // Mirrors SOCIAL_ZONES in build-poster-prompt.ts.
  const SOCIAL: ReservedZoneGeometry = {
    width: 1280,
    height: 1600,
    lockupWidth: 180,
    lockupHeight: 170,
    footerHeight: 91,
    footerAppendedMargin: 16,
  };
  const failures: string[] = [];
  const need = (s: string, needle: string, why: string): void => {
    if (!s.includes(needle)) failures.push(`${why} (missing "${needle}")`);
  };
  const deny = (s: string, needle: string, why: string): void => {
    if (s.includes(needle)) failures.push(`${why} (found "${needle}")`);
  };

  if (contentBottomY(POSTER) !== 1480)
    failures.push('poster content floor drifted off y=1480');
  if (contentBottomY(THUMB) !== 650)
    failures.push('thumbnail content floor drifted off y=650');
  // The appended floor is set by the MARGIN, not by the band height — getting this wrong is
  // how the poster would come back letterboxed above its own footer.
  if (contentBottomY(SOCIAL) !== 1584)
    failures.push('appended-footer content floor drifted off y=1584');
  if (footerIsAppended(POSTER) || !footerIsAppended(SOCIAL))
    failures.push('footerIsAppended does not distinguish the two lanes');

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
  need(posterZones, 'RESERVED BRANDING ZONES', 'zone block lost its heading');
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

  // --- the corner must not be cut out of the artwork -----------------------
  // A ठरलेले टेम्पलेट render (2026-08-10) stopped its navy header panel short of the badge
  // corner, leaving a pale notch, because the block forbade a "panel" or "shape" from CROSSING
  // the zone while separately asking for the background to continue through it. Both lanes
  // must now say the background continues, and neither may forbid an existing element from
  // reaching the zone. If a notched corner ever comes back, check these first.
  for (const [name, block] of [
    ['poster', posterZones],
    ['social', reservedZoneBlock(SOCIAL)],
    ['thumbnail', reservedZoneBlock(THUMB)],
  ] as const) {
    need(
      block,
      'DO NOT CUT A HOLE IN IT',
      `${name} zone block does not name the notched-corner failure`,
    );
    need(
      block,
      'continue through unbroken',
      `${name} zone block does not require the background to continue through the zone`,
    );
    need(
      block,
      'CLEAR OF CONTENT, NOT CLEAR OF DESIGN',
      `${name} zone block does not separate information from background`,
    );
    need(
      block,
      'composited ON TOP',
      `${name} zone block does not say the branding lands on top, so there is still something to "make room" for`,
    );
    // The exact wording that caused the notch. "panel"/"band"/"shape" may only appear in the
    // do-not-CREATE-something-new sense, never as things forbidden to enter or cross.
    for (const wrong of [
      'COMPLETELY EMPTY',
      'may be intentionally empty',
      'reserved-space marker, or visible boundary',
      'may enter, sit behind, or cross',
      'shapes, or decoration',
    ]) {
      deny(
        block,
        wrong,
        `${name} zone block restored wording that tells the model to blank the zone or to keep an existing panel out of it`,
      );
    }
  }
  // The same over-reach in the chrome rules: erasing branding must not be read as licence to
  // pull the background out of the corner too.
  need(
    stampedChromeRule({
      surface: 'poster',
      lockup: 'badge',
      footer: 'band',
    }),
    'must still continue through the zone unbroken',
    'the chrome rule’s no-free-space clause still excludes the background layer',
  );

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

  // --- the appended-footer lane -------------------------------------------
  // A band joined on BELOW the artwork cannot cover anything, so the two things to hold here
  // are that the prompt stops claiming it does (a rule caught overstating one consequence
  // weakens every rule beside it) and that it stops asking for the ~120px void the band no
  // longer occupies — which would leave the finished poster letterboxed above its own footer.
  const socialZones = reservedZoneBlock(SOCIAL, 'FOOTER NOTE.');
  need(
    socialZones,
    'top-right 180 x 170 pixels',
    'appended lane lost the badge zone, which IS still a destructive overlay',
  );
  need(
    socialZones,
    'THE BOTTOM EDGE IS A JOIN, NOT A COVER ZONE',
    'appended lane still presents the footer as a cover zone',
  );
  need(
    socialZones,
    'do not leave a large empty gap above the bottom edge',
    'appended lane does not ask for the full canvas height, so posters will letterbox',
  );
  // THE 173-PIXEL DEAD BAND (generation 97b64542). The bottom must read as an edge the design
  // runs off, not as a reserve: the design reaches the last row, in any colour it likes, and
  // only TEXT stops short. If a flat empty strip ever comes back above the footer, check these.
  need(
    socialZones,
    'DESIGN ALL THE WAY DOWN TO THE VERY BOTTOM EDGE',
    'appended lane does not tell the design to reach the bottom edge',
  );
  need(
    socialZones,
    'THERE IS NO COLOUR RESTRICTION AT THE BOTTOM',
    'appended lane still constrains the colour of the bottom edge',
  );
  need(
    socialZones,
    'Keep only TEXT away from the very bottom',
    'appended lane treats the bottom margin as a background reserve, not a text cushion',
  );
  for (const wrong of [
    'calm, plain, even background',
    'end all text, cards, panels, icons, photographs',
  ]) {
    deny(
      socialZones,
      wrong,
      'appended lane restored the wording that produced a flat empty band above the footer',
    );
  }
  need(socialZones, '16 pixels', 'appended lane lost the text cushion');
  need(socialZones, 'y=1584', 'appended lane content floor drifted');
  need(socialZones, 'RESERVED BADGE CORNER', 'appended lane lost its heading');
  deny(
    socialZones,
    'RESERVED BRANDING ZONES',
    'appended lane kept the plural two-zone heading; only the corner is a cover zone now',
  );
  deny(
    socialZones,
    'bottom 91 pixels',
    'appended lane reserves the band as if it were pasted over the artwork',
  );
  // The pill note is about text tucking under the band. Nothing tucks under it any more, and on
  // an initial render the pill is not even on the canvas being painted.
  deny(
    socialZones,
    'FOOTER NOTE.',
    'appended lane emitted the overlay-era footer note',
  );

  const socialFit = fitToReserveRule(SOCIAL, { allowStructuralReflow: true });
  need(
    socialFit,
    'OUTRANKS',
    'appended fit rule does not resolve the priority conflict',
  );
  need(
    socialFit,
    'COVERED AND LOST',
    'appended fit rule dropped the badge consequence, which is still true',
  );
  need(
    socialFit,
    'joined on DIRECTLY BELOW this image',
    'appended fit rule does not say the band is appended',
  );
  need(
    socialFit,
    'the design itself must reach the bottom edge',
    'appended fit rule does not require the design to reach the bottom edge',
  );
  deny(
    socialFit,
    'must be calm, plain, even background',
    'appended fit rule restored the background reserve that letterboxed the poster',
  );
  need(
    socialFit,
    'run into the bottom margin',
    'appended fit rule kept overlay-era wording about falling behind the footer',
  );
  need(
    socialFit,
    'Shrink the HEADLINE first',
    'appended fit rule lost the action that resolves the conflict',
  );
  // The bluff check: on this lane the band CANNOT cover the design, so the prompt must not say
  // it does. A model that renders a poster and sees its own last line perfectly visible has been
  // taught that this prompt's threats are negotiable.
  deny(
    socialFit,
    'pastes an OPAQUE full-width band',
    'appended fit rule still claims the footer is pasted over the design',
  );

  console.log(`${'='.repeat(78)}\nPOSTER\n${'='.repeat(78)}`);
  console.log(`${posterZones}\n\n${fitToReserveRule(POSTER)}`);
  console.log(`\n--- stamped chrome (feedback) ---\n${stamped}`);
  console.log(`\n--- reference chrome (initial) ---\n${reference}`);
  console.log(`\n${'='.repeat(78)}\nTHUMBNAIL\n${'='.repeat(78)}`);
  console.log(`${thumbZones}\n\n${fitToReserveRule(THUMB)}`);
  console.log(
    `\n${'='.repeat(78)}\nSOCIAL (appended footer)\n${'='.repeat(78)}`,
  );
  console.log(`${socialZones}\n\n${socialFit}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll reserved-zone rule assertions passed.');
  }
}
