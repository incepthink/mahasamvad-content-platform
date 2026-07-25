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
//   - Only the FIRST mention is prefixed. Marathi news style names someone in full once and
//     then refers to them bare ("फडणवीस यांनी"), and the drafting prompt says so too.
//   - Insertion goes BEFORE an honorific, not between it and the name: "श्री. देवेंद्र फडणवीस"
//     must become "मुख्यमंत्री श्री. देवेंद्र फडणवीस", never "श्री. मुख्यमंत्री देवेंद्र फडणवीस".
//   - The surname alone is deliberately NOT matched. If the article only ever says "फडणवीस",
//     the pair is reported as not-found rather than guessed at — two people can share a surname,
//     and this module's whole value is that it cannot be wrong.
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

  let text = article;
  const applied: string[] = [];
  const alreadyPresent: string[] = [];
  const issues: DesignationIssue[] = [];

  for (const { name, designation } of ordered) {
    const index = text.indexOf(name);
    if (index === -1) {
      // Includes the surname-only case: reported, never guessed.
      issues.push({ name, designation, reason: 'not-found' });
      continue;
    }

    const { insertAt, before } = scanBack(text, index);

    if (endsWithWord(before, designation)) {
      alreadyPresent.push(name);
      continue;
    }

    const wrong = trailingDesignation(before, designation, known);
    if (wrong) {
      // Replace exactly the wrong title, keeping the whitespace around it intact.
      const start = insertAt - before.length + before.lastIndexOf(wrong);
      text = text.slice(0, start) + designation + text.slice(start + wrong.length);
      issues.push({ name, designation, reason: 'corrected', replaced: wrong });
      continue;
    }

    text = `${text.slice(0, insertAt)}${designation} ${text.slice(insertAt)}`;
    applied.push(name);
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

  console.log('\nउ. फक्त आडनाव असल्यास अंदाज नको (surname only ⇒ not-found)');
  {
    const out = applyDesignations('फडणवीस यांनी आज बैठक घेतली.', [CM]);
    check('unchanged', out.text, 'फडणवीस यांनी आज बैठक घेतली.');
    check('reported not-found', out.issues, [{ ...CM, reason: 'not-found' }]);
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
