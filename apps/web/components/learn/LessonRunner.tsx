'use client';

// /learn's first lesson, running: the REAL Creative and Social page (composer, image brief,
// template picker — and the sidebar, which the layout renders) and then the REAL social
// poster card, wrapped in the sandbox API.
//
// The coach is not a column of its own. Its words sit in a callout attached to the one
// control the current step is about; that control is lit while the rest of the page is
// dimmed, and the rest of the page is INERT (useLessonGate) — so the screen looks exactly
// like the real one, and only the button being taught works.
//
// Nothing here renders its own imitation of a product screen. The composer is NoteComposer
// driven by useCreateForm, the result is SocialPostView — marker tool, marker notes, version
// strip and all. What changes is only what they talk to (lib/learn/sandboxApi.ts) and a few
// optional props that exist for this page: `onCreated`/`validate` on the form,
// `beforeSendMarks`/`onAnnotationChange` on the card, `learn` on the two checkboxes.
//
// The step shown is DERIVED from state on every render (lib/learn/creativeLesson.ts), so a
// learner who wanders is re-evaluated, not stuck.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiProvider } from '../../lib/apiContext';
import { LEARN, STR } from '../../lib/strings';
import {
  createCreativeSandbox,
  currentFile,
  SAMPLE_NOTE,
  sampleDetail,
  type CreativeSandbox,
  type SandboxState,
} from '../../lib/learn/creativeSandbox';
import { createSandboxApi } from '../../lib/learn/sandboxApi';
import { matchScriptedEdit } from '../../lib/learn/matchScriptedEdit';
import {
  allowedSelectors,
  currentStepIndex,
  lessonStep,
  marksHeadline,
  matchesSampleText,
  STAGES,
  type LessonFacts,
} from '../../lib/learn/creativeLesson';
import { PageShell } from '../common/PageShell';
import { ImagePromptBox } from '../media-room/ImagePromptBox';
import { NoteComposer } from '../media-room/NoteComposer';
import { TemplateSelect } from '../media-room/TemplateSelect';
import { useCreateForm } from '../media-room/useCreateForm';
import type { SelectableFormat } from '../media-room/formats';
import { SocialPostView, type MarksRefusal } from '../SocialPostView';
import type { PosterMarkerDraft } from '../PosterAnnotator';
import { StatusChip } from '../StatusChip';
import { TaskProgressBar } from '../TaskProgressBar';
import { CoachPanel } from './CoachPanel';
import { LearnBadge } from './LearnHead';
import { LessonIntro, LessonRecap } from './LessonCallouts';
import { Spotlight } from './Spotlight';
import { useLessonGate } from './useLessonGate';

const ONLY_CREATIVE: readonly SelectableFormat[] = ['twitter'];

export function LessonRunner({
  started,
  onStart,
  initial,
  onStateChange,
  onRestart,
}: {
  // False until the learner presses सुरू करा on the intro callout; the page is shown (and
  // inert) behind it either way.
  started: boolean;
  onStart: () => void;
  initial: SandboxState | undefined;
  // Every change to the sandbox, for the page to persist (a reload resumes the stage).
  onStateChange: (state: SandboxState) => void;
  onRestart: () => void;
}) {
  // Created once per mount; the page remounts this component to start over.
  const [sandbox] = useState<CreativeSandbox>(() =>
    createCreativeSandbox(initial),
  );
  const [api] = useState(() => createSandboxApi(sandbox));
  useEffect(() => () => sandbox.dispose(), [sandbox]);

  return (
    <ApiProvider api={api}>
      <LessonWorkspace
        started={started}
        onStart={onStart}
        sandbox={sandbox}
        onStateChange={onStateChange}
        onRestart={onRestart}
      />
    </ApiProvider>
  );
}

function LessonWorkspace({
  started,
  onStart,
  sandbox,
  onStateChange,
  onRestart,
}: {
  started: boolean;
  onStart: () => void;
  sandbox: CreativeSandbox;
  onStateChange: (state: SandboxState) => void;
  onRestart: () => void;
}) {
  const state = useSyncExternalStore(
    sandbox.subscribe,
    sandbox.getState,
    sandbox.getState,
  );
  useEffect(() => onStateChange(state), [state, onStateChange]);

  // The text rule: the practice poster exists for the sample text only, so a submit carrying
  // anything else is refused in the form's own error slot. The two opt-ins must be off too:
  // the practice poster was made with the AI writing its text, and it comes with no caption.
  const form = useCreateForm({
    onCreated: () => {},
    validate: (request) =>
      !matchesSampleText(request.note)
        ? LEARN.textRule
        : request.generateCaption || request.designMode === 'fresh_verbatim'
          ? LEARN.optionsOffForPractice
          : null,
  });

  // Steps the learner moved on from with पुढे (see LessonFacts.acknowledged).
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([]);
  const acknowledge = (id: string) =>
    setAcknowledged((ids) => (ids.includes(id) ? ids : [...ids, id]));

  // The coach's "write the example" button, handed to the card to fill mark ①.
  const [markNoteFill, setMarkNoteFill] = useState<{
    note: string;
    seq: number;
  } | null>(null);

  const [annotation, setAnnotation] = useState<{
    marking: boolean;
    markers: readonly PosterMarkerDraft[];
  }>({ marking: false, markers: [] });
  const onAnnotationChange = useCallback(
    (next: { marking: boolean; markers: readonly PosterMarkerDraft[] }) =>
      setAnnotation(next),
    [],
  );

  // The practice can only show a headline edit it has a render for — refused where a real
  // refusal would appear, with the example offered as a button rather than typed over.
  const beforeSendMarks = useCallback(
    (markers: readonly PosterMarkerDraft[]): MarksRefusal | null => {
      const [first] = markers;
      if (!first || markers.length !== 1 || !marksHeadline(first.region)) {
        return LEARN.markHeadlineOnly;
      }
      if (currentFile(sandbox.getState()) !== 'v1') {
        return LEARN.editOriginalOnly;
      }
      if (!matchScriptedEdit(first.note)) {
        return {
          message: LEARN.cannotSimulate,
          suggestion: { label: LEARN.useExample, note: LEARN.exampleSize },
        };
      }
      return null;
    },
    [sandbox],
  );

  const noteText = form.note;
  const noteHasSample = useMemo(() => matchesSampleText(noteText), [noteText]);
  const facts: LessonFacts = {
    noteHasSample,
    noteHasOther: noteText.trim().length > 0 && !noteHasSample,
    acknowledged,
    created: state.created,
    creating: state.busy === 'create',
    marking: annotation.marking,
    markerCount: annotation.markers.length,
    headlineMarked:
      annotation.markers.length > 0 &&
      annotation.markers.every((m) => marksHeadline(m.region)),
    noteWritten:
      annotation.markers.length === 1 &&
      matchScriptedEdit(annotation.markers[0]?.note ?? '') !== null,
    editing: state.busy === 'edit',
    edited: state.versions.length >= 2,
  };
  const stepIndex = currentStepIndex(facts);

  const step = lessonStep(stepIndex);
  // Before सुरू करा nothing on the page is lit or usable; the intro sits in the middle.
  const target = started ? step.target(facts) : null;
  const allowed = started ? allowedSelectors(step, facts) : [];

  // A press anywhere else is swallowed; the callout shakes.
  const [nudge, setNudge] = useState(0);
  const onBlocked = useCallback(() => setNudge((n) => n + 1), []);
  useLessonGate(allowed, onBlocked);

  const [emphasis, setEmphasis] = useState(0);

  const detail = useMemo(() => sampleDetail(state), [state]);
  const onChanged = useCallback(async () => {}, []);

  const nextButton = step.next?.(facts) ? (
    <button
      type="button"
      className="btn btn-primary btn-small"
      onClick={() => acknowledge(step.id)}
    >
      {LEARN.next}
    </button>
  ) : null;

  const stepAction =
    step.id === 'text' && !noteHasSample ? (
      <div className="learn-coach-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => {
            form.setNote(SAMPLE_NOTE);
            form.setError(null);
          }}
        >
          {LEARN.insertSample}
        </button>
      </div>
    ) : step.id === 'describe' ? (
      <div className="learn-coach-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() =>
            setMarkNoteFill((fill) => ({
              note: LEARN.exampleSize,
              seq: (fill?.seq ?? 0) + 1,
            }))
          }
        >
          {LEARN.insertExampleNote}
        </button>
      </div>
    ) : step.id === 'finish' ? (
      <LessonRecap lines={LEARN.recap} onRestart={onRestart} />
    ) : nextButton ? (
      <div className="learn-coach-actions">{nextButton}</div>
    ) : null;

  const coach = started ? (
    <CoachPanel
      stages={STAGES}
      stage={step.stage}
      instruction={step.instruction(facts)}
      canShowMe={target !== null}
      onShowMe={() => setEmphasis((n) => n + 1)}
      onRestart={onRestart}
    >
      {stepAction}
    </CoachPanel>
  ) : (
    <LessonIntro
      title={LEARN.introTitle}
      lead={LEARN.introLead}
      steps={LEARN.introSteps}
      onStart={onStart}
    />
  );

  const tour = (
    <Spotlight
      target={target}
      stepKey={started ? step.id : 'intro'}
      emphasis={emphasis}
      nudge={nudge}
    >
      {coach}
    </Spotlight>
  );

  // Before the run exists this is the Creative and Social page exactly as it stands at "/";
  // once created it is the run's own page, as /generations/[id] shows it.
  if (!state.created) {
    return (
      <PageShell
        background="home"
        title={STR.mediaRoomTitle}
        subtitle={STR.mediaRoomIntro}
        statusChip={<LearnBadge />}
      >
        <div className="flex flex-col gap-5">
          <NoteComposer form={form} onlyFormats={ONLY_CREATIVE} />
          {form.isSocial ? <ImagePromptBox form={form} /> : null}
          <TemplateSelect
            category={form.pickerCategory}
            value={form.reference}
            onChange={form.setReference}
            isSocial={form.isSocial || form.isCarousel}
          />
        </div>
        {tour}
      </PageShell>
    );
  }

  return (
    <PageShell
      background="creative"
      title={STR.newTitle}
      statusChip={
        <>
          <StatusChip status={detail.status} />
          <LearnBadge />
        </>
      }
    >
      {state.busy === 'create' ? (
        <section className="card" aria-live="polite" data-learn="progress">
          <h2>{STR.progressTitle}</h2>
          <p className="hint">{STR.progressHint}</p>
          <div style={{ marginTop: 16 }}>
            <TaskProgressBar status={detail.status} step={detail.step} />
          </div>
        </section>
      ) : (
        <SocialPostView
          detail={detail}
          onChanged={onChanged}
          busy={state.busy === 'edit'}
          beforeSendMarks={beforeSendMarks}
          onAnnotationChange={onAnnotationChange}
          fillFirstMarkNote={markNoteFill}
        />
      )}
      {tour}
    </PageShell>
  );
}
