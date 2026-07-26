// Ad-hoc proofreading of pasted Marathi/English text (not tied to a generation).
// One synchronous request: the engine flags genuine grammar/spelling/punctuation
// mistakes, glossary-verified name errors, and clear Mahasamvad-style deviations,
// then returns a deterministically patched corrected text. Nothing is stored.

import { z } from 'zod';

// Same bound as translation: keeps one synchronous request bounded and keeps the
// engine's two-call token budget comfortably under the org's rate limit.
export const PROOFREAD_TEXT_MAX_CHARS = 10_000;

export const ProofreadLanguageSchema = z.enum(['mr', 'en']);
export type ProofreadLanguage = z.infer<typeof ProofreadLanguageSchema>;

export const ProofreadIssueTypeSchema = z.enum([
  'grammar',
  'spelling',
  'punctuation',
  'name',
  'style',
]);
export type ProofreadIssueType = z.infer<typeof ProofreadIssueTypeSchema>;

// Derived server-side ('style' ⇒ 'suggestion', everything else ⇒ 'error'), never
// model-emitted. Error-severity fixes are applied to the corrected text; style
// suggestions are advisory only.
export const ProofreadSeveritySchema = z.enum(['error', 'suggestion']);
export type ProofreadSeverity = z.infer<typeof ProofreadSeveritySchema>;

export const ProofreadIssueSchema = z.object({
  type: ProofreadIssueTypeSchema,
  severity: ProofreadSeveritySchema,
  // Exact substring of the submitted text (enforced server-side; issues whose
  // excerpt does not occur verbatim are dropped). Doubles as the location anchor.
  excerpt: z.string().min(1),
  // Drop-in replacement for the excerpt. Advisory phrasing for 'style' issues.
  suggestion: z.string().min(1),
  // Short Marathi explanation (always Marathi — the UI is Marathi-first).
  explanation: z.string(),
});
export type ProofreadIssue = z.infer<typeof ProofreadIssueSchema>;

export const ProofreadRequestSchema = z.object({
  text: z.string().trim().min(1).max(PROOFREAD_TEXT_MAX_CHARS),
});
export type ProofreadRequest = z.infer<typeof ProofreadRequestSchema>;

// ---------- Corrected-text patching (shared by the engine and the web) ----------
//
// The engine patches the submitted text and keeps only the result — no offsets survive.
// But /proofread's web UI has to HIGHLIGHT the patched spans inside that same string,
// which means knowing which run of the output came from which fix. Rather than have the
// browser guess (and get it wrong — see the three traps below), the patcher itself lives
// here, in the one package both `apps/web` and the engine may import: `apps/web` cannot
// import `@dgipr/content-engine` (pdfjs/sarvam/openai), the same reason `combineIntakeSources`
// and `tweetWeightedLength` moved here. `proof-read.ts`'s applyFixes now delegates to this,
// so there is exactly one patching algorithm in the repo and it cannot drift.

export interface ProofreadFixInput {
  excerpt: string;
  suggestion: string;
}

// One run of the patched text. `fixIndex` indexes into the `fixes` array passed in;
// null means the run is untouched input.
export interface ProofreadPatchSegment {
  text: string;
  fixIndex: number | null;
}

// Deterministic patch: longer excerpts first so a word-level fix never clobbers a
// sentence-level one; a fix whose excerpt no longer occurs (already covered by an
// earlier, longer replacement) is skipped — the issue stays listed either way.
//
// Three properties of this make "find the suggestion string in the output" wrong, and are
// why the segments are produced HERE rather than reconstructed by the caller:
//   1. replacement is GLOBAL, so one fix can own several runs of the output;
//   2. fixes apply cumulatively against the working string, so a later short fix can hit
//      text an earlier fix INSERTED, and can match ACROSS an insertion boundary;
//   3. a swallowed fix produces no run at all while still appearing in `issues`.
// The sort is stable (spec-guaranteed), so a caller replaying the same `fixes` array in
// the same order gets byte-identical output.
export function applyProofreadFixes(
  text: string,
  fixes: readonly ProofreadFixInput[],
): { text: string; segments: ProofreadPatchSegment[] } {
  let patched = text;
  // Owner of each code unit of `patched`: the index of the fix that inserted it, or null
  // for surviving input. Kept in lockstep with the string through every replacement.
  let owners: (number | null)[] = new Array<number | null>(text.length).fill(
    null,
  );

  const ordered = fixes
    .map((fix, index) => ({ fix, index }))
    .sort((a, b) => b.fix.excerpt.length - a.fix.excerpt.length);

  for (const { fix, index } of ordered) {
    // Non-overlapping, left to right — exactly what split(excerpt).join(suggestion) does.
    const hits: number[] = [];
    for (let from = 0; ; ) {
      const at = patched.indexOf(fix.excerpt, from);
      if (at === -1) break;
      hits.push(at);
      from = at + fix.excerpt.length;
    }
    if (hits.length === 0) continue;

    let nextText = '';
    const nextOwners: (number | null)[] = [];
    let cursor = 0;
    for (const at of hits) {
      nextText += patched.slice(cursor, at);
      for (let i = cursor; i < at; i += 1) nextOwners.push(owners[i] ?? null);
      nextText += fix.suggestion;
      for (let i = 0; i < fix.suggestion.length; i += 1) nextOwners.push(index);
      cursor = at + fix.excerpt.length;
    }
    nextText += patched.slice(cursor);
    for (let i = cursor; i < patched.length; i += 1) {
      nextOwners.push(owners[i] ?? null);
    }
    patched = nextText;
    owners = nextOwners;
  }

  // Coalesce equal-owner code units into runs.
  const segments: ProofreadPatchSegment[] = [];
  let runStart = 0;
  for (let i = 1; i <= patched.length; i += 1) {
    const runOwner = owners[runStart] ?? null;
    const atEnd = i === patched.length;
    if (atEnd || (owners[i] ?? null) !== runOwner) {
      segments.push({ text: patched.slice(runStart, i), fixIndex: runOwner });
      runStart = i;
    }
  }

  return { text: patched, segments };
}

// ---------- Highlighting the corrected text ----------

// 'fix' — this run replaced something (an error-severity issue was applied here).
// 'style' — the text is UNCHANGED here; a style advisory proposes a rewrite of it.
export type ProofreadHighlightKind = 'fix' | 'style';

export interface ProofreadHighlight {
  text: string;
  kind: ProofreadHighlightKind | null; // null = unchanged, unremarked text
  issue: ProofreadIssue | null;
}

// Splits `correctedText` into renderable runs for /proofread's corrected-article view.
//
// Returns NULL when the replay does not reproduce `correctedText` byte for byte. The
// corrected text is authoritative and the highlighting is best-effort: if the engine's
// patching ever diverges from this function, the marks disappear rather than pointing at
// the wrong words.
export function buildProofreadHighlights(
  originalText: string,
  correctedText: string,
  issues: readonly ProofreadIssue[],
): ProofreadHighlight[] | null {
  // Exactly the set the engine patches with: it filters `type !== 'style'`, and severity
  // is derived from that same test.
  const fixes = issues.filter((issue) => issue.severity === 'error');
  const patched = applyProofreadFixes(originalText.trim(), fixes);
  if (patched.text !== correctedText) return null;

  let marks: ProofreadHighlight[] = patched.segments.map((segment) => {
    const issue = segment.fixIndex === null ? null : fixes[segment.fixIndex];
    return issue
      ? { text: segment.text, kind: 'fix' as const, issue }
      : { text: segment.text, kind: null, issue: null };
  });

  // Style advisories are NOT applied, so they are located by looking their excerpt up in
  // the corrected text — but only inside runs nothing changed. An excerpt a correction
  // consumed is no longer verbatim present, and marking near-misses would be a lie about
  // where the text stands. Longest first, and already-marked runs are skipped, so two
  // advisories can never claim the same characters.
  const advisories = issues
    .filter((issue) => issue.severity === 'suggestion')
    .sort((a, b) => b.excerpt.length - a.excerpt.length);

  for (const issue of advisories) {
    const next: ProofreadHighlight[] = [];
    for (const mark of marks) {
      if (mark.kind !== null || !mark.text.includes(issue.excerpt)) {
        next.push(mark);
        continue;
      }
      let cursor = 0;
      for (;;) {
        const at = mark.text.indexOf(issue.excerpt, cursor);
        if (at === -1) break;
        if (at > cursor) {
          next.push({
            text: mark.text.slice(cursor, at),
            kind: null,
            issue: null,
          });
        }
        next.push({ text: issue.excerpt, kind: 'style', issue });
        cursor = at + issue.excerpt.length;
      }
      if (cursor < mark.text.length) {
        next.push({ text: mark.text.slice(cursor), kind: null, issue: null });
      }
    }
    marks = next;
  }

  return marks;
}

export const ProofreadResponseSchema = z.object({
  language: ProofreadLanguageSchema,
  issues: z.array(ProofreadIssueSchema),
  // Proper nouns in the text that match no verified glossary term: surfaced as
  // "unverified — please confirm", never blocking, never auto-corrected.
  unverifiedNames: z.array(z.string()),
  // The input with the confirmed error-severity fixes patched in. Equals the input
  // verbatim when nothing was fixable. Null only when the digit-preservation guard
  // tripped (a fix would have changed a number) — the UI then shows issues only.
  correctedText: z.string().nullable(),
  // False for English input (the Mahasamvad style corpus is Marathi) and when
  // style-reference retrieval failed; the UI renders an honest notice.
  styleChecked: z.boolean(),
  // The Mahasamvad exemplar used as the style reference, for transparency.
  styleReference: z.object({ title: z.string(), url: z.string() }).nullable(),
});
export type ProofreadResponse = z.infer<typeof ProofreadResponseSchema>;
