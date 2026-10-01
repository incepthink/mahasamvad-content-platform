// Assertions for /learn's DLO lesson. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/learn/dlo.check.ts
//
// (from a workspace that has tsx — packages/content-engine does.)
//
// `fetch` is replaced with a thrower for the whole run: the sandbox API promises no network,
// and this is the free half of that proof (the browser run asserts zero requests too).

import { GenerationDetailSchema } from '@dgipr/schemas';
import { REAL_API } from '../apiContext';
import {
  CREATE_DONE_MS,
  EDIT_DONE_MS,
  SAMPLE_NOTE,
  createDloSandbox,
  draftText,
  freshSandboxState,
  parseSandboxState,
  sampleDetail,
  settle,
  streamPrefix,
  articleText,
} from './dloSandbox';
import { createDloSandboxApi } from './dloSandboxApi';
import { createSandboxApi } from './sandboxApi';
import { createCreativeSandbox } from './creativeSandbox';
import { matchArticleEdit } from './matchArticleEdit';
import {
  DLO_LESSON_STEPS,
  DLO_STAGES,
  dloCurrentStepIndex,
  matchesDloSampleNote,
  type DloLessonFacts,
} from './dloLesson';
import { STAGES } from './creativeLesson';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL ${name}`, detail ?? '');
  }
}

globalThis.fetch = (() => {
  throw new Error('The sandbox made a network request.');
}) as typeof fetch;

// A scheduler the harness advances by hand.
function fakeClock() {
  let now = 0;
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    scheduler: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        queue.push({ at: now + ms, fn, id });
        return id;
      },
      clear: (handle: unknown) => {
        const i = queue.findIndex((q) => q.id === handle);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    advance(ms: number) {
      now += ms;
      queue.sort((a, b) => a.at - b.at);
      while (queue[0] && queue[0].at <= now) queue.shift()!.fn();
    },
  };
}

async function refused(promise: Promise<unknown>): Promise<boolean> {
  return promise.then(
    () => false,
    () => true,
  );
}

async function main() {
  // ---------- the detail parses against the real schema ----------
  const v1 = settle({
    ...freshSandboxState(),
    created: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    busy: 'create',
  });
  const edited = settle({
    ...v1,
    busy: 'edit',
    pendingEdit: { file: 'short', feedback: 'आणखी थोडक्यात लिहा' },
  });
  const creating = {
    ...freshSandboxState(),
    created: true,
    status: 'running' as const,
    step: 'draft' as const,
    busy: 'create' as const,
  };
  for (const [name, state] of [
    ['creating', creating],
    ['v1', v1],
    ['edited', edited],
  ] as const) {
    const parsed = GenerationDetailSchema.safeParse(sampleDetail(state));
    check(`${name} detail parses`, parsed.success, parsed.error?.issues);
  }
  check(
    'no article while it is first written',
    sampleDetail(creating).article === null,
  );
  check(
    'v1 shows the first article',
    sampleDetail(v1).article === articleText('v1'),
  );
  check(
    'one article is not a history (no arrows)',
    sampleDetail(v1).articleVersions.length === 1,
  );
  const meta = sampleDetail(edited).articleVersions;
  check(
    "the edit is version 2, current, with the learner's words",
    meta.length === 2 &&
      meta[1]?.current === true &&
      meta[0]?.current === false &&
      meta[1]?.feedback === 'आणखी थोडक्यात लिहा' &&
      meta[0]?.feedback === null,
  );
  check(
    'the row shows the revision',
    sampleDetail(edited).article === articleText('short'),
  );
  check(
    'a /dlo run renders no poster',
    sampleDetail(v1).outputType === 'article' &&
      sampleDetail(v1).posterUrl === null,
  );

  // ---------- the three sample articles ----------
  for (const file of ['v1', 'short'] as const) {
    const text = articleText(file);
    check(`${file} is written`, text.trim().length > 200, text.length);
  }
  check('v1 opens with a headline', /^#{1,3} \S/.test(articleText('v1')));
  check(
    'the shorter one is shorter',
    articleText('short').length < articleText('v1').length,
    { v1: articleText('v1').length, short: articleText('short').length },
  );

  // ---------- the live draft ----------
  check('an unstarted draft is empty', streamPrefix('एक दोन तीन', 0) === '');
  check(
    'a finished draft is whole',
    streamPrefix('एक दोन तीन', 1) === 'एक दोन तीन',
  );
  const half = streamPrefix(articleText('v1'), 0.5);
  check(
    'a half draft ends between words',
    half.length > 0 &&
      articleText('v1').startsWith(half) &&
      articleText('v1')[half.length] === ' ',
  );
  check('no draft once settled', draftText(v1) === '');

  // ---------- the sandbox covers every WebApi key ----------
  const clock = fakeClock();
  const sandbox = createDloSandbox(undefined, clock.scheduler);
  const api = createDloSandboxApi(sandbox);
  const realKeys = Object.keys(REAL_API).sort();
  check(
    'DLO sandbox API covers every WebApi key',
    JSON.stringify(realKeys) === JSON.stringify(Object.keys(api).sort()),
  );
  const creativeApi = createSandboxApi(createCreativeSandbox());
  check(
    'Creative sandbox API still covers every WebApi key',
    JSON.stringify(realKeys) ===
      JSON.stringify(Object.keys(creativeApi).sort()),
  );
  check(
    'the Creative sandbox refuses a DLO intake',
    await refused(creativeApi.createDloIntake(new FormData())),
  );

  // ---------- matchArticleEdit ----------
  const shorts = [
    'आणखी थोडक्यात लिहा',
    'बातमी लहान करा',
    'बातमी थोडी छोटी करा',
    'संक्षिप्त करा',
    'कमी शब्दांत लिहा',
    'make it shorter',
  ];
  for (const note of shorts)
    check(`short: ${note}`, matchArticleEdit(note) === 'short');
  const rejected = [
    // A real request the practice has no result for (see matchArticleEdit).
    'भाषा आणखी सोपी करा',
    'use simpler language',
    'आणखी सविस्तर लिहा',
    'सुरुवात आणखी आकर्षक करा',
    'शीर्षक लहान करा',
    'तारीख बदला',
    'इंग्रजीत लिहा',
    'थोडक्यात आणि सोप्या भाषेत लिहा',
    'बातमी लांब करा',
    '',
    '   ',
  ];
  for (const note of rejected)
    check(`rejected: "${note}"`, matchArticleEdit(note) === null);

  // ---------- the text rule ----------
  check('the sample note matches', matchesDloSampleNote(SAMPLE_NOTE));
  check(
    'a re-flowed copy matches',
    matchesDloSampleNote(SAMPLE_NOTE.replace(/\n/g, ' ').replace(/-/g, '•')),
  );
  check(
    'a small edit still matches',
    matchesDloSampleNote(SAMPLE_NOTE.replace('जिल्हाभर', 'जिल्ह्यात')),
  );
  check(
    'a different note does not',
    !matchesDloSampleNote('जिल्ह्यात उद्या वृक्षारोपण मोहीम राबवली जाणार आहे.'),
  );
  check('an empty box does not', !matchesDloSampleNote('  '));
  check(
    'half the sample does not',
    !matchesDloSampleNote(SAMPLE_NOTE.slice(0, SAMPLE_NOTE.length / 2)),
  );

  // ---------- the lesson's shape ----------
  check(
    'four stages, like the Creative lesson',
    DLO_STAGES.length === STAGES.length,
  );
  check(
    'every stage has a step',
    DLO_STAGES.every((stage) =>
      DLO_LESSON_STEPS.some((step) => step.stage === stage.id),
    ),
  );
  check(
    'stages never go backwards',
    DLO_LESSON_STEPS.every(
      (step, i) => i === 0 || step.stage >= DLO_LESSON_STEPS[i - 1]!.stage,
    ),
  );
  check(
    'step ids are unique',
    new Set(DLO_LESSON_STEPS.map((s) => s.id)).size === DLO_LESSON_STEPS.length,
  );

  // ---------- the lesson advances on the scripted transitions ----------
  const base: DloLessonFacts = {
    noteHasSample: false,
    noteHasOther: false,
    acknowledged: [],
    created: false,
    creating: false,
    feedbackOpen: false,
    feedbackWritten: false,
    editing: false,
    edited: false,
  };
  const id = (facts: DloLessonFacts) =>
    DLO_LESSON_STEPS[dloCurrentStepIndex(facts)]?.id;
  const sample = { ...base, noteHasSample: true };
  const made = { ...base, created: true };
  const afterEdit = { ...made, edited: true };
  const journey: [string, DloLessonFacts, string][] = [
    ['start', base, 'text'],
    ['other text', { ...base, noteHasOther: true }, 'text'],
    // The inserted note stays lit until पुढे.
    ['sample in', sample, 'text'],
    ['note read', { ...sample, acknowledged: ['text'] }, 'sources'],
    [
      'sources read',
      { ...sample, acknowledged: ['text', 'sources'] },
      'ai-prompt',
    ],
    [
      'ai box read',
      { ...sample, acknowledged: ['text', 'sources', 'ai-prompt'] },
      'submit',
    ],
    ['creating', { ...base, created: true, creating: true }, 'submit'],
    ['article', made, 'article'],
    ['article read', { ...made, acknowledged: ['article'] }, 'note'],
    [
      'note read',
      { ...made, acknowledged: ['article', 'note'] },
      'open-feedback',
    ],
    [
      'fold open',
      { ...made, acknowledged: ['article', 'note'], feedbackOpen: true },
      'describe',
    ],
    // Closing the fold again sends the coach back to opening it.
    [
      'fold closed again',
      { ...made, acknowledged: ['article', 'note'], feedbackWritten: true },
      'open-feedback',
    ],
    [
      'change written',
      {
        ...made,
        acknowledged: ['article', 'note'],
        feedbackOpen: true,
        feedbackWritten: true,
      },
      'send',
    ],
    // The article view unmounts while it is rewritten — the coach must not go back.
    ['rewriting', { ...made, editing: true }, 'send'],
    // A reload after the edit loses the पुढे clicks; stage 2 must not come back.
    ['edited', afterEdit, 'versions'],
    ['versions read', { ...afterEdit, acknowledged: ['versions'] }, 'download'],
    [
      'download read',
      { ...afterEdit, acknowledged: ['versions', 'download'] },
      'onward',
    ],
    [
      'onward read',
      { ...afterEdit, acknowledged: ['versions', 'download', 'onward'] },
      'finish',
    ],
  ];
  for (const [name, facts, expected] of journey)
    check(
      `step at "${name}" is ${expected}`,
      id(facts) === expected,
      id(facts),
    );

  // ---------- the sandbox job, end to end ----------
  const intakeId = await api.createDloIntake(new FormData());
  check('create returns the sample intake id', intakeId === 'learn-dlo-intake');
  check('create starts running', sandbox.getState().status === 'running');
  check('it starts on retrieve', sandbox.getState().step === 'retrieve');
  clock.advance(2500);
  check('then drafts', sandbox.getState().step === 'draft');
  check('the draft is growing', draftText(sandbox.getState()).length > 0);
  check(
    'but is not yet whole',
    draftText(sandbox.getState()).length < articleText('v1').length,
  );
  clock.advance(CREATE_DONE_MS);
  check(
    'create completes with v1',
    sandbox.getState().status === 'completed' &&
      sandbox.getState().versions.length === 1,
  );

  check(
    'an unsupported change is refused',
    await refused(api.sendArticleFeedback('x', 'सुरुवात आणखी आकर्षक करा')),
  );
  check('a refusal sends nothing', sandbox.getState().busy === null);
  check(
    'the poster calls are not in this lesson',
    await refused(
      api.createGeneration({
        note: 'x',
        category: 'twitter',
        outputType: 'poster',
      }),
    ),
  );
  check('no Canva link', api.posterCanvaUrl('x') === null);
  check(
    'no source files to list',
    (await api.getGenerationSourceFiles('x')).length === 0,
  );
  check(
    'the PDF is a bundled file',
    api.articlePdfDownloadUrl('x') === '/learn/dlo/v1.pdf',
  );

  check(
    'simpler language is refused (no result exists)',
    await refused(api.sendArticleFeedback('x', 'भाषा आणखी सोपी करा')),
  );
  await api.sendArticleFeedback('x', 'बातमी लहान करा');
  check('a supported change runs', sandbox.getState().busy === 'edit');
  check(
    'the row keeps its article while rewriting',
    sampleDetail(sandbox.getState()).article === articleText('v1'),
  );
  check(
    'a second change waits for the first',
    await refused(api.sendArticleFeedback('x', 'आणखी थोडक्यात लिहा')),
  );
  check(
    'the live draft is the revision being written',
    articleText('short').startsWith(draftText(sandbox.getState())),
  );
  clock.advance(EDIT_DONE_MS);
  const after = sandbox.getState();
  check(
    "the change lands as the shorter article, with the learner's words",
    after.versions.length === 2 &&
      after.versions[1]?.file === 'short' &&
      after.versions[1]?.feedback === 'बातमी लहान करा',
  );
  check(
    'the PDF follows the article on the row',
    api.articlePdfDownloadUrl('x') === '/learn/dlo/short.pdf',
  );
  check(
    'a change of the revision is refused (no result exists)',
    await refused(api.sendArticleFeedback('x', 'आणखी थोडक्यात लिहा')),
  );
  const texts = await api.getArticleVersions('x');
  check(
    'both versions can be read',
    texts.length === 2 && texts[0]?.article === articleText('v1'),
  );
  await api.restoreArticleVersion('x', 1);
  check(
    'restoring v1 puts it back on the row',
    sandbox.getState().current === 0,
  );

  // ---------- resume ----------
  const resumed = parseSandboxState(
    JSON.parse(
      JSON.stringify({
        ...after,
        busy: 'edit',
        pendingEdit: { file: 'short', feedback: 'लहान करा' },
        streamed: 0.4,
      }),
    ),
  );
  check(
    'a reload mid-change finishes it',
    resumed?.busy === null &&
      resumed.versions.length === 3 &&
      resumed.streamed === 0,
  );
  check('junk storage starts over', parseSandboxState({ v: 2 }) === null);
  check(
    'an unknown article starts over',
    parseSandboxState({
      ...v1,
      versions: [{ file: 'long', feedback: null, createdAt: '' }],
    }) === null,
  );

  sandbox.dispose();
  console.log(`${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
