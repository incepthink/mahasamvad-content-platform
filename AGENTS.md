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
- **Hindi translation** (2026-07-21, migration 0022): every translation surface now
  offers हिंदी beside English — the `/translate` page via a target-language selector, and
  a generation's article via a second translate button, with the two translations stored
  independently (`generations.article_hindi` beside `article_english`) and a
  मराठी | English | हिंदी toggle showing whichever exist. Both languages share one
  request (`language: 'en' | 'hi'`, defaulted to `'en'`), one in-flight slot per row
  (`translatingLanguage` on the detail payload names which is running), and the SAME
  pre-translation name check. **The Hindi path does not use the chat model**: sarvam-30b
  cannot translate Marathi→Hindi at all — it returns the Marathi unchanged and asserts it
  is Hindi (verified with three prompt shapes), a failure that is invisible in Devanagari.
  Hindi therefore goes through Sarvam's dedicated `/translate` endpoint
  (`sarvam-translate:v1`, `numerals_format: native` so ५०० does not become 500), which
  takes no prompt and so cannot be handed a LOCKED TERMS table. Name fidelity is instead
  **enforced after the fact and deterministically**: glossary rows typed `person`/`place`/
  `org`/`scheme` that appear in the source must appear verbatim in the output as the row's
  **`hindi` spelling** (see the Hindi-dictionary milestone below — it defaults to the
  Marathi form, so at first this was simply "the Marathi form verbatim"); a near-miss
  (कोल्हापुर vs कोल्हापूर) is repaired per word by edit distance ≤2 (a multi-word name must
  anchor on an exact-match word so per-word nudges can't compound into a different name),
  and a name that still cannot be accounted for is REPORTED (`unpreservedNames`), not fatal
  — see the "warn, don't discard" milestone below; the translation is delivered and the
  officer checks the flagged names. `designation`/
  `other` rows are deliberately NOT frozen — those are common nouns that should become
  Hindi (जिल्हाधिकारी → जिलाधिकारी). English keeps the chat path and its prompt-level
  LOCKED TERMS table, byte-for-byte unchanged. Deploy: 0022 → API → web; no n8n.
- **Hindi name dictionary** (2026-07-22, migration 0025): the pre-translation name-review
  card showed only an editable **English** spelling per name — dead weight on a Hindi run,
  where the Hindi path never reads `english` and instead froze each proper noun to its
  Marathi Devanagari form. Officers could neither see the Hindi form nor fix a name whose
  correct Hindi spelling legitimately differs (कोल्हापूर → कोल्हापुर). Fix: a nullable
  `glossary_terms.hindi` column threaded through every layer exactly like `english`
  (`@dgipr/database`, `@dgipr/schemas`, `prepareTranslationTerms`, the translate routes/job,
  `translate-article.ts`). On a Hindi run `TranslationTermsReview` now shows an **editable
  Hindi field pre-filled with the Marathi form** (English hidden but carried through so a
  Hindi confirm never wipes it) and the Hindi lock's repair **target** becomes
  `term.hindi ?? term.marathi` — so the output follows the stored Hindi spelling, falling
  back to the Marathi form when none is set. Fully **backward compatible** (null = today's
  behaviour). English runs and the English LOCKED TERMS table are untouched. Deploy:
  0025 → API → web; no n8n.
- **Hindi name lock: warn, don't discard** (2026-07-22): a real Hindi PDF run failed with
  `did not preserve these names: नागपूर महानगर प्रदेश प्राधिकरण, व्हीएनआयटी नागपूर, सहकारी
संस्था, वंदना थोरात, विधानसभा` **after** Sarvam had translated correctly and been billed —
  and, because a Hindi-only failure leaves `results` empty and `pages` non-empty, the web
  showed **no error at all**. Four root causes, all fixed. (1) The lock was **verbatim
  whole-phrase**: Hindi legitimately re-renders a multi-word org's generic words (प्रदेश →
  क्षेत्र) and re-transliterates acronyms (व्हीएनआयटी → वीएनआईटी), which a byte-for-byte
  check can never pass. `repairLockedNames` now aligns **per word** — each word repaired
  only if within the ≤2 edit budget, translated words left alone — and a multi-word name
  must **anchor** on at least one exact-match word so per-word nudges can't compound into a
  different person (वंदन करात ≠ वंदना थोरात). (2) A name that still can't be accounted for
  is **reported, not thrown**: `translateArticle` returns `{ text, unpreservedNames }` and
  the translation is always delivered; the failure stance is reserved for an output that is
  the Marathi original (the only genuinely-not-a-translation case, which keeps its retry).
  (3) The old **retry re-billed** every failing block against a prompt-less endpoint for the
  same output — deleted for name drift, kept only for the untranslated case. (4) The
  **glossary over-locks**: the extractor typed common nouns (विधानसभा, सहकारी संस्था) as
  `org` and confirming the review card froze them; `TranslationTermsReview` now has a per-row
  **"हिंदीत जसेच्या तसे ठेवा"** toggle (on for person/place/org/scheme) that demotes a row to
  `termType: 'other'`, which the Hindi lock skips. Surfacing: `unpreservedNames` on the
  pasted-text + PDF result payloads (`TranslateDocumentResult.pages[].unpreservedNames` +
  a deduped result-level union), and transiently on `GenerationDetail.translateWarnings`
  (in-process registry beside `translateError`, reset on restart). The PDF job also now
  **banks pages as they finish** (an `onPage` callback → per-language `job.results`) so a
  late failure keeps everything already paid for, **normalizes language order to
  English-then-Hindi** (a Set-ordered `['hi','en']` used to let a Hindi failure pre-empt a
  good English target), and the web **retries only the missing language** (never re-billing
  a completed English result) while **reusing the prepared name list** when the selection is
  unchanged (a retry used to re-run the OpenAI extraction). The Hindi-only silent failure is
  fixed by rendering `detail.error` above the page list, independent of `results`/`pages`.
  Verified offline (the per-word repair against the exact five failing names — no Sarvam
  spend), typecheck + lint green. No migration, no n8n; deploy is API + web (rebuild
  `@dgipr/content-engine` + `@dgipr/schemas` dist first).
- **PDF translation** (2026-07-21): `/translate` gained a second mode, **PDF फाईल**, for
  translating a whole document (the real ask: a 20-page Marathi booklet, 3 of its pages
  English, needed in BOTH Hindi and English). The pasted-text mode is untouched — it stays
  synchronous with its 10,000-char cap — because a document is a different shape of problem:
  minutes of OCR and tens of thousands of characters cannot live inside one request. So the
  PDF path is a background job (`apps/api/src/jobs/translate-document.ts`) that reads the file
  **page by page** (`extractPdfPages` — see the extraction milestone below; it also fixed a
  real ordering bug: ZIP entries were sorted lexicographically, so page 10 preceded page 2 in
  any document over 9 pages),
  then translates the pages the user selected into one or both targets, reporting progress in
  PAGES. Nothing is persisted: the job lives in an in-memory registry with a 60-minute TTL
  (matching /translate's "ad-hoc text is not stored" contract), so a 404 means "expired or the
  API restarted — upload again", and the web
  page keeps the job id in `sessionStorage` so a refresh reattaches. The GET returns page and
  result TEXT only on `?text=1`; the 2.5 s poll asks for the lean shape.
  **Mixed-language documents are routed per page** (`translate-document.ts`, page language via
  the proofreader's deterministic `detectProofreadLanguage`): for an English target an English
  page is passed through **verbatim** — sending it to the mr→en model would silently
  paraphrase an official document — while for Hindi it is translated with
  `sourceLanguage: 'en'` (a new `TranslateOptions` field consumed only by the Hindi branch's
  `source_language_code`). Marathi pages keep the existing paths and all their guards.
  The free-text **AI instruction** ("फक्त पृष्ठ १ ते ९", "शेवटची दोन पाने वगळा") is
  **structural only, by design**: `interpret-document-instruction.ts` resolves it to a page
  selection — a deterministic numeric parse first (Latin **and** Devanagari digits), one
  gpt-4o-mini call only for content-based asks — which is shown back as editable checkboxes.
  It never becomes translator prompt text, so English and Hindi always see identical source
  text and no instruction can quietly summarize or restyle an official document. Page text is
  editable per page before translating (OCR errors in names/amounts, the DLO review rationale).
  The mandatory name check runs unchanged over the selected pages via a server-side prepare
  route (so the 10k cap never applies), with verified rows folded away
  (`collapseVerified` on `TranslationTermsReview`) because a 20-page document yields 100+ terms;
  `extractGlossaryCandidates` now chunks long input rather than firing one ~25k-token request.
  No migration, no n8n; deploy is API + web.

- **PDF text layer before OCR, and OCR in ≤10-page chunks** (2026-07-22): uploading the real
  20-page booklet failed outright — Sarvam's document digitization validates
  "Page/image count must not exceed 10" when a job STARTS and its job request has no
  page-range parameter, so one upload can never cover more pages, and page selection happens
  after extraction so it could not help. Two things changed.
  (1) **OCR is now chunked.** `extractPdfPagesViaOcr` splits the file into ≤10-page PDFs
  (`intake/pdf-split.ts`, pdf-lib), runs one Sarvam job at a time — sequential, because its
  behaviour under concurrent jobs is untested and a page range in an error message beats a few
  saved minutes — and re-offsets each chunk's pages to the ORIGINAL document's numbering.
  `OCR_MAX_TOTAL_PAGES` (default 50) keeps a 300-page scan from quietly spending an hour.
  Page numbers are now the document's own throughout: blank pages are KEPT and the metadata's
  `page_num` is preferred, because the previous "drop empties and renumber 1..n" shifted every
  later page — one blank page silently made "translate pages 11-14" translate the wrong pages.
  (2) **OCR is no longer the default path.** OCR reads PIXELS and is only needed for SCANNED
  documents; a born-digital PDF already contains its characters, and reading them locally
  (`intake/pdf-text-layer.ts`, pdf.js) is instant, free, unlimited in length and EXACT — no
  misread name, amount or date. `intake/pdf-pages.ts` now owns the policy (text layer → OCR
  fallback) and is the entry point for BOTH PDF surfaces, /translate and DLO intake; callers
  keep the same `extractPdfPages`/`extractPdfText` signatures and a new
  `extractPdfPagesDetailed` reports which backend ran.
  The gate that decides is the interesting part, and it is Marathi-specific. `textLayerVerdict`
  returns `empty` (nothing extractable = scanned) or `garbled`, and `garbled` covers two
  failures: Private-Use-Area/control junk (legacy non-Unicode fonts — Shree Lipi, Kruti Dev),
  and **Devanagari extracted in VISUAL order**. The second is the dangerous one: a
  Chromium-printed Marathi page extracts निर्णय as "िनण य" and कोल्हापूर as "को ापूर" — still
  Devanagari, so every ratio or script test passes it, while names and amounts have silently
  changed. The test used instead is a Unicode invariant: a dependent vowel sign attaches to a
  preceding consonant, so a word-INITIAL matra proves visual-order text. Verified 2026-07-22
  against real Sarvam: that document was routed to OCR automatically, came back through 2
  chunks (10 + 2) with pages numbered 1-12, and OCR restored कोल्हापूर and शासन निर्णय intact.
  Because no gate is perfect, /translate also carries an explicit user override — a
  "मजकूर चुकीचा दिसतोय? OCR ने पुन्हा वाचा" confirm on the page-review card
  (`POST /translate/documents/:id/reextract`) — which is why the job now KEEPS the PDF bytes
  for its TTL instead of dropping them after the first read; still nothing on disk or in the
  database, still bounded by the TTL, the 25 MiB cap and MAX_JOBS. The detail payload gained
  `source` ('text-layer' | 'ocr', badged in the review card so OCR text gets the scrutiny it
  deserves) and `extractProgress` (pages, since chunked OCR of a long scan is several minutes).
  New deps in `@dgipr/content-engine`: `pdfjs-dist`, `pdf-lib`. Harness:
  `tsx --env-file=../../.env src/intake/pdf-pages.ts <file.pdf> [--ocr|--text]`.
  No migration, no n8n; deploy is API + web.

- **Pages are chosen BEFORE anything is OCR'd** (2026-07-22): both PDF surfaces used to
  extract the whole document on upload and only then ask which pages the officer wanted, so
  page selection was a client-side filter over text that had already been paid for. On a
  born-digital file that costs nothing (the text layer is local and free), but a scanned one
  falls back to Sarvam OCR, which is billed per page — a 20-page scan where three pages were
  wanted was billed for 20 across 2 jobs, unrecoverably. The rule is now: **no page reaches
  OCR unless the user selected it.**
  Upload PROBES instead of reading (`probePdf` — page count + local text-layer attempt +
  verdict, never calls Sarvam), and the flow forks on the verdict. Born-digital: every page
  is already in hand for free, so the run goes straight to the review list, which IS the page
  picker — that path is behaviourally unchanged. Scanned: it stops, showing page NUMBERS only
  (its text does not exist yet; producing it is the spend being authorised), and only the
  ticked pages are read. Mechanically, `ExtractPdfOptions.pages` threads a 1-based selection
  through `extractPdfPagesDetailed`; `splitPdfPages` gained a `pageNumbers` argument and each
  `PdfChunk` now carries `originalPages: number[]` instead of a contiguous
  `startPage`/`pageCount`, because a selection need not be contiguous — pdf-lib's `copyPages`
  already accepted an arbitrary index array, it had simply only ever been handed a run. Page
  identity is restored by `chunk.originalPages[page.page - 1]` rather than by arithmetic
  offset. Two consequences worth knowing: `OCR_MAX_TOTAL_PAGES` (50) now bounds the
  SELECTION rather than the document, making a few pages of a 300-page scan a usable request;
  and on the `auto` path the verdict is computed on the SELECTED pages, so a booklet that is
  scanned overall but typeset on the three pages wanted stays free. `textLayerVerdict`'s
  whole-document character floor became `min(200, pages × 100)` so a one-page selection is
  not held to a two-page standard and pushed to OCR for nothing.
  Surfaces: `/translate` gained a `selecting` status (idle like `ready` — keep it OUT of the
  poll's `active` set) and `POST …/documents/:id/extract`; `/dlo` gained a per-file
  `needs-selection` status + `pageCount` on the `files` jsonb (**no migration** — jsonb has no
  column schema, same reasoning as the per-source review) and `POST /dlo/intakes/:id/extract`
  taking every scanned file's selection in ONE job, with generate blocked while any file is
  still unread. Both OCR-override re-read endpoints now REQUIRE `pages`: overruling the
  quality gate is not a reason to re-bill excluded pages. Verified offline against a
  synthetic 24-page PDF (scattered selection across the 10-page chunk boundary returns pages
  2/5/9 and 23/24 with the ORIGINAL numbering, guards reject out-of-range/empty, whole-document
  reads unchanged) plus the verdict-floor cases incl. visual-order Devanagari; the paid path
  still wants one real scanned document to confirm a 3-page pick runs ONE 3-page Sarvam job.
  No migration, no n8n; deploy is API + web.

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

- **DLO review is per source, with PDF page selection** (2026-07-22): `/dlo`'s
  तपासणी व संपादन step was one textarea holding notes, every transcript and every
  document concatenated. Two things were wrong with that. The officer's job in this step
  is spotting STT/OCR errors in names and amounts **per source**, and one scroll box gives
  no handle on that; and a long GR blew past the 60,000-char note cap with no recourse but
  deleting text by hand. So the step is now one card per source — notes, each recording and
  each DOCX as an expanded textarea (they must be READ to be checked), each PDF as a
  collapsed page list with checkboxes, mirroring `/translate`'s picker down to its
  `.page-list` markup and Marathi labels. A PDF's whole-file checkbox is its select-all.
  Under the cards sit a live `N / ६०,०००` count and a **read-only** "पूर्ण मजकूर पाहा"
  fold — read-only on purpose: a second editable copy of the same text could only disagree
  with the cards.
  Placement is the review step, not प्रक्रिया, because page text does not exist while
  Sarvam is still running; selection therefore does **not** save OCR spend, exactly as in
  `/translate`.
  Mechanically: the `files` jsonb entries now carry their own extracted text (`text` for
  audio/DOCX, `pages` + `pdfSource` for PDFs), so there is **no migration** — jsonb has no
  column schema. PDFs moved from the flattening `extractPdfText` (deleted, this was its
  only caller) to `extractPdfPagesDetailed`, which brings DLO the same text-layer-before-OCR
  policy and source badge `/translate` has. `combineIntakeSources` **moved from
  `@dgipr/content-engine` to `@dgipr/schemas`**: the web now re-assembles the note from the
  officer's edits and selection, the `=== स्रोत: … ===` headers must be byte-identical to
  what the job writes, and `apps/web` cannot import content-engine (pdfjs/sarvam/openai) —
  the same reasoning that moved `tweetWeightedLength` there. `POST /:id/generate` is
  unchanged and still takes one assembled string. `GET /:id` ships the text only on
  `?text=1` and `useDloIntake` fetches the heavy shape once **per transition into ready**
  (per transition, not once — that is what lets a re-read deliver new pages). Pre-feature
  intakes fall back to the old single textarea (`hasPerSourceText`).
  A **per-file OCR re-read** (`POST /dlo/intakes/:id/files/:index/reextract`) closes a real
  dead end: a garbled text layer previously had no recovery, since starting over re-ran the
  same automatic gate on the same bytes. DLO can offer this where `/translate` needs the
  user to re-upload, because the original is still in the private `dlo-uploads` bucket. The
  ROUTE flips the row to running before answering 202 — deliberately not the job: the client
  refreshes the instant the 202 lands, and a row still reading `ready` would stop polling and
  sit there for the whole OCR. Only that one file is re-read and only its edits are dropped.
  Runtime-verified 2026-07-22 (API: lean vs `?text=1`, 3-page text-layer intake, real OCR
  re-read flipping `text-layer`→`ocr` with document page numbers intact, guards 404/400/409;
  browser: per-source cards, page uncheck → assembled text and count drop, preview headers,
  whole-file toggle round-trip). No migration, no n8n; deploy is API + web.

- **Proof Read** (2026-07-20): the `/proofread` page checks pasted Marathi or English
  text (≤10,000 chars) for genuine grammar/spelling/punctuation errors, glossary-based
  name errors, and clear Mahasamvad-style deviations. Precision over recall is the
  contract, enforced structurally, not just by prompting: temperature-0 analysis with
  "if unsure, don't flag" rules; deterministic filters (an issue's excerpt must occur
  verbatim in the input; a `name` fix survives only if its suggestion moves toward a
  verified glossary form — either introducing a full verified form or a ≤2-edit-distance
  fragment nudge — otherwise it is demoted to a non-blocking "unverified names" list);
  and a second confirm-or-drop verification call (skipped when the text is clean, so a
  clean check costs one chat call). The corrected text is NOT model-generated — it is a
  deterministic excerpt→suggestion patch of the input (longer excerpts first), so it can
  only differ at flagged spots and can never restructure or invent; a digit-preservation
  guard returns `correctedText: null` rather than ever shipping a changed number. Style
  checking uses one RAG exemplar (Marathi input only; English input reports
  `styleChecked: false` and the UI says so honestly, still running grammar + name
  checks with Marathi explanations). Synchronous `POST /api/proofread`
  (`apps/api/src/routes/proofread.ts` — fetches every verified glossary term present in
  the text plus the 300 most recently updated as the near-miss set); engine
  `packages/content-engine/src/generation/proof-read.ts` (CLI harness:
  `tsx --env-file=../../.env src/generation/proof-read.ts [text]`); schemas
  `packages/schemas/src/proofread.ts`; web `apps/web/app/proofread/page.tsx` + sidebar
  link. Ad-hoc — nothing stored, no migration; deploy is API + web only. Runtime-verified
  2026-07-20 (planted-error, clean-text zero-false-positive, name near-miss, and English
  paths, harness + live API).

- **Facebook post category** (2026-07-21, migration 0020): the home form's category row
  gained a fourth card, **फेसबुक पोस्ट**, and the detail page's पुढील पाऊल panel a
  matching "याच टिपणीवरून फेसबुक पोस्ट तयार करा" fold. `facebook` is a real
  `generations.category` value that today runs the **identical** pipeline to `twitter` —
  same `startSocialPostJob`, same `social-post-v2-api` workflow and payload (plus an
  inert `platform` field naming the lane), same twitter master library and design modes,
  same `overlayTwitterChrome`, same image-cost tier. It is a distinct value, not an alias,
  so the runs are distinguishable in history/tasks/threads and the two lanes can diverge
  later without a backfill. Every social-vs-article branch in `apps/api` and `apps/web`
  now routes through `isSocialCategory()` (`packages/schemas/src/api.ts`) instead of
  `category === 'twitter'`; `articleCategoryOf` in the runner remains the hard-fail
  backstop for a missed branch. The two lanes share ONE busy gate
  (`hasActiveSocialTask`), since they share one serial n8n workflow. The पुढील पाऊल panel
  now offers every format except the run's own. The `ReferenceCategory` enum
  (`'twitter' | 'article'`) is deliberately untouched — social runs map to `'twitter'`
  there. Deploy is migration → API → web; no `n8n:push` required.

- **Direct social publishing** (2026-07-21, migration 0021): a completed
  twitter/facebook run's detail page (`SocialPostView`) gained a publish button that
  posts the poster + caption to the **official department accounts** — one X account
  (OAuth 1.0a keys via `twitter-api-v2`, v2 media upload of the poster bytes) and one
  Facebook Page (Graph API `POST /{page_id}/photos` with the public poster URL) —
  credentials env-configured (`TWITTER_*`, `FACEBOOK_PAGE_*`; interim dummy accounts,
  swap = edit `.env` + restart; walkthrough in `docs/social-publishing-setup.md`).
  Platform logic lives in the new pure package `packages/social-publisher`
  (`@dgipr/social-publisher` — no DB/LLM deps); the synchronous route
  `POST /api/generations/:id/publish` only sequences (guards: social category, no
  running job, in-process in-flight set against double-clicks, Marathi 503 on missing
  creds, and a 422 **reject — never auto-truncate** when a caption exceeds X's 280
  weighted chars). The latest live post URL is persisted as
  `generations.published_url`/`published_at` (overwritten on re-publish after a
  poster re-render) and surfaced as `publishedUrl`/`publishedAt` on
  `GenerationDetail`, so the "प्रकाशित पोस्ट पाहा" link survives reloads. Two-step
  confirm in the UI (outward-facing + irreversible). Article runs are rejected by
  design. Deploy: 0021 → API → web; no n8n involvement.

- **Social caption editing** (2026-07-21, migration 0023): a completed twitter/facebook
  run's caption (stored in `generations.article`) is now editable two ways on the same
  `SocialPostView` card, matching the poster's existing image-feedback loop. (1) **Hand
  edit** — the caption stays a read-only block (a finished post must read as a finished
  post, not as a form) until "कॅप्शन बदला" swaps in a textarea; `PUT /api/generations/:id/caption`
  stores the typed text verbatim, synchronously, with no model call. (2) **AI revision** —
  `POST /api/generations/:id/caption/feedback` runs `reviseCaption`
  (`packages/content-engine/src/generation/revise-caption.ts`, one gpt-4o call + one
  repair) on instructions like "२८० अक्षरांपेक्षा लहान करा" or "सर्व आकडे मराठी अंकांत
  लिहा". The article feedback route could never serve this: `reviseArticle` takes a
  category through `articleCategoryOf`, which hard-fails on a social category by design —
  and a caption is one short social post with hashtags, not a Mahasamvad article. The
  guardrails are the article path's: the **note stays the sole fact source**, the feedback
  may only steer wording/length/tone/emphasis/script, hashtags and handles are preserved
  unless the feedback says otherwise, and numerals may be re-scripted between ०-९ and 0-9
  while the numeric **value** may never change (stated explicitly, or the never-invent
  rule would fight the user's "make the numbers Marathi" ask). Like translation, the job
  is deliberately NOT wrapped in `runJob`: it owns no status/step and reports through the
  detail payload's `captionRevising`/`captionReviseError`, because the row it edits is
  already `completed` — flipping it to running would replace the finished post with a
  progress bar, and staying off status also lets a caption edit run beside a poster
  re-render (disjoint columns). Edits are logged as `caption` / `manual_caption`
  revisions. Under the caption the web shows a plain `N अक्षरे` count (code points) — an
  X-weighted `N / 280` counter was tried and dropped as noise on a card that is mostly a
  finished artifact, so X's limit now surfaces only in the publish-time 422 and in the
  "२८० अक्षरांपेक्षा लहान करा" feedback chip. `TWEET_MAX_LENGTH` + `tweetWeightedLength`
  nonetheless stay **moved from `@dgipr/social-publisher` to `@dgipr/schemas`** — the API
  imports them from there, and `apps/web` must never import the publisher (twitter-api-v2
  must not reach the browser). Runtime-verified 2026-07-21 (engine harness: shorten + numeral re-script in one pass,
  invented minister/amount refused; API guard paths 400/404/409). Deploy: 0023 → API →
  web; no n8n.

- **CMO (मंत्रिमंडळ निर्णय) template brand** (2026-07-22, migration 0024): a second
  template family on the social (twitter/facebook) lane, modelled as a `brand` axis
  (`dgipr` default | `cmo`) orthogonal to the platform, rather than a new reference
  category — the operator had already created "CMO" as a **custom twitter type** on
  `/references`. 0024 adds `reference_types.brand` + `generations.template_brand`;
  `buildTwitterCatalog(client, pinned, brand)` filters by it (the DGIPR build EXCLUDES
  cmo so the classifier can never route into it), `pickCmoReference` rolls an enabled CMO
  master, and `startSocialPostJob` sends `brand: 'cmo'` to the SAME `social-post-v2-api`
  webhook — no separate workflow, no new env var. CMO's fixed chrome is a full-width
  leader header (`assets/cmo-header.png`) plus the reused DGIPR footer, stamped by
  `overlayCmoChrome` (`packages/poster-renderer/src/cmo-chrome.ts`).

- **CMO photo zone pinned in code — two circles, with a fallback** (2026-07-22): the
  official CMO design puts TWO OVERLAPPING CIRCLES in the upper right, each holding a
  DIFFERENT photograph. Real renders produced one photograph plus a flat blue crescent
  where the second circle belongs, for two independent reasons, both now fixed.
  (1) **Geometry.** `cmo-header.png` is opaque only down to the leader band's bottom edge
  (y = 259 on its 1080x1350 canvas), because the canvas below the band is transparent
  anyway — so the LOWER half of the photo zone was constrained by nothing at all and the
  image model improvised there. The circles turned out to be recoverable from the header's
  own alpha: least-squares fits on the two lobes of its cut-out give centres (796.0, 259.9)
  r 226.4 and (612.3, 213.0) r 117.9, both accurate to ~1.5 px, overlapping by 155 px, with
  the big circle's centre sitting exactly on the band line. Those numbers now live in
  `src/cmo-geometry.ts` as fractions of the poster WIDTH (the convention `loadScaled` sets
  for every chrome overlay), and `scripts/build-cmo-photo-frame.ts` bakes them into two
  overlay assets — `cmo-photo-frame-2.png` (both circles kept) and `cmo-photo-frame-1.png`
  (only the big one) — each opaque over the whole photo zone EXCEPT its kept circles and
  carrying the translucent ring around each, with the small circle's ring stroked last so
  it reads as sitting in front. Above the band line the fill takes the per-channel median
  of the nearest 16 blue band pixels to its left (the band is a vertical gradient with a
  faded building texture, so neither a flat fill nor a global average works, and the filter
  matters: the header draws a light OUTLINE around its cut-out, and sampling that painted
  the white rim straight back in); below the line it is page white. The old
  `cmo-omega-ring.png`, which drew only the ring and only above the band, is deleted.
  (2) **The model was never told there were two windows.** `Build Copy Request` emitted a
  single `scene_brief` and `Build Image Prompt` said "the upper-right omega photo **area**"
  — singular. The CMO copy branch now also requests `scene_brief_2` (a different subject
  from the same notes, added only when the master has a photo zone), and the image branch
  states both circles' positions as percentages, asks for the photograph to bleed slightly
  PAST each circle because software crops it, and forbids flat-filling either one.
  Because prompting cannot be relied on, `overlayCmoChrome` **verifies**: it probes a box
  that lies inside the small circle but outside the big one and picks the single-circle
  frame when the standard deviation reads as flat fill rather than photography (a
  photograph varies; the blue or white the model paints does not). A run that would have
  shipped a coloured disc ships a clean single-circle poster instead. The fallback is
  sticky through pixel feedback by construction — a fallback render shows one circle, so
  the edit of it probes the same way. The percentages in the workflow's CMO branches and
  the constants in `cmo-geometry.ts` must stay in sync; both frames and both branches are
  tunable for free with `assets:cmo-frame` + `poster:preview:chrome:cmo [--flat]`, which is
  how this was verified (no model call). Deploy is the NORMAL order — API first, then
  `pnpm n8n:push` — since new API + old workflow degrades cleanly to one circle while old
  API + new workflow would paint two photographs with only the old dome ring stamped.
  Recommended manual step: stamp the new frame onto the current CMO master
  (`poster:preview:chrome:cmo <master.png>`) and re-upload it on `/references`, so the
  image the model edits already shows two clean circles. No migration; no web change.

- **CMO photo zone reduced to ONE code-composited circle** (2026-07-22, SUPERSEDES the
  two-circle milestone above): the image model could never paint two overlapping circles
  reliably — real renders came back with the big circle plus an empty/ghosted second circle
  and a stray photo — so the second circle was **dropped** and, more importantly, the single
  photograph is no longer painted by the master-edit model at all. It is now **generated by
  the API and composited in code**, so a CMO poster shows a crisp, correctly-cropped photo on
  every render, fully decoupled from the flaky in-place master edit. The CMO photo zone thus
  becomes a fully code-owned element, like the header/footer chrome. Changes:
  (1) **Geometry** (`cmo-geometry.ts`): the flat-fill probe constants (`CMO_SMALL_PROBE`,
  `CMO_PROBE_MIN_STDEV`) are gone. `CMO_BIG` is unchanged (official upper-right position/size
  kept). `CMO_SMALL` is RETAINED but only as a **filled lobe** — `cmo-header.png` is a fixed
  brand asset whose cut-out is the union of both lobes, so the frame must paint the small
  lobe over (band-colour above the band line, page white below) or a hole opens under the
  header. (2) **Frame** (`build-cmo-photo-frame.ts`, `assets:cmo-frame`): now bakes ONE asset,
  `cmo-photo-frame.png` (opaque outside the big circle, filling the small lobe, plus the big
  circle's ring). `cmo-photo-frame-{1,2}.png` are deleted. (3) **Overlay**
  (`overlayCmoChrome(poster, photo)` in `cmo-chrome.ts`): a pure compositor now — the probe +
  frame-selection are gone. It resizes the photo (fit:cover) to the big circle's bounding box
  and composites `[photo, header, frame, footer]`; the header cut-out + the opaque frame crop
  the photo down to exactly the big-circle interior, so no separate circular mask is needed.
  (4) **Runner** (`apps/api/src/jobs/runner.ts`): on the initial CMO render it generates the
  photo once with `generateImage(buildCmoCirclePhotoPrompt(scene_brief), { size: '1024x1024' })`,
  caches it at `cmoPhotoPath(id)` = `generations/{id}/cmo-photo.png` (unversioned + stable —
  an intermediate asset, never served to end users), and composites it. On feedback it
  DOWNLOADS the cached photo and re-composites the **same** photo (a text/layout edit must
  never swap the photograph). (5) **Photo prompt** (`build-scene-prompt.ts`):
  `buildCmoCirclePhotoPrompt` — a square documentary photo composed for a circular crop
  (subject centred, quiet corners); `generateImage` gained an optional `{ size }`.
  (6) **Workflow** (`social-post-v2-api.json`): the CMO `Build Copy Request` drops
  `scene_brief_2`; `Build Image Prompt` + `Build Feedback Prompt` now RESERVE the upper-right
  circle zone (leave it a quiet plain background — software places the photo) instead of
  asking the model to paint circles; and `scene_brief` is surfaced through `Decode Image` →
  `Respond to Webhook` so the API can generate the matching photo. Verified offline
  (`assets:cmo-frame` + `poster:preview:chrome:cmo` → one clean circle, small lobe filled, no
  ghost circle) and `pnpm typecheck` green. Deploy is the NORMAL order — API first, then
  `pnpm n8n:push` — since new API + old workflow degrades to a generic-subject photo, while
  new workflow + old API would leave the circle empty. Recommended manual step: re-stamp the
  current CMO master on `/references` with the new single-circle frame
  (`poster:preview:chrome:cmo <master.png>`, re-upload) so the image the model edits already
  shows one clean circle. No migration; no web change.

- **AI explainer videos** (2026-07-22, migration 0026): the `/video` page turns a note
  into an animated Marathi explainer video via Google Veo 3.1 (Gemini API) — with a
  **two-gate spend flow**, because Veo bills per second (~$0.05–0.40/s by tier) and the
  core UX requirement was "never waste a render". Gate 1: gpt-4o writes a per-scene
  script (Marathi narration ≤~20 words/scene ≈ 8s of speech, English visual brief, one
  per-project English `style` paragraph = the cross-scene consistency mechanism; one RAG
  exemplar for tone, note-as-sole-fact-source absolute) — fully editable per-scene cards.
  Gate 2: gpt-image-2 keyframe stills per scene (cents), center-cropped to the exact Veo
  aspect (16:9/9:16) so the user approves the real framing; briefs editable + per-still
  redraw. Only the explicit animate confirm (two-step, with the cost estimate from
  `VIDEO_TIER_PRICE_PER_SECOND_USD` in `@dgipr/schemas`) spends Veo money: image-to-video
  per scene from the approved still, serial (preview rate limits), each clip persisted
  the MOMENT it lands so a crash/retry re-renders only missing scenes. ffmpeg
  (`ffmpeg-static`, allowlisted in pnpm-workspace.yaml `onlyBuiltDependencies`) strips
  Veo's native audio and stitches one browser-safe silent MP4; voice is deliberately out
  of scope (Sarvam TTS/manual later) — the deliverable includes a timed narration list +
  a deterministic SRT (`buildSrt`, schemas). Post-render fixes are PER SCENE (re-still /
  re-animate one scene → restitch as `video-v{n+1}`), never a whole-video re-render, and
  the old video stays playable throughout (the caption-editing rationale). **No on-screen
  text in any visual prompt** — video models garble Devanagari (the poster-HTML rule);
  narration carries the words, `VEO_NEGATIVE_PROMPT` backs it up. Own `video_projects`
  table (scenes jsonb, dlo_intakes precedent) + public `videos` bucket; own status flow
  `scripting → script_ready → storyboarding → storyboard_ready → animating → completed`
  with routes flipping BEFORE the 202 on every gate exit; one active project at a time
  (DB-backed 409). Veo client is raw REST (`http/gemini-request.ts` transport mirroring
  openai-request.ts; `GEMINI_API_KEY`, model ids env-overridable `VEO_MODEL_*` since the
  preview ids churn; Google keeps files 2 days so bytes are persisted immediately).
  **No n8n anywhere on this path.** Verified offline 2026-07-22: typecheck/lint green,
  `video:preview:assemble` (stub clips → 6.04s silent yuv420p MP4, audio stripped),
  buildSrt/timings/estimates correct. Remaining: apply 0026, set `GEMINI_API_KEY`, run
  the ~$0.3 `veo-client.ts --lite --4s` harness to prove model access (highest-uncertainty
  integration — Lite tier id/pricing least verified; fall back to fast+standard if absent),
  then a cheap 2-scene E2E. Deploy: 0026 → API → web; docker needs the ffmpeg-static
  download (or `apt-get install ffmpeg` + `FFMPEG_PATH`).

- **Explainer-video overhaul: measured clip fit, no talking mouths, AI-planned coverage**
  (2026-07-23, no migration — SUPERSEDES parts of the 0026 milestone above): the first
  real renders exposed three quality failures. (1) **Dead air**: every clip was hardcoded
  8s while real bulbul narration ran 2–4s (the "20 words ≈ 8s" guess was ~2× slow), so
  `muxNarration` silence-padded half of every clip. (2) **Glitchy talking mouths**:
  nothing forbade speech, and Veo animates lips badly. (3) **Poor coverage**: one script
  call with a generic arc instruction, no planning or verification. Fixes, in pipeline
  order:
  - **AI scene planning** (`packages/content-engine/src/video/plan-video-scenes.ts`): a
    gpt-4o planner breaks the note into citizen-first beats (benefits/eligibility/
    deadlines/citizen actions are beats; committee machinery compressed — the
    editorial-brief philosophy in miniature) and decides scene count (2–8; the short/long
    `durationBucket` is DEMOTED to a preference hint — kept as a column, no migration),
    per-scene Marathi `beat`, English `shotHint` (shot type + camera move, threaded into
    both prompt builders where it replaces the generic camera line) and a 4|6|8s target
    window. `generate-video-script.ts` writes narration AGAINST that plan with
    code-computed word budgets (`NARRATION_WORDS_PER_SECOND = 4.5`), then runs ONE
    bounded coverage round (gpt-4o-mini lists beats the narrations fail to convey; if
    any, ONE gpt-4o repair of only those scenes; accepted either way — gate 1's human
    review stays the real gate). The narration cap moved to
    `VIDEO_NARRATION_MAX_CHARS = 280` in `@dgipr/schemas`, the single source for the
    generator AND `UpdateVideoScriptRequestSchema` (no more synced pair). The bucket-keyed
    scene-count check in the script-save route is DELETED; `VIDEO_SCENE_LIMIT` (1–8) is
    the only count rule.
  - **TTS-first measured windows**: the storyboard job now OPENS with a voice phase
    (`ensureNarrationAudio` in `video-runner.ts`, step `narrate` — flipped by the route
    before its 202): synthesize each scene's narration (existing staleness key skips
    current audio), measure the WAV (`wavDurationSeconds`, poster-renderer), store
    `narrationAudioSeconds`, and fit `durationSeconds` to the smallest 4|6|8 window
    (`fitSceneDurationSeconds`, schemas; ≤8% atempo allowance `VIDEO_FIT_TEMPO_ALLOWANCE`
    before jumping a bucket). Clips no longer trail into silence, gate 2 prices the REAL
    Veo spend (mostly 4s windows → ~40% cheaper), and videos are **voiced by default** —
    the post-completion narrate route/button is now re-voice/recovery only. **WINDOW
    FREEZE**: a scene whose clip is current keeps its window (atempo absorbs drift;
    measuring must never invalidate a paid clip), and `clipIsCurrent` now also requires
    `clipDurationSeconds` (recorded at render) to match — undefined = legacy = current.
    Per-scene TTS failure is non-fatal (char-rate fallback
    `VIDEO_NARRATION_CHARS_PER_SECOND`, default 32 chars/s, then silent render); no
    SARVAM_API_KEY degrades the whole phase the same way. The script-save route ignores
    incoming `durationSeconds` (windows are server-assigned; the schema keeps it optional
    for back-compat) and carries the narration-audio cache through brief-only edits
    (audio depends only on narration text + voice — dropping it re-billed TTS for visual
    edits). Gate 1 lost its hand-picked duration entirely; gate 2 shows "क्लिप X से. ·
    निवेदन Y.Y से." + an `<audio>` audition element per scene.
  - **No talking, ever**: `VEO_NEGATIVE_PROMPT` gained talking/speaking/lip sync/lip
    movement/mouth movement/dialogue/monologue/interview/close-up face; both prompt
    builders hard-append a no-talking rule (people may walk/gesture/work quietly at
    medium-or-wide distance, never speak, never a face close-up); the script prompt's
    visual-brief rule forbids depicting anyone speaking. If Veo starts refusing people
    entirely, trim `close-up face` from the negative list first.
  Scenes jsonb gained `beat`/`shotHint`/`narrationAudioSeconds`/`clipDurationSeconds` —
  additive, NO migration; legacy scenes degrade to the old behaviour at every consumer.
  Deploy: API + web (rebuild `@dgipr/schemas` + `@dgipr/content-engine` +
  `@dgipr/poster-renderer` dists first); no n8n. New env (optional):
  `VIDEO_NARRATION_CHARS_PER_SECOND`. Harness additions: `plan-video-scenes.ts` CLI;
  calibrate the char rate against real bulbul WAVs before trusting silent-video pacing.

- **Video scene planner split into extract-then-arrange** (2026-07-23, no migration):
  editorial review of the first real run found three faults — the middle scenes dwelt on
  the existing problem instead of the improvement, the last scene restated the first, and
  the note's four named hospitals never appeared (the beat said "चार प्रमुख रुग्णालये").
  The last of these had a structural cause: the arc rule hardcoded the final beat as
  "what the citizen should do", so an infrastructure announcement carrying no citizen
  action had nothing to end on and looped back to scene 1.
  Prompt edits alone made it WORSE, informatively: a rule banning invented benefit claims
  by example got the banned phrase ("जलद व अचूक निदान होईल") echoed back verbatim, and each
  added rule degraded compliance further — one call was being asked to extract, select,
  arrange and format simultaneously. `planVideoScenes` is now **two calls**:
  `extractNoteFacts` lists the note's citizen-relevant facts verbatim (its only job — the
  same model that produced 2-scene plans lists ten accurate facts when asked just for
  facts), then the planner picks and orders them **by `fact_index`**. A scene can therefore
  only rest on a fact that exists; an invented claim has no index to cite, so grounding is
  **structural, not instructed** — the move `proof-read.ts` already makes with its
  verbatim-excerpt filter. `ungroundedScenes` drops any scene whose index is out of range
  or reused (no repair call — the fix is mechanical), and each scene's fact travels to the
  script writer as `sourceQuote`, rendered in the PLAN block as `आधार`, so the narration
  can name what the 300-char beat compressed. Verified on the real Mumbai MRI note: 4
  scenes on 4 distinct facts, announcement → Nair/PPP → KEM 25-30/day → the four approved
  centres at municipal rates, with all four hospitals named in scene 1's narration and no
  invented claim. Cost is one extra gpt-4o call at gate 1 (cents; no Veo spend).
  **Harness trap fixed in passing:** both video CLIs took the note as an argv string, and
  `npx` on Windows truncates a multi-line argument at the first newline — so
  `plan-video-scenes.ts "$(cat note.txt)"` silently planned from the 83-char headline and
  every output looked thin for no visible reason. Both harnesses now accept
  `--file=note.txt`; prefer it for anything longer than one line. No migration, no n8n;
  deploy is API only (rebuild `@dgipr/content-engine` dist).

Two n8n workflows are implemented and host-independent for deployment; their master
templates arrive as immutable `references/library/...` public URLs inside each webhook
payload (fetched over HTTPS — never local disk, no hardcoded storage paths):

- `social-post-v2-api` (the 'twitter' AND 'facebook' generation paths — one workflow,
  see the Facebook milestone above) — the API sends the full `types`
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
_target instance's own_ credential of that name holds (the committed JSON names credentials
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
  editor compresses and omits to serve an angle — is a _feature_, not a defect. The "never
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
