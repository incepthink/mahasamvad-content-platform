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

| Path                        | Package                   | Responsibility                                                                                                                                                                                                                 |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                  | `@dgipr/web`              | Next.js (App Router) Marathi-first UI                                                                                                                                                                                          |
| `apps/api`                  | `@dgipr/api`              | Fastify API — thin routes + job orchestration                                                                                                                                                                                  |
| `packages/content-engine`   | `@dgipr/content-engine`   | Scraping, chunking, embeddings, RAG, article generation + revision                                                                                                                                                             |
| `packages/poster-renderer`  | `@dgipr/poster-renderer`  | Poster: AI background photo + HTML/Chromium typesetting                                                                                                                                                                        |
| `packages/database`         | `@dgipr/database`         | Supabase client, queries, storage helpers, row types                                                                                                                                                                           |
| `packages/social-publisher` | `@dgipr/social-publisher` | Direct posting to the official X account (`twitter-api-v2`, OAuth 1.0a) and Facebook Page (Graph API) — pure functions, no DB/LLM deps                                                                                         |
| `packages/schemas`          | `@dgipr/schemas`          | Shared Zod schemas + types (poster `Copy`, generation API)                                                                                                                                                                     |
| `supabase/migrations`       | —                         | SQL migrations (pgvector + generations)                                                                                                                                                                                        |
| `n8n/workflow-exports`      | —                         | Committed n8n workflow JSON (`social-post-v2-api.json` twitter path; `article-poster-v1-api.json` article poster — import targets for AWS)                                                                                     |
| `docs`                      | —                         | Project docs (`PROJECT_CONTEXT.md`, `web-scraping-context.md`); `docs/user-guide/` is the GitBook end-user manual (bilingual, journey-wise, real screenshots in `assets/`; root `.gitbook.yaml` points GitBook Git Sync at it) |

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
  - `startSocialPostJob` (both social categories — see below) sends the note plus the
    full reference-type catalog
    (`types` built by `buildTwitterCatalog`; `forced_type`/`forced_reference_url`
    non-empty when the run pinned an image or a whole type) to `social-post-v2-api`,
    along with `platform` (the row's category — currently inert, the hook for a future
    per-platform branch).
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
  limits; `/api/dlo/intakes` + `/:id` poll + `/:id/generate` +
  `/:id/files/:index/reextract`); job → `apps/api/src/jobs/dlo-runner.ts`
  (`startDloIntakeJob`: one Sarvam batch STT job for ALL audio, per-file doc
  extraction, per-file failures don't sink the intake);
  Sarvam/extraction logic → `packages/content-engine/src/intake/*`
  (`sarvam-stt.ts`, `sarvam-doc.ts`, `docx.ts`; official `sarvamai`
  SDK, key `SARVAM_API_KEY`); rows/bucket → `packages/database/src/dlo-intakes.ts`
  - the PRIVATE `dlo-uploads` bucket (generic `uploadFile`/`downloadFile` in
    `storage.ts`).
  - **A scanned PDF is PROBED, not read, by the intake job.** `probePdfEntry` stores
    `status: 'needs-selection'` + `pageCount` and spends nothing; the officer picks pages on
    the review card and `POST /dlo/intakes/:id/extract { selections }` →
    `startDloExtractionJob` reads every chosen file in one job (an intake can hold several
    scans, so it is one click, not N). A born-digital PDF's text layer is free, so the probe
    keeps its pages and that file never shows a selection step. Generate is BLOCKED while any
    file is `needs-selection` — such a file contributes nothing to `combineIntakeSources`, so
    generating would silently drop a whole source. No migration (jsonb).
  - **The review step is per SOURCE, not one textarea** (`DloSourceReview` +
    `apps/web/lib/dloReview.ts`). Each file entry in the `files` jsonb carries its own
    extracted text — `text` for audio/DOCX, `pages` + `pdfSource` for PDFs (read with
    `extractPdfPagesDetailed`, so DLO gets the same text-layer/OCR policy and badge as
    `/translate`) — which needed **no migration**, jsonb having no column schema. The web
    re-assembles the note from the officer's edits and page selection with
    `combineIntakeSources`, which therefore lives in `@dgipr/schemas` (not
    content-engine — `apps/web` cannot import pdfjs/sarvam/openai), exactly as
    `tweetWeightedLength` does. `POST /:id/generate` is unchanged: it still receives one
    assembled `combinedText` string. Because those text fields are big and the poll runs
    for minutes, `GET /:id` ships them only on `?text=1`, and `useDloIntake` fetches the
    heavy shape once **per transition into `ready`** — "per transition", not "once", is
    what makes an OCR re-read deliver its new pages. An intake created before this
    (extracted files with no `text`/`pages`) falls back to the old single textarea via
    `hasPerSourceText`.
  - Per-file OCR re-read: `POST /dlo/intakes/:id/files/:index/reextract` →
    `startDloFileReextractionJob`. Only a text-layer read offers it. The ROUTE flips the
    row to running before answering 202 — do not move that into the job: the client
    refreshes the instant the 202 lands, and a row still reading `ready` stops its poll
    and sits there through the whole OCR. DLO can afford this where `/translate` cannot
    because the original file is still in the private bucket.
- Proof Read (ad-hoc grammar/name/style check of pasted Marathi/English text):
  route → `apps/api/src/routes/proofread.ts` (`POST /api/proofread`, synchronous,
  nothing stored; assembles the verified-glossary context); engine →
  `packages/content-engine/src/generation/proof-read.ts` (2 chat calls max —
  analysis + confirm-or-drop verify, skipped when clean; corrected text is a
  deterministic excerpt→suggestion patch with a digit-preservation guard, never a
  model rewrite; name fixes are glossary-gated; Marathi input gets one RAG style
  exemplar); schemas → `packages/schemas/src/proofread.ts`; web →
  `apps/web/app/proofread/page.tsx`.
- Explainer videos (`/video` — note → AI scene PLAN → per-scene Marathi script →
  TTS voiceover + measured clip windows → storyboard stills → Veo-animated VOICED MP4 +
  SRT): routes → `apps/api/src/routes/video.ts` (create/poll/
  script-save/storyboard/still/animate/scene-animate; the two review gates are idle
  statuses `script_ready`/`storyboard_ready`, and every route that leaves a gate flips
  the row BEFORE its 202 — the storyboard route flips step `narrate`, its job's first
  phase); jobs → `apps/api/src/jobs/video-runner.ts` (script job,
  storyboard job — whose TOP is the TTS-first voice phase `ensureNarrationAudio`:
  synthesize per scene, MEASURE the WAV, fit `durationSeconds` to the smallest 4|6|8s
  window via `fitSceneDurationSeconds` so clips carry no dead air and gate 2 prices the
  real spend; WINDOW-FREEZE rule: a scene with a current clip keeps its window (atempo
  absorbs drift, never invalidate a paid Veo clip; `clipIsCurrent` also checks
  `clipDurationSeconds`); per-scene TTS failure → char-rate fallback
  (`VIDEO_NARRATION_CHARS_PER_SECOND`, default 32) and a silent render, never a stuck
  gate — then per-scene stills; RESUME-AWARE animate job — each Veo clip is
  persisted the moment it lands, so a retry re-renders only missing scenes — and a
  per-scene re-animate that restitches without touching other clips; the
  post-completion narrate route is re-voice/recovery only, videos are voiced by
  default); engine →
  `packages/content-engine/src/video/*` (`plan-video-scenes.ts` — the planner that
  decides scene count (2-8, bucket = preference only) + per-scene Marathi `beat` +
  English `shotHint` + target window, citizen-first tiering; `generate-video-script.ts`
  gpt-4o JSON+repair writing narration AGAINST that plan with code-computed word
  budgets, then ONE bounded coverage round (gpt-4o-mini check + at most one repair,
  accepted either way); narration char cap = `VIDEO_NARRATION_MAX_CHARS` in schemas,
  the single source shared with the script-save schema;
  `video-prompts.ts` — every visual prompt HARD-FORBIDS on-screen text since video
  models garble Devanagari AND talking/lip movement/close-up faces since Veo glitches
  on mouths (people may appear, never speak; narration carries the words; `shotHint`
  replaces the generic camera line when present) — `veo-client.ts` raw-REST
  long-running-op client over `http/gemini-request.ts`, model ids env-overridable
  `VEO_MODEL_*`, key `GEMINI_API_KEY`; **per-model params are LEARNED, not declared** —
  the 3.1 lite preview 400s on `negativePrompt` where fast/standard accept it, so a
  rejection (typed `GeminiRequestError`, matched on the field name) drops the field,
  caches that per model id, and re-renders; repointing `VEO_MODEL_*` at a quota-fresh
  model therefore needs no code change, and switching back restores the negative
  prompt); assembly → `packages/poster-renderer/src/video/
  assemble.ts` (ffmpeg-static, always re-encode `-an` yuv420p+faststart; `FFMPEG_PATH`
  escape hatch; `wavDurationSeconds` is what the voice phase measures with);
  rows/bucket → `packages/database/src/video-projects.ts` + the PUBLIC
  `videos` bucket (migration 0026; scenes are jsonb — `beat`/`shotHint`/
  `narrationAudioSeconds`/`clipDurationSeconds` were added WITHOUT migration); shared
  tier pricing + `buildSrt` + the fit helpers
  → `packages/schemas/src/video.ts` (web renders pre-spend estimates, must not import
  content-engine). One active project at a time (DB-backed 409, not TasksProvider).
  Harnesses: `video:preview:assemble` (free), `tsx --env-file=../../.env
  src/video/plan-video-scenes.ts "<टिपणी>" [short|long]` (cents),
  `tsx --env-file=../../.env src/video/generate-video-script.ts "<टिपणी>" [short|long]`
  (cents),
  `tsx --env-file=../../.env src/video/veo-client.ts <still.png> --lite --4s` (~$0.3 —
  run this FIRST to prove Veo access). No n8n anywhere on this path.
- Direct social publishing (post a completed twitter/facebook run's poster +
  caption to the OFFICIAL accounts): synchronous `POST /api/generations/:id/publish`
  in `apps/api/src/routes/generations.ts` (platform = the row's category; guards:
  in-flight set, running job, 280-char weighted tweet limit — reject, never
  truncate; missing env creds → Marathi 503); platform calls →
  `packages/social-publisher/src/{twitter,facebook}.ts` (X = `twitter-api-v2`
  OAuth 1.0a + v2 media upload with poster bytes; FB = Graph API `/{page}/photos`
  with the public poster URL). Latest live-post URL persisted as
  `generations.published_url`/`published_at` (0021, overwritten on re-publish);
  web button + two-step confirm in `apps/web/components/SocialPostView.tsx`.
  Env `TWITTER_*` + `FACEBOOK_PAGE_*`; credential walkthrough in
  `docs/social-publishing-setup.md`.
- Caption editing on a social run (the caption is `generations.article`): two paths on
  the same detail-page card (`SocialPostView`) — a **hand edit** (the caption is a
  read-only `.social-caption` block until "कॅप्शन बदला" swaps in a textarea;
  `PUT /api/generations/:id/caption`, synchronous, no model call) and an **AI
  revision** (`POST /api/generations/:id/caption/feedback` → `startCaptionFeedbackJob` →
  `reviseCaption` in `packages/content-engine/src/generation/revise-caption.ts`; one
  gpt-4o call + one repair, note-as-sole-fact-source guardrails, numerals re-scriptable
  but never re-valued). The article feedback route cannot serve this — `reviseArticle`
  goes through `articleCategoryOf`, which hard-fails on a social category. Like
  translation, the job owns **no** status/step and reports through the detail payload's
  `captionRevising`/`captionReviseError` (registry in `runner.ts`), because the row is
  already `completed`: flipping it to running would replace the finished post with a
  progress bar, and the registry also lets a caption edit run beside a poster re-render.
  Revisions are logged as `caption` / `manual_caption` (migration 0023). The web shows a
  plain `N अक्षरे` count, not an X-weighted `N / 280` counter (tried, dropped as noise);
  X's limit lives in the publish-time 422 alone. `TWEET_MAX_LENGTH` +
  `tweetWeightedLength` still live in `@dgipr/schemas` (`packages/schemas/src/tweet.ts`)
  for the API — `apps/web` must not import `@dgipr/social-publisher` (twitter-api-v2).
- Translation (Marathi → English **or Hindi**) →
  `packages/content-engine/src/generation/translate-article.ts`; the two targets use
  DIFFERENT Sarvam APIs and that is deliberate: English = chat (`sarvam-chat.ts`) with a
  prompt-level LOCKED TERMS glossary table; Hindi = the dedicated translation endpoint
  (`sarvam-translate.ts`, `sarvam-translate:v1`, native numerals) because the chat model
  returns Marathi unchanged when asked for Hindi. The endpoint takes no prompt, so Hindi
  name fidelity is enforced afterwards in code — glossary rows typed
  `person`/`place`/`org`/`scheme` must survive verbatim as the row's **`hindi` spelling**
  (`glossary_terms.hindi`, migration 0025 — an optional per-name Hindi dictionary that
  **defaults to the Marathi form** when unset, which is the common case), a near-miss is
  repaired PER WORD by edit distance (`edit-distance.ts`, shared with `proof-read.ts`;
  multi-word names anchor on an exact-match word so per-word nudges can't invent a name),
  and a name that still cannot be accounted for is REPORTED, not fatal — the block returns
  `unpreservedNames` and the translation is delivered anyway (verbatim checks can't tell a
  mistranslated name from a correctly re-rendered one — नागपूर महानगर प्रदेश प्राधिकरण →
  नागपुर महानगर क्षेत्र प्राधिकरण — so throwing discarded correct, already-billed work; the
  officer reviews the flagged names in the output). Only an output that came back as the
  Marathi original stays fatal (it gets the one retry). `designation`/`other` rows are
  intentionally left translatable, and the name-review card's per-row "keep verbatim in
  Hindi" toggle demotes a common noun the extractor over-typed (विधानसभा) to `other` so it
  stops being locked. `unpreservedNames` surfaces on the pasted-text + PDF responses and,
  for a generation run, transiently on the detail payload (`translateWarnings`, in-process
  registry beside `translateError`). The name-review card (`TranslationTermsReview`) shows/edits that Hindi
  spelling on a Hindi run (pre-filled with the Marathi form; the English column feeds the
  English lock and is carried through untouched), so an officer can correct कोल्हापूर →
  कोल्हापुर and have the output follow.
  Storage: `generations.article_english` / `article_hindi` (0022), independent of each
  other; one translation runs at a time per row and the detail payload's
  `translatingLanguage` says which. Routes → `apps/api/src/routes/translate.ts` +
  `/generations/:id/translate` (both take `language`, defaulting to `'en'`); job →
  `startTranslateJob` in `apps/api/src/jobs/runner.ts`; web → `ArticleView` toggle +
  `apps/web/app/translate/page.tsx` selector. Harness:
  `tsx --env-file=../../.env src/generation/translate-article.ts [en|hi]`.
- **PDF text extraction (both PDF surfaces — `/translate`'s PDF mode and DLO intake).**
  **Nothing is read until the user has picked pages.** Upload runs `probePdf` only (page
  count + a local text-layer attempt + verdict — free, never calls Sarvam); the pages the
  user then selects arrive as `ExtractPdfOptions.pages` and are the ONLY pages sent to OCR.
  `splitPdfPages(data, maxPages, pageNumbers?)` copies exactly that selection (pdf-lib
  `copyPages` takes any index array), each `PdfChunk` carries `originalPages: number[]`
  instead of a contiguous `startPage`/`pageCount`, and `extractPdfPagesViaOcr` restores page
  identity with `chunk.originalPages[page.page - 1]` — the single line that decides whether
  the right pages come back. `OCR_MAX_TOTAL_PAGES` (default 50) therefore now bounds the
  SELECTION, not the document, so a few pages of a 300-page scan is a usable request. On the
  `auto` path the text layer is re-read (free) and the verdict is computed on the SELECTED
  pages, so a booklet that is scanned overall but typeset on the three pages wanted still
  costs nothing.
  `extractPdfPages` / `extractPdfPagesDetailed` / `probePdf` live in
  `packages/content-engine/src/intake/pdf-pages.ts` and pick between TWO backends:
  the PDF's own **text layer** (`pdf-text-layer.ts`, pdf.js — instant, free, unlimited
  pages, exact characters) and **Sarvam OCR** (`sarvam-doc.ts` — pixels, minutes, credits,
  misreads names). Text layer first, OCR on a bad verdict. `textLayerVerdict` returns
  `empty` (scanned) or `garbled`, the latter on PUA/control junk **or Devanagari in visual
  order** — a Chromium-printed Marathi page extracts `निर्णय` as `िनण य` and `कोल्हापूर` as
  `को ापूर`, which every ratio-based check would pass, so the test is the Unicode invariant
  that a dependent matra can never open a word. Because the gate can't be perfect, the user
  can overrule it: `POST /translate/documents/:id/reextract` → `startDocumentReextraction`
  (the job therefore KEEPS the PDF bytes for its TTL — still nothing on disk or in the DB).
  That override carries `pages` too: it overrules the QUALITY gate, never the spend gate.
  Sarvam caps a digitization job at **10 pages** and takes no page-range parameter, so
  `extractPdfPagesViaOcr` splits with `pdf-split.ts` (pdf-lib) into ≤10-page chunks and runs
  them one at a time. Page numbers are the DOCUMENT's throughout — blank pages are kept,
  never renumbered away. Harness:
  `tsx --env-file=../../.env src/intake/pdf-pages.ts <file.pdf> [--ocr|--text] [--pages=2,5,9] [--probe]`.
- PDF translation (`/translate` → **PDF फाईल** mode; the pasted-text mode is unchanged and
  still synchronous): background job → `apps/api/src/jobs/translate-document.ts` (IN-MEMORY
  registry, 60-min TTL, the PDF held only in that registry — nothing is stored, so a 404 =
  "expired or API restarted, upload again"). Upload only PROBES (`startDocument`, awaited so
  the 202 carries `pageCount`/`needsOcr` and an unreadable PDF fails the upload rather than
  becoming a job that exists to report its own failure). A born-digital file lands straight
  in `ready` with its free text-layer pages — behaviourally unchanged, the review list is
  its page picker. A scanned one stops at the new **`selecting`** status with only a page
  count, and `POST /translate/documents/:id/extract { pages }` reads exactly what was ticked.
  `selecting` is idle like `ready`, so it must stay OUT of `useTranslateDocument`'s `active`
  poll set. Routes → the `/translate/documents*` block in
  `apps/api/src/routes/translate.ts` (upload 202 / poll / extract / reextract / interpret /
  prepare / translate; `GET ?text=1` for the heavy payload, the 2.5 s poll goes lean);
  per-page text →
  the extraction policy above, with the detail payload carrying `source` (`text-layer` |
  `ocr`, badged in the review card) and `extractProgress` (pages, for chunked OCR);
  per-page routing → `packages/content-engine/src/generation/translate-document.ts`
  (English page + English target = **verbatim passthrough**, never re-written; English page +
  Hindi target = `sourceLanguage: 'en'` on the Sarvam endpoint); page instruction →
  `interpret-document-instruction.ts` (**structural only** — resolves to page numbers, regex
  first incl. Devanagari digits, gpt-4o-mini only for content-based asks; never reaches the
  translator); schemas → `packages/schemas/src/translate-document.ts`; web →
  `apps/web/components/TranslateDocumentPanel.tsx` + `lib/useTranslateDocument.ts`. Harness:
  `tsx --env-file=../../.env src/generation/interpret-document-instruction.ts "<सूचना>"`.
- Article gen / coverage / faithfulness / revisions →
  `packages/content-engine/src/generation/*`
  (`generate-article.ts`, `verify-coverage.ts`, `generate-copy.ts`, `revise-*.ts`,
  `openai-chat.ts`; category-aware prompting in `category-prompt.ts`)
- RAG + ingestion → `packages/content-engine/src/{retrieval,embedding,chunking,scraping}/*`
- Poster rendering → `packages/poster-renderer/src/*`
  (`generate-article-poster.ts`, `build-scene-prompt.ts`, `openai-image.ts`,
  `article-template.ts` / `poster-template.ts`, `render-html.ts`,
  `article-chrome.ts` / `twitter-chrome.ts` / `cmo-chrome.ts` + `cmo-geometry.ts` —
  sharp overlays of the brand chrome onto n8n article/twitter/CMO posters); public API in
  `packages/poster-renderer/src/index.ts`
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
- DLO page (notes + MP3/PDF/DOCX → processing → **per-source editable review** →
  article) → `apps/web/app/dlo/page.tsx` + `apps/web/components/DloSourceReview.tsx`
  (one card per source; PDFs as a `/translate`-style page list) +
  `apps/web/lib/dloReview.ts` (source keys, assembly, per-file forgetting); intake poll
  hook → `apps/web/lib/useDloIntake.ts` (the generating phase reuses `useGeneration` +
  `ProgressSteps`)

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
and the match RPC signature is `halfvec(1024)` (deploy 0019 + the code together);
`0020` — the `facebook` generation category (apply it BEFORE deploying the API, or the
first Facebook run fails the CHECK); `0021` — `generations.published_url`/`published_at`
(latest live social post; additive + nullable, apply before the API deploy); `0022` —
`generations.article_hindi` (on-demand Hindi translation, independent of
`article_english`; additive + nullable, apply before the API deploy); `0023` — the
`caption` + `manual_caption` revision targets (social-caption edits). **Apply 0023
before the API deploy**: a caption edit persists the text and inserts the audit row
after it, so without the constraint value the save lands and the request still 500s.
`0025` — `glossary_terms.hindi` (optional per-name Hindi spelling; additive + nullable,
null = the Hindi lock keeps the Marathi form, so an old API is unaffected — apply before
the API deploy). `0026` — `video_projects` table + public `videos` bucket (explainer
videos; new table, apply before the API deploy).

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
poster sizes (tune `src/feedback-marker.ts` for free). Chrome overlays preview the
same way — `poster:preview:chrome`, `:chrome:twitter`, `:chrome:cmo` (pass a poster
PNG and optionally a circle-photo PNG to stamp a real render; a stand-in photo is used
otherwise). `assets:cmo-frame` regenerates `assets/cmo-photo-frame.png` after any change
to `src/cmo-geometry.ts`.

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
- **Two social categories, one lane.** `twitter` and `facebook` (migration 0020) are
  distinct `generations.category` values that today run the _identical_ pipeline —
  same `startSocialPostJob`, same `social-post-v2-api` workflow, same twitter master
  library, same `overlayTwitterChrome`, same 1280x1600 image-cost tier. Facebook is a
  separate value only so the runs are distinguishable in history and the two can
  diverge later without a backfill. **Never branch on `category === 'twitter'`** —
  every social-vs-article decision in `apps/api` and `apps/web` goes through
  `isSocialCategory()` (`packages/schemas/src/api.ts`); missing one silently routes a
  Facebook run into the article pipeline, where `articleCategoryOf` throws. The
  `ReferenceCategory` union (`'twitter' | 'article'`, the master-template library) is a
  _different_ enum and legitimately stays two-valued — social runs map to `'twitter'`
  there. The web tasks panel gates both on one `hasActiveSocialTask` (one n8n workflow,
  serial renders), so a Facebook run blocks a Twitter run and vice versa.
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
  master's logo/footer and declares those areas reserved zones (top-left ~420x180,
  bottom ~150px at 1536x1024, quiet background only), and `renderArticlePosterViaN8n`
  stamps `assets/article-logo.png` (~342x122 at left 31 / top 13 — the official frame
  design's own 22.3%-of-width proportion) + `assets/poster-footer.png` in code
  (`overlayArticleChrome` in `packages/poster-renderer/src/article-chrome.ts`; zone
  numbers there, in `ARTICLE_RESERVED_ZONES` (web), and in the workflow's Build Prompt
  node must stay in sync; tune for free with `poster:preview:chrome`). The Build Prompt
  states the reserved zones **before** the erase instruction and repeats them as a
  final check, and forbids reflowing the headline into the erased branding's space —
  without that the model floated the headline up under the stamped logo, which then
  clipped it. The overlay also runs on image-feedback
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
- **CMO posters stamp their PHOTO too, not just branding — ONE code-composited circle.**
  The CMO brand's chrome is a full-width leader header (`assets/cmo-header.png`) plus the
  reused DGIPR footer — and the upper-right photo circle. The official design once had TWO
  overlapping circles, but the image model could never render two reliably (it painted one
  photo plus a flat blue crescent where the second belonged), so the second circle was
  DROPPED and the single photograph is now **generated by the API and composited in code**,
  not painted by the master-edit model. `src/cmo-geometry.ts` holds the geometry (recovered
  from the header's alpha by least-squares fits, ~1.5px): `CMO_BIG` is the one photo circle,
  and `CMO_SMALL` is retained only as a **filled lobe** — `cmo-header.png` is a fixed asset
  whose cut-out is the union of both lobes, so the frame must paint the small lobe over
  (band-colour above the band line, page white below) or a hole opens under the header.
  `scripts/build-cmo-photo-frame.ts` (`assets:cmo-frame`) bakes ONE overlay,
  `assets/cmo-photo-frame.png` (opaque outside the big circle, filling the small lobe, plus
  the translucent ring). `overlayCmoChrome(poster, photo)` resizes the photo to the big
  circle's bounding box and composites `[photo, header, frame, footer]` — the header cut-out
  - the frame crop the photo down to exactly the big-circle interior, so no separate circle
    mask is needed. The runner generates the photo once from `copy.scene_brief`
    (`buildCmoCirclePhotoPrompt`, square `1024x1024`), caches it at `cmoPhotoPath(id)` =
    `generations/{id}/cmo-photo.png`, and **re-composites the SAME cached photo on feedback**
    (a text/layout edit must never swap the photo; the workflow leaves the circle zone quiet
    on feedback too). The workflow now RESERVES the circle zone (Build Image Prompt / Build
    Feedback Prompt tell the model to leave it a quiet plain background) and returns
    `scene_brief` (surfaced through `Decode Image` → `Respond to Webhook`). The circle
    percentages in the workflow's CMO branches and `cmo-geometry.ts` must stay in sync; tune
    the geometry for free with `poster:preview:chrome:cmo`. Deploy order is the NORMAL one
    (API first, then `pnpm n8n:push`): new API + old workflow degrades to a generic-subject
    photo, while new workflow + old API would leave the circle empty.
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
  each push resolves that name against the _target's own_ credential list, **aborting before
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
