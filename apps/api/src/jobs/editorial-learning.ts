// What the department just taught the platform, written down.
//
// Called AFTER a feedback revision has been delivered — the article is already on screen, the
// row is written and the `generation_revisions` row is inserted — from both feedback jobs in
// runner.ts. Nothing here is on the officer's path: this module's entire contract is that the
// revision is finished before it starts and unaffected by whatever it does.
//
// It only SEQUENCES (the package-boundary rule). The classification, the deterministic guard
// and the consolidation call all live in @dgipr/content-engine's
// learn-editorial-preferences.ts; the rows are @dgipr/database's. What is decided here is the
// order, the gates, and what gets written.
//
// ---------------------------------------------------------------------------------------
// FOUR THINGS NOT TO UNDO
// ---------------------------------------------------------------------------------------
//
// 1. DEFAULT OFF. `EDITORIAL_LEARNING_ENABLED` gates the whole pass and is read in one place
//    below. An auto-learned rule is DEPARTMENT-WIDE — one officer's feedback steers every
//    other officer's next article — and the only thing that makes that safe is the review
//    page, which is Phase 3. Turning this on is Phase 3's last step, not this module's.
//
// 2. /dlo ONLY. `row.dloIntakeId` is the test, the same one that decides which prompt the
//    article was written with and which rules it received. The Creative-and-Social lanes do
//    not read these rules, so learning from their feedback would write rules nothing applies.
//
// 3. A CANDIDATE MUST PASS BOTH LAYERS. The model's `kind` is necessary and not sufficient:
//    `isPortableRule` re-decides in code and a rule it rejects is dropped whatever the model
//    said. That is the whole of the protection against a factual correction becoming a
//    standing rule, and it is deliberately asymmetric — see that module's header.
//
// 4. EVERY FAILURE IS SWALLOWED. This runs against work the officer already has. A throw here
//    must never reach runJob's catch, which would route a SUCCESSFUL revision into
//    recoverEditFailure and report it as `editFailure`. The caller uses
//    `void learn(...).catch(...)`; this module also catches internally so a partial failure
//    still writes the rules that did land.

import {
  countEditorialPreferences,
  findGlossaryTermsInText,
  insertEditorialPreference,
  listActiveEditorialPreferences,
  supersedeEditorialPreference,
  updateEditorialPreference,
  type EditorialPreferenceRow,
  type EditorialPreferenceScope,
  type SupabaseClient,
} from '@dgipr/database';
import {
  consolidatePreference,
  extractPreferenceCandidates,
  findDuplicatePreference,
  isPortableRule,
  type ExistingPreference,
  type GuardGlossaryTerm,
} from '@dgipr/content-engine';
import {
  MAX_INJECTED_PREFERENCES,
  type LearnedPreferenceNote,
} from '@dgipr/schemas';

/**
 * The flag, read in ONE place — the ARTICLE_POSTER_MODE / SOCIAL_REFERENCE_MODE /
 * ARTICLE_PROVIDER idiom.
 *
 * Default OFF, deliberately: see note 1 above. Unlike `articleProvider()` this does not throw
 * on an unrecognised value, because the consequence of a typo here is that learning stays off,
 * which is the safe state and the one the deployment is already in.
 */
export function editorialLearningEnabled(): boolean {
  const raw = process.env.EDITORIAL_LEARNING_ENABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * How long the whole pass may take before it is abandoned.
 *
 * It is fire-and-forget, so nothing is waiting on it — but an un-timed promise against a hung
 * provider is a leak that outlives the request that started it, and this process is long-lived
 * (the single-process constraint the orphan reaper already documents). Two model calls at the
 * authoring tier is a couple of minutes at the outside.
 */
function learningTimeoutMs(): number {
  const raw = Number(process.env.EDITORIAL_LEARNING_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
}

// How many active rules the consolidator is shown. The same cap the article prompt uses, on
// purpose: the consolidator must see exactly the set the next article will be written with, or
// it would merge against rules that never reach the model.
const CONSOLIDATION_POOL = MAX_INJECTED_PREFERENCES;

// A guard against a pathological run: the whole table is small by design (the cap is what
// keeps it sharp), and a feedback round that would take it past this is a signal to prune on
// the review page rather than something to keep growing through.
const MAX_STORED_PREFERENCES = 200;

export type LearnFromFeedbackInput = Readonly<{
  generationId: string;
  // The note the article was written from — what makes "is this about THIS note?" answerable.
  note: string;
  // The officer's own words, stored verbatim as the rule's provenance.
  feedback: string;
  category: 'news' | 'scheme';
}>;

/**
 * The two model calls, injectable.
 *
 * PRODUCTION NEVER PASSES THIS — the defaults below are the real engine functions. It exists
 * so the offline harness can drive the whole pass (guard, free de-duplication, and all four
 * consolidation outcomes) against a stub database with no network and no spend. Without it
 * the only free thing testable here would be the flag, and the branch that decides whether a
 * rule is INSERTED, REINFORCED, MERGED or SUPERSEDED — the branch that actually writes — would
 * be covered by nothing at all.
 */
export type LearningDeps = Readonly<{
  extract: typeof extractPreferenceCandidates;
  consolidate: typeof consolidatePreference;
}>;

const REAL_DEPS: LearningDeps = {
  extract: extractPreferenceCandidates,
  consolidate: consolidatePreference,
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    // Never hold the process open for a background pass nobody is waiting on.
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// The verified glossary rows that occur in the NOTE. The guard needs them to recognise a
// person, place, organisation or scheme inside a candidate rule. Best-effort: an unreachable
// dictionary weakens the guard's entity test rather than failing the pass, and every other
// test still runs — which is the honest trade, since the entity test was never total anyway
// (a name the dictionary has never met passes it either way).
async function guardGlossary(
  client: SupabaseClient,
  note: string,
): Promise<GuardGlossaryTerm[]> {
  if (note.trim().length === 0) return [];
  try {
    const terms = await findGlossaryTermsInText(client, note);
    return terms.map((term) => ({
      marathi: term.marathi,
      termType: term.termType,
    }));
  } catch (error) {
    console.warn(
      '[editorial-learning] could not read the glossary; the entity test will be weaker:',
      error,
    );
    return [];
  }
}

function toExisting(
  rows: readonly EditorialPreferenceRow[],
): ExistingPreference[] {
  return rows.map((row) => ({ id: row.id, rule: row.rule }));
}

/**
 * The whole pass, for ONE round of feedback.
 *
 * Returns the notes for the "memory updated" callout — empty when nothing was learned, which
 * is the ordinary outcome for a factual correction and is NOT an error. Never throws.
 *
 * The COST ENVELOPE is deliberately the caller's, not this module's: runner.ts owns the cost
 * accumulator, the cost chain (`persistCost` serialises writers per generation so a background
 * pass finishing beside runJob's `finally` cannot lose an update) and the task registry. Doing
 * it here would mean importing runner.ts, which imports this — a cycle for no gain.
 */
export async function learnFromArticleFeedback(
  client: SupabaseClient,
  input: LearnFromFeedbackInput,
  deps: LearningDeps = REAL_DEPS,
): Promise<LearnedPreferenceNote[]> {
  try {
    return await withTimeout(
      learn(client, input, deps),
      learningTimeoutMs(),
      'editorial learning',
    );
  } catch (error) {
    console.warn(
      `[editorial-learning ${input.generationId}] learned nothing from this round:`,
      error,
    );
    return [];
  }
}

async function learn(
  client: SupabaseClient,
  input: LearnFromFeedbackInput,
  deps: LearningDeps,
): Promise<LearnedPreferenceNote[]> {
  const feedback = input.feedback.trim();
  if (feedback.length === 0) return [];

  // Layer 1 — the model classifies. Returns [] rather than throwing on its own failures.
  const candidates = await deps.extract({
    feedback,
    note: input.note,
    category: input.category,
  });
  if (candidates.length === 0) {
    console.log(
      `[editorial-learning ${input.generationId}] no candidates in this feedback`,
    );
    return [];
  }

  // Layer 2 — the deterministic guard. Free, and it decides.
  const glossary = await guardGlossary(client, input.note);
  const accepted: { rule: string; scope: EditorialPreferenceScope }[] = [];
  for (const candidate of candidates) {
    const verdict = isPortableRule(candidate, input.note, glossary);
    if (candidate.kind !== 'editorial' || !verdict.portable) {
      // Logged at every rejection, because a disagreement between the two layers is the only
      // signal for tuning the classifier PROMPT — never for loosening the guard.
      console.log(
        `[editorial-learning ${input.generationId}] dropped (model=${candidate.kind}, ` +
          `guard=${verdict.reason}${verdict.detail ? ` «${verdict.detail}»` : ''}): ` +
          `«${candidate.rule.slice(0, 120)}»`,
      );
      continue;
    }
    accepted.push({ rule: candidate.rule.trim(), scope: candidate.scope });
  }
  if (accepted.length === 0) return [];

  const notes: LearnedPreferenceNote[] = [];
  for (const entry of accepted) {
    try {
      const note = await storeOne(client, input, entry.rule, entry.scope, deps);
      if (note) notes.push(note);
    } catch (error) {
      // One rule failing must not lose the others in the same round.
      console.warn(
        `[editorial-learning ${input.generationId}] could not store «${entry.rule.slice(0, 80)}»:`,
        error,
      );
    }
  }
  return notes;
}

async function storeOne(
  client: SupabaseClient,
  input: LearnFromFeedbackInput,
  rule: string,
  scope: EditorialPreferenceScope,
  deps: LearningDeps,
): Promise<LearnedPreferenceNote | null> {
  // The pool the next article of this kind will actually be written with — which is what the
  // consolidator must compare against, and what a duplicate must be a duplicate OF.
  const active = await listActiveEditorialPreferences(
    client,
    scope,
    CONSOLIDATION_POOL,
  );
  const existing = toExisting(active);

  // FREE FIRST. The commonest case by far is the department repeating itself, and that case
  // must cost no model call at all: a repeat is information about EMPHASIS, and making it
  // expensive is backwards.
  const duplicate = findDuplicatePreference(rule, existing);
  if (duplicate) {
    return reinforce(client, active, duplicate.id, 'reinforced', scope);
  }

  // Only now, and only against the capped set.
  const decision = await deps.consolidate(rule, existing);
  if (decision.action === 'DUPLICATE_OF' && decision.targetId) {
    return reinforce(client, active, decision.targetId, 'reinforced', scope);
  }
  if (
    decision.action === 'MERGE_WITH' &&
    decision.targetId &&
    decision.mergedRule
  ) {
    // Nothing new is inserted: the existing row is rewritten to cover both, keeping its
    // reinforcement history — which is the point of merging rather than superseding.
    const merged = await updateEditorialPreference(client, decision.targetId, {
      rule: decision.mergedRule,
      lastSeenAt: new Date().toISOString(),
    });
    if (!merged) return null;
    console.log(
      `[editorial-learning ${input.generationId}] merged into ${merged.id}: «${merged.rule}»`,
    );
    return {
      id: merged.id,
      rule: merged.rule,
      action: 'merged',
      scope: merged.scope,
    };
  }

  // A hard ceiling on the table, checked before an INSERT and not before a reinforcement: a
  // department that is repeating itself should always be heard, it is only growth that stops.
  const stored = await countEditorialPreferences(client, { status: 'active' });
  if (stored >= MAX_STORED_PREFERENCES) {
    console.warn(
      `[editorial-learning ${input.generationId}] ${stored} active rules already stored; ` +
        'not adding another. Prune on the review page.',
    );
    return null;
  }

  const inserted = await insertEditorialPreference(client, {
    rule,
    scope,
    status: 'active',
    source: 'learned',
    // Provenance: the officer's own words and the run they were written about, so the review
    // page can always answer "why does the platform write it this way?".
    sourceFeedback: input.feedback.trim(),
    sourceGenerationId: input.generationId,
  });

  if (decision.action === 'SUPERSEDES' && decision.targetId) {
    // The old row is MARKED, never deleted — the insert-only doctrine, and what makes a
    // consolidation reversible on the review page.
    await supersedeEditorialPreference(client, decision.targetId, inserted.id);
    console.log(
      `[editorial-learning ${input.generationId}] ${inserted.id} supersedes ` +
        `${decision.targetId}: «${inserted.rule}»`,
    );
    return {
      id: inserted.id,
      rule: inserted.rule,
      action: 'superseded',
      scope: inserted.scope,
    };
  }

  console.log(
    `[editorial-learning ${input.generationId}] learned (${scope}): «${inserted.rule}»`,
  );
  return {
    id: inserted.id,
    rule: inserted.rule,
    action: 'added',
    scope: inserted.scope,
  };
}

// Bump the reinforcement count and stamp recency, which is what moves a rule up the injection
// ranking (listActiveEditorialPreferences orders by exactly those two). No insert, and — when
// the free duplicate test found it — no model call either.
async function reinforce(
  client: SupabaseClient,
  active: readonly EditorialPreferenceRow[],
  id: string,
  action: 'reinforced',
  scope: EditorialPreferenceScope,
): Promise<LearnedPreferenceNote | null> {
  const current = active.find((row) => row.id === id);
  const updated = await updateEditorialPreference(client, id, {
    reinforcementCount: (current?.reinforcementCount ?? 1) + 1,
    lastSeenAt: new Date().toISOString(),
  });
  if (!updated) return null;
  console.log(
    `[editorial-learning] reinforced ${updated.id} (x${updated.reinforcementCount}): ` +
      `«${updated.rule}»`,
  );
  return {
    id: updated.id,
    rule: updated.rule,
    action,
    scope: updated.scope ?? scope,
  };
}
