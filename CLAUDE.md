# CLAUDE.md

DGIPR Marathi Content Platform — a Marathi-first system that turns official notes
into publication-ready Marathi **articles** and matching **posters**, using
historical Mahasamvad articles as style references.

**This file is the map. Trust it: open the named files directly instead of
re-scanning the whole monorepo to rebuild context.** It only needs updating when
the architecture or commands below change.

Product goals, principles, and the hard rules live in AGENTS.md, imported here:

@AGENTS.md

---

## Monorepo layout

pnpm workspaces (`apps/*`, `packages/*`); packages are referenced as `@dgipr/*`.

| Path | Package | Responsibility |
| --- | --- | --- |
| `apps/web` | `@dgipr/web` | Next.js (App Router) Marathi-first UI |
| `apps/api` | `@dgipr/api` | Fastify API — thin routes + job orchestration |
| `packages/content-engine` | `@dgipr/content-engine` | Scraping, chunking, embeddings, RAG, article generation + revision |
| `packages/poster-renderer` | `@dgipr/poster-renderer` | Poster: AI background photo + HTML/Chromium typesetting |
| `packages/database` | `@dgipr/database` | Supabase client, queries, storage helpers, row types |
| `packages/schemas` | `@dgipr/schemas` | Shared Zod schemas + types (poster `Copy`, generation API) |
| `supabase/migrations` | — | SQL migrations (pgvector + generations) |
| `n8n/workflow-exports` | — | Committed n8n workflow JSON (`social-post-v2-api.json` twitter path; `article-poster-v1-api.json` article poster — import targets for AWS) |
| `docs` | — | Project docs (`PROJECT_CONTEXT.md`, `web-scraping-context.md`) |

## Where things live (jump straight here)

**Generation flow (backend):**
- Fastify boot / CORS / error handler / `/health` → `apps/api/src/index.ts`
- HTTP routes under `/api/generations` (thin) → `apps/api/src/routes/generations.ts`
- Job orchestration + sequencing (the real pipeline) → `apps/api/src/jobs/runner.ts`
  - `startGenerationJob`: retrieve → `generateArticle` → (if poster) `generateCopy`
    → render poster → upload PNG(s) to Supabase Storage. The poster render forks on
    `ARTICLE_POSTER_MODE` (default `n8n`): `n8n` sends `{ headline, scene_brief }` to the
    `article-poster-v1-api` webhook (`renderArticlePosterViaN8n`), which paints the whole
    landscape poster incl. the headline by editing `master-article.png` — no scene image,
    no scenePath; `html` is the original `buildArticleScenePrompt`+`generateImage`+
    `generateArticlePoster` Chromium path (kept as fallback). Job state of record is the
    `generations` row (status/step/error), so polling clients survive refreshes.
  - `startArticleFeedbackJob`, `startPosterFeedbackJob` (`copy` re-renders with the
    **cached** scene; `scene` regenerates the background image).
- Article gen / coverage / faithfulness / revisions →
  `packages/content-engine/src/generation/*`
  (`generate-article.ts`, `verify-coverage.ts`, `generate-copy.ts`, `revise-*.ts`,
  `openai-chat.ts`; category-aware prompting in `category-prompt.ts`)
- RAG + ingestion → `packages/content-engine/src/{retrieval,embedding,chunking,scraping}/*`
- Poster rendering → `packages/poster-renderer/src/*`
  (`generate-article-poster.ts`, `build-scene-prompt.ts`, `openai-image.ts`,
  `article-template.ts` / `poster-template.ts`, `render-html.ts`); public API in
  `packages/poster-renderer/src/index.ts`
- DB access + Storage → `packages/database/src/*`
  (`client.ts`, `generations.ts`, `mahasamvad-chunks.ts`, `storage.ts`)
- Shared types/schemas → `packages/schemas/src/*` (`copy.ts`, `api.ts`)
- content-engine public API barrel → `packages/content-engine/src/index.ts`

**Web flow (user journey starts here):**
- Entry / create a generation → `apps/web/app/page.tsx`
- Generation detail (progress, article, poster, feedback) →
  `apps/web/app/generations/[id]/page.tsx`; history list →
  `apps/web/app/generations/page.tsx`
- Data layer → `apps/web/lib/api.ts`, `apps/web/lib/useGeneration.ts` (polling hook)
- Marathi UI strings → `apps/web/lib/strings.ts`
- UI components → `apps/web/components/*` (`ArticleView`, `PosterPanel`,
  `ProgressSteps`, `FeedbackBox`, `CopyEditForm`, `HistoryCard`, `StatusChip`)

**Data & schema:** `supabase/migrations/0001…0004_*.sql` — pgvector Mahasamvad
chunks, `generations` table, generation category + chunk style-category columns.

**Aux / not on the main request path:**
- `packages/content-engine/src/finetune/*` — reusable JSONL dataset pipeline
  (build-corpus/dataset, eval); OpenAI self-serve fine-tuning is currently
  unavailable, so this is data prep only.
- `packages/content-engine/src/generation/{polish-article,sarvam-chat,news-exemplar}.ts`
  — alternate/experimental generation paths (Sarvam polish, news few-shot).

## Commands

Run from repo root unless noted. Node 22+, pnpm 10+.

```bash
pnpm dev            # web on :3000 + api on :3001 (parallel)
pnpm dev:web        # web only
pnpm dev:api        # api only
pnpm build          # build all packages
pnpm typecheck      # tsc --noEmit across the workspace
pnpm lint
pnpm format         # prettier --write
```

Content pipeline (from `packages/content-engine`, e.g.
`pnpm --filter @dgipr/content-engine scrape:news`):
`scrape:news` / `chunk:news` / `embed:news` (WordPress-REST ingest → chunk →
embed to pgvector), plus `:karjamukti` variants; `retrieve:test`,
`generate:test`, `polish:test`.

Poster preview (renders sample posters without the API):
`pnpm --filter @dgipr/poster-renderer poster:preview` and `poster:preview:article`.

One-time per machine (the API process renders posters too, so it needs a local
Chromium): `pnpm --filter @dgipr/poster-renderer exec playwright install chromium`.

## Conventions & gotchas

- **Marathi-first.** Never round-trip Marathi content through English. Names,
  dates, amounts, designations, scheme names, and locations are never invented —
  the user's note/uploaded docs are the only factual source; Mahasamvad articles
  are **style/structure references only**.
- **Package boundaries.** `apps/api` routes stay thin and only sequence calls +
  persist state; all LLM/render logic lives in `@dgipr/content-engine` and
  `@dgipr/poster-renderer`. Keep it that way.
- **Posters (HTML path):** in `ARTICLE_POSTER_MODE=html` the model paints a **text-free**
  photo and all Devanagari text, header, and footer are typeset in HTML and screenshotted
  with Chromium (this is what prevents garbled Marathi). Storage paths are versioned per
  render (public bucket is CDN-cached — never reuse a path).
- **Article poster via n8n (default).** With `ARTICLE_POSTER_MODE=n8n` the article poster
  is rendered by the `article-poster-v1-api` workflow, not Chromium: the API sends only
  `{ headline, scene_brief }` and the image model paints the whole **landscape** poster
  (one Marathi headline, no bullets/stats — deliberately simple, distinct from the Twitter
  posters) by editing `posters/references/master-article.png`. This intentionally accepts
  image-model Devanagari for the single headline (verified acceptable). No scene image is
  produced, so poster feedback + manual copy-edit (which need `scenePath`) are unavailable
  in this mode.
- **n8n workflows are host-independent.** Their master templates live in Supabase Storage
  under `posters/references/` — the 5 Twitter masters `master-{alert,campaign,info_bullets,quote,timeline}.png`
  (seeded by `pnpm --filter @dgipr/content-engine upload:references`) and the article
  `master-article.png` (seeded by `pnpm --filter @dgipr/content-engine upload:article-master`);
  the workflows fetch them over HTTPS, so they never read local disk. Deploy artifacts:
  `n8n/workflow-exports/{social-post-v2-api,article-poster-v1-api}.json` — import both into the AWS n8n.
- **Env & secrets:** config comes from the root `.env` (see `.env.example`:
  Supabase + OpenAI, optional Sarvam). Never commit secrets.
- **Scraped output** under `packages/content-engine/data/` is gitignored — don't
  commit it or assume it's present.
