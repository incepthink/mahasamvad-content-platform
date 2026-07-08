// Mahasamvad category scraper via the WordPress REST API.
// A category listing page (e.g. कर्जमुक्ती २०२६) has no single article, so
// Readability cannot extract it. Instead we read the site's public wp-json
// REST API, which returns clean, authoritative JSON for every post in one call.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

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

// Strip HTML tags and decode entities (titles/excerpts arrive as e.g. &#8216;).
function htmlToText(html: string): string {
  if (!html) return '';
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
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
