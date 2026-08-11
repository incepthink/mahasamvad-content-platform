// A length the officer asked for, and the deterministic loop that tries to hit it.
//
// Why this module exists: until now EVERY statement about article length in this repo was
// prose. The specification says "the article's length does not matter"; an officer writing
// "बातमी १२०० अक्षरांची हवी" in तुमची विनंती or in the feedback box was one line of a user
// message arguing with a system-message absolute, and nothing anywhere ever counted a
// character. Models are poor at hitting an exact count unaided, so the request could only ever
// be approximate — measured in production at 400 and then 700 characters against an ask of
// 1200.
//
// So this follows the repo's standing shape for a hard requirement: an instruction steers
// (`lengthRequirementBlock`, rendered into the prompt beside the officer's own words) and a
// deterministic pass guarantees (`fitArticleToLength`: measure, and on a miss buy ONE bounded
// rewrite). It is the same measure-then-rewrite loop as video/shorten-narration.ts.
//
// The boundary that does NOT move: a length is reached by covering the supplied information
// more fully, never by inventing or padding. When the source cannot honestly fill the ask, the
// article stops short and the officer is TOLD (`LengthWarning`) rather than handed filler.

import { pathToFileURL } from 'node:url';
// The reported shape lives in @dgipr/schemas: the engine produces it, the API payload carries
// it and apps/web renders it, and apps/web cannot import this package.
import type { LengthWarning } from '@dgipr/schemas';
import { buildSystemPrompt, type ArticleCategory } from './category-prompt.js';
import {
  ARTICLE_BODY_MAX_TOKENS,
  chatComplete,
  type ChatMessage,
} from './openai-chat.js';

export type { LengthWarning };
export type LengthUnit = LengthWarning['unit'];

export type LengthRequest = Readonly<{
  value: number;
  unit: LengthUnit;
  // The phrase the number was read out of, for the log. Never shown to the model — the
  // officer's own wording already reaches it verbatim in its own block.
  matched: string;
}>;

// How far from the ask still counts as honouring it. An officer typing a round number means
// "about this long", and a tighter band would buy a rewrite call for a difference nobody can
// see.
export const LENGTH_TOLERANCE = 0.15;

// Sanity bounds. A number outside these is not a length request — it is a year, an amount, a
// beneficiary count or a scheme number that happened to sit next to a word we recognise.
const BOUNDS: Record<LengthUnit, Readonly<{ min: number; max: number }>> = {
  chars: { min: 100, max: 20_000 },
  words: { min: 20, max: 5_000 },
};

const DIGITS = /^[०-९0-9][०-९0-9,]*$/u;

function toLatinDigits(value: string): string {
  return value.replace(/[०-९]/gu, (digit) =>
    String('०१२३४५६७८९'.indexOf(digit)),
  );
}

function parseNumber(raw: string): number | null {
  if (!DIGITS.test(raw)) return null;
  const value = Number(toLatinDigits(raw).replace(/,/gu, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Which unit — if any — a word names. Marathi declines the head noun as a suffix
// (अक्षरे / अक्षरांची / अक्षरांचा / अक्षरांत / अक्षरी), so this is a stem test, not a word list.
function unitOf(word: string): LengthUnit | null {
  const lower = word.toLowerCase();
  if (word.startsWith('अक्षर') || /^char(?:acter)?s?$/u.test(lower))
    return 'chars';
  if (word.startsWith('शब्द') || /^words?$/u.test(lower)) return 'words';
  return null;
}

// NUMBER [range NUMBER] UNIT — "१२०० अक्षरे", "1200 characters", "1000 ते 1200 अक्षरांची",
// "350-400 शब्द". A range takes its UPPER bound: an officer writing a range is stating the
// length they want the article to reach.
const NUMBER_THEN_UNIT =
  /([०-९0-9][०-९0-9,]*)\s*(?:(?:ते|पर्यंत|to|[-–—])\s*([०-९0-9][०-९0-9,]*)\s*)?([\p{L}\p{M}]+)/gu;

// UNIT [:] NUMBER — "शब्दमर्यादा ३५०", "character limit 1200". Less common, but it is how a
// limit tends to be written down rather than asked for.
const UNIT_THEN_NUMBER =
  /([\p{L}\p{M}]+)\s*(?:मर्यादा|संख्या|limit|count)?\s*[:：]?\s*([०-९0-9][०-९0-9,]*)/gu;

// Read a length ask out of free text — the officer's request or their feedback. Returns null
// for text that names no length, which is the overwhelmingly common case and must stay free.
export function parseLengthRequest(
  text: string | null | undefined,
): LengthRequest | null {
  const source = (text ?? '').trim();
  if (!source) return null;

  for (const match of source.matchAll(NUMBER_THEN_UNIT)) {
    const unit = unitOf(match[3] ?? '');
    if (!unit) continue;
    const lower = parseNumber(match[1] ?? '');
    const upper = match[2] ? parseNumber(match[2]) : null;
    const value = upper ?? lower;
    if (value === null) continue;
    const bounds = BOUNDS[unit];
    if (value < bounds.min || value > bounds.max) continue;
    return { value, unit, matched: match[0].trim() };
  }

  for (const match of source.matchAll(UNIT_THEN_NUMBER)) {
    const unit = unitOf(match[1] ?? '');
    if (!unit) continue;
    const value = parseNumber(match[2] ?? '');
    if (value === null) continue;
    const bounds = BOUNDS[unit];
    if (value < bounds.min || value > bounds.max) continue;
    return { value, unit, matched: match[0].trim() };
  }

  return null;
}

// What the officer counts. Markdown heading markers are stripped because they are our output
// shape, not the officer's text, and a run counted with them would drift by two characters per
// heading against what the page shows.
export function measureArticleLength(
  article: string,
  unit: LengthUnit,
): number {
  const text = article
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s+/u, ''))
    .join('\n')
    .trim();
  if (unit === 'words')
    return text.length === 0 ? 0 : text.split(/\s+/u).filter(Boolean).length;
  return [...text].length;
}

export type LengthVerdict = 'ok' | 'short' | 'long';

export function lengthVerdict(
  article: string,
  request: LengthRequest,
  tolerance = LENGTH_TOLERANCE,
): LengthVerdict {
  const actual = measureArticleLength(article, request.unit);
  if (actual < Math.round(request.value * (1 - tolerance))) return 'short';
  if (actual > Math.round(request.value * (1 + tolerance))) return 'long';
  return 'ok';
}

const UNIT_LABEL: Record<LengthUnit, string> = {
  chars: 'characters',
  words: 'words',
};

// The instruction half. Rendered beside the officer's own words so the number is unmissable,
// and stating on the spot how the length may and may not be reached — without that, "write
// 1200 characters" and "never add unsupported information" read as a contradiction the model
// has to resolve on its own.
export function lengthRequirementBlock(
  request: LengthRequest | null,
): string[] {
  if (!request) return [];
  return [
    '### LENGTH REQUIREMENT',
    '',
    `The officer asked for about ${request.value} ${UNIT_LABEL[request.unit]}. Write the article at`,
    'that length. This is a requirement, not a suggestion, and it overrides any general guidance',
    'above about length not mattering.',
    '',
    'Reach it by covering the supplied information more fully and explaining it more completely —',
    'never by repeating yourself, padding with empty phrases, or adding anything the supplied',
    'information does not support. If the supplied information cannot honestly fill that length,',
    'write the fullest accurate article it supports and stop.',
    '',
  ];
}

const UNIT_LABEL_MR: Record<LengthUnit, string> = {
  chars: 'अक्षरे',
  words: 'शब्द',
};

// The rewrite the measurement buys. Deliberately the CATEGORY system prompt (as
// buildInjectMessages already does), so the second pass stays in the same DGIPR voice as the
// first — the TASK carries the correction and sits last, where it weights most.
function buildFitMessages(
  article: string,
  source: string,
  request: LengthRequest,
  verdict: LengthVerdict,
  category: ArticleCategory,
): ChatMessage[] {
  const actual = measureArticleLength(article, request.unit);
  const unit = UNIT_LABEL_MR[request.unit];

  const userPrompt = [
    '<SOURCE purpose="only_authoritative_fact_source">',
    source.trim(),
    '</SOURCE>',
    '',
    '<CURRENT_ARTICLE purpose="draft_to_rewrite_not_fact_source">',
    article.trim(),
    '</CURRENT_ARTICLE>',
    '',
    '<TASK>',
    `अधिकाऱ्याने सुमारे ${request.value} ${unit} लांबीची बातमी मागितली आहे; सध्याचा लेख ${actual} ${unit} आहे.`,
    'तोच लेख त्या लांबीत पुन्हा लिहा.',
    '',
    'नियम:',
    verdict === 'short'
      ? '१. लांबी वाढवताना SOURCE मधील आधीच वापरलेली माहिती अधिक पूर्णपणे, अधिक स्पष्ट करून मांडा आणि SOURCE मधील अजून न वापरलेली संबंधित माहिती समाविष्ट करा.'
      : '१. लांबी कमी करताना दुय्यम तपशील संक्षिप्त करा; ठळक व नागरिकाभिमुख माहिती मात्र वगळू नका.',
    '२. SOURCE मध्ये नसलेले कोणतेही नवीन तथ्य, नाव, तारीख, रक्कम, पदनाम, ठिकाण, योजना, दावा, quote किंवा byline जोडू नका.',
    '३. केवळ लांबी गाठण्यासाठी पुनरावृत्ती, पोकळ वाक्ये किंवा भरतीचा मजकूर वापरू नका.',
    `४. SOURCE मध्ये एवढी माहिती नसेल तर जेवढी अचूक माहिती आहे तेवढ्यावरच थांबा — ${request.value} ${unit} गाठण्यासाठी काहीही तयार करू नका.`,
    '५. शीर्षक, शैली, रचना आणि देवनागरी लिपी तशीच ठेवा.',
    '६. फक्त सुधारित लेख द्या; स्पष्टीकरण, टिपणी किंवा विभाजक जोडू नका.',
    '</TASK>',
  ].join('\n');

  return [
    { role: 'system', content: buildSystemPrompt(category) },
    { role: 'user', content: userPrompt },
  ];
}

export type LengthFitResult = Readonly<{
  article: string;
  warning: LengthWarning | null;
}>;

// Measure, and on a miss buy ONE rewrite. Bounded at one attempt on purpose: this is a paid
// call on an article the officer is already waiting for, and a second pass buys far less than
// the first. A rewrite that comes back WORSE than what it replaced is discarded — a
// best-effort step must never make the deliverable worse (the shorten-narration.ts rule).
export async function fitArticleToLength(
  article: string,
  source: string,
  request: LengthRequest | null,
  category: ArticleCategory,
): Promise<LengthFitResult> {
  if (!request) return { article, warning: null };

  const verdict = lengthVerdict(article, request);
  if (verdict === 'ok') return { article, warning: null };

  const before = measureArticleLength(article, request.unit);
  console.log(
    `[article-length] ${before} ${request.unit} vs requested ${request.value} (${verdict}); rewriting once...`,
  );

  let fitted = article;
  try {
    const rewritten = (
      await chatComplete(
        buildFitMessages(article, source, request, verdict, category),
        { maxTokens: ARTICLE_BODY_MAX_TOKENS },
      )
    ).trim();
    // Closer to the ask than what it replaced, or it is thrown away.
    const gap = (text: string): number =>
      Math.abs(measureArticleLength(text, request.unit) - request.value);
    if (rewritten && gap(rewritten) < gap(article)) fitted = rewritten;
    else
      console.warn(
        '[article-length] the rewrite did not get closer to the requested length; keeping the original',
      );
  } catch (error) {
    // The article is already written and paid for. A failed fit costs the length, never the run.
    console.warn(
      '[article-length] length fit failed; keeping the original',
      error,
    );
  }

  const actual = measureArticleLength(fitted, request.unit);
  const warning =
    lengthVerdict(fitted, request) === 'ok'
      ? null
      : { requested: request.value, unit: request.unit, actual };
  if (warning)
    console.warn(
      `[article-length] still ${actual} ${request.unit} against ${request.value}; reporting to the officer`,
    );
  return { article: fitted, warning };
}

// Free deterministic harness (no API key, no network, no spend):
//   tsx src/generation/article-length.ts
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
  const parsed = (text: string): string => {
    const request = parseLengthRequest(text);
    return request ? `${request.value}:${request.unit}` : 'null';
  };

  console.log('\n=== a length ask is read out of Marathi and English ===');
  check(
    'Latin digits + English unit',
    parsed('write it in 1200 characters') === '1200:chars',
  );
  check(
    'Devanagari digits + Marathi unit',
    parsed('बातमी १२०० अक्षरांची हवी') === '1200:chars',
  );
  check('Marathi words', parsed('साधारण ३५० शब्दांत लिहा') === '350:words');
  check('English words', parsed('about 350 words please') === '350:words');
  check('a comma-grouped number', parsed('1,200 characters') === '1200:chars');
  check(
    'an inflected Marathi unit',
    parsed('१२०० अक्षरांचा लेख तयार करा') === '1200:chars',
  );
  check('unit before the number', parsed('शब्दमर्यादा ३५०') === '350:words');
  check(
    'a range takes its upper bound',
    parsed('१००० ते १२०० अक्षरे') === '1200:chars',
  );
  check('a hyphenated range', parsed('350-400 words') === '400:words');

  console.log('\n=== ordinary text names no length ===');
  check('a style request', parsed('शासकीय शैलीत बातमी तयार करा.') === 'null');
  check(
    'a year is not a length',
    parsed('२०२६ मध्ये योजना सुरू झाली') === 'null',
  );
  check('an amount is not a length', parsed('५० कोटी रुपये मंजूर') === 'null');
  check('empty text', parsed('') === 'null');
  check(
    'a number below the sane floor is not a length',
    parsed('20 characters') === 'null',
  );
  check(
    'a number above the sane ceiling is not a length',
    parsed('५०००० अक्षरे') === 'null',
  );
  check(
    'a length is still found inside a longer request',
    parsed(
      'भाषा सोपी ठेवा; बातमी सुमारे १२०० अक्षरांची हवी; समिती सदस्य टाळा.',
    ) === '1200:chars',
  );

  console.log('\n=== measurement ===');
  check(
    'heading markers are not counted',
    measureArticleLength('# अब\n\nकड', 'chars') ===
      measureArticleLength('अब\n\nकड', 'chars'),
  );
  check(
    'words are whitespace-separated',
    measureArticleLength('एक दोन  तीन', 'words') === 3,
  );
  check(
    'a Devanagari conjunct counts as its own characters, not bytes',
    measureArticleLength('कर्ज', 'chars') === 4,
  );

  console.log('\n=== the verdict band ===');
  const request: LengthRequest = { value: 1000, unit: 'chars', matched: '' };
  check(
    'exactly on target is ok',
    lengthVerdict('क'.repeat(1000), request) === 'ok',
  );
  check(
    'inside the band is ok',
    lengthVerdict('क'.repeat(900), request) === 'ok',
  );
  check(
    'well under is short',
    lengthVerdict('क'.repeat(400), request) === 'short',
  );
  check(
    'well over is long',
    lengthVerdict('क'.repeat(1400), request) === 'long',
  );

  console.log('\n=== the prompt block ===');
  const block = lengthRequirementBlock(request).join('\n');
  check(
    'no block without a request',
    lengthRequirementBlock(null).length === 0,
  );
  check(
    'the number reaches the model',
    block.includes('about 1000 characters'),
  );
  check(
    'it says it outranks the general length guidance',
    block.includes('overrides any general guidance'),
  );
  check(
    'it says how the length may NOT be reached',
    block.includes('never by repeating yourself, padding with empty phrases'),
  );
  check(
    'it permits stopping short rather than inventing',
    block.includes('cannot honestly fill that length'),
  );

  if (failures > 0) process.exitCode = 1;
  else console.log('\nAll article-length checks passed.');
}
