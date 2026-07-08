// Paragraph-aware chunking for Mahasamvad articles (PROJECT_CONTEXT step 6).
//
// The scraper's `contentText` has its whitespace collapsed, so paragraph
// boundaries are lost. We therefore derive paragraphs from `contentHtml` (which
// keeps its <p> tags) and greedily pack consecutive paragraphs into chunks up to
// a target size, never splitting mid-paragraph. This produces the chunks that a
// later step will embed and store — no embedding happens here.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import type { ContentChunk } from '../index.js';
import type { ArticleCategory } from '../generation/category-prompt.js';
import type { MahasamvadPost } from '../scraping/mahasamvad-rest.js';

export type ChunkOptions = Readonly<{
  // Preferred chunk size in characters. A chunk is closed once adding the next
  // paragraph would push it past this size.
  targetChars: number;
  // Style bucket every produced chunk is tagged with; scopes retrieval at query time.
  styleCategory: ArticleCategory;
}>;

const DEFAULT_OPTIONS: ChunkOptions = {
  targetChars: 1000,
  styleCategory: 'scheme',
};

// Extract paragraph texts from an article's rendered HTML. Mirrors the JSDOM
// text extraction in mahasamvad-rest.ts, but per-<p> so boundaries survive.
export function extractParagraphs(contentHtml: string): string[] {
  if (!contentHtml) return [];
  const { document } = new JSDOM(`<body>${contentHtml}</body>`).window;
  return Array.from(document.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0);
}

// Group an article's paragraphs into paragraph-aligned chunks. A single
// paragraph longer than targetChars becomes its own chunk (no sentence-splitting
// in this pass).
export function chunkArticle(
  post: MahasamvadPost,
  options: ChunkOptions = DEFAULT_OPTIONS,
): ContentChunk[] {
  const paragraphs = extractParagraphs(post.contentHtml);
  const chunks: ContentChunk[] = [];
  let buffer: string[] = [];
  let bufferChars = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const chunkIndex = chunks.length;
    chunks.push({
      id: `${post.id}-${chunkIndex}`,
      articleId: post.id,
      chunkIndex,
      text: buffer.join('\n\n'),
      title: post.title,
      url: post.url,
      publishedTime: post.publishedTime,
      categories: post.categories,
      tags: post.tags,
      styleCategory: options.styleCategory,
    });
    buffer = [];
    bufferChars = 0;
  };

  for (const paragraph of paragraphs) {
    // Close the current chunk before this paragraph would overflow it, but keep
    // at least one paragraph per chunk (a lone oversized paragraph stands alone).
    if (buffer.length > 0 && bufferChars + paragraph.length > options.targetChars) {
      flush();
    }
    buffer.push(paragraph);
    bufferChars += paragraph.length;
  }
  flush();

  return chunks;
}

export function chunkArticles(
  posts: readonly MahasamvadPost[],
  options: ChunkOptions = DEFAULT_OPTIONS,
): ContentChunk[] {
  return posts.flatMap((post) => chunkArticle(post, options));
}

// Run directly to chunk a scraped dataset. Args:
//   tsx src/chunking/chunk-articles.ts [datasetName] [styleCategory]
// Reads data/<datasetName>.json, writes data/<datasetName>.chunks.json, tagging every
// chunk with <styleCategory> ('news' | 'scheme'). Defaults reproduce the original
// karjamukti (scheme) behaviour when run with no args.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const datasetName = process.argv[2] ?? 'karjamukti-2026';
  const styleCategory: ArticleCategory =
    process.argv[3] === 'news' ? 'news' : 'scheme';
  const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');
  const inputPath = resolve(dataDir, `${datasetName}.json`);
  const outputPath = resolve(dataDir, `${datasetName}.chunks.json`);

  readFile(inputPath, 'utf8')
    .then(async (raw) => {
      const posts = JSON.parse(raw) as MahasamvadPost[];
      const chunks = chunkArticles(posts, {
        ...DEFAULT_OPTIONS,
        styleCategory,
      });

      await mkdir(dataDir, { recursive: true });
      await writeFile(outputPath, JSON.stringify(chunks, null, 2), 'utf8');

      const lengths = chunks.map((c) => c.text.length).sort((a, b) => a - b);
      const at = (q: number) => lengths[Math.floor((lengths.length - 1) * q)] ?? 0;
      console.log(`Wrote ${chunks.length} chunks from ${posts.length} posts to ${outputPath}`);
      console.log(
        `Chunk char lengths — min ${at(0)}, median ${at(0.5)}, p90 ${at(0.9)}, max ${at(1)}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
