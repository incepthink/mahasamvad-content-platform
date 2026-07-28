// Print the officer-approved designation (पदनाम) before a person's name on its FIRST mention.
//
// "देवेंद्र फडणवीस" in a meeting recording must publish as "मुख्यमंत्री देवेंद्र फडणवीस", because in
// government communication the designation is part of how the person is officially named. The
// drafting prompt asks for this, but prompting alone does not hold — so this module is the
// guarantee, following the codebase's "structural, not instructed" pattern: proof-read.ts's
// verbatim-excerpt filter, lock-scheme-names.ts's truncation expansion, translate-article.ts's
// locked-name repair.
//
// The guarantee is deterministic and narrow. We only ever:
//   - INSERT a designation string the officer approved, or
//   - REPLACE a *different* designation already sitting in front of the name with the approved
//     one (the dangerous case — a model that helpfully writes "उपमुख्यमंत्री देवेंद्र फडणवीस" from
//     its own stale knowledge must not ship).
// We never touch digits, never reorder or rewrite prose, never delete a sentence, and never
// invent a designation. A pair that cannot be applied is REPORTED, never fatal — the article
// ships and the officer sees the notice, because a silently unapplied designation is exactly
// the failure this feature exists to prevent.
//
// Marathi specifics that are load-bearing:
//   - The FULL name is prefixed ONCE, on its first mention. Marathi news style names someone in
//     full once and then refers to them by surname.
//   - EVERY standalone SURNAME mention is prefixed too: "असल्याचे सांगत फडणवीस यांनी" becomes
//     "असल्याचे सांगत मुख्यमंत्री फडणवीस यांनी". This is the officer's rule (2026-07-28) — a
//     government article names an official with their office every time it names them, and a
//     bare surname mid-article read as a stranger. It also rescues the common transcript case
//     where the article only ever has the surname, which used to be reported as not-found and
//     silently lost the designation altogether.
//   - The surname is the LAST word of the approved name (a one-word approved name IS the
//     surname). It is matched only as a whole word, so an inflected form ("फडणवीसांनी") is left
//     alone rather than guessed at, and never inside the full name it came from.
//   - A surname TWO approved people share is skipped for both. Two people can share a surname
//     and this module's whole value is that it cannot be wrong; such a pair falls back to
//     full-name-only. Which चंद्रशेखर a bare "बावनकुळे" means is a question for the review card
//     (prepareDesignations), where an officer can still answer it — not for this pass.
//   - Insertion goes BEFORE an honorific, not between it and the name: "श्री. देवेंद्र फडणवीस"
//     must become "मुख्यमंत्री श्री. देवेंद्र फडणवीस", never "श्री. मुख्यमंत्री देवेंद्र फडणवीस".
//
// Free to run and free to test: no model call, no I/O. Harness at the bottom.

import { pathToFileURL } from 'node:url';

// Kept structurally identical to NameDesignation in @dgipr/schemas. Declared locally for the
// same reason translate-article.ts declares GlossaryEntry: this package is not a consumer of
// the API request shapes, it just needs the two strings.
export type NameDesignation = Readonly<{
  name: string;
  designation: string;
}>;

// Why an approved designation did not reach the article as-is. Mirrors DesignationWarning in
// @dgipr/schemas (the API maps one to the other).
export type DesignationIssue = Readonly<{
  name: string;
  designation: string;
  reason: 'not-found' | 'corrected';
  // The title that was replaced; only set for 'corrected'.
  replaced?: string;
}>;

export type DesignationResult = Readonly<{
  text: string;
  // Names the designation was newly inserted before.
  applied: readonly string[];
  // Names that already carried the correct designation — the model got it right.
  alreadyPresent: readonly string[];
  // Everything the officer should look at.
  issues: readonly DesignationIssue[];
}>;

// Marathi honorifics that may sit between the designation and the name. A designation is
// inserted BEFORE these, never after. Longest first so "श्रीमती" is tested before "श्री".
const HONORIFICS = [
  'श्रीमती',
  'अ‍ॅड.',
  'अॅड.',
  'श्री.',
  'श्री',
  'डॉ.',
  'डॉ',
  'मा.',
  'ना.',
] as const;

// How far back of the name we look for an existing designation. A designation is at most a few
// words; scanning further would start matching unrelated prose.
const LOOKBEHIND_CHARS = 60;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The text immediately before `index`, with any honorific(s) peeled off, plus the offset the
// designation should be inserted at. Returns the insertion point (before the honorific) and the
// remaining lookbehind for designation detection.
function scanBack(
  text: string,
  index: number,
): Readonly<{ insertAt: number; before: string }> {
  let insertAt = index;
  // Peel honorifics one at a time — "मा. श्री. देवेंद्र फडणवीस" carries two.
  for (;;) {
    const head = text.slice(Math.max(0, insertAt - 20), insertAt);
    const trimmed = head.replace(/\s+$/, '');
    const honorific = HONORIFICS.find((h) => trimmed.endsWith(h));
    if (!honorific) break;
    insertAt = insertAt - (head.length - trimmed.length) - honorific.length;
  }
  const before = text.slice(Math.max(0, insertAt - LOOKBEHIND_CHARS), insertAt);
  return { insertAt, before };
}

// Is `designation` the last thing said before the insertion point? Whitespace-tolerant, so a
// line break between the title and the name still counts as "already present".
function endsWithWord(before: string, designation: string): boolean {
  return new RegExp(`(^|[\\s(“"'‘])${escapeRegExp(designation)}\\s*$`).test(
    before,
  );
}

// A word character in ANY script, matras and digits included. The surname boundary test: the
// "फडणवीस" inside "फडणवीसांनी" is not a standalone mention, and prefixing an inflected form is
// left to the drafting prompt rather than assembled here out of guessed morphology.
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;

function isStandalone(text: string, at: number, length: number): boolean {
  const before = text[at - 1];
  const after = text[at + length];
  return (
    (before === undefined || !WORD_CHAR.test(before)) &&
    (after === undefined || !WORD_CHAR.test(after))
  );
}

// The last word of an approved name — a one-word approved name IS the surname, which is exactly
// what the dictionary's surname lookup produces ("बावनकुळे" resolved against चंद्रशेखर बावनकुळे).
function surnameOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? name;
}

// A DIFFERENT known designation sitting immediately before the name. Longest match wins, so
// "अपर जिल्हाधिकारी" is not mistaken for "जिल्हाधिकारी".
function trailingDesignation(
  before: string,
  approved: string,
  known: readonly string[],
): string | null {
  const candidates = [...known]
    .filter((d) => d !== approved)
    .sort((a, b) => b.length - a.length);
  return candidates.find((d) => endsWithWord(before, d)) ?? null;
}

// Drop pairs whose name is a proper substring of another pair's name, and process the rest
// longest-first — the lock-scheme-names.ts ordering rule. Without this a stray pair for
// "देवेंद्र" could claim the first half of "देवेंद्र फडणवीस" and leave the real pair unapplied.
function orderPairs(pairs: readonly NameDesignation[]): NameDesignation[] {
  const cleaned = pairs
    .map((p) => ({ name: p.name.trim(), designation: p.designation.trim() }))
    .filter((p) => p.name.length > 0 && p.designation.length > 0);

  const byName = new Map<string, NameDesignation>();
  for (const pair of cleaned) {
    if (!byName.has(pair.name)) byName.set(pair.name, pair);
  }
  const unique = [...byName.values()].sort(
    (a, b) => b.name.length - a.name.length,
  );
  return unique.filter(
    (pair) =>
      !unique.some(
        (other) => other.name !== pair.name && other.name.includes(pair.name),
      ),
  );
}

export function applyDesignations(
  article: string,
  pairs: readonly NameDesignation[],
  opts: Readonly<{ knownDesignations?: readonly string[] }> = {},
): DesignationResult {
  const ordered = orderPairs(pairs);
  if (ordered.length === 0) {
    return { text: article, applied: [], alreadyPresent: [], issues: [] };
  }

  // The approved designations are themselves "known", so a poster that says "मुख्यमंत्री" where
  // "उपमुख्यमंत्री" was approved is still detected as a conflict.
  const known = [
    ...new Set([
      ...(opts.knownDesignations ?? []),
      ...ordered.map((p) => p.designation),
    ]),
  ].filter((d) => d.trim().length > 0);

  // A surname two approved people share is unattributable, so it is disabled for BOTH of them.
  const surnameUses = new Map<string, number>();
  for (const pair of ordered) {
    const surname = surnameOf(pair.name);
    surnameUses.set(surname, (surnameUses.get(surname) ?? 0) + 1);
  }

  let text = article;
  const applied: string[] = [];
  const alreadyPresent: string[] = [];
  const issues: DesignationIssue[] = [];

  // Put `designation` in front of the mention starting at `at`, honorifics and an existing wrong
  // title accounted for. `delta` is how much longer the text became BEFORE `at`, which is what a
  // caller walking further occurrences has to add to its cursor.
  type Outcome =
    | Readonly<{ kind: 'already' | 'applied'; delta: number }>
    | Readonly<{ kind: 'corrected'; delta: number; replaced: string }>;

  const prefixAt = (designation: string, at: number): Outcome => {
    const { insertAt, before } = scanBack(text, at);

    if (endsWithWord(before, designation)) return { kind: 'already', delta: 0 };

    const wrong = trailingDesignation(before, designation, known);
    if (wrong) {
      // Replace exactly the wrong title, keeping the whitespace around it intact.
      const start = insertAt - before.length + before.lastIndexOf(wrong);
      text =
        text.slice(0, start) + designation + text.slice(start + wrong.length);
      return {
        kind: 'corrected',
        delta: designation.length - wrong.length,
        replaced: wrong,
      };
    }

    text = `${text.slice(0, insertAt)}${designation} ${text.slice(insertAt)}`;
    return { kind: 'applied', delta: designation.length + 1 };
  };

  for (const { name, designation } of ordered) {
    const surname = surnameOf(name);
    // A one-word approved name has no separate full-name pass — every mention of it IS a
    // surname mention.
    const hasFullName = surname !== name;
    let didApply = false;
    let didAlready = false;
    let didCorrect = false;

    const record = (outcome: Outcome): void => {
      if (outcome.kind === 'applied') {
        didApply = true;
      } else if (outcome.kind === 'corrected') {
        // One notice per person, not per occurrence — the officer needs to know a stale title
        // was overwritten, not how many times.
        if (!didCorrect) {
          issues.push({
            name,
            designation,
            reason: 'corrected',
            replaced: outcome.replaced,
          });
        }
        didCorrect = true;
      } else {
        didAlready = true;
      }
    };

    // 1. The full name, first mention only.
    if (hasFullName) {
      const index = text.indexOf(name);
      if (index !== -1) record(prefixAt(designation, index));
    }

    // 2. Every standalone surname mention.
    if ((surnameUses.get(surname) ?? 0) === 1) {
      const prefixLength = name.length - surname.length;
      let cursor = 0;
      for (;;) {
        const at = text.indexOf(surname, cursor);
        if (at < 0) break;
        cursor = at + surname.length;

        if (!isStandalone(text, at, surname.length)) continue;
        // The surname sitting inside its own full name was handled by pass 1 (or deliberately
        // left alone as a later full-name mention).
        if (
          prefixLength > 0 &&
          at >= prefixLength &&
          text.startsWith(name, at - prefixLength)
        ) {
          continue;
        }

        const outcome = prefixAt(designation, at);
        cursor += outcome.delta;
        record(outcome);
      }
    }

    if (didApply) {
      applied.push(name);
    } else if (didAlready) {
      alreadyPresent.push(name);
    } else if (!didCorrect) {
      // Neither the full name nor a usable surname mention is in the article.
      issues.push({ name, designation, reason: 'not-found' });
    }
  }

  return { text, applied, alreadyPresent, issues };
}

// Run directly to check the rules in isolation — no model call, no key needed:
//   tsx src/generation/apply-designations.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, actual: unknown, expected: unknown): void => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`  ✓ ${label}`);
    } else {
      failures += 1;
      console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
    }
  };

  const CM = { name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' };
  const KNOWN = ['मुख्यमंत्री', 'उपमुख्यमंत्री', 'जिल्हाधिकारी', 'अपर जिल्हाधिकारी', 'मंत्री'];

  console.log('\nअ. पहिल्या उल्लेखापुरतेच (first mention only)');
  {
    const src =
      'देवेंद्र फडणवीस यांनी आज बैठक घेतली. देवेंद्र फडणवीस यांनी ५०० कोटींची घोषणा केली.';
    const out = applyDesignations(src, [CM]);
    check(
      'inserted once',
      out.text,
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी आज बैठक घेतली. देवेंद्र फडणवीस यांनी ५०० कोटींची घोषणा केली.',
    );
    check('reported as applied', out.applied, ['देवेंद्र फडणवीस']);
    check('no issues', out.issues, []);
  }

  console.log('\nआ. आधीच असल्यास काहीही करू नये (already present)');
  {
    const src = 'मुख्यमंत्री देवेंद्र फडणवीस यांनी आज बैठक घेतली.';
    const out = applyDesignations(src, [CM]);
    check('unchanged', out.text, src);
    check('alreadyPresent', out.alreadyPresent, ['देवेंद्र फडणवीस']);
    check('not double-prefixed', out.text.split('मुख्यमंत्री').length - 1, 1);
  }

  console.log('\nइ. चुकीचे पदनाम दुरुस्त (wrong designation corrected)');
  {
    const src = 'उपमुख्यमंत्री देवेंद्र फडणवीस यांनी आज बैठक घेतली.';
    const out = applyDesignations(src, [CM], { knownDesignations: KNOWN });
    check('replaced', out.text, 'मुख्यमंत्री देवेंद्र फडणवीस यांनी आज बैठक घेतली.');
    check('reported', out.issues, [
      { ...CM, reason: 'corrected', replaced: 'उपमुख्यमंत्री' },
    ]);
  }

  console.log('\nई. आदरार्थी शब्दाच्या आधी (honorific-aware insertion)');
  {
    const out = applyDesignations('श्री. देवेंद्र फडणवीस यांनी सांगितले.', [CM]);
    check('before the honorific', out.text, 'मुख्यमंत्री श्री. देवेंद्र फडणवीस यांनी सांगितले.');
    const two = applyDesignations('मा. श्री. देवेंद्र फडणवीस यांनी सांगितले.', [CM]);
    check('two honorifics', two.text, 'मुख्यमंत्री मा. श्री. देवेंद्र फडणवीस यांनी सांगितले.');
  }

  console.log('\nउ. फक्त आडनाव असले तरी पदनाम (surname-only article)');
  {
    const out = applyDesignations('फडणवीस यांनी आज बैठक घेतली.', [CM]);
    check('prefixed', out.text, 'मुख्यमंत्री फडणवीस यांनी आज बैठक घेतली.');
    check('reported as applied', out.applied, ['देवेंद्र फडणवीस']);
    check('no issues', out.issues, []);
  }

  console.log('\nउ१. प्रत्येक आडनाव-उल्लेखाला पदनाम (every surname mention)');
  {
    const src =
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी बैठक घेतली. असल्याचे सांगत फडणवीस यांनी उपक्रमाला मान्यता दिली. नंतर फडणवीस यांनी पाहणी केली.';
    const out = applyDesignations(src, [CM]);
    check(
      'both later surname mentions prefixed',
      out.text,
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी बैठक घेतली. असल्याचे सांगत मुख्यमंत्री फडणवीस यांनी उपक्रमाला मान्यता दिली. नंतर मुख्यमंत्री फडणवीस यांनी पाहणी केली.',
    );
    check(
      'the full name is not re-prefixed',
      out.text.split('मुख्यमंत्री देवेंद्र').length - 1,
      1,
    );
  }

  console.log('\nउ२. शब्दकोशातून आलेले एकेरी आडनाव (one-word approved name)');
  {
    const pair = { name: 'बावनकुळे', designation: 'महसूल मंत्री' };
    const out = applyDesignations(
      'बावनकुळे यांनी आढावा घेतला. त्यानंतर बावनकुळे यांनी सूचना दिल्या.',
      [pair],
    );
    check(
      'every mention prefixed',
      out.text,
      'महसूल मंत्री बावनकुळे यांनी आढावा घेतला. त्यानंतर महसूल मंत्री बावनकुळे यांनी सूचना दिल्या.',
    );
  }

  console.log('\nउ३. आडनावाला प्रत्यय असल्यास हात लावू नये (inflected form)');
  {
    const src = 'फडणवीसांनी सांगितले की काम सुरू आहे.';
    const out = applyDesignations(src, [CM]);
    check('unchanged', out.text, src);
    check('reported not-found', out.issues, [{ ...CM, reason: 'not-found' }]);
  }

  console.log('\nउ४. आडनाव दोघांचे असल्यास अंदाज नको (shared surname)');
  {
    const src = 'पवार यांनी बैठक घेतली.';
    const out = applyDesignations(src, [
      { name: 'अजित पवार', designation: 'उपमुख्यमंत्री' },
      { name: 'सुप्रिया पवार', designation: 'जिल्हाधिकारी' },
    ]);
    check('unchanged', out.text, src);
    check('both reported not-found', out.issues.length, 2);
  }

  console.log('\nउ५. आडनावापुढे आदरार्थी व चुकीचे पदनाम');
  {
    const honorific = applyDesignations('श्री. फडणवीस यांनी सांगितले.', [CM]);
    check(
      'before the honorific',
      honorific.text,
      'मुख्यमंत्री श्री. फडणवीस यांनी सांगितले.',
    );
    const wrong = applyDesignations(
      'उपमुख्यमंत्री फडणवीस यांनी सांगितले.',
      [CM],
      { knownDesignations: KNOWN },
    );
    check(
      'a wrong title before a surname is replaced',
      wrong.text,
      'मुख्यमंत्री फडणवीस यांनी सांगितले.',
    );
    check('reported once', wrong.issues.length, 1);
  }

  console.log('\nऊ. उपसंच नावे (substring safety)');
  {
    const src = 'देवेंद्र फडणवीस यांनी सांगितले.';
    const out = applyDesignations(src, [
      CM,
      { name: 'देवेंद्र', designation: 'मंत्री' },
    ]);
    check('only the full name applied', out.text, 'मुख्यमंत्री देवेंद्र फडणवीस यांनी सांगितले.');
    check('substring pair dropped', out.applied, ['देवेंद्र फडणवीस']);
  }

  console.log('\nए. दोन व्यक्ती (two people, digits untouched)');
  {
    const src =
      'देवेंद्र फडणवीस यांनी २ कोटींची घोषणा केली. यावेळी अमित देशमुख उपस्थित होते.';
    const out = applyDesignations(src, [
      CM,
      { name: 'अमित देशमुख', designation: 'जिल्हाधिकारी' },
    ]);
    check(
      'both prefixed',
      out.text,
      'मुख्यमंत्री देवेंद्र फडणवीस यांनी २ कोटींची घोषणा केली. यावेळी जिल्हाधिकारी अमित देशमुख उपस्थित होते.',
    );
    check('digits intact', out.text.includes('२ कोटींची'), true);
  }

  console.log('\nऐ. काहीच न दिल्यास लेख जसाच्या तसा (empty ⇒ byte-identical)');
  {
    const src = 'देवेंद्र फडणवीस यांनी आज बैठक घेतली.';
    check('no pairs', applyDesignations(src, []).text, src);
    check(
      'blank pair ignored',
      applyDesignations(src, [{ name: '  ', designation: 'मुख्यमंत्री' }]).text,
      src,
    );
  }

  console.log(
    failures === 0
      ? '\nसर्व तपासण्या यशस्वी (all checks passed)\n'
      : `\n${failures} तपासणी अयशस्वी (${failures} check(s) failed)\n`,
  );
  if (failures > 0) process.exitCode = 1;
}
