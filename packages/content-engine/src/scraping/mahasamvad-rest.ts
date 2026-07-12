// Mahasamvad category scraper via the WordPress REST API.
// A category listing page (e.g. कर्जमुक्ती २०२६) has no single article, so
// Readability cannot extract it. Instead we read the site's public wp-json
// REST API, which returns clean, authoritative JSON for every post in one call.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { htmlToPlainText } from './html.js';

const SITE = 'https://mahasamvad.in';

// कर्जमुक्ती २०२६ category id.
const KARJAMUKTI_2026_CATEGORY_ID = 18129;

// Some hosts block requests without a browser-like UA. Mirrors the headers used
// by the Readability scraper in mahasamvad-scraper.ts.
const REQUEST_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'accept-language': 'mr,hi,en;q=0.8',
} as const;

export type MahasamvadPost = Readonly<{
  id: number;
  url: string;
  title: string;
  publishedTime: string | null;
  modifiedTime: string | null;
  author: string | null;
  excerpt: string;
  contentHtml: string;
  contentText: string;
  featuredImage: string | null;
  categories: readonly string[];
  tags: readonly string[];
}>;

// Minimal shapes for the subset of the WordPress REST response we consume.
type Rendered = { rendered?: string };
type EmbeddedTerm = { taxonomy?: string; name?: string };
type WpPost = {
  id: number;
  link: string;
  date: string | null;
  modified: string | null;
  title?: Rendered;
  excerpt?: Rendered;
  content?: Rendered;
  _embedded?: {
    author?: Array<{ name?: string }>;
    'wp:featuredmedia'?: Array<{ source_url?: string }>;
    'wp:term'?: EmbeddedTerm[][];
  };
};

// Strip HTML tags and decode entities (titles/excerpts arrive as e.g. &#8216;). Delegates
// to the shared safe parser, which tolerates inline styles jsdom would otherwise crash on.
function htmlToText(html: string): string {
  return htmlToPlainText(html);
}

function termNames(post: WpPost, taxonomy: string): string[] {
  const groups = post._embedded?.['wp:term'] ?? [];
  return groups
    .flat()
    .filter((term) => term?.taxonomy === taxonomy && typeof term.name === 'string')
    .map((term) => term.name as string);
}

function normalizePost(post: WpPost): MahasamvadPost {
  const contentHtml = post.content?.rendered ?? '';
  return {
    id: post.id,
    url: post.link,
    title: htmlToText(post.title?.rendered ?? ''),
    publishedTime: post.date,
    modifiedTime: post.modified,
    author: post._embedded?.author?.[0]?.name ?? null,
    excerpt: htmlToText(post.excerpt?.rendered ?? ''),
    contentHtml,
    contentText: htmlToText(contentHtml),
    featuredImage: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
    categories: termNames(post, 'category'),
    tags: termNames(post, 'post_tag'),
  };
}

// Fetch all posts in a category, or — when `maxPosts` is given — stop once that many
// have been collected. The cap matters for large categories (e.g. वृत्त विशेष has
// ~14k posts): a fine-tuning pilot only needs a few dozen, not every page.
export async function fetchMahasamvadCategoryPosts(
  categoryId: number,
  maxPosts?: number,
): Promise<MahasamvadPost[]> {
  const posts: MahasamvadPost[] = [];
  let page = 1;
  let totalPages = 1;
  const perPage = maxPosts ? Math.min(100, maxPosts) : 100;

  do {
    const url =
      `${SITE}/wp-json/wp/v2/posts?categories=${categoryId}` +
      `&per_page=${perPage}&_embed=1&page=${page}`;
    const response = await fetch(url, { headers: REQUEST_HEADERS });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    // WordPress reports pagination via this header.
    if (page === 1) {
      totalPages = Number(response.headers.get('x-wp-totalpages')) || 1;
    }

    const batch = (await response.json()) as WpPost[];
    for (const post of batch) {
      posts.push(normalizePost(post));
    }

    if (maxPosts && posts.length >= maxPosts) {
      return posts.slice(0, maxPosts);
    }

    page += 1;
  } while (page <= totalPages);

  return posts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// One page of the WordPress REST posts endpoint, with retry + backoff. A large
// site-wide crawl (~250 pages) will occasionally hit a 429/5xx or a transient network
// blip; retrying a single page is far cheaper than restarting the whole run.
async function fetchPostsPageWithRetry(
  url: string,
  maxRetries: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: REQUEST_HEADERS });
      // 5xx and 429 are transient; back off and retry. 4xx (other than 429) is a
      // real error (e.g. paged past the end) and should surface immediately.
      if (response.ok || (response.status !== 429 && response.status < 500)) {
        return response;
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s, … capped at 15s.
      await sleep(Math.min(1000 * 2 ** attempt, 15_000));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts: ${String(lastError)}`);
}

export type PagedFetchOptions = Readonly<{
  // First page to fetch (1-based). Defaults to 1.
  startPage?: number | undefined;
  // Stop after yielding this many pages (for smoke runs). Undefined = all pages.
  maxPages?: number | undefined;
  // Posts per page (WordPress caps this at 100).
  perPage?: number | undefined;
  // Polite delay between page requests, ms.
  delayMs?: number | undefined;
  // Max retries per page before giving up.
  maxRetries?: number | undefined;
}>;

// Stream EVERY published post on the site, one page at a time, so a caller can chunk +
// embed + upsert incrementally without ever holding the whole (~25k-post) corpus in
// memory. No category filter, so each post is yielded exactly once. Ordered by id asc:
// unlike date-desc, this keeps pagination stable even if new posts are published mid-crawl
// (they land on the last page rather than shifting every subsequent page).
export async function* fetchAllPostsPaged(
  options: PagedFetchOptions = {},
): AsyncGenerator<MahasamvadPost[], void, void> {
  const perPage = Math.min(100, options.perPage ?? 100);
  const delayMs = options.delayMs ?? 400;
  const maxRetries = options.maxRetries ?? 5;
  const startPage = options.startPage ?? 1;

  let page = startPage;
  let totalPages = 1;
  let pagesYielded = 0;

  do {
    const url =
      `${SITE}/wp-json/wp/v2/posts?per_page=${perPage}&_embed=1` +
      `&orderby=id&order=asc&page=${page}`;
    const response = await fetchPostsPageWithRetry(url, maxRetries);

    if (!response.ok) {
      // A 400 here typically means we paged past the last page — treat as clean end.
      if (response.status === 400) return;
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    if (page === startPage) {
      totalPages = Number(response.headers.get('x-wp-totalpages')) || 1;
    }

    const batch = (await response.json()) as WpPost[];
    if (batch.length === 0) return;

    yield batch.map(normalizePost);
    pagesYielded += 1;
    if (options.maxPages && pagesYielded >= options.maxPages) return;

    page += 1;
    if (page <= totalPages && delayMs > 0) await sleep(delayMs);
  } while (page <= totalPages);
}

// Run directly to fetch a category's posts. Args:
//   tsx src/scraping/mahasamvad-rest.ts [categoryId] [outputName] [maxPosts]
// Writes data/<outputName>.json. maxPosts caps huge categories (e.g. वृत्त विशेष has
// ~14k posts — a style-reference corpus only needs a few hundred). Defaults reproduce
// the original karjamukti (scheme) scrape when run with no args.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const categoryId = Number(process.argv[2]) || KARJAMUKTI_2026_CATEGORY_ID;
  const outputName = process.argv[3] ?? 'karjamukti-2026';
  const maxPosts = Number(process.argv[4]) || undefined;
  const outputPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../../data/${outputName}.json`,
  );

  fetchMahasamvadCategoryPosts(categoryId, maxPosts)
    .then(async (posts) => {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(posts, null, 2), 'utf8');
      console.log(`Wrote ${posts.length} posts to ${outputPath}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
