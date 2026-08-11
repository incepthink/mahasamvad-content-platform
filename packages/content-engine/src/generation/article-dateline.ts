// DGIPR news copies carry a dateline at the start of the article body. The model sees the
// expected value in its prompt, but this deterministic pass is the publication guarantee:
// generation and feedback revisions cannot accidentally omit it or retain yesterday's date.

import type { ArticleCategory } from './category-prompt.js';

export const DEFAULT_NEWS_DATELINE_LOCATION = 'मुंबई';
export const NEWS_DATELINE_TIME_ZONE = 'Asia/Kolkata';

const DEVANAGARI_DIGITS = [
  '०',
  '१',
  '२',
  '३',
  '४',
  '५',
  '६',
  '७',
  '८',
  '९',
] as const;
const EXISTING_DATELINE =
  /^.{1,80}?,\s*दि\.?\s*[०-९0-9]{1,2}(?:\s+[\p{L}\p{M}]+\s+[०-९0-9]{4})?\s*:\s*/u;

const MARKDOWN_HEADING = /^#{1,6}\s+/u;
// A Marathi news headline is a fragment: it carries no closing full stop, danda, question or
// exclamation mark. A body paragraph always closes one. That is the discriminator used below,
// and it is the only reliable one — length is not (a real DGIPR headline runs past 110
// characters) and the Markdown marker is not (three of the four prompt variants ask for the
// headline as a plain first line, so `#` is present only sometimes).
const SENTENCE_END = /[.।?!]["'’”)\]]*$/u;

function toDevanagariDigits(value: string): string {
  return value.replace(
    /\d/g,
    (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit,
  );
}

export type ArticleDateline = Readonly<{
  location: string;
  date: string;
  text: string;
}>;

export function currentArticleDateline(
  category: ArticleCategory,
  options: Readonly<{
    now?: Date;
    location?: string;
    timeZone?: string;
  }> = {},
): ArticleDateline | null {
  if (category !== 'news') return null;

  const location =
    options.location?.trim() ||
    process.env.ARTICLE_NEWS_DATELINE_LOCATION?.trim() ||
    DEFAULT_NEWS_DATELINE_LOCATION;
  const day = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    timeZone: options.timeZone ?? NEWS_DATELINE_TIME_ZONE,
  }).format(options.now ?? new Date());
  const date = toDevanagariDigits(day);
  return { location, date, text: `${location}, दि. ${date} :` };
}

export function ensureArticleDateline(
  article: string,
  category: ArticleCategory,
  options: Readonly<{
    now?: Date;
    location?: string;
    timeZone?: string;
  }> = {},
): string {
  const dateline = currentArticleDateline(category, options);
  const trimmed = article.trim();
  if (!dateline || !trimmed) return trimmed;

  const lines = trimmed.split(/\r?\n/);
  const filled = lines
    .map((line, index) => ({ index, value: line.trim() }))
    .filter((line) => line.value.length > 0);
  if (filled.length === 0) return `${trimmed}\n\n${dateline.text}`;

  const headline = headlineIndex(filled);
  const body = filled.find((line) => line.index > (headline ?? -1));
  if (!body) return `${trimmed}\n\n${dateline.text}`;

  // Self-healing: a run that put the dateline on the headline (see headlineIndex) has it
  // removed from there. Without this, re-running the pass over such an article would only add
  // a second dateline to the body and leave the broken headline standing.
  if (headline !== null) {
    const stripped =
      lines[headline]?.trim().replace(EXISTING_DATELINE, '') ?? '';
    if (stripped) lines[headline] = stripped;
  }

  const withoutOldDateline = body.value
    .replace(EXISTING_DATELINE, '')
    .trimStart();
  lines[body.index] = withoutOldDateline
    ? `${dateline.text} ${withoutOldDateline}`
    : dateline.text;
  return lines.join('\n');
}

// The headline as a caller outside this module sees it: which line it is, and what it says.
// Exported so ensureArticleHeading (article-heading.ts) shares this detection rather than
// re-deriving it — the two passes must agree about which line is the headline, or one would
// replace the line the other datelined.
export function findHeadlineLine(
  article: string,
): Readonly<{ index: number; text: string }> | null {
  const lines = article.trim().split(/\r?\n/);
  const filled = lines
    .map((value, index) => ({ index, value: value.trim() }))
    .filter((line) => line.value.length > 0);
  const index = headlineIndex(filled);
  if (index === null) return null;
  return { index, text: lines[index]?.trim() ?? '' };
}

// Which line — if any — is the article's headline rather than its first body paragraph.
//
// This used to be "the first line that is not a Markdown heading", which was correct only while
// every prompt variant happened to emit `# शीर्षक`. The no-reference specification asks for the
// headline as a PLAIN first line, so that test made the headline itself look like the body and
// the dateline was prefixed to it — the exact defect this function now prevents.
function headlineIndex(
  filled: readonly Readonly<{ index: number; value: string }>[],
): number | null {
  const first = filled[0];
  if (!first) return null;
  if (MARKDOWN_HEADING.test(first.value)) return first.index;

  // A plain headline is only recognisable in contrast: it must be a standalone opening line
  // with an article underneath it, and it must not close a sentence. A one-paragraph article
  // therefore has no headline, and a first paragraph is never mistaken for one.
  if (filled.length < 2) return null;
  const withoutDateline = first.value.replace(EXISTING_DATELINE, '').trim();
  if (!withoutDateline || SENTENCE_END.test(withoutDateline)) return null;
  return first.index;
}

// Free deterministic harness:
//   tsx src/generation/article-dateline.ts
if (process.argv[1]?.endsWith('article-dateline.ts')) {
  let failures = 0;
  const check = (
    label: string,
    actual: string | null,
    expected: string,
  ): void => {
    if (actual !== expected) {
      failures += 1;
      console.error(
        `  FAIL  ${label}\n    expected: ${expected}\n    actual:   ${actual}`,
      );
    } else {
      console.log(`  ok    ${label}`);
    }
  };
  const now = new Date('2026-07-28T20:30:00.000Z'); // 29 July in Mumbai.

  check(
    'today is calculated in India, not in server UTC',
    currentArticleDateline('news', { now })?.text ?? null,
    'मुंबई, दि. २९ :',
  );
  check(
    'the dateline starts the body after a Markdown headline',
    ensureArticleDateline('# शीर्षक\n\nपहिला परिच्छेद.', 'news', { now }),
    '# शीर्षक\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'an old dateline is replaced rather than duplicated',
    ensureArticleDateline(
      '# शीर्षक\n\nपुणे, दि. २८ : पहिला परिच्छेद.',
      'news',
      {
        now,
      },
    ),
    '# शीर्षक\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'scheme articles are unchanged',
    ensureArticleDateline('# शीर्षक\n\nपहिला परिच्छेद.', 'scheme', { now }),
    '# शीर्षक\n\nपहिला परिच्छेद.',
  );

  // The production defect (generation 0266d4eb): the no-reference specification asks for the
  // headline as a PLAIN first line, so the old "first line without a #" test aimed the dateline
  // straight at the headline.
  check(
    'a PLAIN headline is recognised and left alone',
    ensureArticleDateline(
      'एसटीचा निम्मा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट; मुख्यमंत्र्यांनी घेतला आढावा\n\nपहिला परिच्छेद.',
      'news',
      { now },
    ),
    'एसटीचा निम्मा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट; मुख्यमंत्र्यांनी घेतला आढावा\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'a dateline that landed on a plain headline is moved off it, not duplicated',
    ensureArticleDateline(
      'मुंबई, दि. ५ : एसटीचा निम्मा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट\n\nपुणे, दि. ५ : पहिला परिच्छेद.',
      'news',
      { now },
    ),
    'एसटीचा निम्मा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'a headline-less article still gets its first paragraph datelined',
    ensureArticleDateline('पहिला परिच्छेद.\n\nदुसरा परिच्छेद.', 'news', {
      now,
    }),
    'मुंबई, दि. २९ : पहिला परिच्छेद.\n\nदुसरा परिच्छेद.',
  );
  check(
    'a first PARAGRAPH is never mistaken for a headline (it closes its sentence)',
    ensureArticleDateline(
      'राज्यात नवीन एमआरआय केंद्रे सुरू होणार आहेत.\n\nदुसरा परिच्छेद.',
      'news',
      { now },
    ),
    'मुंबई, दि. २९ : राज्यात नवीन एमआरआय केंद्रे सुरू होणार आहेत.\n\nदुसरा परिच्छेद.',
  );
  check(
    'a one-paragraph article has no headline to protect',
    ensureArticleDateline('एकमेव ओळ', 'news', { now }),
    'मुंबई, दि. २९ : एकमेव ओळ',
  );
  check(
    'a Markdown headline with no body still appends the dateline',
    ensureArticleDateline('# फक्त शीर्षक', 'news', { now }),
    '# फक्त शीर्षक\n\nमुंबई, दि. २९ :',
  );
  check(
    'running the pass twice is a no-op',
    ensureArticleDateline(
      ensureArticleDateline(
        'एसटीचा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट\n\nपहिला परिच्छेद.',
        'news',
        { now },
      ),
      'news',
      { now },
    ),
    'एसटीचा ताफा इलेक्ट्रिक करण्याचे उद्दिष्ट\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll dateline checks passed.');
}
