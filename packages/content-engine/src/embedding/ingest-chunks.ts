// Embed the chunked Mahasamvad articles and store them in Supabase
// (PROJECT_CONTEXT steps 7–8).
//
// Reads data/karjamukti-2026.chunks.json (produced by chunk-articles.ts), embeds
// each chunk's text with OpenAI, and upserts chunks + vectors + metadata into the
// mahasamvad_chunks table. Idempotent: re-running upserts on the primary key.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  upsertChunks,
  type ChunkRow,
} from '@dgipr/database';
import type { ContentChunk } from '../index.js';
import {
  embedTexts,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from './openai-embeddings.js';

export function toChunkRows(
  chunks: readonly ContentChunk[],
  embeddings: readonly number[][],
): ChunkRow[] {
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `Embedding count (${embeddings.length}) does not match chunk count (${chunks.length}).`,
    );
  }
  return chunks.map((chunk, i) => {
    const embedding = embeddings[i];
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Chunk ${chunk.id} has an invalid embedding (expected ${EMBEDDING_DIMENSIONS} dims).`,
      );
    }
    return {
      id: chunk.id,
      articleId: chunk.articleId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      title: chunk.title,
      url: chunk.url,
      publishedTime: chunk.publishedTime,
      categories: chunk.categories,
      tags: chunk.tags,
      styleCategory: chunk.styleCategory,
      embedding,
    };
  });
}

export async function ingestChunks(chunks: readonly ContentChunk[]): Promise<number> {
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  const rows = toChunkRows(chunks, embeddings);
  const client = createServiceRoleClient();
  return upsertChunks(client, rows);
}

// Run directly. Args:
//   tsx --env-file=../../.env src/embedding/ingest-chunks.ts [datasetName]
// Reads data/<datasetName>.chunks.json and upserts it into mahasamvad_chunks. Defaults
// to the karjamukti dataset when run with no args.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const datasetName = process.argv[2] ?? 'karjamukti-2026';
  const inputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../../data/${datasetName}.chunks.json`,
  );

  readFile(inputPath, 'utf8')
    .then(async (raw) => {
      const chunks = JSON.parse(raw) as ContentChunk[];
      console.log(
        `Embedding ${chunks.length} chunks with ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dims)…`,
      );
      const written = await ingestChunks(chunks);
      console.log(`Stored ${written} chunks in mahasamvad_chunks.`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
