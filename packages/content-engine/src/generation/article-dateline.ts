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
  const bodyLine = lines.findIndex((line) => {
    const value = line.trim();
    return value.length > 0 && !/^#{1,6}\s+/u.test(value);
  });
  if (bodyLine < 0) return `${trimmed}\n\n${dateline.text}`;

  const body = lines[bodyLine]?.trim() ?? '';
  const withoutOldDateline = body.replace(EXISTING_DATELINE, '').trimStart();
  lines[bodyLine] = withoutOldDateline
    ? `${dateline.text} ${withoutOldDateline}`
    : dateline.text;
  return lines.join('\n');
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

  if (failures > 0) process.exitCode = 1;
}
