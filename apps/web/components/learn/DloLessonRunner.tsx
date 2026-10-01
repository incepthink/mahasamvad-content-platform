'use client';

// /learn's DLO lesson, running: the REAL /dlo intake form (the composer and the «AI साठी सूचना»
// box — and the sidebar, which the layout renders) and then the REAL article view, wrapped in
// the sandbox API. The twin of LessonRunner (the Creative lesson), built from the same parts:
// the coach's words in a callout attached to the one control the step is about (Spotlight),
// that control lit while the rest of the page is dimmed, and the rest of the page INERT
// (useLessonGate).
//
// Nothing here renders its own imitation of a product screen. The form is DloComposer driven
// by useDloIntakeForm, the result is ArticleView — version arrows, downloads, feedback fold and
// all — and the wait between them is the generation page's own ProgressSteps and live draft.
// What changes is only what they talk to (lib/learn/dloSandboxApi.ts) and a few optional props
// that exist for this page: `onCreated`/`validate` on the form, `feedbackLesson` on the
// article view.
//
// The step shown is DERIVED from state on every render (lib/learn/dloLesson.ts), so a learner
// who wanders is re-evaluated, not stuck.

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
  createDloSandbox,
  draftText,
  SAMPLE_NOTE,
  sampleDetail,
  type DloSandbox,
  type SandboxState,
} from '../../lib/learn/dloSandbox';
import { createDloSandboxApi } from '../../lib/learn/dloSandboxApi';
import { matchArticleEdit } from '../../lib/learn/matchArticleEdit';
import {
  DLO_STAGES,
  dloAllowedSelectors,
  dloCurrentStepIndex,
  dloLessonStep,
  matchesDloSampleNote,
  type DloLessonFacts,
} from '../../lib/learn/dloLesson';
import { ArticleDraft } from '../ArticleDraft';
import { ArticleView } from '../ArticleView';
import { PageShell } from '../common/PageShell';
import { DloAiPromptBox } from '../dlo/DloAiPromptBox';
import { DloComposer } from '../dlo/DloComposer';
import { useDloIntakeForm } from '../dlo/useDloIntakeForm';
import { ProgressSteps } from '../ProgressSteps';
import { StatusChip } from '../StatusChip';
import { CoachPanel } from './CoachPanel';
import { LearnBadge } from './LearnHead';
import { LessonIntro, LessonRecap } from './LessonCallouts';
import { Spotlight } from './Spotlight';
import { useLessonGate } from './useLessonGate';

export function DloLessonRunner({
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
  const [sandbox] = useState<DloSandbox>(() => createDloSandbox(initial));
  const [api] = useState(() => createDloSandboxApi(sandbox));
  useEffect(() => () => sandbox.dispose(), [sandbox]);

  return (
    <ApiProvider api={api}>
      <DloLessonWorkspace
        started={started}
        onStart={onStart}
        sandbox={sandbox}
        onStateChange={onStateChange}
        onRestart={onRestart}
      />
    </ApiProvider>
  );
}

function DloLessonWorkspace({
  started,
  onStart,
  sandbox,
  onStateChange,
  onRestart,
}: {
  started: boolean;
  onStart: () => void;
  sandbox: DloSandbox;
  onStateChange: (state: SandboxState) => void;
  onRestart: () => void;
}) {
  const state = useSyncExternalStore(
    sandbox.subscribe,
    sandbox.getState,
    sandbox.getState,
  );
  useEffect(() => onStateChange(state), [state, onStateChange]);

  // The text rule: the practice article exists for the sample note only, so a submit carrying
  // anything else is refused in the form's own error slot. Nothing else may ride with it: the
  // practice article was written from the typed note alone, with no AI direction.
  const form = useDloIntakeForm({
    onCreated: () => {},
    validate: (request) =>
      !matchesDloSampleNote(request.notes)
        ? LEARN.dloTextRule
        : request.instructions.trim() ||
            request.recordings ||
            request.images ||
            request.documents ||
            request.links
          ? LEARN.dloSourcesOffForPractice
          : null,
  });

  // Steps the learner moved on from with पुढे.
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([]);
  const acknowledge = (id: string) =>
    setAcknowledged((ids) => (ids.includes(id) ? ids : [...ids, id]));

  // What the feedback fold reports (ArticleView → FeedbackBox), and the coach's "write the
  // example" button handed back to it.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [feedbackFill, setFeedbackFill] = useState<{
    text: string;
    seq: number;
  } | null>(null);
  // The article view unmounts while the article is rewritten, and a closing fold that is
  // unmounted reports nothing — so the fold is known to be shut from the moment a rewrite
  // starts.
  const rewriting = state.busy === 'edit';
  useEffect(() => {
    if (!rewriting) return;
    setFeedbackOpen(false);
    setFeedbackDraft('');
    // Or the box would come back after the rewrite already holding the example.
    setFeedbackFill(null);
  }, [rewriting]);
  const feedbackLesson = useMemo(
    () => ({
      onOpenChange: setFeedbackOpen,
      onDraftChange: setFeedbackDraft,
      fill: feedbackFill,
    }),
    [feedbackFill],
  );

  const noteText = form.notes;
  const noteHasSample = useMemo(
    () => matchesDloSampleNote(noteText),
    [noteText],
  );
  const facts: DloLessonFacts = {
    noteHasSample,
    noteHasOther: noteText.trim().length > 0 && !noteHasSample,
    acknowledged,
    created: state.created,
    creating: state.busy === 'create',
    feedbackOpen,
    feedbackWritten: matchArticleEdit(feedbackDraft) !== null,
    editing: rewriting,
    edited: state.versions.length >= 2,
  };
  const step = dloLessonStep(dloCurrentStepIndex(facts));
  // Before सुरू करा nothing on the page is lit or usable; the intro sits in the middle.
  const target = started ? step.target(facts) : null;
  const allowed = started ? dloAllowedSelectors(step, facts) : [];

  // A press anywhere else is swallowed; the callout shakes.
  const [nudge, setNudge] = useState(0);
  const onBlocked = useCallback(() => setNudge((n) => n + 1), []);
  useLessonGate(allowed, onBlocked);

  const [emphasis, setEmphasis] = useState(0);

  const detail = useMemo(() => sampleDetail(state), [state]);
  const draft = draftText(state);
  const onFeedbackSent = useCallback(async () => {}, []);

  const stepAction =
    step.id === 'text' && !noteHasSample ? (
      <div className="learn-coach-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => {
            form.setNotes(SAMPLE_NOTE);
            form.setError(null);
          }}
        >
          {LEARN.dloInsertSample}
        </button>
      </div>
    ) : step.id === 'describe' ? (
      <div className="learn-coach-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() =>
            setFeedbackFill((fill) => ({
              text: LEARN.dloExampleShort,
              seq: (fill?.seq ?? 0) + 1,
            }))
          }
        >
          {LEARN.dloInsertExample}
        </button>
      </div>
    ) : step.id === 'finish' ? (
      <LessonRecap lines={LEARN.dloRecap} onRestart={onRestart} />
    ) : step.next?.(facts) ? (
      <div className="learn-coach-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => acknowledge(step.id)}
        >
          {LEARN.next}
        </button>
      </div>
    ) : null;

  const coach = started ? (
    <CoachPanel
      stages={DLO_STAGES}
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
      title={LEARN.dloIntroTitle}
      lead={LEARN.dloIntroLead}
      steps={LEARN.dloIntroSteps}
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

  // Before the run exists this is /dlo's intake form exactly as it stands there (the list of
  // earlier work below it is history, not part of making one, and is left out); once created
  // it is the run's own page, as /generations/[id] shows a /dlo article.
  if (!state.created) {
    return (
      <PageShell
        background="dlo"
        title={STR.dloTitle}
        subtitle={STR.dloPageIntro}
        statusChip={<LearnBadge />}
      >
        <div className="flex flex-col gap-5">
          <DloComposer form={form} />
          {/* The wrapper only names the box for the coach. */}
          <div data-learn="dlo-ai-prompt">
            <DloAiPromptBox
              value={form.instructions}
              onChange={form.setInstructions}
              disabled={form.submitting}
            />
          </div>
        </div>
        {tour}
      </PageShell>
    );
  }

  return (
    <PageShell
      background="dlo"
      title={STR.newTitle}
      statusChip={
        <>
          <StatusChip status={detail.status} />
          <LearnBadge />
        </>
      }
    >
      {/* While the article is written or rewritten: the step list and the article appearing
          under it, as the real page shows them. One wrapper so the coach can light both. */}
      {state.busy ? (
        <div data-learn="progress">
          <ProgressSteps detail={detail} />
          <ArticleDraft text={draft} />
        </div>
      ) : (
        <ArticleView
          detail={detail}
          onFeedbackSent={onFeedbackSent}
          feedbackLesson={feedbackLesson}
        />
      )}
      {tour}
    </PageShell>
  );
}
