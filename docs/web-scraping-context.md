# Web Scraping Context

Ingestion of historical Mahasamvad articles is **implemented** and lives in
`packages/content-engine/src/scraping`. These articles are used as **style and
structure references only** — never as a factual source for new content.

## Target source

- Site: `https://mahasamvad.in` (WordPress).
- Primary scraper: `scraping/mahasamvad-rest.ts` — reads the public WordPress
  REST API (`/wp-json/wp/v2/posts?categories=<id>&_embed=1`). A category listing
  page has no single article body, so Readability can't extract it; the REST API
  returns clean, authoritative JSON for every post in one call.
- Fallback: `scraping/mahasamvad-scraper.ts` — Readability-based extraction for
  single article URLs.

## Crawl rules

- Fetch by category id (e.g. कर्जमुक्ती २०२६ = `18129`). Pagination follows the
  `x-wp-totalpages` response header.
- An optional `maxPosts` cap stops early for huge categories (e.g. वृत्त विशेष
  has ~14k posts; a style-reference corpus needs only a few hundred).
- Requests send a browser-like `user-agent` and `accept-language: mr,hi,en`
  because some hosts block header-less requests.

## Extraction / output format

- `normalizePost` maps each WordPress post to a `MahasamvadPost`: id, url, title,
  published/modified time, author, excerpt, `contentHtml`, plain `contentText`
  (HTML stripped + entities decoded via JSDOM), featured image, categories, tags.
- Output is written to `packages/content-engine/data/<outputName>.json`. That
  `data/` directory is **gitignored** — treat scraped output as regenerable, not
  committed.

## Pipeline scripts

From `packages/content-engine` (`pnpm --filter @dgipr/content-engine <script>`):

- `scrape:news` / `scrape:karjamukti` — fetch a category → `data/<name>.json`
- `chunk:news` / `chunk:karjamukti` — paragraph-aware chunking →
  `data/<name>.chunks.json` (tagged with a coarse style category: news vs scheme)
- `embed:news` / `embed:karjamukti` — embed chunks and store them in Supabase
  pgvector (`supabase/migrations/0001_mahasamvad_chunks.sql`)

Retrieval of these chunks as style references happens at generation time in
`retrieval/retrieve-references.ts`.

## Notes

- Keep scraping as standalone scripts in code, not inside n8n workflows.
- Rate limiting is currently minimal (sequential paged fetches); add backoff here
  if a larger crawl warrants it.
