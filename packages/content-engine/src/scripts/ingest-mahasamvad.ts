// Site-wide, streaming, resumable ingest of Mahasamvad articles into the RAG store.
//
// Unlike the targeted scrape:news / chunk:news / embed:news scripts (which buffer a whole
// category to disk then embed it in one shot), this walks EVERY published post on the site
// page-by-page and runs scrape -> filter -> chunk -> embed -> upsert per page, so memory
// stays bounded even across ~25k posts / ~60k chunks. Progress is durable in the DB: upsert
// is keyed on `${articleId}-${chunkIndex}`, and by default we load the set of already-stored
// article_ids up front and skip them — so a crashed run resumes cheaply and a later re-run
// only embeds newly published articles.
//
// Run:
//   tsx --env-file=../../.env src/scripts/ingest-mahasamvad.ts [--force] [--limit N] [--min-chars N]
//     --force       re-embed articles already in the store (default: skip them)
//     --limit N     stop after N REST pages (100 posts/page) — for smoke runs
//     --min-chars N minimum contentText length to keep a post (default 400)

import { pathToFileURL } from 'node:url';
import {
  createServiceRoleClient,
  fetchExistingArticleIds,
  upsertChunks,
} from '@dgipr/database';
import type { ContentChunk } from '../index.js';
import { fetchAllPostsPaged } from '../scraping/mahasamvad-rest.js';
import { deriveStyleCategory } from '../scraping/style-category.js';
import { chunkArticle } from '../chunking/chunk-articles.js';
import { embedTexts, EMBEDDING_MODEL } from '../embedding/openai-embeddings.js';
import { toChunkRows } from '../embedding/ingest-chunks.js';
import {
  createCostAccumulator,
  runInCostScope,
  totalCostUsd,
  type CostAccumulator,
} from '../cost/cost-meter.js';

// Paragraph-aligned chunk size, matching the existing chunk:news pipeline.
const TARGET_CHARS = 1000;
// Drop trivially short posts (photo captions, one-line Ticker/slider items) so the corpus
// grows with substance, not noise. Overridable via --min-chars.
const DEFAULT_MIN_CHARS = 400;
// Embed in larger batches than the default 100 to cut request count / wall-clock; each
// ~1000-char Marathi chunk is well under the per-input token limit, so 200 is safe.
const EMBED_BATCH_SIZE = 200;

type IngestOptions = Readonly<{
  force: boolean;
  limitPages: number | undefined;
  minChars: number;
}>;

type IngestCounters = {
  pagesDone: number;
  postsSeen: number;
  skippedExisting: number;
  skippedShort: number;
  postsKept: number;
  chunksUpserted: number;
};

async function ingestAllPosts(
  opts: IngestOptions,
  acc: CostAccumulator,
): Promise<IngestCounters> {
  const client = createServiceRoleClient();

  // Load the already-stored article ids so re-runs skip them (unless --force).
  const existingIds = opts.force
    ? new Set<number>()
    : await fetchExistingArticleIds(client);
  console.log(
    opts.force
      ? 'Force mode: re-embedding all posts (ignoring what is already stored).'
      : `Already stored: ${existingIds.size} articles — these will be skipped.`,
  );

  const c: IngestCounters = {
    pagesDone: 0,
    postsSeen: 0,
    skippedExisting: 0,
    skippedShort: 0,
    postsKept: 0,
    chunksUpserted: 0,
  };

  for await (const page of fetchAllPostsPaged({ maxPages: opts.limitPages })) {
    const pageChunks: ContentChunk[] = [];

    for (const post of page) {
      c.postsSeen += 1;

      if (existingIds.has(post.id)) {
        c.skippedExisting += 1;
        continue;
      }
      if (post.contentText.length < opts.minChars) {
        c.skippedShort += 1;
        continue;
      }

      const chunks = chunkArticle(post, {
        targetChars: TARGET_CHARS,
        styleCategory: deriveStyleCategory(post),
      });
      if (chunks.length === 0) {
        // No <p> paragraphs to chunk (e.g. media-only post) — nothing to embed.
        c.skippedShort += 1;
        continue;
      }

      pageChunks.push(...chunks);
      c.postsKept += 1;
      // Guard against a post appearing twice within a single run.
      existingIds.add(post.id);
    }

    if (pageChunks.length > 0) {
      const embeddings = await embedTexts(
        pageChunks.map((chunk) => chunk.text),
        EMBED_BATCH_SIZE,
      );
      const rows = toChunkRows(pageChunks, embeddings);
      c.chunksUpserted += await upsertChunks(client, rows);
    }

    c.pagesDone += 1;
    console.log(
      `page ${c.pagesDone}: seen ${c.postsSeen} | kept ${c.postsKept} | ` +
        `skipped existing ${c.skippedExisting} / short ${c.skippedShort} | ` +
        `chunks upserted ${c.chunksUpserted} | $${totalCostUsd(acc).toFixed(4)} so far`,
    );
  }

  return c;
}

function parseArgs(argv: readonly string[]): IngestOptions {
  const force = argv.includes('--force');

  const readNumber = (flag: string): number | undefined => {
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    if (inline) return Number(inline.slice(flag.length + 1)) || undefined;
    const idx = argv.indexOf(flag);
    if (idx !== -1 && argv[idx + 1]) return Number(argv[idx + 1]) || undefined;
    return undefined;
  };

  return {
    force,
    limitPages: readNumber('--limit'),
    minChars: readNumber('--min-chars') ?? DEFAULT_MIN_CHARS,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Ingesting site-wide with ${EMBEDDING_MODEL} — ` +
      `minChars ${opts.minChars}` +
      (opts.limitPages ? `, limit ${opts.limitPages} pages` : '') +
      (opts.force ? ', force' : '') +
      '…',
  );

  const acc = createCostAccumulator();
  runInCostScope(acc, () => ingestAllPosts(opts, acc))
    .then((c) => {
      console.log('\n=== Ingest complete ===');
      console.log(`Pages processed : ${c.pagesDone}`);
      console.log(`Posts seen      : ${c.postsSeen}`);
      console.log(`Kept / embedded : ${c.postsKept}`);
      console.log(`Skipped existing: ${c.skippedExisting}`);
      console.log(`Skipped short   : ${c.skippedShort}`);
      console.log(`Chunks upserted : ${c.chunksUpserted}`);
      console.log(`Embedding cost  : $${totalCostUsd(acc).toFixed(4)}`);
    })
    .catch((error: unknown) => {
      console.error('\nIngest failed:', error);
      console.error(`(embedding cost before failure: $${totalCostUsd(acc).toFixed(4)})`);
      process.exitCode = 1;
    });
}
