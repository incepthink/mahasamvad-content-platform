// The "free this space" instruction block, shared verbatim by the article and
// social feedback prompt builders.
//
// It lives in code, not in the interpreted user text, for the reason
// SETTING_RULE and NO_TEXT_RULE already establish on the video path: a rule that
// travels through a model can be paraphrased away, a code-appended one cannot.
// The vision interpreter's job is only to NAME what occupies each blue box and
// propose where it should go; how the space is freed is fixed here.
//
// Phrased POSITIVELY about the freed area — what to SHOW, not merely what to
// avoid. A bare "leave it empty" is what makes an image model paint a tidy white
// panel or a placeholder frame there, which is exactly the outcome this feature
// exists to prevent: the officer is going to drop their own logo or photograph
// into that space, so it must be ordinary continuing background and nothing else.

// Badge letters drawn on the poster by annotateFeedbackRegions, in array order.
const CLEAR_LETTERS: readonly string[] = ['A', 'B', 'C'];

export function clearSpaceRuleLines(count: number): string[] {
  const n = Math.max(0, Math.min(CLEAR_LETTERS.length, Math.trunc(count) || 0));
  if (n === 0) return [];
  const letters = CLEAR_LETTERS.slice(0, n).join(', ');

  return [
    `SPACE TO FREE: the input image also carries ${n} translucent BLUE rectangle(s), each with a small blue circular badge showing a letter (${letters}). They were drawn onto the poster by editing software and are NOT part of the poster design.`,
    'For each blue rectangle, RELOCATE every design element that lies inside it — text, numerals, icon, panel, card, figure, photograph or decoration — to a suitable free position elsewhere on the same poster, at a comparable size and fully legible. Never delete it, never crop it away, never shrink it to fit, and never let it overlap other content.',
    'Rearrange only as much of the surrounding layout as is needed to accommodate the moved content and keep the poster balanced with a sensible reading order. Everything not affected by the move stays exactly where and as it is.',
    'Each blue rectangle must end up as PLAIN BACKGROUND that seamlessly continues the background immediately surrounding it — the same colour, gradient, pattern and texture, with no visible boundary or seam. Do NOT fill it with a different colour, a white or grey patch, a box, panel, band, frame, outline, shadow, placeholder, watermark, icon, figure or any text. It is deliberately empty space: a logo or photograph will be placed there afterwards by hand.',
    'Do NOT change the background colour, gradient or texture anywhere else on the poster.',
    'ERASE the blue rectangles and their lettered badges completely from the output — no blue outlines, blue tint, blue circles or letters may remain anywhere on the poster.',
  ];
}
