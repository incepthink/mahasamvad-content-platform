# AGENTS.md

This file is the persistent project memory for AI coding agents working in this repository.

## Project Goal

Build the **DGIPR Marathi Content Platform**, a Marathi-first content system for government communication teams.

The long-term product will:

- ingest meeting notes, government resolutions, press notes, and scheme information
- preserve official documents as the factual source of truth
- reuse historical Mahasamvad articles as style and structure references
- generate publication-ready Marathi articles and matching Marathi posters
- support future validation, RAG retrieval, poster generation, and Canva integration

## Current Phase

Scaffolding is done. The core generation pipeline and a first web product on top of
it are implemented and working end-to-end:

- Mahasamvad scraping/ingestion, chunking, embeddings, and RAG retrieval
  (`packages/content-engine/src/{scraping,chunking,embedding,retrieval}`)
- Article generation with coverage + faithfulness verification
  (`packages/content-engine/src/generation/generate-article.ts`)
- Poster generation, two modes selected by `ARTICLE_POSTER_MODE`:
  - `n8n` (default): the `article-poster-v1-api` workflow paints the landscape
    article poster body (incl. the single Marathi headline) by editing a master
    template — same external-render pattern as the twitter path
    (`renderArticlePosterViaN8n`). The logo/footer chrome is no longer painted by
    the image model: the prompt erases the master's branding and reserves those
    zones, and the API composites `article-logo.png` (top-left) +
    `poster-footer.png` (full-width bottom) in code after the webhook returns
    (`overlayArticleChrome`, `packages/poster-renderer/src/article-chrome.ts`) —
    on initial renders and image-feedback re-renders alike.
  - `html`: a text-free AI background photo typeset in HTML and screenshotted with
    Chromium so Devanagari is never mangled (`packages/poster-renderer`) — kept as fallback.
- Feedback/revision loops for the article and poster text/scene
  (`packages/content-engine/src/generation/revise-*.ts`), plus iterative pixel-level
  image feedback for n8n-rendered article and twitter posters: each edit uses the
  latest stored poster as its input and creates a new immutable poster version
- **Click-to-point poster feedback** (2026-07-19): the pixel-feedback request may carry
  up to 3 numbered marker annotations (`{ region (normalized 0..1), note }`), placed on
  the poster by click/drag in the web UI (`PosterAnnotator` overlay +
  `PosterImageFeedbackBox`, both poster kinds). Markers are **pointing gestures, not
  masks** — the change applies to the whole element at/around the mark. The job draws
  the same numbered red boxes on the poster (`annotateFeedbackRegions`,
  poster-renderer, vector-path digits so no container fonts needed), uploads that copy
  as `feedback-marked-v{n}-{ts}.png` (never a poster version; timestamped per attempt
  because the version counter only advances on success — a failed round + resubmit
  would otherwise collide on the same storage path), runs a gpt-4o vision
  interpreter (`interpretImageFeedback`, content-engine; falls back to raw numbered
  notes on failure) to produce one element-aware instruction, and sends the MARKED
  image URL + instruction + `marker_count` to n8n; both workflows' feedback prompts
  branch on `marker_count` (0 = the old prompt byte-for-byte) and tell the model to
  erase the marks. Revision history stores the user's raw numbered notes. On the web
  side the submitted markers stay visible client-side (dashed/dimmed, `usePosterMarkers`)
  through the re-render and on the new poster, and are restored to editable if the round
  fails; marker regions are not persisted server-side (future work). **Deploy
  ordering for this feature is inverted: push workflows first, then the API** — new
  workflow + old API degrades cleanly to the old prompt, but old workflow + new API
  would edit a marked image with no marker semantics and can leave red boxes in the
  output.
- A Fastify API (`apps/api`) exposing generation, feedback, and poster-edit
  endpoints under `/api/generations`, backed by Supabase tables
  (`supabase/migrations/0002_generations.sql`) and a public Storage bucket for
  poster/scene PNGs
- A Marathi-first Next.js frontend (`apps/web`) for non-technical government
  staff: create a generation, watch progress, edit poster text, send feedback,
  and browse history
- Standalone Marathi-to-English text translation (`POST /api/translate` and
  `/translate`) using the existing Sarvam block translation and verified glossary
  locks; ad-hoc text is not stored
- **Pre-translation name check** (2026-07-20): every translation — generation detail
  page and `/translate` alike — starts with an in-page "check the names" step instead
  of mining glossary candidates after the fact (names mined post-translation could
  never fix the run that produced them, e.g. संवाद वारी → "dialogue van", and fixing
  one meant a /glossary round-trip the target users never made). A prepare step
  (`POST /api/generations/:id/translate/prepare`, `POST /api/translate/prepare` →
  `prepareTranslationTerms` in `apps/api/src/jobs/translation-terms.ts`) runs the
  existing `extractGlossaryCandidates` merged with glossary rows found in the text;
  the web review card (`apps/web/components/TranslationTermsReview.tsx`) shows each
  name with an editable English spelling (verified rows badged, missed names addable),
  and confirming sends the list on the translate request — the API upserts them as
  VERIFIED glossary rows (source `manual`) before translating, so the confirmed
  spellings lock into that very run and every future one; post-translation mining is
  skipped on this path (the no-`terms` legacy path still mines, best-effort). The
  generation page also gained the previously missing re-translate affordance: once
  English exists, a fold re-runs the same name check and re-translates. No skip path
  by design; a prepare failure surfaces a retry, never a silent unchecked translation.
  No migration; deploy is API + web only.
- A reference-template system (`reference_types` + `reference_images`,
  `/api/reference-types` + `/api/references`, and the `/references` page): poster
  types are catalog rows — six builtins plus user-created custom twitter types
  (Marathi label + a description the n8n classifier routes by; generic copy
  layout) — each holding a rotation of immutable library images under
  `references/library/`. Any number of images per type may be **enabled**
  (`is_active`); one is picked at random per generation, and the home create form
  can pin either a specific image (`generations.reference_image_id`) or a whole
  twitter type (`generations.reference_type_id`). Both pins force the type and skip
  classification; a type pin still rolls one enabled image from that type per run.
  The API sends the full enabled
  catalog to n8n in each webhook payload, so the workflows are data-driven. The
  old copy-on-activate canonical `master-*.png` mechanism is retired — those
  storage objects remain only as inert seed data for `seed:reference-library`.
- **Template layout is read off the master's pixels, not declared in prose**
  (`references/analyze-template.ts`, migration 0016). A gpt-4o-mini vision pass runs once
  per uploaded master and caches `{ hasPhotoZone, bulletSlots, layoutSummary }` on
  `reference_images.layout_spec`; the per-run catalog carries the picked image's spec to
  n8n. `social-post-v2-api` branches on `hasPhotoZone`: a text-only master gets
  `scene_brief` removed from the copy json_schema and a hard no-imagery lock, instead of
  the "erase the existing photo / paint a NEW scene" clauses the workflow previously
  emitted on **every** render — which is what made a text-only advisory master come back
  as an infographic with an invented hero photograph. A type's `description` remains a
  classifier/tone steer only; it is not a structural signal and never was one. Null spec
  = un-analyzed = the old behaviour, so `analyze:references` must be run after 0016.
  `/references` surfaces each verdict with a re-check and a manual override, because a
  wrong photo-zone reading is otherwise invisible until a poster comes out wrong.
- **Generation threads** (migration 0017): follow-ups spawned from a run's detail page
  (the "पुढील पाऊल" cross-format/edit-note actions + failed-run retry) carry
  `source_generation_id` (direct parent) and `thread_root_id` (denormalized root, computed
  server-side as `parent.thread_root_id ?? parent.id` so chains stay flat). The home form
  sends neither — those runs are new roots. `GET /api/generations/:id/thread` returns the
  whole lineage as summaries (+ `noteChanged` vs the direct source, marking edit-note
  reruns), and the detail page renders it as a horizontal rail (`GenerationThread`) above
  the next-step panel — hidden when the run has no follow-ups, polled at 5s only while a
  member is still running. Lineage is insert-only and deliberately NOT embedded in the
  detail payload (the 2.5s detail polls stay cheap).
- **End-user documentation** (2026-07-14): a bilingual (English prose + verbatim Marathi
  UI labels), journey-wise GitBook manual in `docs/user-guide/` — 11 chapters,
  `SUMMARY.md`, ~54 real screenshots under `assets/` — served to GitBook via the root
  `.gitbook.yaml` (Git Sync). Screenshots regenerate with
  `pnpm --filter @dgipr/poster-renderer docs:shots <phase>`
  (`packages/poster-renderer/scripts/docs-shots/`); the `run-*` phases drive real
  generations through the UI with Playwright (OpenAI spend; needs `pnpm dev` + n8n),
  and `verify` lints SUMMARY/chapter/image links.
- **DLO intake** (2026-07-19): the `/dlo` page turns meeting material into an article —
  free-text notes + uploaded MP3 recordings / PDFs / DOCX. Files land in the PRIVATE
  `dlo-uploads` bucket and a `dlo_intakes` row (migration 0018); `startDloIntakeJob`
  (`apps/api/src/jobs/dlo-runner.ts`) transcribes all audio in ONE Sarvam **batch STT**
  job (`saaras:v3` mode `transcribe` → Marathi-in-Marathi-out; the sync endpoint only
  takes ~30s clips), OCRs PDFs via Sarvam **document digitization** (scanned Marathi
  GRs work), extracts DOCX locally with mammoth (all in
  `packages/content-engine/src/intake/`, official `sarvamai` SDK), and combines
  everything under per-source Marathi headers. A file failure marks only that file
  (surfaced at review); the intake fails only when nothing survived. The officer then
  **reviews and edits** the combined text (STT errors in names/amounts would otherwise
  become "facts" — the pipeline never invents but trusts its input), picks news/scheme,
  and `POST /api/dlo/intakes/:id/generate` funnels it as the note of a NORMAL
  generations row (`dlo_intake_id` lineage) through the existing pipeline — history,
  feedback, translation, and posters (via the detail page) all work on DLO runs.
  Requires `SARVAM_API_KEY`; no new article-generation logic was added.

Two n8n workflows are implemented and host-independent for deployment; their master
templates arrive as immutable `references/library/...` public URLs inside each webhook
payload (fetched over HTTPS — never local disk, no hardcoded storage paths):
- `social-post-v2-api` (the 'twitter' generation path) — the API sends the full `types`
  catalog (slug/label/description/copy_style/reference_url per enabled type) plus
  `forced_type`/`forced_reference_url` (empty strings unless pinned). The
  classify/copy/image nodes are data-driven from that catalog; a forced type skips the
  classify LLM call, and custom types render with the generic (headline + points) copy
  layout. Like the article path, the brand chrome is no longer painted by the image
  model: the workflow's prompts erase the master's महाराष्ट्र शासन emblem (top-right)
  and footer band/social-handle strip and declare them reserved zones (~220x180
  top-right, ~130px bottom at 1280x1600), and the API composites
  `poster-logo.png` + `poster-footer.png` in code after the webhook returns
  (`overlayTwitterChrome`, `packages/poster-renderer/src/twitter-chrome.ts`) — on
  initial renders and image-feedback re-renders alike. Deploy order for this is the
  NORMAL one (API first, then workflows): the new workflow with the old API would
  ship unbranded posters.
- `article-poster-v1-api` (the default news/scheme poster path) — the API sends
  `{ headline, scene_brief, reference_url, layout_summary, has_photo_zone }` and the
  workflow edits that master with gpt-image-2 (it fails loudly if `reference_url` is
  missing). Its Build Prompt is **layout-agnostic** (2026-07-20): it used to hardcode
  the original master's anatomy ("curved left headline panel + right-hand photo
  zone"), which made the image model reshape EVERY rotated master into that one look —
  the whole article-master rotation produced visually identical posters. Structure now
  comes only from the picked master's own vision-derived `layout_spec`
  (`pickArticleReference` returns it; the API flattens it to `layout_summary` +
  tri-state `has_photo_zone` strings, '' = un-analyzed → generic conditional prompt).
  `has_photo_zone: 'false'` emits a hard no-imagery lock, and the rotating panel-colour
  theme is applied conditionally (only if the master actually has a solid headline
  panel). Run the `analyze:references` backfill so article masters carry specs.
Both are committed under `n8n/workflow-exports/` (`social-post-v2-api.json`,
`article-poster-v1-api.json`).

**Deploying a workflow change: `pnpm n8n:push` (`n8n/push-workflows.mjs`).** n8n stores
workflows in its own database (the `n8n_data` volume), never reading the committed JSON
from disk — so editing an export, committing it, and `git pull`ing on the EC2 box does
**nothing** to the hosted workflows; `docker compose up -d --build` there rebuilds only the
`api` image. `pnpm n8n:push` PUTs the exports into the n8n named by `N8N_API_URL` over its
public REST API, matching by workflow name, binding each node's credential to the id the
*target instance's own* credential of that name holds (the committed JSON names credentials
but carries no ids — an id is meaningless off the machine that minted it), preserving the
Webhook node's Header Auth read off the live workflow, and republishing. It **aborts before
writing anything** if a credential name does not exist on the target, because a workflow
holding a foreign credential id imports and activates cleanly and only fails once the node
runs (`Credential with ID "…" does not exist for type "httpHeaderAuth"`) — create the
credential in the n8n UI (runbook C1 step 3) and re-run. Run it **after** deploying the API — the workflows need
the catalog fields the current API sends. Related: the n8n **MCP server is pointed at the
local dev n8n** (`http://localhost:5678`); the workflow ids visible through it
(`1emSaqFmkLRUubUM`, `J4UTtNt2KMxuDSKf`) are local ids, and an MCP publish is **not** a
prod deploy — earlier notes claiming those exports were "synchronized and republished" on
2026-07-13 described the local instance only. API job logs record the exact pinned or
selected reference URL sent to each workflow, so drift stays visible.

In progress: an editorial-rewrite pipeline (editorial brief → tiered coverage → editorial-
quality judge → optional subheadings) that moves article generation from total-coverage
restatement to edited, angle-led Mahasamvad articles under the tiered completeness contract
in Product Principles. The brief tiers facts **citizen-first** (benefits/eligibility/deadlines/
citizen actions outrank committee compositions and other implementation machinery; citizen
outcomes buried in committee-task lists are re-attributed to the reader's perspective), a
second tier-audit pass corrects mis-tiers, sectioned long-note drafts are tier-aware, and the
coverage loop guards both sides (missing foreground/supporting facts AND over-expanded
mention/omit detail). RAG stays style-only and the faithfulness/fact-check guards are untouched.

Not implemented yet: Canva integration, authentication.

## Planned Architecture

- `apps/web`: Next.js frontend application
- `apps/api`: Fastify backend API
- `packages/content-engine`: document processing, AI, RAG, article generation, and revision logic
- `packages/database`: Supabase queries, database helpers, and database types
- `packages/schemas`: shared Zod schemas and TypeScript types (poster copy + generation API)
- `packages/poster-renderer`: poster-generation logic (Canva integration still future)
- `supabase/migrations`: SQL migrations
- `n8n/workflow-exports`: committed n8n workflow exports (`social-post-v2-api.json`, `article-poster-v1-api.json`)
- `docs`: project documentation

## Product Principles

- Marathi must remain the primary content language.
- Do not translate Marathi source content into English and back unless explicitly required.
- Existing Mahasamvad articles are primarily style and structure references.
- New notes and uploaded official documents are the factual source of truth for new content.
- Names, dates, amounts, designations, scheme names, and locations must never be invented.
- Completeness is **tiered, not total**. The article need not restate every unit of the
  note. Facts the pipeline tiers as **foreground/supporting must be preserved**;
  **mention**-tier detail may be compressed to a clause; **omit**-tier noise (e.g. full
  committee-member lists, accounting heads) may be absent. Editorial selection — a real
  editor compresses and omits to serve an angle — is a *feature*, not a defect. The "never
  invent names/dates/amounts/designations/scheme names/locations" rule above stays absolute
  and unchanged; the faithfulness pass and fact-check appendix remain the guard.
- Core business logic must remain modular, testable, version-controlled, and stored in code.
- n8n may later be used for scheduling, notifications, retries, and automation, but the main business logic must not live inside large n8n workflows.
- Secrets, API keys, and credentials must never be committed to the repository.

## Required Rules For Future Agents

1. Every future AI agent must read this `AGENTS.md` file before making changes.
2. `AGENTS.md` must be updated whenever a major architectural decision or implementation milestone changes.

## Development Expectations

- Preserve useful existing files and configuration.
- Prefer shared, reusable code over one-off logic.
- Keep implementation boundaries clear: `apps/api` routes stay thin; LLM/rendering
  logic lives in `packages/content-engine` and `packages/poster-renderer`; `apps/api`
  only sequences calls and persists state (see `apps/api/src/jobs/runner.ts`).
- Run `pnpm --filter @dgipr/poster-renderer exec playwright install chromium` once
  per machine — the poster renderer needs a local Chromium for the API process too.
