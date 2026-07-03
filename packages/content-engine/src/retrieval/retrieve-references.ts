// Retrieve style/structure reference chunks for a query (PROJECT_CONTEXT step 11).
//
// Embeds the query with the same model used at ingestion (text-embedding-3-large),
// then runs vector similarity search via the match_mahasamvad_chunks RPC. Returns the
// most similar Mahasamvad chunks — used as WRITING-STYLE references only, never as a
// source of facts.

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  fetchArticleChunks,
  matchChunks,
  type MatchRow,
} from '@dgipr/database';
import { embedTexts } from '../embedding/openai-embeddings.js';

// text-embedding-3-large accepts ~8191 tokens. Notes can be long (multiple GRs), so
// cap the query text before embedding. ~6000 chars is a safe budget for Devanagari
// and still captures enough topical signal to retrieve relevant references.
const MAX_QUERY_CHARS = 6000;

export async function retrieveReferences(
  query: string,
  matchCount = 5,
): Promise<MatchRow[]> {
  const trimmed = query.slice(0, MAX_QUERY_CHARS);
  const [embedding] = await embedTexts([trimmed]);
  if (!embedding) {
    throw new Error('Failed to embed the query (no embedding returned).');
  }
  const client = createServiceRoleClient();
  return matchChunks(client, embedding, matchCount);
}

// A single complete Mahasamvad article, reconstructed from all its chunks, used as a
// writing-STYLE/STRUCTURE reference (never as a source of facts).
export type ReferenceArticle = Readonly<{
  articleId: number;
  title: string;
  url: string;
  // The best chunk similarity for this article — how well it matched the query.
  similarity: number;
  // The full article text: every chunk joined in chunk_index order.
  text: string;
}>;

// How many chunks to scan when picking the single best-matching article. A wider net
// than the final reference count so the top article is chosen from real candidates.
const CANDIDATE_CHUNK_COUNT = 8;

// Retrieve the ONE article most relevant to the query and return its full text. We
// find the closest chunk, take its article, and stitch that article's chunks back
// together — a complete exemplar is a far better structure/length template than a
// handful of disconnected chunks.
export async function retrieveReferenceArticle(
  query: string,
): Promise<ReferenceArticle | null> {
  const matches = await retrieveReferences(query, CANDIDATE_CHUNK_COUNT);
  const best = matches[0];
  if (!best) return null;

  const client = createServiceRoleClient();
  const chunks = await fetchArticleChunks(client, best.articleId);
  if (chunks.length === 0) return null;

  return {
    articleId: best.articleId,
    title: best.title,
    url: best.url,
    similarity: best.similarity,
    text: chunks.map((chunk) => chunk.text).join('\n\n'),
  };
}

// Run directly: `tsx --env-file=../../.env src/retrieval/retrieve-references.ts`.
// Prints the retrieved references so we can eyeball that similarity search works.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const query =
    process.argv[2] ??
    'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना, 2026 अंतर्गत थकबाकीदार ' +
      'शेतकऱ्यांना कर्जमाफी आणि नियमित कर्जफेड करणाऱ्यांना प्रोत्साहनपर लाभ.';

  retrieveReferences(query)
    .then((refs) => {
      console.log(`\nQuery: ${query}\n`);
      console.log(`Retrieved ${refs.length} reference chunks:\n`);
      refs.forEach((ref, i) => {
        console.log(`#${i + 1}  similarity=${ref.similarity.toFixed(4)}`);
        console.log(`    title: ${ref.title}`);
        console.log(`    url:   ${ref.url}`);
        console.log(`    text:  ${ref.text.slice(0, 160).replace(/\s+/g, ' ')}…\n`);
      });
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
