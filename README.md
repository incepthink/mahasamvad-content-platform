# DGIPR Marathi Content Platform

DGIPR Marathi Content Platform is a Marathi-first foundation for government communication workflows.

It turns official notes and documents into publication-ready Marathi articles and matching posters, using historical Mahasamvad articles as style references. A web app lets non-technical government staff generate, edit, and give feedback on both.

## Repository Structure

- `apps/web` - Next.js frontend (Marathi-first UI)
- `apps/api` - Fastify API (`/api/generations`)
- `packages/content-engine` - document processing, RAG, article generation and revision logic
- `packages/database` - Supabase queries, database helpers, and types
- `packages/schemas` - shared Zod schemas and types (poster copy + generation API)
- `packages/poster-renderer` - poster generation (AI background photo + HTML/Chromium typesetting)
- `supabase/migrations` - SQL migrations
- `n8n/workflow-exports` - future n8n exports
- `docs` - project documentation

## Prerequisites

- Node.js 22+
- pnpm 10+
- A Supabase project with the migrations in `supabase/migrations` applied (via the SQL editor or `supabase db push`)
- An OpenAI API key

## Install

```bash
pnpm install
cp .env.example .env   # fill in Supabase + OpenAI values
pnpm --filter @dgipr/poster-renderer exec playwright install chromium
pnpm -r build
```

## Development

```bash
pnpm dev        # apps/web on :3000, apps/api on :3001
pnpm dev:web
pnpm dev:api
```

## Quality Commands

```bash
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm build
```

## Current Status

The core pipeline and a first web product on top of it are implemented:

- Mahasamvad scraping, chunking, embeddings, and RAG retrieval (style references only)
- Marathi article generation with coverage + faithfulness verification
- Poster generation: a text-free AI background photo, typeset in HTML and screenshotted
  with Chromium so Devanagari is never mangled
- Feedback/revision loops for the article text, poster text, and poster background
- A Fastify API and a Marathi-first Next.js frontend: create a generation, watch
  progress, edit poster text, send feedback, and browse history — no login required

Not implemented yet: Canva integration, n8n workflows, authentication.
