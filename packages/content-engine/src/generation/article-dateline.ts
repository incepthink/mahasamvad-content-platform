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
// A dateline a MODEL (or an earlier pass) already wrote. It used to recognise only the house
// shape `X, दि. N :`, so every other shape a model actually produces slipped past it and the
// code prepended its own in front — `मुंबई, दि. २३ : **मुंबई, ०७ ऑगस्ट २०२५**` in four of the
// five /dlo outputs of 2026-09-23 (generations 0a516802, 017a…, 2442…, edd2…). Recognised now:
//
//   पुणे, दि. १८ :                    the house shape, bold or not, colon inside or outside
//   **मुंबई, ०७ ऑगस्ट २०२५**           day + month word + year, no दि., no separator
//   जालना, ११ सप्टेंबर २०२६ —           the same with a dash
//   **[स्थळ], दि. [दिनांक] :**          an unfilled placeholder copied out of an instruction
//   मुंबई, दिनांक २३.०९.२०२६ :           a numeric date
//
// What keeps this from eating a real sentence: the date must be followed by a TERMINATOR — a
// colon or dash, a closing bold marker, or the end of the line. `पुणे, दि. ५ रोजी बैठक झाली.`
// has none and is left alone, which is why the old pattern demanded its colon.
const DATELINE_DAY = String.raw`[०-९0-9]{1,2}`;
const DATELINE_YEAR = String.raw`[०-९0-9]{4}`;
const DATELINE_WORD = String.raw`[\p{L}\p{M}]+`;
const DATELINE_PLACEHOLDER = String.raw`\[[^\]\n]{1,24}\]`;
const DATELINE_PLACE = String.raw`(?:${DATELINE_PLACEHOLDER}|[^\n,*_:\[\]।.?!#]{1,40})`;
// Longest alternatives first: the terminator test backtracks into the shorter ones.
const DATELINE_DATE = [
  DATELINE_PLACEHOLDER,
  String.raw`${DATELINE_DAY}\s+${DATELINE_WORD},?\s+${DATELINE_YEAR}`,
  String.raw`${DATELINE_DAY}[./-]${DATELINE_DAY}[./-]${DATELINE_YEAR}`,
  String.raw`${DATELINE_DAY}\s+${DATELINE_WORD}`,
  DATELINE_DAY,
].join('|');
const DATELINE_BOLD = String.raw`(?:\*\*|__)`;
const DATELINE_TERMINATOR = String.raw`(?:${DATELINE_BOLD}\s*(?:[:–—]\s*)?|[:–—]\s*(?:${DATELINE_BOLD})?|$)`;
// Trailing `\s*` already covers U+00A0, which a bold dateline is often followed by.
const EXISTING_DATELINE = new RegExp(
  String.raw`^${DATELINE_BOLD}?\s*${DATELINE_PLACE},\s*(?:दि(?:नांक)?\.?\s*)?(?:${DATELINE_DATE})\s*${DATELINE_TERMINATOR}\s*`,
  'u',
);
const MARKDOWN_HEADING = /^#{1,6}\s+/u;
// A Marathi news headline is a fragment: it carries no closing full stop, danda, question or
// exclamation mark. A body paragraph always closes one. That is the discriminator used below,
// and it is the only reliable one — length is not (a real DGIPR headline runs past 110
// characters) and the Markdown marker is not (three of the four prompt variants ask for the
// headline as a plain first line, so `#` is present only sometimes).
const SENTENCE_END = /[.।?!]["'’”)\]]*$/u;

/**
 * Removes a leading dateline, keeping a Markdown heading marker in front of it. Returns the line
 * unchanged when it does not open with one, and '' when the dateline was the whole line.
 */
function stripDateline(line: string): string {
  const heading = /^(#{1,6}\s+)/u.exec(line)?.[1] ?? '';
  const rest = line.slice(heading.length);
  const match = EXISTING_DATELINE.exec(rest);
  if (!match) return line;
  // Without `दि.` a dateline must carry a year or be a placeholder; otherwise `पुणे, २ लाख` or
  // `नागपूर, ५ :` in running prose would read as one.
  if (!/,\s*दि/u.test(match[0]) && !/[०-९0-9]{4}|\[/u.test(match[0])) {
    return line;
  }
  const stripped = rest.slice(match[0].length);
  return stripped ? `${heading}${stripped}` : '';
}

function isDatelineOnly(line: string): boolean {
  return line.length > 0 && stripDateline(line) === '';
}

// The bold/italic wrapper a model puts round a subheadline, so the sentence test sees the text.
function unwrapEmphasis(line: string): string {
  return line
    .replace(/^(?:\*\*|__|\*|_)+/u, '')
    .replace(/(?:\*\*|__|\*|_)+$/u, '')
    .trim();
}

// A line under the headline that is article FURNITURE — a deck/subheadline — rather than the
// first body paragraph. A Marathi subheadline is a fragment, like the headline: it closes no
// sentence. Generation 0a516802 wrote one as a plain line (`१ सप्टेंबर पासून …`), which the
// old "first non-# line is the body" rule turned into `मुंबई, दि. २३ : १ सप्टेंबर …`.
// Bounded in length so a whole unpunctuated paragraph is never mistaken for one, and a list
// item is never one.
const FURNITURE_MAX_CHARS = 220;
function isFurniture(line: string): boolean {
  const text = unwrapEmphasis(line);
  if (!text || text.length > FURNITURE_MAX_CHARS) return false;
  if (/^(?:[-*+•]|[०-९0-9]+[.)])\s/u.test(line)) return false;
  return !SENTENCE_END.test(text);
}

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
  const filled = filledLines(lines);
  if (filled.length === 0) return `${trimmed}\n\n${dateline.text}`;

  const headline = headlineIndex(filled);
  // Lines removed outright: a dateline standing on its own line. Deleting it rather than
  // leaving it is what stops `मुंबई, दि. २९ : **मुंबई, ०७ ऑगस्ट २०२५**` — the model's own
  // dateline survives nowhere, and the platform's is written exactly once, on the body.
  const drop = new Set<number>();
  let placed = false;

  for (const [position, line] of filled.entries()) {
    const stripped = stripDateline(line.value);
    if (stripped === '') {
      drop.add(line.index);
      continue;
    }
    // Self-healing: a dateline that landed on the headline, a deck or a subheadline is taken
    // off it. Without this, re-running the pass over such an article would only add a second
    // dateline to the body and leave the broken line standing.
    if (line.index === headline || MARKDOWN_HEADING.test(line.value)) {
      lines[line.index] = stripped;
      continue;
    }
    // A deck/subheadline between the headline and the lead is article furniture, not the
    // first body paragraph — but only when a real paragraph follows it, or a one-paragraph
    // article that happens to lack a full stop would never get its dateline.
    if (
      headline !== null &&
      isFurniture(stripped) &&
      filled
        .slice(position + 1)
        .some(
          (later) =>
            !MARKDOWN_HEADING.test(later.value) &&
            SENTENCE_END.test(unwrapEmphasis(stripDateline(later.value))),
        )
    ) {
      lines[line.index] = stripped;
      continue;
    }
    lines[line.index] = `${dateline.text} ${stripped.trimStart()}`;
    placed = true;
    break;
  }

  const kept = lines.filter((_, index) => !drop.has(index));
  // A removed line leaves its blank neighbours behind; collapse them back to one blank line.
  const joined = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return placed ? joined : `${joined}\n\n${dateline.text}`;
}

function filledLines(
  lines: readonly string[],
): Array<Readonly<{ index: number; value: string }>> {
  return lines
    .map((value, index) => ({ index, value: value.trim() }))
    .filter((line) => line.value.length > 0);
}

// The headline as a caller outside this module sees it: which line it is, and what it says.
// Exported so ensureArticleHeading (article-heading.ts) shares this detection rather than
// re-deriving it — the two passes must agree about which line is the headline, or one would
// replace the line the other datelined.
export function findHeadlineLine(
  article: string,
): Readonly<{ index: number; text: string }> | null {
  const lines = article.trim().split(/\r?\n/);
  const index = headlineIndex(filledLines(lines));
  if (index === null) return null;
  return { index, text: lines[index]?.trim() ?? '' };
}

// Which line — if any — is the article's headline rather than its first body paragraph.
//
// This used to be "the first line that is not a Markdown heading", which was correct only while
// every prompt variant happened to emit `# शीर्षक`. The no-reference specification asks for the
// headline as a PLAIN first line, so that test made the headline itself look like the body and
// the dateline was prefixed to it — the exact defect this function now prevents.
//
// A line that is ONLY a dateline is never the headline: a model that opens with
// `**मुंबई, ०७ ऑगस्ट २०२५**` and puts its headline underneath has still written a headline.
function headlineIndex(
  filled: readonly Readonly<{ index: number; value: string }>[],
): number | null {
  const candidates = filled.filter((line) => !isDatelineOnly(line.value));
  const first = candidates[0];
  if (!first) return null;
  if (MARKDOWN_HEADING.test(first.value)) return first.index;

  // A plain headline is only recognisable in contrast: it must be a standalone opening line
  // with an article underneath it, and it must not close a sentence. A one-paragraph article
  // therefore has no headline, and a first paragraph is never mistaken for one.
  if (candidates.length < 2) return null;
  const withoutDateline = unwrapEmphasis(stripDateline(first.value));
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
    'a Markdown deck is kept and the bold source dateline beneath it is replaced',
    ensureArticleDateline(
      '# दहावीच्या फेब्रुवारी-मार्च २०२७ परीक्षेसाठी\n\n## ऑनलाइन अर्ज भरण्यास १९ ऑगस्टपासून प्रारंभ\n\n**पुणे, दि. १८ :**\u00a0महाराष्ट्र राज्य मंडळामार्फत अर्ज स्वीकारले जातील.',
      'news',
      { now },
    ),
    '# दहावीच्या फेब्रुवारी-मार्च २०२७ परीक्षेसाठी\n\n## ऑनलाइन अर्ज भरण्यास १९ ऑगस्टपासून प्रारंभ\n\nमुंबई, दि. २९ : महाराष्ट्र राज्य मंडळामार्फत अर्ज स्वीकारले जातील.',
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

  // The four shapes of 2026-09-23 (plan: Gemma ↔ GPT gap, diagnosis #1). Each used to come
  // back as `मुंबई, दि. २९ : <the model's own dateline> …`.
  check(
    'a bold standalone dateline with a full date is removed, not prefixed',
    ensureArticleDateline(
      '### ग्रामीण रस्त्यांसाठी निधी मंजूर\n\n**मुंबई, ०७ ऑगस्ट २०२५**\n\nराज्य शासनाने निधी मंजूर केला आहे.',
      'news',
      { now },
    ),
    '### ग्रामीण रस्त्यांसाठी निधी मंजूर\n\nमुंबई, दि. २९ : राज्य शासनाने निधी मंजूर केला आहे.',
  );
  check(
    'a no-दि. dateline opening the body paragraph is replaced',
    ensureArticleDateline(
      '## कुणबी दाखल्यांसाठी विशेष शिबिरे\n\nजालना, ११ सप्टेंबर २०२६ : जिल्ह्यात शिबिरे घेण्यात आली.',
      'news',
      { now },
    ),
    '## कुणबी दाखल्यांसाठी विशेष शिबिरे\n\nमुंबई, दि. २९ : जिल्ह्यात शिबिरे घेण्यात आली.',
  );
  check(
    'a dashed dateline is replaced',
    ensureArticleDateline(
      '# शीर्षक\n\nजालना, ११ सप्टेंबर २०२६ — जिल्ह्यात शिबिरे घेण्यात आली.',
      'news',
      { now },
    ),
    '# शीर्षक\n\nमुंबई, दि. २९ : जिल्ह्यात शिबिरे घेण्यात आली.',
  );
  check(
    'an unfilled placeholder dateline is removed',
    ensureArticleDateline(
      '## महसूल लोक अदालत मोहीम\n\n**[स्थळ], दि. [दिनांक] :** राज्यात मोहीम राबवली जाणार आहे.',
      'news',
      { now },
    ),
    '## महसूल लोक अदालत मोहीम\n\nमुंबई, दि. २९ : राज्यात मोहीम राबवली जाणार आहे.',
  );
  check(
    'a PLAIN subheadline is furniture: the dateline goes on the paragraph under it',
    ensureArticleDateline(
      '## राणी दुर्गावती योजनेला मंजुरी\n\n१ सप्टेंबर पासून अर्ज प्रक्रिया सुरू\n\nआदिवासी विकास विभागाने योजना जाहीर केली आहे.',
      'news',
      { now },
    ),
    '## राणी दुर्गावती योजनेला मंजुरी\n\n१ सप्टेंबर पासून अर्ज प्रक्रिया सुरू\n\nमुंबई, दि. २९ : आदिवासी विकास विभागाने योजना जाहीर केली आहे.',
  );
  check(
    'a dateline that landed on a subheadline (0a516802) heals onto the body',
    ensureArticleDateline(
      '## राणी दुर्गावती योजनेला मंजुरी\n\nमुंबई, दि. २३ : १ सप्टेंबर पासून अर्ज प्रक्रिया सुरू\n\nआदिवासी विकास विभागाने योजना जाहीर केली आहे.',
      'news',
      { now },
    ),
    '## राणी दुर्गावती योजनेला मंजुरी\n\n१ सप्टेंबर पासून अर्ज प्रक्रिया सुरू\n\nमुंबई, दि. २९ : आदिवासी विकास विभागाने योजना जाहीर केली आहे.',
  );
  check(
    'a bold subheadline is furniture too',
    ensureArticleDateline(
      '### *निधी मंजूर – मुख्यमंत्री*\n\n**लाभार्थ्यांना थेट लाभ**\n\nपहिला परिच्छेद.',
      'news',
      { now },
    ),
    '### *निधी मंजूर – मुख्यमंत्री*\n\n**लाभार्थ्यांना थेट लाभ**\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'a dateline written ABOVE the headline is removed and the headline still recognised',
    ensureArticleDateline(
      '**मुंबई, ०७ ऑगस्ट २०२५**\n\nनागरी आव्हान निधीला मान्यता\n\nपहिला परिच्छेद.',
      'news',
      { now },
    ),
    'नागरी आव्हान निधीला मान्यता\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  check(
    'a numeric दिनांक dateline is replaced',
    ensureArticleDateline(
      '# शीर्षक\n\nमुंबई, दिनांक २३.०९.२०२६ : पहिला परिच्छेद.',
      'news',
      { now },
    ),
    '# शीर्षक\n\nमुंबई, दि. २९ : पहिला परिच्छेद.',
  );
  // What must NOT be read as a dateline.
  check(
    'a sentence opening with a place and दि. but no terminator is left alone',
    ensureArticleDateline('# शीर्षक\n\nपुणे, दि. ५ रोजी बैठक झाली.', 'news', {
      now,
    }),
    '# शीर्षक\n\nमुंबई, दि. २९ : पुणे, दि. ५ रोजी बैठक झाली.',
  );
  check(
    'a place and an amount are not a dateline',
    ensureArticleDateline(
      '# शीर्षक\n\nपुणे, २ लाख नागरिकांना लाभ मिळणार आहे.',
      'news',
      { now },
    ),
    '# शीर्षक\n\nमुंबई, दि. २९ : पुणे, २ लाख नागरिकांना लाभ मिळणार आहे.',
  );
  check(
    'a list under the headline is body, not furniture',
    ensureArticleDateline(
      '# शीर्षक\n\n- पहिला मुद्दा\n\nदुसरा परिच्छेद.',
      'news',
      { now },
    ),
    '# शीर्षक\n\nमुंबई, दि. २९ : - पहिला मुद्दा\n\nदुसरा परिच्छेद.',
  );
  check(
    'the healed article is stable under a second pass',
    ensureArticleDateline(
      ensureArticleDateline(
        '### ग्रामीण रस्त्यांसाठी निधी मंजूर\n\n**मुंबई, ०७ ऑगस्ट २०२५**\n\nराज्य शासनाने निधी मंजूर केला आहे.',
        'news',
        { now },
      ),
      'news',
      { now },
    ),
    '### ग्रामीण रस्त्यांसाठी निधी मंजूर\n\nमुंबई, दि. २९ : राज्य शासनाने निधी मंजूर केला आहे.',
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll dateline checks passed.');
}
