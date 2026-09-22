import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DloIntakeRow, GenerationRow, RevisionRow } from '@dgipr/database';
import { DGIPR_EDITORIAL_SYSTEM_PROMPT } from '../generation/dlo-article-prompt.js';
import { buildDloTrainingExample } from './export-dlo-generation.js';

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  dloIntakeId: '00000000-0000-4000-8000-000000000002',
  status: 'completed',
  category: 'news',
  outputType: 'article',
  articleProvided: false,
  note: 'पुणे येथे २५ शाळांना पुस्तके देण्यात आली.\nअधिकारी पाटील उपस्थित होते.',
  article:
    '# पुण्यात २५ शाळांना पुस्तके\n\nपुणे : २५ शाळांना पुस्तके देण्यात आली.',
  heading: 'पुस्तक वितरण',
  instructions: 'बातमी मराठीत लिहा.',
  nameDesignations: [{ name: 'पाटील', designation: 'जिल्हाधिकारी' }],
  styleReference: 'UNRELATED STYLE FACTS',
} as GenerationRow;
const intake = { id: row.dloIntakeId, files: [] } as unknown as DloIntakeRow;

test('exports reviewed input and the exact saved Marathi target as one JSONL record', () => {
  const result = buildDloTrainingExample(row, intake, []);
  const wire = JSON.stringify(result.example) + '\n';
  assert.equal(wire.trimEnd().split('\n').length, 1);
  const { messages } = JSON.parse(wire) as typeof result.example;
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user', 'assistant'],
  );
  // Imported, not written out: the old literal outlived the prompt it described (c97bbbb).
  assert.ok(messages[0]!.content.startsWith(DGIPR_EDITORIAL_SYSTEM_PROMPT));
  assert.ok(messages[1]!.content.includes(row.note));
  assert.ok(messages[1]!.content.includes('पाटील — जिल्हाधिकारी'));
  assert.ok(messages[1]!.content.includes(row.instructions!));
  assert.ok(messages[1]!.content.includes(row.heading!));
  assert.ok(wire.includes('UNRELATED STYLE FACTS'));
  assert.ok(messages[1]!.content.includes('never as a factual source'));
  assert.equal(messages[2]!.content, row.article);
  assert.equal(result.review.approvalStatus, 'needs-review');
  assert.ok(!('generationId' in result.example));
});

test('does not train on partial, non-DLO, social, provided, empty or identical pairs', () => {
  for (const patch of [
    { status: 'running' },
    { status: 'failed' },
    { dloIntakeId: null },
    { category: 'twitter' },
    { outputType: 'poster' },
    { articleProvided: true },
    { note: ' ' },
    { article: null },
    { article: row.note },
  ]) {
    assert.throws(() =>
      buildDloTrainingExample(
        { ...row, ...patch } as GenerationRow,
        intake,
        [],
      ),
    );
  }
});

test('requires a verified intake and complete text for native file inputs', () => {
  assert.throws(
    () => buildDloTrainingExample(row, null, []),
    /intake is missing/,
  );
  const native = {
    ...intake,
    files: [
      {
        name: 'source.pdf',
        kind: 'pdf',
        status: 'done',
        openaiFileId: 'file-test',
      },
    ],
  } as DloIntakeRow;
  assert.throws(
    () => buildDloTrainingExample(row, native, []),
    /--source-file/,
  );
  assert.throws(() => buildDloTrainingExample(row, native, [], ' '), /empty/);
  const result = buildDloTrainingExample(
    row,
    native,
    [],
    'संपूर्ण दुरुस्त स्रोत मजकूर',
  );
  assert.ok(
    result.example.messages[1]!.content.includes('संपूर्ण दुरुस्त स्रोत मजकूर'),
  );
  assert.ok(!result.example.messages[1]!.content.includes(row.note));
  assert.equal(result.review.sourceField, 'source-file');
});

test('preserves legacy editorial controls and rejects invalid designation data', () => {
  const result = buildDloTrainingExample(
    { ...row, excludedFacts: ['वगळलेला मुद्दा'] },
    intake,
    [],
  );
  assert.ok(result.example.messages[1]!.content.includes('वगळलेला मुद्दा'));
  assert.throws(() =>
    buildDloTrainingExample(
      { ...row, nameDesignations: [{ name: 'पाटील' }] },
      intake,
      [],
    ),
  );
});

test('includes chronological officer feedback and prior drafts, with only the final article as target', () => {
  const revisions = [
    {
      id: 'baseline',
      target: 'article',
      feedback: null,
      article: 'BASELINE ARTICLE',
      createdAt: '2026-09-01T00:00:00Z',
    },
    {
      id: 'revision',
      target: 'article',
      feedback: 'Replace २५ with ३०.',
      article: 'OLDER ARTICLE',
      createdAt: '2026-09-01T00:01:00Z',
    },
    {
      id: 'last',
      target: 'article',
      feedback: 'Make it concise.',
      article: row.article,
      createdAt: '2026-09-01T00:02:00Z',
    },
    {
      id: 'poster',
      target: 'poster_image',
      feedback: 'UNRELATED POSTER FEEDBACK',
    },
  ] as RevisionRow[];
  const result = buildDloTrainingExample(row, intake, revisions);
  assert.equal(result.review.articleFeedback.length, 2);
  assert.equal(
    result.review.articleFeedback[0]!.feedback,
    'Replace २५ with ३०.',
  );
  const input = result.example.messages[1]!.content;
  assert.ok(input.includes('BASELINE ARTICLE'));
  assert.ok(input.includes('OLDER ARTICLE'));
  assert.ok(input.includes('Replace २५'));
  assert.ok(input.indexOf('Replace २५') < input.indexOf('Make it concise.'));
  assert.ok(!input.includes(row.article!));
  assert.ok(!input.includes('UNRELATED POSTER FEEDBACK'));
  assert.equal(
    result.example.messages.filter((message) => message.role === 'assistant')
      .length,
    1,
  );
  assert.equal(result.example.messages.at(-1)!.content, row.article);
});

test('includes all stored original text and separately labels the reviewed source', () => {
  const original = {
    ...intake,
    notes: 'ORIGINAL NOTE',
    files: [
      {
        name: 'audio.mp3',
        kind: 'audio',
        status: 'done',
        text: 'ORIGINAL TRANSCRIPT',
      },
      {
        name: 'source.pdf',
        kind: 'pdf',
        status: 'done',
        pages: [{ page: 3, text: 'ORIGINAL PAGE' }],
      },
    ],
  } as DloIntakeRow;
  const input = buildDloTrainingExample(row, original, []).example.messages[1]!
    .content;
  for (const text of [
    'ORIGINAL NOTE',
    'ORIGINAL TRANSCRIPT',
    'ORIGINAL PAGE',
    'page 3',
    'SAVED REVIEWED SOURCE',
    row.note,
  ]) {
    assert.ok(input.includes(text));
  }
});

test('flags feedback without a baseline instead of claiming a complete history', () => {
  const result = buildDloTrainingExample(row, intake, [
    {
      target: 'article',
      feedback: 'Change paragraph two.',
      article: row.article,
      createdAt: '2026-09-01',
    },
  ] as RevisionRow[]);
  assert.ok(
    result.example.messages[1]!.content.includes('Change paragraph two.'),
  );
  assert.ok(
    result.review.warnings.some((warning) =>
      warning.includes('earlier draft is missing'),
    ),
  );
});
