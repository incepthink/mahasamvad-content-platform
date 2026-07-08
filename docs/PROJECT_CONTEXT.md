# Project Context

## Vision

The DGIPR Marathi Content Platform supports Maharashtra government communication
teams by turning official notes, resolutions, press notes, and scheme
information into polished Marathi content — articles and matching posters.

The platform keeps Marathi as the primary language while preserving factual
accuracy and keeping the production flow modular and auditable.

## Mahasamvad Ingestion (implemented)

Historical Mahasamvad articles are used as **style references, not** the source
of truth for new factual content. The ingestion pipeline is built and lives in
`packages/content-engine/src/{scraping,chunking,embedding,retrieval}`; see
`docs/web-scraping-context.md` for the scraping details.

1. Fetch articles from the Mahasamvad WordPress REST API
   (`scraping/mahasamvad-rest.ts`; a Readability-based `mahasamvad-scraper.ts`
   also exists).
2. Clean/normalize the Marathi text and keep the full original article.
3. Split cleaned articles into paragraph-aware chunks
   (`chunking/chunk-articles.ts`), tagged with a coarse style category
   (news vs scheme).
4. Generate embeddings for each chunk and store articles, chunks, metadata, and
   vectors in Supabase PostgreSQL via pgvector
   (`embedding/ingest-chunks.ts`, `supabase/migrations/0001_mahasamvad_chunks.sql`).

Driven by the `scrape:* / chunk:* / embed:*` scripts in
`packages/content-engine/package.json`.

## Generation Pipeline (implemented)

For a new request the API orchestrates (see `apps/api/src/jobs/runner.ts`):

1. Accept a user note (and generation category); the note/uploaded docs are the
   factual source of truth.
2. Retrieve similar Mahasamvad chunks as writing-style references
   (`retrieval/retrieve-references.ts`).
3. Generate a Marathi article from verified facts + style references, with
   coverage and faithfulness verification so claims are not invented
   (`generation/generate-article.ts`, `verify-coverage.ts`).
4. For posters: generate Marathi poster copy, paint a **text-free** background
   photo, then typeset the Marathi text/header/footer in HTML and screenshot it
   with Chromium so Devanagari is never mangled (`packages/poster-renderer`).
5. Persist state and outputs in Supabase (the `generations` row is the state of
   record; poster/scene PNGs go to a public Storage bucket).
6. Support feedback/revision loops for the article text, poster copy, and poster
   background (`generation/revise-*.ts`).

A Marathi-first Next.js web app (`apps/web`) lets non-technical staff create a
generation, watch progress, edit poster text, send feedback, and browse history —
no login required.

## Not Yet Implemented

- Canva integration (open/edit posters in Canva via the Canva API).
- n8n workflows (scheduling, notifications, retries, automation).
- Authentication.
- OpenAI self-serve fine-tuning is unavailable; a reusable dataset pipeline
  exists as data prep only (`packages/content-engine/src/finetune`).

## Implementation Boundaries

- Existing Mahasamvad content is for structure and style guidance only.
- New official notes and documents are the factual source of truth.
- Business logic stays in code (`packages/*`), not hidden inside large
  automation workflows; `apps/api` routes stay thin and only sequence + persist.
- Secrets and credentials stay out of version control.
