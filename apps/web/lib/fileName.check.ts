// Assertions for the display-name trimmer. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/fileName.check.ts
//
// (from a workspace that has tsx — packages/content-engine does.)
//
// The first case is the name that was actually on an officer's phone when this was
// reported: it pushed the /dlo review card off the screen. In its own file rather than
// behind a `--check` flag inside the module, so nothing in the Next bundle can reach
// `process` — the errorMessage.check.ts precedent.

import {
  FILE_NAME_MAX_CHARS,
  FILE_TITLE_MAX_CHARS,
  shortFileName,
} from './fileName';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function len(text: string): number {
  return Array.from(text).length;
}

// --------------------------------------------------------------------------
// 1. The reported name.
// --------------------------------------------------------------------------

const REPORTED = '54254676-ae8d-4efc-a2ad-aca8b0bfa729-1_all_32002.jpg';
const short = shortFileName(REPORTED);

check('reported name is trimmed', short !== REPORTED, short);
check(
  'reported name fits the budget',
  len(short) <= FILE_NAME_MAX_CHARS,
  short,
);
check('reported name keeps its extension', short.endsWith('.jpg'), short);
check('reported name keeps its head', short.startsWith('54254676-'), short);
check('reported name is marked as cut', short.includes('…'), short);

// --------------------------------------------------------------------------
// 2. Short names are returned untouched — that identity is what lets a caller
//    decide whether a `title` tooltip is worth adding.
// --------------------------------------------------------------------------

for (const name of [
  'note.pdf',
  'बैठक.docx',
  'IMG_2026.jpg',
  'a'.repeat(FILE_NAME_MAX_CHARS),
]) {
  check(
    `untouched under budget: ${name.slice(0, 16)}`,
    shortFileName(name) === name,
  );
}

check(
  'trims surrounding whitespace',
  shortFileName('  note.pdf  ') === 'note.pdf',
);
check('empty stays empty', shortFileName('') === '');

// --------------------------------------------------------------------------
// 3. Every shape stays inside the budget, whatever the budget is.
// --------------------------------------------------------------------------

const SAMPLES = [
  REPORTED,
  'WhatsApp Image 2026-08-25 at 15.46.55 (1).jpeg',
  'शासन-निर्णय-२०२६-०८-२५-उच्च-व-तंत्रशिक्षण-विभाग-अंतिम-प्रत.pdf',
  'no-extension-at-all-but-still-far-too-long-for-one-line',
  'CM_Review_Meeting_PMAY_U__2.0_Consolidated_Minutes_Final_v7.docx',
  'archive.tar.gz',
  '.gitignore',
  'x.averylongextensionthatisnotone',
];

for (const name of SAMPLES) {
  for (const max of [12, 20, FILE_NAME_MAX_CHARS, FILE_TITLE_MAX_CHARS]) {
    const out = shortFileName(name, max);
    check(
      `fits max=${max}: ${name.slice(0, 24)}`,
      len(out) <= max,
      `${len(out)} > ${max}: ${out}`,
    );
    check(`never grows: ${name.slice(0, 24)}`, len(out) <= len(name), out);
  }
}

// --------------------------------------------------------------------------
// 4. Prose (a YouTube video title, a note excerpt) is cut at the END. A hole in
//    the middle of a sentence reads as damage; a trailing … reads as "more".
// --------------------------------------------------------------------------

const TITLE =
  'मुख्यमंत्री देवेंद्र फडणवीस यांच्या हस्ते नागपूर येथे नवीन प्रकल्पाचे उद्घाटन संपन्न';
const cutTitle = shortFileName(TITLE, 40);
check('prose is cut at the end', cutTitle.endsWith('…'), cutTitle);
check(
  'prose keeps its opening',
  TITLE.startsWith(cutTitle.replace('…', '')),
  cutTitle,
);

// --------------------------------------------------------------------------
// 5. Devanagari is never cut mid-syllable. A matra split from its consonant is
//    exactly the damage the poster/PDF paths exist to prevent.
// --------------------------------------------------------------------------

const COMBINING =
  /[\u0900-\u0903\u093A-\u094D\u0951-\u0957\u0962\u0963\u200C\u200D]/;

const DEVANAGARI = 'शासननिर्णयउच्चवतंत्रशिक्षणविभागअंतिमप्रतमहाराष्ट्रशासन.pdf';
for (let max = 8; max <= 44; max += 1) {
  const out = shortFileName(DEVANAGARI, max);
  const head = out.split('…')[0] ?? '';
  const last = Array.from(head).at(-1) ?? '';
  check(
    `no trailing matra at max=${max}`,
    last === '' || !COMBINING.test(last),
    out,
  );
}

// --------------------------------------------------------------------------
// 6. A name whose "extension" is longer than the budget can absorb falls back to
//    an end cut rather than returning an ellipsis with nothing before it.
// --------------------------------------------------------------------------

const tiny = shortFileName('report.docx', 8);
check(
  'tiny budget still returns something readable',
  len(tiny) <= 8 && len(tiny) > 1,
  tiny,
);
check('tiny budget is marked as cut', tiny.includes('…'), tiny);

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
