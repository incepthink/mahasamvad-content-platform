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
- **PDF translation** (2026-07-21) — **RETIRED from the UI on 2026-07-24; see the
  "One upload UI everywhere" milestone at the end. The server code described below still
  exists but nothing calls it, and the PDF फाईल tab is gone.** `/translate` gained a second
  mode, **PDF फाईल**, for
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

- **Shared document intake: one upload layer for pdf/docx/txt** (2026-07-24, no migration):
  four surfaces need "upload a file, get Marathi text out", and the capability was built
  twice and missing twice — `/translate` (PDF only, in-memory job) and `/dlo` (pdf/mp3/docx,
  persisted) each had their OWN probe→select→OCR→review implementation, backend and UI,
  while the media room read `.txt` with a browser `FileReader` and `/proofread` took no file
  at all. The extraction ENGINE was already shared (`intake/pdf-pages.ts`); what was
  duplicated was the job state machine, the page-review markup (`TranslateDocumentPanel`
  and `DloSourceReview` were copies — the latter imported the former's `STR.translateDoc*`
  strings, which the naming admitted) and the client-side selection bookkeeping. Adding
  upload to two more surfaces would have made a third copy.
  Three new layers. (1) **Engine dispatcher** `intake/document.ts` —
  `documentKindOf`/`probeDocument`/`extractDocument`, PDFs delegating to the unchanged
  policy, DOCX to mammoth, TXT to a new `text-file.ts`. The load-bearing property is that a
  **non-PDF always returns its pages at probe time**, so the page picker disappears for
  txt/docx with no branch in the UI — nothing to choose because nothing is being bought.
  Audio is deliberately OUT: a transcript has no pages, no picker and no per-page spend
  decision, so it would widen every type to fit one caller. (2) **Generic ephemeral
  service** `apps/api/src/jobs/document-intake.ts` + `routes/documents.ts` — the /translate
  registry minus its translation half (TTL, MAX_JOBS, bytes held for the job's life so the
  OCR override has something to re-read). (3) **Shared web components** `DocumentPages`
  (the page list, incl. the text-layer/OCR badge and the OCR-override confirm) and
  `DocumentIntake` (the whole upload→pick→review→"हा मजकूर वापरा" flow), plus
  `useDocumentIntake` + `documentSelection`. `DocumentPages` holds **no selection state**:
  the surfaces disagree about how to store one for good reasons (/translate tracks the
  pages it wants; /dlo tracks the keys the officer excluded, across several files plus the
  notes), so it asks a predicate and reports events rather than forcing either to invert.
  The **spend gate is preserved everywhere**, including the new surfaces: uploading probes
  and nothing more, and no page reaches OCR unless it was ticked.
  Adoption was deliberately asymmetric to keep the blast radius small: the media room and
  `/proofread` are wired end-to-end onto the new service (behind a "फाईलमधून मजकूर घ्या"
  fold — pasting stays primary), while `/translate` and `/dlo` adopt the shared **UI only**
  and keep their existing backends, so nothing that works today (OCR billing, the name
  check, DLO lineage) was rewritten in the same change. 13 now-duplicate `translateDoc*`
  strings were deleted once the component owned them. Named follow-ups: `/translate` and
  `/dlo` backends delegate to `document-intake.ts` (which also gives DLO `.txt` free), then
  page-image preview beside the OCR text — one change in `DocumentPages`, four surfaces.
  Verified 2026-07-24: typecheck + lint green; the engine harness on a BOM+CRLF Marathi
  `.txt` (BOM stripped, ५०० intact) and on a synthetic 12-page PDF where a scattered
  `--pages=2,5,11` returns pages numbered **2, 5, 11** with matching per-page markers; the
  live API for upload/lean-poll (`text: ''` but `chars` preserved)/`?text=1`/extract, and
  every guard (out-of-range 400 with the Marathi page list, empty selection 400, reextract
  without `pages` 400, reextract of a `.txt` 400, unknown job 404, unsupported type 400); a
  text-free 6-page PDF stops at `selecting` with `pages: 0`, and `probePdf` provably never
  reaches `extractPdfPagesViaOcr`. Still unproven and left for a real document: that a
  3-page pick of a genuinely scanned PDF runs ONE 3-page Sarvam job (the only path that
  costs money). No migration, no n8n; deploy is API + web (rebuild `@dgipr/schemas` +
  `@dgipr/content-engine` dists first).

- **Optional caption, written by the API instead of n8n** (2026-07-24, no migration):
  three media-room complaints with one root. (1) Uploading a document **replaced** what was
  typed (`onText={(text) => setNote(text)}`), so an officer who wrote context and then
  attached the GR lost the context — either source alone was already a complete note, only
  the combination was broken. The media room now **appends** (blank-line separated) and
  says so on its button (`DocumentIntake` gained an `actionLabel` prop; every other surface
  keeps replace semantics, which are right for them). **[Superseded 2026-07-24 — see the
  live-mode milestone at the end: the button and `actionLabel` are gone from this surface;
  the file's text is a second source combined at submit.]** A `NOTE_MAX_CHARS` guard moved the
  API's inline 60,000 cap into `@dgipr/schemas` so the client warns instead of eating a 400.
  (2) Every social run paid for a gpt-4o caption whether or not anyone wanted one. There is
  now a **"कॅप्शनही तयार करा" toggle, default OFF**, in the same `काय तयार करायचे?` card
  (and in `NextActions`' cross-format fold), carried as `generateCaption` on
  `POST /generations` — a **job parameter, not a column**, so no migration; a re-run infers
  it from whether the source run ended up with a caption.
  (3) The reason it *couldn't* be optional: the prompt lived inside `social-post-v2-api` as
  four nodes welded between the image render and the webhook response, so a caption was
  whatever the poster render happened to produce. It now lives in
  `packages/content-engine/src/generation/generate-caption.ts` (`generateSocialCaption`,
  the node's house style ported **verbatim** so captions do not change character; the
  `revise-caption.ts` shape — chatComplete + json_object + one repair + hand-written
  validator, no zod in this package), and the workflow drops to **22 nodes**
  (`Build Caption Request`, `Generate Caption L3`, `Make Caption File`, `Ping Caption`
  deleted; `Decode Image` → `Ping Image` → `Respond to Webhook`, response minus `caption`).
  Three consequences worth knowing. The caption is generated **after** the poster row-write,
  so a caption failure fails the run with the already-paid poster safely on the row rather
  than costing a re-render. A poster-only run can be captioned later —
  `POST /generations/:id/caption/generate` → `startGenerateCaptionJob`, the
  `startCaptionFeedbackJob` shape exactly (off status/step, reports via `captionRevising`,
  and **inserts no revision row**: nothing was revised, and an extra row would advance
  `nextVersion()` and misnumber the next poster) — or typed by hand, which needed the PUT's
  "no caption yet" 409 narrowed to unfinished runs only. And `cost_usd` stops
  under-reporting: the caption now runs through `chatComplete` inside the job's cost scope,
  where n8n's text calls were never metered.
  Verified 2026-07-24: typecheck green; the engine harness on both branches (twitter 273
  chars under the 280 rule, facebook 338 with the full multi-paragraph prose — 📍पुणे first
  line, ५०० / २ कोटी / ३१ ऑगस्ट २०२६ intact, one inline hashtag, `@MahaDGIPR` last, nothing
  invented); the live API guards (article run 400, already-captioned run 409, unknown id
  404); `n8n:push --dry-run` resolves credentials and reports 26 → 22 nodes. Left for a real
  run (needs n8n + OpenAI spend): a poster-only render followed by the on-demand caption.
  **Deploy order is the NORMAL one — API first, then `pnpm n8n:push`**: new API + old
  workflow merely wastes the n8n caption call (the API ignores it), while new workflow + old
  API throws `returned no caption or poster`. No migration; deploy is API + web (rebuild
  `@dgipr/schemas` + `@dgipr/content-engine` dists first).

- **One upload UI everywhere, and page selection by RANGE** (2026-07-24, no migration):
  the previous milestone shared the upload *plumbing* but left each surface presenting it
  differently — `/translate` behind a **"PDF फाईल" tab** wired to its own parallel backend,
  the media room and `/proofread` behind a **"फाईलमधून मजकूर घ्या" fold**, `/dlo` behind one
  combined `.pdf,.mp3,.docx` picker. Same capability, four appearances. Worse, the page
  picker was **one full-width checkbox row per page**, which is fine for three pages and
  unusable for the 20-50 a real scanned booklet has (the screenshot that prompted this
  showed 20 rows scrolling off the fold).
  Two changes. (1) **`PageRangeSelector`** replaces the row list as the picker: a text field
  taking `"1-5, 8, 10-12"` — **Devanagari digits accepted**, since the officers type ५ not 5
  — with an expand toggle revealing a grid of numbered chips. The reveal animates the grid's
  own height (`grid-template-rows: 0fr → 1fr`) so it fits any page count without a magic
  max-height that would clip a 50-page scan, chips fade in on a capped stagger, and
  `prefers-reduced-motion` turns all of it off. `parsePageRanges`/`formatPageRanges`
  (`lib/documentSelection.ts`) are the pure two-way conversion, so the field always reflects
  what the grid shows and vice versa. The load-bearing decision: a typed range is applied by
  **toggling only the pages that DIFFER** from the current selection, never by assigning a
  set — that is what lets one component serve both selection models in the product
  (/translate's "pages I want", /dlo's "keys I excluded"), because every parent's `onToggle`
  is already a functional update. A document that has not been read shows the selector alone;
  a read one shows it folded above the editable rows, which stay (text has to be read to be
  corrected). (2) **All four surfaces present upload identically and inline** — the fold is
  gone from the media room and `/proofread`, `/dlo`'s single picker splits into an **MP3**
  control and a **document** control (a recording is transcribed whole and has no pages to
  pick; a document does — same list underneath, `.txt` still needs the backend follow-up),
  and `/translate` loses its PDF tab entirely.
  **`/translate` is now one flow**: an uploaded pdf/docx/txt is read by the shared intake and
  its text lands in the same box the user could have pasted into, then follows the pasted-text
  path — one synchronous submit, the same mandatory name check. `TRANSLATE_TEXT_MAX_CHARS`
  goes 10,000 → **60,000** so a whole document fits; this is safe because `translateArticle`
  already chunks internally, so the cap bounds how long one request RUNS rather than whether
  it works, and the intake is handed that cap as `maxChars` so page selection is how an
  over-long booklet is trimmed. The **cost** is deliberate and should be understood before
  anyone "fixes" it: the retired per-page path also gave per-page progress, separate
  English/Hindi page-by-page output, English-page passthrough and the AI page instruction. All
  of that server code is left INTACT but unused (`jobs/translate-document.ts`, the
  `/translate/documents*` routes, `generation/translate-document.ts`,
  `interpret-document-instruction.ts`) — only the web half was deleted
  (`TranslateDocumentPanel.tsx`, `useTranslateDocument.ts`), so it is a git revert away.
  A very large document now translates as one long synchronous request; if that becomes a
  timeout in practice, restoring the background job is the fix, not raising the cap further.
  Verified 2026-07-24: typecheck + lint green; 19 offline assertions on the range helpers
  (mixed ranges, Devanagari in → Latin out, reversed ranges, out-of-range clamping, junk
  ignored, non-contiguous listed sets, round-trip); and a real browser run against the live
  app — a text-free 20-page PDF stops at the picker showing `1-20`, the grid renders 20 chips
  in two rows, applying `"2-4, 9, 15-17"` selects 7 and canonicalises the field, tapping a
  chip updates the field (`1-4, 9, 15-17`), `"१-३, ८"` parses to `1-3, 8`; a born-digital
  15-page PDF skips the picker to the review list with the selector folded, where `"1-3"`
  narrows the row checkboxes to 3; `/dlo` renders exactly two file inputs
  (`.mp3,audio/mpeg` and `.pdf,.docx`); no page errors on any surface. 9 now-dead strings and
  the whole `translateDoc*` block were removed. No migration, no n8n; deploy is web + API
  (rebuild `@dgipr/schemas` dist first — the cap is shared).

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

- **An uploaded file is a source, not a clipboard action** (2026-07-24, no migration):
  uploading a PDF on the media room and pressing तयार करा answered
  `कृपया किमान २० अक्षरांची टिपणी लिहा` — the document had been read, its pages reviewed, and
  it still counted for nothing. The cause was that `DocumentIntake` only ever handed its text
  over on a **button press inside its own card** ("हा मजकूर लेखात जोडा"), so an officer who
  treated the upload as the note — which the page's own hint invites: *"चिकटवा किंवा
  फाईलमधून घ्या — दोन्ही एकत्रही करता येईल"* — got a form that silently ignored their file.
  A confirm-then-commit step is right where the file REPLACES a surface's single text box
  (/translate, /proofread — the click authorises the overwrite), and wrong where the file is
  a second source beside a box that may also be empty.
  So `DocumentIntake` now has two modes. **Handoff** (`onText`, unchanged default) is the old
  behaviour. **Live** (`onTextChange`) streams the current selection's text to the caller
  whenever it changes — including `''` when the file is dropped or re-read — and hides the
  hand-over button, replacing it with a line saying the text is already in use. The callback
  is held in a ref so an inline arrow from the caller cannot re-fire the effect on every
  render. The media room takes live mode and keeps the text in `docText` **beside** `note`,
  joining them blank-line-separated at submit (`combinedNote`, typed text first), which is
  what the 20-char and `NOTE_MAX_CHARS` guards now measure and what the API receives. The
  now-unused `actionLabel` prop and `docAddToArticle` string are deleted.
  One consequence worth keeping: a run **consumes** the document. `clearDocument()` removes
  the sessionStorage job id and remounts the card on BOTH submit paths — including the
  article path that navigates away, where the id would otherwise outlive the navigation and
  silently re-attach the same file to the next run. Verified 2026-07-24: typecheck + lint
  green, the media room renders on the dev server. No migration, no n8n; deploy is web only.

- **Social poster: classify/copy/prompt into the API, content-aware master selection,
  gpt-5.6-luna, thin n8n** (2026-07-24, no migration — SUPERSEDES the "workflow
  classifies/copies/composes the image prompt" notes for `social-post-v2-api`): the social
  (twitter/facebook) poster's whole text pipeline moved OUT of n8n and INTO
  `@dgipr/content-engine` (per the package-boundary rule), and the workflow dropped from 22 to
  **5 nodes** that only edit the chosen image with an API-built prompt. Three problems drove
  it. (1) The master template was chosen by `pickRandom(enabled)` — before the note was even
  classified — so `info_bullets`'s 13 masters (0-8 body slots) landed a 6-bullet note on a
  3-slot template as often as not. (2) The copy ran on gpt-4o-mini inside n8n and leaked Latin
  script into Marathi headlines (`मुंबईतील नवीन MRI केंद्रे`). (3) 22 nodes with the business
  logic in n8n, against this file's own rule; the `Ping*` progress nodes fired AFTER
  `Respond to Webhook` so `classify`/`copy` progress could never reach the UI (and were
  ECONNREFUSED locally besides), and `Decode Image` duplicated the 6.4MB poster into a
  never-read binary (12.8MB/run).
  Measured first (n8n exec 200, 84.5s): `Edit Image` (gpt-image-2) was **77.4s = 91.5%**, so
  trimming nodes buys ~7% at most — this rework is for correctness, cost-metering and
  maintainability, not a big speedup; the image call is left at gpt-image-2 `medium` (benchmark
  `high` — ~4x cost — at deploy if wanted).
  New engine modules, ports of the retired Code nodes then improved:
  `generation/classify-poster-type.ts` (adds `point_count` + `wants_photo` to the same strict
  call — the selection signals — for free), `generation/generate-poster-copy.ts` (the six-style
  REG registry, slot-pinning and text-only scene_brief strip verbatim), `generation/build-poster-prompt.ts`
  (the initial + feedback image prompts, whose reserved-zone geometry now lives beside the
  chrome overlays it must stay in sync with — `twitter-chrome.ts`/`cmo-geometry.ts`),
  `references/select-master.ts` and the rewritten `references/catalog.ts`.
  **Content-aware master selection** (`selectMaster`): score each enabled master against the
  note's need (slot-count distance, overflow penalised 2x; `hasPhotoZone` match +3; un-analysed
  = -2), keep the top band (within 1 point), pick by `hash(generationId)` — reproducible per run
  (a retry re-renders the same template), varied across runs, never a structurally wrong fit.
  Pins/CMO skip classification and select by seed only. **The master's `layout_spec` (0016) is
  the cache the user asked to reuse** — most of the library is null-spec, so a picked null-spec
  master is analysed ON DEMAND and PERSISTED (`setReferenceImageLayoutSpec`), ≤1 analysis/job;
  run the `analyze:references` backfill at deploy to fill it in bulk.
  **Copy on gpt-5.6-luna** (env `OPENAI_COPY_MODEL`): faster than gpt-4o-mini (~2.5s vs ~3.9s)
  and keeps Devanagari. The gpt-5.x family rejects `temperature` and `max_tokens`, so
  `generation/openai-chat.ts` branches on `/^gpt-5/` to send `max_completion_tokens` +
  `reasoning_effort` (gpt-4o body unchanged byte-for-byte); `chatComplete` gained `jsonSchema`
  and `reasoningEffort`. gpt-5.6 price rows added to `cost/pricing.ts`; the copy call is now
  metered inside the job's cost scope (n8n's text calls never were).
  **Scheme names verbatim and in full** (the second half of the user ask): a scheme name written
  on a poster must match the note character-for-character — the old `3-8 word headline` rule was
  itself TRUNCATING `मुख्यमंत्री माझी लाडकी बहीण योजना` to `लाडकी बहीण योजना`.
  `generation/lock-scheme-names.ts` follows the "structural, not instructed" pattern
  (proof-read's verbatim filter, translate's locked-name repair): the full names come free from
  `findGlossaryTermsInText(note)` filtered to `scheme`/`org`; a `LOCKED NAMES` block + word-count
  relaxation steer the model; a `scheme_names_used` json_schema field is validated against the
  note (inflection-tolerant — Marathi declines the head noun as a suffix, योजना→योजनेच्या, so an
  (n-1)-word prefix match counts as present); and a truncation is deterministically expanded to
  the full form (only ever LENGTHENS toward the source, so it can't invent a name or change a
  digit). Reported, never fatal. `apps/api/src/jobs/runner.ts` sequences it all and sets `step`
  directly; the feedback path builds its prompt with `buildFeedbackPrompt` and shares one
  `renderSocialPosterViaN8n(id, imageUrl, prompt)` with the initial run; `design_mode: 'fresh'`
  calls `generateImage` directly. The 5-node workflow (Webhook → Set → Read Image → Edit Image →
  Respond) takes `{ generation_id, image_url, prompt, quality }` and returns
  `{ poster_png_base64 }`; `quality` is now API-owned (one source of truth vs the old three-way
  sync). **Deploy order is the NORMAL one — API first, then `pnpm n8n:push`** (opposite of the
  marker-feedback rule): new API + old workflow still works (old workflow ignores the extra
  `prompt`), old API + new workflow sends no prompt and fails; run `analyze:references` BEFORE
  the API deploy. Verified 2026-07-24: full typecheck + lint green (my files; the pre-existing
  `intake/text-file.ts` lint error is untracked), 13 offline scheme-lock checks, n8n
  validate + `n8n:push --dry-run` (5 nodes, credential resolved), and live cheap harnesses —
  classify (`point_count`/`wants_photo`, Devanagari) and copy (full scheme name in the headline,
  `unpreserved: []`, digits intact) on gpt-5.6-luna. Live E2E of the 5-node workflow pending.
  Known operator gaps: the CMO type `custom_14b90655`'s only image is DISABLED (a CMO run throws
  until it's enabled on `/references`).

- **Every OpenAI call on gpt-5.6, in two env-configurable tiers** (2026-07-24, no
  migration): the repo was split down the middle — the social-poster rework earlier the
  same day had moved five call sites to `gpt-5.6-luna`/`gpt-5.6-terra` behind env vars,
  while **~40 calls still ran on `gpt-4o`/`gpt-4o-mini`**, pinned by the hardcoded
  `CHAT_MODEL`/`VISION_MODEL` constants in `openai-chat.ts` and four local overrides. This
  was NOT an id swap, because the gpt-5 request dialect differs in two load-bearing ways
  the repo had already discovered piecemeal and now handles centrally.
  (1) **`temperature` is rejected.** ~24 call sites passed `temperature: 0` for
  determinism; on gpt-5 that value is dropped and the model runs at its default. Nothing
  restores it — so `reasoningEffort` becomes the quality lever in its place (defaulted to
  **`'medium'`**, because this pipeline's work is judgement — write Marathi prose, grade
  coverage, decide whether a fact survived — not lookup), and the guarantee that actually
  held the line all along is the **deterministic post-filter** each precision path already
  stacks: proof-read's verbatim-excerpt + digit-preservation gates, `lock-scheme-names`,
  the translate per-word name repair, the video planner's `fact_index` grounding. Those are
  unchanged and are what to check if quality regresses, not the temperature.
  (2) **`max_completion_tokens` is a SHARED budget** for reasoning tokens and the visible
  answer, while every call site had sized its cap assuming the whole thing was answer text.
  A naive swap makes the tight ones (`maxTokens: 200` in rank-master, `400` in classify,
  `500` in interpret-image-feedback) return EMPTY content, surfacing as the useless
  `OpenAI chat response contained no content.` So `chatComplete`/`chatCompleteVision` now
  add `REASONING_HEADROOM[effort]` (none 0 / low 2k / medium 8k / high 16k) ON TOP of the
  caller's `maxTokens` — `maxTokens` keeps meaning "room for the answer" at every call
  site, and `analyze-template.ts`'s hand-rolled 600→1200 padding was reverted now that the
  transport does it. An exhausted budget reports `finish_reason: 'length'` with a pointer
  to the two knobs.
  Tiering: `CHAT_MODEL` (`OPENAI_CHAT_MODEL`, `gpt-5.6-terra`) = authoring + judgement and
  the default for any caller that names no model, so the ~36 default-model calls
  (generate-article, verify-coverage, revise-*, editorial-brief, proof-read, captions,
  extract-*, the video plan/script) migrate with no per-file edit; `UTILITY_MODEL`
  (`OPENAI_UTILITY_MODEL`, `gpt-5.6-luna`) = mechanical work a deterministic step
  re-checks (rank-master's tie-break inside an already-filtered band, page-instruction
  parsing, offline finetune prep); `VISION_MODEL` (`OPENAI_VISION_MODEL`, `gpt-5.6-terra`)
  = image input. `POSTER_COPY_MODEL` moved **luna → terra** (it writes the poster
  headline — the most-read text the product ships) but keeps `OPENAI_COPY_MODEL` so the
  poster path can be traded back for latency in one env line. `run-finetune.ts`'s
  `BASE_MODEL` deliberately stays gpt-4o-mini: it is a *fine-tuning base*, a different
  list, and self-serve fine-tuning is 403 on this account anyway. **Image (`gpt-image-2`)
  and embeddings (`text-embedding-3-large`) are deliberately untouched** — different model
  families, and re-embedding would invalidate every stored vector (0019 `halfvec(1024)`).
  Two operational consequences to expect, not to debug: **cost is up** (terra output is
  $15/1M vs gpt-4o's $10, and reasoning tokens bill at that output rate inside
  `completion_tokens`, so `generations.cost_usd` will jump — the unknown-model fallback
  price moved to terra so an unpriced id errs high), and **latency is up** (calls are
  serialized at `OPENAI_MAX_CONCURRENCY=1`; `OPENAI_REQUEST_TIMEOUT_MS`'s default was
  raised 180s → 300s because a full-length Marathi article body at medium reasoning can
  otherwise be aborted mid-generation by its own release valve).
  **Rollback is env-only**: the pre-gpt-5 request body is preserved byte-for-byte, so
  `OPENAI_CHAT_MODEL=gpt-4o OPENAI_UTILITY_MODEL=gpt-4o-mini OPENAI_VISION_MODEL=gpt-4o-mini`
  restores the old behaviour exactly.
  **Trap for the next agent: `proof-read.ts` is invisible to ripgrep.** It contains a
  literal NUL byte at offset 21693 (an intentional dedupe-key separator,
  `` `${excerpt}\0${suggestion}` ``), so rg classifies it as binary and silently skips it —
  any grep-driven sweep of model ids, prompts or call sites will miss two chat calls. Open
  it by path.
  Verified 2026-07-24: full workspace typecheck green (7/7 projects), lint green on every
  touched file (the only error is the pre-existing untracked `intake/text-file.ts`
  irregular-whitespace). No migration, no n8n (both workflows call `gpt-image-2` only —
  checked); deploy is API + web after rebuilding `@dgipr/content-engine` dist.

- **Poster diversity: the assignment is now authoritative, and there are two axes**
  (2026-07-24, migration 0028): four of five consecutive social posters came back the same
  warm orange/red/gold on the same cream ground, despite a palette rotation having been added
  earlier the same day "which helped a little". Measuring the last eight live posters
  (`measurePosterColours`, below) put a number on it: **5/8 warm cream grounds, 5/8
  orange-or-red dominants**. Six independent causes, only ONE of which was the image model
  ignoring instructions — the rest were ours:
  (1) **The assigned palette never reached the image prompt.** `build-poster-prompt.ts` emitted
  `fmtArtDirection(artDirection)` when art direction succeeded — the normal path — with
  `assignedPalette` only in the `else`. So the rotation's choice arrived as the art director's
  *paraphrase*, produced by a model explicitly told it "may refine within this family". The
  forcing function was laundered before use. **This one bug made the whole rotation nearly
  inert**, and is the thing to check first if colours ever converge again.
  (2) **The library was itself low-variance**: all 12 entries were "light warm-neutral ground +
  one dark band" (ivory, cream, dove grey, blush, sand, off-white…) with warm-skewed accents, so
  even perfect obedience gave warm-on-cream most of the time and a near-constant BACKGROUND —
  which is what "same background colour as well" actually meant.
  (3) **Colour leaked back in from the master**: `analyze-template.ts` asks `layoutSummary` to
  state "the dominant colour theme", that string was injected as structure inspiration under a
  soft "IGNORE any colours it mentions", and `rank-master.ts` *selected* the master on "mood,
  **colour theme** and topic" — from a library that is overwhelmingly saffron/maroon/cream.
  (4) **Colours were adjectives, never hex.** (5) **The recency ring was in-process and
  id-only** — reset on every restart (constant under `tsx watch`), and
  `terracotta → dgipr_saffron → deep_burgundy → wine_maroon` was four legal picks and one look.
  (6) **Nothing measured the output**, so non-compliance was invisible.
  The fixes, in the order they matter:
  - **`poster-palettes.ts` rewritten**: 18 palettes, THREE per family across SIX families
    (`cool|teal|green|purple|neutral|warm`), each carrying four exact **hex** values
    (`ground/panel/ink/accent`) and a Marathi `label`. The ground is **tinted to its family** —
    only `warm` may use cream — which is what makes backgrounds differ at all while posters stay
    light-ground (the product decision: no dark or saturated grounds). The DGIPR house look is
    ONE entry of eighteen in a family of three of six. `pickPalette(seed, { ids, families })`
    drops recent FAMILIES first, then ids, skipping either filter only if it would empty the pool.
  - **`build-poster-prompt.ts`**: a `COLOUR SPECIFICATION` block of hex values leads the fresh
    prompt and is emitted **whenever a palette is assigned**, with art direction BELOW it as
    treatment. Plus a `COMPOSITION` block that outranks the master's structure hint.
  - **`art-direction.ts`**: when a palette is assigned, `palette` is dropped from the json_schema
    entirely — colour is not the art director's to choose, only to use — and it is given the
    assigned hexes as fact plus a **negative memory** of what the last few posters looked like
    (real signal, unlike the opaque creative seed it had before).
  - **`poster-layouts.ts` (new)**: the second axis — 11 composition archetypes with a `coverage`
    tag (`band|column|field|cards|wedge`), a hard `photo` filter and a `copyStyles` filter,
    rotated by the same seeded recency-aware picker. Two posters in different palettes still read
    alike when both are a top band over bullet rows; 18 palettes x 11 layouts do not.
  - **`strip-colour-words.ts` (new)**: deterministically removes colour language from a
    `layoutSummary` before it is used as structure inspiration — "structural, not instructed",
    the `lock-scheme-names.ts` move. Clause-aware (a real analysis puts its colour theme in a
    trailing clause, not a sentence), and a recognised colour clause abandons the rest of its
    sentence. `rankMasterByNote(..., { ignoreColour })` likewise drops colour from the ranking
    criterion on fresh runs. Verified against **25 real `layout_spec` rows: zero colour leaks,
    zero summaries emptied**, structure intact.
  - **`poster-colours.ts` (new, poster-renderer)**: `measurePosterColours(png)` reports the
    ground, whether it is warm cream, the dominant colour and its hue bucket. **Uses CHROMA
    (max-min), not HSL saturation** — this is load-bearing: HSL rates a pale cream `#FDF2DC` at
    0.84 because it is nearly white, so a saturation-weighted vote hands a poster's cream
    BACKGROUND back as its "dominant colour" and reports 96% of pixels as colourful. Measured on
    the RAW poster before chrome, since the footer band and emblem are identical on every render.
  - **Migration 0028 `generations.poster_style` (jsonb)** + `listRecentPosterStyles` replace the
    in-process ring, so the spread survives restarts and multiple processes. The avoid set is
    built from the **measured** hue buckets as well as the assigned families — if the model
    ignores the spec, avoiding intentions achieves nothing. A mismatch is logged
    (`familyHonoured`), **never retried**: a re-render is another paid image call.
  - **UI**: the detail page shows the Marathi style label and gains a second redo button,
    **"वेगळ्या रंगात तयार करा"** (`recolour: true`), which bars the run's current family — a plain
    re-roll could legitimately land back in the family just rejected, since the recency ring only
    knows about OTHER runs.
  **The style write is deliberately NOT bundled with the poster write**: it is a separate
  best-effort update, because bundling them would mean that on a database without 0028 the whole
  update fails and the already-paid poster never lands on the row. Losing rotation memory for one
  run is acceptable; losing a render is not. Same principle as the caption ordering.
  Verified 2026-07-24: full workspace typecheck green (7/7), lint green on every touched file;
  five offline harnesses with assertions (palette rotation — no family repeat within 3, warm at
  4/30, no back-to-back ground repeat, non-warm families provably not warm-grounded; layout
  rotation — photo filter absolute both ways, quote-capable archetype for quote runs, determinism;
  colour strip — 7 synthetic + 25 real rows; poster-style round trip incl. junk/empty; prompt
  assembly — hexes present, spec before art direction, composition before structure hint, no
  master colour word in the hint); and a LIVE art-direction run of five seeds which returned
  `palette: ""` every time and **named no colour at all** across all five (it says "the dominant
  assigned tone"), each realising its assigned archetype. **Not yet done: 0028 is NOT applied**
  (applied by hand in Supabase; the code degrades cleanly without it — verified, the read throws
  and falls back to empty history), and the six-consecutive-run spread test needs it. Deploy:
  0028 → API → web (rebuild `@dgipr/schemas` + `@dgipr/database` + `@dgipr/content-engine` +
  `@dgipr/poster-renderer` dists first). No n8n — the fresh path calls `generateImage` directly.

Two n8n workflows are implemented and host-independent for deployment; their master
templates arrive as immutable `references/library/...` public URLs inside each webhook
payload (fetched over HTTPS — never local disk, no hardcoded storage paths):

- `social-post-v2-api` (the 'twitter' AND 'facebook' generation paths — one workflow,
  see the Facebook milestone above) — the API sends the full `types`
  catalog (slug/label/description/copy_style/reference_url per enabled type) plus
  `forced_type`/`forced_reference_url` (empty strings unless pinned). The
  classify/copy/image nodes are data-driven from that catalog; a forced type skips the
  classify LLM call, and custom types render with the generic (headline + points) copy
  layout. It renders the **poster only** — the caption nodes were removed in the
  optional-caption milestone (2026-07-24) and the caption is now written by the API —
  so the webhook response carries no `caption` field. Like the article path, the brand chrome is no longer painted by the image
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
