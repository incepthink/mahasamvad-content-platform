// The "free this space" instruction blocks, shared verbatim by the article,
// social and YouTube-thumbnail feedback prompt builders.
//
// They live in code, not in the interpreted user text, for the reason
// SETTING_RULE and NO_TEXT_RULE already establish on the video path: a rule that
// travels through a model can be paraphrased away, a code-appended one cannot.
// The vision interpreter's job is only to NAME what occupies each blue box, say
// where it could go, and list what must survive — how the space is freed is
// fixed here.
//
// TWO ACTIONS, and they are separate because they need OPPOSITE permissions:
//
//   'remove'   — delete what is inside; change nothing else. The builders'
//                "keep the exact layout unchanged" rule is CORRECT here and stays.
//   'displace' — the content stays on the poster and moves elsewhere, which on a
//                full poster is only possible by re-laying it out. So for a
//                displace round that keep-layout rule must be DROPPED, not
//                hedged, and replaced by DISPLACE_PRESERVE_RULE below.
//
// That hedge is exactly why the original single-gesture version no-opped: "Keep
// the exact layout … unchanged" and "everything not affected stays exactly where
// it is" read as unconditional, the permission to move was a subordinate clause
// inside the first of them, and on a full-bleed list poster the cheapest way to
// satisfy the loudest constraints was to repaint the input unchanged.
//
// Everything about the freed rectangle itself is phrased POSITIVELY — what to
// SHOW, not merely what to avoid. A bare "leave it empty" is what makes an image
// model paint a tidy white panel or a placeholder frame there, which is the
// outcome this feature exists to prevent: the officer is going to drop their own
// logo or photograph into that space, so it must be ordinary continuing
// background and nothing else.

import { pathToFileURL } from 'node:url';

// What happens to the content inside a blue rectangle. Mirrors PosterClearAction
// in @dgipr/schemas; restated as a plain union rather than imported so this
// module stays dependency-free like the prompt builders that use it.
export type ClearAction = 'displace' | 'remove';

// Badge letters drawn on the poster by annotateFeedbackRegions, in array order.
const CLEAR_LETTERS: readonly string[] = ['A', 'B', 'C'];

// Guard rails on the inventory that reaches the prompt: enough to describe a
// dense list poster, bounded so a misbehaving vision pass cannot balloon the
// image prompt.
const MAX_INVENTORY_ITEMS = 40;
const MAX_INVENTORY_ITEM_CHARS = 200;

export type ClearSpaceRule = Readonly<{
  // The block to append at the END of the edit prompt — last position is what
  // these models weight most, and this is the officer's actual ask.
  lines: string[];
  hasDisplace: boolean;
  hasRemove: boolean;
  count: number;
}>;

// Replaces the builders' "Keep the exact layout … unchanged" sentence whenever a
// DISPLACE box is present. The information is fixed; the arrangement is not.
// One rule, no sub-clause hedge — the hedge is what lost last time.
export const DISPLACE_PRESERVE_RULE =
  "The poster's INFORMATION is fixed but its ARRANGEMENT is not. Every Marathi word, numeral, figure and photograph already on the poster must still appear afterwards, with its wording and its numbers unchanged, and the colour scheme, background artwork and typefaces stay as they are — but you MAY re-lay-out where those elements sit and how large they are, as far as the SPACE TO FREE block below requires. Change nothing that neither that block nor the requested change requires.";

function lettersFor(
  actions: readonly ClearAction[],
  want: ClearAction,
): string[] {
  return actions
    .map((action, i) => (action === want ? (CLEAR_LETTERS[i] ?? '') : ''))
    .filter((letter) => letter.length > 0);
}

// The SPACE TO FREE block for a round's blue rectangles, in the order they were
// drawn — which is the order their A/B badges were painted on the poster, so the
// letters here and the letters in the image always agree.
//
// An empty list returns no lines at all, so a round with no blue boxes is
// byte-for-byte what it was before this feature existed.
export function clearSpaceRule(
  actions: readonly ClearAction[],
): ClearSpaceRule {
  const kept = actions.slice(0, CLEAR_LETTERS.length);
  const removeLetters = lettersFor(kept, 'remove');
  const displaceLetters = lettersFor(kept, 'displace');
  const rule: string[] = [];

  if (kept.length > 0) {
    const letters = kept.map((_, i) => CLEAR_LETTERS[i]).join(', ');
    rule.push(
      `SPACE TO FREE: the input image also carries ${kept.length} translucent BLUE rectangle(s), each with a small blue circular badge showing a letter (${letters}). They were drawn onto the poster by editing software and are NOT part of the poster design. Each one marks an area the editor is clearing so they can place their own logo or photograph there by hand afterwards.`,
    );
  }

  if (removeLetters.length > 0) {
    rule.push(
      `DELETE — blue box ${removeLetters.join(', ')}: remove every design element that lies inside it (text, numerals, icon, panel, card, figure, photograph or decoration) so that area is left empty. That content is not wanted: do NOT move it elsewhere, do NOT summarise it, and do NOT put anything in its place. Everything OUTSIDE these rectangles stays exactly as it is now — same position, same size, same wording, same appearance — and the gap is NOT closed up or re-balanced.`,
    );
  }

  if (displaceLetters.length > 0) {
    rule.push(
      `MOVE — blue box ${displaceLetters.join(', ')}: the content inside must LEAVE that rectangle but must NOT leave the poster. Re-lay-out the poster so it fits somewhere else.`,
      "You are explicitly permitted, and expected, to redesign the arrangement to make that possible: move, resize, restack, re-column and re-balance the poster's existing rows, panels, cards, icons, headline and body blocks as much as is needed to open up that space. A visibly rearranged poster is a CORRECT result here, not a mistake — returning the poster unchanged is a failure.",
      'What you may NOT do is lose anything. Every heading, sentence, phrase, numeral, icon and photograph on the poster now must still be on the poster afterwards — the same words, the same numbers, fully legible at a readable size, not overlapping anything, in a sensible reading order. Never delete, crop, truncate, abbreviate, merge or summarise content to make it fit, and never invent new content.',
    );
  }

  if (kept.length > 0) {
    rule.push(
      'Every blue rectangle must end up as PLAIN EMPTY BACKGROUND that seamlessly continues the background immediately surrounding it — the same colour, gradient, pattern, artwork and texture, with no visible boundary or seam. Do NOT fill it with a different colour, a white or grey patch, a box, panel, band, frame, outline, shadow, placeholder, watermark, icon, figure or any text, and let nothing overlap it. It is deliberately empty space: a logo or photograph will be placed there afterwards by hand.',
      "Keep the poster's colour scheme, background artwork and typefaces as they are — a re-layout changes where elements sit and how large they are, never the palette, the background artwork or the fonts.",
      'ERASE the blue rectangles and their lettered badges completely from the output — no blue outlines, blue tint, blue circles or letters may remain anywhere on the poster.',
    );
  }

  return {
    lines: rule,
    hasDisplace: displaceLetters.length > 0,
    hasRemove: removeLetters.length > 0,
    count: kept.length,
  };
}

// The survival inventory: what the vision pass read off the CURRENT poster,
// restated to the image model as a checklist. This is what turns a displace from
// an impossible "keep the exact layout AND move things" into a satisfiable "keep
// all the content, rearrange freely" — a re-layout has no anchor otherwise, and a
// model asked to rearrange a dense poster without one drops rows.
//
// Empty (the vision pass failed, or nothing was read) returns no lines, so the
// displace rule above still stands on its own.
export function contentInventoryLines(
  items: readonly string[] | undefined,
): string[] {
  const clean = (items ?? [])
    .map((item) => item.trim().slice(0, MAX_INVENTORY_ITEM_CHARS))
    .filter((item) => item.length > 0)
    .slice(0, MAX_INVENTORY_ITEMS);
  if (clean.length === 0) return [];
  return [
    `INFORMATION THAT MUST SURVIVE — ${clean.length} item(s) read off the poster you are editing. After the re-layout every one of these must still be present, in Marathi, spelled and numbered exactly as here. Count them in your output before you finish:`,
    ...clean.map((item, i) => `  ${i + 1}. ${item}`),
  ];
}

// --- CLI harness -----------------------------------------------------------
//   tsx src/generation/clear-space-rule.ts
// Pure string assembly — no model call, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) failures.push(label);
  };

  // 1. No boxes ⇒ nothing at all, so a plain feedback round is untouched.
  const none = clearSpaceRule([]);
  check(none.lines.length === 0, 'empty action list produced lines');
  check(
    !none.hasDisplace && !none.hasRemove && none.count === 0,
    'empty action list reported flags',
  );

  // 2. Remove only — the delete wording is present and the move wording is not.
  const removeOnly = clearSpaceRule(['remove']);
  const removeText = removeOnly.lines.join('\n');
  check(removeOnly.hasRemove && !removeOnly.hasDisplace, 'remove-only flags');
  check(removeText.includes('DELETE — blue box A'), 'remove block missing');
  check(!removeText.includes('MOVE — blue box'), 'remove-only leaked MOVE');
  check(
    removeText.includes('stays exactly as it is now'),
    'remove-only lost its keep-everything-else rule',
  );
  check(
    removeText.includes('1 translucent BLUE rectangle'),
    'remove-only lost the preamble count',
  );

  // 3. Displace only — the permission to redesign must be explicit, and the
  //    remove wording must NOT appear (it would re-introduce the contradiction
  //    that made this gesture a no-op).
  const displaceOnly = clearSpaceRule(['displace']);
  const displaceText = displaceOnly.lines.join('\n');
  check(
    displaceOnly.hasDisplace && !displaceOnly.hasRemove,
    'displace-only flags',
  );
  check(displaceText.includes('MOVE — blue box A'), 'displace block missing');
  check(!displaceText.includes('DELETE — blue box'), 'displace leaked DELETE');
  check(
    displaceText.includes('explicitly permitted'),
    'displace lost its permission to redesign',
  );
  check(
    !displaceText.includes('stays exactly as it is now'),
    'displace kept the contradictory keep-everything rule',
  );
  check(
    displaceText.includes('returning the poster unchanged is a failure'),
    'displace lost the no-op rejection',
  );

  // 4. A mixed round addresses each box by its own letter.
  const mixed = clearSpaceRule(['remove', 'displace']);
  const mixedText = mixed.lines.join('\n');
  check(mixed.hasRemove && mixed.hasDisplace, 'mixed flags');
  check(
    mixedText.includes('DELETE — blue box A'),
    'mixed lost remove letter A',
  );
  check(
    mixedText.includes('MOVE — blue box B'),
    'mixed lost displace letter B',
  );
  check(
    mixedText.includes('2 translucent BLUE rectangle'),
    'mixed lost the preamble count',
  );

  // 5. Letters follow the DRAW order, not the action grouping — they have to
  //    match the badges annotateFeedbackRegions painted in that same order.
  const swapped = clearSpaceRule(['displace', 'remove']);
  const swappedText = swapped.lines.join('\n');
  check(
    swappedText.includes('MOVE — blue box A') &&
      swappedText.includes('DELETE — blue box B'),
    'letters did not follow draw order',
  );

  // 6. The shared closing rules are on every non-empty round.
  for (const [label, rule] of [
    ['remove', removeOnly],
    ['displace', displaceOnly],
    ['mixed', mixed],
  ] as const) {
    const text = rule.lines.join('\n');
    for (const needle of [
      'PLAIN EMPTY BACKGROUND',
      'ERASE the blue rectangles',
      'colour scheme, background artwork and typefaces',
    ]) {
      check(text.includes(needle), `${label} round lost "${needle}"`);
    }
  }

  // 7. Over-cap input is clamped to the letters that exist rather than throwing
  //    or emitting a box with no badge on the poster.
  const over = clearSpaceRule([
    'remove',
    'remove',
    'remove',
    'displace',
    'displace',
  ]);
  check(over.count === 3, `over-cap round kept ${over.count} boxes, want 3`);
  check(!over.hasDisplace, 'over-cap round kept a box past the letter cap');

  // 8. Inventory: bounded, trimmed, numbered, and empty-safe.
  check(contentInventoryLines(undefined).length === 0, 'undefined inventory');
  check(contentInventoryLines([]).length === 0, 'empty inventory');
  check(
    contentInventoryLines(['  ', '\n']).length === 0,
    'whitespace-only inventory produced lines',
  );
  const inv = contentInventoryLines([
    '  पिण्याचे पाणी १५ मिनिटे उकळून घ्या  ',
    'शिळे अन्न टाळा',
  ]);
  check(inv.length === 3, `inventory line count ${inv.length}, want 3`);
  check(inv[0]?.includes('2 item(s)') === true, 'inventory lost its count');
  check(
    inv[1] === '  1. पिण्याचे पाणी १५ मिनिटे उकळून घ्या',
    `inventory item not trimmed/numbered: ${JSON.stringify(inv[1])}`,
  );
  const big = contentInventoryLines(
    Array.from({ length: 60 }, (_, i) => `item ${i}`),
  );
  check(big.length === MAX_INVENTORY_ITEMS + 1, 'inventory not capped at 40');
  const long = contentInventoryLines(['x'.repeat(500)]);
  check(
    (long[1]?.length ?? 0) <= MAX_INVENTORY_ITEM_CHARS + 8,
    'inventory item not truncated',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `All clear-space rule assertions passed.\n\n--- mixed round ---\n${mixed.lines.join('\n')}`,
    );
  }
}
