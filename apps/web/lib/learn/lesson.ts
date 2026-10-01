// What every /learn lesson is made of, shared so the lessons cannot drift apart: a lesson is a
// list of steps, each saying what the learner does and when it is DONE, and "done" is a
// function of the current state, never an event. The runner shows the first step that is not
// done yet, so a learner who wanders (closes a fold, reloads) is re-evaluated rather than
// stuck on a step the screen no longer matches.
//
// Each lesson supplies its own `Facts` (what its screen can report) and its own steps; this
// module is the part that is the same for all of them: the step shape, which controls stay
// usable during a step, which step is current, and the "is this the sample text?" test.
//
// Pure. The lessons' free harnesses drive it with plain objects.

import type { FeedbackRegion } from '@dgipr/schemas';

export type StageId = 1 | 2 | 3 | 4;

export type LessonStage = Readonly<{ id: StageId; label: string }>;

// What the coach points at: an element carrying `data-learn="…"`, or a region of one (a
// poster's headline is part of an image, not an element of its own). `also` names further
// elements lit (and made usable) together with it.
export type LessonTarget = Readonly<{
  learn: string;
  region?: FeedbackRegion;
  also?: readonly string[];
}>;

// The facts every lesson reports, whatever else its screen knows.
export type BaseFacts = Readonly<{
  // Steps the learner has read and moved on from with पुढे.
  acknowledged: readonly string[];
}>;

export type LessonStep<F extends BaseFacts> = Readonly<{
  id: string;
  stage: StageId;
  instruction: (facts: F) => string;
  target: (facts: F) => LessonTarget | null;
  // CSS selectors that stay usable during this step — the COMPLETE list when given; left out,
  // the target (and its `also`) is what works. Everything else on the page is inert
  // (components/learn/useLessonGate.ts).
  allow?: (facts: F) => readonly string[];
  // True while the coach offers पुढे: the step is only read, and the learner moves on.
  next?: (facts: F) => boolean;
  done: (facts: F) => boolean;
}>;

export const acked = (facts: BaseFacts, id: string) =>
  facts.acknowledged.includes(id);

// A step by index, clamped.
export function stepAt<F extends BaseFacts>(
  steps: readonly LessonStep<F>[],
  index: number,
): LessonStep<F> {
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  const step = steps[clamped];
  if (!step) throw new Error('The lesson has no steps.');
  return step;
}

// What may be pressed, typed into or dragged on during a step (see LessonStep.allow).
export function allowedSelectors<F extends BaseFacts>(
  step: LessonStep<F>,
  facts: F,
): readonly string[] {
  if (step.allow) return step.allow(facts);
  const target = step.target(facts);
  if (!target) return [];
  return [target.learn, ...(target.also ?? [])].map(
    (learn) => `[data-learn="${learn}"]`,
  );
}

export function firstUndoneStep<F extends BaseFacts>(
  steps: readonly LessonStep<F>[],
  facts: F,
): number {
  const index = steps.findIndex((step) => !step.done(facts));
  return index === -1 ? steps.length - 1 : index;
}

// ---------- the text rule ----------

// Whitespace and punctuation carry no meaning for "is this the sample text?", and a pasted
// copy often differs in exactly those (a lost blank line, curly quotes, a trailing full stop).
function comparable(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\s.,:;!?'"‘’“”()[\]{}\-–—।॥/\\*#_]+/g, '');
}

function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > cap) return cap + 1;
    previous = row;
  }
  return previous[b.length] ?? cap + 1;
}

// A test for "is this the lesson's sample text?". A few characters' slack: a learner who fixes
// a typo or trims a word is still using the sample. A different note is hundreds of edits away.
export function sampleTextMatcher(sample: string): (text: string) => boolean {
  const target = comparable(sample);
  const tolerance = Math.max(12, Math.round(target.length * 0.05));
  return (text: string) => {
    const candidate = comparable(text);
    if (candidate.length === 0) return false;
    return editDistance(candidate, target, tolerance) <= tolerance;
  };
}
