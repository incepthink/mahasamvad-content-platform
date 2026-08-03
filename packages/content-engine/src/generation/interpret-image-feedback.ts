// Turn a user's pointing gestures on a finished poster into one precise edit
// instruction for the image model.
//
// Why this exists: poster image feedback used to be a bare text string with no
// location signal, so a vague ask ("make this bigger") routinely produced no
// change at all — an expensive miss at ~1-2 minutes per render round. Now the
// web UI lets the user drop numbered markers on the poster, each with its own
// note. A marker is a POINTING GESTURE, not a mask: the user means the whole
// design element at/around the mark, however roughly they boxed it. This vision
// pass looks at the marker-annotated poster, works out which concrete element
// each marker indicates, and writes a consolidated English instruction the
// images/edits prompt can carry. On any failure it falls back to the raw notes
// with coarse grid positions — still numbered, so the n8n prompt's "apply the
// correspondingly numbered change" wording keeps working either way.

import { chatCompleteVision, VISION_MODEL } from './openai-chat.js';
import type { ClearAction } from './clear-space-rule.js';

export type FeedbackAnnotationInput = Readonly<{
  // 1-based, matching the badge drawn on the poster.
  index: number;
  // The user's note, usually Marathi.
  note: string;
  // Normalized 0..1 rectangle on the poster.
  region: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

// One BLUE lettered rectangle: space the officer wants freed for their own logo
// or photograph. This pass only has to NAME what sits inside it (and, for a
// displace, where that content could sensibly go) — the rule about how to free it
// is hard-appended in the prompt builders, where a model cannot paraphrase it
// away.
export type ClearRegionInput = Readonly<{
  // 'A', 'B' — matching the badge drawn on the poster.
  letter: string;
  // The officer's optional steer. Absent = the model chooses the destination.
  note?: string | undefined;
  // 'displace' keeps the content on the poster (a re-layout); 'remove' deletes it.
  // The two need different sentences from this pass: one proposes a destination,
  // the other must NOT.
  action: ClearAction;
  region: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

export type InterpretImageFeedbackInput = Readonly<{
  // The poster WITH the annotations drawn on (annotateFeedbackRegions).
  markedPosterPng: Buffer;
  annotations: readonly FeedbackAnnotationInput[];
  clearRegions?: readonly ClearRegionInput[] | undefined;
  // Optional whole-poster note submitted alongside the markers.
  overallNote?: string | undefined;
  posterKind: 'article' | 'twitter';
}>;

export type InterpretedImageFeedback = Readonly<{
  instruction: string;
  // Every distinct piece of information currently on the poster, read off the
  // pixels. Requested ONLY when a 'displace' box is present, because that is the
  // one round that re-lays the poster out and therefore needs a checklist of what
  // must survive it — see contentInventoryLines. Empty on the fallback path and
  // whenever no displace was asked for.
  contentInventory: readonly string[];
  // 'fallback' = the vision call failed and the raw notes were used instead.
  source: 'vision' | 'fallback';
}>;

// Spatial reasoning over a full poster + Devanagari reading needs the authoring tier.
// VISION_MODEL (gpt-5.6-terra) is that tier and is env-overridable, so this no longer
// pins its own id.
const INTERPRETER_MODEL = VISION_MODEL;
const MAX_INSTRUCTION_CHARS = 1_500;
// The instruction alone fits in 500; a Marathi inventory of a dense list poster does
// not (~1 token per 1.2-1.8 chars), and an exhausted budget returns EMPTY content
// rather than a short answer. Raised only for the round that asks for one, so a plain
// marker round bills exactly as before. maxTokens is answer room — chatComplete adds
// the reasoning headroom on top.
const MAX_TOKENS_PLAIN = 500;
const MAX_TOKENS_WITH_INVENTORY = 2_000;
const MAX_INVENTORY_ITEMS = 40;

// Coarse position words from a 3x3 grid over the region's center — used both in
// the vision prompt (to anchor each marker) and in the fallback instruction.
function gridPosition(region: FeedbackAnnotationInput['region']): string {
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const col = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'center' : 'right';
  const row = cy < 1 / 3 ? 'top' : cy < 2 / 3 ? 'middle' : 'bottom';
  if (row === 'middle' && col === 'center') return 'center';
  return `${row}-${col}`;
}

function markerLines(
  annotations: readonly FeedbackAnnotationInput[],
): string[] {
  return annotations.map((a) => {
    const cx = Math.round((a.region.x + a.region.width / 2) * 100);
    const cy = Math.round((a.region.y + a.region.height / 2) * 100);
    return `Marker ${a.index} — note: «${a.note}» — centered at ~${cx}% from left, ~${cy}% from top (${gridPosition(a.region)} area).`;
  });
}

function clearLines(clearRegions: readonly ClearRegionInput[]): string[] {
  return clearRegions.map((c) => {
    const cx = Math.round((c.region.x + c.region.width / 2) * 100);
    const cy = Math.round((c.region.y + c.region.height / 2) * 100);
    const w = Math.round(c.region.width * 100);
    const h = Math.round(c.region.height * 100);
    const note = c.note ? ` — the editor's steer: «${c.note}»` : '';
    const action =
      c.action === 'remove'
        ? 'DELETE what is inside (it is not wanted on the poster at all)'
        : 'MOVE what is inside somewhere else on the poster (it must stay on the poster)';
    return `Blue box ${c.letter} [${action}] — centred at ~${cx}% from left, ~${cy}% from top (${gridPosition(c.region)} area), about ${w}% wide and ${h}% tall${note}.`;
  });
}

function buildPrompt(input: InterpretImageFeedbackInput): string {
  const kind =
    input.posterKind === 'twitter'
      ? 'a single 4:5 portrait social-media poster'
      : 'a single landscape article poster';
  const clearRegions = input.clearRegions ?? [];
  const drawn = [
    input.annotations.length > 0
      ? `${input.annotations.length} numbered red annotation box(es)`
      : '',
    clearRegions.length > 0
      ? `${clearRegions.length} lettered blue translucent box(es)`
      : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const lines = [
    "You are converting a government poster editor's pointing gestures into one precise edit instruction for an image-editing model.",
    `The attached image is the current finished DGIPR Maharashtra poster (${kind}) with ${drawn} drawn on top by software.`,
    '',
    ...markerLines(input.annotations),
  ];
  if (clearRegions.length > 0) {
    lines.push(
      '',
      'The BLUE boxes mark space the editor wants FREED so they can place their own logo or photograph there afterwards. Each one says what happens to the content currently inside it — DELETE (it goes away entirely) or MOVE (it stays on the poster but elsewhere). Read each box\'s own instruction below; do not assume they are the same.',
      ...clearLines(clearRegions),
    );
  }
  if (input.overallNote) {
    lines.push(`Overall note (applies to the whole poster): «${input.overallNote}»`);
  }
  lines.push(
    '',
    'TASK: For each drawn box, identify the specific design element at or around it — a headline, a specific Devanagari text block, the photograph and its subject, a colour panel, an icon, a bullet card, a background region. Then write ONE consolidated English instruction that (a) references each box by its number or letter, (b) names the element concretely — its content, colour, and position in plain words, quoting any Devanagari text verbatim — and (c) states the requested change precisely.',
    'RULES:',
    '- Red markers are pointing gestures: the user means the whole element the marker touches, not the box interior. Never write "inside the box" or "only within the rectangle".',
    '- Do not invent changes beyond the notes. If a note is ambiguous, choose the most likely reading of what the marked element needs.',
    '- Notes may be in Marathi; the instruction is English, but Devanagari quotes stay verbatim.',
    '- Keep it under ~120 words. The instruction must stand alone — the editing model sees the same marked image and will match your marker numbers to the drawn badges.',
  );
  if (clearRegions.length > 0) {
    lines.push(
      '- For EACH blue box, add one sentence to the instruction that (a) names it by its letter and (b) names concretely what currently occupies that area — quoting any Devanagari verbatim. If a blue box covers only plain background, say that it is already empty and only needs the blue rectangle removed.',
      '- For a MOVE box, that sentence must also propose a specific place in the layout the content should go, and say plainly if fitting it there means re-laying-out the poster (compressing a list, re-columning, restacking, resizing rows). A re-layout is allowed and expected. Honour the editor\'s steer where one is given. Never propose deleting, cropping, shrinking away or summarising MOVE content.',
      '- For a DELETE box, say only that the content goes away and that nothing else on the poster moves. Never propose a destination for it, and never propose closing up the gap.',
      '- Never propose moving anything into the software-stamped branding zones described below.',
    );
  }
  if (clearRegions.some((c) => c.action === 'displace')) {
    lines.push(
      '',
      `INVENTORY: because a MOVE re-lays the poster out, also return "items" — every distinct piece of information visible on this poster right now, read off the image in reading order, each as ONE short Marathi string copied VERBATIM from the poster (headline, kicker, each numbered/bulleted line, each stat, each caption; Devanagari and numerals exactly as printed). This is the checklist the editing model is held to, so it must be complete and it must not include anything that is not actually on the poster. Ignore the red and blue annotation boxes themselves, and ignore the software-stamped branding (emblem, footer strip, social handles). At most ${MAX_INVENTORY_ITEMS} items.`,
    );
  }
  if (input.posterKind === 'article') {
    lines.push(
      '- The top-left महासंवाद logo card and the full-width bottom footer strip are branding stamped by software AFTER editing and cannot be changed by the edit. If a marker points at one of them, say so briefly and interpret the nearest plausible editable intent instead.',
    );
  } else {
    lines.push(
      '- The top-right white rounded-square महाराष्ट्र शासन emblem-and-wordmark badge and the full-width bottom footer strip are branding stamped by software AFTER editing and cannot be changed by the edit. If a marker points at one of them, say so briefly and interpret the nearest plausible editable intent instead.',
    );
  }
  lines.push(
    '',
    wantsInventory(input)
      ? 'Respond with STRICT JSON only: {"instruction": "...", "items": ["...", "..."]}'
      : 'Respond with STRICT JSON only: {"instruction": "..."}',
  );
  return lines.join('\n');
}

function wantsInventory(input: InterpretImageFeedbackInput): boolean {
  return (input.clearRegions ?? []).some((c) => c.action === 'displace');
}

// The degradation path: numbered raw notes with grid positions. Deliberately
// mechanical — no model involved — so an OpenAI outage never blocks feedback.
// There is no inventory here: it can only be read off the pixels, and the
// displace rule in the prompt builders stands on its own without one.
function buildFallbackInstruction(input: InterpretImageFeedbackInput): string {
  const parts = input.annotations.map(
    (a) =>
      `Marker ${a.index} (red box ${a.index}, in the ${gridPosition(a.region)} area): «${a.note}».`,
  );
  for (const c of input.clearRegions ?? []) {
    parts.push(
      c.action === 'remove'
        ? `Blue box ${c.letter} (in the ${gridPosition(c.region)} area): delete whatever design content lies inside it and move nothing else` +
            (c.note ? ` — «${c.note}»` : '') +
            '.'
        : `Blue box ${c.letter} (in the ${gridPosition(c.region)} area): move whatever design content lies inside it elsewhere on the poster, re-laying the layout out as needed` +
            (c.note ? ` — «${c.note}»` : '') +
            '.',
    );
  }
  if (input.overallNote) parts.push(`Overall: «${input.overallNote}».`);
  if (input.annotations.length > 0) {
    parts.push(
      'Apply each numbered change to the design element the correspondingly numbered red marker points at.',
    );
  }
  return parts.join(' ');
}

// Best-effort: a malformed or absent "items" costs the checklist, never the round.
function parseInventory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_INVENTORY_ITEMS);
}

export async function interpretImageFeedback(
  input: InterpretImageFeedbackInput,
): Promise<InterpretedImageFeedback> {
  const withInventory = wantsInventory(input);
  try {
    const dataUrl = `data:image/png;base64,${input.markedPosterPng.toString('base64')}`;
    const raw = await chatCompleteVision(buildPrompt(input), dataUrl, {
      model: INTERPRETER_MODEL,
      responseFormat: 'json_object',
      temperature: 0.2,
      maxTokens: withInventory ? MAX_TOKENS_WITH_INVENTORY : MAX_TOKENS_PLAIN,
    });
    const parsed = JSON.parse(raw) as {
      instruction?: unknown;
      items?: unknown;
    };
    const instruction =
      typeof parsed.instruction === 'string' ? parsed.instruction.trim() : '';
    if (!instruction) {
      throw new Error(`Interpreter returned no instruction: ${raw.slice(0, 300)}`);
    }
    return {
      instruction: instruction.slice(0, MAX_INSTRUCTION_CHARS),
      contentInventory: withInventory ? parseInventory(parsed.items) : [],
      source: 'vision',
    };
  } catch (error) {
    console.warn(
      `[interpret-image-feedback] vision pass failed, using raw notes: ${(error as Error).message}`,
    );
    return {
      instruction: buildFallbackInstruction(input),
      contentInventory: [],
      source: 'fallback',
    };
  }
}
