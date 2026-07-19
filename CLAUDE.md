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
| `docs` | — | Project docs (`PROJECT_CONTEXT.md`, `web-scraping-context.md`); `docs/user-guide/` is the GitBook end-user manual (bilingual, journey-wise, real screenshots in `assets/`; root `.gitbook.yaml` points GitBook Git Sync at it) |

## Where things live (jump straight here)

**Generation flow (backend):**
- Fastify boot / CORS / error handler / `/health` → `apps/api/src/index.ts`
- HTTP routes under `/api/generations` (thin) → `apps/api/src/routes/generations.ts`
- Job orchestration + sequencing (the real pipeline) → `apps/api/src/jobs/runner.ts`
  - `startGenerationJob`: retrieve → `generateArticle` → (if poster) `generateCopy`
    → render poster → upload PNG(s) to Supabase Storage. The poster render forks on
    `ARTICLE_POSTER_MODE` (default `n8n`): `n8n` sends `{ headline, scene_brief,
    reference_url, layout_summary, has_photo_zone }` to the `article-poster-v1-api`
    webhook (`renderArticlePosterViaN8n`; `reference_url` = the pinned image, else a
    random enabled article master via `pickArticleReference`, which also returns the
    picked master's `layout_spec` — flattened to the two layout strings), which
    paints the poster body (headline + photo, following THAT master's layout) while
    leaving the logo/footer reserved zones blank; the API then code-stamps the crisp
    chrome (`overlayArticleChrome`) before upload — no scene image, no scenePath; `html` is the original `buildArticleScenePrompt`+
    `generateImage`+`generateArticlePoster` Chromium path (kept as fallback). Job state
    of record is the `generations` row (status/step/error), so polling clients survive
    refreshes.
  - `startSocialPostJob` sends the note plus the full reference-type catalog
    (`types` built by `buildTwitterCatalog`; `forced_type`/`forced_reference_url`
    non-empty when the run pinned an image or a whole type) to `social-post-v2-api`.
    The workflow paints only the poster body (its prompts erase the master's
    emblem/footer and reserve those zones); the API stamps `poster-logo.png`
    (top-right) + `poster-footer.png` (bottom) in code (`overlayTwitterChrome`) on
    every returned PNG — initial and image-feedback renders alike.
  - `startArticleFeedbackJob`, `startPosterFeedbackJob` (`copy` re-renders with the
    **cached** scene; `scene` regenerates the background image).
  - `startPosterImageFeedbackJob` (pixel feedback, both poster kinds): with marker
    annotations it draws numbered red boxes on the current poster
    (`annotateFeedbackRegions`), uploads `feedback-marked-v{n}-{ts}.png` (timestamped
    per attempt — the version counter only advances on success, so a failed round +
    resubmit would otherwise collide on the same path), turns marks +
    notes into one element-aware instruction via a gpt-4o vision pass
    (`interpretImageFeedback`, raw-notes fallback), and sends the marked URL +
    `marker_count` to n8n — whose feedback prompts branch on it (0 = legacy prompt
    byte-for-byte, so plain text feedback is unchanged). Web side:
    `PosterAnnotator` + `PosterImageFeedbackBox`. Deploy ordering is INVERTED for
    this feature: `pnpm n8n:push` first, API second (old workflow + new API can
    leave the red marker boxes in the output).
- DLO intake (meeting MP3s/PDFs/DOCX → reviewed Marathi text → normal generation):
  routes → `apps/api/src/routes/dlo.ts` (multipart with per-request 120 MiB/10-file
  limits; `/api/dlo/intakes` + `/:id` poll + `/:id/generate`); job →
  `apps/api/src/jobs/dlo-runner.ts` (`startDloIntakeJob`: one Sarvam batch STT job
  for ALL audio, per-file doc extraction, per-file failures don't sink the intake);
  Sarvam/extraction logic → `packages/content-engine/src/intake/*`
  (`sarvam-stt.ts`, `sarvam-doc.ts`, `docx.ts`, `combine.ts`; official `sarvamai`
  SDK, key `SARVAM_API_KEY`); rows/bucket → `packages/database/src/dlo-intakes.ts`
  + the PRIVATE `dlo-uploads` bucket (generic `uploadFile`/`downloadFile` in
  `storage.ts`).
- Article gen / coverage / faithfulness / revisions →
  `packages/content-engine/src/generation/*`
  (`generate-article.ts`, `verify-coverage.ts`, `generate-copy.ts`, `revise-*.ts`,
  `openai-chat.ts`; category-aware prompting in `category-prompt.ts`)
- RAG + ingestion → `packages/content-engine/src/{retrieval,embedding,chunking,scraping}/*`
- Poster rendering → `packages/poster-renderer/src/*`
  (`generate-article-poster.ts`, `build-scene-prompt.ts`, `openai-image.ts`,
  `article-template.ts` / `poster-template.ts`, `render-html.ts`,
  `article-chrome.ts` / `twitter-chrome.ts` — sharp overlays of the brand chrome
  onto n8n article/twitter posters); public API in `packages/poster-renderer/src/index.ts`
- Reference templates (type catalog + image rotation + per-run catalog for n8n) →
  `packages/content-engine/src/references/*` (`reference-types.ts`,
  `reference-images.ts`, `catalog.ts`, `analyze-template.ts`); routes →
  `apps/api/src/routes/references.ts`; web page → `apps/web/app/references/page.tsx`;
  home-page pin picker → `apps/web/components/ReferencePicker.tsx`
- DB access + Storage → `packages/database/src/*`
  (`client.ts`, `generations.ts`, `dlo-intakes.ts`, `reference-types.ts`,
  `reference-images.ts`, `mahasamvad-chunks.ts`, `storage.ts`)
- Shared types/schemas → `packages/schemas/src/*` (`copy.ts`, `api.ts`, `dlo.ts`)
- content-engine public API barrel → `packages/content-engine/src/index.ts`

**Web flow (user journey starts here):**
- Entry / create a generation → `apps/web/app/page.tsx`
- Generation detail (progress, article, poster, feedback) →
  `apps/web/app/generations/[id]/page.tsx`; history list →
  `apps/web/app/generations/page.tsx`
- Data layer → `apps/web/lib/api.ts`, `apps/web/lib/useGeneration.ts` (polling hook),
  `apps/web/lib/useGenerationThread.ts` (lineage rail; 5s poll only while a member runs)
- Marathi UI strings → `apps/web/lib/strings.ts`
- UI components → `apps/web/components/*` (`ArticleView`, `PosterPanel`,
  `ProgressSteps`, `FeedbackBox`, `CopyEditForm`, `HistoryCard`, `StatusChip`,
  `GenerationThread` — the runs-from-this-note rail above `NextActions`)
- DLO page (notes + MP3/PDF/DOCX → processing → **editable review** → article) →
  `apps/web/app/dlo/page.tsx`; intake poll hook → `apps/web/lib/useDloIntake.ts`
  (the generating phase reuses `useGeneration` + `ProgressSteps`)

**Data & schema:** `supabase/migrations/0001…0004_*.sql` — pgvector Mahasamvad
chunks, `generations` table, generation category + chunk style-category columns;
`0012`/`0013`/`0015` — reference-image library + `reference_types` catalog
(rotation semantics, exact-image and whole-type generation pins); `0016` —
`reference_images.layout_spec` (the master's vision-derived layout); `0017` —
generation-thread lineage (`source_generation_id` + denormalized `thread_root_id`;
detail-page follow-ups link, home-form runs are new roots; served by
`GET /api/generations/:id/thread`); `0018` — `dlo_intakes` table + private
`dlo-uploads` bucket + `generations.dlo_intake_id` lineage; `0019` — chunk embeddings
slimmed to `halfvec(1024)` (Matryoshka truncation of text-embedding-3-large) and the
HNSW index dropped, to fit the Supabase free tier — all embeds pass `dimensions: 1024`
and the match RPC signature is `halfvec(1024)` (deploy 0019 + the code together).

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
pnpm n8n:push       # ship n8n/workflow-exports/*.json to a running n8n (see below)
```

`pnpm n8n:push [--dry-run] [--only=<name>] [--create]` (`n8n/push-workflows.mjs`) is the
**only** way workflow changes reach a running n8n — see the gotcha below. It needs
`N8N_API_URL` + `N8N_API_KEY` in the root `.env` (key: n8n editor → Settings → n8n API).

Content pipeline (from `packages/content-engine`, e.g.
`pnpm --filter @dgipr/content-engine scrape:news`):
`scrape:news` / `chunk:news` / `embed:news` (WordPress-REST ingest → chunk →
embed to pgvector), plus `:karjamukti` variants; `retrieve:test`,
`generate:test`, `polish:test`; `intake:test <files…>` exercises the DLO
Sarvam STT/doc extraction on local files without the web UI (Sarvam spend).

Poster preview (renders sample posters without the API):
`pnpm --filter @dgipr/poster-renderer poster:preview` and `poster:preview:article`;
`poster:preview:markers` renders the numbered feedback-marker overlay at both
poster sizes (tune `src/feedback-marker.ts` for free).

User-guide screenshots (`docs/user-guide/assets`):
`pnpm --filter @dgipr/poster-renderer docs:shots <phase>` — phases
`preflight|static|run-article|run-feedback|run-twitter|run-rerun|history|optimize|verify`
(`--force` retakes; idempotent otherwise). The `run-*` phases trigger REAL generations
(OpenAI spend) and need `pnpm dev` + n8n up (local n8n starts with `npx n8n`). See
`packages/poster-renderer/scripts/docs-shots/cli.ts`.

One-time per machine (the API process renders posters too, so it needs a local
Chromium): `pnpm --filter @dgipr/poster-renderer exec playwright install chromium`.

## Conventions & gotchas

- **Marathi-first.** Never round-trip Marathi content through English. Names,
  dates, amounts, designations, scheme names, and locations are never invented —
  the user's note/uploaded docs are the only factual source; Mahasamvad articles
  are **style/structure references only**.
- **Completeness is tiered, not total — and tiers are citizen-first.** Foreground/supporting
  facts must be preserved; mention-tier detail may be compressed to a clause and omit-tier
  noise (committee rosters, accounting heads) dropped — editorial selection is a feature, not
  a bug. The brief assigns tiers by who a fact serves (benefits/eligibility/deadlines/citizen
  actions outrank implementation machinery; see `CATEGORY_TIER_GUIDANCE` in
  `editorial-brief.ts`), a tier-audit pass corrects mis-tiers, and the coverage loop enforces
  both sides (missing foreground/supporting + over-expanded mention/omit). "Never invent
  names/dates/amounts/designations/scheme names/locations" stays absolute; the faithfulness
  pass + fact-check appendix are the guard.
- **Package boundaries.** `apps/api` routes stay thin and only sequence calls +
  persist state; all LLM/render logic lives in `@dgipr/content-engine` and
  `@dgipr/poster-renderer`. Keep it that way.
- **Posters (HTML path):** in `ARTICLE_POSTER_MODE=html` the model paints a **text-free**
  photo and all Devanagari text, header, and footer are typeset in HTML and screenshotted
  with Chromium (this is what prevents garbled Marathi). Storage paths are versioned per
  render (public bucket is CDN-cached — never reuse a path).
- **Article poster via n8n (default).** With `ARTICLE_POSTER_MODE=n8n` the article poster
  is rendered by the `article-poster-v1-api` workflow, not Chromium: the API sends
  `{ headline, scene_brief, reference_url, layout_summary, has_photo_zone }` and the
  image model paints the **landscape** poster body (one Marathi headline, no
  bullets/stats — deliberately simple, distinct from the Twitter posters) by editing the
  master at `reference_url`. The workflow's Build Prompt is **layout-agnostic**: it never
  names a specific anatomy (a hardcoded "curved left panel + right photo zone" once made
  gpt-image-2 reshape every master into that one look, defeating the rotation's variety);
  structure is asserted only from `layout_summary`/`has_photo_zone` — the picked master's
  own `reference_images.layout_spec` (migration 0016) flattened to strings ('' = un-analyzed
  → generic conditional prompt; `has_photo_zone: 'false'` = hard no-imagery lock; the
  panel-colour theme is applied conditionally, only if the master actually has a solid
  headline panel). Article masters therefore need the `analyze:references` backfill just
  like twitter ones. This intentionally accepts image-model Devanagari for the single
  headline (verified acceptable). The brand chrome is NOT painted by the model: the prompt erases the
  master's logo/footer and declares those areas reserved zones (top-left ~560x220,
  bottom ~140px at 1536x1024, quiet background only), and `renderArticlePosterViaN8n`
  stamps `assets/article-logo.png` + `assets/poster-footer.png` in code
  (`overlayArticleChrome` in `packages/poster-renderer/src/article-chrome.ts`; zone
  numbers there and in the workflow's Build Prompt node must stay in sync; tune for
  free with `poster:preview:chrome`). The overlay also runs on image-feedback
  re-renders, re-stamping any chrome drift. No scene image is produced, so poster
  feedback + manual copy-edit (which need `scenePath`) are unavailable in this mode.
- **Twitter posters get the same code-stamped chrome.** `social-post-v2-api`'s prompts
  erase the master's महाराष्ट्र शासन emblem (top-right) + footer band/social strip and
  declare them reserved zones (top-right ~220x180, bottom ~130px at 1280x1600, quiet
  background only); `overlayTwitterChrome`
  (`packages/poster-renderer/src/twitter-chrome.ts`) stamps `assets/poster-logo.png` +
  `assets/poster-footer.png` on every webhook return — `startSocialPostJob` and the
  twitter image-feedback path alike. Zone numbers in twitter-chrome.ts and the
  workflow's Build Image Prompt / Build Feedback Prompt nodes must stay in sync; tune
  for free with `poster:preview:chrome:twitter`. Deploy order is the NORMAL one (API
  first, then `pnpm n8n:push`): new workflow + old API would ship posters with EMPTY
  reserved zones (no branding), while old workflow + new API merely double-stamps in
  place.
- **Whether a poster may contain a photo comes from the master's PIXELS, not its type
  description.** A vision pass (`references/analyze-template.ts`, gpt-4o-mini) runs once
  per uploaded master and caches `{ hasPhotoZone, bulletSlots, layoutSummary }` on
  `reference_images.layout_spec` (migration 0016); `buildTwitterCatalog` ships it to n8n
  as the picked image's `layout_spec`. `social-post-v2-api` branches on it: with
  `hasPhotoZone: false` it drops `scene_brief` from the copy json_schema entirely and
  emits a text-only lock instead of the "erase the existing photo, paint a NEW scene"
  clauses — which it used to emit **unconditionally**, which is why a text-only advisory
  master came back with an invented hero photograph. A **null** spec (un-analyzed image)
  deliberately reproduces the old prompt byte-for-byte, so backfill
  (`pnpm --filter @dgipr/content-engine analyze:references`, `--dry-run` to preview)
  is required for the fix to take effect on pre-0016 rows. A type's `description` still
  only steers the classifier + copy tone — never structure. Vision can misread, so
  `/references` shows the verdict per image with a re-check and a manual flip
  (`POST/PATCH /api/references/:id/analyze|layout-spec`).
- **Reference templates are a data-driven catalog, not a fixed list.** `reference_types`
  (migration 0013) holds the six builtins plus user-created custom twitter types; each
  type has a rotation of immutable library images (`reference_images`, many may be
  enabled at once, one picked at random per run) managed on `/references`. The home form
  can pin either one exact image (`generations.reference_image_id`) or a whole Twitter
  type (`generations.reference_type_id`). Both skip classification and force the type;
  a type pin still rolls one of that type's enabled images afresh per run. Custom-type
  slugs are server-generated
  (`custom_` + 8 hex) because they feed OpenAI json_schema enums + storage paths; custom
  copy uses the `generic` layout. If nothing is enabled in a category, the job fails
  with a Marathi error shown raw in the UI.
- **Editing a workflow JSON does not deploy it.** n8n keeps workflows in its own database
  (the `n8n_data` volume on the EC2 box); it never reads `n8n/workflow-exports/*.json` from
  disk. `git pull` + `docker compose up -d --build` on the host rebuilds only the **api**
  image, so the hosted workflows stay on whatever was last imported. Ship workflow changes
  with `pnpm n8n:push` (after deploying the API — the workflows need the API's newer payload
  fields). Two more traps the script exists to handle: the exports carry no `id` (a plain
  import creates duplicates that then collide on the webhook path), and credentials + the
  Webhook node's Header Auth are instance-specific. So the exports **name** their credential
  and carry **no credential id** — an id is meaningless off the machine that minted it — and
  each push resolves that name against the *target's own* credential list, **aborting before
  it writes anything** if the name isn't there (falling back to ids harvested from the
  target's live workflows only when its API won't enumerate credentials). Writing a foreign
  credential id is what produces `Credential with ID "…" does not exist for type
  "httpHeaderAuth"`: the workflow imports and activates cleanly, then dies mid-run. The
  Webhook node's Header Auth is likewise read off the live workflow, so a push can't disable
  `N8N_WEBHOOK_SECRET`.
- **The n8n MCP points at the LOCAL n8n** (`http://localhost:5678`), not the hosted one.
  Workflow ids seen through it (`1emSaqFmkLRUubUM`, `J4UTtNt2KMxuDSKf`) are local-dev ids
  and are meaningless on `n8n.indicex.xyz`. Never treat an MCP publish as a prod deploy.
- **n8n workflows are host-independent.** They no longer hardcode master URLs: the API
  sends the full type catalog (with immutable `references/library/...` public URLs) in
  every webhook payload, and the workflows fetch those over HTTPS — never local disk.
  The legacy canonical `references/master-*.png` objects remain in Storage only as seed
  data for `pnpm --filter @dgipr/content-engine seed:reference-library`. Deploy
  artifacts: `n8n/workflow-exports/{social-post-v2-api,article-poster-v1-api}.json` —
  import both into the AWS n8n (deploy the API first; the reworked workflows need the
  catalog fields in the payload).
- **All OpenAI traffic goes through `packages/content-engine/src/http/openai-request.ts`**
  (`openAiFetch`) — never `fetch` `api.openai.com` directly. It serializes calls process-wide
  (`OPENAI_MAX_CONCURRENCY`, default 1) and retries 429/5xx using the wait OpenAI names in its
  `retry-after` / `x-ratelimit-reset-*` headers. One article is 8-15 gpt-4o calls of ~5-8k
  tokens each, so on a 30k-TPM org concurrency > 1 reliably 429s; a `429 insufficient_quota`
  (billing, not rate) fails fast instead of backing off. Retry warnings in the log are the
  mechanism working, not a fault. `poster-renderer`'s image call and `sarvam-chat.ts` are not
  yet covered.
- **Env & secrets:** config comes from the root `.env` (see `.env.example`:
  Supabase + OpenAI, optional Sarvam). Never commit secrets.
- **Scraped output** under `packages/content-engine/data/` is gitignored — don't
  commit it or assume it's present.
