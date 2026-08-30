import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DLO_ARTICLE_PROMPT_VERSION,
  DLO_SOURCE_FILES_MARKER,
  buildDloArticleMessages,
} from './dlo-article-prompt.js';
import { buildSourcesRequest } from './responses-with-sources.js';

test('DLO uses the officer-approved complete prompt', () => {
  assert.equal(DLO_ARTICLE_PROMPT_VERSION, 'dlo-direct-v1');
  assert.deepEqual(
    buildDloArticleMessages({
      sourceInformation: 'बैठकीची टिपणी',
      designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
      heading: 'नवीन प्रकल्पाला मंजुरी',
      officerInstructions: 'मुख्य निर्णयावर भर द्या.',
    }),
    [
      {
        role: 'system',
        content: 'Write a DGIPR Maharashtra style article.',
      },
      {
        role: 'user',
        content: [
          '### SOURCE INFORMATION',
          '',
          'बैठकीची टिपणी',
          '',
          '### REVIEWED NAMES AND DESIGNATIONS',
          '',
          '- देवेंद्र फडणवीस — मुख्यमंत्री',
          '',
          '### HEADLINE / ANGLE',
          '',
          'नवीन प्रकल्पाला मंजुरी',
          '',
          '### OFFICER REQUEST',
          '',
          'मुख्य निर्णयावर भर द्या.',
        ].join('\n'),
      },
    ],
  );
});

test('DLO omits every optional block when the officer did not supply it', () => {
  const messages = buildDloArticleMessages({ sourceInformation: 'एक स्रोत' });
  assert.equal(
    messages[1]?.content,
    ['### SOURCE INFORMATION', '', 'एक स्रोत'].join('\n'),
  );
});

test('DLO drops incomplete reviewed name/designation rows', () => {
  const messages = buildDloArticleMessages({
    sourceInformation: 'एक स्रोत',
    designations: [
      { name: 'नाव', designation: ' ' },
      { name: ' ', designation: 'पदनाम' },
    ],
  });
  assert.doesNotMatch(messages[1]?.content ?? '', /REVIEWED NAMES/u);
});

test('DLO source files occupy the SOURCE INFORMATION slot in the provider request', () => {
  const body = buildSourcesRequest({
    messages: buildDloArticleMessages({
      sourceInformation: 'टिपणी',
      designations: [{ name: 'नाव', designation: 'पदनाम' }],
      attachedSourceFiles: true,
    }),
    files: [{ fileId: 'file-1', kind: 'document', name: 'source.pdf' }],
    model: 'test-model',
    maxOutputTokens: 100,
    reasoningEffort: 'low',
  });
  const input = body.input as Array<{
    content: Array<{ type: string; text?: string; file_id?: string }>;
  }>;
  const content = input[0]?.content ?? [];

  assert.equal(
    content.some((part) => part.text?.includes(DLO_SOURCE_FILES_MARKER)),
    false,
  );
  assert.deepEqual(
    content.map((part) => part.type),
    ['input_text', 'input_text', 'input_file', 'input_text'],
  );
  assert.match(content[0]?.text ?? '', /### SOURCE INFORMATION[\s\S]*टिपणी/u);
  assert.equal(content[1]?.text, '=== स्रोत: source.pdf ===');
  assert.equal(content[2]?.file_id, 'file-1');
  assert.match(content[3]?.text ?? '', /### REVIEWED NAMES AND DESIGNATIONS/u);
});
