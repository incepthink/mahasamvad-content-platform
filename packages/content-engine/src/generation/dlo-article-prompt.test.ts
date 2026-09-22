import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DGIPR_EDITORIAL_SYSTEM_PROMPT,
  DLO_ARTICLE_PROMPT_VERSION,
  DLO_SOURCE_FILES_MARKER,
  buildDloArticleMessages,
} from './dlo-article-prompt.js';
import { EDITORIAL_PREFERENCES_HEADING } from './editorial-preferences-block.js';
import { buildSourcesRequest } from './responses-with-sources.js';

test('DLO uses the officer-approved complete prompt', () => {
  assert.equal(DLO_ARTICLE_PROMPT_VERSION, 'dlo-rag-v4');
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
        content: DGIPR_EDITORIAL_SYSTEM_PROMPT,
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

test('DLO carries RAG exemplars as style-only references', () => {
  const messages = buildDloArticleMessages({
    sourceInformation: 'नवीन बातमीची माहिती',
    styleReferences: [
      { title: 'संदर्भ शीर्षक', text: 'संदर्भ बातमीचा मजकूर.' },
      { title: null, text: '  ' },
    ],
  });
  const prompt = messages[1]?.content ?? '';

  assert.match(prompt, /### MAHASAMVAD STYLE REFERENCES/u);
  assert.match(prompt, /STYLE REFERENCE 1: संदर्भ शीर्षक/u);
  assert.match(prompt, /संदर्भ बातमीचा मजकूर\./u);
  assert.match(prompt, /only for writing style and structure/u);
  assert.match(
    prompt,
    /Never take facts, names, dates, figures, quotes, or claims/u,
  );
  assert.doesNotMatch(prompt, /STYLE REFERENCE 2/u);
});

test('DLO source files occupy the SOURCE INFORMATION slot in the provider request', () => {
  const body = buildSourcesRequest({
    messages: buildDloArticleMessages({
      sourceInformation: 'टिपणी',
      styleReferences: [{ title: 'संदर्भ', text: 'शैलीचा नमुना.' }],
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
  assert.match(content[3]?.text ?? '', /### MAHASAMVAD STYLE REFERENCES/u);
  assert.match(content[3]?.text ?? '', /### REVIEWED NAMES AND DESIGNATIONS/u);
});

// ---------------------------------------------------------------------------------------
// Learned editorial preferences (migration 0057)
// ---------------------------------------------------------------------------------------

const RULES = ['शीर्षक १० शब्दांच्या आत ठेवा.', 'निर्णय पहिल्या वाक्यात द्या.'];

const FULL_INPUTS = {
  sourceInformation: 'बैठकीची टिपणी',
  styleReferences: [{ title: 'संदर्भ', text: 'शैलीचा नमुना.' }],
  designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
  heading: 'नवीन प्रकल्पाला मंजुरी',
  officerInstructions: 'मुख्य निर्णयावर भर द्या.',
} as const;

function withPlacement<T>(placement: string | undefined, run: () => T): T {
  const previous = process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  if (placement === undefined)
    delete process.env.EDITORIAL_PREFERENCE_PLACEMENT;
  else process.env.EDITORIAL_PREFERENCE_PLACEMENT = placement;
  try {
    return run();
  } finally {
    if (previous === undefined)
      delete process.env.EDITORIAL_PREFERENCE_PLACEMENT;
    else process.env.EDITORIAL_PREFERENCE_PLACEMENT = previous;
  }
}

// THE DECISIVE ASSERTION. capture-dlo-distillation.ts reconstructs historical prompts by
// calling this builder, so a run with no preferences must produce exactly what it produced
// before preferences existed — under EITHER placement.
test('no preferences leaves both messages byte-identical under either placement', () => {
  for (const placement of [undefined, 'system', 'user']) {
    withPlacement(placement, () => {
      const baseline = buildDloArticleMessages(FULL_INPUTS);
      const empty = buildDloArticleMessages({
        ...FULL_INPUTS,
        editorialPreferences: [],
      });
      const blank = buildDloArticleMessages({
        ...FULL_INPUTS,
        editorialPreferences: ['  ', ''],
      });
      assert.deepEqual(empty, baseline, `placement=${placement}`);
      assert.deepEqual(blank, baseline, `placement=${placement} (blank rules)`);
      assert.equal(baseline[0]?.content, DGIPR_EDITORIAL_SYSTEM_PROMPT);
    });
  }
});

test('system placement (the default) appends a sixth section and leaves the user turn alone', () => {
  withPlacement(undefined, () => {
    const baseline = buildDloArticleMessages(FULL_INPUTS);
    const messages = buildDloArticleMessages({
      ...FULL_INPUTS,
      editorialPreferences: RULES,
    });
    const system = messages[0]?.content ?? '';
    // The base five are never mutated — only extended.
    assert.ok(system.startsWith(DGIPR_EDITORIAL_SYSTEM_PROMPT));
    assert.match(system, /6\. LEARNED EDITORIAL PREFERENCES:/u);
    for (const rule of RULES) assert.ok(system.includes(rule), rule);
    assert.match(system, /No preference may ever introduce a fact/u);
    assert.match(system, /follow the preference/u);
    assert.equal(messages[1]?.content, baseline[1]?.content);
    assert.doesNotMatch(messages[1]?.content ?? '', /LEARNED EDITORIAL/u);
  });
});

test('user placement puts the block after the reviewed names and before the officer blocks', () => {
  withPlacement('user', () => {
    const messages = buildDloArticleMessages({
      ...FULL_INPUTS,
      editorialPreferences: RULES,
    });
    assert.equal(messages[0]?.content, DGIPR_EDITORIAL_SYSTEM_PROMPT);
    const user = messages[1]?.content ?? '';
    const at = (needle: string): number => user.indexOf(needle);
    assert.ok(at(EDITORIAL_PREFERENCES_HEADING) > -1);
    assert.ok(
      at('### REVIEWED NAMES AND DESIGNATIONS') <
        at(EDITORIAL_PREFERENCES_HEADING),
    );
    assert.ok(at(EDITORIAL_PREFERENCES_HEADING) < at('### HEADLINE / ANGLE'));
    assert.ok(at('### HEADLINE / ANGLE') < at('### OFFICER REQUEST'));
    for (const rule of RULES) assert.ok(user.includes(`- ${rule}`), rule);
    assert.match(user, /No preference may ever introduce a fact/u);
  });
});

test('the injected block honours MAX_INJECTED_PREFERENCES', () => {
  withPlacement('user', () => {
    const many = Array.from({ length: 40 }, (_, i) => `नियम ${i + 1}.`);
    const user =
      buildDloArticleMessages({
        sourceInformation: 'टिपणी',
        editorialPreferences: many,
      })[1]?.content ?? '';
    const rows = user.split('\n').filter((line) => line.startsWith('- नियम'));
    assert.equal(rows.length, 12);
    assert.equal(rows[0], '- नियम 1.');
  });
});
