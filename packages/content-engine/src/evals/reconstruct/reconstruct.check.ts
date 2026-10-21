// Free offline harness for the round-1 trace builders and the sampler. No database, no network.
//
//   npx tsx src/evals/reconstruct/reconstruct.check.ts      (or: pnpm evals:check)
//
// It feeds fixture rows to each builder and asserts what the review depends on: ids are
// deterministic, spans come in time order, no IP or device field survives, attachments are
// referenced, and a missing first draft is FLAGGED rather than invented.

import assert from 'node:assert/strict';
import type {
  ChatMessageRow,
  ChatThreadRow,
  DloIntakeRow,
  GenerationRow,
  NewVideoConversationRow,
  NewVideoTurnRow,
  ReferenceImageRow,
  RevisionRow,
  TranscriptionRow,
} from '@dgipr/database';
import { pickLatest, pickStratified, type Candidate } from '../sample.js';
import {
  collectMedia,
  EARLIER_DRAFT_NOT_STORED,
  stableUuid,
  type ActivityLite,
  type ReconstructedTrace,
} from '../trace.js';
import { buildChatTrace } from './chat.js';
import { buildCreativeTrace } from './creative.js';
import {
  buildDloTrace,
  dloSourceLane,
  reconstructReviewedNote,
  reviewOverlay,
} from './dlo.js';
import { buildNewVideoTrace } from './new-video.js';
import { buildReferenceTrace } from './reference.js';
import { buildTranscriptionTrace } from './transcription.js';
import {
  buildTranslationTrace,
  TRANSLATION_STAND_IN_NOTE,
} from './translation.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const T0 = '2026-09-01T10:00:00.000Z';
const at = (minutes: number) =>
  new Date(Date.parse(T0) + minutes * 60_000).toISOString();

function generation(overrides: Partial<GenerationRow> = {}): GenerationRow {
  return {
    id: 'g-1',
    note: 'पुणे जिल्ह्यात ५०० कोटींचा प्रकल्प मंजूर.',
    outputType: 'poster',
    category: 'twitter',
    designMode: 'fresh',
    templateBrand: 'dgipr',
    heading: null,
    posterHeading: null,
    imagePrompt: null,
    referenceImageId: null,
    referenceTypeId: null,
    sourceGenerationId: null,
    threadRootId: null,
    dloIntakeId: null,
    excludedFacts: null,
    selectedFacts: null,
    statements: null,
    nameDesignations: null,
    styleReference: null,
    instructions: null,
    styleReferenceMeta: null,
    articleProvided: false,
    posterStyle: null,
    status: 'completed',
    step: 'done',
    error: null,
    article: 'मूळ कॅप्शन #पुणे',
    articleEnglish: null,
    articleHindi: null,
    factCheck: null,
    referenceTitle: null,
    referenceUrl: null,
    copy: null,
    fiveWOneH: null,
    scenePrompt: null,
    scenePath: null,
    posterPath: 'generations/g-1/poster-v2.png',
    promptImagePaths: null,
    imageModel: null,
    sourceImagePath: null,
    motionPath: null,
    motionGifPath: null,
    motionPrompt: null,
    motionInteractionId: null,
    motionAspect: null,
    motionRegion: null,
    carousel: null,
    costUsd: 0.12,
    costBreakdown: null,
    publishedUrl: null,
    publishedAt: null,
    createdAt: T0,
    updatedAt: at(30),
    ...overrides,
  };
}

function revision(overrides: Partial<RevisionRow>): RevisionRow {
  return {
    id: 'r-1',
    generationId: 'g-1',
    target: 'poster_image',
    feedback: 'शीर्षक मोठे करा',
    article: null,
    factCheck: null,
    copy: null,
    scenePrompt: null,
    scenePath: null,
    posterPath: 'generations/g-1/poster-v2.png',
    motionPath: null,
    motionGifPath: null,
    createdAt: at(10),
    ...overrides,
  };
}

// An activity row as the database holds it, identity included — cast, because the builder's
// input type deliberately has no room for these fields. The harness proves they never leak.
const LEAKY_ACTIVITY = [
  {
    createdAt: at(20),
    settledAt: at(20),
    feature: 'creative',
    action: 'poster_download',
    status: 'success',
    subjectId: 'g-1',
    error: null,
    ip: '203.0.113.77',
    deviceId: 'd-secretdevice1234',
    userAgent: 'Mozilla/5.0 SecretAgent',
  },
  {
    createdAt: at(5),
    settledAt: at(6),
    feature: 'creative',
    action: 'generation_create',
    status: 'success',
    subjectId: 'g-1',
    error: null,
    ip: '203.0.113.77',
    deviceId: 'd-secretdevice1234',
    userAgent: 'Mozilla/5.0 SecretAgent',
  },
] as unknown as ActivityLite[];

function assertCommon(trace: ReconstructedTrace, expectedId: string): void {
  assert.equal(trace.id, expectedId);
  assert.equal(trace.metadata.reconstructed, true);
  for (let i = 1; i < trace.spans.length; i += 1) {
    assert.ok(
      Date.parse(trace.spans[i - 1]!.startedAt) <=
        Date.parse(trace.spans[i]!.startedAt),
      `span ${i} (${trace.spans[i]!.name}) is out of time order`,
    );
  }
  const json = JSON.stringify(trace);
  for (const forbidden of [
    '203.0.113.77',
    'd-secretdevice',
    'SecretAgent',
    '"ip"',
    'deviceId',
    'device_id',
    'userAgent',
    'user_agent',
  ]) {
    assert.ok(!json.includes(forbidden), `identity leaked: ${forbidden}`);
  }
  const keys = trace.spans.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'span keys must be unique');
}

// ---------------------------------------------------------------------------

check('stableUuid is a deterministic v5-shaped uuid', () => {
  const a = stableUuid('creative:g-1');
  assert.equal(a, stableUuid('creative:g-1'));
  assert.notEqual(a, stableUuid('creative:g-2'));
  assert.match(
    a,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

check(
  'creative: no revisions → v1 is the current output, poster attached',
  () => {
    const row = generation({ posterPath: 'generations/g-1/poster-v1.png' });
    const trace = buildCreativeTrace(row, [], LEAKY_ACTIVITY);
    assertCommon(trace, 'creative:g-1');
    assert.equal(
      JSON.stringify(trace),
      JSON.stringify(buildCreativeTrace(row, [], LEAKY_ACTIVITY)),
    );
    const v1 = trace.spans.find((s) => s.key === 'v1')!;
    assert.match(JSON.stringify(v1.output), /poster-v1\.png/);
    assert.ok(collectMedia(trace).some((m) => m.role === 'image'));
    assert.deepEqual(trace.notes, []);
    assert.ok(trace.spans.some((s) => s.name === 'officer: poster_download'));
    // generation_create is not a reaction and must not become a span.
    assert.ok(!trace.spans.some((s) => s.name.includes('generation_create')));
  },
);

check('creative: caption revised → earlier draft FLAGGED, not invented', () => {
  const row = generation({ article: 'सुधारित कॅप्शन' });
  const trace = buildCreativeTrace(
    row,
    [
      revision({
        id: 'r-2',
        target: 'caption',
        posterPath: null,
        article: 'सुधारित कॅप्शन',
        createdAt: at(12),
      }),
      revision({ createdAt: at(8) }),
    ],
    [],
  );
  assertCommon(trace, 'creative:g-1');
  assert.ok(trace.notes.includes(EARLIER_DRAFT_NOT_STORED));
  const v1 = JSON.stringify(trace.spans.find((s) => s.key === 'v1')!.output);
  assert.ok(
    !v1.includes('सुधारित कॅप्शन'),
    'v1 must not be filled with the revised caption',
  );
  const derived = collectMedia(trace.spans.find((s) => s.key === 'v1')).filter(
    (m) => m.derived,
  );
  assert.equal(
    derived.length,
    1,
    'poster v1 comes from the naming convention, marked derived',
  );
  const rounds = trace.spans.filter((s) => s.key.startsWith('revision:'));
  assert.deepEqual(
    rounds.map((s) => s.key),
    ['revision:r-1', 'revision:r-2'],
  );
  assert.match(rounds[0]!.name, /round 1/);
});

check('creative: Marathi survives byte for byte', () => {
  const trace = buildCreativeTrace(generation(), [], []);
  assert.equal(
    (trace.input as { note: string }).note,
    'पुणे जिल्ह्यात ५०० कोटींचा प्रकल्प मंजूर.',
  );
});

check('creative: carousel slides and per-slide redos become spans', () => {
  const row = generation({
    category: 'carousel',
    posterPath: 'generations/g-1/slide-1-v1.png',
    carousel: {
      slides: [
        {
          index: 0,
          title: 'मुखपृष्ठ',
          path: 'generations/g-1/slide-1-v1.png',
          versions: [
            {
              path: 'generations/g-1/slide-1-v1.png',
              createdAt: at(1),
              feedback: null,
            },
          ],
        },
        {
          index: 1,
          title: 'तपशील',
          path: 'generations/g-1/slide-2-v2.png',
          versions: [
            {
              path: 'generations/g-1/slide-2-v1.png',
              createdAt: at(2),
              feedback: null,
            },
            {
              path: 'generations/g-1/slide-2-v2.png',
              createdAt: at(9),
              feedback: 'आकडे मोठे करा',
            },
          ],
        },
      ],
    },
  });
  const trace = buildCreativeTrace(row, [], []);
  assertCommon(trace, 'creative:g-1');
  assert.equal(trace.metadata.lane, 'carousel');
  assert.equal(
    (trace.output as { carouselSlides: unknown[] }).carouselSlides.length,
    2,
  );
  assert.ok(trace.spans.some((s) => s.key === 'slide:1:v2'));
});

check('creative: failed run ends with a failure span', () => {
  const trace = buildCreativeTrace(
    generation({
      status: 'failed',
      error: 'image model refused',
      posterPath: null,
    }),
    [],
    [],
  );
  assert.equal(trace.spans[trace.spans.length - 1]!.key, 'failure');
});

const intake: DloIntakeRow = {
  id: 'i-1',
  status: 'ready',
  step: 'done',
  error: null,
  notes: 'बैठकीची टिपणी',
  category: 'news',
  heading: null,
  files: [
    {
      name: 'meeting.m4a',
      kind: 'audio',
      status: 'done',
      storagePath: 'intakes/i-1/meeting.m4a',
      text: 'फडणविस यांनी सांगितले',
    },
    {
      name: 'gr.pdf',
      kind: 'pdf',
      status: 'done',
      storagePath: 'intakes/i-1/gr.pdf',
      pdfSource: 'ocr',
      pages: [
        { page: 1, text: 'पान एक' },
        { page: 2, text: 'पान दोन' },
      ],
    },
  ],
  combinedText: null,
  reviewState: {
    v: 1,
    edits: { '0': 'फडणवीस यांनी सांगितले', '1:1': 'पान एक (दुरुस्त)' },
    excluded: ['1:2'],
    instructions: 'थोडक्यात लिहा',
    writer: 'w',
    updatedAt: at(3),
  },
  createdAt: T0,
  updatedAt: at(4),
};

check(
  'dlo: machine text beside the officer correction; earlier draft flagged',
  () => {
    const gen = generation({
      id: 'g-9',
      dloIntakeId: 'i-1',
      category: 'news',
      outputType: 'article',
      posterPath: null,
      note: 'सुधारित टिपणी',
      article: 'अंतिम लेख',
      createdAt: at(5),
      updatedAt: at(40),
    });
    const trace = buildDloTrace(
      intake,
      [
        {
          generation: gen,
          revisions: [
            revision({
              id: 'r-9',
              generationId: 'g-9',
              target: 'article',
              article: 'अंतिम लेख',
              posterPath: null,
              createdAt: at(15),
            }),
          ],
        },
      ],
      LEAKY_ACTIVITY,
    );
    assertCommon(trace, 'dlo:i-1');
    const audio = trace.spans.find((s) => s.key === 'source:0')!;
    assert.match(JSON.stringify(audio.output), /फडणविस/);
    assert.match(JSON.stringify(audio.output), /फडणवीस/);
    const pdf = JSON.stringify(
      trace.spans.find((s) => s.key === 'source:1')!.output,
    );
    assert.match(pdf, /excludedByOfficer/);
    assert.ok(collectMedia(trace).some((m) => m.role === 'audio'));
    assert.ok(trace.notes.includes(EARLIER_DRAFT_NOT_STORED));
    const v1 = JSON.stringify(
      trace.spans.find((s) => s.key === 'generation:g-9')!.output,
    );
    assert.ok(!v1.includes('अंतिम लेख'), 'v1 must not be the revised article');
    assert.equal((trace.output as { article: string }).article, 'अंतिम लेख');
    assert.equal(trace.metadata.lane, 'mixed');
  },
);

check('dlo: reviewed note reconstructed when nothing was generated', () => {
  const note = reconstructReviewedNote(
    intake,
    reviewOverlay(intake.reviewState),
  );
  assert.match(note, /फडणवीस/);
  assert.match(note, /पान एक \(दुरुस्त\)/);
  assert.ok(!note.includes('पान दोन'), 'an excluded page stays out');
  assert.equal(dloSourceLane('x', []), 'typed');
  assert.equal(
    dloSourceLane('', [{ kind: 'docx' }, { kind: 'txt' }]),
    'document',
  );
});

check('transcribe: one span per recording with its audio', () => {
  const row: TranscriptionRow = {
    id: 't-1',
    status: 'ready',
    error: null,
    title: 'बैठक',
    files: [
      {
        name: 'a.mp3',
        storagePath: 'transcriptions/t-1/a.mp3',
        status: 'done',
        text: 'मजकूर',
      },
      {
        name: 'yt',
        sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        status: 'failed',
        error: 'download failed',
      },
    ],
    combinedText: 'मजकूर',
    fileCount: 2,
    failedCount: 1,
    charCount: 5,
    createdAt: T0,
    updatedAt: at(2),
  };
  const trace = buildTranscriptionTrace(row, []);
  assertCommon(trace, 'transcribe:t-1');
  assert.equal(trace.spans.length, 2);
  assert.equal(
    collectMedia(trace).filter((m) => m.role === 'audio').length >= 1,
    true,
  );
});

check('translate: labelled as the article stand-in, not the page', () => {
  const trace = buildTranslationTrace(
    generation({
      category: 'news',
      articleEnglish: 'Pune project',
      articleHindi: 'पुणे परियोजना',
    }),
    [],
  );
  assertCommon(trace, 'translate:g-1');
  assert.ok(trace.notes.includes(TRANSLATION_STAND_IN_NOTE));
  assert.equal(trace.spans.length, 2);
});

check('references: template image + layout_spec, or "not analysed"', () => {
  const row: ReferenceImageRow = {
    id: 'ref-1',
    category: 'twitter',
    subtype: 'info_bullets',
    storagePath: 'references/library/x.png',
    isActive: true,
    layoutSpec: null,
    createdAt: T0,
    updatedAt: at(1),
  };
  const trace = buildReferenceTrace(row);
  assertCommon(trace, 'references:ref-1');
  assert.equal(trace.metadata.status, 'not-analysed');
  assert.equal(collectMedia(trace.input).length, 1);
});

check(
  'new-video / storyboard: mode decides the feature; turns in order',
  () => {
    const conv = (mode: 'video' | 'storyboard'): NewVideoConversationRow => ({
      id: 'c-1',
      mode,
      title: 'शीर्षक',
      turnCount: 2,
      lastTurnAt: at(5),
      lastInteractionId: 'secret-interaction',
      createdAt: T0,
      updatedAt: at(5),
    });
    const turns: NewVideoTurnRow[] = [
      {
        id: 'tu-2',
        conversationId: 'c-1',
        prompt: 'बदल',
        images: [],
        status: 'failed',
        videoUrl: null,
        interactionId: 'secret-interaction',
        modelText: null,
        generatedImages: [],
        error: 'safety',
        createdAt: at(5),
        updatedAt: at(6),
      },
      {
        id: 'tu-1',
        conversationId: 'c-1',
        prompt: 'व्हिडिओ',
        images: [{ id: 'im', name: 'p.png', url: 'https://cdn.example/p.png' }],
        status: 'completed',
        videoUrl: 'https://cdn.example/v.mp4',
        interactionId: 'secret-interaction',
        modelText: null,
        generatedImages: [],
        error: null,
        createdAt: T0,
        updatedAt: at(1),
      },
    ];
    const video = buildNewVideoTrace(conv('video'), turns);
    assertCommon(video, 'new-video:c-1');
    assert.equal(video.spans[0]!.key, 'turn:tu-1');
    assert.ok(
      !JSON.stringify(video).includes('secret-interaction'),
      'provider handle stays out',
    );
    assert.equal(
      buildNewVideoTrace(conv('storyboard'), turns).id,
      'storyboard:c-1',
    );
    assert.ok(collectMedia(video).some((m) => m.role === 'video'));
  },
);

check(
  'chat: user turns paired with answers; images attached, extracted text not repeated',
  () => {
    const thread: ChatThreadRow = {
      id: 'ch-1',
      title: 'प्रश्न',
      messageCount: 3,
      lastMessageAt: at(3),
      vectorStoreId: null,
      createdAt: T0,
      updatedAt: at(3),
    };
    const messages: ChatMessageRow[] = [
      {
        id: 'm1',
        threadId: 'ch-1',
        role: 'user',
        content: 'हे काय आहे?',
        attachments: [
          {
            kind: 'image',
            name: 'a.png',
            imageUrl: 'https://cdn.example/chat/a.png',
          },
          { kind: 'audio', name: 'r.mp3', text: 'खूप मोठा उतारा', chars: 15 },
        ],
        model: null,
        costUsd: null,
        error: null,
        responseId: null,
        createdAt: T0,
      },
      {
        id: 'm2',
        threadId: 'ch-1',
        role: 'assistant',
        content: 'उत्तर',
        attachments: [],
        model: 'm',
        costUsd: 0.01,
        error: null,
        responseId: 'resp',
        createdAt: at(1),
      },
      {
        id: 'm3',
        threadId: 'ch-1',
        role: 'user',
        content: 'आणखी',
        attachments: [],
        model: null,
        costUsd: null,
        error: null,
        responseId: null,
        createdAt: at(2),
      },
    ];
    const trace = buildChatTrace(thread, messages);
    assertCommon(trace, 'chat:ch-1');
    assert.equal(trace.spans.length, 2);
    assert.ok(!JSON.stringify(trace).includes('खूप मोठा उतारा'));
    assert.equal(collectMedia(trace).length, 1);
  },
);

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

const lanes = ['social-poster', 'caption-only', 'carousel', 'youtube'];
const pool: Candidate[] = Array.from({ length: 200 }, (_, i) => ({
  id: `id-${String(i).padStart(3, '0')}`,
  createdAt: new Date(Date.parse(T0) + i * 86_400_000).toISOString(),
  failed: i % 7 === 0,
  lane: lanes[i % lanes.length]!,
  reacted: i % 3 === 0,
  size: i % 11,
}));

check('sampler: deterministic, independent of input order', () => {
  const a = pickStratified(pool, 20, 'round1', 'creative').map((c) => c.id);
  const b = pickStratified([...pool].reverse(), 20, 'round1', 'creative').map(
    (c) => c.id,
  );
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    a,
    pickStratified(pool, 20, 'round2', 'creative').map((c) => c.id),
  );
});

check(
  'sampler: count, ~25% failed, every lane, both reactions, spread in time',
  () => {
    const picked = pickStratified(pool, 20, 'round1', 'creative');
    assert.equal(picked.length, 20);
    assert.equal(new Set(picked.map((c) => c.id)).size, 20);
    assert.equal(picked.filter((c) => c.failed).length, 5);
    assert.equal(new Set(picked.map((c) => c.lane)).size, lanes.length);
    assert.ok(picked.some((c) => c.reacted) && picked.some((c) => !c.reacted));
    const days = picked
      .map((c) => Date.parse(c.createdAt))
      .sort((x, y) => x - y);
    assert.ok(
      days[days.length - 1]! - days[0]! > 120 * 86_400_000,
      'picks span the history',
    );
  },
);

check('sampler: small pools and no failures', () => {
  assert.equal(pickStratified(pool.slice(0, 3), 20, 's', 'f').length, 3);
  const healthy = pool.map((c) => ({ ...c, failed: false }));
  assert.equal(
    pickStratified(healthy, 20, 's', 'f').filter((c) => c.failed).length,
    0,
  );
  assert.equal(pickStratified(healthy, 20, 's', 'f').length, 20);
  assert.deepEqual(pickStratified([], 5, 's', 'f'), []);
});

check('sampler --latest: newest first, independent of input order', () => {
  const latest = pickLatest(pool, 5);
  const newest = [...pool]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  assert.deepEqual(
    latest.map((c) => c.createdAt),
    newest.map((c) => c.createdAt),
  );
  assert.deepEqual(
    pickLatest([...pool].reverse(), 5).map((c) => c.id),
    latest.map((c) => c.id),
  );
  assert.equal(pickLatest(pool.slice(0, 3), 20).length, 3);
  assert.deepEqual(pickLatest(pool, 0), []);
});

console.log(`\n${passed} checks passed.`);
