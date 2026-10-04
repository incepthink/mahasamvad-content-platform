// /learn/creative's autoplay: what the demo does next, as DATA.
//
// After a step's clip has been heard, the lesson does the step itself. Like the rest of the
// lesson this is a function of the current facts, never a script of events: it is asked again
// after every change, so a learner who acts first (or undoes something) is simply re-evaluated.
// When it answers null the demo waits — for a sandbox job to finish, or at the recap, for good.
//
// Almost every action is a CLICK on something already on the screen: the taught control
// itself, or the coach's own buttons (नमुना मजकूर घाला, उदाहरण लिहा, पुढे), which the runner
// marks with `data-autoplay`. So the demo shows exactly what a learner would press, and does
// it through the same handlers. The one thing no button does is place a mark at a point on
// the poster, so that is its own action.
//
// Pure. The free harness (creative.check.ts) drives it with plain objects.

import type { LessonFacts } from './creativeLesson';

export type AutoAction =
  | Readonly<{ kind: 'click'; selector: string }>
  // A red mark on the poster's headline (the pointer goes to the headline's centre).
  | Readonly<{ kind: 'mark' }>
  // Marks the demo cannot use (placed by the learner somewhere else) are removed first.
  | Readonly<{ kind: 'clear-marks' }>;

export const AUTOPLAY_SELECTORS = {
  insertSample: '[data-autoplay="insert-sample"]',
  fillNote: '[data-autoplay="fill-note"]',
  next: '[data-autoplay="next"]',
} as const;

const click = (selector: string): AutoAction => ({ kind: 'click', selector });
const learn = (id: string) => click(`[data-learn="${id}"]`);

// Steps that are only read: the demo moves on with the coach's पुढे.
const READ_STEPS = new Set(['verbatim', 'caption', 'compare', 'redo', 'download']);

export function autoplayAction(
  stepId: string,
  facts: LessonFacts,
): AutoAction | null {
  if (READ_STEPS.has(stepId)) return click(AUTOPLAY_SELECTORS.next);
  switch (stepId) {
    case 'text':
      return facts.noteHasSample
        ? click(AUTOPLAY_SELECTORS.next)
        : click(AUTOPLAY_SELECTORS.insertSample);
    case 'submit':
      return facts.creating ? null : learn('submit');
    case 'mark-mode':
      return learn('mark-button');
    case 'mark-headline':
      return facts.markerCount > 0 && !facts.headlineMarked
        ? { kind: 'clear-marks' }
        : { kind: 'mark' };
    case 'describe':
      // Only mark ① gets the example; more than one mark is refused on send.
      return facts.markerCount === 1
        ? click(AUTOPLAY_SELECTORS.fillNote)
        : { kind: 'clear-marks' };
    case 'send':
      return facts.editing ? null : learn('send');
    default:
      // 'finish', and anything unknown: nothing left to do.
      return null;
  }
}
