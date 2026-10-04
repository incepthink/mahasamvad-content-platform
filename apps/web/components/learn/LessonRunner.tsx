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
//
// Autoplay (the intro's «आपोआप पाहा», or ▶ in the coach head): each step opens with a spoken
// explanation (lib/learn/creativeNarration.ts, audio committed under public/learn/creative/
// audio/), then the lesson does the step itself with a pointer gliding to what it presses
// (lib/learn/creativeAutoplay.ts). Everything the demo does goes through what a learner would
// press — the taught control, or the coach's own buttons — so the gate and the sandbox are
// exactly as in the hands-on lesson, and the learner can step in at any moment.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { FeedbackRegion } from '@dgipr/schemas';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { ApiProvider } from '../../lib/apiContext';
import { LEARN, STR } from '../../lib/strings';
import {
  createCreativeSandbox,
  currentFile,
  HEADLINE_REGION,
  SAMPLE_NOTE,
  sampleDetail,
  type CreativeSandbox,
  type SandboxState,
} from '../../lib/learn/creativeSandbox';
import { createSandboxApi } from '../../lib/learn/sandboxApi';
import {
  autoplayAction,
  type AutoAction,
} from '../../lib/learn/creativeAutoplay';
import {
  CREATIVE_NARRATION,
  estimatedSeconds,
  narrationKey,
  WAIT_CLIPS,
} from '../../lib/learn/creativeNarration';
import narrationManifest from '../../lib/learn/creativeNarration.manifest.json';
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
import { AutoplayPointer } from './AutoplayPointer';
import { unlockLessonAudio, useLessonAutoplay } from './useLessonAutoplay';
import { useLessonGate } from './useLessonGate';

const ONLY_CREATIVE: readonly SelectableFormat[] = ['twitter'];

// Written by `pnpm --filter @dgipr/content-engine learn:narrate`; empty until then, in which
// case autoplay still runs, silently, on estimated timings.
const NARRATION_AUDIO: Readonly<
  Record<string, Readonly<{ src: string; seconds: number; textHash: string }>>
> = narrationManifest;

// The demo's mark sits inside the headline rather than on its edge.
const DEMO_MARK: FeedbackRegion = {
  x: HEADLINE_REGION.x + 0.03,
  y: HEADLINE_REGION.y + 0.03,
  width: HEADLINE_REGION.width - 0.06,
  height: HEADLINE_REGION.height - 0.06,
};

// How autoplay begins on this mount: just chosen (the click is the gesture sound needs),
// resumed after a reload (paused until the learner presses ▶), or not chosen.
export type AutoplayStart = 'playing' | 'paused' | 'off';

export function LessonRunner({
  started,
  onStart,
  initial,
  onStateChange,
  onRestart,
  autoplayStart,
  onAutoplayChange,
}: {
  // False until the learner presses सुरू करा on the intro callout; the page is shown (and
  // inert) behind it either way.
  started: boolean;
  // `autoplay`: the learner chose «आपोआप पाहा» rather than «स्वतः करा».
  onStart: (autoplay: boolean) => void;
  initial: SandboxState | undefined;
  // Every change to the sandbox, for the page to persist (a reload resumes the stage).
  onStateChange: (state: SandboxState) => void;
  onRestart: (autoplay: boolean) => void;
  autoplayStart: AutoplayStart;
  // Autoplay switched on or off, for the page to persist.
  onAutoplayChange: (on: boolean) => void;
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
        autoplayStart={autoplayStart}
        onAutoplayChange={onAutoplayChange}
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
  autoplayStart,
  onAutoplayChange,
}: {
  started: boolean;
  onStart: (autoplay: boolean) => void;
  sandbox: CreativeSandbox;
  onStateChange: (state: SandboxState) => void;
  onRestart: (autoplay: boolean) => void;
  autoplayStart: AutoplayStart;
  onAutoplayChange: (on: boolean) => void;
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
  // Autoplay's own hand on the poster: a red mark on the headline, or the marks removed.
  const [placeMark, setPlaceMark] = useState<{
    region: FeedbackRegion;
    seq: number;
  } | null>(null);
  const [clearMarks, setClearMarks] = useState<{ seq: number } | null>(null);

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

  // ---------- autoplay ----------
  const clipKey = started ? narrationKey(step.id, facts) : null;
  const clipAudio = clipKey ? NARRATION_AUDIO[clipKey] : undefined;
  const clip = clipKey
    ? {
        src: clipAudio?.src,
        fallbackSeconds:
          clipAudio?.seconds ?? estimatedSeconds(CREATIVE_NARRATION[clipKey]),
        wait: WAIT_CLIPS.has(clipKey),
      }
    : null;
  const locate = useCallback((action: AutoAction) => {
    if (action.kind === 'click') {
      const element = document.querySelector(action.selector);
      return element ? { element } : null;
    }
    const poster = document.querySelector('[data-learn="poster"]');
    if (!poster) return null;
    return action.kind === 'mark'
      ? { element: poster, region: DEMO_MARK }
      : { element: poster };
  }, []);
  const perform = useCallback((action: AutoAction) => {
    if (action.kind === 'click') {
      document.querySelector<HTMLElement>(action.selector)?.click();
    } else if (action.kind === 'mark') {
      setPlaceMark((m) => ({ region: DEMO_MARK, seq: (m?.seq ?? 0) + 1 }));
    } else {
      setClearMarks((c) => ({ seq: (c?.seq ?? 0) + 1 }));
    }
  }, []);
  const auto = useLessonAutoplay({
    initialPlaying: started && autoplayStart === 'playing',
    clipKey,
    clip,
    factsKey: step.id + JSON.stringify(facts),
    nextAction: () => autoplayAction(step.id, facts),
    locate,
    perform,
    stopAtEnd: 'finish',
  });
  // Shown once autoplay has been chosen in this lesson (it may be paused now).
  const [autoEngaged, setAutoEngaged] = useState(autoplayStart !== 'off');
  useEffect(() => {
    if (auto.playing) setAutoEngaged(true);
  }, [auto.playing]);
  // Persist ▶/⏸ — but not the paused state a reload starts in, or a second reload would
  // forget that the learner had chosen autoplay.
  const persistedOnce = useRef(false);
  useEffect(() => {
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    onAutoplayChange(auto.playing);
  }, [auto.playing, onAutoplayChange]);

  const restart = () => {
    if (auto.playing) unlockLessonAudio();
    onRestart(auto.playing);
  };

  const autoplayTools = started ? (
    <>
      <button
        type="button"
        className={
          'icon-btn icon-btn-sm' + (auto.playing ? ' is-autoplaying' : '')
        }
        data-autoplay="toggle"
        title={auto.playing ? LEARN.autoplayPause : LEARN.autoplayPlay}
        aria-label={auto.playing ? LEARN.autoplayPause : LEARN.autoplayPlay}
        aria-pressed={auto.playing}
        onClick={auto.toggle}
      >
        {auto.playing ? (
          <Pause size={15} aria-hidden="true" />
        ) : (
          <Play size={15} aria-hidden="true" />
        )}
      </button>
      {autoEngaged ? (
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          data-autoplay="mute"
          title={auto.muted ? LEARN.autoplayUnmute : LEARN.autoplayMute}
          aria-label={auto.muted ? LEARN.autoplayUnmute : LEARN.autoplayMute}
          aria-pressed={auto.muted}
          onClick={auto.toggleMute}
        >
          {auto.muted ? (
            <VolumeX size={15} aria-hidden="true" />
          ) : (
            <Volume2 size={15} aria-hidden="true" />
          )}
        </button>
      ) : null}
    </>
  ) : null;

  const autoplayStatus = !started ? null : auto.playing ? (
    <p className="learn-autoplay-status">
      <span className="learn-autoplay-dot" aria-hidden="true" />
      {LEARN.autoplayOn}
    </p>
  ) : autoEngaged && step.id !== 'finish' ? (
    <div className="learn-autoplay-status is-paused">
      <span>{LEARN.autoplayPaused}</span>
      <button
        type="button"
        className="btn btn-primary btn-small"
        data-autoplay="resume"
        onClick={auto.toggle}
      >
        <Play size={15} aria-hidden="true" />
        {LEARN.autoplayResume}
      </button>
    </div>
  ) : null;

  const nextButton = step.next?.(facts) ? (
    <button
      type="button"
      className="btn btn-primary btn-small"
      data-autoplay="next"
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
          data-autoplay="insert-sample"
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
          data-autoplay="fill-note"
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
      <LessonRecap lines={LEARN.recap} onRestart={restart} />
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
      onRestart={restart}
      tools={autoplayTools}
      status={autoplayStatus}
    >
      {stepAction}
    </CoachPanel>
  ) : (
    <LessonIntro
      title={LEARN.introTitle}
      lead={LEARN.introLead}
      steps={LEARN.introSteps}
      onStart={() => onStart(false)}
      onAutoplay={() => {
        // Inside the click: the one gesture the browser needs before it will play sound.
        unlockLessonAudio();
        onStart(true);
      }}
    />
  );

  const tour = (
    <>
      <Spotlight
        target={target}
        stepKey={started ? step.id : 'intro'}
        emphasis={emphasis}
        nudge={nudge}
      >
        {coach}
      </Spotlight>
      <AutoplayPointer pointer={auto.pointer} />
    </>
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
          placeMark={placeMark}
          clearMarks={clearMarks}
        />
      )}
      {tour}
    </PageShell>
  );
}
