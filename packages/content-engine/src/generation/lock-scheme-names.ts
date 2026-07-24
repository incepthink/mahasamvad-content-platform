// Keep a scheme/organisation name whole and verbatim in poster copy.
//
// Why this exists: an official scheme is written in full in the officer's note —
// "मुख्यमंत्री माझी लाडकी बहीण योजना" — but the copy prompt tells the model to write a
// "3-8 word headline", so the model shortens it to "लाडकी बहीण योजना". On an official
// government poster a truncated scheme name is a factual error, not an editorial choice.
//
// Prompting alone does not hold (the word-count rule directly fights the full name), so
// this follows the codebase's "structural, not instructed" pattern — proof-read.ts's
// verbatim-excerpt filter and translate-article.ts's locked-name repair. The guarantee is
// deterministic and one-directional: we only ever REPLACE a contiguous sub-phrase of a
// known full name with that full name, and the full name is copied verbatim from the note.
// So a repair can only LENGTHEN a name toward its source spelling; it can never invent a
// name, change a digit, or shorten anything.
//
// The source of "full names" is the caller-supplied list — verified glossary scheme/org
// rows whose Marathi form appears in the note (findGlossaryTermsInText). A name NOT in the
// note is ignored (nothing to lock); a poster that simply did not feature a scheme is not a
// failure, so a full name absent from the copy is fine — only a *truncated* form is fixed.

import { editDistance } from './edit-distance.js';

// Split on Unicode whitespace, dropping empties. Marathi words are space-separated, so a
// scheme name is a run of these tokens.
function words(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0);
}

// Every contiguous sub-phrase of `full` that is at least 2 words long and strictly shorter
// than the whole name, longest first. These are the shapes a truncation can take. A 2-word
// name yields none (a shorter ≥2-word run cannot exist), so such names are locked only as a
// whole — a single-word fragment is never expanded, that being too risky to do blindly.
function truncations(full: string): string[] {
  const parts = words(full);
  const out: string[] = [];
  for (let len = parts.length - 1; len >= 2; len -= 1) {
    for (let start = 0; start + len <= parts.length; start += 1) {
      out.push(parts.slice(start, start + len).join(' '));
    }
  }
  return out;
}

// A sub-phrase is SAFE to expand to `full` only if it does not also sit inside a different
// locked full name — otherwise "बहीण योजना" appearing under both "लाडकी बहीण योजना" and
// "कन्या बहीण योजना" would be expanded to whichever we happened to try first. An ambiguous
// fragment is left alone (and, if it was the only trace of the name, reported).
function isAmbiguous(
  fragment: string,
  full: string,
  others: readonly string[],
): boolean {
  return others.some(
    (other) => other !== full && (' ' + other + ' ').includes(' ' + fragment + ' '),
  );
}

// Replace the first occurrence of `needle` in `haystack` with `replacement`. Only the first
// — a repair should be minimal, and a name rarely repeats within one short copy string.
function replaceFirst(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const at = haystack.indexOf(needle);
  if (at === -1) return haystack;
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

// Repair one string against one full name. Returns the (possibly) fixed string and whether
// it now carries the full name. A string that already contains the full name, or no trace of
// it, is returned unchanged.
function lockOne(
  text: string,
  full: string,
  allNames: readonly string[],
): { text: string; changed: boolean } {
  if (text.includes(full)) return { text, changed: false };

  for (const fragment of truncations(full)) {
    if (!text.includes(fragment)) continue;
    if (isAmbiguous(fragment, full, allNames)) continue;
    return { text: replaceFirst(text, fragment, full), changed: true };
  }
  return { text, changed: false };
}

// Deep-walk a copy object's string leaves, applying `fn` to each and rebuilding the same
// shape. The six poster copy_styles have different schemas (bullets, stats, milestones,
// attribution, …), so the lock is shape-agnostic: it fixes text wherever text lives.
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = mapStrings(v, fn);
    }
    return out;
  }
  return value;
}

// Collect every string leaf (read-only), for the post-repair "did the truncation survive"
// check and for validating the model's declared names.
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>))
      collectStrings(v, into);
}

export type SchemeLockResult<T> = Readonly<{
  // The copy with truncated scheme names expanded to their full note spelling.
  copy: T;
  // Scheme names the copy still carries only in a truncated/near-miss form that could not be
  // safely expanded (ambiguous fragment). Reported, never fatal — the officer reviews.
  unpreserved: readonly string[];
}>;

// Lock the full scheme/org names into the copy. `lockedNames` are full names known to occur
// verbatim in the note (glossary scheme/org rows in the note). The copy object is returned
// with the same shape, truncations expanded. Names the poster did not use at all are not
// reported — only ones it truncated and we could not fix.
export function lockSchemeNames<T>(
  copy: T,
  lockedNames: readonly string[],
): SchemeLockResult<T> {
  // Longest names first: expanding the longest full form before a shorter one avoids a
  // partial expansion blocking a fuller one.
  const names = [...new Set(lockedNames)].sort((a, b) => b.length - a.length);
  if (names.length === 0) return { copy, unpreserved: [] };

  let current: unknown = copy;
  for (const full of names) {
    current = mapStrings(current, (s) => lockOne(s, full, names).text);
  }

  // A truncation we could not repair still shows as a fragment present without the full
  // name. Report those so the officer can check them.
  const strings: string[] = [];
  collectStrings(current, strings);
  const unpreserved: string[] = [];
  for (const full of names) {
    const hasFull = strings.some((s) => s.includes(full));
    if (hasFull) continue;
    const hasFragment = truncations(full).some((frag) =>
      strings.some((s) => s.includes(frag)),
    );
    if (hasFragment) unpreserved.push(full);
  }

  return { copy: current as T, unpreserved };
}

// Validate the scheme names the copy model DECLARED it used (the copy json_schema's
// `scheme_names_used`). A declared name that has no basis in the note was invented and is
// reported (never fatal — this is a guard, not a gate, so a bad self-report never discards a
// paid render). Two things make a name legitimate:
//   - it occurs verbatim in the note, OR
//   - Marathi inflects the head noun as a SUFFIX (योजना → योजनेच्या, अभियान → अभियानाला), so a
//     multi-word name whose (n-1)-word prefix appears in the note is the same name inflected,
//     not an invention. A near-miss on that prefix (≤2 edits) is accepted too, for OCR/spelling
//     drift in the note itself.
export function validateDeclaredSchemeNames(
  note: string,
  declared: readonly string[],
): { valid: string[]; invented: string[] } {
  const valid: string[] = [];
  const invented: string[] = [];
  const noteWords = words(note);

  const prefixPresent = (prefix: string): boolean => {
    if (note.includes(prefix)) return true;
    const pw = words(prefix);
    for (let i = 0; i + pw.length <= noteWords.length; i += 1) {
      if (editDistance(prefix, noteWords.slice(i, i + pw.length).join(' ')) <= 2) {
        return true;
      }
    }
    return false;
  };

  for (const raw of declared) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const nameWords = words(name);
    if (note.includes(name)) {
      valid.push(name);
    } else if (nameWords.length >= 2 && prefixPresent(nameWords.slice(0, -1).join(' '))) {
      // Head noun inflected in the note; the name is present, just declined.
      valid.push(name);
    } else {
      invented.push(name);
    }
  }

  return { valid, invented };
}

// --- CLI harness -----------------------------------------------------------
// Exercise the lock offline (no API, no DB):
//
//   tsx src/generation/lock-scheme-names.ts
//
import { pathToFileURL } from 'node:url';

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown): void => {
    if (ok) {
      console.log(`  ok   ${label}`);
    } else {
      failures += 1;
      console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
    }
  };

  const FULL = 'मुख्यमंत्री माझी लाडकी बहीण योजना';

  // 1. Truncated headline is expanded to the full note spelling.
  {
    const copy = {
      headline: 'लाडकी बहीण योजना सुरू',
      bullets: [{ text: '५०० कुटुंबांना लाभ', emphasis: ['५००'] }],
    };
    const { copy: fixed, unpreserved } = lockSchemeNames(copy, [FULL]);
    check(
      'expands truncated scheme name in headline',
      (fixed as typeof copy).headline === 'मुख्यमंत्री माझी लाडकी बहीण योजना सुरू',
      (fixed as typeof copy).headline,
    );
    check('nothing reported once expanded', unpreserved.length === 0, unpreserved);
    check(
      'other fields untouched (digits intact)',
      (fixed as typeof copy).bullets[0]?.text === '५०० कुटुंबांना लाभ',
    );
  }

  // 2. Full name already present → unchanged.
  {
    const copy = { headline: `${FULL} चा दुसरा टप्पा` };
    const { copy: fixed, unpreserved } = lockSchemeNames(copy, [FULL]);
    check('full name left as-is', (fixed as typeof copy).headline === copy.headline);
    check('no report', unpreserved.length === 0);
  }

  // 3. Poster did not feature the scheme at all → not a failure, not reported.
  {
    const copy = { headline: 'शेतकऱ्यांसाठी नवा निर्णय' };
    const { unpreserved } = lockSchemeNames(copy, [FULL]);
    check('absent scheme not reported', unpreserved.length === 0, unpreserved);
  }

  // 4. Ambiguous fragment shared by two schemes → NOT auto-expanded, reported instead.
  {
    const A = 'लाडकी बहीण योजना';
    const B = 'कन्या बहीण योजना';
    const copy = { headline: 'बहीण योजना अंतर्गत लाभ' };
    const { copy: fixed, unpreserved } = lockSchemeNames(copy, [A, B]);
    check(
      'ambiguous fragment not expanded',
      (fixed as typeof copy).headline === 'बहीण योजना अंतर्गत लाभ',
      (fixed as typeof copy).headline,
    );
    check('ambiguous fragment reported', unpreserved.length >= 1, unpreserved);
  }

  // 5. Two-word scheme name: whole or nothing, never a 1-word expansion.
  {
    const FULL2 = 'जलयुक्त शिवार';
    const copy = { headline: 'शिवार अभियान यशस्वी' };
    const { copy: fixed } = lockSchemeNames(copy, [FULL2]);
    check(
      'no single-word expansion',
      (fixed as typeof copy).headline === 'शिवार अभियान यशस्वी',
    );
  }

  // 6. Declared-name validation: in-note passes, invented fails.
  {
    const note = `आज ${FULL} चे उद्घाटन झाले.`;
    const { valid, invented } = validateDeclaredSchemeNames(note, [
      FULL,
      'प्रधानमंत्री आवास योजना',
    ]);
    check('valid declared name accepted', valid.includes(FULL), valid);
    check(
      'invented declared name flagged',
      invented.includes('प्रधानमंत्री आवास योजना'),
      invented,
    );
  }

  // 7. Inflection tolerance: the note carries the name with the head noun DECLINED
  //    (योजना → योजनेच्या); the model's nominative declaration must NOT be flagged invented.
  {
    const note =
      'मुख्यमंत्री यांच्या हस्ते पुणे येथे मुख्यमंत्री माझी लाडकी बहीण योजनेच्या दुसऱ्या टप्प्याचे उद्घाटन झाले.';
    const { valid, invented } = validateDeclaredSchemeNames(note, [
      FULL,
      'प्रधानमंत्री आवास योजना',
    ]);
    check('inflected in-note name accepted', valid.includes(FULL), { valid, invented });
    check(
      'still flags a genuinely invented name',
      invented.includes('प्रधानमंत्री आवास योजना'),
      invented,
    );
  }

  console.log(failures === 0 ? '\nAll scheme-lock checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exitCode = failures === 0 ? 0 : 1;
}
