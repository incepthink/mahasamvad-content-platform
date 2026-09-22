// Turn one round of officer feedback into a STANDING editorial rule — or into nothing at all.
//
// This is the write half of the /dlo lane's procedural memory (migration 0057). Phase 1 built
// the read half: rules in `editorial_preferences` reach every /dlo article and every feedback
// revision of it. Until now they had to be typed by hand. This module is what lets the
// department's own feedback write them.
//
// ---------------------------------------------------------------------------------------
// THE ONE THING THIS MODULE EXISTS TO GET RIGHT
// ---------------------------------------------------------------------------------------
//
// An officer's feedback is two different things wearing one shape:
//
//   "शीर्षक खूप लांब आहे, लहान ठेवा"  — how the department wants ARTICLES written. Reusable.
//   "बजेट ५०० नाही, ६०० कोटी आहे"      — a fact about THIS note. Reusable never.
//
// A missed rule costs one rule, which an officer can add by hand on the review page. A
// factual correction mistaken for a rule is injected into EVERY future article, where it
// asserts a budget figure about notes that have nothing to do with it — a government article
// stating an invented amount. The two failures are not comparable, so nothing here is
// balanced: EVERY threshold errs toward rejection, and the deterministic guard below is
// written to reject on doubt.
//
// ---------------------------------------------------------------------------------------
// INSTRUCT, THEN GUARANTEE — the repo's standing doctrine
// ---------------------------------------------------------------------------------------
//
// Layer 1, INSTRUCTED: one strict-JSON call classifies the feedback into candidates, each
// marked `editorial` or `factual`. The model is good at reading intent out of Marathi prose
// and is the only thing that can split "बजेट ६०० कोटी आहे आणि शीर्षक लहान ठेवा" into two.
//
// Layer 2, GUARANTEED: `isPortableRule` re-decides in code, with no model and no network.
// The model's verdict is never trusted on its own — a candidate it called `editorial` is
// still put through every test below, and only a candidate BOTH agree on is written.
//
// That is `resolve-poster-subject.ts` (the model nominates, code validates),
// `lock-scheme-names.ts` and the video planner's `fact_index` grounding, applied to a new
// question. What is new is the DIRECTION of the test. `findUnsupportedClaims` and
// `validatePosterSubject` require a claim to be ACCOUNTABLE IN THE NOTE before it may be
// published. A learned rule is rejected for exactly the same reason: if it can only be
// checked against this note, it is not a rule about writing, it is this note's content.
//
// ---------------------------------------------------------------------------------------
// HONEST LIMIT — do not describe the guard as total
// ---------------------------------------------------------------------------------------
//
// A person the verified glossary has never met, written without digits, without a date word
// and without a Latin-script name, can pass every test here. "श्री. क्ष यांचे नाव आधी द्या"
// is a factual correction the guard cannot see. The review page (Phase 3) is the backstop,
// which is why auto-learning stays behind a default-off flag until that page exists.

import { pathToFileURL } from 'node:url';

import { PREFERENCE_RULE_MAX_CHARS } from '@dgipr/schemas';

import { chatComplete, type ReasoningEffort } from './openai-chat.js';
import { editDistance } from './edit-distance.js';

// ---------------------------------------------------------------------------------------
// Model tier
// ---------------------------------------------------------------------------------------

/**
 * The REFLECTOR, and deliberately not the writer.
 *
 * The /dlo article is written by a self-hosted Gemma (`ARTICLE_PROVIDER=gemma`). This call
 * reads that article's feedback and decides what the department has just taught the
 * platform — a judgement about editorial intent that nothing downstream re-checks except
 * the guard below, and one whose output steers every FUTURE article rather than one. A
 * model is also a poor critic of its own failure, which is why GEPA and LangMem both pair a
 * capable reflector with a cheaper generator. It runs on OpenAI's authoring tier for the
 * same reason `resolve-poster-subject.ts` does, and moving it is an .env edit.
 */
export const PREFERENCE_MODEL =
  process.env.OPENAI_PREFERENCE_MODEL ?? 'gpt-5.6-sol';

/** Values: none | low | medium | high; anything else falls back to 'medium'. */
export function preferenceReasoningEffort(): ReasoningEffort {
  const raw =
    process.env.OPENAI_PREFERENCE_REASONING_EFFORT?.trim().toLowerCase();
  return raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high'
    ? raw
    : 'medium';
}

// How much of the note the classifier sees. It needs the note only to answer one question —
// "does this feedback name something that is in THIS note?" — and the deterministic guard
// re-answers it against the whole note anyway, so a bounded excerpt keeps a 60k-char /dlo
// source from dominating the request.
const NOTE_MAX_CHARS = 6000;
// Feedback is a box an officer types into; anything past this is a different kind of input.
const FEEDBACK_MAX_CHARS = 4000;
// One feedback round is not five rules. A model that returns ten has misread the question,
// and the cap bounds the damage rather than trusting it not to.
const MAX_CANDIDATES = 4;

export const PREFERENCE_SCOPES = ['news', 'scheme', 'both'] as const;
export type PreferenceScope = (typeof PREFERENCE_SCOPES)[number];

export type PreferenceCandidate = Readonly<{
  // The model's own verdict. Advisory: the guard below re-decides, and disagreement is the
  // signal for tuning the PROMPT — never for loosening the guard.
  kind: 'editorial' | 'factual';
  // The rule as it would be injected: Marathi, imperative, about FORM.
  rule: string;
  scope: PreferenceScope;
  // A phrase the rule is ABOUT rather than asserts — "'यावेळी सांगण्यात आले' वापरू नका". The
  // guard's quote carve-out exists for exactly this and nothing else.
  quotedPhrase?: string;
  rationale?: string;
}>;

// ---------------------------------------------------------------------------------------
// Layer 2 — the deterministic guard. No model, no network, free to run and free to test.
// ---------------------------------------------------------------------------------------

const DEVANAGARI_ZERO = 0x0966;

/** Devanagari and Latin digits compared in ONE script, exactly as `keyPointOf` does. */
export function toLatinDigits(text: string): string {
  return text.replace(/[०-९]/gu, (digit) =>
    String(digit.codePointAt(0)! - DEVANAGARI_ZERO),
  );
}

/**
 * Units that describe the ARTICLE, not the world.
 *
 * A digit beside one of these measures the piece being written — how many words the headline
 * may run to, which tier it is, which paragraph something belongs in — and is the whole
 * reason "Tier-2 शीर्षक १० शब्दांच्या आत ठेवा" is a rule rather than a fact. Marathi inflects
 * by suffix (शब्द → शब्दांच्या), so these are matched as PREFIXES inside the window either
 * side of the digit rather than as whole words.
 */
const FORM_UNITS = [
  'शब्द',
  'अक्षर',
  'ओळ',
  'परिच्छेद',
  'वाक्य',
  'मुद्द',
  'टप्प',
  'उपशीर्षक',
  'tier',
  'word',
  'character',
  'char',
  'line',
  'paragraph',
  'point',
  'sentence',
] as const;

/**
 * Units that describe the WORLD.
 *
 * A digit beside one of these is a quantity out of the news — a budget, a beneficiary count,
 * a distance — and is factual WHATEVER the note says, which is what catches
 * "बजेट ५०० नाही, ६०० कोटी आहे" even when the note happens not to spell the corrected figure.
 */
const WORLD_UNITS = [
  'कोटी',
  'लाख',
  'हजार',
  'रुपय',
  '₹',
  'टक्क',
  'टक्के',
  '%',
  'किमी',
  'किलोमीटर',
  'हेक्टर',
  'मीटर',
  'crore',
  'lakh',
  'rs',
  'percent',
  'km',
] as const;

/**
 * Words that ARE a date value.
 *
 * A weekday or a month names a specific day — "बैठक सोमवारी झाली" is this note's fact and
 * nothing else's — so it is rejected wherever it occurs.
 */
const DATE_VALUE_WORDS = [
  'सोमवार',
  'मंगळवार',
  'बुधवार',
  'गुरुवार',
  'शुक्रवार',
  'शनिवार',
  'रविवार',
  'जानेवारी',
  'फेब्रुवारी',
  'मार्च',
  'एप्रिल',
  'जून',
  'जुलै',
  'ऑगस्ट',
  'सप्टेंबर',
  'ऑक्टोबर',
  'नोव्हेंबर',
  'डिसेंबर',
] as const;

/**
 * Words that MARK a date, and are factual only when a date actually follows them.
 *
 * This is a deliberate refinement of the plan's flat date-word test, and the reason is a
 * canonical example: `@dgipr/schemas`' own header names
 * "निर्णयाची तारीख पहिल्या परिच्छेदात द्या" as a valid preference — it says WHERE the date
 * goes and names no date at all. Rejecting the word तारीख outright would refuse that rule on
 * sight. So a marker is factual only when a digit run sits beside it, which is what
 * "दि. ५ रोजीची बैठक" is and "तारीख पहिल्या परिच्छेदात द्या" is not.
 */
const DATE_MARKER_WORDS = ['तारीख', 'तारख', 'दिनांक', 'दि.'] as const;

// Quote pairs a Marathi press note actually uses. Marathi marks an official name with ‘…’,
// which is the same mark a banned-phrasing rule uses to quote the phrase it bans — so the
// carve-out below is narrow on purpose: it exempts a quoted span from the digit and date
// tests and from nothing else.
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['‘', '’'],
  ['“', '”'],
  ['«', '»'],
  ['"', '"'],
  ["'", "'"],
];

/** Every quoted span in `text`, inner text only. */
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let index = 0;
    for (;;) {
      const start = text.indexOf(open, index);
      if (start < 0) break;
      const end = text.indexOf(close, start + open.length);
      if (end < 0) break;
      spans.push(text.slice(start + open.length, end));
      index = end + close.length;
    }
  }
  return spans;
}

/** `text` with every quoted span blanked out, so the digit and date tests cannot see it. */
function withoutQuotedSpans(text: string): string {
  let out = text;
  for (const span of quotedSpans(text)) {
    if (span.length === 0) continue;
    out = out.split(span).join(' ');
  }
  return out;
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Lower-cased and digit-normalised, for the substring probes below. */
function foldForMatch(text: string): string {
  return toLatinDigits(text).toLowerCase();
}

// A window of characters either side of a digit run, wide enough to hold the inflected
// Marathi word that follows it (शब्दांच्या) and the one that precedes it.
const UNIT_WINDOW = 14;

function unitNear(
  folded: string,
  start: number,
  end: number,
  unit: string,
): boolean {
  const before = folded.slice(Math.max(0, start - UNIT_WINDOW), start);
  const after = folded.slice(end, end + UNIT_WINDOW);
  return before.includes(unit) || after.includes(unit);
}

export type PortabilityReason =
  | 'ok'
  | 'empty'
  | 'too-long'
  | 'multi-sentence'
  | 'digit-in-note'
  | 'world-quantity'
  | 'date-value'
  | 'entity';

export type PortabilityVerdict = Readonly<{
  portable: boolean;
  // Which test decided, for the job log and for the harness. A rejection names the test, so a
  // disagreement between the model and the guard is debuggable without re-running either.
  reason: PortabilityReason;
  detail?: string;
}>;

/**
 * The minimal glossary shape the guard needs.
 *
 * Plain data rather than `GlossaryTerm`, so `@dgipr/content-engine` stays free of a
 * `@dgipr/database` dependency and the harness runs with no client at all. The caller
 * (apps/api) fetches the rows.
 */
export type GuardGlossaryTerm = Readonly<{
  marathi: string;
  termType: string;
}>;

// Which glossary types name a THING IN THE WORLD. `designation` and `other` are deliberately
// absent: "मंत्र्यांच्या धोरणात्मक विधानाने सुरुवात करा" is a legitimate standing rule, base
// rule 1 already names मुख्यमंत्री, and an over-typed common noun (विधानसभा, sometimes filed
// as `org`) must not be able to veto a rule. This is the same person/place/org/scheme vs
// designation/other split the Hindi translation lock already makes.
const ENTITY_TYPES = new Set(['person', 'place', 'org', 'scheme']);

// At most two sentences. The plan says "single sentence"; strictly one is too brittle against
// ordinary Marathi abbreviation (दि., क्र., श्री.), and 240 characters already does the work
// of refusing a paragraph. Three or more is a note, not a rule.
const MAX_SENTENCE_BREAKS = 1;

function sentenceBreaks(text: string): number {
  // A break is a Devanagari danda, or a terminator followed by whitespace and more content.
  // "दि. ५" is not a break by this test, which is the point.
  const matches = text.match(/।|[.!?](?=\s+\S)/gu);
  return matches?.length ?? 0;
}

/**
 * Is this candidate a rule about WRITING, or a fact about ONE note?
 *
 * Pure, free, and the only verdict that decides whether anything is written. The model's own
 * `kind` is not consulted here at all — the caller applies both, and a candidate must pass
 * both.
 *
 * The ORDER matters in exactly one place: the form-unit allowlist is applied PER DIGIT RUN,
 * before the two digit tests see that run. That is what lets "Tier-2 शीर्षक १० शब्दांच्या आत
 * ठेवा" survive a note that happens to contain १०.
 */
export function isPortableRule(
  candidate: Pick<PreferenceCandidate, 'rule'>,
  note: string,
  glossaryTerms: readonly GuardGlossaryTerm[] = [],
): PortabilityVerdict {
  const rule = normalizeSpace(candidate.rule ?? '');

  // Shape first. Cheapest, and a malformed candidate is not worth testing further.
  if (rule.length === 0) return { portable: false, reason: 'empty' };
  if (rule.length > PREFERENCE_RULE_MAX_CHARS) {
    return { portable: false, reason: 'too-long', detail: `${rule.length}` };
  }
  if (sentenceBreaks(rule) > MAX_SENTENCE_BREAKS) {
    return { portable: false, reason: 'multi-sentence' };
  }

  // The quote carve-out. The digit and date tests look at the rule with its quoted spans
  // removed, so a banned phrasing may quote the phrase it bans; the entity test below looks
  // at the WHOLE rule, so a person's name cannot be laundered by putting it in quotes.
  const unquoted = withoutQuotedSpans(rule);
  const foldedRule = foldForMatch(unquoted);
  const foldedNote = foldForMatch(note ?? '');

  const digitRun = /\d+/gu;
  for (
    let match = digitRun.exec(foldedRule);
    match;
    match = digitRun.exec(foldedRule)
  ) {
    const run = match[0];
    const start = match.index;
    const end = start + run.length;

    // Form-unit allowlist. WINS over both digit tests: this digit measures the article.
    if (FORM_UNITS.some((unit) => unitNear(foldedRule, start, end, unit))) {
      continue;
    }
    // World quantity. Factual regardless of the note, which is what catches a correction
    // whose corrected figure the note does not yet contain.
    const worldUnit = WORLD_UNITS.find((unit) =>
      unitNear(foldedRule, start, end, unit),
    );
    if (worldUnit) {
      return {
        portable: false,
        reason: 'world-quantity',
        detail: `${run} ${worldUnit}`,
      };
    }
    // The run occurs in the note. Then it is this note's number.
    if (foldedNote.includes(run)) {
      return { portable: false, reason: 'digit-in-note', detail: run };
    }
    // A bare number beside nothing recognisable is left alone deliberately: with no unit and
    // no occurrence in the note it measures nothing this note contains, and rejecting it
    // would refuse "दोन ऐवजी 3 उपशीर्षके द्या".
  }

  // Date values, and date markers that actually carry a date.
  const dateValue = DATE_VALUE_WORDS.find((word) => unquoted.includes(word));
  if (dateValue) {
    return { portable: false, reason: 'date-value', detail: dateValue };
  }
  for (const marker of DATE_MARKER_WORDS) {
    const needle = marker.toLowerCase();
    let index = foldedRule.indexOf(needle);
    while (index >= 0) {
      const window = foldedRule.slice(
        Math.max(0, index - UNIT_WINDOW),
        index + needle.length + UNIT_WINDOW,
      );
      if (/\d/u.test(window)) {
        return { portable: false, reason: 'date-value', detail: marker };
      }
      index = foldedRule.indexOf(needle, index + needle.length);
    }
  }

  // Entities, against the WHOLE rule, quotes included.
  for (const term of glossaryTerms) {
    if (!ENTITY_TYPES.has(term.termType)) continue;
    const marathi = term.marathi.trim();
    if (marathi.length === 0) continue;
    if (rule.includes(marathi)) {
      return { portable: false, reason: 'entity', detail: marathi };
    }
  }
  // English proper nouns the glossary has not met. Only when the token also occurs in the
  // note — an unanchored capitalised word is as likely to be "Tier" as a name.
  const latinTokens = rule.match(/\b[A-Z][a-z]{2,}\b/gu) ?? [];
  for (const token of latinTokens) {
    if ((note ?? '').includes(token)) {
      return { portable: false, reason: 'entity', detail: token };
    }
  }

  return { portable: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------------------
// Layer 1 — the classifier
// ---------------------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You read one round of an officer's feedback on a Marathi government news article and",
  'decide what, if anything, the department has just taught the platform about HOW it wants',
  'articles written.',
  '',
  'THE OPERATIVE TEST. A rule is `editorial` only if it would still be meaningful and',
  'checkable for an article about a COMPLETELY DIFFERENT subject. If it can only be checked',
  'against this particular note, it is `factual`.',
  '',
  'An `editorial` rule is about FORM: structure, ordering, where something belongs, headline',
  'shape and length, attribution style, tone, what to include or leave out, which wording to',
  'avoid. A `factual` candidate is about CONTENT: a name, a date, an amount, a figure, a',
  'place, the designation a particular person holds, a scheme name, who attended, what was',
  'decided.',
  '',
  'ONE ROUND OF FEEDBACK MAY CONTAIN BOTH, and often does. Return one candidate per distinct',
  'instruction, each classified on its own. Never merge an editorial instruction and a',
  'factual correction into one candidate.',
  '',
  'WRITING THE RULE. Marathi, imperative, one sentence, at most',
  `${PREFERENCE_RULE_MAX_CHARS} characters. Write it as a standing instruction to the writer`,
  '("शीर्षक १० शब्दांच्या आत ठेवा"), never as a remark about this one article ("शीर्षक खूप लांब',
  'आहे"). Generalise the INSTRUCTION, but never generalise a FACT: do not turn "बजेट ६०० कोटी',
  'आहे" into a rule about budgets.',
  '',
  'A RULE MAY NEVER CARRY A FACT. No name, date, amount, figure, place, scheme name or',
  "particular person's designation may appear in the rule text. If the instruction cannot be",
  'stated without one, it is `factual`.',
  '',
  'QUOTING. When the instruction is about a PHRASE the department does not want used, quote',
  'that phrase in the rule and repeat it in `quoted_phrase`. That is the only reason to quote.',
  '',
  'SCOPE. `news` for a rule about बातमी reports, `scheme` for योजना-लेख features, `both` when',
  'it is about house style generally. Prefer `both` unless the feedback is clearly about one',
  'kind of article.',
  '',
  'WHEN IN DOUBT, ANSWER `factual`. A missed rule costs nothing; a fact turned into a standing',
  'rule is asserted in every future article.',
  '',
  'If the feedback teaches nothing at all — "छान आहे", a typo fix — return an empty array.',
].join('\n');

function parseJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  const body = fenced?.[1] ?? trimmed;
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Preference extraction did not return a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function asScope(value: unknown): PreferenceScope {
  return value === 'news' || value === 'scheme' ? value : 'both';
}

export type ExtractPreferencesInput = Readonly<{
  // The officer's own words, verbatim.
  feedback: string;
  // The note the article was written from — the ONLY thing that makes "is this about this
  // note?" answerable.
  note: string;
  category: 'news' | 'scheme';
}>;

/**
 * ONE strict-JSON call.
 *
 * Returns `[]` on any failure, because this is a background pass over a revision the officer
 * has already received: a classifier outage must cost the learning and nothing else.
 */
export async function extractPreferenceCandidates(
  input: ExtractPreferencesInput,
): Promise<PreferenceCandidate[]> {
  const feedback = normalizeSpace(input.feedback ?? '').slice(
    0,
    FEEDBACK_MAX_CHARS,
  );
  if (feedback.length === 0) return [];
  const note = (input.note ?? '').slice(0, NOTE_MAX_CHARS);

  const user = [
    `<ARTICLE_KIND>${input.category}</ARTICLE_KIND>`,
    '',
    '<NOTE purpose="this_article\'s_source_material_only">',
    note,
    '</NOTE>',
    '',
    '<OFFICER_FEEDBACK>',
    feedback,
    '</OFFICER_FEEDBACK>',
  ].join('\n');

  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      {
        model: PREFERENCE_MODEL,
        reasoningEffort: preferenceReasoningEffort(),
        maxTokens: 900,
        jsonSchema: {
          name: 'editorial_preference_candidates',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    kind: { type: 'string', enum: ['editorial', 'factual'] },
                    rule: { type: 'string' },
                    scope: { type: 'string', enum: [...PREFERENCE_SCOPES] },
                    quoted_phrase: { type: 'string' },
                    rationale: { type: 'string' },
                  },
                  required: [
                    'kind',
                    'rule',
                    'scope',
                    'quoted_phrase',
                    'rationale',
                  ],
                },
              },
            },
            required: ['candidates'],
          },
        },
      },
    );

    const answer = parseJson(raw);
    const rows = Array.isArray(answer.candidates) ? answer.candidates : [];
    const candidates: PreferenceCandidate[] = [];
    for (const row of rows.slice(0, MAX_CANDIDATES)) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const rule = typeof record.rule === 'string' ? record.rule.trim() : '';
      if (rule.length === 0) continue;
      const quoted =
        typeof record.quoted_phrase === 'string'
          ? record.quoted_phrase.trim()
          : '';
      const rationale =
        typeof record.rationale === 'string' ? record.rationale.trim() : '';
      candidates.push({
        kind: record.kind === 'editorial' ? 'editorial' : 'factual',
        rule,
        scope: asScope(record.scope),
        ...(quoted.length > 0 ? { quotedPhrase: quoted } : {}),
        ...(rationale.length > 0 ? { rationale } : {}),
      });
    }
    return candidates;
  } catch (error) {
    console.warn(
      '[editorial-learning] could not classify this feedback; learning nothing from it:',
      error,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------------------

/**
 * How near two rules must be to count as the same one.
 *
 * `editDistance` is the repo's shared Levenshtein (proof-read's name gate, the Hindi locked
 * name repair). 8 is a couple of inflected endings and a particle on a ~40-character Marathi
 * sentence — enough to fold "शीर्षक लहान ठेवा" into "शीर्षक लहान ठेवावे", not enough to fold two
 * different instructions together. Deliberately conservative: a missed near-duplicate costs
 * one extra row that the consolidation call then sees and can merge, while a wrong fold
 * silently rewrites a rule the department is still using.
 */
export const NEAR_DUPLICATE_MAX_DISTANCE = 8;

/** Trim, collapse whitespace, drop trailing punctuation. The cheapest possible comparison. */
export function normalizeRule(rule: string): string {
  return normalizeSpace(rule ?? '').replace(/[।.!?,;:\s]+$/u, '');
}

export type ExistingPreference = Readonly<{ id: string; rule: string }>;

/** The rule's digit runs, script-normalised and in order. */
function digitSignature(rule: string): string {
  return (toLatinDigits(rule).match(/\d+/gu) ?? []).join(',');
}

/**
 * The FREE half of consolidation: is this rule already stored, exactly or near enough?
 *
 * Runs before any model call, because the commonest case by far is the department saying the
 * same thing again — and that case must cost nothing, or repetition becomes expensive exactly
 * when it is most informative.
 *
 * TWO RULES WHOSE NUMBERS DIFFER ARE NEVER DUPLICATES, however alike they read. "शीर्षक १५
 * शब्दांच्या आत ठेवा" and "शीर्षक १० शब्दांच्या आत ठेवा" are one edit apart and say opposite
 * things — and folding the second into the first would REINFORCE the limit the department has
 * just changed, silently, with no model call to catch it. So a digit mismatch sends the pair
 * to the consolidator, which is what `SUPERSEDES` exists for. Caught by the harness on its
 * first run; do not remove the signature test to make a near-repeat cheaper.
 */
export function findDuplicatePreference(
  rule: string,
  existing: readonly ExistingPreference[],
): ExistingPreference | null {
  const needle = normalizeRule(rule);
  if (needle.length === 0) return null;
  const needleDigits = digitSignature(needle);
  let best: ExistingPreference | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of existing) {
    const hay = normalizeRule(row.rule);
    // An exact repeat is a repeat whatever it contains, so this stays above the digit test.
    if (hay === needle) return row;
    if (digitSignature(hay) !== needleDigits) continue;
    // Length alone rules most pairs out without paying for the matrix.
    if (Math.abs(hay.length - needle.length) > NEAR_DUPLICATE_MAX_DISTANCE) {
      continue;
    }
    const distance = editDistance(hay, needle);
    if (distance <= NEAR_DUPLICATE_MAX_DISTANCE && distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

export const CONSOLIDATION_ACTIONS = [
  'ADD',
  'DUPLICATE_OF',
  'SUPERSEDES',
  'MERGE_WITH',
] as const;
export type ConsolidationAction = (typeof CONSOLIDATION_ACTIONS)[number];

export type ConsolidationDecision = Readonly<{
  action: ConsolidationAction;
  // The existing rule this decision refers to. Null only for ADD.
  targetId: string | null;
  // Present for MERGE_WITH: the single rule that replaces both. Never set for the others.
  mergedRule?: string;
}>;

const CONSOLIDATE_SYSTEM_PROMPT = [
  'You maintain a short list of standing editorial rules for a Marathi government news desk.',
  "A new rule has been learned from an officer's feedback. Decide how it fits the list.",
  '',
  'ADD          — it says something none of the existing rules says.',
  'DUPLICATE_OF — an existing rule already says the same thing. Name it.',
  'SUPERSEDES   — it says the same thing as an existing rule but DIFFERENTLY, and the new',
  "               wording is the department's current intent (a different number of words, or",
  '               the opposite instruction). Name the rule it replaces.',
  'MERGE_WITH   — it and one existing rule are two halves of one instruction, and a single',
  '               sentence would state both better. Name that rule and supply `merged_rule`.',
  '',
  'Prefer ADD when unsure: two rules that overlap are a tidiness problem, while wrongly',
  'replacing a rule loses something the department asked for. Never propose MERGE_WITH or',
  'SUPERSEDES across two different subjects merely because both mention headlines.',
  '',
  '`merged_rule` must be Marathi, imperative, one sentence, at most',
  `${PREFERENCE_RULE_MAX_CHARS} characters, and must carry no name, date, amount, figure,`,
  'place or scheme name. Leave it empty for every action but MERGE_WITH.',
].join('\n');

/**
 * ONE call, and only when the free tests above found nothing.
 *
 * The candidate is compared against EVERY active rule in its scope — the set is capped at
 * `MAX_INJECTED_PREFERENCES`, so "all of them" is one small request and the consolidator sees
 * exactly what the article prompt will. That is the argument against embeddings here: with a
 * capped set there is nothing for a vector index to narrow, and injection stays deterministic
 * and auditable, so Phase 3's page can show precisely what the model sees.
 *
 * Falls back to ADD on any failure. Adding a redundant rule is recoverable on the review
 * page; losing the officer's rule to a transient error is not.
 */
export async function consolidatePreference(
  rule: string,
  existing: readonly ExistingPreference[],
): Promise<ConsolidationDecision> {
  if (existing.length === 0) return { action: 'ADD', targetId: null };
  const known = new Map(existing.map((row) => [row.id, row]));

  const user = [
    '<EXISTING_RULES>',
    ...existing.map((row) => `${row.id}\t${row.rule}`),
    '</EXISTING_RULES>',
    '',
    '<NEW_RULE>',
    rule,
    '</NEW_RULE>',
  ].join('\n');

  try {
    const raw = await chatComplete(
      [
        { role: 'system', content: CONSOLIDATE_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      {
        model: PREFERENCE_MODEL,
        reasoningEffort: preferenceReasoningEffort(),
        maxTokens: 500,
        jsonSchema: {
          name: 'preference_consolidation',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: [...CONSOLIDATION_ACTIONS] },
              target_id: { type: 'string' },
              merged_rule: { type: 'string' },
            },
            required: ['action', 'target_id', 'merged_rule'],
          },
        },
      },
    );
    const answer = parseJson(raw);
    const action = CONSOLIDATION_ACTIONS.includes(
      answer.action as ConsolidationAction,
    )
      ? (answer.action as ConsolidationAction)
      : 'ADD';
    if (action === 'ADD') return { action: 'ADD', targetId: null };

    // An id the model invented names nothing this process can act on, so the decision it
    // decorates is meaningless. Degrade to ADD rather than guess which rule was meant.
    const targetId =
      typeof answer.target_id === 'string' ? answer.target_id.trim() : '';
    if (!known.has(targetId)) {
      console.warn(
        `[editorial-learning] consolidation named an unknown rule (${targetId || 'empty'}); adding instead`,
      );
      return { action: 'ADD', targetId: null };
    }
    if (action !== 'MERGE_WITH') return { action, targetId };

    const merged =
      typeof answer.merged_rule === 'string'
        ? normalizeSpace(answer.merged_rule)
        : '';
    if (merged.length === 0 || merged.length > PREFERENCE_RULE_MAX_CHARS) {
      console.warn(
        '[editorial-learning] MERGE_WITH came back with no usable merged rule; adding instead',
      );
      return { action: 'ADD', targetId: null };
    }
    return { action: 'MERGE_WITH', targetId, mergedRule: merged };
  } catch (error) {
    console.warn(
      '[editorial-learning] could not consolidate; adding the rule as new:',
      error,
    );
    return { action: 'ADD', targetId: null };
  }
}

// ---------------------------------------------------------------------------------------
// Run directly (FREE with --check — no model call, no network):
//   tsx src/generation/learn-editorial-preferences.ts --check
// ---------------------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv.includes('--check')
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (condition) console.log(`  ok    ${label}`);
    else {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    }
  };

  // A realistic /dlo note: it carries the figures and the date the feedback might correct.
  const NOTE = [
    'मुंबई येथील बैठकीत राज्य शासनाने नवीन योजनेसाठी ५०० कोटी रुपये मंजूर केले.',
    'बैठक सोमवारी दि. ५ रोजी पार पडली. यावेळी देवेंद्र फडणवीस उपस्थित होते.',
    'Fadnavis also reviewed the district plan.',
  ].join('\n');

  const GLOSSARY: GuardGlossaryTerm[] = [
    { marathi: 'देवेंद्र फडणवीस', termType: 'person' },
    { marathi: 'मुंबई', termType: 'place' },
    { marathi: 'मुख्यमंत्री', termType: 'designation' },
    { marathi: 'विधानसभा', termType: 'org' },
  ];

  const verdict = (rule: string): PortabilityVerdict =>
    isPortableRule({ rule }, NOTE, GLOSSARY);

  console.log("\n=== the brief's own examples ===");
  const budget = verdict('बजेट ५०० कोटी नाही, ६०० कोटी आहे');
  check(
    'a corrected budget figure is factual',
    !budget.portable && budget.reason === 'world-quantity',
  );
  const meeting = verdict('बैठक सोमवारी झाली');
  check(
    'a weekday is factual',
    !meeting.portable && meeting.reason === 'date-value',
  );
  const absent = verdict('मंत्री देवेंद्र फडणवीस अनुपस्थित होते');
  check(
    'a glossary person makes it factual',
    !absent.portable && absent.reason === 'entity',
  );
  check(
    'Tier-2 शीर्षक १० शब्दांच्या आत ठेवा survives the form-unit allowlist',
    verdict('Tier-2 शीर्षक १० शब्दांच्या आत ठेवा').portable,
  );
  check(
    'a banned phrasing may quote the phrase it bans',
    verdict('‘यावेळी सांगण्यात आले’ असे निष्क्रिय वाक्य वापरू नका').portable,
  );
  check(
    'the closing dignitary convention is editorial',
    verdict('उपस्थित मान्यवरांची यादी शेवटी द्या').portable,
  );
  check(
    'a designation does NOT make it factual',
    verdict('मंत्र्यांच्या धोरणात्मक विधानाने सुरुवात करा').portable,
  );
  const quotedName = verdict('‘देवेंद्र फडणवीस’ यांचे नाव आधी द्या');
  check(
    'quotes do not launder a glossary person',
    !quotedName.portable && quotedName.reason === 'entity',
  );

  console.log('\n=== the refined date test ===');
  check(
    'निर्णयाची तारीख पहिल्या परिच्छेदात द्या is a rule (a marker with no date)',
    verdict('निर्णयाची तारीख पहिल्या परिच्छेदात द्या').portable,
  );
  // ७ is deliberately a digit the note does NOT contain, so the digit tests pass it and the
  // date-marker test is the one that has to decide. With a date the note does contain the
  // rejection is the same and arrives one test earlier, which is the case below.
  const dated = verdict('दि. ७ रोजीची बैठक नमूद करा');
  check(
    'दि. ७ carries an actual date and is factual',
    !dated.portable && dated.reason === 'date-value',
  );
  check(
    'a date the note also spells is rejected too (by whichever test reaches it first)',
    !verdict('दि. ५ रोजीची बैठक नमूद करा').portable,
  );

  console.log('\n=== the digit tests ===');
  const inNote = verdict('५०० लाभार्थी नमूद करा');
  check(
    'a bare number that occurs in the note is factual',
    !inNote.portable && inNote.reason === 'digit-in-note',
  );
  check(
    'a number that occurs nowhere and measures nothing is left alone',
    verdict('दोन ऐवजी 3 उपशीर्षके द्या').portable,
  );
  check(
    'Devanagari and Latin digits are compared in one script',
    !isPortableRule({ rule: '500 लाभार्थी नमूद करा' }, NOTE, GLOSSARY).portable,
  );
  check(
    'a world unit is factual even when the note never spells the figure',
    !verdict('अनुदान ७५० कोटी असल्याचे लिहा').portable,
  );
  check(
    'a percentage is factual',
    !verdict('वाढ ५५ टक्के आहे असे लिहा').portable,
  );

  console.log('\n=== English proper nouns ===');
  const latin = verdict('Fadnavis यांचे नाव आधी द्या');
  check(
    'a capitalised Latin token that occurs in the note is factual',
    !latin.portable && latin.reason === 'entity',
  );
  check(
    'a capitalised token that does NOT occur in the note is left alone',
    verdict('Tier रचना पाळा').portable,
  );

  console.log('\n=== the shape guard ===');
  check('an empty rule is rejected', !verdict('   ').portable);
  check(
    `over ${PREFERENCE_RULE_MAX_CHARS} characters is rejected`,
    !verdict('अ'.repeat(PREFERENCE_RULE_MAX_CHARS + 1)).portable,
  );
  check(
    'two sentences are allowed (Marathi abbreviates with a full stop)',
    verdict('शीर्षक लहान ठेवा. परिच्छेद लहान ठेवा.').portable,
  );
  const rambling = verdict(
    'शीर्षक लहान ठेवा. परिच्छेद लहान ठेवा. शेवटी यादी द्या.',
  );
  check(
    'three sentences are rejected as a note rather than a rule',
    !rambling.portable && rambling.reason === 'multi-sentence',
  );

  console.log('\n=== mixed feedback: one dropped, one kept ===');
  // What the classifier is expected to return for
  // "बजेट ६०० कोटी आहे आणि शीर्षक लहान ठेवा": two candidates, and the guard keeps exactly one.
  const mixed: PreferenceCandidate[] = [
    { kind: 'factual', rule: 'बजेट ६०० कोटी आहे असे लिहा', scope: 'both' },
    { kind: 'editorial', rule: 'शीर्षक लहान ठेवा', scope: 'news' },
  ];
  const kept = mixed.filter(
    (candidate) =>
      candidate.kind === 'editorial' &&
      isPortableRule(candidate, NOTE, GLOSSARY).portable,
  );
  check('exactly one of the two survives', kept.length === 1);
  check('and it is the editorial one', kept[0]?.rule === 'शीर्षक लहान ठेवा');

  console.log("\n=== the model's verdict is never enough on its own ===");
  check(
    'a candidate the model called editorial is still rejected by the guard',
    !isPortableRule({ rule: 'बजेट ६०० कोटी आहे असे लिहा' }, NOTE, GLOSSARY)
      .portable,
  );

  console.log('\n=== free de-duplication ===');
  const existing: ExistingPreference[] = [
    { id: 'a', rule: 'शीर्षक १० शब्दांच्या आत ठेवा.' },
    { id: 'b', rule: 'उपस्थित मान्यवरांची यादी शेवटी द्या.' },
  ];
  check(
    'an exact repeat (bar punctuation) is found',
    findDuplicatePreference('शीर्षक १० शब्दांच्या आत ठेवा', existing)?.id ===
      'a',
  );
  check(
    'an inflected near-repeat is found',
    findDuplicatePreference('शीर्षक १० शब्दांच्या आत ठेवावे', existing)?.id ===
      'a',
  );
  check(
    'a different instruction is NOT folded in',
    findDuplicatePreference('पहिल्या परिच्छेदात निर्णय द्या', existing) ===
      null,
  );
  check(
    'a CHANGED NUMBER is not a duplicate — it goes to the consolidator to supersede',
    findDuplicatePreference('शीर्षक १५ शब्दांच्या आत ठेवा', existing) === null,
  );
  check(
    'and the same is true across scripts',
    findDuplicatePreference('शीर्षक 15 शब्दांच्या आत ठेवा', existing) === null,
  );
  check(
    'the same number in the other script still counts as a repeat',
    findDuplicatePreference('शीर्षक 10 शब्दांच्या आत ठेवावे', existing)?.id ===
      'a',
  );
  check(
    'an empty list matches nothing',
    findDuplicatePreference('काहीतरी', []) === null,
  );
  check(
    'normalizeRule strips a trailing danda',
    normalizeRule('  शीर्षक लहान  ठेवा। ') === 'शीर्षक लहान ठेवा',
  );

  console.log('\n=== quoted spans ===');
  check('a ‘…’ span is found', quotedSpans('‘अबक’ वापरू नका').includes('अबक'));
  check(
    'an unclosed quote does not hang or throw',
    quotedSpans('‘अबक वापरू नका').length === 0,
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll learn-editorial-preferences checks passed.');
}
