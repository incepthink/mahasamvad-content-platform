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

- **Android Share → automatic ध्वनिलेखन** (2026-08-06, no migration): the web app is now an
  installable PWA and registers `share_target` for audio, so an officer can choose Mahasamvad
  directly from WhatsApp/Recorder's Android Share sheet instead of first saving the recording
  into Files. `public/sw.js` intercepts the multipart navigation POST on the PHONE (never
  routing a meeting-sized recording through Vercel), holds at most 10 × 50 MiB recordings in
  Cache Storage, writes metadata last, and redirects to `/transcribe?share=<id>`. The
  transcription form consumes and deletes that one-shot cache, validates it with the SAME
  shared limits as a normal picker, and immediately creates the transcription — no second
  upload/submit instruction. Failed API uploads keep the reconstructed `File`s in React state
  for the ordinary retry button; abandoned cached shares expire after 24 hours. A compact
  `beforeinstallprompt` card gives Android users the only unavoidable one-tap installation
  gesture and disappears once installed or for the dismissed session. Required 192/512
  maskable icons use the exact Maharashtra emblem asset, not an AI redraw. The accepted
  recording set now matches ElevenLabs Scribe's documented audio inputs across `/transcribe`,
  `/dlo`, the shared picker and API validation: MP3, M4A, AAC, AIFF, OGG, OPUS, WAV, FLAC and
  WebM; this is what makes WhatsApp OPUS notes usable. iOS remains on its normal file-picker
  path because Safari does not register Web Share Targets. Deploy by rebuilding
  `@dgipr/schemas`, then API + web; HTTPS and one initial PWA install are required, no n8n.
- **Strict-source reference picking for क्रिएटिव्ह** (2026-08-03, no migration): ordinary
  unpinned DGIPR social runs no longer let the ranking model reinterpret the same prose as a
  different number of semantic facts on each run, or accept an oversized/multi-section master
  merely because it has enough capacity. `select-by-information.ts` deterministically treats
  each officer-written bullet/numbered line or prose sentence as one display unit, recognises
  only a visibly separate first line as an explicit headline, then hard-gates the model's
  preference to the tightest capacity band and the lowest unsupported text demand (headline,
  subheadline, section-label, CTA/contact/QR, slogan and similar slots). Text demand is derived
  from the existing cached `layoutSummary`, so the live library benefits immediately with no
  jsonb change or paid re-analysis; the same hard gate establishes the fallback before ranking,
  so a timeout cannot restore random template selection. The reproduced seven-sentence
  development-work note selects the enabled seven-slot `2df40928…` low-text master instead of
  the headline/benefits and duplicated two-section layouts seen in generations `d547…` and
  `3d068…`. Pinned images/types, CMO, YouTube, image prompting and rendering are unchanged.
  Deploy by rebuilding `@dgipr/content-engine` and the API; no n8n.
- **Analytics reports the work the current UI actually performs** (2026-08-02,
  migration 0043 unchanged): the single `वापरलेल्या सेवा` table no longer collapses
  a workflow into vague `मजकूर निर्मिती` / `प्रतिमा निर्मिती` rows. Every paid call is
  recorded under its user-facing task through the ambient cost meter (for example audio
  transcription, YouTube transcription, scanned-document OCR, designation extraction,
  article drafting/verification, article feedback, translation name extraction, English or
  Hindi translation, proofreading, social poster/caption work, YouTube thumbnails, and each
  video script/storyboard/clip/narration phase). Each row carries service, provider, configured
  model, actual invocation count, natural processed unit and attributable cost in the SAME
  table. `usage_events.action = task:<task>` plus enumerable jsonb detail is sufficient, so
  no migration after 0043 and no content/resource id is stored. Exact task history begins at
  this deployment (`TASK_TRACKING_STARTED_AT`); older generation/video cost breakdowns remain
  as explicitly labelled `पूर्वीची एकत्रित AI नोंद` rows because they cannot truthfully be
  reconstructed. `/dlo` is article-only in the current UI: its historical image breakdown is
  excluded and its displayed cost is rebuilt from its valid workflow rows, so a poster later
  attached elsewhere cannot make `लेख / बातमी` claim image generation. Task writes are
  fire-and-forget and never fail the officer's work. Deploy 0043 if not already applied, then
  rebuild `@dgipr/database` + `@dgipr/schemas` + `@dgipr/content-engine`, API and web; no n8n.
- **Every video is branded and ends on the DGIPR contact slate** (2026-07-30,
  no migration): the supplied `0730.mp4` now lives at
  `packages/poster-renderer/assets/video-outro.mp4` and is appended by
  `assembleSilentVideo` after every completed explainer video. It is a 2.18s
  1080x1920 asset: vertical output uses it natively; landscape output fits the
  complete frame on white rather than cropping away contact information. Every
  newly generated scene clip is post-processed by `overlayVideoLogo` before its
  versioned Storage upload, so the per-scene review players carry the logo too.
  The final stitch re-stamps the same lockup over the generated timeline, which
  keeps it crisp after concatenation and also brands free restitches of older
  stored clips; the supplied outro is already fully branded and is not
  double-stamped. The lockup comes from the SAME `renderGovernmentLockup` used
  by Twitter/Facebook chrome, but video targets 15% of frame width versus the
  social canvas's 12.5% (20% larger proportionally), at the top-right. All work
  is local ffmpeg/Sharp post-processing; no model sees or paints the logo and no
  paid generation is added. Narrated output pads the audio track with silence
  through the outro so a downstream shortest-stream transcode cannot cut it off.
  Verified with the assembly, narration and caption
  harnesses in both 16:9 and 9:16; renderer lint/typecheck/build and API
  typecheck green. Deploy API after rebuilding `@dgipr/poster-renderer`; no n8n.
- **News dateline, portfolio attribution and meeting-shaped style retrieval** (2026-07-29,
  migration 0039): every generated `news` article now receives `मुंबई, दि. <आजचा दिवस> :`
  (location configurable through `ARTICLE_NEWS_DATELINE_LOCATION`) at the start of its body;
  the day is calculated in `Asia/Kolkata`, rendered in Devanagari, supplied to the simple prompt
  and deterministically restored after initial generation and article feedback. DLO designation
  preparation normalizes the real code-mixed STT form `हायर अँड टेक्निकल एज्यु…` to the
  verified `उच्च व तंत्रशिक्षण मंत्री` portfolio, so the current holder still comes dynamically
  from the glossary (for the observed run: `चंद्रकांत पाटील`), while a one-word person row found
  only inside a different full name is suppressed (`हरी मुंडे` no longer also selects the
  unrelated `मुंडे` minister row). Saved DLO designation reviews carry
  `resolverVersion: 2`; an older saved review preserves its OCR/text corrections and officer
  edits but refreshes stale name suggestions once, so retrying an existing intake does not
  reproduce the pre-fix attribution. Style retrieval's vector RPC had begun timing out after
  migration 0019 removed HNSW, silently forcing arbitrary recent-category references; 0039
  restores a 1024-dimension HNSW index. The no-vector fallback now scans a wider indexed pool
  and ranks it by source/candidate meeting, directive and proposal shape plus lexical overlap,
  and weak below-floor semantic hits are no longer promoted ahead of that ranked fallback.
  Deploy: 0039, then rebuild `@dgipr/database` + `@dgipr/schemas` +
  `@dgipr/content-engine`, then API + web; no n8n.
- **Simple fixed-template social prompt** (2026-07-28, no migration): for Twitter DGIPR runs
  using `designMode: 'onbrand'` (UI: **ठरलेले टेम्पलेट**), the selected reference
  image is sent unchanged to the image-edit model with the original note verbatim and only
  these constraints: use the reference image as the AUTHORITATIVE visual structure (composition,
  sections, proportions, content distribution, imagery zones, balance and density), filling
  the usable canvas without collapsing onto one side or leaving large unused areas, while
  defining STRUCTURE as geometry/hierarchy only—not the meaning, content, or element type of
  its slots; apply a strict REFERENCE-CONTENT FIREWALL so every reference word, numeral, date,
  year, URL, domain, app name, contact, identifier, logo/emblem, QR/barcode and factual claim
  is unrelated placeholder content and copied NONE of it; require every output fact/text/
  number/code to be directly source-supported, with an unsupported reference slot repurposed
  using other supported content or relevant non-informational imagery, or kept visually neutral
  with the poster background/design treatment while preserving the successful reference
  layout and spacing—never reflowing or redesigning the composition merely because a slot is
  unsupported;
  filter source-document artifacts (`वृत्त. क्र.`, page/issue/report/file/document numbers,
  running headers/footers, filenames, scan/OCR artifacts) even when they occur in the supplied
  text; do not
  inherit its colours—the reference controls STRUCTURE ONLY, while the image model chooses
  the palette freely and creatively subject only to strong contrast and readability; do not
  add a logo; do not add a footer; keep only the top-right 180x170 and full-width bottom 120px
  as mandatory empty cover zones that seamlessly continue the
  immediately adjacent background—never a separate colour, white patch, box, panel, band,
  marker, or visible boundary (and explicitly no text, imagery, objects, decoration, or
  anything sitting behind the later overlays); treat those as the ONLY intentionally empty
  areas and use all remaining space right up to their boundaries; use only Marathi text,
  Devanagari numerals and Nirmala UI; and never paste the entire input article—select only its
  most important poster information. No other colour, placeholder-erasure, imagery, sizing,
  or text-placement rules are included.
  This branch also skips `generatePosterCopy`, since its structured rewrite would not be used
  and would add an unnecessary text-model charge. The existing API-side
  `overlayTwitterChrome` still adds the official logo and footer after rendering. `adaptive`,
  `fresh`, Facebook, and the separate CMO template path are unchanged; no n8n workflow change.
  The Twitter chrome lockup was also tightened from 240x220 to 160x154 and moved from a 20px
  to a 6px top/right margin on the 1280x1600 canvas. The emblem is 96px wide and starts 8px
  below the card top; the Marathi wordmark keeps its established size and vertical position.
  This turns the emblem's reduced height into intentional top padding while the narrower card
  removes excess left/right padding.
- Mahasamvad scraping/ingestion, chunking, embeddings, and RAG retrieval
  (`packages/content-engine/src/{scraping,chunking,embedding,retrieval}`)
- Article generation with coverage + faithfulness verification
  (`packages/content-engine/src/generation/generate-article.ts`)
- Poster generation, three modes selected by `ARTICLE_POSTER_MODE`:
  - `fresh` (default, 2026-07-24): the API builds the entire image prompt
    (`build-article-poster-prompt.ts`) and generates the landscape article poster
    from scratch at 1536x1024 — **no n8n**. An assigned colour palette (shared with
    the social path) and a landscape composition archetype
    (`article-poster-layouts.ts`) decide how it looks; the selected master is
    colour-stripped STRUCTURE inspiration only. If the news has one NAMED SUBJECT —
    a scheme, campaign, mission, award, service, portal, fund or project — the
    poster's entire text is that name in full (`resolve-poster-subject.ts`), and an
    officer may override it outright with `generations.poster_heading` (0029).
  - `n8n`: the legacy path — the `article-poster-v1-api` workflow (now a thin 5-node
    image-EDIT service) repaints a master template in place.
  - `html`: a text-free AI background photo typeset in HTML and screenshotted with
    Chromium so Devanagari is never mangled (`packages/poster-renderer`) — kept as fallback.

  In every mode the logo/footer chrome is composited by the API rather than painted
  by the image model: the prompt reserves those zones and
  `overlayArticleChrome` (`packages/poster-renderer/src/article-chrome.ts`) stamps
  `article-logo.png` (top-left) + `poster-footer.png` (full-width bottom) — on
  initial renders and image-feedback re-renders alike.

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
  (3) The reason it _couldn't_ be optional: the prompt lived inside `social-post-v2-api` as
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
  the previous milestone shared the upload _plumbing_ but left each surface presenting it
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
  treated the upload as the note — which the page's own hint invites: _"चिकटवा किंवा
  फाईलमधून घ्या — दोन्ही एकत्रही करता येईल"_ — got a form that silently ignored their file.
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
  `BASE_MODEL` deliberately stays gpt-4o-mini: it is a _fine-tuning base_, a different
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
  _paraphrase_, produced by a model explicitly told it "may refine within this family". The
  forcing function was laundered before use. **This one bug made the whole rotation nearly
  inert**, and is the thing to check first if colours ever converge again.
  (2) **The library was itself low-variance**: all 12 entries were "light warm-neutral ground +
  one dark band" (ivory, cream, dove grey, blush, sand, off-white…) with warm-skewed accents, so
  even perfect obedience gave warm-on-cream most of the time and a near-constant BACKGROUND —
  which is what "same background colour as well" actually meant.
  (3) **Colour leaked back in from the master**: `analyze-template.ts` asks `layoutSummary` to
  state "the dominant colour theme", that string was injected as structure inspiration under a
  soft "IGNORE any colours it mentions", and `rank-master.ts` _selected_ the master on "mood,
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

- **The ARTICLE poster gets the same treatment: fresh generation, two rotations, and a scheme-name
  lock** (2026-07-24, no migration — SUPERSEDES the "Article poster via n8n" notes and retires
  `ARTICLE_POSTER_THEMES`): the two same-day social reworks (thin n8n + the diversity fix) left the
  news/scheme poster path untouched, so it still had every problem they had just solved, plus one
  of its own. It built its whole image prompt inside an n8n **Code node** (against this file's own
  package-boundary rule); it **edited the picked master in place**, so the master's saffron/cream
  pixels survived into every render — the precise mechanism that made social posters look alike;
  its colour "rotation" was `ARTICLE_POSTER_THEMES`, 7 entries picked by a bare `Math.random()`
  with no recency memory, applied only as a CONDITIONAL "recolour the headline panel **if** the
  master has one", which left the _background_ — the thing actually complained about — untouched on
  every master that had no solid panel. And when the article was about one named scheme it still
  wrote an editorial headline, so
  `पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना २०२६` shipped as `शेतकऱ्यांना कर्जमुक्ती`.
  On an official government poster a shortened scheme name is a factual error, not an editorial
  choice — and the trailing year is exactly the token a rewrite drops first.
  - **`ARTICLE_POSTER_MODE` now defaults to `fresh`**: the API builds the prompt and calls
    `generateImage` at 1536x1024 directly, **no n8n on the creation path**. `n8n` (edit the master,
    the old behaviour) and `html` (Chromium) remain, so rollback is one env line.
    `article-poster-v1-api` drops 6 → **5 nodes** — the twin of `social-post-v2-api`, taking
    `{ generation_id, image_url, prompt, quality }` — and now serves only pixel/marker FEEDBACK
    re-renders. `renderArticlePosterViaN8n` became `renderArticlePosterEditViaN8n(id, imageUrl,
    prompt)`.
  - **The palette library is SHARED, the composition library is NOT.** `poster-palettes.ts` is
    reused verbatim (colour is aspect-agnostic, and one rotation across everything the department
    publishes is the point). Compositions could not be: the canvas is landscape not 4:5, the copy is
    ONE headline with no body list, and the reserved chrome is top-LEFT + bottom rather than
    top-right + bottom. So `article-poster-layouts.ts` holds 11 **landscape** archetypes
    (`art_`-prefixed ids, `coverage` gaining `panel`/`split` in the shared vocabulary), and every
    instruction states the headline-only rule and the reserved zones — asserted by the harness,
    which caught two archetypes that had silently omitted the zones.
  - **The scheme rule is CONTENT-driven, not category-gated** (`resolve-scheme-subject.ts` —
    **SUPERSEDED the same day; see the named-subject milestone at the end of this file, which
    deletes the pre-filter described here and generalises the rule past schemes**). A
    `news` article about one scheme gets the lock too; what matters is whether the article's
    SUBJECT is a named scheme. Structure, in the repo's usual order: a **free pre-filter** (no
    `योजना`/`अभियान`/`कार्यक्रम`/`मिशन`/`उपक्रम`/`धोरण` anywhere → return without a model call, which
    is most news runs), then one call that only **nominates** a name, then a **deterministic
    verdict** — the name must be accountable in the article, via `validateDeclaredSchemeNames`'s
    inflection tolerance (योजना → योजनेच्या) or by `lockSchemeNames` expanding a truncation against
    verified glossary rows, a repair that can only ever LENGTHEN toward the source. Unaccountable →
    discarded, and the poster falls back to its editorial headline; the pipeline never invents, so
    the failure mode is a plain headline, never a fabricated scheme. When it fires, the prompt
    carries a `TEXT LOCK` block: reproduce this exact string, year included, and add no subtitle,
    tagline, department name, date or English version.
    **Tier note:** this call runs on `POSTER_COPY_MODEL` (gpt-5.6-terra), NOT the utility tier —
    only its name output is code-checked; the _judgement_ ("about a scheme" vs "mentions one") is
    not re-checkable and decides a poster's entire visible text, the same reasoning that moved
    `POSTER_COPY_MODEL` luna → terra.
  - **Style history is now SCOPED by poster kind** (`listRecentPosterStyles(client, limit,
categories)`). Both lanes share `generations.poster_style` (0028) but draw compositions from
    different libraries, so an unscoped read let a social `cards` coverage bar an article pick —
    spreading each rotation against a vocabulary the other cannot produce. `poster-style.ts`
    resolves a layout id through BOTH libraries (`anyLayoutById`); `art_` namespacing keeps that
    unambiguous.
  - Both **redo buttons** (`वेगळी रचना तयार करा`, `वेगळ्या रंगात तयार करा`) and the Marathi style
    label come to `PosterPanel`; `/generations/:id/poster/regenerate` now serves both lanes (an
    article run re-derives copy from the stored, possibly feedback-revised article and re-runs the
    scheme check, so a redo after an article edit picks up the change; `html` mode is refused,
    having no assignment to re-roll). The style write stays a SEPARATE best-effort update after the
    poster write — on a database without 0028, losing rotation memory is acceptable, losing a paid
    render is not.
    Verified 2026-07-24: full workspace typecheck green (7/7), lint clean on every touched file, and
    8 offline harnesses green — the 4 new/changed ones plus `poster-palettes`/`poster-layouts`/
    `strip-colour-words`/`lock-scheme-names` unchanged. New assertions worth knowing: the article
    prompt carries the assigned hexes with COLOUR SPEC before ART DIRECTION and COMPOSITION before
    the master's structure hint (the social bug, which was emitting the art director's paraphrase
    INSTEAD of the assignment — check this FIRST if article colours ever converge); no master colour
    word survives into the hint; the scheme lock preserves `२०२६` and refuses an invented name; the
    photo filter is absolute both ways. n8n `validate_workflow` returns 0 errors and
    `n8n:push --dry-run` reports 6 → 5 nodes with the credential resolved by name.
    **Not yet done** (needs spend/a live instance): 0028 is still unapplied, the
    `analyze:references` backfill for article masters, and the six-consecutive-run spread test +
    a real scheme-note E2E. **Deploy order is the NORMAL one — API first, then `pnpm n8n:push`** —
    and the window between them is safe because the API still sends the legacy
    `reference_url`/`image_feedback`/`marker_count` fields, so a new API against an un-pushed
    workflow degrades article-poster FEEDBACK to the old in-workflow prompt instead of throwing
    "No reference_url received". Initial renders never touch n8n at all. No migration; rebuild
    `@dgipr/database` + `@dgipr/content-engine` dists first.

- **The article poster's heading: named SUBJECT, not just schemes — and a hand override**
  (2026-07-24, migration 0029 — SUPERSEDES the scheme-lock half of the milestone above): the
  scheme lock shipped that morning almost never fired. Three real posters, three different
  failures, and the machinery downstream (`TEXT LOCK`) was fine in all three — only the flag
  turning it on was wrong:
  - `‘दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६’` → `राष्ट्रीय पुरस्कारासाठी ऑनलाईन अर्ज करा`. The **free
    token pre-filter** (`mentionsScheme`: योजना/अभियान/कार्यक्रम/मिशन/उपक्रम/धोरण) returned `null`
    before spending a token, because an AWARD contains none of those words. No token list ever
    could: the pre-filter is **deleted**. One `POSTER_COPY_MODEL` call per article poster is
    nothing beside the ~$0.08 image render it guards, and the saving was buying wrong posters.
  - `‘भारत टॅक्सी’` → `सहकाराची नवी क्रांती`. A named **service/model** was not a
    "scheme, programme or campaign" as the prompt defined the question.
  - `'पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना'` → `५० हजारांची अट रद्द; २ लाखांपर्यंत कर्जमाफी`.
    The prompt explicitly answered **false** for "an announcement that merely MENTIONS a scheme"
    and for "several different schemes" — and this note is a विधानसभा announcement naming two
    (the older ज्योतिराव फुले… as comparison). It hit both exclusions while being exactly the
    shape of a DGIPR press note.
    `resolve-scheme-subject.ts` → **`resolve-poster-subject.ts`** (`resolvePosterSubject` /
    `validatePosterSubject` / `PosterSubject`; `schemeLocked` → `textLocked` at every call site).
    What changed, in order of importance:
    (1) **The question is broader**: any NAMED subject — scheme, campaign, mission, **award**,
    **service/model**, **portal**, fund, project (`SUBJECT_KINDS`, reported for the log). The accept
    rules now name the three failing shapes directly: a statement/announcement/launch/review ABOUT
    a named thing counts (the thing is the subject, not the meeting); an invitation for
    applications counts; and where several are named, pick the one the news **acts on** — a change
    to A that cites older B for background has subject **A**. False stays for a genuine roundup, a
    passing mention, and generic wording with no proper name.
    (2) **Grounding is structural, per the repo's usual move**: the model must return an `evidence`
    sentence copied verbatim from the source, checked (whitespace-normalised) to occur in it and to
    contain the name. Reported, not fatal — the name check is strictly stronger.
    (3) **Quotes come off** (`stripEdgePunctuation`): these notes mark official names with ‘…’, and
    the model returns them attached, which nothing downstream can match. That is also why quoting
    is now given to the model as a positive SIGNAL.
    (4) **It reads the NOTE, not only the article** — the officer's expectation is expressed
    against their own text, and a note→article run can reword. The name is nominated from the note
    and must be accountable in note ∪ article; on a media-room run they are the same string, so
    nothing is paid twice.
    (5) **A lenient false-positive backstop** (`isProminent`), needed because broadening the rule
    risks putting a passing mention on a poster: reject only when the name occurs exactly ONCE and
    after the 75% mark of a source longer than 800 chars. Short sources exempt.
    (6) The `TEXT LOCK` block no longer says "scheme" — telling the model it is looking at a scheme
    name invites it to correct an award name into scheme-shaped wording.
    **Plus the escape hatch the operator asked for: `generations.poster_heading` (0029)** — type
    the exact poster text. On the media room it appears only when the **पोस्टर** output is selected
    (a social poster's headline lives inside a multi-field copy object with no single line to lock,
    so the API 400s a social run that sends one); on `PosterPanel` it is a third redo beside the two
    style ones, which is where it actually gets used — you only learn the heading is wrong once the
    poster exists. It wins outright and skips the model call entirely. It is a **column, not a job
    parameter** (the `generateCaption` precedent does not apply): `startPosterRegenerateJob`
    re-derives everything from the row, so a heading held only in the request would vanish on the
    first "वेगळ्या रंगात तयार करा". Deliberately NOT `generations.heading`, which is the article's
    editorial ANGLE and is already surfaced in the edit-and-re-run fold — an angle is not poster
    text. `insertGeneration` **omits the column unless a heading was typed**, so a database without
    0029 loses only this feature instead of failing every create (the 0028 principle), and the
    regenerate job persists it BEFORE rendering so a failed render does not lose the typed text.
    Verified 2026-07-24: full workspace typecheck green (7/7), lint clean on all 11 touched files,
    18 offline assertions (quote stripping incl. the ‘भारत टॅक्सी’ and hyphenated-year
    `पुरस्कार-२०२६` cases, glossary truncation expansion, invented-name refusal, all four prominence
    cases, name found in the note half); the article prompt harness still green; **live on all three
    real notes** — `भारत टॅक्सी` (service), `दिव्यांग सशक्तीकरण राष्ट्रीय पुरस्कार-२०२६` (award),
    `पुण्यश्लोक अहिल्यादेवी होळकर शेतकरी कर्जमुक्ती योजना` (scheme), each `model+verbatim` with its
    evidence matched — and **two negative controls returning `null`** (a flood-inspection note, and
    a planning-committee review that names three schemes in passing), so ordinary news keeps its
    editorial headline. Live API guards: social+heading 400, unknown id 404, >120-char heading 400.
    **E2E**: re-rendering the real भारत टॅक्सी run produced `poster-v2.png` reading exactly
    `भारत टॅक्सी` and nothing else, chrome and reserved zones intact. Deploy: **0029 → API → web**
    (rebuild `@dgipr/schemas` + `@dgipr/database` + `@dgipr/content-engine` dists first); no n8n —
    the fresh path calls `generateImage` directly.

- **/dlo reads its documents at the INPUT step, and takes `.txt`** (2026-07-25, no
  migration): every other upload surface probes a file the moment it is attached — the media
  room shows the `PageRangeSelector` picker inline, and a scanned PDF stops there until the
  officer says which pages are worth OCR'ing. `/dlo` alone made them fill in the whole form,
  press पुढे जा, and wait out the intake job before the same picker appeared, buried in the
  review step. The picker markup was already shared (`DocumentPages` → `PageRangeSelector`);
  what differed was WHEN the selection happened, which is a backend question, not a styling
  one. It also could not read `.txt`, which the shared intake has handled since the
  unified-upload milestone.
  Documents now go through the shared ephemeral service (`POST /api/documents`,
  `jobs/document-intake.ts`) as one `<DocumentIntake>` card per document, in live mode.
  **Recordings deliberately do not**: an MP3 is transcribed whole, has no pages to pick and
  no per-page spend decision, so it still travels as a multipart file and is read by the job —
  the same reason audio was excluded from the shared engine in the first place.
  The load-bearing decision is what happens at submit. Rather than keeping the documents
  client-side (a refresh would lose them) or appending them to the notes (which destroys the
  per-source review), each is handed to `POST /dlo/intakes` as a `documents` JSON field
  (`DloPreReadDocumentSchema`: `jobId`, name, kind, and the SELECTED pages carrying the
  officer's corrections) and the route stores it as an **ordinary `files` entry with
  `status: 'done'`**. A pre-read document is then indistinguishable from one the job read, so
  `DloSourceReview`, `assembleDloText`, `combineIntakeSources`, the `dlo_intake_id` lineage
  and `POST /:id/generate` needed **no changes at all** — the review step still shows one card
  per source and a PDF still lists its pages.
  Three consequences worth keeping. (1) **No double spend**: the intake job's extract phase
  skips `status: 'done'` entries, or a scanned PDF would be OCR'd a second time AND the
  officer's corrections replaced by the re-read. (2) **The archive survives**: the payload
  carries the ephemeral `jobId`, and the route copies `getDocumentIntakeJob(jobId).data` into
  the private `dlo-uploads` bucket **in process** — no second upload from the browser, and the
  review-step per-file OCR re-read keeps working. An expired job (60-min TTL) simply yields an
  entry with no `storagePath`: the text still lands (it travelled in the request), and the new
  `canReextract` flag on the detail payload hides a re-read button that could only fail, with
  the route 400ing it as a backstop. (3) A run **consumes** its documents — both the slots and
  their sessionStorage job ids are cleared on a successful create and on पुन्हा सुरुवात करा,
  or the next run would silently re-attach the last one (the media room's `clearDocument()`
  rule).
  `.txt` came almost free with the move: a new `'txt'` value on `DloIntakeFileKind` /
  `DloIntakeFileSchema.kind` plus a review-card label. `files` is jsonb, and
  `DloIntakeFileEntry.storagePath` became optional the same way — **no migration**.
  Also fixed in passing: `PageRangeSelector` hardcoded `id="page-range-input"`, which was
  invisible while one picker existed per page and makes every label focus the first input now
  that /dlo shows several — it uses `useId()`. The `files` multipart path still accepts
  pdf/docx for back-compat, so the job's probe/`needs-selection`/`POST /:id/extract`
  machinery is intact but unreachable from the web.
  Verified 2026-07-25: full workspace typecheck green (7/7), lint clean on all nine touched
  files (only the pre-existing `intake/text-file.ts` irregular-whitespace error and two
  poster-renderer warnings remain, all untouched). Live API: a `.txt` probes to one page with
  its BOM stripped and ५०० intact, and lands as a `done` source under its
  `=== स्रोत: … ===` header; a 6-page PDF whose text layer is unusable stops at `selecting`
  with `pages: []` and **provably never reaches Sarvam**; submitting that same PDF as a
  pre-read document with pages 2 and 5 comes back with **exactly those two pages, the
  page-5 correction intact and `canReextract: true`** — the decisive check, since a job that
  had re-read it would have returned `needs-selection` and wiped them. Guards: create with
  nothing → 400, malformed `documents` → 400, re-read of an unarchived file → Marathi 400.
  Browser (Playwright, 17 assertions): the picker appears inline on attach with 6 chips and
  no page text, `२, ५` canonicalises to `2, 5` selecting 2 chips, two documents get
  independent pickers with unique input ids, a `.txt` skips the picker entirely, removing a
  slot leaves the others untouched, and a full submit sends the text (not the file), reaches
  the review step with both sources, and does not re-attach after a reset. Not covered
  (needs a genuinely scanned document and real spend): that a 3-page pick runs ONE 3-page
  Sarvam job from `/dlo`'s new path — the same gap the shared-intake milestone left open.
  No migration, no n8n; deploy is API + web (rebuild `@dgipr/schemas` + `@dgipr/database`
  dists first).

- **Meeting recordings are transcribed once, then cached by content** (2026-07-25, migration
  0031): re-uploading the same MP3 on `/dlo` used to re-run the slow, paid Sarvam batch STT job
  from scratch. The transcript is now **content-addressed**: the intake job's transcribe phase
  hashes each recording's bytes (`hashAudioContent`, SHA-256 — byte-exact, so a re-export is a
  correct miss rather than a wrong hit) and reads `audio_transcript_cache`
  (`getCachedTranscripts`, one batched `.in()` query) BEFORE calling Sarvam. Hits fill the file
  entry straight away; only the misses go to `transcribeAudioFiles`; each fresh transcript is
  written back (`putCachedTranscript`, upsert with `ignoreDuplicates` so concurrent identical
  uploads never error). If every recording is a hit, Sarvam is not called at all. **Server-side
  only** — no client change, and the MP3 is still archived to the private `dlo-uploads` bucket.
  Deliberate stances: only **successful, non-empty** transcripts are cached (a transient Sarvam
  failure can't poison it); a **cache-read failure degrades to "empty cache = transcribe
  everything"** (logged, non-fatal), so an un-applied 0031 disables only the optimization, never
  intake (the 0028/0029/0030 blast-radius principle); and the job-level failure branch now marks
  failed **only recordings still awaiting a result**, leaving cache hits `done`. New:
  `packages/database/src/stt-cache.ts` (+ its four exports) and
  `supabase/migrations/0031_audio_transcript_cache.sql`; the only orchestration change is the
  `if (audioIndexes.length > 0)` block in `apps/api/src/jobs/dlo-runner.ts` — `sarvam-stt.ts` is
  untouched. Verified 2026-07-25: full workspace typecheck green (7/7), lint clean on the touched
  files. Left for a real run (needs Sarvam spend): a second intake of the same MP3 reaching review
  with no `[sarvam-stt] batch job:` log line, and a cached+new pair sending only the new file.
  No n8n; deploy is API only after rebuilding `@dgipr/database` dist, with 0031 applied first.

- **A person is named with their designation — and the name dictionary finally reaches the
  ARTICLE** (2026-07-25, migrations 0032 + 0033): a DLO's meeting recording says
  `देवेंद्र फडणवीस`, but a published government article must say `मुख्यमंत्री देवेंद्र फडणवीस` — the
  designation is part of how a person is officially named, not decoration. Nothing did this,
  and three facts about the codebase shaped the whole design.
  (1) **The article pipeline had no contact with the glossary at all.** `generateArticle` never
  called `findGlossaryTermsInText`; the dictionary reached only translation, proof-read and
  poster copy. Every name guarantee in the Marathi article was prompt text
  (`category-prompt.ts` rule 3), never a check. This is the first feature to cross that line.
  (2) **`glossary_terms` already modelled the pieces**: `term_type` includes `designation` and
  0010 seeds the common titles verified (मुख्यमंत्री → Chief Minister, जिल्हाधिकारी → District
  Collector). Persons are deliberately unseeded because office-holders are volatile — so what
  was missing is exactly the volatile part, the LINK, which belongs on the person row plus a
  per-run review rather than in seed data.
  (3) **The faithfulness pass would have deleted the feature.** `findUnsupportedClaims` treats a
  पदनाम absent from the note as an unsupported claim, and an officer-approved designation is by
  definition absent from the note. Without an explicit allow-block the pipeline inserts the
  designation and then buys a repair call to strip it again — worse on the FEEDBACK path, where
  `reviseArticle` is handed a stored article that already carries it. Hence
  `DESIGNATION_ALLOWED_RULE`, which must reach `findUnsupportedClaims`,
  `buildCoverageRevisionMessages` and all three revise-article builders (two of whose rules —
  "no new पदनाम" and "do not add officials' designations" — fight it directly).
  **The design's payoff: translation needed ZERO engine changes.** The designation is inserted
  into the MARATHI article and both targets inherit it, because the title's English/Hindi live
  on its OWN `designation`-typed glossary row: English's `LOCKED TERMS` table already locks
  `मुख्यमंत्री → Chief Minister`, and Hindi freezes `person` rows verbatim while deliberately
  translating `designation` rows (जिल्हाधिकारी → जिलाधिकारी, which is correct). That is why the
  write-back **must** ensure the title row exists (`designation-writeback.ts`) — skipping it is
  the one thing that would silently break the English output. The person row is patched in place
  by a new `setPersonDesignation`, never `upsertGlossaryTerm`, which is create-or-REPLACE and
  would overwrite a human-reviewed English spelling; a person the dictionary has never met is
  inserted UNVERIFIED, because the officer confirmed the पदनाम, not the spelling — the
  pre-translation name check still owns that.
  **UX** (the user's stated priority): a review card BEFORE any spend, never a post-hoc report.
  `POST /api/designations/prepare` reuses the pre-translation name check's merge
  (`prepareTranslationTerms` refactored to share `mergeTextTerms`) filtered to `person`, so
  there is one detector and two questions rather than a second extractor. `DesignationReview`
  renders one row per person with a `<datalist>` of the dictionary's verified titles — picking
  over typing is what keeps मुख्यमंत्री spelled one way across every officer — plus an opt-in
  **"यापुढेही हेच वापरा"**, because someone named in a one-off capacity should not rewrite their
  permanent entry. `/dlo` shows it in the middle step beside Pointers; the media room, which
  submits in one press, runs it as a submit-time gate that **auto-skips when the text names
  nobody**, so the check is invisible when there is nothing to check. A blank पदनाम is a valid
  answer meaning "print this name bare" — nothing is ever inferred from the note.
  **The guarantee** is `apply-designations.ts`, following lock-scheme-names.ts's doctrine: only
  ever inserts an officer-approved string or replaces one dictionary title with another, never
  touches digits or prose. First mention only (Marathi news style); **honorific-aware** —
  `श्री. देवेंद्र फडणवीस` becomes `मुख्यमंत्री श्री. देवेंद्र फडणवीस`, never `श्री. मुख्यमंत्री …`; pairs
  processed longest-name-first with substrings dropped; and a bare surname is deliberately NOT
  matched, because two people can share one — that case is REPORTED, not guessed. It runs
  **after `generateFactCheck`** in both `generateArticle` and `reviseArticle`: the appendix
  traces the article against the note, so computing it first is what stops a false
  `(टिपणीत आधार नाही)` line with no change to `generateFactCheck`. The media room's
  `articleProvided` branch (which skips generation entirely — that page posterizes a pasted
  article) applies the same pass to the pasted text. Failures surface as `designationWarnings`,
  an in-process registry beside `translateWarnings`, rendered on `ArticleView`.
  Both migrations are written omit-unless-present (`newTermToDbRow`, `insertGeneration`), so an
  un-applied one disables the feature rather than failing every glossary add or every create —
  **verified live against a database with neither applied**: the prepare route returned both
  people with `designation: ''` and the 8 verified title rows, rather than erroring.
  Verified 2026-07-25: full workspace typecheck green (7/7); lint clean on all 21 touched files;
  20 offline assertions in the `apply-designations` harness (first-mention-only, already-present
  no-double-prefix, wrong-title correction, honorific incl. two stacked honorifics, surname-only
  ⇒ not-found, substring safety, two people with digits intact, empty ⇒ byte-identical); and a
  live API run — route registered, all three guard paths 400 **before** any model call, and a
  real Marathi note returning both `देवेंद्र फडणवीस` and `अमित देशमुख` with
  `मुख्यमंत्री → Chief Minister` among the known titles. **Left for a real run** (needs the
  migrations applied + OpenAI spend): the end-to-end /dlo check that the first mention publishes
  as `मुख्यमंत्री देवेंद्र फडणवीस`, survives the coverage and faithfulness passes, survives an
  article-feedback revision, and translates to _Chief Minister Devendra Fadnavis_ / Hindi with
  no code change. **Deploy: 0032 + 0033 → API → web** (rebuild `@dgipr/schemas`,
  `@dgipr/database`, `@dgipr/content-engine` dists first). No n8n.

- **Export the article as a PDF** (2026-07-25, no migration): a finished article could be
  copied or downloaded as `.txt` — neither of which a department can circulate. Both the
  `/dlo` output step and the detail page's `ArticleView` now offer **PDF डाउनलोड**, producing
  an A4 document with the DGIPR letterhead, the run's optional `heading` as a title, a date
  line, and the article as justified paragraphs.
  **The whole design turns on one constraint: only Chromium shapes Devanagari.** jsPDF and
  pdf-lib place glyphs but run no Indic shaper, so क्ती / ऱ्या / विद्यार्थ्यांच्या come out
  decomposed with matras floating off their consonants — precisely the failure the HTML
  poster path was built to avoid ("Chromium is what makes the Devanagari correct",
  `render-html.ts`). An html2canvas-style rasterisation would look right but ship a picture
  of text: unselectable, unsearchable, and megabytes per page. So the PDF is printed
  **server-side** by the same Playwright driver the posters use, with `page.pdf()` in place
  of `page.screenshot()`, and the text stays vector.
  New in `@dgipr/poster-renderer` (the package boundary put it there — it already owns the
  webfont, the brand assets, every self-contained HTML template and the only Chromium in the
  repo; no LLM call is involved, so content-engine is not): `article-pdf-template.ts`,
  `generate-article-pdf.ts`, `loadArticlePdfAssets()`, and `renderHtmlToPdf` +
  `ChromiumUnavailableError` + a shared `launchChromium()` in `render-html.ts`. The route is
  `GET /api/generations/:id/article.pdf?lang=mr|en|hi`, beside the `poster.png` proxy.
  Decisions worth keeping:
  - **The letterhead is an ordinary block in normal flow**, not `displayHeaderFooter` — which
    is what puts it on page 1 only (the press-note convention) and avoids that API's separate
    render context, which does not inherit the `@font-face` and would need the 647 KB font
    data URI duplicated into it for a Devanagari running header.
  - **Its wording is sourced, not coined**: `assets/poster-footer.png` reads
    "माहिती व जनसंपर्क महासंचालनालय, महाराष्ट्र शासन", byte-identical to the web's
    `appSubtitle`; it is split across two lines. The emblem is `poster-logo-new.png`
    (398×400, no baked-in wordmark) at 21 mm — ~5× oversampled, while every line beside it
    stays Chromium-typeset vector. It stays **Marathi in all three languages**; only the date
    line follows the body.
  - **The guard is the article TEXT, not `row.status`.** The article is final long before the
    poster is (`ArticleView` is on screen while the poster still renders — the reason
    `translating`/`articleRevising` live off status), so a `status === 'completed'` check
    would have broken the main case. A `failed` row that did produce an article can still be
    exported: the officer keeps work already paid for. Social runs are refused through
    `isSocialCategory()` — their `article` column holds the caption.
  - **GET, so the web side is a plain `<a href>`** with no JavaScript. `content-disposition`
    is the only way to force a cross-origin download (the reason already documented on
    `poster.png`), and because the route is a real navigation its error bodies are what the
    officer _sees_ — hence Marathi, unlike the fetch-backed routes.
  - **`A4_MARGIN` is one constant with three consumers** (`page.pdf()`, the template's
    `@page` block, the harness's `--png` padding), so a browser Ctrl+P preview cannot drift
    from the printed output.
  - Dates pin `timeZone: 'Asia/Kolkata'` (the container is UTC — a 01:30 IST run would
    otherwise be dated the previous day; proven on a real row created 20:39 UTC that
    correctly prints २५ जुलै) and Hindi pins `hi-IN-u-nu-deva`, because `hi-IN` alone
    resolves Latin digits beside a body Sarvam translated with `numerals_format: native`.
    Free harness `pdf:preview` (built-in Marathi sample, `--html`, `--png`) — build the layout
    there before touching the route; it costs nothing.
    Verified 2026-07-25: typecheck green 7/7, lint clean on every touched file. Offline — all
    hard conjuncts shape correctly (कर्जमुक्ती ऱ्या महाराष्ट्र विद्यार्थ्यांच्या ज्ञानज्योती हृदयरोग श्री),
    Devanagari digits in the date line, the double rule renders, a 4-page article puts the
    letterhead on page 1 and starts pages 2-4 straight into the body, English renders with no
    tofu (the embedded font carries 551 codepoints incl. all of Basic Latin), and a text layer
    is present on every page at ~350 KB — vector, not raster. Live API — 200 with correct
    `content-type`/`content-disposition`/`no-store` on a real completed run in both मराठी and
    English, plus every guard: bad lang 400, unknown id 404, twitter 400, **facebook 400**
    (proving `isSocialCategory()` rather than `=== 'twitter'`), untranslated Hindi 404.
    **The one genuinely new operational fact: the API image now ships Chromium**
    (`deploy/api.Dockerfile`, which deliberately excluded it) — ~400-500 MB larger, ~200-300 MB
    peak RSS per export; check the box's memory headroom, it also runs n8n. If that layer is
    ever missing the route returns a Marathi 503 rather than crashing, and no env flag gates it
    (a declaration can disagree with reality; the catch cannot — the "params are LEARNED, not
    declared" reasoning). **Expected, not a defect:** Chromium writes Marathi into the text
    layer in visual order, so `probePdf` may call an exported article `garbled`; appearance and
    print are unaffected. No migration, no n8n; deploy is API + web (rebuild
    `@dgipr/poster-renderer` dist first).

- **DLO approved facts become the article contract, with attributed statements**
  (2026-07-25, migration 0034): the Pointers call now returns both its existing 5W1H
  groups and up to 12 explicitly attributed statements
  (`{ speaker, designation, venue, claim }`). `/dlo` shows both as checked-by-default
  rows and persists the kept inventory on the generation as `selected_facts` plus
  `statements`; each selected fact is stored as `{ dimension, text }`, not a flat string,
  because preserving the already-approved 5W1H dimension is what removes the redundant
  `extract_5w1h` model call without guessing. Empty/absent fields retain the legacy path,
  so media-room and other non-DLO generations keep the old raw-note pipeline.
  On this DLO path, `generateArticle` builds `FiveWOneH` in code, skips the editorial
  brief's second tier-audit call, and replaces the three raw-note coverage graders
  (tiered missing + citizen missing + overweight) with one bounded
  `findMissingApprovedFacts` call over the selected checklist, statements and optional
  brief. Drafting and every coverage/faithfulness/feedback repair receives the same
  REQUIRED_FACTS and ATTRIBUTED_STATEMENTS blocks; statement speaker/claim links are
  therefore preserved through article feedback, while blank designation/venue fields
  are never inferred. Feedback revisions also re-read `excluded_facts`, closing the old
  path where a deliberately dropped pointer could return after revision.
  Style support is conditional on statements: an attribution paragraph is appended to
  the otherwise unchanged 1,500-character exemplar slice, and retrieval lightly boosts
  attribution-shaped news/scheme references only for such runs. `fact_check` is now a
  real progress phase instead of leaving the UI frozen on faithfulness during the
  traceability call. The designation-duplication and poster-name-lock proposals from the
  source plan were deliberately NOT implemented. Verified free: shared-package rebuilds,
  full workspace typecheck 7/7, touched-file lint clean, selected-fact schema/default
  compatibility checks, and deterministic 5W1H assembly. Root lint still reports only
  the pre-existing `content-engine/src/intake/text-file.ts` irregular-whitespace error
  (plus two poster-template warnings). Deploy: 0034 → API → web; no n8n.

- **Realistic explainer videos: start+end frame interpolation, fixed 8s scenes, and a
  clip-provider seam** (2026-07-26, no migration — SUPERSEDES the illustrated single-still
  flow in the video milestones above): the user wanted real-looking footage, not flat-2D
  animation, with BOTH the first and last frame of every scene generated by the OpenAI
  image model and reviewed at gate 2 exactly like the old single still — Veo then
  interpolates between them (`instances[0].lastFrame` on `predictLongRunning`). Audio flow
  untouched. The design facts that shaped it:
  (1) **Veo only interpolates at 8s** — 4s/6s with a `lastFrame` return INVALID_ARGUMENT —
  so every new scene is pinned to `VIDEO_INTERPOLATION_SECONDS = 8` (schemas) and the
  measured-window fit from the 2026-07-23 overhaul is RETIRED on this path: the planner no
  longer picks durations, the script writer FILLS the window (~36 words/scene) instead of
  the window shrinking to the narration, and `VIDEO_NARRATION_CHARS_PER_SECOND` is unread.
  Veo spend is therefore ~2× the fitted-window flow (8s × scenes × tier; the user accepted
  the trade). WINDOW FREEZE still protects legacy 4s/6s clips.
  (2) **The end frame is EDITED from the start frame, never generated fresh** — the new
  `editImage` in `packages/poster-renderer/src/openai-image.ts` (multipart
  `/v1/images/edits`, the endpoint the poster workflows already use) with
  `buildEndFramePrompt` ("same location, same people, same light, a few seconds later").
  A fresh generation of "the end state" lands in a different room with different people,
  and the interpolation reads as a crossfade instead of motion. Consequence: a START
  redraw always regenerates the PAIR (the end derives from the start), while an END
  redraw is one edit call — `frame: 'start'|'end'` on the still route/schema, two redraw
  affordances per scene card.
  (3) **Realism replaced illustration outright** (user's explicit call: "the more real,
  the better") — REALISM_RULE in both frame prompts, the script's `style` rule rewritten
  to cinematic documentary realism, `photorealistic faces` and `close-up face` REMOVED
  from `VEO_NEGATIVE_PROMPT` (they fight realism; anti-cartoon/CGI terms added). The ONE
  people-rule kept is no-talking/no-lip-movement — a quality rule (Veo's lip glitching was
  the worst artifact in real renders; narration carries the words), not a policy rule.
  (4) **`lastFrame` gets the learned-params treatment twice** (veo-client.ts): the field's
  JSON encoding is ambiguous in the wild (our working `image` uses `bytesBase64Encoded`,
  docs show `inlineData`) so the shape is learned per model — bytes first, inline retried
  on a 400 naming the field, cached; and a model rejecting the field outright (the lite
  preview cannot interpolate) is cached in `modelsRejectingLastFrame` and rendered
  start-frame-only with a warning, never failed. `lite` is dropped from the web tier
  picker (its reviewed end frames would be ignored) but stays in the schema for legacy
  rows.
  (5) **The Kling seam** (`packages/content-engine/src/video/clip-provider.ts`): the
  runner now calls a neutral `renderClip({prompt, startFramePng, endFramePng?, aspectRatio,
durationSeconds, tier, negativePrompt?})` dispatched on `VIDEO_CLIP_PROVIDER` (default
  `veo`). Kling's image-to-video API takes the same inputs (start image + `image_tail`),
  so adding it is one adapter branch + one env line with no runner change. Deliberately
  thin — no capability tables; per-provider quirks live inside each client, learned from
  its API (the veo-client doctrine).
  (6) **Clip staleness keys on BOTH frames**: scenes jsonb gained `endVisualBrief`/
  `endStillPath`/`endStillVersion`/`clipEndStillVersion` (no migration), `clipIsCurrent`
  requires `clipEndStillVersion === endStillVersion` when an end frame exists, the animate
  guard blocks a scene whose DECLARED end frame is unrendered, and a legacy scene with no
  end frame animates first-frame-only everywhere (re-animate on old projects keeps
  working). Script save's keep-frames branch requires BOTH briefs unchanged.
  Verified 2026-07-26: dists rebuilt, typecheck 7/7 green, lint clean on all touched
  files; the script harness on a real MRI note returned 4 scenes, every one with an
  `end_visual_brief` explicitly continuing its shot ("The same tracking shot ends at…"),
  all 8s, realistic style paragraph, facts intact (२५-३०, ६० टक्के). Frame-pair harness +
  the ~$1.20 two-frame Veo CLI run: see the session notes — the lastFrame SHAPE is the one
  live unknown, and the ladder logs which variant a model accepted. Deploy: API + web
  after rebuilding `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine` →
  `@dgipr/poster-renderer` dists; no migration, no n8n. New env (optional):
  `VIDEO_CLIP_PROVIDER`.

- **Silent Veo, Nano Banana frames, and a narration budget that matches the voice**
  (2026-07-26, no migration — SUPERSEDES the frame-generation and narration-budget halves
  of the 2026-07-26 interpolation milestone above): a real run died at scene 3 with
  _"Veo blocked this render: We encountered an issue with the **audio** for your prompt …
  safety filters"_. Four independent problems, of which the reported error was the smallest.
  (1) **Veo was generating audio we throw away.** Veo 3.x synthesizes native audio unless
  told otherwise, and `startVeoOperation` never sent `generateAudio: false` — while
  `assembleSilentVideo` strips the track (`-an`) and `muxNarration` lays the Sarvam Marathi
  voiceover over it. So every clip paid for and waited on audio that was discarded, AND ran
  Google's **audio** safety filter, which can fail an otherwise-good render after the whole
  multi-minute wait. Asking for silence deletes the entire failure class. On the learned-param
  ladder (`modelsRejectingGenerateAudio`), like every other Veo field. `resolution` joined the
  same ladder — **1080p by default** (`VEO_RESOLUTION`), which is free because Veo bills per
  SECOND not per pixel, falling back to the model default on a 400 (vertical 9:16 is 720p-only
  on some previews).
  (2) **The narration budget was ~2x wrong, and had been silently TRUNCATING scenes.**
  `DEFAULT_NARRATION_CHARS_PER_SECOND = 32` and `NARRATION_WORDS_PER_SECOND = 4.5` were both
  guesses. Measured against the real voice (4 lines, 72-195 chars, `shubh` on bulbul:v3):
  **16.5 chars/s and 2.29 words/s**. So the old 280-char cap was not "8.75s in an 8s window"
  as its comment claimed — it was **~17 SECONDS** of speech in an 8s clip. `muxNarration`'s
  atempo caps at 2.0, so the surplus was never sped up; it was **hard-trimmed**, cutting words
  off the end of scenes. Every constant is now derived from the measured rate
  (`VIDEO_NARRATION_TARGET_SECONDS` 7.2 → `TARGET_CHARS` 119 / `TARGET_WORDS` 17;
  `MAX_CHARS` 132 is the clip's worth of speech and is a schema CEILING, deliberately above
  the target — the two are different jobs, and failing usable narration on ordinary variation
  would just burn repair rounds). `NARRATION_WORDS_PER_SECOND` **moved into `@dgipr/schemas`**
  because the PLANNER and the WRITER must work to one number; they had drifted, so the planner
  packed beats the writer could not narrate in time.
  (3) **Fitting is now measure-then-shorten, never speed-up.** The window cannot grow (Veo
  interpolates at 8s only), so the text is the only thing that can move.
  `ensureNarrationAudio` synthesizes, MEASURES the WAV, and past
  `VIDEO_NARRATION_FIT_SECONDS` (7.6) rewrites that one line via the new
  `video/shorten-narration.ts` and re-synthesizes — bounded at 2 attempts, at the TOP of the
  storyboard job, so a rewrite costs cents and never a paid render. The rewritten text is
  persisted, so the SRT, the gate-2 card and the audio always agree. `muxNarration` keeps
  atempo only as a backstop, engaging past `VIDEO_NARRATION_TEMPO_TOLERANCE` (1.02) **with a
  warning** — if that warning ever appears the budget is wrong for the voice, and the fix is
  upstream. Two traps found while building it, both now encoded: capping the shortener's
  output at `MAX_CHARS` made it return **null** on a 195→153 improvement, leaving the ORIGINAL
  long line in place (a best-effort step must not be a gate — the only hard rule, "strictly
  shorter", is checked in code); and **prompts demanding total coverage fight the budget** —
  the planner literally ordered all four hospital names into one beat. Per the tiered-
  completeness principle, all three prompts now rank what to keep (core point →
  citizen-actionable detail → the rest) and say plainly that OMITTING a fact beats stating it
  vaguely or by half. Never-invent stays absolute, and anything retained stays verbatim.
  Measured effect on the real MRI note: **8 scenes instead of 4**, the four hospital names
  given their own scene, every narration 3.8-6.9s in an 8s clip, **zero** triggering the
  shortener; the adversarial single-line test went 195 → 78 chars in one pass with ₹2 लाख and
  the deadline intact.
  (4) **Frames now render through a provider seam, Nano Banana by default.**
  `video/frame-provider.ts` mirrors `clip-provider.ts` (`VIDEO_IMAGE_PROVIDER=gemini|openai`,
  default gemini) over the new `video/gemini-image-client.ts` (raw REST through the existing
  `geminiFetch`; `GEMINI_IMAGE_MODEL`, default `gemini-3-pro-image-preview`). The seam takes
  an **aspect, not a pixel size** — that is the load-bearing difference: a size is an OpenAI
  concept, and gpt-image's 3:2 output had to be centre-cropped to 16:9, discarding pixels and
  re-framing a shot the model composed. Gemini takes `imageConfig.aspectRatio` natively
  (learned-param ladder if a model id rejects it), and `cropToAspect` survives only as a
  normaliser. ONE `:generateContent` endpoint serves both halves — text-only generates the
  START frame, text+image EDITS it into the END frame — and holding location/people/light
  across that edit is the capability the whole start+end pair depends on. Cost is metered by
  each adapter (`recordGeminiImageCost`, flat per-image row in `pricing.ts`), the rule
  `clip-provider.ts` already stated. Poster paths are untouched.
  Also closed: `startStoryboardJob` keyed off `status`, and the ANIMATE job sets `failed` too —
  so pressing स्टोरीबोर्ड after a Veo failure silently re-bought two image calls per scene to
  redraw frames that were sitting in storage. It now gates on `framesArePresent`.
  TTS quality: `shubh` (bulbul:v3's own default voice) replaces `ritu`, `speech_sample_rate`
  44100 (what `muxNarration` resamples to anyway, so an upsample disappears), `temperature`
  0.5, AAC 192k. `pitch`/`loudness`/`enable_preprocessing` are v2-only and deliberately never
  sent.
  Verified 2026-07-26: typecheck 7/7 green, lint clean on all touched files; live TTS
  calibration (above); live Nano Banana generate **and** edit — 1376x768 natively, and the
  edited frame held the same building, sun flare, taxi and people, moved forward; live
  shortener on both prompt versions; a full 8-scene script measured line-by-line against the
  budget. **Left for a real run** (Veo spend): that `generateAudio:false` is accepted and the
  returned MP4 carries no audio stream, and that 1080p lands. New env, all optional:
  `VIDEO_IMAGE_PROVIDER`, `GEMINI_IMAGE_MODEL`, `VEO_RESOLUTION`, `SARVAM_TTS_SAMPLE_RATE`,
  `SARVAM_TTS_TEMPERATURE`. Rollback is env-only. No migration, no n8n; deploy is API + web
  after rebuilding `@dgipr/schemas` → `@dgipr/poster-renderer` → `@dgipr/content-engine` dists.

- **The video frames are Maharashtra's, and they carry information** (2026-07-26, no
  migration): a real run came back with a **blonde Western woman** in a Maharashtra
  government explainer, and the officer's verdict on the videos generally was that one
  "just exists for the sake of it" — the footage was mood B-roll while every fact rode on
  the voiceover. Two complaints, and the first one had an embarrassing cause: **nothing in
  the pipeline had ever named a country.** Grepping the whole video path for
  `Maharashtra|India|Indian|locale|cast` returned ZERO hits. The complete text reaching
  Nano Banana was the LLM-authored `style` paragraph (whose spec asked only for
  "lens/framing, colour palette"), the `visual_brief`, the `shotHint`, and four hardcoded
  English rules that said `'a government explainer video'` with no country. The Marathi
  persona lines in the authoring prompts never reach the image model. The poster path had
  been doing this correctly since it was written (`'Government of Maharashtra
public-information poster'`, `'authentic skin, fabric and material textures'` in
  `build-scene-prompt.ts`); the video path had simply never borrowed it.
  Four changes, in the order they matter:
  - **`SETTING_RULE` is hard-appended in code** to all three prompt builders
    (`video-prompts.ts`), like `NO_TEXT_RULE` and for the same reason: an instructed rule
    can be dropped by whichever model authors the brief, a code-appended one cannot. It
    names Maharashtra/India, Indian faces and skin tones, clothing as actually worn
    (saree, salwar kameez, kurta, shirt-and-trousers, uniforms), Indian streets/interiors/
    government offices, and rules out Western and East Asian people and places. The
    instructed layers were fixed to stop fighting it — the planner's `shot_hint` examples,
    the `visual_brief` spec, and the `style` spec, which must now state the setting (cap
    600 → `VIDEO_STYLE_MAX_CHARS` 1200 to fit look + setting). `VEO_NEGATIVE_PROMPT` gained
    `Western setting, European or American architecture` — **setting terms only**; the
    people are specified positively, which is the safer half of that instruction to give a
    model. Also fixed in passing: the script writer's persona line still called these
    `ॲनिमेटेड व्हिडिओ`, a leftover contradicting the realism rework two rules below it.
  - **`NO_TEXT_RULE` was rewritten as a POSITIVE instruction**, which is the
    non-obvious finding of this session. A bare "no text" **contradicts the scene**: an
    office counter has forms on it and a hospital corridor has a door plate, so the model
    paints them anyway and fills them with gibberish — a live render produced a wall sign
    reading **`मरी रूटूम`**, which is not a word. The rule now says what to show instead
    (signboards and door plates are plain painted panels; forms, receipts and files are
    unprinted blank sheets; screens are switched off) and is emitted as its own final
    block rather than tacked onto a paragraph, last position being what these models weight
    most. Re-rendered live: the door plate came back blank, the clipboard blank, the
    handed-over receipt a blank ruled form. The end-frame prompt additionally says _remove
    any writing already visible_ — an edit prompt silent about text faithfully preserves
    whatever the generator slipped in. The planner is now told never to plan a shot whose
    SUBJECT is writing ("push-in toward the sign", "pan across the displayed charges" —
    both real outputs), and never a **montage** (a scene is one interpolated shot; a cut is
    technically impossible), and to give each scene a location suited to its OWN fact so a
    four-fact video does not happen in one room.
  - **Scene 1's approved frame is attached to scenes 2..N as a world reference**
    (`loadWorldReference` → `FrameRenderInput.referenceFramePng` →
    `GeminiImageInput.referenceImagePng`, a second inline part). Every start frame used to
    be an independent text-to-image call, so a four-scene video could be four unrelated
    worlds; an image pins what a paragraph cannot. It is passed ONLY on a fresh generation,
    never on an end-frame EDIT — two inline images plus "edit this" leaves the model
    guessing which is which, and the client now throws rather than send both. Best-effort
    at every step (scene 1 has no reference, a lone redraw may find none, a download may
    fail) and the `openai` branch drops it entirely, `editImage` taking one buffer.
    Verified live: scene 2 kept the palette, film look and Indian setting while correctly
    NOT copying scene 1's location.
  - **On-screen Marathi key points, burned in after Veo** — the answer to "the video
    doesn't convey information". This is the poster doctrine applied to video for the first
    time: the model paints text-free and **Chromium typesets the Devanagari**
    (`poster-renderer/src/video/caption-overlay.ts` → `renderHtmlToPng` with a new
    `transparent` option → `omitBackground`). The overlay is composited by ffmpeg INSIDE
    the stitch's existing encode (`assembleSilentVideo(clips, overlays)` — one encode, not
    two, and byte-for-byte the old behaviour when omitted), before `muxNarration`, which
    copies the video stream and needed no change. **No image or video model ever sees the
    text**, so `NO_TEXT_RULE` does not relax. The script writer proposes a `key_point` per
    scene (≤`VIDEO_KEY_POINT_MAX_CHARS` 48) and a **deterministic digit guard** decides:
    every digit run must occur in the note, compared in ONE script so `31` is accepted
    against a note that wrote `३१`. Failure DROPS the key point (that scene loses its
    overlay), never fails the run — `shorten-narration.ts`'s rule that a best-effort step
    must not become a gate. Timings come from `sceneTimings`, the same function the SRT is
    built from, so caption, cue and footage cannot disagree.
    Plus the escape hatch: **`style` is editable at gate 1** (`UpdateVideoScriptRequestSchema`
    gained it; no migration, `video_projects.style` is an existing column). It was previously
    written once by the LLM and neither shown nor editable, so a wrong setting could only be
    escaped by regenerating the whole script. Changing it **skips the keep-frames branch and
    sends every scene back to `pending`** — it is an input to every frame prompt, and the
    route also accepts `storyboard_ready`, where frames exist. `keyPoint` is deliberately NOT
    in that staleness test: it is burned on at stitch time and no frame is rendered from it,
    so editing one must never discard a paid frame.
    Verified 2026-07-26: typecheck 7/7 green, lint clean on every touched file; 22 offline
    prompt assertions (`tsx src/video/video-prompts.ts` — setting/no-writing/no-talking/style
    present in all three prompts, the reference clause present ONLY with a reference) and 9
    key-point guard assertions (`tsx src/video/generate-video-script.ts --check`); the free
    caption harness (`video:preview:captions`) rendering `कर्जमुक्ती`/`रुग्णालयांत` with correct
    conjuncts and burning them onto light/dark/light stub clips in their own windows; a live
    script run on a real MRI note whose `style` named Maharashtra, whose every
    `end_visual_brief` advanced the ACTION rather than the camera, and whose four key points
    were all note-grounded; and three live Nano Banana frames before and after the no-text
    rewrite. **Left for a real run** (Veo spend): the burned-in caption on genuinely animated
    footage. New harness: `pnpm --filter @dgipr/poster-renderer video:preview:captions`.
    No migration, no n8n; deploy is API + web after rebuilding `@dgipr/schemas` →
    `@dgipr/database` → `@dgipr/poster-renderer` → `@dgipr/content-engine` dists.

- **Continuous video narration across visual cuts** (2026-07-30, no migration): the
  scene-by-scene script/TTS shape made every cut sound like a fresh paragraph: even though
  `generate-video-script.ts` used one chat call, it asked for isolated scene narrations, then
  `video-runner.ts` made one Sarvam WAV per scene and `muxNarration` silence-padded each WAV
  to its clip window. The narration is now the video's single spine. The planner still
  chooses the visual sequence, but it must choose enough scenes to hold the selected 30/60
  seconds and a deterministic timeline (for example 8/8/7/7) is attached to the plan. The
  script writer sees every scene's duration and is explicitly told to compose ONE continuous
  Marathi passage first, then split it only at visual cuts; sentences may bridge cuts, and
  the coverage judge receives adjacent narration context so it does not "repair" a natural
  hand-off into a mini-script. The overrun repair likewise shortens all scene slices in one
  continuity-aware call. At the voice phase, every reviewed slice is joined with one space,
  sent to Sarvam in ONE TTS call, uploaded once as `projects/{id}/narration-v{n}.wav`, and the
  same path/full-script/voice staleness key is repeated in the existing scenes jsonb (so no
  column or migration). Whole-second clip windows stay proportional to the planned timeline
  and extend only when the measured WAV needs it. Stitching detects the shared path and calls
  the existing `muxNarration` with ONE segment spanning the complete video, so there is no
  inter-scene padding, silence or voice/cadence restart; legacy rows with distinct per-scene
  WAV paths retain the old assembly branch. A continuous TTS failure remains non-fatal and
  renders silent with planned timing; completed legacy videos can be re-narrated into the new
  shared track without re-rendering paid clips. Gate 1 now explains that the boxes form one
  uninterrupted narration and displays the exact planned visual windows the writer saw.
  Verified: workspace typecheck 7/7 green; targeted lint/format green; the free key-point
  harness passes all 9 assertions; deterministic allocation cases cover 30s, 60s, extension
  and provider-cap clamping. Full repo lint remains blocked by the pre-existing irregular
  whitespace in `packages/content-engine/src/intake/text-file.ts:15`. Deploy: rebuild
  `@dgipr/schemas` then `@dgipr/content-engine`, deploy API + web; no n8n.

- **The /dlo page picker: grid always open, and the OCR wait made optional** (2026-07-26, no
  migration): attaching a scanned PDF on `/dlo` made the officer wait twice. The picker's chip
  grid was folded behind a `पृष्ठे निवडा` / `पृष्ठे लपवा` toggle even though on that screen the grid
  IS the control (there is nothing else on the card — a document nobody has read has no text to
  show), and the only way forward was `निवडलेली पृष्ठे वाचा`, which ran Sarvam OCR synchronously in
  the browser card — minutes of spinner — before `पुढे जा →` could even be pressed, which then
  started the intake job and waited again for the audio.
  (1) **`collapsible` on `PageRangeSelector`.** `DocumentPages` passes `collapsible={false}` on
  the `!pages` branch only, so the grid is permanently open wherever it is the picker — on all
  four surfaces, per the "upload looks identical everywhere" rule — while an already-READ
  document keeps its fold, the rows below it being the visual list and the selector a shortcut
  over them. `defaultExpanded`, `docRangeExpand`/`docRangeCollapse` all stay, still used there.
  (2) **`allowDeferredRead` on `<DocumentIntake>`** adds **`न वाचता ही पृष्ठे वापरा`**, the primary
  button on that card, with `निवडलेली पृष्ठे वाचा` demoted beside it. **Only `/dlo` may pass it**,
  and the reason is the whole design: it is the one upload surface with a job of its own
  downstream. Everywhere else the text has to exist in the browser now, so a selection with no
  text would simply be a lost upload.
  The mechanism reuses what was already there rather than adding a path. The snapshot gains
  `pendingPages` (and carries no `pages` — a deferred document has no text, only a choice), the
  create request sends the same field on `DloPreReadDocumentSchema`, the route stores an ordinary
  `status: 'pending'` entry carrying it, and the intake job's extract phase branches to
  `extractPdfEntry(entry, entry.pendingPages)` instead of `probePdfEntry` — the same call
  `startDloExtractionJob` has always made, so page identity, the ≤10-page chunking and the
  `source: 'auto'` text-layer-first policy all come along unchanged. `files` is jsonb, so
  **no migration**; and because the entry lands as a normal read PDF, `DloSourceReview`,
  `assembleDloText`, `canReextract`, the per-file OCR re-read and `/:id/generate` needed **no
  changes at all**.
  **The spend gate is untouched** — the pages are still chosen before anything is billed; only
  the WAIT moved, into a job the run was going to sit through anyway. Two things worth keeping:
  the archived original is **load-bearing here rather than a convenience** (a deferred document
  has no text to fall back on, so an expired ephemeral job means the route stores that file
  `failed` with an actionable Marathi message instead of dropping a whole source silently), and
  the extract loop now skips `'failed'` entries as well as `'done'` ones — that status can only
  have come from the route, and re-probing would fail again with a worse message.
  **Amended 2026-07-27:** deferral is now the default rather than an opt-in button. While the
  server job is genuinely in `status: 'selecting'`, the ticked pages themselves are the live
  `pendingPages` handover; **`न वाचता ही पृष्ठे वापरा` is gone**. `निवडलेली पृष्ठे वाचा` stays
  secondary for read-now and becomes primary when re-picking an already-read scan, so paid text
  is never silently discarded and re-OCR'd.
  Verified 2026-07-26, all free — typecheck 7/7 green, lint clean on all nine touched files
  (prettier's complaints on six of them are pre-existing at HEAD, confirmed per file); a live API
  E2E driving a **born-digital** PDF through the deferred path, which exercises schema → route →
  archive → job branch → page identity → review payload with the text layer and therefore no
  Sarvam spend (pages 2 and 5 came back numbered 2 and 5 with their own markers, nothing leaked
  from 1/3/4/6, `canReextract: true`, combined text correct), plus the lost-bytes guard (that file
  `failed` in Marathi, the intake still `ready`, notes intact) and a pre-read document proving the
  job still leaves it alone; 19 browser assertions (grid open with 20 chips and no toggle the
  instant a scan is attached, `२-४, ९` → `2-4, 9` selecting 4 chips, the new button primary and
  `निवडलेली पृष्ठे वाचा` not, the deferral card echoing `2-4, 9` with no OCR spinner, `पृष्ठ निवड बदला`
  restoring the selection, and `/translate` getting the open grid but never the deferral); and the
  submitted create payload intercepted to confirm it carries `pendingPages: [3,7,8]` with no text,
  no `pages` and no re-uploaded bytes. **Left for a real run** (Sarvam spend): a genuinely scanned
  PDF deferred from `/dlo`, to confirm one N-page OCR job for an N-page pick — the same open gap
  the shared-intake milestone already carries. No migration, no n8n; deploy is API + web after
  rebuilding `@dgipr/schemas` + `@dgipr/database` dists.

- **Kling 3.0 renders the video clips; frames stay on Gemini** (2026-07-26, no migration):
  `/video`'s clip step moves from Google Veo 3.1 to **Kling 3.0 on the official
  `api-singapore.klingai.com` API** — not a reseller — with **native audio off** and **720p**
  output. Only the CLIP step moves: `VIDEO_IMAGE_PROVIDER` is untouched, so the storyboard
  frames are still Nano Banana, and Kling is used for video only.
  The swap itself was cheap, because `clip-provider.ts` had been built for it: one branch, one
  env line, and `renderSceneClip` in `apps/api/src/jobs/video-runner.ts` — the seam's only
  production caller — did not change. `ClipRenderInput` did not change either. Kling accepts
  3-15s, so the fixed **8s window is kept**: it stays legal, and moving it would have dragged
  the measured narration budget (7.2s target / 119 chars), the SRT builder, the burned-in
  caption windows and `clipIsCurrent`'s staleness rule along with it for no requirement.
  What was NOT cheap was everything around the swap, and the biggest item was not the API at
  all:
  (1) **The burned-in Marathi captions silently vanished at 720p.** `CAPTION_FRAME_SIZE`
  typesets the overlay at a hardcoded 1080p and `assembleSilentVideo` composited it with
  `overlay=0:0` and no scaling — fine while one provider returned one size. On a 1280x720
  Kling clip the lower-third panel sits below the bottom edge, so the key point is cropped away
  entirely, with **no ffmpeg error and no log line**. Measured on a real stitch: 0.00% panel
  pixels in the lower third with the old filter, 14.7% after. The fix is a `scale2ref` pair per
  overlay (`[ov][stage]scale2ref` then `overlay=0:0`), whose default `w=iw:h=ih` resolves
  against the REFERENCE input — so no footage size is written down anywhere and it is provably
  a no-op at 1080p. `caption-overlay.ts`'s 1080p is now documented as a _reference_ size, which
  is also the right direction (typeset high, scale down; the reverse softens conjuncts). The
  harness gained `--720p` and, more importantly, an **assertion** — it extracts a frame and
  measures dark pixels in the lower third — because "go and look at the MP4" is exactly the
  check that does not get run.
  (2) **Kling has no `negative_prompt` field** (its docs say the prompt itself carries positive
  and negative description) **and caps the prompt** at 3072 chars, recommending 2500. So
  `VEO_NEGATIVE_PROMPT`/`buildVeoMotionPrompt` became provider-neutral
  `CLIP_NEGATIVE_PROMPT`/`buildClipMotionPrompt`, plus two helpers: `buildAvoidClause` restates
  the list as an instruction (a bare comma list of nouns dropped into a positive prompt reads
  as things to INCLUDE), and `fitClipPrompt` trims to a budget. The trim ORDER is the point and
  is asserted, not trusted: `SETTING_RULE`, `NO_TALKING_MOTION_RULE` and `NO_TEXT_RULE` are
  never touched, and they sit LAST — exactly where a naive tail truncation would take all
  three, which is why there is no blind `.slice()` in it. It sheds the avoid clause, then the
  style paragraph toward a floor, then the briefs, then the style outright; failing that it
  overshoots with a warning, because 2500 is a recommendation and a missing no-text rule is
  not survivable. The worst case is real and reachable (style caps at 1200, each brief at 600),
  so the harness builds it. `buildClipMotionPrompt` also moved the "move naturally … to that
  final frame" instruction onto its own line — attached to the end brief's tail, the trimmer
  would have cut the very instruction interpolation depends on.
  (3) **Four API shapes that are not Veo's**, each handled where the repo already puts such
  things — inside the client, learned from the API. Auth is a **plain API key**
  (`Authorization: Bearer`); the AK/SK JWT signing in Kling's docs is legacy-only and 3.0 is
  not on it, so there is no signing code. **A 200 with `code !== 0` is a failure**, so
  `http/kling-request.ts` returns the envelope's `data` rather than a `Response` — the check
  has to live in exactly one place or the day a caller forgets, a failed render looks like a
  success with an undefined url. Retryability is therefore two questions, and the in-band one
  defaults the other way: only concurrency/queue wording retries (the docs prescribe backoff
  ≥1s for over-limit, which `BASE_BACKOFF_MS` already is), and **anything unrecognised fails
  fast**, because an unknown in-band error is far more likely a content-risk rejection and
  retrying it five times risks five bills. Every in-band failure logs its code verbatim, since
  Kling does not publish the numeric ones — that log is how the retry list gets tightened.
  **`multi_shot` defaults to TRUE**, so it is sent `false` explicitly and its downgrade rung
  warns loudly: dropped, a single-shot interpolation prompt can come back as a montage, which
  is a visible defect rather than a silent cost. And there is **no `aspect_ratio` field** —
  output follows the frames — so the client fails FREE when the start and end frames disagree,
  since there is no parameter to correct it with and the stitch would inherit the mess.
  (4) **Cost stopped being true.** Kling 3.0 at 720p audio-off is 6 credits/s where Veo fast
  was $0.15/s, and `VIDEO_TIER_PRICE_PER_SECOND_USD` feeds BOTH the officer's gate-2 estimate
  and the recorded `video_projects.cost_usd`. It is repriced to a **flat ~$0.10/s** — flat
  because with `KLING_RESOLUTION` pinned there is one model at one resolution and the tier
  genuinely changes nothing, and inventing a differential in front of the person approving the
  spend is worse than showing none. The number is CONFIGURED, not discovered: `kling-client`
  logs Kling's returned `billing[]` (which Veo never gave us) on every success, so one
  reconciliation replaces the constant. Deliberately NOT metered from `billing[]` directly —
  those are credits, and converting needs the package rate. **No `NEXT_PUBLIC_VIDEO_CLIP_PROVIDER`**:
  duplicating a runtime server truth into a build-time client env would drift the moment `.env`
  changed on the API box; the single shared table keeps web and server in agreement by
  construction, at the accepted cost that this table is per-deployment truth. Two Marathi tier
  hints that claimed "सुमारे अडीचपट खर्च" (~2.5x) were rewritten — they were Veo's ratio and are
  now simply false.
  Also: the animate gate's 503 was hardcoded to `GEMINI_API_KEY`, which is the wrong key under
  Kling — frames are already rendered by then, so a Kling-clips box with no Gemini key animates
  fine. It now asks the seam (`clipProviderApiKeyEnv`) and names whichever key is actually
  missing.
  Verified 2026-07-26, all free: dists rebuilt in order, **workspace typecheck 7/7 green**,
  **lint clean on all 12 touched files**; 36 prompt assertions (the 24 existing ones plus 12 for
  the avoid clause and the trim order, incl. that the worst case comes under 2500 with all three
  rules and the interpolation instruction intact, and that a typical prompt is untouched); 7
  clip-provider dispatch assertions (default veo, kling selectable, trimming/lowercasing, the
  right key name per provider, and an unknown provider throwing `Supported: veo, kling`); 12
  kling-client pre-flight assertions (resolution mapping both ways, pinned-wins, missing key
  names the env var, duration bounds incl. fractional, the 300px and 1:2.5 frame rules, and
  mismatched start/end aspects); and the caption fix proven three ways — 720p, 1080p and
  vertical 720p all place the panel on-frame, plus a direct reproduction of the OLD filter
  showing 0.00%. **Left for a real run** (Kling spend, one ~$0.80 clip): which base64 encoding
  the API accepts (raw vs `data:` URI — the one genuine unknown, and why that rung exists), that
  the returned MP4 carries **no audio stream** at 1280x720 for 8s, that the output aspect follows
  the frames, that it is **one continuous shot and not a montage**, and the real `billing[]`
  figure. New env: `KLING_API_KEY` (required), `KLING_RESOLUTION=720p`, `VIDEO_CLIP_PROVIDER=kling`,
  plus optional `KLING_BASE_URL`/`KLING_MODEL`/poll/timeout/concurrency/retry knobs. Rollback is
  env-only — `VIDEO_CLIP_PROVIDER=veo` restores Veo exactly, with the old prices to restore
  beside it. **Operational rule: switching provider or resolution changes the frame SIZE of new
  clips, so re-animate ALL scenes of any project you then touch** — a mixed-size `-f concat` is
  the one thing this change can break. No migration, no n8n; deploy is API + web after rebuilding
  `@dgipr/schemas` → `@dgipr/poster-renderer` → `@dgipr/content-engine` dists.

- **/proofread shows WHERE it corrected the text** (2026-07-26, no migration): the
  corrected article rendered as one opaque string, so an officer could not see what had
  changed without hunting each excerpt from the issue list above it — unusable on a
  10,000-character press note, and an officer who cannot see the change cannot approve it.
  Every changed span is now marked in place, with the original wording, the Marathi type
  label and the explanation in a hover/tap popover, and a default-on
  **हायलाइट बंद करा** toggle that returns the text to plain prose.
  The interesting half is not the UI. **No positional data existed anywhere** — the engine
  patched and discarded every offset — and the patch is a _cumulative, longest-first,
  global_ `split/join`, which defeats the obvious client-side approach in three separate
  ways: replacement is global (one issue can own several runs of the output), fixes apply
  against the accumulating string (a later short fix can hit text an earlier fix INSERTED,
  and can match ACROSS an insertion boundary), and a swallowed fix is skipped while still
  appearing in `issues` (so `issues.length` ≠ the mark count). Searching the output for
  each `suggestion` would therefore mark the wrong words — confidently and invisibly.
  So the patcher **moved into `@dgipr/schemas`** (`applyProofreadFixes`, returning the
  patched text plus a per-run `fixIndex` tracked through a per-code-unit owner array) and
  `proof-read.ts`'s `applyFixes` is now a one-line delegation to it. One algorithm, in the
  one package both halves may import — `apps/web` cannot import content-engine
  (pdfjs/sarvam/openai), the same reasoning that moved `combineIntakeSources` and
  `tweetWeightedLength` there. `buildProofreadHighlights` sits beside it and adds the
  style-advisory overlay: those are **not applied**, so they are located by looking their
  excerpt up in the corrected text and marked **only inside runs nothing changed** — an
  excerpt a correction consumed is no longer verbatim present, and marking a near-miss
  would misstate where the text stands.
  **The safety valve is the load-bearing part**: `buildProofreadHighlights` returns
  **null** when its replay does not reproduce `correctedText` byte-for-byte, and the page
  then renders plain text. The corrected text is authoritative and the marking is
  best-effort — if the engine's patching ever diverges, the marks disappear rather than
  pointing at the wrong words. Copy and .txt download were deliberately left reading
  `result.correctedText` directly.
  Visual rules, inherited verbatim from the `.issue-*` block the new CSS sits under
  (_"Background tints only — no strikethrough, Devanagari stays legible"_): one
  `--ok-soft` tint + **solid** underline for corrections (no per-type colours — four tints
  in running Devanagari is unreadable, and the palette's fourth semantic tint is the red
  that already means "wrong"), `--warn-soft` + **dotted** for advisories. Solid-vs-dotted
  carries the one distinction that changes what the reader should do **without relying on
  colour**, which is what globals.css line 1 demands. The popover is viewport-anchored,
  not span-anchored: a marked span can wrap across lines and is a poor positioning context.
  Verified 2026-07-26: typecheck 7/7 green, lint clean on all five touched files; 23
  offline assertions (`tsx src/generation/proof-read.ts --check`, free) pinning
  byte-identity against the original `split/join` oracle plus the four span cases above,
  Devanagari digit runs, and the null-on-mismatch valve; and 16 live browser assertions
  against a real run — marks land on the changed words (incl. one spanning a line break),
  hover shows `मूळ: मुक्यमंत्री` with the शुद्धलेखन chip, Escape closes it, the toggle
  round-trips, **`textContent` is character-identical marked vs unmarked**, and the
  clipboard still yields exactly the corrected text. (One trap for the next agent: on
  Windows the clipboard API normalises `\n` → `\r\n`, so a 3-line article reads 2
  characters longer than the DOM — that is the browser, not a bug in the copy path.)
  No migration, no n8n; deploy is API + web after rebuilding `@dgipr/schemas` →
  `@dgipr/content-engine` dists.

- **Audio leads, clips follow: total-time narration, variable clip lengths, stylized 3D,
  and the /video text calls on gpt-5.6-sol** (2026-07-26, no migration — SUPERSEDES the
  fixed-8s window and the photoreal look in every video milestone above): the pipeline had
  the relationship backwards. Every scene was a fixed 8s clip and the Marathi voiceover was
  measured and _shortened_ until it fit 7.6s of it — the speech served the footage. The
  officer's actual goal is the inverse: the narration should explain the article as well as
  possible within a chosen total length, and the footage should serve the narration. The 8s
  pin was never a product decision either; it was **Veo's** constraint (its first+last-frame
  interpolation rejects 4s/6s with INVALID_ARGUMENT), and Kling 3.0 — deployed since the
  clip-provider swap — renders any whole second from 3 to 15.
  - **The derivation is one function**, `clipSecondsForNarration` in `@dgipr/schemas`:
    `clamp(3, 15, ceil(narrationSeconds))`. It is shared by the runner (measured WAV), the
    script-save route (provisional estimate) and the web (the gate-1 hint and placeholder),
    so those three can never disagree about how long a scene will run. The `ceil` is
    load-bearing beyond rounding: it guarantees the window is never SHORTER than the speech,
    which makes `muxNarration`'s atempo speed-up **unreachable on any newly derived scene**.
    That backstop now only exists for legacy frozen windows — and the too-fast warning on
    `VideoSceneCard` survives for exactly the same reason, documented in place.
  - **Budgeting moved from the clip to the project.** `VIDEO_TOTAL_SECONDS` maps the
    existing `duration_bucket` values to real totals (`short` = 30s, `long` = 60s — reusing
    the column's historical CHECK values, so **no migration**), and
    `videoNarrationBudgetChars/Words` turn that into what a prompt can use via the MEASURED
    rates (16.5 chars/s, 2.3 words/s — unchanged and still the thing never to adjust by
    intuition). The planner is told the total and to weight time by importance; the script
    writer gets the same total in the system prompt AND in a `<BUDGET>` block that travels
    inside `buildPlanBlock`, so a schema-repair or coverage-repair round cannot rewrite
    scenes without knowing the budget. The only per-scene cap left is 15s
    (`VIDEO_NARRATION_MAX_CHARS`, now `15 × 16.5` = **248**), which is a schema ceiling, not
    a target — it rejects a line no clip could ever hold.
  - **The narrate phase is three passes** (`ensureNarrationAudio`): (A) synthesize + measure
    per scene, rewriting only a line that busts the 15s ceiling; (B) `fitNarrationToTotal` —
    while the measured total overruns `VIDEO_TOTAL_SECONDS × 1.15`, shorten the LONGEST
    eligible scene, bounded at 3 attempts, asking it for the excess but never below its
    proportional share; (C) derive every non-frozen scene's window. Pass B is skipped
    without a Sarvam key (nothing was measured, so a total pass would be guessing) and is
    best-effort by design: every scene already fits its own clip after A, so failing to
    converge costs a few seconds of running time, not a broken video. **WINDOW FREEZE is
    untouched** and is what pass B and C both consult — a scene with a current clip keeps
    its window and is not even a shortening candidate, because shortening it could not
    shrink the video, only desync a paid clip from its own voice.
  - **`shortenNarration` became duration-agnostic**: the ceiling and the rewrite target are
    now the caller's (`NarrationFit`), its prompt no longer says "८ सेकंदांच्या दृश्यात", and
    its char cap scales with `targetSeconds` instead of a fixed 119 — a 14s ask and a frozen
    7.5s legacy window are both legitimate. `startNarrationJob` (post-completion re-voice)
    passes each scene's FROZEN window as the ceiling, which reproduces the old 8s semantics
    exactly for legacy projects.
  - **Stylized 3D replaces photorealism** (`REALISM_RULE` → `ANIMATION_STYLE_RULE`): a
    Pixar/DreamWorks-style animated film, bounded on BOTH sides — never live-action or
    photoreal humans, never flat 2D vector art or anime — because a bare "3D animation"
    drifts to whichever end the brief suggests. `CLIP_NEGATIVE_PROMPT` inverts to match:
    `live-action, photorealistic, photograph, real footage, flat 2D vector art` go IN;
    `3D render` and `CGI look` come OUT (they ARE the look now) and so do
    `cartoon`/`illustration`, which sit close enough to the target family to fight it. The
    planner's `shot_hint` rule, the script writer's `visual_brief` and `style` specs, and
    both frame prompts all follow. **`SETTING_RULE`, `NO_TEXT_RULE` (positive phrasing) and
    the no-talking rules are unchanged in substance** — only "person" → "character" wording
    — and `fitClipPrompt`'s drop order still protects all three.
  - **`VIDEO_CHAT_MODEL`** (`OPENAI_VIDEO_MODEL`, default `gpt-5.6-sol`) is passed
    explicitly at all 8 /video TEXT call sites (fact extraction, planner + repair, script +
    repair, coverage check + repair, shortener). **TEXT ONLY** — clips stay on Kling
    (`VIDEO_CLIP_PROVIDER`) and frames on Nano Banana/Gemini (`VIDEO_IMAGE_PROVIDER`); sol
    writes the plan/script/narration and the prompts those renderers receive. No pricing
    change was needed: `pricing.ts` already carries a `gpt-5.6-sol` row.
  - **Type widening, all additive**: `VideoSceneDurationSchema` 4|6|8 → `int 3..15` (every
    legacy row passes), `VideoSceneEntry.durationSeconds` and `ClipRenderInput.durationSeconds`
    → `number`. The **veo adapter guards** durations outside {4,6,8} with a clear error
    naming `VIDEO_CLIP_PROVIDER=kling`, thrown BEFORE the API call so a misconfigured
    deployment fails free rather than after a render wait. Retired: `VIDEO_INTERPOLATION_SECONDS`,
    `VIDEO_NARRATION_TARGET_SECONDS/_FIT_SECONDS/_TARGET_CHARS/_TARGET_WORDS`,
    `fitSceneDurationSeconds`, `VIDEO_FIT_TEMPO_ALLOWANCE` — the deletions are deliberately
    loud, so typecheck surfaced every reader. `sceneTimings`/`buildSrt`/caption overlays/
    `muxNarration`/`estimateVideoRenderCostUsd` needed **no changes at all**: they were
    already per-scene-duration driven.
  - **Web**: 30 सेकंद / १ मिनिट cards; the create-form estimate becomes a single figure
    (`total × price` — $3.00 / $6.00 at Kling 720p) instead of a scene-count range; the
    gate-1 narration hint names the clip the officer's edit will buy (`→ क्लिप ~Y से.`); and
    a new running-total line under the submit warns past ×1.15 but **never blocks** — a
    character estimate must not veto a script the real voice might well fit.
    Also fixed in passing: the clip-provider harness asserted `unset defaults to veo`, which
    had been wrong since the Kling swap.
    Verified 2026-07-26, all free: dists rebuilt in order, **workspace typecheck 7/7 green**,
    **lint clean on all 16 touched files**; 45 prompt assertions (the existing set plus
    per-prompt "demands the animated-film look" / "rules out live-action" and three negative-list
    checks); 11 clip-provider assertions including the veo duration guard rejecting 5s free of
    charge and naming Kling as the fix; kling-client's 12 pre-flight checks and the key-point
    digit guard's 9, both unchanged and still green; and the mux harness reworked to
    **UNEQUAL windows (5s + 12s)** — two equal windows would have hidden a mux that assumed
    one size for the whole video — producing a probe-verified **17.00s** MP4 with an AAC track,
    exercising atempo (6s into 5s) and apad (9s into 12s) in one run. **Left for a real run**
    (spend): a full 30s project end-to-end, confirming gate-2 per-scene `क्लिप X से.` equals
    `ceil(narrationSeconds)`, the estimate lands near $3, the SRT cues match the variable
    clips, and no atempo warning appears in the API log. New env (optional):
    `OPENAI_VIDEO_MODEL`. Rollback for the model is env-only; the style and the audio-led flow
    are code. No migration, no n8n; deploy is API + web after rebuilding `@dgipr/schemas` →
    `@dgipr/database` → `@dgipr/poster-renderer` → `@dgipr/content-engine` dists.

- **Realistic video look restored** (2026-07-26, no migration): this supersedes only the
  **stylized-3D visual-style half** of the audio-led milestone above. Variable clip lengths,
  start+end-frame interpolation, Kling/Veo and Nano Banana/OpenAI provider seams, narration
  timing, caption overlays, review gates and storage lineage are unchanged. The earlier
  realism implementation was recovered and reapplied: `REALISM_RULE` again demands a
  photorealistic live-action photograph with real people/places, natural light and
  true-to-life colour; the clip negative prompt again rejects cartoon/illustration/anime/
  3D-render/CGI output while continuing to reject writing, talking and non-Maharashtra
  settings. The planner and script writer again author live-action shot hints, photoreal
  start/end briefs and one cinematic-documentary-realism style paragraph. Both paid-provider
  CLI harness prompts also say realistic live-action. No migration, no n8n; deploy is API
  only for runtime behavior (rebuild `@dgipr/content-engine` first).

- **Creative and Social: a two-level output picker and a caption-only lane**
  (2026-07-26, no migration): the media room offered one flat row of three cards
  (पोस्टर / ट्विटर पोस्ट / फेसबुक पोस्ट) plus a "कॅप्शनही तयार करा" checkbox that appeared
  only on the two social ones. That conflated two independent questions — _what artifact
  am I making_ and _what platform is it for_ — and it had no way at all to ask for the
  thing officers actually wanted often enough to name it: **a caption with no poster.**
  The sidebar label becomes **Creative and Social**, the one English entry in a
  Marathi-first nav (by request; `navNew` is still the only source of that string, so
  `AppSidebar` needed no edit). `काय तयार करायचे?` splits: level 1 is **पोस्टर** (default)
  or **कॅप्शन**, level 2 is **लेख / ट्विटर / फेसबुक** under पोस्टर and **ट्विटर / फेसबुक**
  under कॅप्शन.
  - **The whole feature needed no migration, and that is the interesting part.**
    `generations.output_type` has existed since 0002 with `check (… in ('article','poster',
'both'))`, and on the article lane `'article'` has always meant "skip the poster phase"
    (`runner.ts:408,470`). A social caption is stored in the **`article` column** — the
    social lane's own convention — so `outputType: 'article'` on a social run means exactly
    the same sentence: **this run renders no poster.** One meaning, both lanes, an existing
    CHECK value, and it is already on both payloads.
  - **Caption-only is read off the ROW, not passed as a job option — unlike
    `generateCaption`, deliberately.** `generateCaption` can be a job parameter precisely
    because a re-run can infer it (`detail.article !== null`). Caption-only has **no** sound
    inference: a null `posterPath` on a completed social run cannot distinguish "never
    wanted a poster" from "the render failed", so an option would be silently lost on the
    first retry and the retry would buy a poster nobody asked for. `startSocialPostJob` now
    opens with `const captionOnly = row.outputType === 'article'`, skips
    `renderAndStoreSocialPoster` entirely, and writes the caption with **no `postType`** —
    which `startGenerateCaptionJob` has always done, and which is the proof a caption needs
    neither a poster nor a classification. A caption-only run is therefore ONE chat call:
    no classify, no master selection, no image, no n8n. Both retry paths
    (`[id]/page.tsx:42`, `NextActions.tsx:417`) already forward `detail.outputType`, so a
    caption-only retry and edit-note rerun stay caption-only for free.
  - **The poster+caption combination is deliberately KEPT**, as the toggle under
    पोस्टर → ट्विटर/फेसबुक. Dropping it would have made that unreachable from this page
    while `NextActions.CreateSocialBlock` still offered it — the two create surfaces must
    not disagree about what a social run can be. Under कॅप्शन the toggle is not rendered at
    all (a tautology there), and `generateCaption` is sent `captionOnly || wantCaption`.
  - **`category` became derived, not state**: level-2 values ARE `Category` values, so the
    derivation is a bare ternary with no mapping table. `'article'` is deliberately never a
    level-2 value — it would mean "the लेख poster" in one variable and "no poster at all" in
    `outputType` forty lines away. The pin-reset `useEffect` needed no change (`category` is
    still a string primitive compared with `Object.is`), and `captionOnly` is deliberately
    NOT in its deps: a पोस्टर→ट्विटर pin should survive a look at the कॅप्शन branch, and the
    pin is instead simply not _sent_ on a caption-only run.
  - **Busy gating across two levels:** the level-1 पोस्टर card is never `disabled` — its
    children straddle both lanes, so a single flag would be a lie whenever one lane is free.
    कॅप्शन takes `hasActiveSocialTask` (both its children are social) and the existing
    per-lane rule moves to the level-2 cards, where it collapses with no special case. A
    selected card that becomes disabled is left selected: `submit()` re-checks both flags,
    and moving the choice under the user's cursor would be worse. `TasksProvider`'s
    one-social-task-at-a-time gate is kept as-is even though a caption-only run touches no
    n8n — carving out an exception would change that rule in both directions for a ~15s job.
  - **Three things that assumed a completed social run has a poster**, all found by walking
    the readers rather than by running it: `TasksMenu` would have parked a _completed_
    caption-only run behind its grey `task-thumb--pending` placeholder forever (now gated on
    `outputType !== 'article'`); `SocialPostView` headed the card "तयार झालेले पोस्टर" (now
    falls back to कॅप्शन); and `STEP_LABELS.caption` said "ट्विटर कॅप्शन…" — always wrong for
    facebook, but on a caption-only run it is the ONLY progress line the officer ever sees.
    Everything else degrades correctly untouched: the poster frame, `canPublish`, the
    history card, `ProgressSteps` (unreachable for social), a _failed_ caption-only run.
  - **Guards.** The create route's pin check keyed off `!isSocialCategory && outputType ===
'article'`; the category test is now noise and it had a hole, so it becomes one
    `rendersPoster` flag covering both `referenceImageId` and `referenceTypeId`. One
    `superRefine` clause rejects `social + 'article' + generateCaption !== true` (a request
    asking for nothing at all). The publish route already refused for want of a poster, but
    said "yet" — now a Marathi 409 that says a caption-only post cannot be published,
    permanently, because both X and the Page endpoint need the poster bytes/URL.
    Caption-only is **terminal for posters** by design (`/generations/:id/poster` rejects
    social, `/poster/regenerate` needs a `posterPath`); the route to a poster is a fresh run
    from the same note via the cross-format fold — noted in the job's header comment so
    nobody later "fixes" those guards.
  - CSS is three rules (`.output-sublevel`) reusing `.ref-picker-inline`'s rule-and-gap
    idiom for the same subordinate-block relationship and `.segmented`'s denser padding; the
    sub-cards drop the icon, which is what gives the two rows their hierarchy for free (the
    `/video` pickers' precedent) and is why `Bird`/`ThumbsUp` left the import.
    Verified 2026-07-26, all free: workspace typecheck **7/7 green**; lint clean on every
    touched file (the only failures are the pre-existing untracked
    `content-engine/src/intake/text-file.ts` irregular-whitespace error and two
    poster-template warnings); prettier clean on all eight touched files, with the two API
    files confirmed **already** unformatted at HEAD and every remaining complaint outside my
    hunks. **Left for a real run** (one cheap chat call, no image spend): the कॅप्शन → ट्विटर
    E2E asserting `output_type='article'` / `poster_path` null / caption present, no poster
    frame or publish button on the detail page, the tasks panel showing no pending thumb, and
    a retry staying caption-only. **No migration, no n8n**; deploy is `@dgipr/schemas` dist →
    API → web.

- **A simplified single-call article baseline, on gpt-5.6-sol** (2026-07-27, migration 0035):
  the article pipeline had grown to as many as **14 + N** sequential `gpt-5.6-terra` calls — 5W1H
  extraction, an editorial brief, a tier audit, section-by-section drafting for long scheme notes,
  a bounded coverage-revision loop, a faithfulness check and repair, and a scheme-only
  traceability appendix. Measured baseline: ~16 calls, ~275 s, ~$0.29 per article. The stages were
  added to raise factual completeness and they do, but several of them **re-read and rewrite the
  finished draft**, and that is what made the prose read mechanically: by the time an officer sees
  it, the article has been argued with two to four times by graders optimising for coverage rather
  than for voice. With no stored officer edits yet, a learning system cannot be built — so the
  right move is a much simpler, higher-quality BASELINE first.
  `ARTICLE_GENERATION_MODE` (**default `simple`**) now forks the article lane in one place,
  `articleGenerationMode()` in `apps/api/src/jobs/runner.ts`, beside the `ARTICLE_POSTER_MODE`
  precedent. `simple` is `selectStyleReference` (≤1 embedding) → **one** `chatComplete` →
  `applyDesignations`. `full` restores the old pipeline, whose every module —
  `generate-article.ts`, `extract-5w1h.ts`, `editorial-brief.ts`, `verify-coverage.ts`,
  `polish-article.ts`, `news-exemplar.ts` — is **byte-for-byte untouched**. Rollback is that one
  env line plus a restart; nothing migrates and nothing is destroyed.
  - **The editorial specification is a versioned artifact**
    (`generation/simple-article-prompt.ts`, `SIMPLE_ARTICLE_PROMPT_VERSION`), split into a system
    message of DGIPR rules and a user message of filled INPUTS. The split does not weaken the
    factual-source boundaries: the FACTUAL AUTHORITY rules reference input slots by NAME and those
    names are stable headings. Two renderer decisions are load-bearing. Every optional slot is
    **omitted when empty**, never rendered blank — the spec forbids printing an unfilled
    placeholder, and a heading with nothing under it is exactly the shape that invites a model to
    fill it in. And the **dateline is RENDERED, not substituted**: with a verified location and
    date it becomes a concrete line, with either missing only the fallback instruction survives.
    Blind substitution would emit `, दि.  :` or leak a literal `{{location}}` into a published
    government article. `location`/`date` are deliberately unsupplied in v1 — nothing trusted
    collects them, and no call was added to infer them.
  - **Reference selection gained the confidence fallback it never had.**
    `generation/select-style-reference.ts`: officer paste → retrieval **above
    `ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY`** → nothing. The floor matters because retrieval had
    **no threshold anywhere** — `pickBestMatch` returns the argmax unconditionally, so whenever
    the corpus held nothing relevant an unrelated article still became the exemplar, and the model
    is told to follow its structure and terminology. That is worse than no exemplar. The default
    (0.35) is a starting value and is **env-tunable because it must be calibrated**, not guessed:
    `retrieve:test` prints the distribution and every run records what it matched. The reference
    is also passed **whole** rather than `slice(0, 1500)` — the spec asks the model to study
    paragraph sequencing and how a piece concludes, both of which a head truncation removes.
    `NEWS_STYLE_EXEMPLAR` is not used here: it is a fourth tier the hierarchy does not have.
  - **Model: `ARTICLE_MODEL` (`OPENAI_ARTICLE_MODEL`, default `gpt-5.6-sol`)**, passed explicitly
    at the one call site so no other caller's default moves — the `VIDEO_CHAT_MODEL` precedent.
    ~2× terra per token but replacing up to fourteen calls, so an article gets cheaper. No pricing
    change was needed (`pricing.ts` already carries a sol row). Its companion
    `OPENAI_ARTICLE_REASONING_EFFORT` (default `medium`) is **not cosmetic**: with the graders
    gone, the spec's SILENT FINAL CHECK block is the only verification left and it runs in the
    reasoning stage.
  - **Migration 0035** adds `generations.style_reference` (insert-only — `startGenerationJob`
    re-reads everything from the row, so a job parameter would be lost on the first retry and the
    retry would quietly re-style the article) and `style_reference_meta` (patchable; which tier
    fired, at what similarity, under which prompt version). The meta write is a **separate
    best-effort update** after the article write, so an un-applied 0035 costs the officer tier and
    the telemetry rather than a paid article — the 0028 principle.
  - **UI: /dlo only, and that is from the code, not a preference.** The media room always submits
    `providedArticle: true` — its note IS the finished article and the generator never runs there
    — so a style-reference field would be dead data on every media-room run. `/dlo` is the one
    surface that turns source material into prose. `StyleReferenceField` is shown in both its
    steps; the create route additionally refuses to store the column on a social or
    `providedArticle` run.
  - **Nothing officer-approved and nothing deterministic was dropped**: `applyDesignations` (zero
    calls, the pipeline's only structural name guarantee), `selectedFacts`, `statements`,
    `excludedFacts` and `nameDesignations` all reach the one prompt; the note stays the sole
    factual authority; status/step, cost metering and every downstream feature are unchanged.
    `factCheck` is `null` on this path (the appendix was its own full pass over the finished
    article) and `fiveWOneH` is **null rather than an empty scaffold** unless the run carries /dlo
    pointers — `[id]/page.tsx:168` gates that card on truthiness, so an all-empty object would
    render six "टिपणीत नाही" placeholder rows.
  - **One consistency fix found by walking the readers:** `reviseArticle` rebuilt the appendix for
    every scheme run, so a simple-mode article would have _sprouted_ a तथ्य-तपासणी fold — and
    bought an extra model pass — on its first feedback round. It gained a `withFactCheck`
    parameter (default `true`, so full mode is byte-for-byte unchanged) fed by `rowHasFactCheck(row)`,
    which keys off the STORED article rather than the current mode so a row keeps behaving like
    itself no matter which way the flag is later flipped. The feedback path otherwise keeps the
    full machinery **deliberately** — it is the officer-in-the-loop path, and simplifying it is a
    separate, separately-verifiable change.
  - **Evaluation is built in**: `article:compare` runs BOTH pipelines on one note and prints
    wall-clock, chat calls, measured cost, length, and `findUnsupportedClaims` run as a
    **read-only judge** over each output. Simple mode removes the faithfulness _repair_, so that
    count is the evidence the removal is safe; the harness warns explicitly when simple mode's
    count is worse, and the fix is then the specification rather than restoring the loop.
    Verified 2026-07-27, all free: workspace typecheck **7/7 green**; lint clean on all 14 touched
    files; 50 prompt assertions (`tsx src/generation/simple-article-prompt.ts` — every rule block
    present, no `{{` survives in any slot combination, the dateline degrades correctly with either
    half missing, per-category targets and ranges, empty optionals omitted, officer-approved blocks
    and their task rules reaching the prompt, and a style reference alone never opening ADDITIONAL
    VERIFIED INFORMATION) and 22 resolver assertions (`tsx src/generation/select-style-reference.ts`
    — tier order, fragment fall-through, the floor accepting/rejecting/boundary, telemetry carried
    through, the 3000-char article NOT truncated to 1500, and every env-parse fallback).
    **Left for a real run** (spend): the `article:compare` sweep over ~6 real notes incl. a long DLO
    transcript and a thin note, the `retrieve:test` calibration of the similarity floor, and a /dlo
    E2E (article renders, PDF exports, en+hi translate, poster attaches, one feedback round adds no
    appendix, `style_reference_meta` populated). **Deploy: 0035 → API → web**, rebuilding
    `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine` dists first. No n8n. New env, all
    optional: `ARTICLE_GENERATION_MODE`, `OPENAI_ARTICLE_MODEL`,
    `OPENAI_ARTICLE_REASONING_EFFORT`, `ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY`.
    **Designed for, not built:** the future approved-example loop. `selectStyleReference()` is the
    single seam — a "similar approved source → officer-final article" tier slots in above
    retrieval, matched on the SOURCE embedding (`embedTexts` 1024-dim and the `halfvec(1024)` match
    RPC already exist). `style_reference_meta` is its join key. The named gap: there is still **no
    manual article-edit path and no approval state**, so "final approved article", "manual edits"
    and "approval/publication status" have nowhere to live — that is the next migration when the
    loop starts, and it is additive to this design rather than a replacement for it.

- **Pointers simplified to one flat Marathi key-point list, on gpt-5.6-sol** (2026-07-27, no
  migration): `/dlo`'s Pointers step classified the reviewed note into six 5W1H groups
  (कोण/काय/केव्हा/कुठे/का/कसे) plus a separate attributed-statements list, rendered every bullet as
  a bordered checkbox row, and turned the officer's ticks into `selected_facts` / `statements` /
  `excluded_facts` on the generation — which then became the article's completeness contract.
  Three things were wrong with that. The 5W1H buckets **fragment related facts** (a scheme, its
  benefit and its deadline land in three different groups), which reads worst on exactly the
  input this feature exists for: a 20-page PDF holding many separate articles. The checkboxes
  implied a curation decision **nobody was making** — everything ships checked, and unchecking
  is a rare, high-consequence act. And the whole apparatus made the officer's one readable view
  of a long scanned source into a form.
  What an officer actually wants after review is what ChatGPT gives you for "give pointers": one
  ordered list of the source's most important facts. So `POST /api/pointers` now returns
  `{ points: string[] }` — flat, in **source order**, count adapting to the source — and `/dlo`
  renders it under **महत्त्वाचे मुद्दे** as plain bullets with article-like line height.
  **Selection is gone from the UI and no longer steers generation**: the article is written from
  the complete reviewed text, as it was before Pointers existed.
  - **The prompt is built around COVERAGE, not a count.** It is told the note may hold several
    separate articles, to read start to finish, to give every materially important topic a place
    and **not to drop the tail**, and — explicitly — that a topic may span pages while a page may
    hold several topics, so "one point per page" is ruled out and padding is forbidden. Related
    facts are to be combined into one point; names, designations, scheme names, dates, amounts,
    percentages and figures stay verbatim; an important quote may sit inside its point with the
    speaker's name, but there is no statements section. The `<HEADING>` block survives with its
    `purpose` re-scoped to `context_only_not_a_coverage_filter` plus an explicit "do not drop any
    topic because of this" line — an editorial angle NARROWS coverage, which fights the whole
    requirement. (The web never sends it, so this is belt-and-braces.)
  - **The output budget was the real bug, and it was silent.** The call passed no `maxTokens`, so
    it took `DEFAULT_MAX_TOKENS = 4096`. Marathi on o200k_base runs ~1 token per 1.2-1.8 chars,
    so 25 points of ~150 chars is already ~3,200 tokens and a 40-point multi-article list is
    ~6,200. Exhausting the budget yields either empty content (`finish_reason: 'length'`) or
    truncated JSON — and **both throw and were swallowed into `EMPTY_POINTERS`**, meaning the
    long-PDF case this feature is for was the one that silently produced nothing. Now
    `POINTERS_MAX_TOKENS = 16_000` (billing is on tokens emitted, so an unused ceiling is free,
    and the schema's 120 cap becomes the only binding limit) **plus** `salvageTruncatedPoints`,
    which pulls the complete `"…"` literals out of a cut-off `{"points":[…` body so a truncated
    reply returns the 45 points that landed instead of none. **Deliberately not chunked**: 60k
    chars ≈ 45k input tokens fits comfortably, and chunking would duplicate facts across
    boundaries (which the requirement forbids), destroy the single global source order, and need
    a merge call. The residual risk — under-enumerating the tail — is mitigated in the prompt.
  - **Model: `POINTERS_MODEL` (`OPENAI_POINTERS_MODEL`, default `gpt-5.6-sol`)**, passed
    explicitly at the one call site so no other caller's default moves (the `ARTICLE_MODEL` /
    `VIDEO_CHAT_MODEL` precedent). Enumerating every distinct topic of a long multi-article
    document, in order, verbatim and without repeating itself is judgement-heavy, and it is the
    officer's only view of what the source says with nothing downstream to correct it. No pricing
    change was needed — `pricing.ts` already carries a sol row. **Cost is now a pure add-on**
    (~$0.10 a short note, ~$0.40-0.50 a 60k-char PDF, charged on entering review and on every
    regenerate press) where Pointers used to partly pay for itself by removing `extractFiveWOneH`,
    the brief audit and two coverage graders. `OPENAI_POINTERS_MODEL=gpt-5.6-terra` halves it.
  - **Nothing on the stored-generation path was deleted.** `SelectedFact*`,
    `AttributedStatement*`, `POINTER_DIMENSIONS`, `fiveWOneHFromPointers`,
    `findMissingApprovedFacts`, `includedFactsBlock`/`statementBlock`, the `excludedFacts` rules,
    `editorial-brief`'s `skipAudit`, and `DloGenerateRequestSchema`'s three fields all stay — with
    "LEGACY ROWS ONLY — do not delete" comments naming what keeps them reachable, because
    `runner.ts` re-reads the row on **every** run and `revise-article.ts` re-reads it on every
    feedback round, so any pre-change generation still walks the full inventory path forever. The
    three wire fields are still **honoured** rather than dropped: zod objects are non-strict, so
    removing them would silently STRIP instead of reject, and a browser tab on the old bundle
    mid-deploy would lose its officer's selections without a trace. Only `PointerGroupSchema`
    (an ephemeral transport shape, never persisted), `pointerId`/`statementId`/`marathiNumber`,
    9 Marathi strings and the `.pointer-row*` CSS were removed.
  - **Two accepted consequences, not bugs.** New `simple`-mode DLO runs store
    `five_w_one_h = null`, so the तपशील card disappears for new runs while legacy rows keep
    rendering it (`full` mode still populates it via `extractFiveWOneH`, so the card is
    mode-dependent). And with no inventory, `preferAttribution` flips false and
    `simple-article-prompt.ts`'s `### ADDITIONAL VERIFIED INFORMATION` / `### EXCLUDED BY THE
OFFICER` blocks can vanish entirely — the note is the source again. Latent: an
    `ARTICLE_GENERATION_MODE=full` DLO article gains +4 to +6 chat calls (restored
    `extractFiveWOneH`, restored brief tier-audit, coverage back to the 3-way check); nothing
    errors, since every restored path is the pre-0034 default that non-DLO runs exercise today.
  - `apps/web/components/PointerSelector.tsx` → **`PointerList.tsx`** (`git mv`, so blame
    follows): the repo names components after what they render, and a "Selector" that selects
    nothing is an actively false name.
    Verified 2026-07-27, all free: `@dgipr/schemas` dist rebuilt, then **typecheck green on
    schemas, database, social-publisher, poster-renderer, content-engine and api**, with `apps/web`
    failing ONLY on the pre-existing untracked `components/GenerationUsedNames.tsx` (it references
    six `usedNames*` strings that have never existed in `strings.ts`, at HEAD or now — unrelated
    in-progress work, deliberately not "fixed" here); zero pointer-related errors anywhere. Lint
    and prettier clean on every touched file. **Left for a real run** (one paid sol call): the
    engine harness on a genuine 20-page multi-article Marathi PDF, checking that every distinct
    article is represented **including the last**, that nothing repeats, that names/dates/amounts
    survive verbatim, and that the cost meter logs `gpt-5.6-sol` rather than terra (the proof the
    explicit `model` argument reached `chatComplete`); plus the `/dlo` browser pass and one article
    feedback round on a legacy row to prove `findMissingApprovedFacts` still fires. **No migration,
    no n8n**; deploy is `@dgipr/schemas` dist → API → web, and API and web must ship **together** —
    the response shape is a shared contract parsed by `apps/web/lib/api.ts` with the same schema the
    engine produces, so a half-deploy makes the card error on every review. New env (optional):
    `OPENAI_POINTERS_MODEL`.

- **Concurrent /dlo work: a list of intakes, each at its own URL, resumable for free**
  (2026-07-27, migration 0036): `/dlo` behaved as if the platform could hold exactly ONE piece of
  article work. Exploration found **no server-side limit anywhere** — `POST /dlo/intakes` has no
  concurrency check, the `running` Set in `dlo-runner.ts` is an unbounded double-run guard, and
  `dlo_intakes` has no owner column because there is no auth. Two independent causes produced the
  symptom, and only fixing both makes the product actually concurrent:
  (1) **One form, globally.** `DloWorkspace` was a single component instance holding one
  `intakeId` and one `step` machine, mounted once by `PersistentAppContent` in the root layout and
  hidden with CSS. Its own `app/dlo/page.tsx` stub said it "prevents a second workspace instance".
  (2) **One OpenAI slot, process-wide.** `createLimiter(readInt('OPENAI_MAX_CONCURRENCY', 1))` in
  `http/openai-request.ts` serializes EVERY OpenAI call with a 300 s timeout, so a second officer's
  pointer summary or article silently queued behind the first with no sign of why.
  Two officers on separate machines were never blocked by (1); they were blocked by (2), and by the
  fact that **`intakeId` was never persisted** — no URL, no storage — so a reload orphaned the
  intake outright while Sarvam kept billing. Officers sharing one machine hit both.
  - **`/dlo` is now a list + form; `/dlo/[id]` is the workspace** (the existing `/video` shape:
    `app/video/page.tsx` + `app/video/[id]/page.tsx`). `PersistentAppContent.tsx` is **deleted**,
    and the case for deleting it is that server-backed resume strictly dominates it: the singleton
    covered tab-switching only, while the row-as-state-of-record covers tab-switching, **reload,
    crash, closed tab, another machine** — and, unlike the singleton, does not prevent a second
    officer from reaching the form. **The step is DERIVED from the row**, never stored, which is
    what makes resuming land exactly where the officer was.
  - **Migration 0036 `dlo_intakes.review_state` (jsonb)** persists everything the review step holds
    that is not already a column: the officer's per-source corrections, the unticked pages, the
    pasted style reference, and — the point — the two **PAID** lookups, the pointer summary (one
    `gpt-5.6-sol` call per `POINTERS_REQUEST_CHUNK_CHARS` block of the source) and the prepared
    names behind व्यक्ती व पदनाम. Resuming re-buys nothing.
    **Its own column, not a write-back into `files`**, for three reasons: `files` is rewritten
    WHOLESALE by the extract/re-extract jobs, so an autosave landing there would be a lost-update
    race against a live OCR job (`updateDloIntake` patches per field, so disjoint columns can never
    clobber each other); `files[].text` is the machine's answer and must stay distinguishable from
    the officer's correction, which the `edits[key] ?? page.text` overlay preserves; and
    `forgetFile`/`forgetFileKeys` already prune that overlay by file index after a re-read and work
    unchanged on a restored blob. `category`/`heading` deliberately go to their REAL columns (0018),
    so they survive even without 0036.
  - **The no-re-spend guarantee needed no new logic.** The pointer and designation auto-fire effects
    were already `if (pointers !== null || pointersLoading) return`; seeding those states from the
    blob suppresses them. The subtlety is that both effects run in the SAME commit as the seeding
    effect, where their `pointers === null` closure is still true — so the guard is a **ref**
    (`restoredFromSave`), which mutates immediately; a state-based guard would fire a paid call one
    render before the seed landed.
  - **Autosave is a 1200 ms debounce** (`useDloReviewAutosave`), flushed and awaited before
    `generate()` so the stored blob and the submitted `combinedText` can never disagree, and flushed
    on `pagehide`/`visibilitychange`. **Last-writer-wins, warn-never-lock**: the list is shared and
    there is no identity to lock against, so the blob carries a `writer` id and the PATCH returns
    the **previous** writer — echoing back our own would be information we already have and could
    never detect anything (this was a real bug caught in review). Optimistic concurrency on the
    row's `updated_at` was rejected: the intake job stamps that column too, so an OCR re-read would
    spuriously reject the officer's own save.
  - **Navigation** (§1.4 of the plan, and the half that decides whether this _feels_ concurrent):
    `/dlo` renders a conditional **सुरू असलेले काम** resume card → the new-intake form → the list
    split into **तुमचे काम** / **इतर कामे**. Deliberately **no auto-redirect** — an officer whose
    first intake is transcribing very often came back to start a SECOND one. The workspace header
    carries **`+ नवीन काम सुरू करा`**, named rather than a bare `+`. `काम` throughout, not the more
    technical `सत्र`, matching `dloStartOver`. The list polls at 5 s **only while one of this
    browser's own runs is non-terminal** (the `useGenerationThread` discipline).
  - **`dgipr.dlo.mine` (localStorage) is ORDERING ONLY and must never become auth.** Every intake
    stays visible and openable by anyone — that is the confirmed requirement, not an oversight. The
    API never receives, reads or filters on it; losing it costs ordering, never access. Said in the
    module comment so nobody later "upgrades" it into a permission check.
  - **The pre-submit draft**: notes/category/heading/style-reference and the document slot ids go to
    sessionStorage (the slot ids matter — each `<DocumentIntake>` already survives a reload via
    `dgipr.dlo.document.${slotId}`, but only if the same ids return). **Picked MP3s genuinely cannot
    be persisted** — a `File` is a live handle behind a user gesture — so within a session they ride
    in a module-scoped variable (not a component, so Next.js never unmounts it) and across a reload
    only their NAMES survive, surfaced as a "re-attach these" callout rather than a silent submit.
  - **`GET /dlo/intakes` must NOT run the orphan reaper**, and this is the one place the change
    could have made things worse: the reaper fails any queued/running row absent from THIS
    PROCESS's job set, so running it across a whole list would mass-fail every live intake the
    moment anyone opened `/dlo` in a second tab. Verified structurally — the route references
    neither `isIntakeJobRunning` nor `updateDloIntake`. The detail route keeps the reaper and now
    carries a comment naming the **single-process constraint** it imposes: with two API instances,
    instance B's poll would kill instance A's live job. Fixing that needs a heartbeat + grace window
    across `dlo-runner.ts`/`runner.ts`/`video-runner.ts` alike and is a named follow-up, not part of
    this change — but it is now written down in `.env.example` too, because the first instinct under
    load is "run two API containers".
  - **Lineage stays one-way.** `listGenerationsForDloIntakes` answers "has this intake produced an
    article?" with one batched `.in('dlo_intake_id', ids)` for the whole page. A reverse
    `dlo_intakes.generation_id` column was rejected: a best-effort reverse write that silently
    failed would leave an officer free to pay for a second article from the same source. An intake
    is never marked consumed — it stays `ready` and may legitimately produce several articles — so
    the card shows a COUNT and the output view offers "याच स्रोतातून पुन्हा लेख तयार करा".
  - DLO runs now register with `TasksProvider` (`addTask` after `generateFromDloIntake`), which they
    never did. **Known side effect**: `hasActiveArticleTask` gates the home form's article cards, so
    a DLO run now disables them while it generates — in-memory and per-officer, arguably correct,
    but a behaviour change on a page this work did not otherwise touch. If unwanted, the fix is a
    `track: 'panel-only'` flag on `addTask`.
  - **`OPENAI_MAX_CONCURRENCY`**: code default stays **1** (safe on the smallest org and a fresh
    clone; this repo's rollback story is env-only). Deployment value **5, and only on tier 2+
    (450k TPM)**. The arithmetic, stated honestly: an article is ~120k tokens spread over minutes,
    so five officers aggregate to ~150k TPM in steady state; the exposure is the burst case (~600k
    in one minute), which retry-with-backoff absorbs because **the slot is held across retries**.
    Expect `[openai] … got 429` warnings to become ROUTINE at 5 — the mechanism working, but it does
    mean the log stops being a useful signal. Worse throughput after deploying = overshot the tier,
    drop to 3. On tier 1 raising it makes things worse.
    Verified 2026-07-27, all free: workspace typecheck **7/7 green**, lint clean on every touched file
    (prettier's complaints on the four pre-existing files were confirmed **already failing at HEAD**);
    23 offline assertions (`tsx src/intake/dlo-review-state.ts` — deterministic serialization, the
    restored overlay reproducing a **byte-identical** assembled note including its `=== स्रोत: … ===`
    headers, empty/unknown-key tolerance, wrong-`v`/junk/null rejection); and a **live API run against
    a database WITHOUT 0036 applied**, which is this repo's own blast-radius standard: the list
    returns correct titles/counts/lineage and provably no text, the detail returns
    `reviewState: null` + `generations`, **create still reaches `ready` and lists**, and the PATCH is
    the ONLY thing that fails. Guards: unknown id 404, wrong `v` 400, oversized blob 400.
    **`DLO_REVIEW_STATE_MAX_CHARS` was lowered 400k → 300k as a result of that run**: Devanagari is 3
  bytes/char and `apps/api` caps bodies at 1 MiB, so a 400k cap was _unreachable_ for Marathi — the
    body limit fired first and the officer would have got an opaque English 413 instead of the Marathi
    message. Confirmed both ways live (410k Devanagari → 413; 410k ASCII → the intended 400) and now
    pinned by a harness assertion.
    **Left for a real run**: applying 0036, then the resume E2E proving **zero** new `/api/pointers`
    and `/api/designations/prepare` requests after a reload (the claim that cannot be shown offline),
    the two-officer conflict banner, an OCR re-read against a restored blob, and the
    `OPENAI_MAX_CONCURRENCY=1 vs 5` wall-clock measurement against the real org's tier.
    **Deploy: 0036 → API → web** (rebuild `@dgipr/schemas` → `@dgipr/database` dists first). No n8n.

- **The article stopped out-instructing its own style example** (2026-07-27, no migration): DLOs
  reported that platform articles read like reshuffled minutes, and that pasting the same note into
  ChatGPT with ONE Mahasamvad article as a sample produced visibly better copy. Generation
  `d997d12c` was the reference case: 282 words, no dateline, no named speaker, two `•` bullets, and
  `निर्देश देण्यात आले` / `सूचित करण्यात आले` in every paragraph. It was not a model gap — it is the
  same model family. Five causes, four of them ours:
  (1) **The exemplar's HEADLINE was never sent.** `retrieveReferenceArticle` returned
  `chunks.map(c => c.text).join('\n\n')` — bodies only — while the specification told the model to
  study _"how it presents the main news in the headline"_. The retrieved article's title was
  `…गैरसोय टाळावी – पालकमंत्री मंगलप्रभात लोढा`; that `– पदनाम नाव` pattern is the single most
  recognisable DGIPR habit and the model had never seen it. Fixed by carrying `title` through
  `StyleReference.articles[]` and rendering it as a `शीर्षक:` line.
  (2) **The prompt banned DGIPR's own house idiom.** The avoid-list held `यावेळी` and
  `त्यांनी सांगितले` — which the exemplar uses (`यावेळी … उपस्थित होते`,
  `असेही मंत्री श्री.लोढा यांनी सांगितले`) and which `STATEMENT_TASK_RULE` explicitly prescribes.
  Banned, the model invented the flat agentless register officers were rejecting. The list is gone;
  the constructions are now offered positively, with "never invent a name to avoid it" attached.
  (3) **The dictionary already knew the answer and nobody had written the query.** The note says
  `मुख्यमंत्री` with the name lost to STT, and `glossary_terms` holds, verified,
  `{ देवेंद्र फडणवीस, person, designation: मुख्यमंत्री }`. But `prepareDesignations` searched only for
  PERSON NAMES, so it returned `[]` and the article had nobody to attribute a directive to — while
  ChatGPT supplied from outside knowledge a fact we hold ourselves. New
  `mapDesignationsToPersons` (`@dgipr/database`) + `suggestOfficeHolders` propose the office-holder
  as a `suggested: true` row. It is a LOOKUP, not an inference: **exactly one** verified holder
  (`उपमुख्यमंत्री` maps to two people and therefore proposes nothing), longest title first with the
  matched span CONSUMED so `उपमुख्यमंत्री` cannot also fire `मुख्यमंत्री`, and the officer reviews it
  before any spend (`DesignationEdit.accepted`, autosaved).
  **AMENDED 2026-07-28 — `accepted` now defaults to `term.suggested` (pre-TICKED), not `false`.**
  It shipped default-off, which sounded like the safe choice and measured as a silent one. The
  four consecutive `/dlo` intakes after the feature landed each carried the identical proposed
  row `{देवेंद्र फडणवीस, suggested: true, designation: मुख्यमंत्री}` in `review_state`, and exactly
  ONE had a non-empty `edits` — so one generation got `name_designations` and three got `null`,
  with the article silently reverting to the agentless prose the whole feature exists to
  prevent. The officer had also ticked **यापुढेही हेच वापरा** on that run, and it changed nothing
  for later ones: for a reverse-lookup row the write-back only creates the glossary row the
  suggestion is _generated from_, so the row comes back `suggested: true` and unticked forever.
  Pre-filling only ever helped notes that already spell the name out — i.e. the case that never
  needed help. Review is preserved by making the suggestion **visible and untickable** (named on
  the card before any spend, labelled शब्दकोशातून सुचवलेले) rather than inert. Two construction
  sites must stay in step or the fix is undone by a keystroke: `valueFor` in
  `DesignationReview.tsx` and the seed in `DloWorkspace.patchDesignationEdit` — an untouched row
  has no `edits` entry at all, so `collectDesignations` reads `edit?.accepted ?? term.suggested`
  and a `?? false` anywhere re-drops every suggestion the officer simply left alone.
  (4) **A ten-rung priority ladder plus "do not preserve the original order" IS the "reshuffled our
  data" complaint.** Replaced by: lead on the strongest supported outcome, then **follow the order
  of the source**, departing only to keep a directly related fact beside its point.
  (5) **Rules outweighed the example ~8:1** (11,041 chars of spec vs a 1,350-char headless excerpt),
  and several rules contradicted it — including an invented "zero to two highlight bullets" rule no
  Mahasamvad article follows. The spec is cut to **6,676 chars** in five numbered blocks (FACTS /
  STYLE / EDITING / LENGTH / BEFORE ANSWERING) and now says outright that where instructions and
  references disagree about FORM, **follow the references**; the instructions govern facts and
  accuracy, the references govern how the article reads. Up to 3 exemplars
  (`ARTICLE_STYLE_REFERENCE_COUNT`, default 3) with the shared-shape rule "follow what they have in
  COMMON".
  Two things found while measuring, both load-bearing once the spec is short. **A wrong-GENRE
  exemplar** — a real retrieval ranked a 12,550-char `विधानसभा लक्षवेधी` (legislative Q&A, ~1,700
  words) above the 835-char news report that actually showed the pattern; `styleReferenceMaxChars`
  bounds an exemplar at `wordTarget.max × 6.5 × 2` chars, using length as the cheapest reliable
  proxy for genre. And **"reproduce verbatim" over-generalised**: with the old terminology guidance
  cut, the model preserved raw STT artefacts (`एस सी एम टी आर`, `एकत्रित जीआर`, `ॲडव्हान्स पोझिशन`,
  `कॅश कॉम्पेंसेशन`, `टीपी प्लॅन`, Latin `2028`). The rule now says explicitly that it protects FACTS,
  not transcription artefacts, with worked examples and Devanagari numerals — re-scripting a numeral
  may never re-value it (the `revise-caption` distinction).
  Also: DGIPR's end-of-copy sign-off (`****` + `संध्या गरवारे/विसंअ/`) is stripped from every
  exemplar (`stripArticleBoilerplate`), or the model is being shown a byline to imitate.
  `SIMPLE_ARTICLE_PROMPT_VERSION` → `simple-v2`; `styleReferenceMeta.articleCount` records how many
  exemplars a run actually got, which is what makes a 1-vs-3 A/B attributable afterwards.
  Verified 2026-07-27: typecheck **7/7 green**, lint clean on all 12 touched files, and four free
  harnesses — 77 prompt assertions, 47 reference-selection assertions (incl. the real 12,550-char
  rejection beside the 835-char keep), 7 sign-off assertions, and 16 office-holder assertions whose
  substring case **caught a real bug** (global suppression instead of per-occurrence masking, which
  silently dropped the Chief Minister from a note naming both offices). Paid end-to-end on the exact
  failing note: the article now opens
  `शासकीय जमिनींचा आगाऊ ताबा देण्यासाठी एकत्रित शासन निर्णय काढावा – मुख्यमंत्री देवेंद्र फडणवीस`, leads with
  `असे निर्देश मुख्यमंत्री देवेंद्र फडणवीस यांनी दिले.`, carries `असेही फडणवीस यांनी सांगितले`, expands every
  acronym (`एचसीएमटीआर`, `पुणे महानगरपालिका`, `पुणे महानगर प्रदेश विकास प्राधिकरण`, `नगररचना योजना`), uses
  `२०२८`, has no bullets and follows the source order — with `designationIssues: []`.
  **Still open**: no dateline, because `runner.ts` still hardwires `location`/`date` to nothing —
  the prompt slots exist and a small venue/date field at the /dlo review step fills them. Also
  deferred: the retrieval RANKING still put the legislative document first on selection score (the
  length bound only excludes it), and vector search runs a **sequential scan over 37,811 chunks**
  since 0019 dropped the HNSW index, which times out under load and silently degrades a run to
  tier 3 — i.e. to the rules-only configuration this whole change moves away from.
  No migration, no n8n; deploy is `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine`
  dists, then API, then web. New env, both optional: `ARTICLE_STYLE_REFERENCE_COUNT`.

- **The Devanagari typeface is Mukta, not Noto Sans Devanagari** (2026-07-28, no migration): an
  officer reported that the platform "messes up the spelling of many Marathi names on pasting" —
  a word copied out of a DGIPR Word document showed as `इलेक्ट्रानिक्स` there and `इलेक्ट्रॉनिक्स` on
  the site. **No character was ever altered**, and that was established before any code changed:
  `/proofread`'s textarea does `setText(event.target.value)` and nothing else, there is no
  `onPaste`/`.normalize()` anywhere in `apps/web`, and the officer's own clean-room test settled
  it — text copied from **Google**, pasted into the site, then copied back out came through
  unchanged. A `<textarea>` cannot change a code point.
  What was actually wrong is worse, because it was shipping in published material: **Noto Sans
  Devanagari fails to form the C+र conjuncts Marathi is full of.** For `क्ट्र` it leaves an
  explicit halant under the `ट` and sets `र` as a separate wide letter, so `इलेक्ट्रॉनिक्स` reads
  as broken to a Marathi eye. Rendered side by side through Chromium, **Nirmala UI, Mukta, Hind,
  Tiro Devanagari Marathi, Baloo 2 and Mangal all form the ligature correctly — Noto was the
  only outlier**, and since it is the only font this product ships, it was the only place text
  looked wrong. Every other app the officers use (Word, Chrome on google.com, Notepad, a chat
  window) falls back to Windows' **Nirmala UI** and therefore looked right. The lesson worth
  keeping: a report of "your app changed our text" against a Devanagari surface is a **shaping**
  complaint until proven otherwise — diff the code points first (they were identical here), then
  screenshot the same string in several faces rather than reasoning about it.
  The swap is **Mukta** (Ek Type, OFL — `assets/fonts/Mukta-OFL.txt`), chosen by the operator
  from that comparison, and it reaches **every surface**: the web UI (`apps/web/app/layout.tsx`,
  `next/font/google`), the article PDF, both posters, the burned-in video captions, and the
  Sharp/Pango `महाराष्ट्र शासन` wordmark in `twitter-chrome.ts`. Fixing only the screen was
  explicitly rejected — the defect was going out in every poster and every circulated PDF.
  One structural consequence: **Mukta is a STATIC family, one file per weight**, where the Noto
  file it replaces was a single variable font covering 100–900. So `assets.ts` gained
  `MARATHI_FONT_FAMILY` + a private `fontFaceCss(weights)` helper, and `fontDataUri` became
  `fontFaceCss` on all three asset types — each loader now names the weights its template
  actually uses (posters 400+800, PDF 400+700+800, captions 600 alone), so a poster does not
  carry the PDF's bold cuts as base64. The templates lost their hand-rolled `@font-face` blocks
  and interpolate that string instead, which is also why there is now exactly one place to
  change the face again. `font-weight: 900` on both poster headlines became **800**: Mukta's
  heaviest cut is ExtraBold, so 900 could only ever resolve back to it.
  `NotoSansDevanagari.ttf` is deliberately **left in place, unreferenced**, as a one-line revert.
  Verified 2026-07-28, all free: workspace typecheck **7/7 green**; lint clean on all seven
  touched files (only the two pre-existing `poster-template.ts` unused-var warnings remain);
  a no-fallback coverage render proving Mukta carries Basic Latin, `०-९`, `₹ € – — … •`, curly
  quotes, `। ॥` and all four weights with **zero tofu**, so English and Hindi PDF exports are
  safe; `pdf:preview --png` in **mr / en / hi** (letterhead intact, `कर्जमुक्ती` `विद्यार्थ्यांच्या`
  `ज्ञानज्योती` `हृदयरोग` `ऑगस्ट` all shaping, English justified with no tofu, Hindi date line in
  Devanagari numerals); `poster:preview` + `poster:preview:article` (headline shapes and still
  fits its panel at 800); `poster:preview:chrome:twitter` (the Pango wordmark shapes `ष्ट्र`);
  `video:preview:captions --720p` **passing its own on-frame assertion** (13.6% panel pixels);
  and a live-app probe where Chromium's `CSS.getPlatformFontsForNode` reports **`Mukta SemiBold`**
  painting the page and the textarea renders `क्ट्रॉ`/`ट्रा` correctly.
  No migration, no n8n; deploy is `@dgipr/poster-renderer` dist → API → web.

- **The designation follows the SURNAME too** (2026-07-28, no migration): a published article
  read `असल्याचे सांगत फडणवीस यांनी उपक्रमाला मान्यता दिली` — a bare surname mid-article, where a
  government press note names an official with their office every time it names them. Two
  independent causes, one in each half of the feature.
  (1) **The deterministic pass matched the full name only.** `applyDesignations` prefixed the
  FIRST mention of `देवेंद्र फडणवीस` and stopped; its header comment said a bare surname was
  "deliberately NOT matched" because two people can share one. That reasoning is sound about
  ATTRIBUTION and was over-applied to placement: once the officer has approved a pair, every
  standalone mention of that pair's surname is the same person by construction. It now prefixes
  the full name once and **every standalone surname mention** after it (the officer's call —
  "first surname mention only" and "every mention" were both offered). Whole-word matching, so
  an inflected `फडणवीसांनी` is left to the prompt rather than assembled from guessed morphology;
  a surname occurrence INSIDE its own full name is skipped; a surname shared by two approved
  pairs is disabled for both and falls back to full-name-only. `not-found` therefore now means
  the article genuinely does not name the person — which is a strictly rarer, more informative
  warning than before.
  (2) **The dictionary knew the answer and nobody had written the query — again.** This is the
  `suggestOfficeHolders` finding repeating one row over: `designation` is only read off a row
  whose Marathi form matches the text VERBATIM, and `फडणवीस` is not `देवेंद्र फडणवीस`, so a
  transcript that keeps only the surname reached the card with a blank field. New
  `resolveSurnameDesignations` (translation-terms.ts) indexes verified full-name person rows by
  their last word. Rules, each guarding a failure: whole-word mention only; a person whose FULL
  name is in the text is SKIPPED (their own row already carries the title, and the pass above
  now extends it to their surname mentions); and where several dictionary people share the
  surname the **context decides** — exactly one of their stored titles must occur in the text
  (`उपमुख्यमंत्री … पवार यांनी` resolves, a bare `पवार यांनी` does not, and a note naming BOTH
  titles resolves nothing, because that is genuine ambiguity rather than a hint). The pair it
  produces names the **surname**, never the dictionary's first name: adding an officer-approved
  title is not licence to add a name the source does not have. It surfaces as an ordinary
  `suggested: true` row, so it is pre-ticked, labelled शब्दकोशातून सुचवलेले and untickable — no
  web change at all.
  Prompt half, in all three places that state it: `DESIGNATION_TASK_RULE` (category-prompt.ts,
  shared by drafting + every revision/checker), and the NAME DICTIONARY sentence in both
  `simple-article-prompt.ts` (**`simple-v6`**) and `minimal-article-prompt.ts`. The system
  message's char ceiling was raised 900 → 1000 deliberately: that check exists so "just one more
  rule" has to be an explicit decision, and this is one — it is DATA handling, not editorial
  instruction. Found in passing and restored while there: `Never add unsupplied information to
make it longer.`, which v5's own harness asserts and the v5 system message had lost.
  Verified 2026-07-28, all free: workspace typecheck **7/7 green**, lint clean on all six touched
  files, and both harnesses green — `tsx src/generation/apply-designations.ts` (the six new cases:
  every-surname-mention beside an already-titled full name, a surname-only article, a one-word
  approved name, the inflected form left alone, the shared surname disabled for both, and an
  honorific/wrong-title before a surname) and `tsx src/jobs/translation-terms.ts` (nine new cases
  covering both lookup halves and all three ambiguity outcomes). **Left for a real run**: a /dlo
  article whose source uses only the surname, checking the card pre-fills the title and every
  surname mention publishes with it. No migration, no n8n; deploy is `@dgipr/schemas` →
  `@dgipr/content-engine` dists → API → web.

- **Social reference selection is INFORMATION-FIRST** (2026-07-28, no migration — SUPERSEDES the
  classify→point_count→wants_photo→select-within-type flow of the 2026-07-24 content-aware
  selection milestone): the social poster path decided three things ABOUT the note before it had
  looked at a single reference — which post type it was (`classifyPosterType`), how many body
  points it supported (`point_count`), and whether it wanted a photograph (`wants_photo`) — and
  every one of those predictions then narrowed the pool. A wrong `point_count` scored the right
  template out of the band; a wrong `post_type` excluded a whole family of templates before
  scoring even began. The predictions were doing the choosing, and they were made blind.
  The order is inverted. `references/select-by-information.ts` compares the **raw note, exactly
  as the officer wrote it**, against **every enabled master of the brand across ALL types**,
  using the descriptions already cached on `reference_images.layout_spec` (migration 0016) —
  `contentSummary` (what that poster is about) and `layoutSummary` (how it arranges information)
  — and the winning reference's own `subtype` then resolves the poster TYPE. That is the CMO
  path's long-standing shape (pick the image, derive the type from it) generalised to the DGIPR
  library, which is why no new type-resolution machinery was needed and why the classification
  step could simply be deleted rather than replaced. Downstream is **unchanged and is the
  point**: `generatePosterCopy` already pins the body-slot count to the chosen master's real
  `bulletSlots`, drops `scene_brief` when it has no photo zone, and takes its layout from the
  resolved type's `copyStyle` — so "the reference decides how the information is arranged" was
  already true; it was only ever the _selection_ that ran backwards.
  Decisions worth keeping:
  - **Tone, mood and colour are explicitly NOT criteria**, stated as a negative rule in the
    prompt. That is `rank-master.ts`'s job for a different flow (a tie-break inside an
    already-structurally-filtered band) and it is deliberately left intact and untouched. The
    criteria here are subject domain and whether the reference's sections can hold the
    information the note actually contains. `ignoreColour` still strips colour out of the
    descriptions on a `fresh` render, for the reason the diversity milestone established.
  - **The ranker inherits the classifier's tier, not the tie-breaker's.** It runs on
    `POSTER_COPY_MODEL` (gpt-5.6-terra) at `medium` effort, where `rank-master.ts` runs on the
    utility tier at `low` — because this is now the DECISIVE routing call and the reference it
    picks determines the poster's entire information structure. Net model cost is unchanged: one
    call replaces the classifier's one call.
  - **It also returns the run's Marathi working title**, which the classifier used to produce and
    which becomes `generations.reference_title`. Free — it rides the same strict-JSON call.
  - **A master with no `layout_spec` is invisible to it**, having no description to match on.
    This is the one real regression risk and it is handled the way `select-master.ts` already
    handles it rather than with a bulk gate: one un-analysed master is warmed per run, so an
    undescribed library becomes rankable over successive runs, and with fewer than two described
    candidates the pick falls back to the seeded hash. **Run
    `pnpm --filter @dgipr/content-engine analyze:references` at deploy** or early posters are
    seeded rolls.
  - **The recency ring is keyed by BRAND, not by type** (`${brand}:library`): the pool is now
    the whole library, so spreading within one type would no longer describe what the last few
    runs used. `ResolvedReference` gained an optional `poolSize` so the caller's avoid-set can
    never grow large enough to exclude the library.
  - **Rollback is one env line.** `SOCIAL_REFERENCE_MODE=classify` restores the old flow;
    `socialReferenceMode()` in `runner.ts` is the single read (the `ARTICLE_POSTER_MODE` /
    `ARTICLE_GENERATION_MODE` precedent), and `listSocialTypes`, `classifyPosterType`,
    `scoreMaster` and `MasterNeed` are all kept exported and reachable for it — commented as
    legacy, not deleted.
  - Pins and CMO are untouched: an exact-image pin, a type pin and the CMO brand all still FORCE
    the choice and never reach this path.
  - The `classify` step's Marathi label became **संदर्भ टेम्पलेट निवडत आहोत…** — "विषय ओळखत आहोत"
    named precisely the thing that no longer happens first.
    Verified 2026-07-28, all free except the harness: workspace typecheck **7/7 green**, lint clean
    on all six touched files, and a live run of `tsx --env-file=../../.env
src/references/select-by-information.ts` (cents) on the MRI note against an alert master, a
    quote master and a stats master — it chose the stats master, citing the note's four locations,
    budget figure and deadline as fitting its stat callouts, and returned
    `चार रुग्णालयांत अत्याधुनिक एमआरआय केंद्रे` as the title. **Left for a real run** (image spend): a
    full twitter E2E against the live library confirming the log's `information-ranked (...)` reason
    and that the resolved type matches the picked image's subtype. No migration, no n8n; deploy is
    `@dgipr/content-engine` dist → API → web, with `analyze:references` run first. New env
    (optional): `SOCIAL_REFERENCE_MODE`.

- **Transcription as its own product (`/transcribe`)** (2026-07-28, migration 0037): officers
  wanted a recording turned into Marathi text _without_ the article machinery around it —
  /dlo can do the transcription, but only as step one of a multi-step workspace that then
  asks for a category, a heading, a review pass and a generation. The new page is upload →
  transcript → copy/download, on ONE screen, plus a history list of past runs.
  Almost nothing was written twice, which is the point. The Sarvam batch STT logic
  (`transcribeAudioFiles`), the content-addressed transcript cache (`audio_transcript_cache`,
  0031), the private archive bucket (`dlo-uploads`, 0018) and the audio-container rules
  (`AUDIO_FILE_ACCEPT`/`audioMimeForFileName` in `schemas/src/dlo.ts`) are all REUSED; the new
  code is a row, a job that is the DLO intake job's transcribe phase and nothing else, three
  thin routes, and a page. Sharing the cache means a recording transcribed on /dlo is free and
  instant here, and vice versa — and the job persists cache hits BEFORE calling Sarvam, so an
  all-cached run shows its result without a call being made at all.
  Decisions worth keeping: it is its OWN table rather than a flavour of `dlo_intakes` (whose
  every column past `files` exists to serve the article pipeline, and whose `status: 'ready'`
  means "ready for review" — the wrong sentence here); the recordings go under a
  `transcriptions/{id}/…` prefix in the EXISTING private bucket, so 0037 provisions none; the
  list-card counters are real columns, which is what lets the list query skip `files` and
  `combined_text` (a meeting transcript is tens of thousands of characters and the list polls
  while work runs); the transcript renders READ-ONLY, because this page's contract is "the
  recording, verbatim" and an editable box would invite corrections nothing persists —
  correcting text before it becomes an article is /dlo's review step; a run OPENS IN PLACE
  rather than at its own route, there being nothing to do to a transcript that needs a screen;
  and the form keeps no sessionStorage draft, unlike DloIntakeForm, since a `File` cannot be
  serialized and here it is the only input — a draft remembering nothing but file names would
  be a promise the form cannot keep. One bad recording among several fails only itself and is
  reported beside the transcripts that worked; a run fails only when nothing survived.
  Verified 2026-07-28, all free: workspace typecheck **7/7 green**, lint clean and prettier
  clean on all new files, and a live API pass **against a database without 0037 applied** —
  the routes register, a request with no file answers the Marathi 400, a `.txt` answers the
  Marathi "recordings only" 400, and the two table queries are the only things that fail (the
  0028 blast-radius standard). **Left for a real run** (0037 applied + Sarvam spend): one MP3
  end to end, then the SAME MP3 again to confirm it returns from the cache with no
  `[sarvam-stt] batch job:` log line, and a two-file run where one recording fails.
  Deploy: **0037 → API → web** (rebuild `@dgipr/schemas` → `@dgipr/database` dists first).
  No n8n, no new env.

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
- `article-poster-v1-api` — **no longer on the creation path** (2026-07-24). The article poster
  is now GENERATED by the API (`ARTICLE_POSTER_MODE=fresh`, the default), so this workflow is a
  thin **5-node** image-EDIT service, identical in shape to `social-post-v2-api`: it takes
  `{ generation_id, image_url, prompt, quality }`, edits that image with gpt-image-2 at
  1536x1024, and returns `{ poster_png_base64 }`. It serves pixel/marker FEEDBACK re-renders and
  the legacy `ARTICLE_POSTER_MODE=n8n` master-edit mode. Its `Build Prompt` Code node is gone —
  prompts now live in `content-engine/src/generation/build-article-poster-prompt.ts`, beside the
  chrome geometry they must stay in sync with. The `image_url` Set expression falls back to
  `reference_url` so an old API payload still resolves an image. Run the `analyze:references`
  backfill so article masters carry `layout_spec`: in fresh mode that spec is what supplies the
  colour-stripped structure hint and the real `hasPhotoZone`.
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

## Latest Implementation Milestone

- **The social poster is 4:5 again, so Canva has no gap to close** (2026-08-13, no migration):
  officers place a finished twitter/facebook poster on a 1080x1350 Canva canvas, and it did not
  fit — it left an unfilled gap down each side, which they were closing by hand by displacing
  the design. The cause was ours and three days old: appending the footer (2026-08-10) had made
  the delivered file **1280x1691**, i.e. 1:1.32, where 1080x1350 is 4:5. Resolution was never
  the issue — 1280x1600 drops into that frame perfectly, and downscaling to 1080 would only cost
  29% of the pixels — so the fix is the ASPECT.
  The height for the strip is now taken out of the **request** rather than off the finished
  image: the model is asked for **1280x1504** and `overlayTwitterChrome` joins the band onto a
  96px strip below it, for exactly **1280x1600**. That is deliberately not the two alternatives.
  Cropping 91px off a 1600-tall render would reopen the text-burying bug the append exists to
  close (a crop is unconditional; a shorter canvas still means the band lands on pixels the
  model never painted), and squashing 1600 into 1509 is a 5.7% anisotropic distortion, visible
  on faces and the emblem.
  - **It is 1504, not 1600−91, because gpt-image-2 requires both dimensions divisible by 16.**
    Verified live before writing any code: `1280x1509` returns a 400 in ~1.1s —
    `"Invalid size '1280x1509'. Width and height must both be divisible by 16."` — which on the
    real path would have failed every social run *after* the copy call was paid for. `1280x1504`
    was then confirmed accepted and returning exactly 1280x1504. The 96px strip is ~5px taller
    than the band's own ~91px, and that difference is absorbed by the same edge-continuation
    fill that already hides the join, so it reads as poster rather than as padding. The
    invariant to keep: **artwork % 16 === 0 and strip ≥ band height.**
  - **CMO must stay 1280x1600 and would have been broken by a global change.** `overlayCmoChrome`
    OVERLAYS its full-width leader header and footer instead of appending, so what the model
    paints IS the finished CMO poster — already 4:5, already fine in Canva. But both brands share
    ONE n8n workflow, whose size was a hardcoded form field. So the render size now travels in
    the webhook payload (`size`), and the workflow's Set node defaults it to `'1280x1600'`. That
    default is what makes the deploy safe in **both** directions: an old API against the new
    workflow renders exactly as today, and a new API against the old workflow has its `size`
    ignored rather than mis-rendered. Neither half can produce a broken poster.
  - **Masters are deliberately left at 1280x1600.** They are the edit INPUT, not the output; the
    prompt already calls the reference structural rather than pixel-locked and licenses reflow,
    so a 5.7% aspect difference is immaterial. Re-normalising would mean rewriting 91 immutable
    library objects and would break the `aspect-ratio: 4 / 5` thumbnails on `/references`.
  - `SOCIAL_ZONES.height` is now the **artwork** (1504), not the poster, so the content floor
    moves y=1584 → **y=1488**. Both `DESIGN_ASPECT` (1:1.175) and `FINISHED_ASPECT` (4:5) are
    derived from the constants rather than from the runtime band height — that is what makes the
    finished poster exactly 4:5 whatever the footer asset measures — and the idempotence test
    still cleanly separates them (gap 0.075). "Single 4:5 portrait poster" became "single
    portrait poster" on the two lanes that paint artwork; CMO's line is untouched, being true.
    Verified 2026-08-13, all free except the two size probes (~$0.04 total): workspace typecheck
    **7/7 green**, eslint clean on every touched file, prettier clean on my hunks (the four
    whole-file complaints are pre-existing CRLF — confirmed per file, zero content diff — so do
    NOT `--write` them); four prompt harnesses green with new assertions pinning `1280 x 1504
    output` and `y=1488`; and `poster:preview:chrome:twitter` rewritten into a **regression
    test** that renders the real 1280x1504 artwork and asserts the finished poster is exactly
    1280x1600 and that re-stamping does not grow it — the check an eyeball is bad at. Plus an
    offline geometry pass on the hostile cases: a textured (dark column / warm block) bottom edge
    still finishes 1280x1600 at aspect 1.2500, a feedback round-trip lands back on 1600, a
    finished poster handed back in does not grow, and a 1024-wide render still comes out 4:5.
    **Left for a real run** (one image charge each): a DGIPR `ठरलेले टेम्पलेट` poster and a
    `fresh` poster confirming 1280x1600 out with the design reaching the bottom edge, one
    feedback round on each confirming it stays 1280x1600, and one **CMO** run confirming it is
    unchanged at 1280x1600. **Deploy order is the NORMAL one — API first, then `pnpm n8n:push`**
    (rebuild `@dgipr/poster-renderer` → `@dgipr/content-engine` dists first). No migration, no
    web change.

- **/translate asks one question, and the SOURCE is read off the text** (2026-08-12, no
  migration, web only — SUPERSEDES the four-pill direction row in the PDF-translation and
  Hindi milestones below): the picker sat two cards below the box it was about and asked for a
  DIRECTION (मराठी → इंग्रजी, …), which is really two questions welded together because a bare
  target picker would have offered मराठी → मराठी and इंग्रजी → हिंदी, neither of which the API
  accepts. The officer already knows what they pasted, so the source is now DETECTED
  (`apps/web/lib/detectTranslationSource.ts`) and the row — three target names, directly under
  the textarea — asks only which language to translate INTO.
  - **An unavailable target stays visible and DISABLED with a reason**, never hidden: its own
    language ("मजकूर याच भाषेत आहे.") or an unsupported pair ("हे भाषांतर उपलब्ध नाही." — a
    Hindi or English source can only go to Marathi). Availability is asked of
    `isSupportedTranslationPair` per render, so this row never has to be kept in step with the
    pairs `@dgipr/schemas` supports; nothing appears or vanishes under the cursor as they type.
  - **The selected target is DERIVED, not corrected in an effect** — `target` falls back to the
    first pair the current source can reach, so a target that source cannot reach is never what
    gets submitted, not even for the render in between.
  - **Detection is a heuristic for मराठी vs हिंदी and is treated as one.** Latin vs Devanagari
    is a script ratio (the same 0.3 threshold `detectProofreadLanguage` uses) and is reliable;
    the two Devanagari languages are separated by whole-word function words that exist in only
    one of them (को/की/के/से against आहे/आणि/यांनी), Marathi's agglutinated case endings
    (…च्या, …ांनी) against Hindi's oblique plural (…ों), and ळ. Ties go to Marathi. Getting it
    wrong is not cosmetic — a Hindi text sent as `sourceLanguage: 'mr'` reaches a chat prompt
    that calls itself a "Marathi-to-English translator" — so the detected language is SHOWN
    above the row with a one-tap correction beside it, offered only for Devanagari text. The
    correction invalidates a prepared name list and an old result exactly as retyping would,
    and is cleared whenever the text changes.
  - Everything downstream follows from that one value: which language the box's label names,
    whether the name-review step runs (Marathi source only, unchanged), and which targets are
    live. The API is untouched — it always took an explicit `sourceLanguage` and still rejects
    an unsupported pair at the edge.
  - Also: the submit is now a `.card-action` bar and `TranslationTermsReview` a sibling below
    it rather than a child, since `.names-review` carries its own frame and read as a panel
    inside a panel.
  Verified 2026-08-12, all free: `apps/web` typecheck green, lint clean and prettier clean on
  both changed source files (`strings.ts` and `globals.css` report whole-file CRLF complaints
  that are pre-existing — do NOT `--write` them); 11 detector assertions over real Marathi,
  Hindi and English press-note text plus the empty/digits-only defaults; and 26 live browser
  assertions at 1360 and 390 (the row inside and below the input card, three buttons, the
  detected language for each of the three inputs, the disabled target and its stated reason on
  a Hindi source — the reported case — the auto-selected मराठी beside it, the override round
  trip, no override offered for English, no page errors, no horizontal overflow), with the
  name-review panel exercised against a stubbed `/translate/prepare` so no model was called.
  Deploy is web only.

- **The officer's request and heading OUTRANK the specification, and a requested length is
  MEASURED** (2026-08-11, no migration): an officer asked for a 1200-character article in
  **तुमची विनंती** and again in **बातमीत बदल हवा आहे?** on generation `4dc686aa`, and got 400
  characters, then 700. The request was never dropped — it reached the model in both paths and
  was outranked in five separate places, three of which were ours:
  - **The system message said length is irrelevant, and banned the only way to reach one.**
    `no-reference-v2` (the deployed default — `ARTICLE_STYLE_REFERENCES_ENABLED` is unset)
    stated "The article's length does not matter … do not pad, repeat, **stretch**, infer, or
    add unsupported information" as an absolute, in the system message, while the officer's ask
    arrived as one line of a user block. Growing a 400-character article to 1200 IS "stretching",
    so the two did not merely rank against each other — the general rule named the exact
    operation required and forbade it. `ARTICLE_WORD_TARGETS` had also been dead code since
    simple-v3 (no consumer, only a stale `.d.ts`), so nothing gave the model a scale at all.
  - **The heading was hedged, and on the feedback path it did not exist.** It rendered as
    "### OPTIONAL EDITORIAL DIRECTION" + "this **may** suggest an angle … use it **only when**
    the factual information supports it", near the TOP (the weakest position), and the minimal
    variant worded it far more strongly — so the same field carried different authority
    depending on an env line. Worse, `reviseArticle` took `heading` and passed it **only** to
    `findMissingInformation` and `findUnsupportedClaims` as allowed context: `buildRevisionMessages`
    never received it, so the model doing the rewriting had never seen the officer's heading.
    It survived a feedback round by accident.
  - **A numeric ask could not turn on the expansion machinery.** `wantsExpansion()` is a keyword
    regex (मोठ/अधिक/सविस्तर/…, bigger/longer/more…); "१२०० अक्षरे" matches none of it, so
    `expand` stayed false, the expansion instruction was not emitted and `findMissingInformation`
    — the broad sweep that finds unused note material so the article can legitimately grow — was
    skipped. The one shape of feedback that names a length exactly was the one that could not grow.
  - **The revision runs under a different, compression-permissive prompt** (`systemPromptFor`,
    the full pipeline's category prompt: "दुय्यम तपशील संक्षिप्त करू शकता"), whose rules 8/11
    protect exactly the house style an officer asking for simpler language is trying to change.
  - **And nothing ever counted a character.** Every length statement in the repo was prose.
    The fixes, in the repo's standing instruct-then-guarantee shape:
  - **`PRECEDENCE_RULE`** (exported from `simple-article-prompt.ts`, emitted by all three
    specifications) states the order explicitly: **1.** never state an unsupported fact —
    nothing overrides this; **2.** the HEADLINE / ANGLE and the OFFICER REQUEST, followed
    exactly, including length/tone/structure/ordering/emphasis/what to leave out, overriding
    every general instruction including what is said about length; **3.** everything else. The
    length sentence became CONDITIONAL on the officer not having asked, gained a paragraph on
    HOW a requested length may be reached (covering the supplied information more fully, never
    padding, and stopping short rather than inventing), and the blanket "do not stretch" is gone.
  - **`headingBlock`** is shared by all three variants, unhedged, and moved to sit
    **immediately before** the officer request at the END. Both are adjacent on purpose.
  - **`article-length.ts`** — `parseLengthRequest` reads a length out of Marathi or English free
    text (Devanagari + Latin digits, inflected units, ranges taking their upper bound, sane
    bounds so a year or an amount is not a length), `lengthRequirementBlock` restates the number
    to the model inside `officerInstructionsBlock` (so all three variants get it through one
    shared function), and **`fitArticleToLength` MEASURES the output and buys ONE bounded
    rewrite on a miss** — the `shorten-narration.ts` loop. A rewrite that does not get closer is
    discarded; a failure keeps the paid article.
  - **`article-heading.ts`** — `ensureArticleHeading` writes the officer's headline onto the
    article deterministically, after the last model call. `generations.heading` is dual-purpose
    ("शीर्षक द्या, **किंवा** बातमीचा रोख"), and only the headline half can be enforced; nothing
    in Marathi separates a headline from an angle reliably (both are fragments), so
    `looksLikeHeadline` is an admitted heuristic sized off the field's own placeholder — 4+
    words, 15-200 chars, no sentence terminator — erring toward leaving the model's line alone.
    The existing Markdown marker is preserved, since the variants disagree about the output shape.
  - **The feedback path** now renders `<HEADLINE_ANGLE>`, carries it through unless the feedback
    overrides it, states the precedence carve-out against the category prompt's style rules,
    renders the same LENGTH REQUIREMENT block (feedback wins over the stored request), runs the
    length fit and re-applies the heading. `wantsExpansion(feedback, currentArticle)` is now
    directional: a numeric ask ABOVE the current length expands, one below it does not.
  - **When the source cannot honestly fill the ask, the officer is TOLD** — `LengthWarning`
    (`@dgipr/schemas`) → an in-process registry beside `designationWarnings` → `lengthWarning`
    on the detail payload → a Marathi callout on `ArticleView` **and** on `/dlo`'s output step,
    which is where the request was typed. The article is delivered either way; padding a
    government article to hit a count is not an option the pipeline has.
    Fixed in passing, and it had been failing at HEAD: **minimal-v6's length sentence was
    textually broken** — a clause was lost, so it read "…at the length that repeat, stretch, or
    add unsupported information" — and the sentence after it licensed dropping supplied
    information with no exception for material the officer had asked for ("you can even skip
    some infromation"). Its own harness reported three failures on this; all three now pass, and
    one of them (`invention is forbidden`) was asserted against a sentence the variant had never
    carried — `PRECEDENCE_RULE` now genuinely supplies it.
    Versions: `simple-v13`, `minimal-v7`, `no-reference-v3` (persisted per run in
    `style_reference_meta`, so output stays attributable). Verified 2026-08-11, all free:
    workspace typecheck **7/7 green**, lint clean on all 15 touched files, and **seven harnesses
    green** — the two new ones (`article-length`, `article-heading`), the three prompt variants,
    `article-dateline`, and a new `tsx src/generation/revise-article.ts --check` pinning the
    feedback path (the heading reaching the rewriting model, the precedence carve-out, the
    directional numeric expansion, and feedback-over-stored-request). **Left for a real run**
    (model spend): one /dlo article with "बातमी १२०० अक्षरांची हवी" in तुमची विनंती, confirming
    the `[article-length]` rewrite fires and either lands in band or surfaces the callout; one
    feedback round with a heading set, confirming it survives; and one "शासकीय शैलीत बातमी तयार
    करा" run. **No migration, no n8n**; deploy is `@dgipr/schemas` → `@dgipr/content-engine`
    dists → API + web (ship together — `lengthWarning` is a shared payload field, though its
    schema default keeps a half-deploy from breaking).

- **चॅट (`/chat`) — a general assistant, with no system prompt** (2026-08-11, migration 0044):
  every surface in this platform is a narrow pipeline (a note in, an article/poster/transcript
  out). There was nowhere to just ASK something — draft a covering letter, explain a GR, read a
  photograph, summarise a forwarded PDF — so officers did that work in ChatGPT, outside the
  platform. `/chat` is that catch-all: a conversation, the file intake the rest of the product
  already has, and stored chats in a left rail.
  **The defining decision is that there is no system prompt at all**, taken deliberately with
  the user. Every other call here opens with a page of DGIPR rules because every other call has
  one job; this one does not have a job, and any house prompt could only narrow what it is able
  to help with (a Marathi-first instruction would answer an English question in Marathi; a
  government-assistant persona would hedge on ordinary work). The consequences were accepted
  and are written into `chat/misc-chat.ts`: this page does NOT inherit the glossary's
  spellings, the never-invent rules or the Marathi-first contract, and anything meant for
  publication belongs on /dlo or /proofread. If that file ever grows a `SYSTEM_PROMPT`, it is a
  product decision to take with the department, not a tidy-up.
  Almost nothing was written twice, which is the point:
  - **Streaming already existed.** `chatCompleteStream` (`openai-chat.ts`) had the SSE parsing,
    `stream_options.include_usage` and the non-streaming fallback; it was widened to accept
    `MultimodalChatMessage` (an image can arrive on ANY turn, which `chatCompleteVision`'s
    one-prompt-one-image shape cannot express) and a `lane`. Widening the INPUT type left all
    ~40 existing call sites untouched.
  - **So did the lane mechanism.** `openai-request.ts` already had `default` (1) and `ocr` (4);
    a third, `chat` (`CHAT_MAX_CONCURRENCY`, default 4), is what keeps a WATCHED answer out of
    the pipeline's serialized queue — and, just as much, keeps an officer's article out from
    behind someone else's chat. The lane travels with the fallback too: without that, a
    streaming failover would land in the default lane and block a generation. Expect chat to be
    where 429 warnings appear first on a small org; that is the retry ladder working.
  - **Audio and YouTube needed no new code.** The composer drives the existing
    `/api/transcriptions` job, which brings the 0031 content-addressed cache with it — a
    recording transcribed on /transcribe is instant here and vice versa. The visible cost is
    that a chat recording also appears in /transcribe's history; the composer hint says so
    rather than letting it surprise someone. Documents go through the shared `<DocumentIntake>`
    in live mode, so a scanned PDF gets its page picker in the composer and **no page is OCR'd
    unless it was ticked**.
  - **Only images keep bytes** (the existing public posters bucket, `chat/` prefix); every
    other kind is reduced to TEXT at attach time, so reopening a chat re-extracts and
    re-transcribes nothing. An `imageUrl` from the client is accepted only if it starts with
    our own bucket prefix — the field is otherwise an invitation to make the model fetch an
    arbitrary URL.
  Four things worth knowing before changing it. **ATTACH → PREPARE → SEND**: send is disabled
  while anything is uploading, unread or transcribing, so a turn is never half-prepared. The
  turn route persists the USER message before anything can fail and stores a PARTIAL answer on
  failure — those tokens are paid for. **The hook owns thread creation**, because the obvious
  arrangement (create the thread, re-key the hook on the new id) makes the reload effect fire
  and replace the optimistic user message with the server's still-empty list; the URL is
  therefore set with `history.replaceState`, since `router.replace` would remount the tree and
  kill the stream being watched. And the SSE route writes to `reply.raw`, which bypasses
  Fastify's reply pipeline: the **CORS header is written by hand** (without it the browser
  rejects a stream the server is producing perfectly) and `X-Accel-Buffering: no` is set
  (without it Caddy buffers the whole answer — streams fine locally, arrives in one lump in
  production).
  `dgipr.chat.mine` is ORDERING ONLY and must never become auth: every chat is readable and
  openable by anyone, which is why the rail says so out loud rather than letting a surface that
  FEELS private be assumed private.
  **Deliberately excluded**: no `/analytics` card (`UsageFeature` is a closed six-value union
  and a seventh feature means an aggregator, a card and a drill-down page; per-message
  `cost_usd` is stored, so the history is there to build on), no glossary, no RAG, no thread
  rename, no model picker.
  Verified 2026-08-11: workspace typecheck **7/7 green**; lint clean on all 20 touched files;
  prettier clean on every file I created, and `globals.css`'s only complaint is the
  pre-existing CRLF — normalised, prettier's output is byte-identical to it, so do **not**
  `--write` it. Live against a database **without 0044 applied** (the 0028 blast-radius
  standard): the routes register, the image upload runs end to end and returns a CDN URL
  matching the route's own prefix guard, every input guard answers in Marathi (no file, wrong
  type, unknown thread), and only the two table-backed queries 500; `/chat` renders 200 with
  the rail, composer and empty state. **Left for a real run** (0044 applied + model spend): a
  streamed answer, one of each attachment kind, थांबवा mid-answer then reload, deletion, and a
  1360/390 render pass. Deploy: **0044 → `@dgipr/schemas` → `@dgipr/database` →
  `@dgipr/content-engine` dists → API + web** (API and web ship TOGETHER — the SSE event
  framing is a shared contract). No n8n. New env, all optional: `OPENAI_MISC_CHAT_MODEL`,
  `OPENAI_MISC_CHAT_REASONING_EFFORT`, `CHAT_MAX_CONCURRENCY`.

- **A photograph of a document is a /dlo source** (2026-08-11, no migration, no n8n): officers
  photograph GRs, notices, letters and tables with a phone as readily as they scan them, and
  until now that material had to be turned into a PDF first. `/dlo`'s intake form gains a
  **प्रतिमा / छायाचित्रे** card (JPG/PNG/WEBP, 50 MB each, no count limit) below the recordings
  and YouTube cards, and the text comes back at the तपासणी step as an ordinary editable source.
  - **One prompt, not two.** `openai-doc.ts`'s system prompt became
    `ocrSystemPrompt('page' | 'image')` — the opening two lines and ONE fidelity bullet differ,
    and everything about names, numerals, tables and format is shared, so a phone snap is held
    to exactly the rules the same document scanned as a PDF is. The page variant is byte-identical
    to what shipped. `image-ocr.ts` is the transport: same `OCR_MODEL`, same serialized `ocr`
    lane, same cost meter.
  - **No migration, and the reason is the design.** `files` is jsonb on `dlo_intakes`, so
    `kind: 'image'` was additive; the text lands in `text` exactly as a DOCX's does, so
    `DloSourceReview`, `combineIntakeSources`, `assembleDloText`, lineage and `/:id/generate`
    needed **no changes at all**. Images ride the SAME multipart `files` field as the
    recordings — the route classifies each part by extension, so a second field would have
    been a second way to say the same thing.
  - **Read by the JOB, not at the input step**, which inverts the document rule deliberately: a
    PDF stops at a page picker because OCR is billed per PAGE and the officer decides which are
    worth it, and an image IS one page — there is nothing to choose, so the only thing a wait in
    front of the form would buy is the wait. It is metered like the PDF read (`document_ocr`).
    Empty text is a real answer ("this photograph contributed nothing"), reported as a callout,
    **never** a failed file.
  - **Images always go through OpenAI, ignoring `OCR_PROVIDER`.** That flag is the PDF rollback:
    it picks between two backends that both take a PDF, so honouring it here would mean a second
    image path that runs only in a configuration nobody uses — i.e. the path that is broken on
    the day it is finally needed.
  - **`sharp` normalises before the call, and NOT for accuracy** — that was measured: a 3000 px
    and a 1000 px render of the same page read equally well. It is there for EXIF auto-rotation
    (a phone held upright writes a landscape image plus "rotate me", and ignoring the tag means
    reading the page sideways) and to make the request deterministic and bounded. Failure to
    normalise degrades to sending the original bytes, never to losing the source.
  - **The review card shows the photograph BESIDE its editable transcript**
    (`.image-review`), served by a new `GET /dlo/intakes/:id/files/:index/image` — a proxy
    rather than a URL because `dlo-uploads` is PRIVATE, gated on a `canPreview` flag that keys
    off the archived BYTES rather than the kind so a thumbnail can never 404.
  - **The 10-document cap is gone** (`DloCreateDocumentsSchema`, the form's `MAX_DOCUMENTS`,
    and the route's busboy `files` limit), at the operator's request and for a reason worth
    keeping: busboy's `files` limit does not reject, it silently STOPS emitting parts, so a
    capped intake quietly dropped sources the officer had watched upload. Per-file
    `UPLOAD_FILE_MAX_BYTES` and the 64 MiB `documents` field are the limits that remain.
  - **Known, measured, and NOT introduced here: Devanagari digits are unreliable.** On a
    calibration page the prose and the Markdown table came back perfect while `₹२ कोटी`→`३२`,
    `६५.५`→`६६.५`, `९८०`→`१८०`, `७१५`→`७२५`. The **deployed PDF path makes the same errors on
    the same page** (verified by wrapping the image into a 1-page PDF and reading it through
    `extractPdfPagesDetailed`), so this is a property of the OCR model on Devanagari numerals
    that every scanned GR already goes through — images are at parity, not a regression.
    `reasoning_effort: 'high'` was tried and did not help (`OPENAI_OCR_REASONING_EFFORT`,
    default unset). The prompt gained a digit-by-digit rule telling the model to write
    [अस्पष्ट] rather than the closest-looking digit; the officer's review step remains the only
    real guard, which is precisely why the image is shown beside its text.
  Verified 2026-08-11: workspace typecheck **7/7 green**, lint clean on all touched files;
  a live OCR run on a Marathi calibration page (headings, prose, a 3-column table, Devanagari
  numerals) returning correct Markdown; and a live API E2E — a `.bmp` refused with the Marathi
  message, a real photograph creating an intake, reaching `ready` through `extract`, landing as
  `kind: 'image'` / `status: 'done'` / `canPreview: true` with its table intact under the
  `=== स्रोत: … ===` header, the thumbnail route answering 200 `image/png` with
  `cache-control: private`, and both its guards 404. **Left for a real run**: a genuine
  officer's phone photo (angled, shadowed, EXIF-rotated) end to end. New harness:
  `tsx --env-file=../../.env src/intake/image-ocr.ts <photo.jpg>`. Deploy is
  `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine` dists → API + web (ship
  together — `canPreview` and `kind: 'image'` are a shared contract).

- **The video stitch stopped loading the whole video into RAM at once** (2026-08-10, no
  migration, no n8n, API only): a production run died at the one step that spends nothing —
  `Final video assembly failed validation after 2 attempts: Video stitch was stopped by
SIGKILL: it was killed by the operating system, most likely out of memory.` Both attempts
  were killed, which is the signature of a deterministic resource ceiling rather than a
  flake. The cause is the shape of the ffmpeg command, and it had been latent since the
  2026-07-29 assembly rework: `assembleSilentVideo` took EVERY clip as a simultaneous input
  to one filter graph and joined them with the concat **filter**. The ffmpeg CLI reads
  packets from whichever input has the earliest DTS, and every clip starts at 0, so it
  decodes them all at once — while the concat filter consumes only the segment it is
  currently on, leaving every LATER segment's frames sitting decoded in that input's queue.
  Peak memory therefore grew with the length of the whole video, on a small instance shared
  with n8n and Chromium. **Measured on the real command shape**, 8x15s at 720p with captions:
  **6.53 GB peak RSS**. Nothing about it was a leak or a bad flag; the graph was simply
  asking for the entire decoded timeline at once (~4 GB of raw frames at 720p, ~9 GB at
  1080p), plus a full-frame RGBA still per looped caption PNG.
  - **Each scene is now encoded on its own, and the normalized segments are joined by the
    concat DEMUXER with `-c copy`.** That bounds the memory at ONE clip regardless of the
    video's length — the demuxer opens the finished segments strictly in sequence. Same job,
    same machine: **500 MB peak RSS (13x lower) and 19s instead of 60s**, the speedup being
    the decoding that is no longer thrown away.
  - **The demuxer is safe here only because of the pass above it**, which is the thing not to
    undo: every segment is written by the same encoder at the same resolution, frame rate,
    pixel format, SAR and profile (`SEGMENT_ENCODE_ARGS`, applied to the outro segment too),
    so their stream parameters are identical by construction. x264 derives its level from
    resolution + frame rate + DPB, never from content. Concatenating PROVIDER clips directly
    — mixed 720p/1080p, provider timestamps — is the unsafe thing the 2026-07-29 milestone
    correctly moved away from, and is not what this does. Source clips are still always
    re-encoded; only the segments this function itself just wrote are copied.
  - **Captions are clipped into their own segment's time base.** The windows arrive on the
    final timeline (from `sceneTimings`, the same function the SRT is built from), so each is
    intersected with its scene and shifted, `enable`'s `t` being segment-local after `setpts`.
    A side benefit: caption drift can no longer accumulate across scenes, because each is
    bound to its own segment rather than to a running total of declared durations.
  - **A looped still is now finite (`-t`) and sized off the MEASURED clip length**, not the
    declared one. Finite is what stops it being the endless input it was; measured is what
    stops `shortest=1` silently trimming a clip that decoded longer than its billed window —
    the duration gate only checks the minimum, so that trim would not have been caught.
    `assertStreamDuration` already decoded each clip, so the real length was free.
  - Every segment is duration-gated as it is written, so a defect names the scene it came
    from instead of surfacing as a short total.
    Verified 2026-08-10, all free: workspace typecheck **7/7 green**, lint + prettier clean;
    all four harnesses green (`video:preview:captions` at 720p asserting the panel on-frame at
    the documented 13.6%, `--vertical`, `video:preview:assemble` incl. its one-frame rejection,
    and `video:preview:narrate` with unequal 5s+12s windows); and a measured 8x15s 720p job
    where old and new outputs are **frame-for-frame identical in every stream parameter** —
    3054 frames, 2:02.16, 1280x720, High/yuv420p, SAR 1:1, 25 fps, 12800 tbn — with sampled
    frames confirming the caption panel on all eight scenes and none on the outro, the lockup
    on the scenes and not on the outro, a half-scene caption window landing on exactly its own
    half, and a deliberately under-declared 6s clip surviving at its full length. Deploy is
    `@dgipr/poster-renderer` dist → API; no web change. Re-stitching an existing project needs
    no re-render — the **क्लिप्स पुन्हा जोडून व्हिडिओ तयार करा** button on a completed project
    reuses the stored clips and cached narration, so the failed run can be recovered for free.

- **The bottom edge is an edge, not a reserve — and a free-colour poster must be BRIGHT**
  (2026-08-10, no migration, no n8n, API only): generation 97b64542 came back with a tenth of
  the poster given over to a dead grey band above its own footer, and the artwork itself almost
  black. Measured on the real PNG before anything was changed: 1280x1691, content ending at
  y=1518, a flat #EAEAEA band from 1518 to 1600 (**82px the model painted**) with the appended
  91px strip filled from that same grey — **173 dead pixels** — and a mean luminance of 153/255
  with 37% of pixels below 80. Two independent causes, both in the prompt.
  - **The margin asked for a void.** The 2026-08-10 append milestone (below) correctly stopped
    the band covering text, but the sentence it left behind still described the bottom as
    something to keep clear: _"Keep only the last 48 pixels as calm, plain, even background in
    the poster's own colours"_, with the content floor listing **panels and photographs** among
    the things that must END above it. That is the same over-reach the badge corner had a few
    hours earlier — a rule that forbids the BACKGROUND from reaching the zone — and it produced
    the same artefact one edge over. It also asked for a pixel figure, which an image model has
    no way to measure and therefore overshoots: 48 became 82 (1.7x).
    So the bottom is now the badge corner's rule turned sideways. `reservedZoneBlock`'s appended
    branch says **DESIGN ALL THE WAY DOWN TO THE VERY BOTTOM EDGE** (colour blocks, panels,
    gradients, background and photographs reach the last row and run off it, exactly as at the
    left and right edges), **THERE IS NO COLOUR RESTRICTION AT THE BOTTOM** (dark, saturated,
    patterned or photographic; it need not be pale, white, neutral, plain or empty), and only
    then a text rule — no words, numerals, captions or icons below the floor. The margin drops
    **48 → 16px** and is documented as a typographic cushion so the last line is not jammed
    against the band, not as a background reserve. `fitToReserveRule`'s appended consequence
    follows, and drops _"a worse failure than any amount of empty space"_ — true on an overlay
    lane where the alternative is a buried sentence, and now the opposite of what this lane wants.
    The **16 is deliberately not 0**: nothing is lost at 0 (the band is appended), but a line
    touching the band reads as broken, and 16px of cushion costs nothing next to the ~43px of
    poster-coloured strip that already shows either side of the navy pill (the band's artwork is
    only ~56% opaque across its top 43px — measured).
    Downstream, `footer-extension.ts`'s **stretch-and-soften path is now the expected one** rather
    than the exception, since a bottom edge split between a dark column and a photograph is
    ordinary. No code change there — it already handled it — only the comment, which claimed the
    prompt asks for a flat edge.
  - **"Strong contrast" is satisfied by white-on-black.** The fixed-template lane tells the model
    the reference controls structure and not colour, and its entire colour guidance was _"choose
    freely and creatively; ensure strong contrast and easy readability"_. New `BRIGHT_LOOK_RULE`
    names which SIDE of the contrast the large areas sit on: a light, luminous ground over most
    of the poster, saturated confident colour in panels/headings/figures/icons, dark tones as
    accents only, no black or near-black panel as the main surface, and photographs bright and
    naturally lit rather than desaturated or scrimmed. Emitted immediately after the free-colour
    clause it qualifies. **Deliberately NOT on the `fresh` lane** — there `fmtColourSpec` assigns
    exact hexes (all 18 palettes are light-ground by product decision), and a second voice telling
    the model to brighten them would licence departing from a specification whose whole point is
    that it is not negotiable. Harness-asserted in both directions.
  Verified 2026-08-10, all free: workspace typecheck **7/7 green**, lint and prettier clean on all
  four touched files, four prompt harnesses green (`reserved-zone-rule`, `build-poster-prompt`,
  `build-youtube-thumbnail-prompt`, `build-article-poster-prompt`, plus `clear-space-rule`) with
  new assertions that **deny** the exact wording that caused the band (`calm, plain, even
  background`, `end all text, cards, panels, icons, photographs`) — check those first if a flat
  strip ever returns above the footer; and an offline render on a deliberately NON-flat bottom
  edge (dark left column, warm block right) confirming 1280x1691 out, the strip continuing the
  dark column's own colour rather than a grey fill, and **1280x1691 again on re-stamp** (the
  feedback-round idempotence). **Left for a real run** (one image charge): a ठरलेले टेम्पलेट
  poster on the same note, confirming the design reaches the bottom edge and the poster comes back
  light-ground. Overlay lanes (article poster, YouTube thumbnail) are untouched — they leave
  `footerAppendedMargin` unset and keep their wording byte-for-byte. Deploy is
  `@dgipr/poster-renderer` → `@dgipr/content-engine` dists → API; no migration, no n8n, no web.

- **The reserved corner is kept clear of CONTENT, not cut out of the ARTWORK** (2026-08-10, no
  migration, no n8n, API only): a live ठरलेले टेम्पलेट poster came back with its navy header
  panel STOPPING SHORT of the top-right badge, leaving a pale notch of page ground around the
  stamped emblem — a visibly broken corner on an otherwise correct poster. The prompt asked for
  it. `reservedZoneBlock` paired two sentences that contradict each other:

  > "Leave that corner COMPLETELY EMPTY of content and continue the image's immediately
  > surrounding background through it seamlessly…"
  > "Do NOT create a separate colour, white space, patch, box, **panel**, **band**, reserved-space
  > marker, or visible boundary there, and NO text, numbers, logos, photographs, faces, people,
  > objects, icons, borders, **shapes**, or decoration may enter, sit behind, or **CROSS** it."

  A header block IS a panel/band/shape, and to reach the right edge it must CROSS the corner — so
  the second sentence forbids in as many words the thing the first one asks for. The list is
  concrete and the word "background" is not (a model reads it as the page ground, not as whatever
  layer occupies that edge), so the list won. Note this is not the 2026-08-04 reserved-zone work
  regressing: that fixed content being BURIED and a second painted badge; this is the opposite
  failure, the zone being honoured by cutting a hole.
  The rule is now split along the axis that matters — **information vs ground** — in three shared
  sentences (`continuityRules`, used by both lanes so the wording cannot drift): background layers
  (colour blocks, panels, bands, gradients, photographs, textures) MUST run into the zone and
  continue through unbroken, because the branding is opaque and lands ON TOP so there is nothing
  to make room for; the failure is NAMED (`DO NOT CUT A HOLE IN IT`; never notch, inset, step,
  clip or stop a panel short of it; never leave a paler/blank rectangle there), these prompts
  responding far better to a described defect than to a prohibition; and only content that
  carries meaning or draws the eye stays out. `panel`/`band`/`borders`/`shapes` survive only in
  the "do not CREATE something new there" sense, which is a different sentence from "do not let
  an existing element reach it". The headings lose the word EMPTY (`RESERVED BADGE CORNER` /
  `RESERVED BRANDING ZONES`) — it is the word that makes a model blank the area.
  Three consequences worth keeping. **All three lanes are fixed at once** (social, article-poster
  overlay, YouTube thumbnail) because they share the function; the article `fresh` path already
  had this right in its own `RESERVED_ZONES` string ("Ordinary background colour, gradients,
  textures… SHOULD continue naturally through these zones; do not leave them plain, white, empty
  or cut away solely for the branding") and is untouched — that string was the model for the
  rewrite. `CHROME_FREES_NO_SPACE` carried the same over-reach in miniature ("…or any other
  content into either reserved zone", which forbids the background too) and now names text and
  focal content, with the continuation stated explicitly — so the FEEDBACK lanes, which reach it
  through `stampedChromeRule`, cannot notch the corner on a re-render either. And the guarantee
  is the harness: `reserved-zone-rule.ts` now asserts on all three geometries that the block
  demands the background continue through, names the hole, and **denies** the five exact strings
  that caused it (`COMPLETELY EMPTY`, `may enter, sit behind, or cross`, `shapes, or decoration`,
  …), with the same needles asserted on the assembled onbrand, fresh and thumbnail prompts. If a
  notched corner ever comes back, check those first.
  Verified 2026-08-10, all free: workspace typecheck **7/7 green**, lint clean and prettier clean
  on all three touched files (the residual complaint in `build-youtube-thumbnail-prompt.ts` is at
  untouched pre-existing lines — do NOT `--write` it), and five harnesses green
  (`reserved-zone-rule`, `build-poster-prompt`, `build-youtube-thumbnail-prompt`,
  `build-article-poster-prompt`, `clear-space-rule`). **Left for a real run** (one image charge):
  a ठरलेले टेम्पलेट poster on a note with a full-width coloured header, confirming the header runs
  edge to edge behind the badge. Deploy is `@dgipr/content-engine` dist → API; no migration, no
  n8n, no web change.

- **The social footer is APPENDED below the artwork, not pasted over it** (2026-08-10, no
  migration, no n8n): a live ठरलेले टेम्पलेट poster shipped with the fifth bullet of a
  five-point note buried under the navy title pill — the sentence simply ends mid-word. The
  geometry was not out of sync (the prompt reserved 120px where `overlayTwitterChrome` stamps
  ~91px, i.e. 29px of slack); the model just laid content ~60px past the floor. **This had
  already been fixed once at the prompt layer** (the 2026-08-04 reserved-zone milestone gave
  `fitToReserveRule` its priority/consequence/action) and it happened again, which is the
  finding: the reserve could only ever be a request. An image model has no ruler — `y=1480` is
  close to inert — and the same prompt says three times over to show every point and match the
  reference's density. There was, and deliberately still is, **no post-render check**: the
  prompt correctly asks for background to continue through the zone, so a cheap ink metric
  cannot separate the failure from the required behaviour.
  So the band stops being an overlay. `packages/poster-renderer/src/footer-extension.ts` adds a
  strip BELOW the artwork and `overlayTwitterChrome` stamps the band there, making a finished
  social poster **1280x1691** instead of 1280x1600. Nothing the model paints can be covered,
  however badly it ignores the reserve — the deterministic-guarantee-behind-an-instructed-rule
  shape the repo already uses (Chromium typesets the Devanagari; `lock-scheme-names` repairs a
  truncation the prompt merely asked for). The **badge is untouched** and is still a destructive
  overlay: a corner almost never holds the tail of a sentence.
  Six things worth knowing:
  - **The join has to be invisible or this trades one ugly poster for another.** The band's
    artwork is transparent around its navy pill, so the added strip shows either side of it.
    `readBottomEdge` samples the bottom 24 rows: a near-uniform edge (the normal case, and what
    the prompt still asks for) gets a flat fill at their MEAN — the mean rather than the last
    row, because one row can carry a stray antialiased pixel and a hairline of the wrong colour
    along the join is exactly the artefact being avoided; a textured edge gets the last 6 rows
    stretched down and softened, which continues a gradient and gives a photograph a plausible
    falloff. Measured on four synthetic bottom-edge shapes: seam Δ **0.0 / 0.0 / 1.0 / 2.5** out
    of 255.
  - **Idempotence is decided by ASPECT, not a flag or a stored dimension.** Feedback edits the
    poster this function last produced, which already carries its strip; extending
    unconditionally would grow the poster ~91px every round. A fresh render comes back at the
    artwork's 4:5, a finished one at 4:5-plus-a-strip, and the nearer of the two wins — aspect
    rather than absolute height because the model is not contractually bound to return 1280 wide
    and everything else in that file already scales off the width it actually got.
  - **The prompt had to stop asking for a void.** (**48px and the "calm and plain" wording are
    SUPERSEDED — see the milestone above: it is 16px and a TEXT cushion, because this version
    still asked for a plain background there and got 82px of flat grey.**) Left as-is, the model
    would still clear ~120px
    the band no longer occupies and the poster would come back letterboxed above its own footer.
    `ReservedZoneGeometry.footerAppendedMargin` (48px) switches `reservedZoneBlock` and
    `fitToReserveRule` into a mode where the bottom is a **JOIN, not a cover zone**: design down
    to the edge, keep only the last 48px calm and plain so the seam does not show. 48 lands the
    finished gap close to what the old reserve INTENDED (content to 1480, band from 1509 — 29px),
    and overshooting it now costs breathing room instead of a sentence. Unset = overlay mode,
    byte-for-byte unchanged, which is what the article-poster and YouTube-thumbnail lanes keep.
  - **The prompt must also stop CLAIMING the band covers things.** A threat the model's own
    render disproves teaches it that this prompt's threats are negotiable, so the appended
    consequence says what is actually true (the band butts against whatever the last 48px
    contain) and the badge keeps its `COVERED AND LOST`. Harness-asserted both ways.
  - **The feedback lane is the exception and still reserves the band for real** — it edits a
    finished poster and the band is re-stamped in place over the bottom of it. It now quotes
    `SOCIAL_ZONES.footerHeight`, which was changed 120 → **91, the band's true footprint**; do
    not "restore" it to 120, which would push content up 30px every round and drift the layout.
    The feedback prompts also stopped saying "4:5 portrait poster" (their input is 0.757 now) and
    ask for the input's exact width and height.
  - **The C-tier cause is fixed too: the headline.** The failing poster's headline took roughly a
    third of the canvas. `fitToReserveRule` does say "shrink the HEADLINE first", but on the
    onbrand lane it is reached through `allowStructuralReflow`, which offers a paragraph of
    re-layout options ahead of it. A `KEEP THE HEADLINE PROPORTIONATE TO THE REST` rule (≤2-3
    lines, ≤~¼ of the height, reduce it before anything else) now sits **beside the completeness
    pressure it has to answer**, so it acts before the layout is committed rather than as a remedy.
  **CMO is deliberately untouched** (`overlayCmoChrome`, a different function and canvas), as are
  the article-poster and YouTube-thumbnail lanes — same structure, far lower risk, and worth doing
  separately. Verified 2026-08-10, all free: workspace typecheck **7/7 green**, lint + prettier
  clean on all four touched files, both prompt harnesses green (with new assertions for the
  appended lane, the letterbox guard, the no-bluff check and the headline cap), and an offline
  render check on four bottom-edge shapes confirming 1280x1691 out, **1280x1691 again on
  re-stamp**, both fill branches firing, and the reproduced failure case ("used to be buried")
  fully visible above the band. **Left for a real run** (one image charge): a live ठरलेले
  टेम्पलेट poster on the same long note, then one feedback round on it to confirm the poster does
  not grow. Deploy is `@dgipr/poster-renderer` → `@dgipr/content-engine` dists → API; no
  migration, no n8n, no web change (`.poster-frame` sets no aspect ratio, and the 4:5 rules in
  globals.css are the reference-library thumbnails, whose masters are still 1280x1600).

- **The database is our own Postgres on RDS, behind our own PostgREST** (2026-08-09, no
  migration, no application code change): the Supabase free-tier project
  (`scmwebkxoftkqdyujibw`) was over quota and due to be restricted the same day, so the
  database followed the storage migration off Supabase. **Nothing in `packages/*` or
  `apps/*` changed.** That was possible because of a property worth keeping: the entire
  coupling is 56 single-table queries plus ONE RPC, all inside
  [packages/database/src/](packages/database/src/) (the sole exception being
  `what-changed/find-topic-articles.ts`), with **no joins, no `.auth`, no realtime, no
  edge functions**, and every consumer importing `SupabaseClient` as a TYPE from
  `@dgipr/database` rather than from `@supabase/supabase-js`.
  So the move was chosen to preserve the WIRE PROTOCOL rather than rewrite the queries:
  **PostgREST is the same software Supabase runs**, so pointing `SUPABASE_URL` at our own
  instance keeps all 56 queries behaving byte-for-byte. The alternative — rewriting
  `packages/database` onto the `pg` driver — remains the right end state and is now
  strictly easier, because it can be done one file at a time and **diffed against a
  working PostgREST**. It was deliberately NOT attempted on deadline day, with no test
  suite, against the shapes this repo has repeatedly found to be silent breakers
  (`maybeSingle` vs `single`, `head:true` counts, `ignoreDuplicates` upserts, jsonb
  omit-unless-present, the 1000-row paging cap).
  - **Target**: RDS PostgreSQL 17.10, `db.t4g.small`, 20 GB gp3, encrypted, 7-day backups,
    single-AZ, **`PubliclyAccessible=false`** in the EC2's own VPC (`vpc-08bfbd30046bfebf9`,
    us-east-2). The VPC has no private subnets — all three are public — so it is the
    **publicly-accessible flag, not the subnet, that withholds the public IP**. The SG
    (`sg-0bf2ce65bf33adb0a`) allows 5432 from the EC2's SG only.
  - **pgvector was the one gating risk** and is cleared: RDS ships **0.8.2**, and 0019/0039
    need ≥0.7 for `halfvec`, `subvector`, `l2_normalize` and `hnsw ... halfvec_cosine_ops`.
    `describe-db-engine-versions` does **not** expose extension versions, so this cannot be
    pre-checked from the CLI — provision, then `select ... from pg_available_extensions`.
  - **Restore, not migration replay.** The plan had been to replay `0001…0043` because
    AGENTS.md recorded migrations applied by hand and at least one (0041) as never applied.
    The schema dump disproved that: **all 43 are applied**, including
    `generations.instructions`. So the dump IS the current schema and restoring it
    reproduces production exactly. The extension also turned out to live in **`public`**
    (`public.halfvec`), not Supabase's `extensions` schema, so the dump needed no rewriting
    — only `create extension vector` on the target first.
  - **Getting the bytes out has two traps.** The direct endpoint
    `db.<ref>.supabase.co` is **IPv6-only** (AAAA, no A record), unreachable from most
    machines and from Docker; the session pooler (port **5432** — the 6543 transaction
    pooler cannot serve `pg_dump`) is the usable path. And the pooler host is
    region-specific: `aws-1-ap-northeast-1.pooler.supabase.com`, user
    `postgres.<ref>`. The region is discoverable by matching the direct endpoint's IPv6
    against AWS's published ranges. The pooler distinguishes the two failure modes
    precisely — `(ENOTFOUND) tenant/user ... not found` means wrong cluster,
    `password authentication failed` means right cluster — which is how the endpoint was
    found.
  - **RLS is the silent-failure risk, and is why `service_role` MUST keep `BYPASSRLS`.**
    Every table has RLS enabled with **zero policies** (0002), so a `service_role` without
    that attribute returns **zero rows with no error** on every query — the worst possible
    failure shape. `postgrest-roles.sql` therefore sets it explicitly AND re-asserts it on
    every run, and verification asserts real row COUNTS rather than HTTP 200s.
  - **supabase-js hardcodes a `/rest/v1` prefix** and PostgREST serves at the root, so a
    path-strip sits between them: `deploy/pgrst-proxy.Caddyfile` (`handle_path`) in a
    **separate `pgrst-proxy` container**, deliberately NOT a route in the public
    `deploy/Caddyfile` — that file terminates TLS for api/n8n and a syntax error in it would
    take the site down. Neither PostgREST nor the proxy is published; `api` reaches them
    over the compose network only.
  - `SUPABASE_SERVICE_ROLE_KEY` is now a JWT we sign ourselves (`role: service_role`,
    HS256, `PGRST_JWT_SECRET`) — a different token of the same KIND, which is the reason no
    code changed. **Rotation = change `PGRST_JWT_SECRET` and re-mint.**
  - **Verified**: row counts on all 11 tables match the pre-migration baseline exactly
    (37,811 / 429 / 178 / 285 / 113 / 17 / 141 / 41 / 22 / 14 / 295); 7 FKs, 11 RLS tables,
    27 indexes; the restore's **only** error was `schema "public" already exists`; the
    vector RPC returns the **identical top-5 chunk ids at identical similarity** on both
    databases; `service_role` has S/I/U/D on all 11 tables and EXECUTE on the RPC; PostgREST
    returns matching counts through the proxy; and after cutover `/api/generations`,
    `/api/generations/:id`, `/api/analytics`, `/api/glossary` (incl. the `ilike`+`or`
    search), `/api/references`, `/api/reference-types`, `/api/dlo/intakes`,
    `/api/transcriptions` and `/api/video/projects` all return 200 with **zero errors** in
    the api and postgrest logs. **Not yet exercised live: a real generation** (the RAG
    retrieval + write path end to end) — verified at SQL and permission level only, because
    it costs model spend.
  - **Rollback**: `deploy/.env.prod.bak-presupabase-migration` on the box holds the
    pre-cutover values; restore `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` and
    `docker compose up -d api`. Valid only while the Supabase project still exists.
  - **Local dev / the ingestion scripts now need a tunnel** — RDS has no public IP and
    PostgREST is internal-only. This is the one workflow that got harder; see
    `docs/database-on-aws.md`.


- **The dateline belongs to the BODY, and the progress list stopped promising phases that
  never run** (2026-08-05, no migration): after `ARTICLE_STYLE_REFERENCES_ENABLED` made the
  no-reference specification the default, a real news run (generation `0266d4eb`) published
  its HEADLINE as `मुंबई, दि. ५ : एसटीचा निम्मा ताफा … आढावा` with the same dateline correctly
  opening the body underneath it. Two causes, one in each half of the "instruct + guarantee"
  pair the repo always builds in.
  - **The guarantee had a `#`-shaped assumption.** `ensureArticleDateline` found the body as
    "the first non-empty line that is not a Markdown heading". That is only correct while the
    model emits `# शीर्षक` — and `no-reference-v1` asked for "the headline on the first line"
    with no marker at all (so does `minimal-v6`), so the headline itself matched the body test
    and got the dateline prefixed. It now detects the headline **without depending on the
    marker**: a `#` heading, or a standalone opening line that has an article under it and does
    **not close a sentence**. That last test is the discriminator and the only reliable one —
    a Marathi headline is a fragment, a body paragraph always closes with `.`/`।`; length is
    not usable (a real DGIPR headline runs past 110 characters). It also **strips a dateline
    that landed on the headline**, so an already-broken row heals on its next feedback round
    rather than growing a second dateline. Free harness (7 new cases, incl. the exact
    production string and a two-pass no-op): `tsx src/generation/article-dateline.ts`.
  - **No prompt had ever said where the dateline goes.** The shared `### DATELINE` block
    rendered the value and nothing else, so "start the article with this" is read literally by
    a model whose article starts with a headline. It now says it opens the FIRST BODY
    PARAGRAPH, never the headline, once (`simple-v12`, reaching every variant through the
    shared user message). `no-reference-v2`'s system message additionally states the OUTPUT
    SHAPE — `# शीर्षक`, blank line, body — which fixes a second silent defect that shipped
    with v1: a plain first line is not a heading to `MarkdownText` or to
    `article-pdf-template.ts`, so the headline was rendering as body text on screen and in
    every exported PDF.
  - **The progress list was describing the wrong pipeline.** `ProgressSteps` hardcoded the
    six-stage `full` list, so a `simple` run showed five phases that never happen — and,
    worse, the row's `retrieve` is not in that list at all, so `indexOf` returned -1 and the
    component fell back to marking step 1 active: a spinner on a phase that was not running,
    under a label that did not describe it, for the whole setup window. `GenerationDetail`
    gained `articlePipeline` (`'simple' | 'full'`, defaulted so an older payload parses),
    reported from `articleGenerationMode()` — deployment-wide, read fresh, since the flag is
    re-read at every job start — and the list is now `retrieve → draft` for simple and the
    six stages for full. `STEP_LABELS.retrieve` went from "संदर्भ लेख शोधत आहोत…" to
    "लेखाची तयारी करत आहोत…", which is true whether that window is fetching a style reference,
    the name dictionary or the officer's designations.
    Verified 2026-08-05, all free: workspace typecheck **7/7 green**, lint clean on all eight
    touched files, and three harnesses green (`article-dateline` 11 cases,
    `no-reference-article-prompt` +4, `simple-article-prompt` +2). **Left for a real run**: one
    /dlo news article confirming the headline is a `#` line carrying no dateline and the body's
    first paragraph carries exactly one. No migration, no n8n; deploy is `@dgipr/schemas` →
    `@dgipr/content-engine` dists → API + web (ship together — `articlePipeline` is a shared
    contract, though its schema default keeps a half-deploy from breaking).

- **No image model ever paints the branding again — the chrome is CODE's, on every lane**
  (2026-08-04, no migration, API only): an officer drew a blue clear-space box on generation
  cc283a63 to move text out from under the logo, and got a SECOND महाराष्ट्र शासन badge —
  the crisp stamped one plus a larger painted copy behind and below it. The zone rules were
  not what failed. Two prompts positively invited the branding, and the fix is one shared
  rule (`generation/reserved-zone-rule.ts`, joining `fitToReserveRule` there) wired into all
  four lanes.
  - **The FEEDBACK prompts asked for it, in as many words.** Every one of them said the badge
    and footer "are official branding stamped onto the poster by software — do NOT alter,
    move, redraw or **remove** them". An image-edit model repaints the whole canvas, so "do
    not remove it" is read as "reproduce it", and its reproduction is freehand: it lands at a
    different size and offset from the 160x154 badge `overlayTwitterChrome` stamps at a 6px
    margin, so the two do not coincide and BOTH survive. The prompt also described that badge
    as "approx 280x270 px" — a figure licensing a badge half as wide again as the real one,
    which is exactly the shape of the overhang in the render. It now quotes `SOCIAL_ZONES`
    (180x170 / 120px), the same reserve the initial fixed-template prompt uses.
  - **The fixed-template (ठरलेले टेम्पलेट) prompt said only "Do not add a logo. Do not add a
    footer."** while calling the reference the AUTHORITATIVE VISUAL STRUCTURE — and the
    reference is a finished poster carrying real chrome, with nothing marking it placeholder.
    Every other DGIPR path says ERASE the master's chrome (`PLACEHOLDER_WITH_PHOTO`); this
    branch never did. This is the problem the 2026-08-04 reserved-zone milestone below named
    as separate and deferred.
  - **The fact that makes both fixable is the one that makes erasure safe**: the chrome is
    composited in CODE after EVERY render, initial and feedback alike (`overlayTwitterChrome`
    / `overlayArticleChrome` / `overlayCmoChrome` / the youtube overlay — runner.ts:1432 and
    :1824 for the social lane). A painted badge is never needed, never used, and can only
    ever be a duplicate. So `stampedChromeRule` (feedback: it is not yours, ERASE it, leave
    plain continuing background) and `referenceChromeRule` (initial: the reference's chrome
    is placeholder, copy NONE of it) say the same three things — it is not yours, remove it,
    and here is the consequence.
  - **The consequence is the half that was never stated**, and it is what makes the rule win:
    a painted copy is NOT overwritten by the stamp, it survives BESIDE it. Without that, the
    model has no reason to prefer erasing over faithfully reproducing what it can see.
  - **The erase rule must explicitly OUTRANK "keep the input unchanged"**, because it
    contradicts two rules already in every feedback prompt — the keep-layout rule and
    "preserve all existing Devanagari text exactly" (the footer band carries text). Left
    unranked, the absolute-sounding half wins; that is the same trap `DISPLACE_PRESERVE_RULE`
    was written to escape. Harness-asserted on every feedback shape.
  - **`CHROME_FREES_NO_SPACE` travels INSIDE the rule**, not beside it. Telling a model to
    erase the logo is the known way to cause the article path's older bug — freed corner read
    as usable space, headline floated up into it, stamped logo clipped it — so the guard
    cannot be something a caller might forget to add.
  - CMO is included: its chrome is a full-width leader header rather than a corner badge, but
    `overlayCmoChrome` re-stamps it on exactly the same schedule. Its header redraw is fully
    covered and so was invisible; its FOOTER is the same DGIPR strip and had the same overhang.
    The article `fresh` and legacy paths already said "do not paint any logos … stamped on
    afterwards by software" and are deliberately untouched.
    Verified 2026-08-04, all free: workspace typecheck **7/7 green**, lint clean on all four
    touched files, and five harnesses green — `reserved-zone-rule` (both new rules, including
    that the reference rule does NOT tell the model to erase branding off an image it is not
    editing), plus **new per-lane assertions on every feedback shape** (plain / marker /
    clear-space / cmo on the social lane, three on the article lane, two on the thumbnail
    lane) checking the erase instruction, the duplicate consequence, the override, the reflow
    guard, and — the regression test that matters — that the literal string
    `do NOT alter, move, redraw or remove them` has not come back. If a painted badge or
    footer ever reappears, check those first. **Left for a real run** (one image charge):
    re-running the cc283a63 clear-space round and confirming one badge and one footer.
    No migration, no n8n, no web change; deploy is `@dgipr/content-engine` dist → API.

- **The reserved zones now OUTRANK completeness, and the prompt says what to do when the
  content will not fit** (2026-08-04, no migration, API only): real renders were shipping
  their closing paragraph under the stamped footer, cut mid-word — generation `cc283a63`
  lost three of the four columns of its आवाहन block. **The reserve was not wrong and the
  numbers were not wrong**: the fixed-template prompt asks for 120px on a 1600px canvas
  where `overlayTwitterChrome` actually covers 91px (`239/3376 × 1280`, measured), i.e. 29px
  of slack, and the top-right badge is 160x154 at a 6px margin against a 180x170 reserve.
  What was wrong is that the prompt gave the model no way to WIN that constraint and three
  louder reasons to lose it: the completeness rule offered *"or use more of the canvas"*
  when space is short — on this canvas the only space left over IS the footer strip, so
  that clause was a licence to put the officer's last paragraph where an opaque band was
  about to land; the structure rule demands the "usable canvas" be filled as densely as the
  reference, with "usable" left undefined and therefore read as the full height; and the
  item count is stated as a number to check the output against. Completeness was stated
  three times, the reserve once, in **second-to-last** position — so on a long note the
  model resolved the conflict against the reserve, by about one line.
  The fix is `generation/reserved-zone-rule.ts`, shared by the poster and YouTube-thumbnail
  lanes (the `clear-space-rule.ts` shape, and shared because these blocks had already been
  "carried over verbatim" between the two once — a verbatim copy is a copy that drifts).
  It supplies the three things the failing prompt never said. **Priority**: the fit rule
  opens by declaring it OUTRANKS every completeness, density and canvas-filling instruction
  above it. **Consequence**: the band is OPAQUE and is not moved to suit the layout, so
  anything under it is *covered and lost* — the sentence ends mid-word and the image is
  thrown away; "reserved for branding added later" never said that, and the fixed-template
  block did not even carry the `fresh` path's "will cover them" clause. **Action**: lay it
  out, then CHECK THE BOTTOM, and if the last line does not clear the band, shrink the type
  — **headline first**, no minimum size — and lay it out again; this is the officer's own
  diagnosis, and the sentence already existed in the CMO branch of the same file and had
  never been ported. Plus two supporting changes: `y=1480` is restated as a proportion the
  model can actually SEE (a strip about one thirteenth of the height) because an image model
  has no ruler and a bare coordinate is close to inert; and "usable canvas" is now defined
  in place as the area above the band and outside the corner. `fitToReserveRule` is emitted
  **LAST** on every path — fixed-template, `fresh`, the legacy edit modes and the thumbnail —
  the position these models weight most and the position `clear-space-rule` is already
  harness-asserted to hold. The `fresh`/legacy paths quote their own (more generous) 280x270
  / 130px figures through `CHROME_ZONE_GEOMETRY`, because two different footer heights inside
  one prompt would be worse than either number alone.
  Deliberately NOT done, and worth knowing before anyone builds it: a post-render detector
  that measures ink in the reserved strip. The prompt *correctly* asks for background,
  gradients and photography to continue through those zones, so on a poster with a
  photographic bleed a cheap edge/ink statistic cannot separate the failure from the required
  behaviour — it would warn on posters that are fine. A reliable check needs the OCR/text
  discrimination that is not in the repo, and a warning that cries wolf is worse than none.
  The duplicated महाराष्ट्र शासन badge seen on some fixed-template renders is a SEPARATE
  problem (that branch says "Do not add a logo" where every other DGIPR path says ERASE the
  master's own chrome) and is deliberately untouched here. **Fixed on 2026-08-04 — see the
  milestone above it.**
  Verified 2026-08-04, all free: workspace typecheck **7/7 green**, lint clean on all three
  touched files, and three harnesses — the new `tsx src/generation/reserved-zone-rule.ts`
  (geometry, both content floors, the proportion wording, the optional footer note), plus
  **new assertions on the fixed-template branch, which had none at all**: the priority, the
  consequence, the shrink action, that `use more of the canvas` is gone, that "usable canvas"
  is defined, that the fit rule is the LAST block, that the zones no longer precede the
  completeness rule they must outrank, and that the geometry still matches `twitter-chrome.ts`.
  If the overlap ever returns, check those first. **Left for a real run** (one image charge):
  the same long weather-alert note re-rendered on ठरलेले टेम्पलेट, confirming the आवाहन block
  clears the band. No migration, no n8n, no web change; deploy is `@dgipr/content-engine`
  dist → API.

- **Templates are uploaded and pinned by SIZE, not by topic** (2026-08-04, no migration,
  web + API): `/references` had been reorganised into four size bands (एकच संदेश / थोडे
  मुद्दे / मध्यम यादी / मोठी यादी) months ago, but the two places an operator actually
  ANSWERS a question still asked the retired one. The upload form asked for a
  `reference_type` in a dropdown — a judgement about what the placeholder artwork is about,
  which predicts nothing and has not steered a render since capacity-first selection landed
  — and the create-form picker still grouped Twitter under those same type headings. Both
  now use the bands, so the library is uploaded into, browsed and pinned through one axis.
  - **The band pick is authoritative, not decorative.** It is written as the master's
    `bulletSlots` and marked `slotsLockedByOperator`, and `reanalyzeReferenceImage`
    carries that count through while still refreshing the summaries and the photo-zone
    call — otherwise a re-check aimed at fixing a vague subject line would silently move
    the master to a different section of the library. Optional flag on a jsonb column, so
    no migration and every existing spec still reads as vision-derived.
  - **The band boundaries moved to `@dgipr/schemas`** (`ReferenceShapeBand`,
    `REFERENCE_BAND_SLOTS`): the API now writes the number the web draws chips from, and
    two copies would drift. `apps/web/lib/referenceGroups.ts` keeps `bandOf` and adds
    'unanalyzed', which is the absence of a spec — a state of the library page, never
    something an operator can file into. The band labels/hints moved there too, being
    named by three surfaces now.
  - **The number gates selection**, so the mapping errs deliberately: each band's ceiling
    ("१ ते ३ मुद्दे मावतात" = 3), and the open top band its floor. `enforceCapacity`
    excludes a master with fewer slots than the note has items, so understating passes a
    master over while overstating drops the officer's content. Nothing is preselected on
    the form and the file button stays disabled until the band is answered — a defaulted
    guess would be accepted silently on most uploads. A failed vision pass stores null even
    when a band was given rather than fabricating a `hasPhotoZone` nobody declared.
  - **The whole-TYPE pin is gone from the picker**: a band is not a type, so there is no
    `reference_type_id` to send, and pinning is now always one exact image. A restored
    `{ kind: 'type' }` value still RENDERS (an older link, a re-run) — nothing on the form
    can create one. The route, the column and `pickType`'s server half are untouched.
  - The type is still stored (NOT NULL, and types remain pin targets); it is simply no
    longer asked about, coming from the last one used in that library.
  - Also: **तयार करा moved above the note box** on क्रिएटिव्ह आणि सोशल. The form is a long
    textarea, an upload card and the format cards, so a button under all of it is
    off-screen for most of the time spent on the page; this form is filled in one pass and
    submitted, not reviewed downward. The error line moved with it, so a refusal is
    reported where the action was taken.
    Verified 2026-08-04, all free: workspace typecheck **7/7 green**, lint clean on all ten
    touched files (the two prettier complaints are whole-file CRLF confirmed already failing
    at HEAD — do NOT `--write` them); **38 browser assertions at 1360 and 390** against the
    live library (the picker's four bands with real counts 22/19/27/14, आणखी दाखवा revealing
    8 → 16, no type checkbox, the four upload chips with their capacity hints, no dropdown,
    nothing preselected, the file button disabled until answered, तयार करा above the note at
    both widths, no overflow, no page errors), plus the बॅनर and यूट्यूब lanes — which used
    to render as one flat grid — now sectioning correctly; and the API rejecting an unknown
    band **before** any upload while the band-less legacy call still parses. **Left for a
    real run** (one vision call, writes a row to the live library): an actual upload
    confirming the stored `bulletSlots` is the operator's number and survives a re-check.
    No migration, no n8n; deploy is `@dgipr/schemas` → `@dgipr/database` →
    `@dgipr/content-engine` dists → API → web.

- **One design system across all ten index routes** (2026-08-03, no migration, web only): the
  UI was deliberately plain for non-technical staff, and had drifted into looking unfinished
  rather than simple. **No UI library was added** — Tailwind/shadcn over a hand-written
  5,000-line `globals.css` means either two competing systems or 55 rewritten components, so
  the existing stylesheet was refined instead. The large-target accessibility stance at the top
  of `globals.css` is UNCHANGED and must stay: 18px base, 56px primary buttons, status as text
  + colour.
  - **Tokens.** The canvas moved from `#e9dcc9 → #d8c3a8` (dark enough to muddy the white cards
    on it) to a calm `#f4eee5 → #ebe1d3`, `background-attachment: fixed` so a long page does not
    re-gradient as it scrolls. New tokens, all additive: `--surface` (the tinted well for rows
    nested INSIDE a white card — reach for this, not `--bg`, which is the page canvas),
    `--border-strong`, a three-rung elevation scale (`--shadow-sm/md/lg`, each a tight contact
    shadow plus a wide ambient one rather than one big blur), a radius scale (`--r-sm/md/lg/xl`)
    and `--ring`. `--shadow` still resolves to `--shadow-md`, so ~40 existing consumers were
    untouched. One `:focus-visible` rule now serves the whole product.
  - **`.page-head` is the new shared primitive and every index route uses it** — accent rule +
    `.page-title` + `.page-sub` + optional `.page-head-actions`. It is the single thing making
    ten separately-built pages read as one product, so **a new page must use it rather than a
    bare `<h1 class="page-title">`**. Four subtitles were added (`mediaRoomIntro`,
    `translatePageIntro`, `proofreadPageIntro`, `historyIntro`) and the existing intros moved
    into it; `.page-intro`, `.gl-intro` and `.ref-intro` are deleted. `/dlo` gets its own
    `dloPageIntro` deliberately — reusing `dloIntro` would print it twice, since that string is
    the "नवीन काम" card's own hint. `/generations` gained the "+ नवीन तयार करा" action there
    and `/analytics`'s range picker moved into it as a segmented control on a tinted track.
  - **`.card-action`** exists because several forms deliberately put the primary action in its
    own block above the optional material below it (see the comment in `DloIntakeForm`) — that
    ordering is a product decision and is kept, but as a plain `.card` it was a full-width sheet
    of white holding one button. Applied on `/`, `/dlo`, `/transcribe`, `/proofread`, `/video`.
    `.card-compact` is its secondary-control counterpart. Also new: `.card-head`,
    `.card-eyebrow`, `.empty-state`, `.char-count`, `.btn-ghost`, `.btn-danger`.
  - **Three real bugs found by looking at the rendered pages, not by reading code.** The footer
    set `--muted` on a maroon band, which the markup worked around with an inline `color:#fff`
    (the colour now lives in `.powered-by`). `.dlo-work-row` bordered with `var(--line)`, a
    token defined **nowhere**, so that divider had never rendered. And `.dlo-work-title` holds
    an uploaded filename with no break opportunity (`0-CM_Review_Meeting_PMAY_U__2.0…`) —
    `min-width: 0` lets the flex ITEM shrink but cannot break a word, so `/dlo` scrolled 147px
    sideways on a 390px phone; fixed with `overflow-wrap: anywhere`.
  - Two heavy pages were also de-noised: `.gl-row.is-open` marked its accent on all four sides,
    and an unverified glossary list is 200+ rows all open, so the page was a wall of maroon
    boxes (now a tint + left bar); and a run with no poster painted a full-bleed saturated
    maroon block that outshouted the real posters beside it on `/generations` (now a quiet
    dotted placeholder panel).
    Verified 2026-08-03, all free: workspace typecheck **7/7 green**; lint 0 errors (the only 3
    warnings are pre-existing unused imports in `analytics/[feature]/page.tsx`, untouched);
    prettier clean on every hunk of mine — the residual whole-file complaints are CRLF and the
    three real ones are at pre-existing lines, so do **not** `--write` those files; and a
    rendered pass over all ten routes at 1360px and 390px with **zero page errors and zero
    horizontal overflow** at either width. No migration, no n8n, no API change; deploy is web
    only.

- **वापर विश्लेषण — department usage analytics (`/analytics`)** (2026-08-02, migration 0043):
  a page that answers "how much is this department actually using the platform", built to be
  presented to the head of department as well as read day to day. Six KPI tiles → one daily
  activity chart → a ranked share list → one card per sidebar feature, each opening
  `/analytics/[feature]` for its own detail.
  - **Department-wide totals per feature, because there is no other honest option.** There is
    no auth and no owner column anywhere in this phase (`0002_generations.sql` says so
    explicitly), so per-officer figures do not exist and are not approximated. Nothing on this
    page counts, infers or estimates individual people, and `dgipr.dlo.mine` stays what it has
    always been — localStorage ORDERING, never identity. Adding real attribution later is a
    separate change; faking it from a browser id would have been worse than not having it.
  - **The two generation lanes are split by `dlo_intake_id`, not by category** — no new column.
    A run created on क्रिएटिव्ह आणि सोशल has none; one generated from a /dlo intake has one.
    So `news`/`scheme` legitimately appear under BOTH cards: a poster made from a pasted
    article on the media room is creative work, the same category through /dlo is the article
    lane. That matches how an officer reads the sidebar, which is the whole organising idea.
  - **Migration 0043 `usage_events` exists because three features deliberately persist
    nothing**: /proofread ("nothing stored" is its stated contract), ad-hoc /translate, and
    actions taken against an existing row (article PDF, poster download). Without it, three of
    six cards would read as never used. **It may never contain content** — the shape has no
    free-text field at all, only `feature`/`action`/`char_count`/`count`/a small enumerable
    `detail` — which is a stronger guarantee than a comment asking callers not to send any.
    Writes are FIRE-AND-FORGET (`recordUsageEvent` returns `void`, swallows every error):
    verified live against a database WITHOUT 0043, a poster download still returned 200 and
    all 4.8 MB while the insert failed in the background. `eventsAvailable: false` then makes
    the page say so rather than report zero.
  - **Everything else needed no backfill and no rollup table.** Every other figure is derived
    per request from `generations`, `dlo_intakes`, `transcriptions`, `video_projects` and
    `generation_revisions`, which have been recording this since each feature shipped — so the
    page had real history the moment it was opened (421 outputs / 226 posters / 67 articles in
    the last 30 days, at ~0.5–1.1 s per request across every range).
  - **The rule every query in `packages/database/src/analytics.ts` follows: never select a text
    column.** `note`, `article`, `combined_text`, `files` and `scenes` hold whole articles and
    whole meeting transcripts. The four metrics that genuinely depend on a text column being
    non-null (does this social run have a caption? was this article translated?) use a
    head-only `count: 'exact'`, which transfers no rows. Costs: the /dlo source mix (recordings
    vs documents vs YouTube) and exact rendered video seconds, both deliberately given up.
    Every list PAGES explicitly — PostgREST silently caps a select at 1000 rows, and a silently
    truncated analytics page reports a decline that did not happen.
  - **Day boundaries are Indian**, everywhere, in the API and the web (`ANALYTICS_TIME_ZONE`):
    the container is UTC, so bucketing on the raw timestamp files an 01:30 IST run under the
    previous day — the trap the article PDF's date line already hit. Windows are half-open
    `[from, to)` with `to` set to the start of TOMORROW so today counts.
  - **Cost is framed as efficiency** (₹ per poster/article/video, total as support), converted
    at one stated constant `ANALYTICS_INR_PER_USD`. Features whose work is not metered to a row
    report `costInr: null` and say "not measured" — **never ₹0**, which would read as "free".
  - **No categorical colour palette, and that was a decision.** The daily chart is a SINGLE
    series and every bar in a ranked list carries its own name and value as text, so nothing
    here encodes identity by colour. Two tints of the brand maroon were run through the palette
    validator and FAIL as categories (normal-vision ΔE 12.2, below the 15 floor) — a
    colour-coded variant would have failed full-colour readers, not just colour-blind ones.
    Charts are HTML/CSS, not SVG: the bars reflow at any width and the labels are ordinary text
    in the page's Marathi font. Every chart ships a `<details>` table view.
  - **Two presentation bugs found by measuring rather than by looking.** The first real render
    showed **"+42,000%"** (421 against a previous period of 1) — arithmetically true, reads as
    broken; past 500% the change is now stated as a plain difference instead. And the daily
    chart's tooltips are `position: absolute` and so contribute to `scrollWidth` **at opacity
    0**, which gave the whole page a horizontal scrollbar on a phone from a tip nobody had
    hovered (body 403px in a 390px viewport); the edge columns' tips are now anchored inward.
    Verified 2026-08-02, all free: workspace typecheck **7/7 green**, lint clean on all 14 new
    files, prettier clean (the `strings.ts` complaint is pre-existing CRLF, confirmed against
    `git show HEAD:` — do NOT `--write` it); the live API across all four ranges plus the Marathi
    400 on a bad one; and **19 browser assertions** (Marathi title, 6 tiles, 6 cards, Devanagari
    numerals, no absurd percentage, 30 bars redrawing to 7 on a range switch, the range in the
    URL, every ranked bar directly labelled, a card's number equalling its drill-down's, no
    overflow at 1280 or 390, no page errors). **Left for a real run**: applying 0043, then one
    /proofread and one pasted-text /translate to confirm those two cards leave zero.
    **Deploy: 0043 → API → web** (rebuild `@dgipr/schemas` → `@dgipr/database` dists first).
    No n8n, no new env.

- **"AI साठी सूचना" — the officer directs one article in their own words** (2026-08-01,
  migration 0041): every officer-side input on /dlo said what the article is ABOUT (notes,
  files, links, category, heading) or what it should READ like (the pasted style reference).
  Nothing said what it should DO — "lead with the funding figure", "keep the committee
  paragraph short", "plainer language". `generations.instructions` (0041, insert-only like
  `style_reference` 0035 and for the same reason: `startGenerationJob` re-reads the row, so a
  retry must reproduce the same article rather than a differently-directed one) plus one prompt
  block carry that.
  - **The block is rendered LAST, immediately before "Write the article now."** — a late block
    is what these models weight most, and this is the one input written for this run alone. It
    carries the two rules that make the field safe rather than dangerous: the instructions may
    supply NO name, date, amount, designation, scheme name or location (otherwise this becomes a
    second, unreviewed note that walks past every factual guard), and where they ask for
    something the supplied information does not support, the information wins. Both variants
    render the identical block (`officerInstructionsBlock`, exported from
    `simple-article-prompt.ts`): `ARTICLE_PROMPT_VARIANT` changes how densely the specification
    is worded, never what an officer may ask for. `SIMPLE_ARTICLE_PROMPT_VERSION` →
    **`simple-v10`**; absent ⇒ byte-for-byte v9, asserted.
  - **The `full` pipeline deliberately does not take it.** It is the legacy opt-out and is kept
    byte-for-byte; the field reaches `generateArticleSimple` only.
  - **The field is on the intake FORM and on the review step, and the handoff between them is
    the interesting part.** `dlo_intakes` has no column for it — so the create route seeds it
    into `review_state` (0036) as a SEPARATE best-effort update after the files write, the 0028
    principle, and `DloWorkspace` restores it there like every other saved review field. That
    seed writes `writer: 'intake-form'`, which the officer's own browser adopts, so a resumed
    submission is never reported as a second officer's edit; and it carries only fields the
    seeding effect does not gate a paid call on, so `restoredFromSave.designations` stays false
    and the name lookup still fires exactly once.
  - **Fixed in passing, same mechanism: the intake form's style-reference box was DEAD.** It was
    drafted to sessionStorage and never submitted (`clearDraft()` on success took it), so an
    officer who pasted an exemplar on the form got an article styled by retrieval and no sign
    anything had been ignored. It now travels through the same seed.
  - **And the YouTube link field was the one input in the product rendered in browser default
    chrome** — `globals.css` styled `input[type='text']` and never `input[type='url']`, so a
    thin square box sat among rounded ones. `url` joins that selector (any new input type goes
    there, not at its call site), and the card gains a focus-ring-carrying `.yt-field` wrapper
    with a leading icon and an inline clear button, a primary Add button that keeps its width
    while probing, and a named + counted list to match the recordings above it.
    Verified 2026-08-01, all free: workspace typecheck **7/7 green**, lint clean on all 16 touched
    files, prettier clean on every hunk of mine (`strings.ts`/`dlo.ts`/`generations.ts`/
    `minimal-article-prompt.ts`/`routes/generations.ts` report whole-file CRLF complaints that are
    pre-existing — do NOT `--write` them); 7 new prompt assertions (verbatim rendering, the
    never-a-fact rule, information-wins-on-conflict, last-block position, absent/whitespace-only
    omission, and byte-identity when omitted); and a LIVE create through the running API proving
    both fields land in `review_state` under `writer: 'intake-form'`, plus /dlo rendering the new
    card. **Left to do: 0041 is NOT applied** — verified live, the blast radius is exactly as
    designed (a generate WITH instructions returns `Could not find the 'instructions' column`;
    every run without one is untouched, since `insertGeneration` omits the column). After applying
    it: one /dlo article with a real instruction, and one feedback round — `reviseArticle` does not
    receive the instructions today, so a revision is not held to them. Deploy: **0041 → API → web**
    (rebuild `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine` dists first); no n8n.

- **YouTube links are an intake source, on /dlo and /transcribe** (2026-08-01, no migration):
  officers wanted to turn a press conference already on YouTube into an article without
  first obtaining the recording. The expected cost of this was a video downloader —
  yt-dlp in `deploy/api.Dockerfile`, plus exposure to YouTube's bot checks from a
  datacentre IP — and **that turned out to be unnecessary**: ElevenLabs Scribe takes a
  **`source_url`** and fetches the media itself, its docs listing YouTube explicitly
  ("Supports hosted video or audio files, YouTube video URLs, TikTok video URLs, and other
  video hosting services"). `source_url` supersedes the deprecated `cloud_storage_url`,
  which accepted only presigned cloud-storage URLs and is what a reading of the older docs
  would have concluded was the whole story. **Check this before adding any downloader.**
  So a YouTube source never becomes bytes on our side, and every consequence follows from
  that one fact:
  - **`AudioFileInput` became a UNION** (`intake/audio-input.ts`): bytes we hold, or a URL
    the provider fetches. Modelled as a union rather than one type with two optional fields
    deliberately — an optional-fields shape can represent "neither" and "both", and would
    let the Sarvam client keep compiling while reading `undefined` bytes. It cost one
    changed line in `sarvam-stt.ts`, whose `.data` had exactly one use.
  - **Sarvam refuses per-input, never per-job.** `transcribeAudio` partitions on the sarvam
    path: URL inputs come back as `{ error }` in position with a Marathi message naming
    ElevenLabs, while the uploaded recordings in the same intake transcribe normally. That
    is what keeps `STT_PROVIDER=sarvam` a working rollback rather than a broken deployment,
    and it runs free — with no byte inputs there is no Sarvam call to make.
  - **The transcript cache (0031) does not apply**, and that is a property of the design,
    not a gap: it is keyed on a SHA-256 of the audio bytes, and there are none. URL sources
    carry an empty hash, are skipped on read and never written back. Both runners.
  - **No migration.** `files` is jsonb on both tables (the `.txt` precedent), so
    `DloIntakeFileKind` gained `'youtube'` and both entry types gained
    `sourceUrl`/`sourceAuthor`/`sourceThumbnailUrl` with `storagePath` becoming optional.
    From the review step onward a YouTube source behaves exactly like a recording — one
    card, one editable transcript — so `DloSourceReview`, `combineIntakeSources`,
    `assembleDloText`, lineage and `/:id/generate` needed **no changes**.
  - **The probe is oEmbed, not the YouTube Data API** (`routes/youtube.ts`, no key, no
    quota): title, channel and thumbnail — **and deliberately no DURATION**, since that
    needs a Data API key and the card's question is only "is this the video I meant?". So
    there is no cost estimate either; that was a considered trade, not an oversight. A
    failed probe answers **200 with the id alone**, because a private, unlisted or
    region-blocked video has no oEmbed record while remaining perfectly transcribable — the
    card degrades to a bare link chip and the source still submits. It 400s only for
    something that is not a YouTube video link.
  - **The client is not trusted about which URL it probed**: both create routes re-run
    `parseYouTubeVideoId` over the submitted payload, so a hand-crafted request cannot put
    an arbitrary URL in front of the transcriber. The stored URL is always the CANONICAL
    watch URL, never the pasted string — a link copied from the app carries `?si=`/`&list=`
    and, worse, `&t=`, which is a request to start partway into the video.
  - Web: one shared `YouTubeLinkInput` card on both surfaces (the `AudioFilePicker`
    precedent), built on the `.file-row` idiom so a pasted link and an uploaded recording
    read as siblings. Links ride in /dlo's sessionStorage draft **in full**, unlike the
    recordings — a link is a string, so a reload loses nothing and no "please re-attach"
    callout is needed. `CirclePlay` stands in for a brand mark: lucide 1.x has no brand
    icons.
    Verified 2026-08-01, all free: workspace typecheck **7/7 green**, lint clean on all 17
    touched files; 31 URL-parser assertions (`npx tsx ../schemas/src/youtube.ts` from
    content-engine, which has tsx — the `dlo-review-state.ts` split) covering every shape a
    link is actually copied in (`youtu.be`, no scheme, `m.`/`music.`/`nocookie` hosts,
    `/embed/`, `/shorts/`, `/live/`, tracking and playlist params) and the near-misses that
    matter (a channel page, a playlist with no video, a short/over-long/illegal id, and a
    `youtube.com.evil.example` lookalike host); 9 STT-dispatch assertions including the
    sarvam refusal arriving one-per-input in order; and a **live API pass** — a real
    `youtu.be` link with `?si=&t=` probed to its canonical URL with title, channel and
    thumbnail, a well-formed-but-unknown id correctly returning 200 with no title (the
    degradation path), and every guard on both create routes (channel/vimeo/junk 400,
    malformed payload 400, and a non-YouTube URL inside a well-formed payload rejected by the
    server-side re-derivation). **Left for a real run** (ElevenLabs spend, a few cents): one
    short Marathi video end to end, confirming Scribe accepts `source_url`, that the
    transcript lands under the video's title in the review step, and — the one live unknown —
    which of the two answers Scribe gives for a video whose audio it cannot fetch. New
    harness: `npx tsx packages/schemas/src/youtube.ts`. No migration, no n8n, no new env;
    deploy is `@dgipr/schemas` → `@dgipr/database` → `@dgipr/content-engine` dists → API +
    web, and API and web must ship **together** (the create routes' `youtube` field is a
    shared contract).

- **"Free this space" — a second poster gesture, for the officer's own logo** (2026-08-01, no
  migration): pixel feedback had exactly one gesture, the RED numbered marker, which says
  _change the element here_. Officers wanted the opposite: **clear a rectangle** so they can
  paste their own logo or photograph into it afterwards. Expressed as a marker note
  ("इथे काही नको") it fails, because the image model's response to "remove this" is to delete
  content or to paint a tidy white panel where it was — and a white panel is not free space, it
  is a new design element the officer then has to cover.
  So the annotator gained a `mode`, and the new mode draws a **BLUE lettered box with a 20%
  translucent fill** (A, B — capped at 2). What is inside is RELOCATED elsewhere in the
  composition, never deleted or shrunk, and the rectangle is left as ordinary background
  continuing what surrounds it. Its own blue toolbar icon on `SocialPostView` beside the pencil
  (a mode pill pair inside the fold on `PosterPanel`'s article lane), and both gestures ride
  **one round**, so a single paid render carries markers and cleared space together.
  Decisions worth keeping:
  - **The rule that frees the space lives in CODE, not in the interpreted user text**
    (`generation/clear-space-rule.ts`, shared verbatim by `buildFeedbackPrompt` and
    `buildArticleFeedbackPrompt`). The `SETTING_RULE`/`NO_TEXT_RULE` precedent: a rule that
    travels through a model can be paraphrased away. The vision pass
    (`interpretImageFeedback`) is given the blue boxes too, but only to NAME what occupies each
    one and propose where it should go.
  - **It is phrased POSITIVELY about the freed area**, which is the `NO_TEXT_RULE` lesson
    again: a bare "leave it empty" is exactly what makes an image model paint a placeholder
    frame there. It says what to SHOW — the same colour, gradient, pattern and texture as the
    background immediately around it, no panel/patch/outline/shadow/watermark — and adds "do
    not change the background anywhere else", which is the officer's stated requirement.
  - **The note is OPTIONAL**, unlike a marker's. An empty one means "you decide where that
    content goes", which is the common case, so no clear row can block a send and the request
    schema omits a blank note rather than sending `''`. That also means a clear-only round can
    carry no text at all, so both prompt builders now throw only when text AND clear boxes are
    absent.
  - **The two contradictory rules were reconciled.** "Keep the exact layout unchanged" is the
    first thing an edit prompt says and it directly fights a relocation; with clear boxes
    present it gains an "or the SPACE TO FREE block below" exception, and the block sits last —
    the position these models weight most. Harness-asserted, along with the clear rule coming
    AFTER the reserved zones it refers to.
  - **Blue is drawn LAST** in both the browser overlay and `feedback-marker.ts`, so an overlap
    reads as the more destructive gesture. The badges are **Latin A/B, not अ/ब**, because the
    poster-side badge is hardcoded vector strokes (no `<text>`, which would depend on a font
    inside the deploy container) — and the on-poster mark must match what the officer drew.
  - A blue box over the chrome gets a Marathi warning that is a real limitation rather than the
    marker path's soft hint: the logo and footer are re-stamped in code after the edit, so that
    space cannot be freed.
    **No n8n push**: both lanes build their feedback prompt in the API and the workflows are thin
    image-edit services. Verified 2026-08-01, all free: workspace typecheck **7/7 green**, lint
    clean on all 15 touched files, prettier clean on every hunk of mine (the two whole-file
    complaints are pre-existing CRLF, confirmed per file — do NOT `--write` them); the extended
    `poster:preview:markers` render (A/B glyphs, 20% fill, red boxes byte-identically unchanged,
    overlap order); 11 schema assertions (clear-only accepted, cap enforced at 2, blank note and
    off-canvas rejected, legacy shapes untouched); the social and article prompt harnesses
    extended and green; and **27 live browser assertions** across both lanes (icon arms and
    disarms, modes mutually exclusive, fill/border match the renderer's constants exactly, badges
    A/B, cap holds, submit appears with no note typed, a red marker coexists and survives a mode
    switch, removal works, no page errors). **Left for a real run** (one image charge): a clear-only
    round on a live poster, confirming the freed rectangle comes back as continuing background
    rather than a panel, and that the displaced content lands somewhere sensible. Deploy is
    `@dgipr/schemas` → `@dgipr/poster-renderer` → `@dgipr/content-engine` dists → API → web.

- **The poster reference is chosen for CAPACITY, not topic — the input IS the poster**
  (2026-07-31, no migration — SUPERSEDES the subject-first half of the 2026-07-28
  information-first milestone): a note about mosquitoes carrying SEVEN points was landing on
  the three-slot dengue master and shipping four of them. That was the design working as
  specified — `select-by-information.ts` said in its own header _"SUBJECT IS THE DECIDING
  FACTOR"_, ran a two-stage prompt that narrowed by topic BEFORE looking at structure, told the
  model _"If stage 1 kept exactly one reference, CHOOSE IT, even if its arrangement is not
  ideal"_, and its live harness **asserted** the mosquito→dengue pick.
  The specification rested on an assumption that is false in practice: that the officer supplies
  an ARTICLE and the pipeline decides what belongs on the poster. It does not — **what the
  officer types IS the poster's content**, every line meant to appear (the PDF/article-upload
  path on क्रिएटिव्ह आणि सोशल is, in the operator's report, not used at all). Once that is true,
  topic matching is actively harmful: the reference's capacity was shrinking the content.
  The relationship is inverted — the content's SIZE now decides which references are eligible.
  - **Capacity is a HARD GATE in code, not a scored preference.** A reference with fewer content
    slots than the information has items is EXCLUDED. It was a _scored_ preference before
    (`scoreMaster`'s doubled overflow penalty), and a scored preference is exactly how a
    four-slot template kept beating a seven-slot one. `enforceCapacity` (pure, synchronous,
    free to test) replaces the model's pick with the TIGHTEST eligible reference when the model
    picks something too small — the lock-scheme-names doctrine, an instruction steers and a
    deterministic post-filter guarantees.
  - **Subject is no longer a criterion at all**, and `contentSummary` is deliberately not shown
    to the ranker. Making the poster FEEL like an alert is the image prompt's job, not the
    librarian's: a new `MAKE THE DESIGN SUIT THE MESSAGE` clause tells the model to read the
    kind of poster off the INFORMATION and never off the reference, whose own topic is
    unrelated placeholder content. That is the same division the onbrand prompt already drew
    for colour ("the reference image controls STRUCTURE ONLY, not colour"), extended to subject.
  - **The item count comes from the SAME call that picks** — a separate counting call would be a
    second charge, and the count and the pick could then disagree about the very thing the gate
    is computed from. This is NOT the `point_count` prediction deleted on 2026-07-28: that
    forecast what an article _should_ say before any reference was seen; this counts what the
    officer actually wrote.
  - **Two clauses that caused the loss are deleted** from the onbrand prompt: _"Never paste the
    entire input article into the image"_ and _"select only the most important information"_ —
    an explicit instruction to drop the officer's own points. In their place: show every item,
    the exact item count as a number the model can check itself against, and a
    `REPRODUCE THE MARATHI TEXT EXACTLY` rule (every matra, conjunct, anusvara and numeral).
    **That last one is an instruction, not a guarantee, and the file says so**: this path has
    gpt-image painting the Devanagari, which opts out of the poster doctrine (paint no text;
    typeset with Chromium) that exists precisely to prevent mangled Marathi. Accepted knowingly
    — design fidelity traded against text fidelity. If misplaced matras become a real problem,
    the fix is the Chromium path, not a stronger sentence.
  - **Overflow renders, never truncates.** When nothing is big enough the largest reference is
    used, the prompt is told to EXTEND its row pattern to the number needed (its default
    response to too much content is to drop some), and the officer gets a Marathi warning naming
    both numbers so they can split the note — in-process registry beside `translateWarnings` /
    `designationWarnings`, plus `posterCapacityWarning` on the detail payload.
  - **`isSimpleTemplateEdit` was `'twitter'`-only**, so a **Facebook** run with ठरलेले टेम्पलेट
    silently took the copy pipeline instead — the same choice producing a different poster
    depending on platform, and the copy pipeline is the one that condenses to the master's slot
    count. Now `isSocialCategory`, the repo's standing rule for exactly this class of bug;
    merging the two UI options later is now purely a web change.
  - Also removed: a stray `console.log('HIIIIIIIIIIIIIIIIIIIIIIIIIII')` shipping in the onbrand
    prompt builder.
    **The library needed nothing done to it** — all 91 masters (89 active) already carry a
    `layout_spec`, verified free; the active slot histogram is `0:29 2:5 3:14 4:14 5:8 6:5 7:5
8:2 9:3 10:1 11:1 12:2`, so a seven-item note has 14 eligible masters. The 29 zero-slot
  masters are legitimately _"not a repeating list"_ (quote/single-message layouts), which is why
    the gate only applies from **2 items up** — gating those out for a one-item note would exclude
    exactly the references built for it. A failed count degrades to "no gate" rather than an empty
    pool. Verified 2026-07-31, all free: workspace typecheck **7/7 green**, lint clean on all
    eight touched files, prettier clean on every hunk of mine (the residual complaints in those
    files are pre-existing unformatted lines — do NOT `--write` them, and note `git show HEAD:` is
    a useless prettier baseline here since blobs are LF and the working tree is CRLF); 7
    capacity-gate assertions (too-small pick corrected to the tightest fit, an eligible pick left
    alone, shortfall reported when nothing fits, 1-item and failed-count both ungated, `>=` not
    `>`, deterministic per seed) and 9 prompt assertions. **Left for a real run**: the `--live`
    half of the harness (cents — asserts the model itself counts seven points and does not choose
    the 3-slot dengue master), then one twitter and one facebook ठरलेले टेम्पलेट E2E on a
    genuinely 7-point note. No migration, no n8n; deploy is `@dgipr/schemas` →
    `@dgipr/content-engine` dists → API → web.

- **gpt-image is a real alternative for the storyboard frames, switchable in one env
  line** (2026-07-31, no migration): the `openai` branch of `frame-provider.ts` had
  existed since the seam was written, but it was not a peer of the Gemini default — it
  **dropped `referenceFramePng`**, scene 1's approved frame, because `editImage` took a
  single buffer. So a `VIDEO_IMAGE_PROVIDER=openai` deployment silently fell back to
  the pre-2026-07-26 behaviour where the `style` paragraph alone carried cross-scene
  consistency, which is exactly the configuration that let four scenes come back as
  four unrelated worlds. `editImage` now accepts several buffers and posts them as
  gpt-image's repeated **`image[]`** field, whose FIRST entry is the canvas and the rest
  context — a single image still posts the scalar `image` field, so the poster paths and
  the end-frame edit send a byte-for-byte unchanged request. The branch now renders all
  three shapes the gemini one does: an END frame edits the start (with the reference
  appended as trailing context), a START frame **with** a reference goes through
  `/v1/images/edits` with the reference as the canvas — which is what
  `WORLD_REFERENCE_RULE` was already worded for ("keep its visual world … create the new
  location and action described here") — and a START frame with nothing to inherit is a
  plain generation. The remaining differences are real but are cost and look, not
  capability: gpt-image renders 3:2 / 2:3 and is centre-cropped to the video aspect,
  and it bills per image at `OPENAI_IMAGE_QUALITY` where Gemini bills flat.
  `VIDEO_IMAGE_PROVIDER` is now an ACTIVE line in `.env.example` (and in `.env`) rather
  than a commented one, so switching is editing a value and restarting; the storyboard
  gate already asks `frameProviderApiKeyEnv()`, so a gpt-image deployment needs no
  `GEMINI_API_KEY` for frames. Verified free: workspace typecheck **7/7 green**, lint +
  prettier clean on both touched files, and a dispatch probe over
  unset/`gemini`/`openai`/`OpenAI `/`kling` confirming the branch, the trim-and-lowercase,
  the gate naming `OPENAI_API_KEY` instead of `GEMINI_API_KEY`, and an unknown value
  failing with `Supported: gemini, openai`. **Left for a real run** (image spend): one
  storyboard on `openai` to confirm the multi-image `image[]` edit is accepted and that
  scene 2 inherits scene 1's world. Deploy: rebuild `@dgipr/poster-renderer` →
  `@dgipr/content-engine`, then API; no migration, no n8n, no web change.

- **Ready-script clip count comes from a MEASURED WAV, not a chars/second constant**
  (2026-07-31, no migration): `splitReadyVideoScript` decided the scene count as
  `ceil(estimateNarrationSeconds(script) / 15)` off `DEFAULT_NARRATION_CHARS_PER_SECOND`.
  That constant is one number for every voice and the voices differ by ~50% (bulbul
  ~16.5 chars/s, ElevenLabs v3 ~10.9), so an ElevenLabs deployment planned too few clips
  at gate 1 and the narrate gate then REFUSED the project — after the officer had already
  approved the script — because the words may never be trimmed or sped up on that lane.
  `startVideoScriptJob` now, for `inputMode === 'script'`, synthesizes the whole
  narration through the provider seam FIRST, measures the WAV
  (`measureReadyScriptSeconds`), and passes that duration into `planReadyVideoScript`,
  where it decides the scene count, the per-scene character cap (`maxSceneChars`, the
  measured rate of this very script rather than the configured constant) and the clip
  windows. The TTS call is **moved, not added**: the WAV is uploaded as
  `projects/{id}/narration-v1.wav` and every scene carries it as its narration-audio
  cache, which is exactly what `continuousNarrationIsCurrent` checks — so the storyboard
  job's voice phase finds it current and synthesizes nothing. The two-minute limit is
  enforced against the measured duration at gate 1, before a single frame is bought.
  A deployment with no TTS key keeps the char-rate estimate (it renders silent anyway),
  and the note lane is unchanged — there the narration is written to a char budget and
  the narrate phase's measure-then-shorten pass already owns the fit.
  `NEXT_PUBLIC_NARRATION_CHARS_PER_SECOND` survives as the create form's pre-flight hint
  only; being wrong there costs an estimate, never a render. Verified free: workspace
  typecheck **7/7 green**, lint + prettier clean on both touched files, and a split check
  where one 1,061-char script plans **5 scenes at 16.5 chars/s and 7 at 10.9**, with the
  chunks rejoining byte-for-byte in every case. Deploy: rebuild `@dgipr/content-engine`,
  then API; no migration, no n8n, no web change.

- **Exact ready-script video input** (2026-07-30, migration 0040): `/video`
  now offers **टिपणीवरून** and **तयार संहितेवरून**. Note mode is unchanged:
  it writes a 30-second Marathi narration from the supplied facts. Ready-script
  mode accepts voiceover narration only, treats it as final Marathi copy and
  never asks a model to return or rewrite it. Whitespace is normalized, then a
  deterministic balanced partition divides the exact words at word/sentence
  boundaries into up to eight 3–15 second scenes; the model creates only the
  title, shared visual style, shot briefs, beats and optional supported overlay
  lines. Gate 1 renders narration read-only, hides add/remove-scene controls,
  and the API independently rejects any submitted scene array whose joined
  words differ from the original source. The create form estimates speech time
  and scene count locally for free; scripts estimated above the provider's
  eight-clips × 15-seconds = **two-minute** capacity are blocked before project
  creation. At storyboard time one continuous Sarvam WAV supplies the
  authoritative duration. Ready-script projects never enter either narration
  shortening loop; a rare measured overrun fails before frames/video are
  purchased and asks for a shorter new script. Small underruns become natural
  visual holds. The old video-only `NOTE_MAX` textarea cap and the API's 60,000
  character video-source cap are removed; other product limits are untouched,
  and the Fastify 64 MiB body safety limit remains. `video_projects.input_mode`
  persists `note | script` with existing rows defaulting to `note`. Deploy 0040,
  rebuild `@dgipr/database` + `@dgipr/schemas` + `@dgipr/content-engine`, then
  API + web; no n8n.

- **Final-video assembly is validated and recoverable** (2026-07-29, no migration):
  production project `8383a0b6-9b4d-4597-9acc-994920b39b40` proved the paid assets
  were healthy (four clips decoded to 6s/8s/5s/10s) while `video-v1.mp4` was a
  formally valid 49,905-byte container that decoded to **one frame / 0.00s**.
  The old boundary trusted ffmpeg exit code, so that object was uploaded and the
  row was marked completed. `poster-renderer/video/assemble.ts` now fully decodes
  every input and output through ffmpeg's null sink, requiring duration and frame
  count near the scene windows; voiced outputs validate the audio track too.
  Assembly no longer uses the concat demuxer against provider timestamps and
  possibly mixed render sizes: every clip is an independent input normalized to
  the first clip's canvas, 25fps, square pixels and frame-number-derived PTS, then
  joined with the concat **filter**. Caption PNGs are looped/scaled independently,
  and narration muxing no longer uses `-shortest` (an unexpectedly short auxiliary
  stream must never truncate the already-validated video). The API retries this
  free local stage once and does not calculate/upload a new immutable version until
  validation passes. A completed project has `POST /video/projects/:id/stitch` +
  **क्लिप्स पुन्हा जोडून व्हिडिओ तयार करा**, which reuses stored clips and cached
  narration only (no Kling/Veo/Sarvam spend); failure returns to `completed` with
  the old video still selected. During `animating`, polling now renders a playable
  `<video>` under each scene as soon as its persisted `clipUrl` appears. The free
  harness covers mixed 720p/1080p inputs and asserts a one-frame MP4 is rejected.
  Replaying the exact four production clips, all four caption overlays and cached
  WAVs through the new path produced a validation-clean 29.12s / 729-frame MP4.
  Deploy API + web after rebuilding `@dgipr/poster-renderer`; no n8n.

## Development Expectations

- Preserve useful existing files and configuration.
- Prefer shared, reusable code over one-off logic.
- Keep implementation boundaries clear: `apps/api` routes stay thin; LLM/rendering
  logic lives in `packages/content-engine` and `packages/poster-renderer`; `apps/api`
  only sequences calls and persists state (see `apps/api/src/jobs/runner.ts`).
- Run `pnpm --filter @dgipr/poster-renderer exec playwright install chromium` once
  per machine — the poster renderer needs a local Chromium for the API process too.
