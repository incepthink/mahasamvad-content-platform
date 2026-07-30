// The MINIMAL editorial specification (ARTICLE_PROMPT_VARIANT=minimal).
//
// An experiment, and a deliberate one: the standard specification
// (simple-article-prompt.ts, ~6,700 chars) out-instructs its own style exemplars. Pasting the
// same note into ChatGPT with ONE Mahasamvad article and the sentence "write an article that
// follows their writing style" produced better copy than this pipeline did — no rules, no word
// target, no structure ladder. This module is that prompt, made reproducible.
//
// What it keeps, and why each one is not a "rule" in the sense being tested:
//
//   1. The note is the only factual source. Removing this does not test a style hypothesis, it
//      tests whether the model will invent a scheme name on a government press release. It
//      won't be removed.
//   2. The name dictionary. The officer's verified spellings are DATA, not style guidance —
//      the whole point of having a dictionary is that it reaches the article.
//   3. The output shape (article only, headline first). Everything downstream — the PDF export,
//      the poster's heading resolution, translation — parses a bare article.
//
// What it deliberately does NOT say: any word count, any paragraph structure, any headline
// pattern, any dateline form, any register guidance, any avoid-list, any priority ordering.
// All of that is left to the exemplars. THE EXEMPLARS ARE THE SPECIFICATION.
//
//   4. Since minimal-v3, one length-neutral instruction: reference length is not a target.
//      Editorial judgement chooses the strongest article and whatever length best serves the
//      supplied material, without padding, repetition or unsupported invention.
//
// There is no application-imposed style-reference character limit or category-length bound.
// The source decides the output length; only the model's technical context/output capacity
// remains.

import { pathToFileURL } from 'node:url';
import type { ChatMessage } from './openai-chat.js';
import type { ArticleCategory, DesignationPair } from './category-prompt.js';
import { newsEditorialFocusBlock } from './simple-article-prompt.js';
import type {
  ArticleNameEntry,
  SimpleArticleInputs,
  SimpleArticleReference,
} from './simple-article-prompt.js';

// Bumped whenever this specification changes in substance. Persisted per run in
// generations.style_reference_meta, so an output is attributable to the prompt that produced it.
// v5 (2026-07-29): NEWS only — share the standard prompt's minister-centred editorial focus.
// Scheme articles are unchanged.
// v4 (2026-07-29): resolve a portfolio-department mention to the verified minister supplied in
// the name dictionary when that sentence is about the human decision-maker.
// v3 (2026-07-29): length is explicitly irrelevant; quality and editorial judgement are the
// target. Style references are no longer bounded or clipped by application character limits.
// v2 (2026-07-28): one sentence added, about length only — see item 4 in the header comment.
export const MINIMAL_ARTICLE_PROMPT_VERSION = 'minimal-v5';

// The dictionary entry shape now lives in simple-article-prompt.ts, both variants rendering it
// since simple-v4. Re-exported here so existing importers (and the package barrel) are unmoved.
export type { ArticleNameEntry };

// `names` is part of SimpleArticleInputs itself now; the alias is kept so this module's public
// surface and its callers do not change.
export type MinimalArticleInputs = SimpleArticleInputs;

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

// Six sentences. Everything else the article needs to look right is in the exemplars — except
// its LENGTH, which is the one thing the exemplars must NOT teach.
export function buildMinimalArticleSystemPrompt(): string {
  return [
    'You are a Marathi news writer for the Directorate General of Information and Public',
    'Relations (DGIPR / Mahasamvad), Government of Maharashtra.',
    '',
    'Write ONE complete Marathi article from SOURCE INFORMATION, in the writing style of the',
    'STYLE REFERENCES. Study how they are written and write the same way.',
    '',
    'Learn style from them and nothing else.',
    'Take no fact, name, figure or wording from a reference, and never reproduce a',
    "reference's sign-off or writer credit.",
    '',
    '',
    'Take style and structure from the references, but do not treat their length as a target.',
    'The new article’s length does not matter. Use your best editorial judgement to produce the',
    'strongest publication-ready article possible from SOURCE INFORMATION, at the length that',
    'repeat, stretch, or add unsupported information.',
    'Do not make it seem like you are just mentioning the facts from the sorce information, but rather write a complete article that is engaging and informative you can even skip some infromation it does not seem right for editorial flow of the article.',
    '',
    'Where the NAME DICTIONARY gives a spelling, use it exactly.',
    '',
    'Return only the Marathi article, beginning with its headline on the first line. No',
    'analysis, no notes, no explanation, no translation.',
  ].join('\n');
}

// Render the exemplars, headline included. Identical intent to the standard builder's block —
// the headline is what carries the "– पदनाम नाव" pattern — but with no instruction attached,
// because the system prompt has already said what to do with them.
function referenceBlock(
  references: readonly SimpleArticleReference[],
): string[] {
  if (references.length === 0) return [];
  const many = references.length > 1;
  const parts: string[] = [];

  references.forEach((reference, index) => {
    parts.push(
      many ? `### STYLE REFERENCE ${index + 1}` : '### STYLE REFERENCE',
      '',
    );
    const title = clean(reference.title);
    if (title) parts.push(`शीर्षक: ${title}`, '');
    parts.push(clean(reference.text), '');
  });

  return parts;
}

// The dictionary. Person rows carry their approved title, which is what makes a transcript
// saying "देवेंद्र फडणवीस" publish as "मुख्यमंत्री देवेंद्र फडणवीस". applyDesignations() still runs
// deterministically afterwards — this block is the prompt half, not the guarantee.
function nameBlock(
  names: readonly ArticleNameEntry[],
  designations: readonly DesignationPair[],
): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  // Officer-approved pairs first: those were confirmed for THIS run, so they outrank a
  // dictionary row that may be stale.
  for (const pair of designations) {
    const name = clean(pair.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const title = clean(pair.designation);
    lines.push(title ? `- ${name} — ${title}` : `- ${name}`);
  }

  for (const entry of names) {
    const name = clean(entry.marathi);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const title = clean(entry.designation);
    lines.push(title ? `- ${name} — ${title}` : `- ${name}`);
  }

  if (lines.length === 0) return [];
  return [
    '### NAME DICTIONARY',
    '',
    'Verified spellings. Where a title is given after the dash, use it before that person’s',
    'full name on first mention, and again before their bare surname on every later mention',
    '("मुख्यमंत्री फडणवीस यांनी", not "फडणवीस यांनी"). If the source only ever gives the surname,',
    'still write the title before it — but never add a first name the source does not have.',
    'If the source names the portfolio department without the person, and a minister for that',
    'portfolio is listed below, preserve the department as the institutional target and name',
    'the human decision-maker as title + full name where that is what the sentence means',
    '(for example, "प्रस्ताव उच्च व तंत्रशिक्षण विभागाकडे सादर करण्याचे निर्देश उच्च व तंत्रशिक्षण मंत्री चंद्रकांत पाटील यांनी दिले").',
    'Do not do this for a purely institutional reference.',
    '',
    ...lines,
    '',
  ];
}

export function buildMinimalArticleUserPrompt(
  inputs: MinimalArticleInputs,
): string {
  const references = normaliseReferences(inputs);
  const direction = clean(inputs.editorialDirection);
  const parts: string[] = [
    '### SOURCE INFORMATION',
    '',
    clean(inputs.sourceInformation),
    '',
  ];
  parts.push(...newsEditorialFocusBlock(inputs.category));

  parts.push(...referenceBlock(references));
  parts.push(...nameBlock(inputs.names ?? [], inputs.designations ?? []));

  // Officer-supplied context, each omitted entirely when empty — a bare heading is the shape
  // that invites a model to fill it in.
  const facts = (inputs.includeFacts ?? [])
    .map((fact) => clean(fact.text))
    .filter(Boolean);
  if (facts.length > 0) {
    parts.push(
      '### ALSO VERIFIED BY THE OFFICER',
      '',
      ...facts.map((fact) => `- ${fact}`),
      '',
    );
  }

  const statements = (inputs.statements ?? []).filter((statement) =>
    clean(statement.claim),
  );
  if (statements.length > 0) {
    parts.push('### STATEMENTS', '');
    for (const statement of statements) {
      const who = [clean(statement.designation), clean(statement.speaker)]
        .filter(Boolean)
        .join(' ');
      parts.push(
        who
          ? `- ${who}: ${clean(statement.claim)}`
          : `- ${clean(statement.claim)}`,
      );
    }
    parts.push('');
  }

  const excluded = (inputs.excludeFacts ?? []).map(clean).filter(Boolean);
  if (excluded.length > 0) {
    parts.push(
      '### LEAVE OUT',
      '',
      'The officer reviewed these and deliberately dropped them. Do not include or restate them.',
      '',
      ...excluded.map((fact) => `- ${fact}`),
      '',
    );
  }

  if (direction) {
    parts.push('### THE ANGLE THE OFFICER WANTS', '', direction, '');
  }

  const location = clean(inputs.location);
  const date = clean(inputs.date);
  if (location && date) {
    parts.push('### DATELINE', '', `${location}, दि. ${date} :`, '');
  }

  parts.push('Write the article now.');
  return parts.join('\n');
}

// Same two accepted reference shapes as the standard builder: the plural list wins, the legacy
// single string is one headline-less article, blanks are dropped.
function normaliseReferences(
  inputs: MinimalArticleInputs,
): readonly SimpleArticleReference[] {
  const plural = (inputs.styleReferences ?? [])
    .map((reference) => ({
      title: clean(reference.title),
      text: clean(reference.text),
    }))
    .filter((reference) => reference.text.length > 0);
  if (plural.length > 0) return plural;

  const single = clean(inputs.styleReference);
  return single ? [{ title: '', text: single }] : [];
}

export function buildMinimalArticleMessages(
  inputs: MinimalArticleInputs,
): ChatMessage[] {
  return [
    { role: 'system', content: buildMinimalArticleSystemPrompt() },
    { role: 'user', content: buildMinimalArticleUserPrompt(inputs) },
  ];
}

// ---------------------------------------------------------------------------
// Free harness: `tsx src/generation/minimal-article-prompt.ts`
// No API key, no network, no spend.
// ---------------------------------------------------------------------------

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (!condition) {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  };

  const note =
    'मुंबई महापालिकेच्या चार रुग्णालयांत नवीन एमआरआय केंद्रे सुरू होणार आहेत.';
  const sys = buildMinimalArticleSystemPrompt();
  const category: ArticleCategory = 'news';

  console.log(
    '\n=== no word target, structure or register instruction survives ===',
  );
  // 'words' stays banned deliberately: the v5/v2 length sentence is a policy, and the moment it
  // acquires a count it becomes the v3 target that padded thin notes and truncated rich ones.
  for (const banned of [
    'words',
    'paragraph',
    'bullet',
    'dateline',
    'register',
    'Lead with',
    'TARGET LENGTH',
  ]) {
    check(`system does not mention "${banned}"`, !sys.includes(banned));
  }
  check('no figure appears anywhere in the system prompt', !/\d/u.test(sys));

  console.log('\n=== length is the one thing NOT taken from the exemplars ===');
  check(
    "the references' length is explicitly excluded",
    sys.includes('do not treat their length as a target'),
  );
  check(
    'length is explicitly irrelevant',
    sys.includes('The new article’s length does not matter.'),
  );
  check(
    'editorial judgement chooses the strongest output',
    sys.includes('Use your best editorial judgement') &&
      sys.includes('strongest publication-ready article possible'),
  );
  check(
    'the material determines whatever length serves it',
    sys.includes('at the length that\nbest serves it'),
  );
  check(
    'padding, repetition and unsupported additions are forbidden',
    sys.includes(
      'do not pad,\nrepeat, stretch, or add unsupported information',
    ),
  );
  const bareUser = buildMinimalArticleUserPrompt({
    category,
    sourceInformation: note,
  });
  check('user prompt states no word target', !/\d+\s*words/u.test(bareUser));
  check(
    'user prompt has no TARGET LENGTH block',
    !bareUser.includes('TARGET LENGTH'),
  );
  check(
    'news receives the minister-centred editorial focus',
    bareUser.includes('### NEWS EDITORIAL FOCUS') &&
      bareUser.includes('factual pool, not a completeness checklist') &&
      bareUser.includes('Do not write meeting minutes'),
  );
  const schemeUser = buildMinimalArticleUserPrompt({
    category: 'scheme',
    sourceInformation: note,
  });
  check(
    'scheme receives no news editorial focus',
    !schemeUser.includes('NEWS EDITORIAL FOCUS') &&
      !schemeUser.includes('factual pool, not a completeness checklist'),
  );

  console.log('\n=== the three kept constraints are present ===');
  check(
    'the note is named the only factual source',
    sys.includes('SOURCE INFORMATION is the only factual source.'),
  );
  check('invention is forbidden', sys.includes('Never invent or infer a name'));
  check(
    'the dictionary is authoritative for spelling',
    sys.includes('NAME DICTIONARY gives a spelling, use it exactly'),
  );
  check(
    'the exemplars define the style',
    sys.includes('in the writing style of the') &&
      sys.includes('write the same way'),
  );
  check(
    'no fact may come from an exemplar',
    sys.includes('Take no fact, name, figure or wording from a reference'),
  );
  check(
    'the output is the article alone',
    sys.includes('Return only the Marathi article'),
  );

  console.log('\n=== exemplars arrive with their headlines ===');
  const withRefs = buildMinimalArticleUserPrompt({
    category,
    sourceInformation: note,
    styleReferences: [
      { title: 'पहिले शीर्षक', text: 'पहिला मजकूर.' },
      { title: 'दुसरे शीर्षक', text: 'दुसरा मजकूर.' },
    ],
  });
  check(
    'numbered when several',
    withRefs.includes('### STYLE REFERENCE 1') &&
      withRefs.includes('### STYLE REFERENCE 2'),
  );
  check(
    'every headline present',
    withRefs.includes('शीर्षक: पहिले शीर्षक') &&
      withRefs.includes('शीर्षक: दुसरे शीर्षक'),
  );
  check(
    'every body present',
    withRefs.includes('पहिला मजकूर.') && withRefs.includes('दुसरा मजकूर.'),
  );
  const oneRef = buildMinimalArticleUserPrompt({
    category,
    sourceInformation: note,
    styleReference: 'एकच संदर्भ मजकूर.',
  });
  check(
    'singular heading for one reference',
    oneRef.includes('### STYLE REFERENCE\n') &&
      !oneRef.includes('### STYLE REFERENCE 1'),
  );
  check(
    'a titleless reference emits no शीर्षक line',
    !oneRef.includes('शीर्षक:'),
  );
  check(
    'styleReferences wins over styleReference',
    (() => {
      const both = buildMinimalArticleUserPrompt({
        category,
        sourceInformation: note,
        styleReference: 'जुना मजकूर.',
        styleReferences: [{ title: 'नवे', text: 'नवा मजकूर.' }],
      });
      return both.includes('नवा मजकूर.') && !both.includes('जुना मजकूर.');
    })(),
  );
  check(
    'a blank reference emits no block at all',
    !buildMinimalArticleUserPrompt({
      category,
      sourceInformation: note,
      styleReferences: [{ title: 'शीर्षक आहे', text: '  ' }],
    }).includes('STYLE REFERENCE'),
  );

  console.log('\n=== the name dictionary ===');
  const named = buildMinimalArticleUserPrompt({
    category,
    sourceInformation: note,
    names: [
      { marathi: 'कोल्हापूर', termType: 'place' },
      { marathi: 'अमित देशमुख', termType: 'person', designation: 'मंत्री' },
    ],
    designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
  });
  check('the block appears', named.includes('### NAME DICTIONARY'));
  check(
    'an officer-approved pair carries its title',
    named.includes('- देवेंद्र फडणवीस — मुख्यमंत्री'),
  );
  check(
    'the department target is preserved and the agentless decision is attributed',
    named.includes(
      'प्रस्ताव उच्च व तंत्रशिक्षण विभागाकडे सादर करण्याचे निर्देश उच्च व तंत्रशिक्षण मंत्री चंद्रकांत पाटील यांनी दिले',
    ),
  );
  check(
    'a dictionary person carries its title',
    named.includes('- अमित देशमुख — मंत्री'),
  );
  check(
    'a titleless entry is a bare name',
    named.includes('- कोल्हापूर') && !named.includes('- कोल्हापूर —'),
  );
  check(
    'the approved pair wins over a stale dictionary row for the same name',
    (() => {
      const clash = buildMinimalArticleUserPrompt({
        category,
        sourceInformation: note,
        names: [
          {
            marathi: 'देवेंद्र फडणवीस',
            termType: 'person',
            designation: 'उपमुख्यमंत्री',
          },
        ],
        designations: [{ name: 'देवेंद्र फडणवीस', designation: 'मुख्यमंत्री' }],
      });
      return (
        clash.includes('- देवेंद्र फडणवीस — मुख्यमंत्री') &&
        !clash.includes('उपमुख्यमंत्री')
      );
    })(),
  );
  check('no dictionary means no block', !bareUser.includes('NAME DICTIONARY'));

  console.log('\n=== officer inputs are carried, and omitted when empty ===');
  const full = buildMinimalArticleUserPrompt({
    category,
    sourceInformation: note,
    includeFacts: [{ dimension: 'what', text: 'चार रुग्णालयांत एमआरआय' }],
    statements: [
      {
        speaker: 'देवेंद्र फडणवीस',
        designation: 'मुख्यमंत्री',
        venue: 'मुंबई',
        claim: 'काम वेळेत पूर्ण करावे',
      },
    ],
    excludeFacts: ['समितीची सदस्य यादी'],
    editorialDirection: 'नागरिकांचा फायदा',
    location: 'मुंबई',
    date: '२७ जुलै २०२६',
  });
  check(
    'approved facts present',
    full.includes('### ALSO VERIFIED BY THE OFFICER') &&
      full.includes('चार रुग्णालयांत एमआरआय'),
  );
  check(
    'a statement keeps its speaker beside its claim',
    full.includes('- मुख्यमंत्री देवेंद्र फडणवीस: काम वेळेत पूर्ण करावे'),
  );
  check(
    'excluded facts reach the prompt as an instruction',
    full.includes('### LEAVE OUT') && full.includes('समितीची सदस्य यादी'),
  );
  check('the angle is carried', full.includes('नागरिकांचा फायदा'));
  check(
    'a complete dateline is rendered, never substituted',
    full.includes('मुंबई, दि. २७ जुलै २०२६ :'),
  );
  check(
    'half a dateline produces none',
    !buildMinimalArticleUserPrompt({
      category,
      sourceInformation: note,
      location: 'मुंबई',
    }).includes('DATELINE'),
  );
  for (const heading of [
    'ALSO VERIFIED',
    'STATEMENTS',
    'LEAVE OUT',
    'THE ANGLE',
    'DATELINE',
  ]) {
    check(`bare prompt omits ${heading}`, !bareUser.includes(heading));
  }
  check(
    'no unfilled placeholder survives',
    !full.includes('{{') && !full.includes('}}') && !sys.includes('{{'),
  );
  check(
    'the source is always present',
    bareUser.includes('### SOURCE INFORMATION') && bareUser.includes(note),
  );

  console.log('\n=== message shape ===');
  const messages = buildMinimalArticleMessages({
    category,
    sourceInformation: note,
  });
  check('exactly two messages', messages.length === 2);
  check('first is system', messages[0]?.role === 'system');
  check('second is user', messages[1]?.role === 'user');

  console.log(
    `\nprompt version: ${MINIMAL_ARTICLE_PROMPT_VERSION} | system ${sys.length} chars\n`,
  );
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}
