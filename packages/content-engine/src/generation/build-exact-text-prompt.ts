// The prompt for an EXACT-TEXT red-box edit: one enlarged crop of a poster, one string it must
// read, and a typeset picture of that string to copy the letter shapes from.
//
// Short and single-purpose on purpose. The whole-poster feedback prompt carries layout,
// chrome, clear-space and officer-picture rules; none of that applies to a crop, and every
// rule that does not apply is a sentence competing with the one that does — "the text here
// reads exactly X". The two images arrive in this order (apps/api/src/jobs/exact-text-edit.ts):
//   1. the crop being edited
//   2. the SPELLING REFERENCE — the target typeset black on white (renderSpellingReference)
//
// Also here: `groundExactText`, the deterministic half of letting a MODEL propose an exact text
// (the marker interpreter, the edit assistant). An exact text is printed verbatim on a
// government poster, so a proposed one is accepted only when the officer actually typed it.
//
// Free harness: `npx tsx src/generation/build-exact-text-prompt.ts`.

import { pathToFileURL } from 'node:url';

import { POSTER_EXACT_TEXT_MAX_CHARS } from '@dgipr/schemas';

import { extractNumeralRuns, numeralSpellingBlock } from './poster-numerals.js';

export type ExactTextPromptInput = Readonly<{
  // The string the marked text must read, exactly.
  exactText: string;
  // Where the marked box sits inside the crop, as fractions of the crop (0..1).
  target: Readonly<{ x: number; y: number; width: number; height: number }>;
  // The officer's note beside the mark, if any — context only, never the spelling source.
  note?: string | undefined;
}>;

const graphemes = new Intl.Segmenter('mr', { granularity: 'grapheme' });

/** «इ · ले · क्ट्रॉ · नि · क्स» — one cluster per akshara, so a conjunct is named as a unit. */
export function aksharaSpelling(text: string): string {
  return [...graphemes.segment(text)]
    .map((g) => g.segment)
    .filter((g) => g.trim().length > 0)
    .join(' · ');
}

const DEVANAGARI = /[ऀ-ॿ]/;

function pct(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function buildExactTextPrompt(input: ExactTextPromptInput): string {
  const text = input.exactText.trim();
  const { x, y, width, height } = input.target;
  const lines = [
    'You are correcting one piece of text in a close-up crop of a DGIPR Maharashtra government poster.',
    'Two images are attached. IMAGE 1 is the crop to edit. IMAGE 2 is a SPELLING REFERENCE: the correct text typeset in black on white.',
    '',
    `THE TEXT TO CORRECT is the text in IMAGE 1 roughly ${pct(x)}%–${pct(x + width)}% from the left and ${pct(y)}%–${pct(y + height)}% from the top. After the edit it must read EXACTLY:`,
    `«${text}»`,
    '',
    'HOW TO WRITE IT:',
    '- Copy the letter shapes, conjuncts, vowel signs and digits from IMAGE 2 exactly — every matra, every half-letter, every anusvara, every digit. Do not draw any letter from memory; IMAGE 2 is the authority on spelling.',
    "- Render it in the POSTER'S OWN style, matching the text it replaces in IMAGE 1: the same font style, weight, colour, size, line position and alignment. Never paste IMAGE 2 itself — no white box, no black text unless the original text was black.",
    '- If the corrected text is a little longer or shorter than the old one, keep it on the same line and the same baseline, tightening or easing the spacing slightly so it fits.',
    '- Write the corrected text ONCE. Remove every trace of the old wording at that spot.',
  ];
  if (DEVANAGARI.test(text)) {
    lines.push(`- Spelled akshara by akshara: ${aksharaSpelling(text)}`);
  }
  const numbers = numeralSpellingBlock(
    extractNumeralRuns(text),
    'NUMBERS IN THE CORRECTED TEXT — draw each one exactly, digit by digit:',
  );
  if (numbers) lines.push('', numbers);
  if (input.note?.trim()) {
    lines.push(
      '',
      `The editor's note about this spot (context only; the spelling comes from IMAGE 2): «${input.note.trim()}»`,
    );
  }
  lines.push(
    '',
    'KEEP EVERYTHING ELSE IN IMAGE 1 EXACTLY AS IT IS: the background, colours, shapes, photographs, icons and any other text, including text cut off at the edges of the crop. Do not zoom, crop, re-frame or shift anything. Output the whole of IMAGE 1 at the same framing with only that text corrected.',
  );
  return lines.join('\n');
}

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Quotes an officer wraps an exact text in — straight, curly, guillemets and the Marathi-press ‘…’.
function stripQuotes(text: string): string {
  return text.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
}

/**
 * A model-proposed exact text, accepted only when it appears VERBATIM in what the officer wrote
 * (`sources`: their notes and messages). Returns the cleaned string, or '' to mean "none" —
 * a proposal the officer never typed is dropped, never repaired, because it is printed as is.
 */
export function groundExactText(
  candidate: string | null | undefined,
  sources: readonly string[],
): string {
  const text = normalize(stripQuotes(normalize(candidate ?? '')));
  if (!text || [...text].length > POSTER_EXACT_TEXT_MAX_CHARS) return '';
  const said = sources.map(normalize).join('\n');
  return said.includes(text) ? text : '';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    if (!ok) failures.push(label);
    else console.log(`ok  ${label}`);
  };

  const prompt = buildExactTextPrompt({
    exactText: '११ सदस्यांचे',
    target: { x: 0.25, y: 0.3, width: 0.5, height: 0.4 },
    note: '९९ ऐवजी ११',
  });
  check(prompt.includes('«११ सदस्यांचे»'), 'states the exact text');
  check(
    prompt.includes('IMAGE 2 is a SPELLING REFERENCE'),
    'names the spelling reference',
  );
  check(
    prompt.includes('Never paste IMAGE 2'),
    'forbids pasting the reference',
  );
  check(
    prompt.includes('25%–75% from the left'),
    'locates the target in the crop',
  );
  check(prompt.includes('Devanagari ONE, Devanagari ONE'), 'spells the digits');
  check(prompt.includes('easily swapped'), 'carries the ONE/NINE warning');
  check(prompt.includes('akshara by akshara'), 'spells the aksharas');
  check(prompt.includes('KEEP EVERYTHING ELSE'), 'keeps the rest of the crop');
  check(!prompt.includes('reserved'), 'no whole-poster chrome rules');

  check(
    aksharaSpelling('इलेक्ट्रॉनिक्स') === 'इ · ले · क्ट्रॉ · नि · क्स',
    `akshara split keeps conjuncts whole (${aksharaSpelling('इलेक्ट्रॉनिक्स')})`,
  );
  const latin = buildExactTextPrompt({
    exactText: 'Mahasamvad',
    target: { x: 0, y: 0, width: 1, height: 1 },
  });
  check(
    !latin.includes('akshara by akshara'),
    'no akshara line for Latin text',
  );
  check(!latin.includes('NUMBERS IN'), 'no numbers block without digits');

  check(
    groundExactText('«११»', ['९९ ऐवजी ११ करा']) === '११',
    'grounded text accepted, quotes stripped',
  );
  check(
    groundExactText('१२', ['९९ ऐवजी ११ करा']) === '',
    'invented text refused',
  );
  check(groundExactText('  ', ['x']) === '', 'blank is none');
  check(
    groundExactText('इलेक्ट्रॉनिक्स', [
      'हा शब्द इलेक्ट्रॉनिक्स असा हवा'.normalize('NFD'),
    ]) === 'इलेक्ट्रॉनिक्स',
    'normalisation-insensitive',
  );
  check(
    groundExactText('x'.repeat(81), ['x'.repeat(81)]) === '',
    'over the length cap refused',
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll exact-text prompt checks passed.');
  }
}
