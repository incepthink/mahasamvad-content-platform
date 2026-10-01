// /learn's DLO lesson — "make a news article from meeting notes and change it" — as DATA.
//
// Four stages, thirteen steps, on the shared machinery in ./lesson.ts: every step says what
// the learner does and when it is DONE, as a function of the current state, and the runner
// shows the first step that is not done yet. Every `done` counts later progress as covering it
// — the feedback fold is closed again the moment a change is sent (the article view unmounts
// while the article is rewritten), and that must not send the coach back to "open the fold".
//
// What the learner DOES: puts the sample note in, sends it, and asks for a change through
// «बातमीत बदल हवा आहे?». What the coach only SHOWS, with पुढे (lit, inert, explained): the
// source tools, the AI-direction box, the article and its source note, the version arrows, the
// downloads, and where the article goes next.
//
// Pure. The free harness (dlo.check.ts) drives it with plain objects.

import { LEARN } from '../strings';
import { SAMPLE_NOTE } from './dloSandbox';
import {
  acked,
  allowedSelectors as allowedFor,
  firstUndoneStep,
  sampleTextMatcher,
  stepAt,
  type LessonStage,
  type LessonStep as Step,
} from './lesson';

export type DloLessonFacts = Readonly<{
  noteHasSample: boolean;
  // The box holds text, but not the sample's.
  noteHasOther: boolean;
  acknowledged: readonly string[];
  created: boolean;
  creating: boolean;
  feedbackOpen: boolean;
  // The feedback box asks for a change the practice has a result for.
  feedbackWritten: boolean;
  editing: boolean;
  edited: boolean;
}>;

export type DloLessonStep = Step<DloLessonFacts>;

// The whole feedback fold — its summary, the quick suggestions, the box and «बदल करा».
const FEEDBACK_FOLD = '[data-learn="article-feedback"]';

export const DLO_LESSON_STEPS: readonly DloLessonStep[] = [
  {
    id: 'text',
    stage: 1,
    instruction: (f) =>
      f.noteHasSample
        ? LEARN.dloStepTextReady
        : f.noteHasOther
          ? LEARN.dloTextRule
          : LEARN.dloStepText,
    target: () => ({ learn: 'dlo-note' }),
    next: (f) => f.noteHasSample,
    done: (f) => (f.noteHasSample && acked(f, 'text')) || f.created,
  },
  {
    // Shown, not used: the practice note is typed text alone.
    id: 'sources',
    stage: 1,
    instruction: () => LEARN.dloStepSourcesInfo,
    target: () => ({ learn: 'dlo-sources' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'sources') || f.created,
  },
  {
    id: 'ai-prompt',
    stage: 1,
    instruction: () => LEARN.dloStepAiPromptInfo,
    target: () => ({ learn: 'dlo-ai-prompt' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'ai-prompt') || f.created,
  },
  {
    id: 'submit',
    stage: 1,
    instruction: (f) =>
      f.creating ? LEARN.dloStepCreating : LEARN.dloStepSubmit,
    target: (f) => ({ learn: f.creating ? 'progress' : 'dlo-submit' }),
    allow: (f) => (f.creating ? [] : ['[data-learn="dlo-submit"]']),
    done: (f) => f.created && !f.creating,
  },
  {
    id: 'article',
    stage: 2,
    instruction: () => LEARN.dloStepArticleInfo,
    target: () => ({ learn: 'article-body' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'article') || f.editing || f.edited,
  },
  {
    id: 'note',
    stage: 2,
    instruction: () => LEARN.dloStepNoteInfo,
    target: () => ({ learn: 'article-note' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'note') || f.editing || f.edited,
  },
  {
    id: 'open-feedback',
    stage: 3,
    instruction: () => LEARN.dloStepOpenFeedback,
    target: () => ({ learn: 'article-feedback' }),
    done: (f) => f.feedbackOpen || f.editing || f.edited,
  },
  {
    id: 'describe',
    stage: 3,
    instruction: () => LEARN.dloStepDescribe,
    target: () => ({ learn: 'article-feedback' }),
    // «बदल करा» works here too, so a request the practice cannot show gets its refusal — but
    // it is taught on the next step.
    allow: () => [FEEDBACK_FOLD],
    done: (f) => f.feedbackWritten || f.editing || f.edited,
  },
  {
    id: 'send',
    stage: 3,
    instruction: (f) => (f.editing ? LEARN.dloStepEditing : LEARN.dloStepSend),
    target: (f) =>
      f.editing
        ? { learn: 'progress' }
        : { learn: 'article-feedback-send', also: ['article-feedback-text'] },
    // The box stays editable: the step can arrive while the learner is still typing.
    allow: (f) => (f.editing ? [] : [FEEDBACK_FOLD]),
    done: (f) => f.edited && !f.editing,
  },
  {
    // Shown, not used: stepping back through versions is explained, the learner moves on.
    id: 'versions',
    stage: 4,
    instruction: () => LEARN.dloStepVersionsInfo,
    target: () => ({ learn: 'article-versions' }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'versions'),
  },
  {
    id: 'download',
    stage: 4,
    instruction: () => LEARN.dloStepDownloadInfo,
    target: () => ({ learn: 'article-download', also: ['article-copy'] }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'download'),
  },
  {
    id: 'onward',
    stage: 4,
    instruction: () => LEARN.dloStepOnwardInfo,
    target: () => ({ learn: 'article-translate', also: ['article-creative'] }),
    allow: () => [],
    next: () => true,
    done: (f) => acked(f, 'onward'),
  },
  {
    id: 'finish',
    stage: 4,
    instruction: () => LEARN.dloStepFinish,
    target: () => null,
    // Reading the recap is the step; it has no state to reach.
    done: () => false,
  },
];

export const DLO_STAGES: readonly LessonStage[] = [
  { id: 1, label: LEARN.dloStage1 },
  { id: 2, label: LEARN.dloStage2 },
  { id: 3, label: LEARN.dloStage3 },
  { id: 4, label: LEARN.dloStage4 },
];

export function dloLessonStep(index: number): DloLessonStep {
  return stepAt(DLO_LESSON_STEPS, index);
}

export function dloAllowedSelectors(
  step: DloLessonStep,
  facts: DloLessonFacts,
): readonly string[] {
  return allowedFor(step, facts);
}

export function dloCurrentStepIndex(facts: DloLessonFacts): number {
  return firstUndoneStep(DLO_LESSON_STEPS, facts);
}

// ---------- the text rule ----------

export const matchesDloSampleNote = sampleTextMatcher(SAMPLE_NOTE);
