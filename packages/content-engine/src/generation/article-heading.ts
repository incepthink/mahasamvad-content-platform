// The officer's शीर्षक, made a guarantee rather than a suggestion.
//
// `generations.heading` is a DUAL-PURPOSE field — its own hint says so: "शीर्षक द्या, किंवा
// बातमीचा रोख थोडक्यात सांगा". One of those two answers can be enforced deterministically and
// the other cannot:
//
//   a HEADLINE ("कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा") is the exact text the officer
//   wants printed, so it is written onto the article in code — the prompt asks, this decides;
//
//   an ANGLE ("शेतकऱ्यांचा फायदा") is a direction for the whole piece. There is nothing to
//   copy anywhere, so it steers through the prompt block alone.
//
// Nothing in Marathi separates the two reliably — an angle is a noun phrase and a headline is
// a clause, and both are fragments. `looksLikeHeadline` is therefore an admitted HEURISTIC,
// sized off the field's own placeholder: enforce from four words up, steer below that. It errs
// toward steering, because writing a two-word noun phrase across the top of a government
// article is a worse failure than declining to.
//
// Runs AFTER the last model call and BEFORE ensureArticleDateline, which then treats the line
// this pass wrote exactly as it would treat the model's own.

import { pathToFileURL } from 'node:url';
import { findHeadlineLine } from './article-dateline.js';

// A headline never closes a sentence (the article-dateline.ts discriminator, restated here
// because this module applies it to the officer's INPUT rather than to the model's output).
const SENTENCE_END = /[.।?!]["'’”)\]]*$/u;
const MARKDOWN_HEADING = /^#{1,6}\s+/u;

// Below these the input reads as an angle, not as a line to print. The field's own placeholder
// — "उदा. कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा" — is 5 words / 44 characters.
const MIN_HEADLINE_WORDS = 4;
const MIN_HEADLINE_CHARS = 15;
// Above this it is a paragraph someone pasted into the wrong box.
const MAX_HEADLINE_CHARS = 200;

export function looksLikeHeadline(heading: string | null | undefined): boolean {
  const text = (heading ?? '').trim();
  if (!text) return false;
  if (text.includes('\n')) return false;
  if (text.length < MIN_HEADLINE_CHARS || text.length > MAX_HEADLINE_CHARS)
    return false;
  if (SENTENCE_END.test(text)) return false;
  return text.split(/\s+/u).filter(Boolean).length >= MIN_HEADLINE_WORDS;
}

// Write the officer's headline onto the article. A no-op unless the input reads as a headline.
//
// The existing line's Markdown marker is PRESERVED rather than normalised: the four prompt
// variants disagree about whether the headline is "# शीर्षक" or a plain first line, and
// silently changing an article's output shape here would change how it renders on the page and
// in the exported PDF. When no headline is found at all — a single-paragraph article — one is
// added as a Markdown heading, which is the only form every downstream consumer reads as a
// heading rather than as body text.
export function ensureArticleHeading(
  article: string,
  heading: string | null | undefined,
): string {
  const wanted = (heading ?? '').trim().replace(/^#{1,6}\s+/u, '');
  const trimmed = article.trim();
  if (!looksLikeHeadline(wanted) || !trimmed) return trimmed;

  const lines = trimmed.split(/\r?\n/);
  const existing = findHeadlineLine(trimmed);
  if (!existing) return `# ${wanted}\n\n${trimmed}`;

  // Already carrying the officer's line (the prompt half worked) — leave it exactly as it is,
  // so this pass cannot churn the marker or the spacing.
  const bare = existing.text.replace(MARKDOWN_HEADING, '').trim();
  if (bare === wanted) return trimmed;

  const marker = MARKDOWN_HEADING.exec(existing.text)?.[0] ?? '';
  lines[existing.index] = `${marker}${wanted}`;
  return lines.join('\n');
}

// Free deterministic harness (no API key, no network, no spend):
//   tsx src/generation/article-heading.ts
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failures = 0;
  const check = (label: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) {
      failures += 1;
      console.error(
        `  FAIL  ${label}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`,
      );
    } else console.log(`  ok    ${label}`);
  };

  const HEADLINE = 'कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा';

  console.log('\n=== headline vs angle ===');
  check(
    'the field’s own placeholder is a headline',
    looksLikeHeadline(HEADLINE),
    true,
  );
  check(
    'a two-word angle is not',
    looksLikeHeadline('शेतकऱ्यांचा फायदा'),
    false,
  );
  check(
    'a closed sentence is not',
    looksLikeHeadline('या योजनेचा लाभ शेतकऱ्यांना होणार आहे.'),
    false,
  );
  check('an empty field is not', looksLikeHeadline('   '), false);
  check('a pasted paragraph is not', looksLikeHeadline('क'.repeat(210)), false);
  check(
    'a multi-line value is not',
    looksLikeHeadline('पहिली ओळ\nदुसरी ओळ'),
    false,
  );

  console.log('\n=== enforcement ===');
  check(
    'a Markdown headline is replaced and keeps its marker',
    ensureArticleHeading('# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.', HEADLINE),
    `# ${HEADLINE}\n\nपहिला परिच्छेद.`,
  );
  check(
    'a PLAIN headline is replaced and stays plain',
    ensureArticleHeading('मॉडेलचे शीर्षक असे आहे\n\nपहिला परिच्छेद.', HEADLINE),
    `${HEADLINE}\n\nपहिला परिच्छेद.`,
  );
  check(
    'an angle changes nothing',
    ensureArticleHeading(
      '# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.',
      'शेतकऱ्यांचा फायदा',
    ),
    '# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.',
  );
  check(
    'no heading changes nothing',
    ensureArticleHeading('# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.', ''),
    '# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.',
  );
  check(
    'a headline-less article gains one as a Markdown heading',
    ensureArticleHeading('एकमेव परिच्छेद आहे.', HEADLINE),
    `# ${HEADLINE}\n\nएकमेव परिच्छेद आहे.`,
  );
  check(
    'the officer’s own "#" prefix is not doubled',
    ensureArticleHeading(
      '# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.',
      `# ${HEADLINE}`,
    ),
    `# ${HEADLINE}\n\nपहिला परिच्छेद.`,
  );
  check(
    'a first PARAGRAPH is never overwritten (it closes its sentence)',
    ensureArticleHeading(
      'राज्यात नवीन केंद्रे सुरू होणार आहेत.\n\nदुसरा परिच्छेद.',
      HEADLINE,
    ),
    `# ${HEADLINE}\n\nराज्यात नवीन केंद्रे सुरू होणार आहेत.\n\nदुसरा परिच्छेद.`,
  );
  check(
    'the body is untouched',
    ensureArticleHeading(
      '# अ\n\nपहिला परिच्छेद.\n\nदुसरा परिच्छेद.',
      HEADLINE,
    ).endsWith('पहिला परिच्छेद.\n\nदुसरा परिच्छेद.'),
    true,
  );
  check(
    'running the pass twice is a no-op',
    ensureArticleHeading(
      ensureArticleHeading('# मॉडेलचे शीर्षक\n\nपहिला परिच्छेद.', HEADLINE),
      HEADLINE,
    ),
    `# ${HEADLINE}\n\nपहिला परिच्छेद.`,
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll article-heading checks passed.');
}
