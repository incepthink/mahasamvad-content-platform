// Temporary no-reference specification for the simplified article generator.
//
// The reference-enabled selectors and prompts remain untouched. This module only supplies the
// reversible bypass selected by ARTICLE_STYLE_REFERENCES_ENABLED: it removes every exemplar
// from the user message and replaces the reference-dependent system instruction with a
// self-contained DGIPR writing instruction.

import { pathToFileURL } from 'node:url';
import { buildMinimalArticleMessages } from './minimal-article-prompt.js';
import type { ChatMessage } from './openai-chat.js';
import {
  PRECEDENCE_RULE,
  buildSimpleArticleMessages,
  type SimpleArticleInputs,
} from './simple-article-prompt.js';

// v3 (2026-08-11): the officer's two inputs outrank this specification — the shared
// PRECEDENCE_RULE, and a length sentence that is conditional on them rather than absolute. This
// is the variant that actually runs by default, so it is where the officer's "बातमी १२००
// अक्षरांची हवी" was being contradicted by a system-message "the article's length does not
// matter" plus a blanket ban on stretching.
//
// v2 (2026-08-05): the system message states the OUTPUT SHAPE. v1 asked only for "the headline
// on the first line", so the model wrote it as plain text — which every downstream consumer of
// a headline reads as body (MarkdownText, the article PDF template) and which made
// ensureArticleDateline prefix the dateline to the headline itself. It now asks for "# शीर्षक"
// and says the dateline opens the first body paragraph, never the headline.
export const NO_REFERENCE_ARTICLE_PROMPT_VERSION = 'no-reference-v3';

// Disabled is the deliberate default for the current experiment. Setting the variable to the
// single explicit opt-in value `true` restores the complete pre-existing selection + prompt
// path without a code change. Other values stay disabled instead of accidentally enabling a
// paid embedding/retrieval call because of a typo.
export function articleStyleReferencesEnabled(): boolean {
  return (
    process.env.ARTICLE_STYLE_REFERENCES_ENABLED?.trim().toLowerCase() ===
    'true'
  );
}

export function buildNoReferenceArticleSystemPrompt(): string {
  return [
    'You are a Marathi news writer for the Directorate General of Information and Public',
    'Relations (DGIPR / Mahasamvad), Government of Maharashtra.',
    '',
    'Write ONE complete, publication-ready Marathi article using only the factual information',
    'provided in the user message. Use your best editorial judgement to make it coherent,',
    'readable and informative rather than a mechanical inventory of supplied facts.',
    '',
    ...PRECEDENCE_RULE,
    '',
    'Unless the HEADLINE / ANGLE or the OFFICER REQUEST asks for a particular length, the',
    'article’s length does not matter. Use the information fully when it improves the article,',
    'but do not pad, repeat, infer, or add unsupported information.',
    '',
    'Where a length IS asked for, write to it. Reach it by covering the supplied information',
    'more fully and explaining it more completely — never by repeating yourself, padding with',
    'empty phrases, or adding anything the supplied information does not support. If the',
    'supplied information cannot honestly fill the requested length, write the fullest accurate',
    'article it supports and stop.',
    '',
    'SOURCE INFORMATION may contain Markdown tables (pipe-delimited rows). Read them as tables:',
    'each figure belongs to its own column heading and row label. Never read a row as a',
    'sentence, and never attach a figure to the wrong heading.',
    '',
    'Where the NAME DICTIONARY gives a spelling, use it exactly. Where a title is given after a',
    "name, use it before that person's full name on first mention and before their bare surname",
    'every time after that ("मुख्यमंत्री फडणवीस यांनी"). Where the source has only the surname,',
    'still write the title before it; never add a first name the source does not have.',
    '',
    'Return only the Marathi article. Do not return analysis, notes, an explanation, or a',
    'translation.',
    '',
    'OUTPUT SHAPE. The first line is the headline, written as a Markdown heading ("# शीर्षक").',
    'Leave one blank line after it, then write the article body in paragraphs. The headline is',
    'a fragment and carries no closing full stop.',
    '',
    'Where a DATELINE is supplied, it opens the FIRST BODY PARAGRAPH — never the headline. Write',
    'it exactly as given, once, and nowhere else in the article.',
  ].join('\n');
}

export function buildNoReferenceArticleMessages(
  inputs: SimpleArticleInputs,
  variant: 'standard' | 'minimal',
): ChatMessage[] {
  // Remove both supported reference shapes here as a second guard. Even if a future caller
  // accidentally passes an officer reference while the bypass is active, no reference word can
  // reach the model.
  const withoutReferences: SimpleArticleInputs = {
    ...inputs,
    styleReference: undefined,
    styleReferences: [],
  };
  const existing =
    variant === 'minimal'
      ? buildMinimalArticleMessages(withoutReferences)
      : buildSimpleArticleMessages(withoutReferences);

  return [
    { role: 'system', content: buildNoReferenceArticleSystemPrompt() },
    ...existing.slice(1),
  ];
}

// One testable seam for the live generator. The enabled side delegates directly to the
// pre-existing builders with the original input object; no rewriting or normalization occurs.
export function buildArticleMessagesForReferenceMode(
  inputs: SimpleArticleInputs,
  variant: 'standard' | 'minimal',
  referencesEnabled: boolean,
): ChatMessage[] {
  if (!referencesEnabled)
    return buildNoReferenceArticleMessages(inputs, variant);
  return variant === 'minimal'
    ? buildMinimalArticleMessages(inputs)
    : buildSimpleArticleMessages(inputs);
}

// Free regression harness:
//   pnpm exec tsx src/generation/no-reference-article-prompt.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, condition: boolean): void => {
    if (condition) console.log(`  ok    ${label}`);
    else {
      failures += 1;
      console.error(`  FAIL  ${label}`);
    }
  };

  const referenceTitle = 'हा संदर्भ शीर्षक मॉडेलपर्यंत जाऊ नये';
  const referenceBody = 'हा संदर्भ मजकूर मॉडेलपर्यंत जाऊ नये.';
  const inputs: SimpleArticleInputs = {
    category: 'news',
    sourceInformation: 'परिवहन विभागाच्या कामकाजाचा आढावा घेण्यात आला.',
    styleReference: referenceBody,
    styleReferences: [{ title: referenceTitle, text: referenceBody }],
  };

  for (const variant of ['standard', 'minimal'] as const) {
    const messages = buildNoReferenceArticleMessages(inputs, variant);
    const rendered = messages.map((message) => message.content).join('\n');
    check(
      `${variant}: reference title is absent`,
      !rendered.includes(referenceTitle),
    );
    check(
      `${variant}: reference body is absent`,
      !rendered.includes(referenceBody),
    );
    check(
      `${variant}: no reference heading is emitted`,
      !rendered.includes('SELECTED STYLE REFERENCE') &&
        !rendered.includes('### STYLE REFERENCE'),
    );
    check(
      `${variant}: source information remains`,
      rendered.includes('परिवहन विभागाच्या कामकाजाचा आढावा घेण्यात आला.'),
    );
    check(
      `${variant}: system prompt does not ask the model to follow a reference`,
      !messages[0]?.content.toLowerCase().includes('reference'),
    );

    const legacy =
      variant === 'minimal'
        ? buildMinimalArticleMessages(inputs)
        : buildSimpleArticleMessages(inputs);
    check(
      `${variant}: enabling references returns the legacy messages byte-for-byte`,
      JSON.stringify(
        buildArticleMessagesForReferenceMode(inputs, variant, true),
      ) === JSON.stringify(legacy),
    );
  }

  const system = buildNoReferenceArticleSystemPrompt();
  const flatSystem = system.replace(/\s+/gu, ' ');
  check(
    'the officer’s inputs are given an explicit precedence over this specification',
    system.includes('PRECEDENCE. Where anything below conflicts') &&
      flatSystem.includes(
        'They override every general instruction given here, including what is said about length below.',
      ),
  );
  check(
    'never stating an unsupported fact still outranks the officer',
    flatSystem.includes(
      'Never state a fact — a name, designation, date, amount, place, scheme, law, quote or claim',
    ) && flatSystem.includes('Nothing overrides this.'),
  );
  check(
    'length is irrelevant only while the officer has named none',
    flatSystem.includes(
      'Unless the HEADLINE / ANGLE or the OFFICER REQUEST asks for a particular length, the article’s length does not matter',
    ),
  );
  check(
    'a requested length is written to, by covering the source more fully',
    flatSystem.includes('Where a length IS asked for, write to it.') &&
      flatSystem.includes('covering the supplied information more fully'),
  );
  check(
    'padding and invention remain the forbidden way to reach it',
    flatSystem.includes(
      'never by repeating yourself, padding with empty phrases, or adding anything the supplied information does not support',
    ),
  );
  check(
    'stopping short beats inventing',
    flatSystem.includes(
      'cannot honestly fill the requested length, write the fullest accurate article it supports and stop',
    ),
  );
  check(
    'the blanket "do not stretch" is gone',
    !system.includes('do not pad, repeat, stretch, infer'),
  );
  check(
    'the headline is asked for as a Markdown heading',
    system.includes('written as a Markdown heading ("# शीर्षक")'),
  );
  check(
    'the headline carries no full stop',
    system.includes('carries no closing full stop'),
  );
  check(
    'the dateline opens the body, never the headline',
    system.includes('opens the FIRST BODY PARAGRAPH — never the headline'),
  );
  check(
    'the dateline is written once and verbatim',
    system.includes('exactly as given, once, and nowhere else'),
  );

  const previous = process.env.ARTICLE_STYLE_REFERENCES_ENABLED;
  delete process.env.ARTICLE_STYLE_REFERENCES_ENABLED;
  check('references are disabled when unset', !articleStyleReferencesEnabled());
  process.env.ARTICLE_STYLE_REFERENCES_ENABLED = 'false';
  check('false keeps references disabled', !articleStyleReferencesEnabled());
  process.env.ARTICLE_STYLE_REFERENCES_ENABLED = 'true';
  check(
    'true restores the legacy reference path',
    articleStyleReferencesEnabled(),
  );
  if (previous === undefined)
    delete process.env.ARTICLE_STYLE_REFERENCES_ENABLED;
  else process.env.ARTICLE_STYLE_REFERENCES_ENABLED = previous;

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll no-reference prompt checks passed.');
}
