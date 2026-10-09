// Numbers on an image-model poster: name them in the prompt, and check them afterwards.
//
// THE DEFECT (generation 93f948da): the note said «११ सदस्यांचे» and the poster said «९९». The
// text reached the image model correctly — on the verbatim lanes it is the officer's own string —
// so this is the model DRAWING the wrong glyph. Devanagari ONE and NINE have similar shapes, and
// a prompt that only says "use Devanagari numerals" gives it no way to tell which one a number is
// made of. A marker edit could not repair it either: the edit prompt said "add no new numbers"
// and "preserve existing text", which outvoted the officer's correction.
//
// Two halves, the repo's usual pair:
//   1. INSTRUCT — `numeralSpellingBlock` spells every number on the poster digit by digit, in
//      English digit names, so the model is told WHICH digits to draw rather than only which
//      script. English names, never Latin numerals: a Latin digit in the prompt is a digit the
//      model may print, and the poster must stay all-Devanagari.
//   2. CHECK — `findUnsupportedNumerals` compares what was read back off the finished poster with
//      the source. It cannot correct anything (the image model drew it), and the reader can
//      misread too, so its result is a "please check" warning, never a failure or a re-render.
//
// Pure functions, no model calls. Free harness: `npx tsx src/generation/poster-numerals.ts`.

import { pathToFileURL } from 'node:url';

import { toLatinDigits } from './digit-grounding.js';

// A number: digits, optionally joined by a single separator to more digits — «३१.५», «२०२६»,
// «१०/०८/२०२६», «१०:३०», «१,२५,०००». A hyphen is deliberately NOT a joiner: «२५-३०» is a range,
// i.e. two numbers, and each should be spelled (and checked) on its own.
const RUN = /[0-9०-९]+(?:[.,/:][0-9०-९]+)*/g;

const DIGIT_NAMES = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
] as const;

const SEPARATOR_NAMES: Record<string, string> = {
  '.': 'point',
  ',': 'comma',
  '/': 'slash',
  ':': 'colon',
};

// A poster with more numbers than this is a table, and a forty-line spelling list would bury the
// rules after it. The cap keeps the block proportionate; the read-back check still sees them all.
export const MAX_SPELLED_NUMERALS = 20;

/** Every distinct number in `text`, in order of first appearance, as written (either script). */
export function extractNumeralRuns(text: string): string[] {
  const seen = new Set<string>();
  const runs: string[] = [];
  for (const match of text.matchAll(RUN)) {
    const run = match[0];
    if (!seen.has(run)) {
      seen.add(run);
      runs.push(run);
    }
  }
  return runs;
}

function spellRun(run: string): string {
  const parts: string[] = [];
  for (const char of toLatinDigits(run)) {
    const digit = char.charCodeAt(0) - 48;
    if (digit >= 0 && digit <= 9)
      parts.push(`Devanagari ${DIGIT_NAMES[digit]}`);
    else parts.push(SEPARATOR_NAMES[char] ?? char);
  }
  return parts.join(', ');
}

/**
 * The prompt block naming every number on the poster digit by digit. Shown in Devanagari as the
 * officer wrote it (a Latin run is shown as its Devanagari form, since the poster must print that).
 * Empty string when there are no numbers, so a number-free poster's prompt is unchanged.
 */
export function numeralSpellingBlock(
  runs: readonly string[],
  heading = 'NUMBERS ON THIS POSTER — draw each one exactly, digit by digit:',
): string {
  if (runs.length === 0) return '';
  const shown = runs.slice(0, MAX_SPELLED_NUMERALS);
  const lines = [heading];
  for (const run of shown) {
    lines.push(`- ${toDevanagariForm(run)} = ${spellRun(run)}`);
  }
  // Named only when it applies, and with NO glyph in the sentence: a Devanagari NINE written
  // into the prompt of a poster that has none is a NINE the model may paint.
  const latin = shown.map((run) => toLatinDigits(run)).join('');
  if (latin.includes('1') || latin.includes('9')) {
    lines.push(
      '- Devanagari ONE and Devanagari NINE have similar shapes and are easily swapped. Draw ONE wherever this list says ONE and NINE only where it says NINE. Before finishing, check every ONE and NINE on the poster against this list.',
    );
  }
  return lines.join('\n');
}

/**
 * The edit-round form of the block: the numbers in the officer's REQUESTED CHANGE. An edit prompt
 * also says "add no new numbers" and "preserve the existing text", and those absolute-sounding
 * rules were outvoting a request like «९९ ऐवजी ११» — so this one says it outranks them. A request
 * often names both the wrong number and its replacement, and nothing here can tell which is which
 * without guessing, so the request itself is left to say that. Empty when the request has none.
 */
export function numberCorrectionBlock(requestText: string): string {
  const runs = extractNumeralRuns(requestText);
  if (runs.length === 0) return '';
  return numeralSpellingBlock(
    runs,
    'NUMBER CORRECTION — the requested change names these numbers, spelled digit by digit (the request says which number is to be replaced and which is its replacement). Wherever the change sets a number, draw it EXACTLY as spelled here. This overrides the instructions to add no new numbers and to keep the existing text unchanged:',
  );
}

/**
 * Guard on the marker interpreter (interpret-image-feedback.ts). With markers drawn, the vision
 * pass REPLACES the officer's note with its own English instruction — and it is looking at the
 * poster's current, wrong digits while it writes. When a number the officer typed did not survive
 * into that instruction, the officer's own words are appended so the edit model still sees them.
 * Instruct, then guarantee: the interpreter is asked to quote Devanagari verbatim; this checks it.
 */
export function keepOfficerNumbers(
  instruction: string,
  officerWords: string,
): string {
  const words = officerWords.trim();
  if (!words) return instruction;
  const kept = new Set(
    extractNumeralRuns(instruction).flatMap((run) => digitGroups(run)),
  );
  const lost = extractNumeralRuns(words).some((run) =>
    digitGroups(run).some((group) => !kept.has(group)),
  );
  return lost
    ? `${instruction}\nOfficer's exact wording (the numbers must match this): «${words}»`
    : instruction;
}

function toDevanagariForm(run: string): string {
  return run.replace(/[0-9]/g, (digit) =>
    String.fromCodePoint(0x0966 + Number(digit)),
  );
}

// The digit groups of a run, leading zeros dropped: «१०/०८/२०२६» → 10, 8, 2026. Compared as
// GROUPS so a poster that prints only the year of a full date is not flagged, while «१» is still
// not accepted as part of «११» (the substring test `digitsAreGrounded` uses would accept it).
function digitGroups(run: string): string[] {
  return (toLatinDigits(run).match(/[0-9]+/g) ?? []).map((group) =>
    group.replace(/^0+(?=\d)/, ''),
  );
}

/**
 * Numbers read off the poster that the source does not contain. A number in the source but absent
 * from the poster is NOT reported — a poster may legitimately leave one out.
 */
export function findUnsupportedNumerals(
  posterText: string,
  sourceText: string,
): string[] {
  const allowed = new Set(
    extractNumeralRuns(sourceText).flatMap((run) => digitGroups(run)),
  );
  return extractNumeralRuns(posterText).filter((run) =>
    digitGroups(run).some((group) => !allowed.has(group)),
  );
}

// ---------------------------------------------------------------------------
// Free harness: npx tsx src/generation/poster-numerals.ts
// ---------------------------------------------------------------------------
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const failures: string[] = [];
  const check = (ok: boolean, label: string): void => {
    if (!ok) failures.push(label);
  };
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

  // Extraction.
  check(
    same(extractNumeralRuns('३१.५ टक्के, २०२६ मध्ये, दि. १०/०८'), [
      '३१.५',
      '२०२६',
      '१०/०८',
    ]),
    'decimal, year and date are single runs',
  );
  check(
    same(extractNumeralRuns('२५-३० रुग्ण'), ['२५', '३०']),
    'a range is two numbers',
  );
  check(
    same(extractNumeralRuns('११ सदस्य, ११ सदस्य'), ['११']),
    'runs are de-duplicated',
  );
  check(extractNumeralRuns('कोणताही अंक नाही').length === 0, 'no numerals');
  check(
    same(extractNumeralRuns('१२ आणि 12'), ['१२', '12']),
    'both scripts are found',
  );

  // The spelling block.
  const block = numeralSpellingBlock(['११']);
  check(
    block.includes('- ११ = Devanagari ONE, Devanagari ONE'),
    '११ spelled as ONE, ONE',
  );
  check(block.includes('easily swapped'), 'the ONE/NINE warning fires for ११');
  check(!/[0-9]/.test(block), 'the block carries no Latin digit');
  check(!block.includes('९'), 'the block never shows a NINE the poster lacks');
  check(
    numeralSpellingBlock(['१२', '५.५']).includes(
      'Devanagari FIVE, point, Devanagari FIVE',
    ),
    'separators are named',
  );
  check(
    !numeralSpellingBlock(['२५', '३०']).includes('easily swapped'),
    'no ONE/NINE warning without a ONE or NINE',
  );
  check(
    numeralSpellingBlock(['12']).includes('- १२ ='),
    'a Latin run is shown in Devanagari',
  );
  check(numeralSpellingBlock([]) === '', 'no numbers ⇒ empty block');
  const many = Array.from({ length: 30 }, (_, i) => String(i + 100));
  check(
    numeralSpellingBlock(many)
      .split('\n')
      .filter((l) => l.includes(' = ')).length === MAX_SPELLED_NUMERALS,
    'the list is capped',
  );

  // The edit-round block.
  const correction = numberCorrectionBlock('शीर्षकाखालील ९९ ऐवजी ११ करा');
  check(
    correction.startsWith('NUMBER CORRECTION') &&
      correction.includes('- ११ = Devanagari ONE, Devanagari ONE') &&
      correction.includes('- ९९ = Devanagari NINE, Devanagari NINE'),
    'the correction block spells both numbers of the request',
  );
  check(
    correction.includes('overrides the instructions to add no new numbers'),
    'the correction block outranks the keep-text rules',
  );
  check(
    numberCorrectionBlock('शीर्षक मोठे करा') === '',
    'a request with no numbers adds nothing',
  );

  // The interpreter guard.
  const lostNumber = keepOfficerNumbers(
    'Change the number under the headline to «९९».',
    '९९ ऐवजी ११ करा',
  );
  check(
    lostNumber.includes("Officer's exact wording") &&
      lostNumber.includes('«९९ ऐवजी ११ करा»'),
    'a number the interpreter dropped brings back the officer’s words',
  );
  const keptNumber = 'Change «९९» under the headline to «11».';
  check(
    keepOfficerNumbers(keptNumber, '९९ ऐवजी ११ करा') === keptNumber,
    'an instruction that kept the numbers (either script) is unchanged',
  );
  check(
    keepOfficerNumbers('Make the headline bigger.', 'शीर्षक मोठे करा') ===
      'Make the headline bigger.',
    'a number-free note leaves the instruction alone',
  );

  // The read-back check.
  check(
    same(findUnsupportedNumerals('९९ सदस्यांचे', '११ सदस्यांचे'), ['९९']),
    '९९ is flagged against an ११ source (generation 93f948da)',
  );
  check(
    same(findUnsupportedNumerals('१ सदस्य', '११ सदस्य'), ['१']),
    '१ is NOT grounded in ११',
  );
  check(
    findUnsupportedNumerals('11 सदस्य', '११ सदस्य').length === 0,
    'mixed scripts compare equal',
  );
  check(
    findUnsupportedNumerals('२०२६', 'दि. १०/०८/२०२६').length === 0,
    'the year of a full date is grounded',
  );
  check(
    findUnsupportedNumerals('८ ऑगस्ट', 'दि. ०८ ऑगस्ट').length === 0,
    'leading zeros do not matter',
  );
  check(
    findUnsupportedNumerals('काही अंक नाहीत', '११ सदस्य').length === 0,
    'a number missing from the poster is not flagged',
  );

  if (failures.length > 0) {
    console.error(`poster-numerals: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log('poster-numerals: all checks passed');
  console.log(numeralSpellingBlock(['११', '२०२६', '३१.५']));
}
