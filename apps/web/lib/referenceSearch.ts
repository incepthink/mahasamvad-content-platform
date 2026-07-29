// Text search over the master-template library, for BOTH surfaces that show it:
// the create form's संदर्भ टेम्पलेट picker and the /references admin page.
//
// Why this is more than `text.includes(query)`:
//
//   1. The searchable text is bilingual by construction. `layoutSpec.contentSummary`
//      (what the master is ABOUT) is written in Marathi by the vision pass — see
//      analyze-template.ts, which orders it in Devanagari whatever language the poster
//      itself is in — while `layoutSpec.layoutSummary` (how it ARRANGES information) is
//      English by the same prompt. A single folding cannot serve both.
//   2. Marathi queries and Marathi summaries rarely agree on spelling. लाडकी / लाडकीं /
//      लाडकि, कोल्हापूर / कोल्हापुर and शेतकरी / शेतकऱ्यांसाठी all name the same thing, and a
//      literal match returns zero results for every one of those pairs — which on a
//      Devanagari surface reads as "the search is broken", not as "no such template".
//   3. Some officers type on a Latin keyboard ("ladki bahin", "yojana").
//
// So every word — in the query and in the library — is reduced to a CONSONANT SKELETON:
// vowel signs, anusvara, visarga, nukta and virama are dropped, independent vowels
// collapse to one marker, and the retroflex/dental and sibilant pairs Marathi
// transcription blurs (ट/त, ड/द, ण/न, ळ/ल, श/ष/स) fold together. Latin words are
// transliterated into that SAME skeleton, which is what makes "ladki" find लाडकी without
// a transliteration dictionary:
//
//     लाडकी  → ल ड क        "ladki"  → ल ड क
//     शेतकरी → स त क र      "shetkari" → स त क र
//     कोल्हापूर → क ल ह प र   "kolhapur" → क ल ह प र
//
// A Latin word keeps its plain form too, so an English query ("quote", "timeline",
// "stat") still matches the English layoutSummary. Matching is AND across query words
// and OR across fields, scored so that a hit on the subject line outranks a hit on the
// layout prose.
//
// Everything here is pure and synchronous — both pages already hold the whole library in
// state, so search costs no request and no model call. Assertions live beside it in
// referenceSearch.check.ts (`npx tsx apps/web/lib/referenceSearch.check.ts`).

import type { ReferenceImage } from '@dgipr/schemas';

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

// Marks that carry pronunciation but not identity for search: vowel signs
// (U+093A-U+094F, which includes the virama), stress marks, the nukta, the visarga, and
// the zero-width joiners a copy-paste out of Word leaves behind.
//
// The anusvara is deliberately NOT here — see NASAL below.
const DEVANAGARI_DROP = /[ःऺ-ॏ॑-ॗॢॣ‌‍]/;

// मंत्री and मन्त्री are the same word, and a Latin typist writes both as "mantri" — so the
// anusvara becomes a nasal CONSONANT rather than vanishing. Dropping it (the obvious
// reading of "strip the diacritics") is what made "mantrimandal" miss मंत्रिमंडळ.
const NASAL = 'न';

const DEVANAGARI_DIGIT_BASE = 0x0966; // ०

// Independent vowels are LETTERS (a matra is not), so they survive the fold — but only as
// their class, since a skeleton that has dropped every vowel SIGN cannot then insist on
// distinguishing अनुदान from आनुदान.
//
// The class is the SEMIVOWEL, not a single marker, and that is load-bearing: Marathi
// alternates उ/ऊ with व and इ/ई with य across inflections, so पाऊस becomes पावसाच्या. With
// every vowel folded to one marker, पाऊस found none of the five rainfall masters in the
// live library, all of which store the inflected form.
const VOWEL_CLASS: Readonly<Record<string, string>> = {
  ऄ: 'अ',
  अ: 'अ',
  आ: 'अ',
  ऍ: 'अ',
  ऎ: 'अ',
  इ: 'य',
  ई: 'य',
  ए: 'य',
  ऐ: 'य',
  उ: 'व',
  ऊ: 'व',
  ओ: 'व',
  औ: 'व',
  ऑ: 'व',
  ऒ: 'व',
  ऋ: 'र',
  ॠ: 'र',
  ऌ: 'र',
  ॡ: 'र',
};

// The Latin side of the same classes, applied to a word-initial vowel only — Latin does
// not distinguish an independent vowel from a matra, and a medial vowel must keep
// dropping or "shetkari" would stop matching शेतकरी.
const LATIN_INITIAL_VOWEL: Readonly<Record<string, string>> = {
  a: 'अ',
  e: 'य',
  i: 'य',
  o: 'व',
  u: 'व',
};

// Consonants Marathi transcription genuinely blurs. Aspiration is deliberately NOT
// folded (क stays distinct from ख) — it is a real contrast that both Devanagari typists
// and Latin digraphs represent reliably, so folding it would only add false matches.
const CONSONANT_CLASS: Readonly<Record<string, string>> = {
  // retroflex → dental
  ट: 'त',
  ठ: 'थ',
  ड: 'द',
  ढ: 'ध',
  ण: 'न',
  // precomposed nukta forms (NFC keeps these as single code points)
  क़: 'क',
  ख़: 'ख',
  ग़: 'ग',
  ज़: 'ज',
  ड़: 'द',
  ढ़: 'ध',
  फ़: 'फ',
  य़: 'य',
  ऩ: 'न',
  ऱ: 'र',
  // sibilants
  श: 'स',
  ष: 'स',
  // laterals
  ळ: 'ल',
  ऴ: 'ल',
  // nasals that only ever appear as conjunct heads
  ङ: 'न',
  ञ: 'न',
};

/** One Devanagari word → its consonant skeleton. */
function foldDevanagari(word: string): string {
  let out = '';
  for (const char of word.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if (char >= '0' && char <= '9') {
      out += char;
      continue;
    }
    if (code >= DEVANAGARI_DIGIT_BASE && code <= DEVANAGARI_DIGIT_BASE + 9) {
      out += String(code - DEVANAGARI_DIGIT_BASE);
      continue;
    }
    if (char === 'ं' || char === 'ँ' || char === 'ऀ') {
      out += NASAL;
      continue;
    }
    if (DEVANAGARI_DROP.test(char)) continue;
    const vowel = VOWEL_CLASS[char];
    if (vowel !== undefined) {
      out += vowel;
      continue;
    }
    if (code < 0x0900 || code > 0x097f) continue;
    out += CONSONANT_CLASS[char] ?? char;
  }
  return out;
}

// Latin → the same skeleton. Longest digraph first; the vowels are dropped exactly as
// the Devanagari fold drops matras, so the two sides meet in the middle.
const LATIN_CLUSTERS: ReadonlyArray<readonly [string, string]> = [
  ['chh', 'च'],
  ['ksh', 'कस'],
  ['shr', 'सर'],
  ['gy', 'गय'],
  ['ch', 'च'],
  ['sh', 'स'],
  ['kh', 'ख'],
  ['gh', 'घ'],
  ['jh', 'झ'],
  ['th', 'थ'],
  ['dh', 'ध'],
  ['ph', 'फ'],
  ['bh', 'भ'],
  ['ng', 'न'],
  ['ny', 'न'],
];

const LATIN_SINGLE: Readonly<Record<string, string>> = {
  k: 'क',
  c: 'क',
  q: 'क',
  g: 'ग',
  j: 'ज',
  z: 'ज',
  t: 'त',
  d: 'द',
  n: 'न',
  p: 'प',
  f: 'फ',
  b: 'ब',
  m: 'म',
  y: 'य',
  r: 'र',
  l: 'ल',
  v: 'व',
  w: 'व',
  s: 'स',
  h: 'ह',
  x: 'कस',
};

const LATIN_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

const isLatinConsonant = (char: string | undefined): boolean =>
  char !== undefined && char >= 'a' && char <= 'z' && !LATIN_VOWELS.has(char);

/** One Latin word → the Devanagari consonant skeleton it would transliterate to. */
function transliterateLatin(word: string): string {
  const lower = word.toLowerCase();
  let out = '';
  let index = 0;
  while (index < lower.length) {
    const char = lower[index] as string;
    if (char >= '0' && char <= '9') {
      out += char;
      index += 1;
      continue;
    }
    const cluster = LATIN_CLUSTERS.find(([latin]) =>
      lower.startsWith(latin, index),
    );
    if (cluster) {
      out += cluster[1];
      index += cluster[0].length;
      continue;
    }
    if (LATIN_VOWELS.has(char)) {
      // Only a word-INITIAL vowel survives, matching the Devanagari side where an
      // independent vowel is a letter but a matra is not.
      if (out.length === 0) out += LATIN_INITIAL_VOWEL[char] ?? 'अ';
      index += 1;
      continue;
    }
    // The other half of the anusvara rule: a nasal standing before another consonant is
    // what a Marathi typist writes as ं (mantri = मंत्री, amba = आंबा), so both n and m
    // collapse to the nasal there — but NOT before a vowel, where म and न are a real
    // contrast (mahila = महिला, not नहिला).
    if ((char === 'n' || char === 'm') && isLatinConsonant(lower[index + 1])) {
      out += NASAL;
      index += 1;
      continue;
    }
    out += LATIN_SINGLE[char] ?? '';
    index += 1;
  }
  return out;
}

// Anything that is not a letter, a digit or a COMBINING MARK separates words. The mark
// class is load-bearing on this surface: every Devanagari matra, the virama and the
// anusvara are \p{M}, not \p{L}, so a word pattern of letters alone shatters लाडकी into
// four one-letter "words" and no Marathi query can ever match. Devanagari danda and
// double danda are punctuation and correctly separate.
// ZWNJ/ZWJ are kept INSIDE the word (and dropped by the fold) rather than treated as
// separators — text pasted out of Word carries them mid-word, and splitting there would
// turn महाराष्‍ट्र into two unmatchable halves.
const WORD_SPLIT = /[^\p{L}\p{N}\p{M}‌‍]+/u;
const WORD_PATTERN = /[\p{L}\p{N}\p{M}‌‍]+/gu;

const isDevanagari = (word: string): boolean => /[ऀ-ॿ]/.test(word);
const isLatin = (word: string): boolean => /[A-Za-z]/.test(word);

/**
 * A folded word list, in the two alphabets the library actually contains.
 *
 * Transliteration is DIRECTIONAL, and deliberately so. A query's Latin word is also read
 * as a skeleton (that is what lets "ladki" reach लाडकी), but a Latin word in the LIBRARY
 * stays Latin: the layout prose is genuine English, and transliterating it manufactures
 * Devanagari that was never written. Live, that had the query पुरस्कार (परसकर) matching the
 * English word "pairs" (परस) — a hit no reader could account for.
 */
export type FoldedText = Readonly<{ deva: string[]; latin: string[] }>;

export function foldText(text: string): FoldedText {
  const deva: string[] = [];
  const latin: string[] = [];
  for (const raw of text.split(WORD_SPLIT)) {
    if (!raw) continue;
    if (isDevanagari(raw)) {
      const folded = foldDevanagari(raw);
      if (folded) deva.push(folded);
      continue;
    }
    if (isLatin(raw)) {
      latin.push(raw.toLowerCase());
      continue;
    }
    // Bare numerals (Latin or Devanagari digits) are useful in both alphabets.
    const folded = foldDevanagari(raw);
    if (folded) {
      deva.push(folded);
      latin.push(folded);
    }
  }
  return { deva, latin };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const MAX_QUERY_TOKENS = 8;

export type QueryToken = Readonly<{
  raw: string;
  deva: string;
  latin: string;
}>;

export function parseQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  for (const raw of query.trim().split(WORD_SPLIT)) {
    if (!raw) continue;
    if (isDevanagari(raw)) {
      const deva = foldDevanagari(raw);
      if (deva) tokens.push({ raw, deva, latin: '' });
    } else if (isLatin(raw)) {
      tokens.push({
        raw,
        deva: transliterateLatin(raw),
        latin: raw.toLowerCase(),
      });
    } else {
      const deva = foldDevanagari(raw);
      if (deva) tokens.push({ raw, deva, latin: deva });
    }
    if (tokens.length >= MAX_QUERY_TOKENS) break;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// Bounded edit distance: returns `limit + 1` as soon as it can prove the distance
// exceeds the limit, so a long summary is never charged for a full DP table.
function editDistanceWithin(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

const maxEdits = (token: string): number =>
  token.length <= 3 ? 0 : token.length <= 5 ? 1 : 2;

// How well one folded token matches one folded word list. 0 = no match.
function scoreAgainstWords(token: string, words: readonly string[]): number {
  if (!token) return 0;
  let best = 0;
  for (const word of words) {
    if (word === token) return 1;
    if (token.length >= 2 && word.startsWith(token)) {
      best = Math.max(best, 0.82);
      continue;
    }
    if (token.length >= 3 && word.includes(token)) {
      best = Math.max(best, 0.62);
      continue;
    }
    // The reverse direction, and it is not symmetric with the case above: Marathi
    // inflects by SUFFIX, so an officer typing what the note said (शेतकऱ्यांना) is
    // routinely longer than what the summary stored (शेतकरी). Without this, the more
    // specific the query, the fewer results — the opposite of what typing more should do.
    if (word.length >= 3 && token.startsWith(word)) {
      best = Math.max(best, 0.7);
      continue;
    }
    const limit = maxEdits(token);
    if (limit > 0) {
      const distance = editDistanceWithin(token, word, limit);
      if (distance <= limit) {
        best = Math.max(best, distance === 1 ? 0.55 : 0.42);
      }
    }
  }
  return best;
}

function scoreToken(token: QueryToken, folded: FoldedText): number {
  const deva = scoreAgainstWords(token.deva, folded.deva);
  const latin = token.latin ? scoreAgainstWords(token.latin, folded.latin) : 0;
  return Math.max(deva, latin);
}

// Where a hit is worth most. The subject line is what an officer is actually
// remembering ("the लाडकी बहीण one"); the layout prose is a fallback that mostly
// answers structural English queries like "quote" or "timeline".
const FIELD_WEIGHTS = {
  typeLabel: 3,
  contentSummary: 2.6,
  typeDescription: 1.4,
  layoutSummary: 1,
} as const;

type FieldKey = keyof typeof FIELD_WEIGHTS;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type PhotoFilter = 'any' | 'photo' | 'text';

export type ReferenceFilters = Readonly<{
  photo: PhotoFilter;
  /** Minimum repeating content slots (0 = no constraint). */
  minSlots: number;
}>;

export const NO_FILTERS: ReferenceFilters = { photo: 'any', minSlots: 0 };

export const filtersAreActive = (filters: ReferenceFilters): boolean =>
  filters.photo !== 'any' || filters.minSlots > 0;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** One library image plus the type text that is searchable alongside it. */
export type SearchableReference = Readonly<{
  image: ReferenceImage;
  typeId: string;
  typeLabel: string;
  typeDescription: string;
}>;

export type Highlight = Readonly<{ start: number; end: number }>;

export type ReferenceMatch = Readonly<{
  entry: SearchableReference;
  score: number;
  /** The best line to show under the tile, with the matched words located in it. */
  snippet: string;
  highlights: readonly Highlight[];
}>;

export type ReferenceSearchResult = Readonly<{
  /** Ranked hits. Empty query = every entry, in the caller's original order. */
  matches: readonly ReferenceMatch[];
  /**
   * Entries with no `layoutSpec` at all. They carry no searchable text, so they can
   * never match a query — they are reported separately rather than silently dropped,
   * which is also the prompt to run the analysis on them.
   */
  unanalyzed: readonly SearchableReference[];
  /** How many entries were considered, for the "X पैकी Y" line. */
  total: number;
  queryActive: boolean;
  filtersActive: boolean;
}>;

function passesFilters(
  image: ReferenceImage,
  filters: ReferenceFilters,
): boolean {
  const spec = image.layoutSpec;
  if (!spec) return false;
  if (filters.photo === 'photo' && !spec.hasPhotoZone) return false;
  if (filters.photo === 'text' && spec.hasPhotoZone) return false;
  if (filters.minSlots > 0 && spec.bulletSlots < filters.minSlots) return false;
  return true;
}

function fieldText(entry: SearchableReference, field: FieldKey): string {
  switch (field) {
    case 'typeLabel':
      return entry.typeLabel;
    case 'typeDescription':
      return entry.typeDescription;
    case 'contentSummary':
      return entry.image.layoutSpec?.contentSummary ?? '';
    case 'layoutSummary':
      return entry.image.layoutSpec?.layoutSummary ?? '';
  }
}

const FIELD_ORDER: readonly FieldKey[] = [
  'typeLabel',
  'contentSummary',
  'typeDescription',
  'layoutSummary',
];

// Words of `text` that a query token matched well enough to be worth marking. Recomputed
// on the ORIGINAL string (not the folded one) so the offsets address what is rendered.
function locateHighlights(
  text: string,
  tokens: readonly QueryToken[],
): Highlight[] {
  if (!text || tokens.length === 0) return [];
  const highlights: Highlight[] = [];
  const wordPattern = new RegExp(WORD_PATTERN.source, 'gu');
  let match: RegExpExecArray | null = wordPattern.exec(text);
  while (match !== null) {
    const word = match[0];
    const folded = foldText(word);
    const hit = tokens.some((token) => scoreToken(token, folded) >= 0.62);
    if (hit) {
      highlights.push({ start: match.index, end: match.index + word.length });
    }
    match = wordPattern.exec(text);
  }
  return highlights;
}

/**
 * Where `query` matches inside `text`, for a surface that shows the full summary rather
 * than a snippet (the /references library, where the subject line is already on screen
 * and clipping it to a window would lose information the operator came for).
 */
export function highlightRanges(text: string, query: string): Highlight[] {
  return locateHighlights(text, parseQuery(query));
}

const SNIPPET_MAX = 150;

// A window of the summary around its first marked word, so a long paragraph does not
// push the grid apart. Offsets are shifted to stay valid against the returned string.
function buildSnippet(
  text: string,
  highlights: readonly Highlight[],
): { snippet: string; highlights: Highlight[] } {
  const clean = text.trim();
  if (clean.length <= SNIPPET_MAX) {
    return { snippet: clean, highlights: [...highlights] };
  }
  const first = highlights[0]?.start ?? 0;
  let start = Math.max(0, first - 40);
  if (start > 0) {
    const space = clean.indexOf(' ', start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  const end = Math.min(clean.length, start + SNIPPET_MAX);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  const shift = prefix.length - start;
  return {
    snippet: `${prefix}${clean.slice(start, end)}${suffix}`,
    highlights: highlights
      .filter((range) => range.start >= start && range.end <= end)
      .map((range) => ({ start: range.start + shift, end: range.end + shift })),
  };
}

/**
 * Rank `entries` against `query` + `filters`.
 *
 * With neither a query nor a filter the input order is preserved untouched, so a caller
 * can render its normal grouped view from the same result.
 */
export function searchReferences(
  entries: readonly SearchableReference[],
  query: string,
  filters: ReferenceFilters = NO_FILTERS,
): ReferenceSearchResult {
  const tokens = parseQuery(query);
  const queryActive = tokens.length > 0;
  const filtersActive = filtersAreActive(filters);
  const total = entries.length;

  if (!queryActive && !filtersActive) {
    return {
      matches: entries.map((entry) => ({
        entry,
        score: 0,
        snippet: entry.image.layoutSpec?.contentSummary?.trim() ?? '',
        highlights: [],
      })),
      unanalyzed: [],
      total,
      queryActive: false,
      filtersActive: false,
    };
  }

  const unanalyzed: SearchableReference[] = [];
  const matches: ReferenceMatch[] = [];

  for (const entry of entries) {
    if (!entry.image.layoutSpec) {
      unanalyzed.push(entry);
      continue;
    }
    if (!passesFilters(entry.image, filters)) continue;

    let score = 0;
    let bestSummaryField: FieldKey = 'contentSummary';
    let bestSummaryScore = 0;

    if (queryActive) {
      const foldedFields = FIELD_ORDER.map(
        (field) => [field, foldText(fieldText(entry, field))] as const,
      );
      let matchedEvery = true;
      for (const token of tokens) {
        let bestForToken = 0;
        for (const [field, folded] of foldedFields) {
          const value = scoreToken(token, folded) * FIELD_WEIGHTS[field];
          if (value > bestForToken) bestForToken = value;
          if (
            (field === 'contentSummary' || field === 'layoutSummary') &&
            value > bestSummaryScore
          ) {
            bestSummaryScore = value;
            bestSummaryField = field;
          }
        }
        if (bestForToken <= 0) {
          matchedEvery = false;
          break;
        }
        score += bestForToken;
      }
      if (!matchedEvery) continue;
    }

    // An enabled master is the one a run can actually use, so it edges out a disabled
    // twin of equal relevance. Kept small — it must never outrank a real text hit.
    if (entry.image.isActive) score += 0.15;

    const summaryText =
      fieldText(entry, bestSummaryField).trim() ||
      fieldText(entry, 'contentSummary').trim() ||
      fieldText(entry, 'layoutSummary').trim();
    const located = queryActive ? locateHighlights(summaryText, tokens) : [];
    const { snippet, highlights } = buildSnippet(summaryText, located);

    matches.push({ entry, score, snippet, highlights });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.entry.image.isActive) - Number(a.entry.image.isActive) ||
      b.entry.image.createdAt.localeCompare(a.entry.image.createdAt),
  );

  return { matches, unanalyzed, total, queryActive, filtersActive };
}
