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

export type FeedbackAnnotationInput = Readonly<{
  // 1-based, matching the badge drawn on the poster.
  index: number;
  // The user's note, usually Marathi.
  note: string;
  // Normalized 0..1 rectangle on the poster.
  region: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

// One BLUE lettered rectangle: space the officer wants freed for their own logo
// or photograph. This pass only has to NAME what sits inside it (and where that
// content could sensibly go) — the rule about how to free it is hard-appended in
// the prompt builders, where a model cannot paraphrase it away.
export type ClearRegionInput = Readonly<{
  // 'A', 'B' — matching the badge drawn on the poster.
  letter: string;
  // The officer's optional steer. Absent = the model chooses the destination.
  note?: string | undefined;
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
  // 'fallback' = the vision call failed and the raw notes were used instead.
  source: 'vision' | 'fallback';
}>;

// Spatial reasoning over a full poster + Devanagari reading needs the authoring tier.
// VISION_MODEL (gpt-5.6-terra) is that tier and is env-overridable, so this no longer
// pins its own id.
const INTERPRETER_MODEL = VISION_MODEL;
const MAX_INSTRUCTION_CHARS = 1_500;

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
    return `Blue box ${c.letter} — centred at ~${cx}% from left, ~${cy}% from top (${gridPosition(c.region)} area), about ${w}% wide and ${h}% tall${note}.`;
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
      'The BLUE boxes mark space the editor wants FREED so they can place their own logo or photograph there afterwards. Whatever design content sits inside a blue box must be moved elsewhere in the layout — never deleted, never shrunk away.',
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
      '- For EACH blue box, add one sentence to the instruction that (a) names it by its letter, (b) names concretely what currently occupies that area — quoting any Devanagari verbatim — and (c) proposes a specific place in the layout that content should move to, chosen so the poster stays balanced and reads in a sensible order. Honour the editor\'s steer where one is given. If a blue box covers only plain background, say that it is already empty and only needs the blue rectangle removed.',
      '- Never propose deleting, cropping or shrinking blue-box content away, and never propose moving anything into the software-stamped branding zones described below.',
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
  lines.push('', 'Respond with STRICT JSON only: {"instruction": "..."}');
  return lines.join('\n');
}

// The degradation path: numbered raw notes with grid positions. Deliberately
// mechanical — no model involved — so an OpenAI outage never blocks feedback.
function buildFallbackInstruction(input: InterpretImageFeedbackInput): string {
  const parts = input.annotations.map(
    (a) =>
      `Marker ${a.index} (red box ${a.index}, in the ${gridPosition(a.region)} area): «${a.note}».`,
  );
  for (const c of input.clearRegions ?? []) {
    parts.push(
      `Blue box ${c.letter} (in the ${gridPosition(c.region)} area): move whatever design content lies inside it to a suitable free place elsewhere in the layout` +
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

export async function interpretImageFeedback(
  input: InterpretImageFeedbackInput,
): Promise<InterpretedImageFeedback> {
  try {
    const dataUrl = `data:image/png;base64,${input.markedPosterPng.toString('base64')}`;
    const raw = await chatCompleteVision(buildPrompt(input), dataUrl, {
      model: INTERPRETER_MODEL,
      responseFormat: 'json_object',
      temperature: 0.2,
      maxTokens: 500,
    });
    const parsed = JSON.parse(raw) as { instruction?: unknown };
    const instruction =
      typeof parsed.instruction === 'string' ? parsed.instruction.trim() : '';
    if (!instruction) {
      throw new Error(`Interpreter returned no instruction: ${raw.slice(0, 300)}`);
    }
    return {
      instruction: instruction.slice(0, MAX_INSTRUCTION_CHARS),
      source: 'vision',
    };
  } catch (error) {
    console.warn(
      `[interpret-image-feedback] vision pass failed, using raw notes: ${(error as Error).message}`,
    );
    return { instruction: buildFallbackInstruction(input), source: 'fallback' };
  }
}
