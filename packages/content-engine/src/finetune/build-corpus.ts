// Build the labeled two-category corpus for fine-tuning (plan step 1).
//
// Scrapes both Mahasamvad categories the model must learn to distinguish and tags
// every post with a coarse style label. The scheme category is small (~56 posts) and
// news is huge (~14k), so news is capped to keep the training set BALANCED — otherwise
// the news voice drowns the scheme voice and the category label stops being a real
// switch. Writes one labeled JSON file the downstream steps (note extraction, dataset
// assembly) read; no embedding/chunking happens here.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ArticleCategory } from '../generation/category-prompt.js';
import {
  fetchMahasamvadCategoryPosts,
  type MahasamvadPost,
} from '../scraping/mahasamvad-rest.js';

// The coarse style buckets, labeled by SOURCE category (which scrape a post came from).
// Same union as the runtime ArticleCategory — re-exported here under the finetune name the
// data-prep scripts use. (कर्जमुक्ती २०२६ mixes feature and bulletin styles, so this is a
// starting approximation to revisit if one voice underperforms.)
export type FinetuneCategory = ArticleCategory;

export type LabeledPost = Readonly<{
  category: FinetuneCategory;
  post: MahasamvadPost;
}>;

// कर्जमुक्ती २०२६ — the scheme feature category already used for RAG (~56 posts).
const SCHEME_CATEGORY_ID = 18129;
// वृत्त विशेष — the news category (~14,297 posts); capped for a balanced pilot.
const NEWS_CATEGORY_ID = 16;
// Cap news to roughly match the scheme count so the set stays balanced.
const NEWS_LIMIT = 56;

export async function buildLabeledCorpus(
  newsLimit = NEWS_LIMIT,
): Promise<LabeledPost[]> {
  const [scheme, news] = await Promise.all([
    fetchMahasamvadCategoryPosts(SCHEME_CATEGORY_ID),
    fetchMahasamvadCategoryPosts(NEWS_CATEGORY_ID, newsLimit),
  ]);

  return [
    ...scheme.map((post): LabeledPost => ({ category: 'scheme', post })),
    ...news.map((post): LabeledPost => ({ category: 'news', post })),
  ];
}

// Run directly: `tsx src/finetune/build-corpus.ts [newsLimit]`.
// Writes the labeled corpus to data/finetune/corpus.json.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const newsLimit = Number(process.argv[2]) || NEWS_LIMIT;
  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data/finetune/corpus.json',
  );

  buildLabeledCorpus(newsLimit)
    .then(async (labeled) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(labeled, null, 2), 'utf8');

      const counts = labeled.reduce<Record<string, number>>((acc, item) => {
        acc[item.category] = (acc[item.category] ?? 0) + 1;
        return acc;
      }, {});
      const lens = labeled
        .map((item) => item.post.contentText.length)
        .sort((a, b) => a - b);
      const at = (q: number) => lens[Math.floor((lens.length - 1) * q)] ?? 0;
      console.log(`Wrote ${labeled.length} labeled posts to ${outputPath}`);
      console.log(
        `  by category: ${Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
      );
      console.log(
        `  article char lengths — min ${at(0)}, median ${at(0.5)}, p90 ${at(0.9)}, max ${at(1)}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
