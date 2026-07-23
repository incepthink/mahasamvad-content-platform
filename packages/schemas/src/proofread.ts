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
