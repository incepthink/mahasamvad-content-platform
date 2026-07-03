// Mahasamvad scraping entry point.
// Fetches a page and extracts the readable article with Readability.js.

import { pathToFileURL } from 'node:url';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export type MahasamvadScrapeTarget = Readonly<{
  url: string;
}>;

export type MahasamvadArticle = Readonly<{
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  length: number | null;
  textContent: string | null;
  content: string | null;
}>;

export async function scrapeMahasamvadArticle(
  target: MahasamvadScrapeTarget,
): Promise<MahasamvadArticle> {
  const response = await fetch(target.url, {
    headers: {
      // Some hosts block requests without a browser-like UA.
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      'accept-language': 'mr,hi,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${target.url}: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url: target.url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  console.log(article);

  return {
    title: article?.title ?? null,
    byline: article?.byline ?? null,
    excerpt: article?.excerpt ?? null,
    length: article?.length ?? null,
    textContent: article?.textContent ?? null,
    content: article?.content ?? null,
  };
}

// Run directly (e.g. `tsx src/scraping/mahasamvad-scraper.ts`) to print the
// parsed article for the sample category page to the console.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url =
    'https://mahasamvad.in/category/%e0%a4%95%e0%a4%b0%e0%a5%8d%e0%a4%9c%e0%a4%ae%e0%a5%81%e0%a4%95%e0%a5%8d%e0%a4%a4%e0%a5%80-%e0%a5%a8%e0%a5%a6%e0%a5%a8%e0%a5%ac/';

  scrapeMahasamvadArticle({ url })
    .then((article) => {
      console.log(article);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
