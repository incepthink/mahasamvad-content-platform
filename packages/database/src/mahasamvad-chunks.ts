// Persistence for Mahasamvad chunks + their embeddings (see
// supabase/migrations/0001_mahasamvad_chunks.sql).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category } from './generations.js';

export const MAHASAMVAD_CHUNKS_TABLE = 'mahasamvad_chunks';

// One row in mahasamvad_chunks. `embedding` is the raw float vector; it is
// serialized to a pgvector/halfvec literal (`[a,b,c]`) on insert.
export type ChunkRow = Readonly<{
  id: string;
  articleId: number;
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
  publishedTime: string | null;
  categories: readonly string[];
  tags: readonly string[];
  // Coarse style bucket this chunk belongs to; scopes retrieval (see migration 0004).
  styleCategory: Category;
  embedding: readonly number[];
}>;

// PostgREST reliably casts a text vector literal into a halfvec column, whereas a
// bare JSON array can be ambiguous — so send `[a,b,c]` as a string.
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

function toDbRow(row: ChunkRow): Record<string, unknown> {
  return {
    id: row.id,
    article_id: row.articleId,
    chunk_index: row.chunkIndex,
    text: row.text,
    title: row.title,
    url: row.url,
    published_time: row.publishedTime,
    categories: row.categories,
    tags: row.tags,
    style_category: row.styleCategory,
    embedding: toVectorLiteral(row.embedding),
  };
}

// One result row from the match_mahasamvad_chunks RPC (see the migration). Used at
// retrieval time (PROJECT_CONTEXT step 11) to surface style/structure references.
export type MatchRow = Readonly<{
  id: string;
  articleId: number;
  text: string;
  title: string;
  url: string;
  similarity: number;
}>;

// Shape returned by the RPC (snake_case, as defined in the SQL function).
type MatchDbRow = {
  id: string;
  article_id: number;
  text: string;
  title: string | null;
  url: string | null;
  similarity: number;
};

// Vector similarity search via the match_mahasamvad_chunks RPC. Embeds must already
// be produced by the same model (text-embedding-3-large, 3072 dims); the vector is
// sent as the halfvec literal the RPC expects. `filterCategory` scopes the search to
// one style bucket ('news' / 'scheme'); null/undefined searches the whole table.
export async function matchChunks(
  client: SupabaseClient,
  queryEmbedding: readonly number[],
  matchCount = 5,
  filterCategory: Category | null = null,
): Promise<MatchRow[]> {
  const { data, error } = await client.rpc('match_mahasamvad_chunks', {
    query_embedding: toVectorLiteral(queryEmbedding),
    match_count: matchCount,
    filter_category: filterCategory,
  });
  if (error) {
    throw new Error(`Failed to match chunks: ${error.message}`);
  }
  const rows = (data ?? []) as MatchDbRow[];
  return rows.map((row) => ({
    id: row.id,
    articleId: row.article_id,
    text: row.text,
    title: row.title ?? '',
    url: row.url ?? '',
    similarity: row.similarity,
  }));
}

// One chunk of a single article, fetched to reconstruct that article's full text.
export type ArticleChunkRow = Readonly<{
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
}>;

// Shape the select below returns (snake_case column names).
type ArticleChunkDbRow = {
  chunk_index: number;
  text: string;
  title: string | null;
  url: string | null;
};

// Fetch every chunk of one article in `chunk_index` order, so a caller can
// concatenate them back into the full article text (used to feed a complete
// Mahasamvad article as a writing-style reference).
export async function fetchArticleChunks(
  client: SupabaseClient,
  articleId: number,
): Promise<ArticleChunkRow[]> {
  const { data, error } = await client
    .from(MAHASAMVAD_CHUNKS_TABLE)
    .select('chunk_index, text, title, url')
    .eq('article_id', articleId)
    .order('chunk_index', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch article chunks: ${error.message}`);
  }
  const rows = (data ?? []) as ArticleChunkDbRow[];
  return rows.map((row) => ({
    chunkIndex: row.chunk_index,
    text: row.text,
    title: row.title ?? '',
    url: row.url ?? '',
  }));
}

// The distinct set of article_ids already stored. A site-wide re-ingest loads this once
// up front and skips posts already present, so re-runs only embed new articles (and a
// crashed run resumes cheaply). Pages through the table because a single select is capped
// at ~1000 rows by PostgREST.
export async function fetchExistingArticleIds(
  client: SupabaseClient,
): Promise<Set<number>> {
  const ids = new Set<number>();
  const pageSize = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await client
      .from(MAHASAMVAD_CHUNKS_TABLE)
      .select('article_id')
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Failed to fetch existing article ids: ${error.message}`);
    }
    const rows = (data ?? []) as Array<{ article_id: number }>;
    for (const row of rows) ids.add(row.article_id);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return ids;
}

// A Postgres statement-timeout (SQLSTATE 57014) — the failure we hit on large upserts.
// Each upserted row inserts a 3072-dim vector into the HNSW index, and HNSW insert cost
// grows with the index, so a batch size that commits quickly on a small table can exceed
// the DB's per-statement time limit once the corpus is large.
function isStatementTimeout(message: string): boolean {
  return /statement timeout|canceling statement due to statement timeout|57014/i.test(
    message,
  );
}

// Upsert one batch of already-mapped rows, halving and retrying on a statement timeout so
// the effective batch size auto-adapts to whatever the (growing) HNSW index can absorb in
// one statement. Any other error surfaces immediately.
async function upsertBatchAdaptive(
  client: SupabaseClient,
  batch: Record<string, unknown>[],
): Promise<number> {
  const { error } = await client
    .from(MAHASAMVAD_CHUNKS_TABLE)
    .upsert(batch, { onConflict: 'id' });
  if (!error) return batch.length;

  if (isStatementTimeout(error.message) && batch.length > 1) {
    const mid = Math.floor(batch.length / 2);
    return (
      (await upsertBatchAdaptive(client, batch.slice(0, mid))) +
      (await upsertBatchAdaptive(client, batch.slice(mid)))
    );
  }
  throw new Error(`Failed to upsert chunks: ${error.message}`);
}

// Upsert chunks in batches, keyed on the primary key `id`, so re-running ingestion
// is idempotent (no duplicate rows). Batches start small (HNSW inserts are the bottleneck)
// and shrink further on timeout via upsertBatchAdaptive.
export async function upsertChunks(
  client: SupabaseClient,
  rows: readonly ChunkRow[],
  batchSize = 50,
): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize).map(toDbRow);
    written += await upsertBatchAdaptive(client, batch);
  }
  return written;
}
