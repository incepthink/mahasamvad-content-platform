// Retrieve style/structure reference articles for a query (PROJECT_CONTEXT step 11).
//
// Embeds the query with the same model used at ingestion (text-embedding-3-large),
// then runs vector similarity search via the match_mahasamvad_chunks RPC.
//
// IMPORTANT:
// Retrieved articles are used as WRITING-STYLE / STRUCTURE / PHRASING references only.
// They are never a source of facts. The user's NOTES remain the only authoritative
// fact source during generation.
//
// For scheme articles, topical similarity is usually useful; when the DLO inventory carries
// an attributed statement, attribution-shaped exemplars receive a small conditional boost.
// For news articles, style/structure matters more than exact topic similarity, because
// a topic-similar article can still be the wrong Mahasamvad subtype. For example,
// an administrative directive should not be guided by a scheme-benefit notice.
// So the news path lightly boosts directive/report-style articles when selecting
// the single full reference article.

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  fetchArticleChunks,
  fetchCategoryArticleCandidates,
  matchChunks,
  type CategoryArticleCandidateRow,
  type MatchRow,
} from '@dgipr/database';
import { embedTexts } from '../embedding/openai-embeddings.js';
import type { ArticleCategory } from '../generation/category-prompt.js';

// text-embedding-3-large accepts ~8191 tokens. Notes can be long (multiple GRs), so
// cap the query text before embedding. ~6000 chars is a safe budget for Devanagari
// and still captures enough topical signal to retrieve relevant references.
const MAX_QUERY_CHARS = 6000;

// When the user supplies an editorial angle/heading, we want the retrieved reference to
// match the intended editorial *shape*, not just the topic. The embedding is a single
// averaged vector, so repeating the (short) heading ahead of the note pulls that centroid
// toward the angle while the note keeps the result on-topic. Small enough that a clearly
// on-topic exemplar still wins, large enough to break ties by editorial angle.
const ANGLE_QUERY_REPEAT = 3;

// Build the embedding query for retrieval. With no angle this is just the note. With an
// angle, the heading is repeated ANGLE_QUERY_REPEAT times and PREPENDED — prepended text
// always survives the MAX_QUERY_CHARS slice, so the angle signal is never truncated away.
// This only reshapes retrieval ranking; the raw note passed downstream to drafting is
// unchanged, so the heading never becomes a fact source.
function buildAngleWeightedQuery(
  query: string,
  angle: string | undefined,
): string {
  const trimmedAngle = angle?.trim();
  if (!trimmedAngle) return query;

  const emphasis = Array.from(
    { length: ANGLE_QUERY_REPEAT },
    () => trimmedAngle,
  ).join('\n');
  return `${emphasis}\n\n${query}`;
}

// How many chunks to scan when picking the single best-matching article. A wider net
// than the final reference count so the top article is chosen from real candidates.
const CANDIDATE_CHUNK_COUNT = 12;

// For news, the top topical match may be a scheme-style notice or generic appeal.
// These phrases help identify directive/report-style Mahasamvad articles, which are
// better references for administrative news: instructions, reviews, reports,
// compliance deadlines, committee work, inspections, hearings and follow-up action.
const NEWS_DIRECTIVE_STYLE_MARKERS = [
  'निर्देश दिले',
  'सूचना दिल्या',
  'सूचना देण्यात',
  'आढावा घेऊन',
  'आढावा घेण्याचे',
  'अहवाल सादर',
  'सविस्तर अहवाल',
  'वस्तुनिष्ठ अहवाल',
  'प्राप्त अहवालांचे परीक्षण',
  'प्रत्यक्ष भेट',
  'पाहणी',
  'सुनावणी',
  'शिफारशी',
  'कायदेशीर कार्यवाही',
  'प्रशासकीय कार्यवाही',
  'जबाबदारी',
  'उत्तरदायित्व',
  'अंमलबजावणी',
  'समिती',
  'कार्यस्थिती',
  'प्रलंबित',
  'नमूद केले',
  'स्पष्ट केले',
];

const NEWS_MEETING_STYLE_MARKERS = [
  'बैठक',
  'बैठकीत',
  'अध्यक्षतेखाली',
  'उपस्थित होते',
  'सादरीकरण',
  'यावेळी',
];

const NEWS_PROPOSAL_STYLE_MARKERS = [
  'प्रस्ताव सादर',
  'सविस्तर प्रस्ताव',
  'सर्वसमावेशक प्रस्ताव',
  'प्रस्ताव तयार',
];

// Scheme features often place the minister/senior official's statement in the body rather
// than the lead. Lightly favour exemplars that demonstrate that attribution shape so the
// writer sees how Mahasamvad carries a named statement in a citizen-facing feature.
const SCHEME_ATTRIBUTION_STYLE_MARKERS = [
  'यांनी सांगितले',
  'यांनी म्हटले',
  'यांनी स्पष्ट केले',
  'यांनी नमूद केले',
  'असल्याचे त्यांनी सांगितले',
  'यावर भर देण्यात आल्याचे',
];

// Scheme/information notice markers. These are not “bad”, but for the news/directive
// category they often pull the model toward benefit-note / awareness-copy style.
const NEWS_SCHEME_NOTICE_MARKERS = [
  'योजनेचा लाभ',
  'लाभार्थी',
  'पात्र लाभार्थी',
  'अर्ज',
  'ऑनलाइन अर्ज',
  'कागदपत्र',
  'अर्थसहाय्य',
  'अनुदान',
  'बँक खाते',
  'पोर्टल',
  'संपर्क साधावा',
  'लाभ घ्यावा',
];

// A single complete Mahasamvad article, reconstructed from all its chunks, used as a
// writing-STYLE/STRUCTURE reference. Never use this as a fact source.
export type ReferenceArticle = Readonly<{
  articleId: number;
  title: string;
  url: string;
  // The best chunk similarity for this article — how well it matched the query.
  similarity: number;
  // Optional selection score after category/style boosting.
  selectionScore: number;
  // The full article text: every chunk joined in chunk_index order.
  text: string;
}>;

// A complete article chosen without semantic matching. This is the timeout/empty-result
// fallback for article generation, so it deliberately carries no invented similarity score.
export type CategoryReferenceArticle = Readonly<{
  articleId: number;
  title: string;
  url: string;
  text: string;
}>;

const FALLBACK_TOKEN_STOP_WORDS = new Set([
  'आहे',
  'आहेत',
  'असून',
  'आणि',
  'यांनी',
  'यावेळी',
  'करण्यात',
  'करावे',
  'करून',
  'याबाबत',
  'यासाठी',
  'तसेच',
  'माहिती',
  'सांगितले',
  'विभाग',
]);

function lexicalTokens(text: string): Set<string> {
  const words =
    normalizeText(text)
      .toLocaleLowerCase('mr')
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return new Set(
    words.filter(
      (word) => word.length >= 4 && !FALLBACK_TOKEN_STOP_WORDS.has(word),
    ),
  );
}

function lexicalOverlapScore(query: string, candidate: string): number {
  const wanted = lexicalTokens(query);
  const available = lexicalTokens(candidate);
  let overlap = 0;
  for (const token of available) {
    if (wanted.has(token)) overlap += 1;
  }
  return Math.min(overlap, 12) * 0.012;
}

export function rankCategoryReferenceCandidates(
  candidates: readonly CategoryArticleCandidateRow[],
  category: ArticleCategory,
  query = '',
  preferAttribution = false,
): CategoryArticleCandidateRow[] {
  const wanted = detectNewsReferenceShape(query);
  const wantsNewsShape =
    category === 'news' &&
    (wanted.meeting || wanted.directive || wanted.proposal);

  const scored = candidates.map((candidate) => {
    const searchableText = `${candidate.title}\n${candidate.text}`;
    const found = detectNewsReferenceShape(searchableText);
    const compatible =
      !wantsNewsShape ||
      (wanted.meeting && found.meeting) ||
      (wanted.directive && found.directive) ||
      (wanted.proposal && found.proposal);
    const structure =
      category === 'news'
        ? newsStructureScore(searchableText, wanted, preferAttribution)
        : 0;
    return {
      candidate,
      compatible,
      score: structure + lexicalOverlapScore(query, searchableText),
    };
  });

  const compatible = scored.filter((entry) => entry.compatible);
  const pool = compatible.length > 0 ? compatible : scored;
  return pool
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        Date.parse(b.candidate.publishedTime ?? '') -
        Date.parse(a.candidate.publishedTime ?? '')
      );
    })
    .map((entry) => entry.candidate);
}

// DGIPR's own end-of-copy sign-off: a rule of asterisks, then the writer/desk credit
// ("संध्या गरवारे/विसंअ/"). It is production boilerplate, not editorial style, and an exemplar
// that ends in a byline invites the model to sign a fabricated one onto the new article. Strip
// it from the reference text — the article's own words end at the rule.
const ARTICLE_SIGNOFF = /\n\s*\*{3,}[\s\S]*$/u;

export function stripArticleBoilerplate(text: string): string {
  return text.replace(ARTICLE_SIGNOFF, '').trimEnd();
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countMarkers(text: string, markers: readonly string[]): number {
  const normalized = normalizeText(text);
  return markers.reduce((count, marker) => {
    return normalized.includes(marker) ? count + 1 : count;
  }, 0);
}

type NewsReferenceShape = Readonly<{
  meeting: boolean;
  directive: boolean;
  proposal: boolean;
}>;

export function detectNewsReferenceShape(text: string): NewsReferenceShape {
  return {
    meeting: countMarkers(text, NEWS_MEETING_STYLE_MARKERS) > 0,
    directive: countMarkers(text, NEWS_DIRECTIVE_STYLE_MARKERS) > 0,
    proposal: countMarkers(text, NEWS_PROPOSAL_STYLE_MARKERS) > 0,
  };
}

function newsStructureScore(
  text: string,
  wanted: NewsReferenceShape,
  preferAttribution: boolean,
): number {
  const meetingHits = countMarkers(text, NEWS_MEETING_STYLE_MARKERS);
  const directiveHits = countMarkers(text, NEWS_DIRECTIVE_STYLE_MARKERS);
  const proposalHits = countMarkers(text, NEWS_PROPOSAL_STYLE_MARKERS);
  const attributionHits = preferAttribution
    ? countMarkers(text, SCHEME_ATTRIBUTION_STYLE_MARKERS)
    : 0;
  const schemeNoticeHits = countMarkers(text, NEWS_SCHEME_NOTICE_MARKERS);

  let score = 0;
  if (wanted.meeting)
    score += meetingHits > 0 ? 0.09 + Math.min(meetingHits, 4) * 0.012 : -0.06;
  if (wanted.directive)
    score +=
      directiveHits > 0 ? 0.07 + Math.min(directiveHits, 6) * 0.012 : -0.04;
  if (wanted.proposal)
    score +=
      proposalHits > 0 ? 0.12 + Math.min(proposalHits, 3) * 0.015 : -0.05;
  if (!wanted.directive) score += Math.min(directiveHits, 4) * 0.008;
  score += Math.min(attributionHits, 4) * 0.012;
  score -= Math.min(schemeNoticeHits, 5) * 0.01;
  return score;
}

function scoreReferenceCandidate(
  match: MatchRow,
  category: ArticleCategory | null,
  preferAttribution = false,
  query = '',
): number {
  let score = match.similarity;

  const searchableText = `${match.title}\n${match.text}`;

  if (category === 'scheme') {
    if (!preferAttribution) return score;
    const attributionHits = countMarkers(
      searchableText,
      SCHEME_ATTRIBUTION_STYLE_MARKERS,
    );
    return score + Math.min(attributionHits, 4) * 0.012;
  }

  if (category !== 'news') return score;

  score += newsStructureScore(
    searchableText,
    detectNewsReferenceShape(query),
    preferAttribution,
  );

  return score;
}

function pickBestMatch(
  matches: MatchRow[],
  category: ArticleCategory | null,
  preferAttribution = false,
  query = '',
): MatchRow | null {
  if (matches.length === 0) return null;

  if (category == null) {
    return matches[0] ?? null;
  }

  return (
    [...matches].sort((a, b) => {
      return (
        scoreReferenceCandidate(b, category, preferAttribution, query) -
        scoreReferenceCandidate(a, category, preferAttribution, query)
      );
    })[0] ?? null
  );
}

export async function retrieveReferences(
  query: string,
  matchCount = 5,
  category: ArticleCategory | null = null,
): Promise<MatchRow[]> {
  const trimmed = query.slice(0, MAX_QUERY_CHARS);
  const [embedding] = await embedTexts([trimmed]);

  if (!embedding) {
    throw new Error('Failed to embed the query (no embedding returned).');
  }

  const client = createServiceRoleClient();
  return matchChunks(client, embedding, matchCount, category);
}

// Retrieve the ONE article most relevant to the query and return its full text.
//
// We first retrieve the closest chunks, then select the best article candidate.
// For scheme, this is the top semantic match unless statement-aware attribution boosting was
// requested.
// For news, we apply a small directive/report-style boost before choosing.
// Then we stitch that article's chunks back together — a complete exemplar is a far
// better structure/length template than a handful of disconnected chunks.
//
// `angle` is an optional editorial heading/direction. When present it biases the retrieval
// query toward that angle (see buildAngleWeightedQuery) so the chosen exemplar matches the
// intended editorial shape, not just the topic — without changing the facts sent to drafting.
export async function retrieveReferenceArticle(
  query: string,
  category: ArticleCategory | null = null,
  angle?: string,
  preferAttribution = false,
): Promise<ReferenceArticle | null> {
  const matches = await retrieveReferences(
    buildAngleWeightedQuery(query, angle),
    CANDIDATE_CHUNK_COUNT,
    category,
  );

  const best = pickBestMatch(matches, category, preferAttribution, query);
  if (!best) return null;

  const client = createServiceRoleClient();
  const chunks = await fetchArticleChunks(client, best.articleId);
  if (chunks.length === 0) return null;

  return {
    articleId: best.articleId,
    title: best.title,
    url: best.url,
    similarity: best.similarity,
    selectionScore: scoreReferenceCandidate(
      best,
      category,
      preferAttribution,
      query,
    ),
    text: stripArticleBoilerplate(
      chunks.map((chunk) => chunk.text).join('\n\n'),
    ),
  };
}

// The same retrieval, but returning the top `count` DISTINCT articles rather than one.
//
// Several complete exemplars are a far stronger style signal than one: a single article can
// only demonstrate the shape it happens to have, and the model cannot tell which of its traits
// are the house style and which are that one story's accident. Three make the pattern — the
// dateline, the `– पदनाम नाव` headline, the attribution close — legible as a pattern.
//
// Ordering is by selection score, so element 0 is exactly the article
// `retrieveReferenceArticle` would have returned. Callers that only want the primary can keep
// using that function; nothing about its behaviour changed.
export async function retrieveReferenceArticles(
  query: string,
  category: ArticleCategory | null = null,
  angle?: string,
  preferAttribution = false,
  count = 3,
): Promise<ReferenceArticle[]> {
  if (count <= 0) return [];

  const matches = await retrieveReferences(
    buildAngleWeightedQuery(query, angle),
    CANDIDATE_CHUNK_COUNT,
    category,
  );
  if (matches.length === 0) return [];

  // One entry per article, keeping that article's BEST-scoring chunk — the candidate list is
  // chunk-level, so a long article can occupy several slots and would otherwise crowd out the
  // variety this function exists to provide.
  const bestPerArticle = new Map<number, { match: MatchRow; score: number }>();
  for (const match of matches) {
    const score = scoreReferenceCandidate(
      match,
      category,
      preferAttribution,
      query,
    );
    const seen = bestPerArticle.get(match.articleId);
    if (!seen || score > seen.score) {
      bestPerArticle.set(match.articleId, { match, score });
    }
  }

  const ranked = [...bestPerArticle.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, count);

  const client = createServiceRoleClient();
  const articles = await Promise.all(
    ranked.map(async ({ match, score }): Promise<ReferenceArticle | null> => {
      const chunks = await fetchArticleChunks(client, match.articleId);
      if (chunks.length === 0) return null;
      return {
        articleId: match.articleId,
        title: match.title,
        url: match.url,
        similarity: match.similarity,
        selectionScore: score,
        text: stripArticleBoilerplate(
          chunks.map((chunk) => chunk.text).join('\n\n'),
        ),
      };
    }),
  );

  return articles.filter(
    (article): article is ReferenceArticle => article !== null,
  );
}

// Cheap, non-vector fallback: choose recent complete articles from the requested style bucket.
// This path exists specifically for vector-RPC timeouts and empty/weak result sets, so it must
// never call embedTexts or match_mahasamvad_chunks.
export async function retrieveCategoryReferenceArticles(
  category: ArticleCategory,
  count = 6,
  query = '',
  preferAttribution = false,
): Promise<CategoryReferenceArticle[]> {
  if (count <= 0) return [];

  const client = createServiceRoleClient();
  const candidates = await fetchCategoryArticleCandidates(
    client,
    category,
    Math.max(count * 16, 48),
  );
  const ranked = rankCategoryReferenceCandidates(
    candidates,
    category,
    query,
    preferAttribution,
  ).slice(0, count);
  const articles = await Promise.all(
    ranked.map(async (candidate): Promise<CategoryReferenceArticle | null> => {
      try {
        const chunks = await fetchArticleChunks(client, candidate.articleId);
        if (chunks.length === 0) return null;
        const text = stripArticleBoilerplate(
          chunks.map((chunk) => chunk.text).join('\n\n'),
        );
        if (!text.trim()) return null;
        return {
          articleId: candidate.articleId,
          title: candidate.title,
          url: candidate.url,
          text,
        };
      } catch (error) {
        console.warn(
          `[style-ref] category candidate ${candidate.articleId} could not be reconstructed:`,
          error,
        );
        return null;
      }
    }),
  );

  return articles.filter(
    (article): article is CategoryReferenceArticle => article !== null,
  );
}

// Run directly:
//   tsx --env-file=../../.env src/retrieval/retrieve-references.ts
//
// Optional:
//   tsx --env-file=../../.env src/retrieval/retrieve-references.ts news "your query"
//   tsx --env-file=../../.env src/retrieval/retrieve-references.ts scheme "your query"
//
// To eyeball angle-aware retrieval (Part B): pass a heading as the arg after the query;
// the query is then angle-weighted before embedding, so re-running with and without it
// shows whether the top reference shifts to match the editorial angle.
//   tsx ... src/retrieval/retrieve-references.ts scheme "your query" "your heading"
//
// Prints retrieved references so we can eyeball that similarity search works and
// that news references are not drifting into the wrong style.
//
// `--check` runs the pure sign-off stripping assertions only: no key, no network, no spend.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv.includes('--check')
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

  console.log('\n=== the end-of-copy sign-off is stripped ===');
  const body = 'मुंबई, दि. ६ : निर्देश देण्यात आले.\n\nदुसरा परिच्छेद.';
  check(
    'a real DGIPR sign-off + writer credit is removed',
    stripArticleBoilerplate(`${body}\n\n****\n\nसंध्या गरवारे/विसंअ/`) === body,
  );
  check(
    'a longer asterisk rule is removed too',
    stripArticleBoilerplate(`${body}\n\n*******\n\nकुणीतरी/विसंअ/`) === body,
  );
  check(
    'an article with no sign-off is byte-identical',
    stripArticleBoilerplate(body) === body,
  );
  check(
    'trailing whitespace alone is trimmed, nothing else',
    stripArticleBoilerplate(`${body}\n\n`) === body,
  );
  check(
    'an asterisk INSIDE a paragraph is not treated as a rule',
    stripArticleBoilerplate('पहिला * दुसरा') === 'पहिला * दुसरा',
  );
  check('empty input stays empty', stripArticleBoilerplate('') === '');
  check(
    'a sign-off with no credit line is still removed',
    stripArticleBoilerplate(`${body}\n****`) === body,
  );

  console.log('\n=== category fallback follows the source article shape ===');
  const fallbackCandidates: CategoryArticleCandidateRow[] = [
    {
      articleId: 1,
      title: 'मुंबईतील परिस्थिती पूर्णपणे नियंत्रणात',
      url: 'https://example.test/1',
      text: 'नागरिकांनी सहकार्य करावे, असे आवाहन करण्यात आले.',
      publishedTime: '2026-07-07T00:00:00Z',
    },
    {
      articleId: 2,
      title:
        'कर्जवाटप प्रक्रियेत पतसंस्थांचा समावेश करण्यासाठी प्रस्ताव सादर करा – राज्यमंत्री',
      url: 'https://example.test/2',
      text: 'या विषयावरील बैठकीत सर्वसमावेशक प्रस्ताव सादर करण्याचे निर्देश राज्यमंत्र्यांनी दिले.',
      publishedTime: '2026-07-06T00:00:00Z',
    },
    {
      articleId: 3,
      title: 'योजनेच्या लाभासाठी ऑनलाइन अर्ज करा',
      url: 'https://example.test/3',
      text: 'पात्र लाभार्थ्यांनी कागदपत्रांसह पोर्टलवर अर्ज करावा.',
      publishedTime: '2026-07-08T00:00:00Z',
    },
  ];
  const rankedFallback = rankCategoryReferenceCandidates(
    fallbackCandidates,
    'news',
    'बैठकीत केंद्र स्थापनेसाठी सविस्तर प्रस्ताव सादर करण्याचे निर्देश दिले.',
    true,
  );
  check(
    'a meeting/proposal/directive article beats a newer generic article',
    rankedFallback[0]?.articleId === 2,
  );
  const shape = detectNewsReferenceShape(
    'बैठकीत सविस्तर प्रस्ताव सादर करण्याचे निर्देश दिले.',
  );
  check(
    'meeting, proposal and directive intent are all detected',
    shape.meeting && shape.proposal && shape.directive,
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
} else if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const maybeCategory = process.argv[2] as ArticleCategory | undefined;
  const category: ArticleCategory | null =
    maybeCategory === 'news' || maybeCategory === 'scheme'
      ? maybeCategory
      : null;

  const queryArgIndex = category ? 3 : 2;
  const query =
    process.argv[queryArgIndex] ??
    'जिल्हाधिकाऱ्यांनी जिल्ह्यातील बाल संरक्षण व्यवस्थेचा सर्वंकष आढावा घेऊन निर्धारित मुदतीत सविस्तर अहवाल सादर करण्याचे निर्देश.';
  const angle = process.argv[queryArgIndex + 1];
  const retrievalQuery = buildAngleWeightedQuery(query, angle);

  retrieveReferences(retrievalQuery, CANDIDATE_CHUNK_COUNT, category)
    .then((refs) => {
      console.log(`\nCategory: ${category ?? '(none)'}\n`);
      console.log(`Query: ${query}\n`);
      console.log(`Angle: ${angle?.trim() ? angle : '(none)'}\n`);
      console.log(`Retrieved ${refs.length} reference chunks:\n`);

      refs.forEach((ref, i) => {
        const selectionScore = scoreReferenceCandidate(ref, category);
        const directiveHits = countMarkers(
          `${ref.title}\n${ref.text}`,
          NEWS_DIRECTIVE_STYLE_MARKERS,
        );
        const schemeNoticeHits = countMarkers(
          `${ref.title}\n${ref.text}`,
          NEWS_SCHEME_NOTICE_MARKERS,
        );

        console.log(
          `#${i + 1}  similarity=${ref.similarity.toFixed(4)}  selection=${selectionScore.toFixed(4)}`,
        );
        if (category === 'news') {
          console.log(
            `    directiveHits=${directiveHits}  schemeNoticeHits=${schemeNoticeHits}`,
          );
        }
        console.log(`    title: ${ref.title}`);
        console.log(`    url:   ${ref.url}`);
        console.log(
          `    text:  ${ref.text.slice(0, 180).replace(/\s+/g, ' ')}…\n`,
        );
      });
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
