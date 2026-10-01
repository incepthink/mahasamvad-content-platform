// /learn's first lesson — "make a Creative and change it" — as DATA.
//
// Four stages, twelve steps. Every step says what the learner does and when it is DONE, and
// "done" is a function of the current state, never an event: the runner shows the first step
// that is not done yet. A learner who wanders (unmarks, restores a version, reloads) is
// re-evaluated rather than stuck on a step the screen no longer matches — which is also why
// every `done` counts later progress as covering it (marking mode is turned OFF again the
// moment an edit is sent, and that must not send the coach back to "turn on marking").
//
// The step machinery is shared with the other lessons (./lesson.ts); what is here is this
// lesson's own facts, steps, stages and checks.
//
// Pure. The free harness (creative.check.ts) drives it with plain objects.

import type { FeedbackRegion } from '@dgipr/schemas';
import { LEARN } from '../strings';
import { HEADLINE_REGION, SAMPLE_NOTE } from './creativeSandbox';
import {
  acked,
  allowedSelectors as allowedFor,
  firstUndoneStep,
  sampleTextMatcher,
  stepAt,
  type LessonStage,
  type LessonStep as Step,
} from './lesson';

export type { LessonTarget, StageId } from './lesson';

export type LessonFacts = Readonly<{
  noteHasSample: boolean;
  // The box holds text, but not the sample's.
  noteHasOther: boolean;
  // Steps the learner has read and moved on from with पुढे (the ones that only SHOW a
  // control — the two Creative opt-ins, the version strip, the redo and download buttons — and
  // the text step,
  // which keeps the inserted text lit until the learner says so).
  acknowledged: readonly string[];
  created: boolean;
  creating: boolean;
  marking: boolean;
  markerCount: number;
  headlineMarked: boolean;
  // Mark ①'s note asks for an edit the practice has a render for.
  noteWritten: boolean;
  editing: boolean;
  edited: boolean;
}>;

export type LessonStep = Step<LessonFacts>;

export const LESSON_STEPS: readonly LessonStep[] = [
  {
    id: 'text',
    stage: 1,
    instruction: (f) =>
      f.noteHasSample
        ? LEARN.stepTextReady
        : f.noteHasOther
          ? LEARN.textRule
          : LEARN.stepText,
    target: () => ({ learn: 'note' }),
    next: (f) => f.noteHasSample,
    done: (f) => (f.noteHasSample && acked(f, 'text')) || f.created,
  },
  {
    // Shown, not ticked: the practice poster was made with both options off.
    id: 'verbatim',
    stage: 1,
    instruction: () => LEARN.stepVerbatimInfo,
    target: () => ({ learn: 'check-verbatim' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'verbatim') || f.created,
  },
  {
    id: 'caption',
    stage: 1,
    instruction: () => LEARN.stepCaptionInfo,
    target: () => ({ learn: 'check-caption' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'caption') || f.created,
  },
  {
    id: 'submit',
    stage: 1,
    instruction: (f) => (f.creating ? LEARN.stepCreating : LEARN.stepSubmit),
    target: (f) => ({ learn: f.creating ? 'progress' : 'submit' }),
    allow: (f) => (f.creating ? [] : ['[data-learn="submit"]']),
    done: (f) => f.created && !f.creating,
  },
  {
    id: 'mark-mode',
    stage: 2,
    instruction: () => LEARN.stepMarkMode,
    target: () => ({ learn: 'mark-button' }),
    done: (f) => f.marking || f.headlineMarked || f.editing || f.edited,
  },
  {
    id: 'mark-headline',
    stage: 2,
    instruction: (f) =>
      f.markerCount > 0 ? LEARN.stepMarkWrongPlace : LEARN.stepMarkHeadline,
    target: () => ({ learn: 'poster', region: HEADLINE_REGION }),
    // The whole poster takes the mark (a click beside the headline is refused with a reason,
    // not ignored), and a wrong mark is removed with its row's ✕.
    allow: () => ['[data-learn="poster"]', '.marker-note-row'],
    done: (f) => f.headlineMarked || f.editing || f.edited,
  },
  {
    id: 'describe',
    stage: 3,
    instruction: () => LEARN.stepDescribe,
    target: () => ({ learn: 'marker-note' }),
    // «बदल करा» works here too, so a note the practice cannot show gets its refusal and the
    // example — but it is taught on the next step.
    allow: () => [
      '.marker-note-row',
      '[data-learn="send"]',
      '[data-learn="use-example"]',
    ],
    done: (f) => f.noteWritten || f.editing || f.edited,
  },
  {
    id: 'send',
    stage: 3,
    instruction: (f) => (f.editing ? LEARN.stepEditing : LEARN.stepSend),
    target: (f) =>
      f.editing
        ? { learn: 'poster' }
        : { learn: 'send', also: ['marker-note'] },
    // The note stays editable: the step can arrive while the learner is still typing.
    allow: (f) =>
      f.editing
        ? []
        : [
            '.marker-note-row',
            '[data-learn="send"]',
            '[data-learn="use-example"]',
          ],
    done: (f) => f.edited && !f.editing,
  },
  {
    // Shown, not used: opening an older version is explained, the learner moves on with पुढे.
    id: 'compare',
    stage: 4,
    instruction: () => LEARN.stepCompareInfo,
    target: () => ({ learn: 'versions' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'compare'),
  },
  {
    id: 'redo',
    stage: 4,
    instruction: () => LEARN.stepRedoInfo,
    target: () => ({ learn: 'redo' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'redo'),
  },
  {
    id: 'download',
    stage: 4,
    instruction: () => LEARN.stepDownloadInfo,
    target: () => ({ learn: 'download' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'download'),
  },
  {
    id: 'finish',
    stage: 4,
    instruction: () => LEARN.stepFinish,
    target: () => null,
    // Reading the recap is the step; it has no state to reach.
    done: () => false,
  },
];

export const STAGES: readonly LessonStage[] = [
  { id: 1, label: LEARN.stage1 },
  { id: 2, label: LEARN.stage2 },
  { id: 3, label: LEARN.stage3 },
  { id: 4, label: LEARN.stage4 },
];

// A step by index, clamped.
export function lessonStep(index: number): LessonStep {
  return stepAt(LESSON_STEPS, index);
}

// What may be pressed, typed into or dragged on during a step (see LessonStep.allow).
export function allowedSelectors(
  step: LessonStep,
  facts: LessonFacts,
): readonly string[] {
  return allowedFor(step, facts);
}

export function currentStepIndex(facts: LessonFacts): number {
  return firstUndoneStep(LESSON_STEPS, facts);
}

// ---------- the text rule ----------

export const matchesSampleText = sampleTextMatcher(SAMPLE_NOTE);

// ---------- the headline check ----------

// A mark counts as "on the headline" when its centre falls inside the headline (with a little
// margin — a click just past a letter's edge is still aimed at it), or when most of the mark
// lies over it. A box drawn round the whole poster does neither, and is refused: the pencil
// says "change the thing HERE".
const HEADLINE_MARGIN = 0.03;

export function marksHeadline(region: FeedbackRegion): boolean {
  const h = HEADLINE_REGION;
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const centreInside =
    cx >= h.x - HEADLINE_MARGIN &&
    cx <= h.x + h.width + HEADLINE_MARGIN &&
    cy >= h.y - HEADLINE_MARGIN &&
    cy <= h.y + h.height + HEADLINE_MARGIN;
  if (centreInside) return true;
  const ix = Math.max(
    0,
    Math.min(region.x + region.width, h.x + h.width) - Math.max(region.x, h.x),
  );
  const iy = Math.max(
    0,
    Math.min(region.y + region.height, h.y + h.height) -
      Math.max(region.y, h.y),
  );
  const area = region.width * region.height;
  return area > 0 && (ix * iy) / area >= 0.5;
}
