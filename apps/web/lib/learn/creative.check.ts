// Assertions for /learn's first lesson. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/learn/creative.check.ts
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
  HEADLINE_REGION,
  SAMPLE_NOTE,
  createCreativeSandbox,
  freshSandboxState,
  parseSandboxState,
  sampleDetail,
  settle,
} from './creativeSandbox';
import { createSandboxApi } from './sandboxApi';
import { matchScriptedEdit } from './matchScriptedEdit';
import {
  LESSON_STEPS,
  currentStepIndex,
  marksHeadline,
  matchesSampleText,
  type LessonFacts,
} from './creativeLesson';

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

async function main() {
  // ---------- the detail parses against the real schema ----------
  const v1 = settle({
    ...freshSandboxState(),
    created: true,
    createdAt: '2026-09-30T10:00:00.000Z',
    busy: 'create',
  });
  const edited = settle({ ...v1, busy: 'edit', pendingEdit: 'size' });
  for (const [name, state] of [
    ['v1', v1],
    ['edited', edited],
  ] as const) {
    const parsed = GenerationDetailSchema.safeParse(sampleDetail(state));
    check(`${name} detail parses`, parsed.success, parsed.error?.issues);
  }
  check('v1 has one version', sampleDetail(v1).posterVersions.length === 1);
  check(
    'edit adds a version',
    sampleDetail(edited).posterVersions.length === 2,
  );
  check(
    'current poster is the newest',
    sampleDetail(edited).posterUrl ===
      sampleDetail(edited).posterVersions[1]?.posterUrl,
  );
  const twice = settle({
    ...edited,
    current: 0,
    busy: 'edit',
    pendingEdit: 'size',
  });
  const urls = sampleDetail(twice).posterVersions.map((v) => v.posterUrl);
  check('repeated edit keeps URLs unique', new Set(urls).size === urls.length);

  // ---------- the sandbox covers every WebApi key ----------
  const clock = fakeClock();
  const sandbox = createCreativeSandbox(undefined, clock.scheduler);
  const api = createSandboxApi(sandbox);
  const realKeys = Object.keys(REAL_API).sort();
  const fakeKeys = Object.keys(api).sort();
  check(
    'sandbox API covers every WebApi key',
    JSON.stringify(realKeys) === JSON.stringify(fakeKeys),
    { realKeys, fakeKeys },
  );

  // ---------- matchScriptedEdit ----------
  const sizes = [
    'शीर्षक आणखी मोठे व ठळक करा',
    'शीर्षक मोठे करा',
    'हेडलाइन ठळक करा',
    'मथळ्याचा आकार वाढवा',
    'make the headline bigger',
    'Bold headline',
  ];
  for (const note of sizes)
    check(`size: ${note}`, matchScriptedEdit(note) === 'size');
  const colours = [
    'शीर्षकाचा रंग लाल करा',
    'हेडलाइन लाल करा',
    'शीर्षकाचा रंग बदला',
    'make the headline red',
  ];
  for (const note of colours)
    check(`colour: ${note}`, matchScriptedEdit(note) === 'colour');
  const rejected = [
    'फोटो बदला',
    'तारीख बदला',
    'दिनांक १५ ऑक्टोबर करा',
    'शीर्षकाचा रंग निळा करा',
    'शीर्षक लहान करा',
    'शीर्षक मोठे आणि लाल करा',
    'पार्श्वभूमीचा रंग लाल करा',
    '',
    '   ',
  ];
  for (const note of rejected)
    check(`rejected: "${note}"`, matchScriptedEdit(note) === null);

  // ---------- the headline check ----------
  const h = HEADLINE_REGION;
  check(
    'a click on the headline counts',
    marksHeadline({ x: h.x + 0.1, y: h.y + 0.05, width: 0.08, height: 0.06 }),
  );
  check('a box round the headline counts', marksHeadline(h));
  check(
    'a box on the photo does not',
    !marksHeadline({ x: 0.6, y: 0.55, width: 0.15, height: 0.12 }),
  );
  check(
    'a box round the whole poster does not',
    !marksHeadline({ x: 0, y: 0, width: 1, height: 1 }),
  );
  check(
    'a box on the details below does not',
    !marksHeadline({ x: 0.06, y: 0.45, width: 0.2, height: 0.08 }),
  );

  // ---------- the text rule ----------
  check('the sample text matches', matchesSampleText(SAMPLE_NOTE));
  check(
    'a re-flowed copy matches',
    matchesSampleText(SAMPLE_NOTE.replace(/\n\n/g, ' ').replace(/\./g, '। ')),
  );
  check(
    'a small edit still matches',
    matchesSampleText(SAMPLE_NOTE.replace('औषधेही', 'औषधे')),
  );
  check(
    'a different note does not',
    !matchesSampleText('जिल्ह्यात उद्या वृक्षारोपण मोहीम राबवली जाणार आहे.'),
  );
  check('an empty box does not', !matchesSampleText('  '));
  check(
    'half the sample does not',
    !matchesSampleText(SAMPLE_NOTE.slice(0, SAMPLE_NOTE.length / 2)),
  );

  // ---------- the lesson advances on the scripted transitions ----------
  const base: LessonFacts = {
    noteHasSample: false,
    noteHasOther: false,
    acknowledged: [],
    created: false,
    creating: false,
    marking: false,
    markerCount: 0,
    headlineMarked: false,
    noteWritten: false,
    editing: false,
    edited: false,
  };
  const id = (facts: LessonFacts) => LESSON_STEPS[currentStepIndex(facts)]?.id;
  const sample = { ...base, noteHasSample: true };
  const afterEdit = { ...base, created: true, edited: true };
  const journey: [string, LessonFacts, string][] = [
    ['start', base, 'text'],
    ['other text', { ...base, noteHasOther: true }, 'text'],
    // The inserted text stays lit until पुढे.
    ['sample in', sample, 'text'],
    ['text read', { ...sample, acknowledged: ['text'] }, 'verbatim'],
    [
      'verbatim read',
      { ...sample, acknowledged: ['text', 'verbatim'] },
      'caption',
    ],
    [
      'options read',
      { ...sample, acknowledged: ['text', 'verbatim', 'caption'] },
      'submit',
    ],
    ['creating', { ...base, created: true, creating: true }, 'submit'],
    ['poster', { ...base, created: true }, 'mark-mode'],
    ['marking', { ...base, created: true, marking: true }, 'mark-headline'],
    [
      'wrong place',
      { ...base, created: true, marking: true, markerCount: 1 },
      'mark-headline',
    ],
    [
      'on headline',
      {
        ...base,
        created: true,
        marking: true,
        markerCount: 1,
        headlineMarked: true,
      },
      'describe',
    ],
    [
      'note written',
      {
        ...base,
        created: true,
        marking: true,
        markerCount: 1,
        headlineMarked: true,
        noteWritten: true,
      },
      'send',
    ],
    // Sending turns marking OFF and clears the marks — the coach must not go back.
    ['editing', { ...base, created: true, editing: true }, 'send'],
    // The version strip is only shown: पुढे moves on, nothing is opened.
    ['edited', afterEdit, 'compare'],
    ['versions read', { ...afterEdit, acknowledged: ['compare'] }, 'redo'],
    [
      'redo read',
      { ...afterEdit, acknowledged: ['compare', 'redo'] },
      'download',
    ],
    [
      'download read',
      { ...afterEdit, acknowledged: ['compare', 'redo', 'download'] },
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
  const newId = await api.createGeneration({
    note: SAMPLE_NOTE,
    category: 'twitter',
    outputType: 'poster',
  });
  check('create returns the sample id', newId === 'learn-creative-sample');
  check('create starts running', sandbox.getState().status === 'running');
  clock.advance(2500);
  check('create reaches the copy stage', sandbox.getState().step === 'copy');
  clock.advance(CREATE_DONE_MS);
  check(
    'create completes with v1',
    sandbox.getState().status === 'completed' &&
      sandbox.getState().versions.length === 1,
  );

  const refusal = await api
    .sendPosterImageFeedback('x', {
      annotations: [{ region: HEADLINE_REGION, note: 'फोटो बदला' }],
    })
    .then(
      () => null,
      (e: unknown) => e,
    );
  check('an unsupported edit is refused', refusal instanceof Error);
  check('a refusal sends nothing', sandbox.getState().busy === null);

  const redesign = await api.regeneratePoster('x').then(
    () => null,
    (e: unknown) => e,
  );
  check('redesign is not in the lesson', redesign instanceof Error);
  const publish = await api.publishGeneration('x', 'facebook').then(
    () => null,
    (e: unknown) => e,
  );
  check('publish never posts', publish instanceof Error);
  check('no Canva link', api.posterCanvaUrl('x') === null);

  await api.sendPosterImageFeedback('x', {
    annotations: [{ region: HEADLINE_REGION, note: 'शीर्षकाचा रंग लाल करा' }],
  });
  check('a supported edit runs', sandbox.getState().busy === 'edit');
  clock.advance(EDIT_DONE_MS);
  const after = sandbox.getState();
  check(
    'the edit lands as v2-colour',
    after.versions.length === 2 && after.versions[1]?.file === 'v2-colour',
  );

  const fromV2 = await api
    .sendPosterImageFeedback('x', {
      annotations: [{ region: HEADLINE_REGION, note: 'शीर्षक मोठे करा' }],
    })
    .then(
      () => null,
      (e: unknown) => e,
    );
  check('an edit of v2 is refused (no render exists)', fromV2 instanceof Error);

  await api.restorePosterVersion('x', 1);
  check('restoring v1 is recorded', sandbox.getState().sawOriginalAfterEdit);
  await api.restorePosterVersion('x', 2);
  check('back on the newest', sandbox.getState().current === 1);

  // ---------- resume ----------
  const resumed = parseSandboxState(
    JSON.parse(JSON.stringify({ ...after, busy: 'edit', pendingEdit: 'size' })),
  );
  check(
    'a reload mid-edit finishes the edit',
    resumed?.busy === null && resumed.versions.length === 3,
  );
  check('junk storage starts over', parseSandboxState({ v: 2 }) === null);

  sandbox.dispose();
  console.log(`${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
