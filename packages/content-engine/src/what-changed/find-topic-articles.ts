import {
  createServiceRoleClient,
  MAHASAMVAD_CHUNKS_TABLE,
  matchChunks,
} from '@dgipr/database';
import { embedTexts } from '../embedding/openai-embeddings.js';
import type { StoredNewsArticle, TopicCandidate } from './types.js';

const PAGE_SIZE = 1000;
const SEMANTIC_MATCH_COUNT = 160;
const MIN_SEMANTIC_SIMILARITY = 0.3;
const MAX_TOPIC_TOKEN_WINDOW = 18;
const CANDIDATE_PREVIEW_CHARS = 650;

type NewsChunkDbRow = {
  article_id: number;
  chunk_index: number;
  text: string;
  title: string | null;
  url: string | null;
  published_time: string | null;
};

function normalized(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('mr-IN')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subjectTokens(subject: string): string[] {
  return normalized(subject)
    .split(' ')
    .filter((token) => token.length >= 2);
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) !== -1) {
    count += 1;
    at += needle.length;
  }
  return count;
}

function minimumTokenWindow(
  text: string,
  tokens: readonly string[],
): number | null {
  const wanted = new Set(tokens);
  if (wanted.size === 0) return null;
  const words = text.split(' ');
  const counts = new Map<string, number>();
  let covered = 0;
  let left = 0;
  let best = Number.POSITIVE_INFINITY;

  for (let right = 0; right < words.length; right += 1) {
    const word = words[right]!;
    if (wanted.has(word)) {
      const count = (counts.get(word) ?? 0) + 1;
      counts.set(word, count);
      if (count === 1) covered += 1;
    }

    while (covered === wanted.size && left <= right) {
      best = Math.min(best, right - left + 1);
      const leftWord = words[left]!;
      if (wanted.has(leftWord)) {
        const count = (counts.get(leftWord) ?? 1) - 1;
        counts.set(leftWord, count);
        if (count === 0) covered -= 1;
      }
      left += 1;
    }
  }

  return Number.isFinite(best) ? best : null;
}

export function topicLexicalScore(
  article: StoredNewsArticle,
  subject: string,
): number {
  const phrase = normalized(subject);
  const tokens = [...new Set(subjectTokens(subject))];
  const title = normalized(article.title);
  const body = normalized(article.text);
  const titlePhrase = occurrences(title, phrase);
  const bodyPhrase = occurrences(body, phrase);
  const titleTokens = tokens.filter((token) => title.includes(token)).length;
  const bodyTokens = tokens.filter((token) => body.includes(token)).length;
  const titleWindow = minimumTokenWindow(title, tokens);
  const bodyWindow = minimumTokenWindow(body, tokens);

  // For a multi-word subject, one common word is not a topic match. "धरण" alone,
  // for example, admitted hundreds of unrelated dam stories for "कोयना धरण".
  // Accept the exact phrase, or require every subject word to occur close together.
  // The separate semantic search still catches genuine synonyms and paraphrases.
  if (
    tokens.length > 1 &&
    titlePhrase + bodyPhrase === 0 &&
    (titleWindow === null || titleWindow > MAX_TOPIC_TOKEN_WINDOW) &&
    (bodyWindow === null || bodyWindow > MAX_TOPIC_TOKEN_WINDOW)
  ) {
    return 0;
  }

  const proximityBoost = Math.max(
    titleWindow === null ? 0 : MAX_TOPIC_TOKEN_WINDOW - titleWindow + 1,
    bodyWindow === null ? 0 : MAX_TOPIC_TOKEN_WINDOW - bodyWindow + 1,
  );
  return (
    titlePhrase * 30 +
    Math.min(bodyPhrase, 5) * 10 +
    titleTokens * 5 +
    bodyTokens * 2 +
    proximityBoost
  );
}

function matchingPreview(article: StoredNewsArticle, subject: string): string {
  const text = article.text.replace(/\s+/g, ' ').trim();
  const lower = normalized(text);
  const phrase = normalized(subject);
  const tokens = subjectTokens(subject);
  let at = lower.indexOf(phrase);
  if (at === -1) {
    at =
      tokens
        .map((token) => lower.indexOf(token))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
  }
  const start = Math.max(0, at - 220);
  return text.slice(start, start + CANDIDATE_PREVIEW_CHARS);
}

async function fetchAllNewsArticles(
  onProgress?: (message: string) => void,
): Promise<StoredNewsArticle[]> {
  const client = createServiceRoleClient();
  const grouped = new Map<
    number,
    {
      title: string;
      url: string;
      publishedTime: string | null;
      chunks: Array<{ index: number; text: string }>;
    }
  >();
  let from = 0;

  for (;;) {
    const { data, error } = await client
      .from(MAHASAMVAD_CHUNKS_TABLE)
      .select('article_id, chunk_index, text, title, url, published_time')
      .eq('style_category', 'news')
      .order('article_id', { ascending: true })
      .order('chunk_index', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`संग्रह वाचता आला नाही: ${error.message}`);
    }

    const rows = (data ?? []) as NewsChunkDbRow[];
    for (const row of rows) {
      const current = grouped.get(row.article_id) ?? {
        title: row.title ?? '',
        url: row.url ?? '',
        publishedTime: row.published_time,
        chunks: [],
      };
      current.chunks.push({ index: row.chunk_index, text: row.text });
      grouped.set(row.article_id, current);
    }

    onProgress?.(
      `संग्रह तपासत आहे — ${grouped.size.toLocaleString('mr-IN')} लेख वाचले`,
    );
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return [...grouped.entries()].map(([articleId, article]) => ({
    articleId,
    title: article.title,
    url: article.url,
    publishedTime: article.publishedTime,
    text: article.chunks
      .sort((a, b) => a.index - b.index)
      .map((chunk) => chunk.text.trim())
      .filter(Boolean)
      .join('\n\n'),
  }));
}

export type TopicSearchResult = Readonly<{
  scannedArticleCount: number;
  candidates: readonly TopicCandidate[];
}>;

export async function findTopicArticleCandidates(
  subject: string,
  onProgress?: (message: string) => void,
): Promise<TopicSearchResult> {
  const articles = await fetchAllNewsArticles(onProgress);
  const byId = new Map(articles.map((article) => [article.articleId, article]));
  const lexical = new Map<number, number>();

  for (const article of articles) {
    const score = topicLexicalScore(article, subject);
    if (score > 0) lexical.set(article.articleId, score);
  }

  onProgress?.('विषयाचा अर्थाधारित शोध घेत आहे…');
  const [embedding] = await embedTexts([subject]);
  if (!embedding) throw new Error('विषयाचे embedding तयार झाले नाही.');
  const client = createServiceRoleClient();
  const semanticRows = await matchChunks(
    client,
    embedding,
    SEMANTIC_MATCH_COUNT,
    'news',
  );
  const semantic = new Map<number, number>();
  for (const row of semanticRows) {
    if (row.similarity < MIN_SEMANTIC_SIMILARITY) continue;
    semantic.set(
      row.articleId,
      Math.max(semantic.get(row.articleId) ?? 0, row.similarity),
    );
  }

  const ids = new Set([...lexical.keys(), ...semantic.keys()]);
  const candidates = [...ids]
    .map((articleId): TopicCandidate | null => {
      const article = byId.get(articleId);
      if (!article) return null;
      return {
        article,
        lexicalScore: lexical.get(articleId) ?? 0,
        semanticSimilarity: semantic.get(articleId) ?? null,
        preview: matchingPreview(article, subject),
      };
    })
    .filter((candidate): candidate is TopicCandidate => candidate !== null)
    .sort(
      (a, b) =>
        b.lexicalScore - a.lexicalScore ||
        (b.semanticSimilarity ?? 0) - (a.semanticSimilarity ?? 0),
    );

  return {
    scannedArticleCount: articles.length,
    candidates,
  };
}
