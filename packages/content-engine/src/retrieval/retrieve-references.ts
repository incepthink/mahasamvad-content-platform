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
// For scheme articles, topical similarity is usually useful.
// For news articles, style/structure matters more than exact topic similarity, because
// a topic-similar article can still be the wrong Mahasamvad subtype. For example,
// an administrative directive should not be guided by a scheme-benefit notice.
// So the news path lightly boosts directive/report-style articles when selecting
// the single full reference article.

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  fetchArticleChunks,
  matchChunks,
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

  const emphasis = Array.from({ length: ANGLE_QUERY_REPEAT }, () => trimmedAngle).join('\n');
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countMarkers(text: string, markers: readonly string[]): number {
  const normalized = normalizeText(text);
  return markers.reduce((count, marker) => {
    return normalized.includes(marker) ? count + 1 : count;
  }, 0);
}

function scoreReferenceCandidate(
  match: MatchRow,
  category: ArticleCategory | null,
): number {
  let score = match.similarity;

  if (category !== 'news') {
    return score;
  }

  const searchableText = `${match.title}\n${match.text}`;

  const directiveHits = countMarkers(
    searchableText,
    NEWS_DIRECTIVE_STYLE_MARKERS,
  );
  const schemeNoticeHits = countMarkers(
    searchableText,
    NEWS_SCHEME_NOTICE_MARKERS,
  );

  // Keep similarity as the base, but nudge news selection toward directive/report
  // shape and away from scheme-benefit notice shape. The weights are deliberately
  // small so a clearly relevant article still wins.
  score += Math.min(directiveHits, 6) * 0.015;
  score -= Math.min(schemeNoticeHits, 5) * 0.01;

  return score;
}

function pickBestMatch(
  matches: MatchRow[],
  category: ArticleCategory | null,
): MatchRow | null {
  if (matches.length === 0) return null;

  if (category !== 'news') {
    return matches[0] ?? null;
  }

  return (
    [...matches].sort((a, b) => {
      return (
        scoreReferenceCandidate(b, category) -
        scoreReferenceCandidate(a, category)
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
// For scheme, this is the top semantic match.
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
): Promise<ReferenceArticle | null> {
  const matches = await retrieveReferences(
    buildAngleWeightedQuery(query, angle),
    CANDIDATE_CHUNK_COUNT,
    category,
  );

  const best = pickBestMatch(matches, category);
  if (!best) return null;

  const client = createServiceRoleClient();
  const chunks = await fetchArticleChunks(client, best.articleId);
  if (chunks.length === 0) return null;

  return {
    articleId: best.articleId,
    title: best.title,
    url: best.url,
    similarity: best.similarity,
    selectionScore: scoreReferenceCandidate(best, category),
    text: chunks.map((chunk) => chunk.text).join('\n\n'),
  };
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
if (
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
