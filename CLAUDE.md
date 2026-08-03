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
  - `startGenerationJob`: retrieve → `generateArticle` → (if poster) the article poster
    phase → upload PNG(s) to Supabase Storage. Job state of record is the `generations`
    row (status/step/error), so polling clients survive refreshes.
  - **Article poster = `renderAndStoreArticlePoster`, the twin of
    `renderAndStoreSocialPoster`.** `ARTICLE_POSTER_MODE` (default **`fresh`**) forks it:
    `fresh` builds the whole prompt in the API (`buildArticlePosterPrompt`) and calls
    `generateImage` at 1536x1024 — **no n8n**; `n8n` edits the picked master through the now
    thin 5-node `article-poster-v1-api` (`renderArticlePosterEditViaN8n`); `html` is the
    original `buildArticleScenePrompt`+`generateImage`+`generateArticlePoster` Chromium path.
    Sequence: `generateCopy` → **the poster's text** (`row.posterHeading` if the officer typed
    one, else `resolvePosterSubject` — if the news has ONE named subject the poster's entire text
    becomes that name in full; see the named-subject bullet below) → `pickArticleReference` (pin wins; the master is colour-stripped STRUCTURE
    inspiration in fresh mode, never pixels) → `pickPalette` + **`pickArticleLayout`** (two
    rotations, seeded, spread against `recentStyleHistory(client, ARTICLE_STYLE_CATEGORIES)`)
    → `generateArtDirection` → render → `measurePosterColours` on the RAW poster →
    `overlayArticleChrome` → upload → persist `copy`+`posterPath`, then `posterStyle` as a
    SEPARATE best-effort update (an un-applied 0028 must cost the rotation memory, not the
    paid render). Feedback re-renders build their prompt with `buildArticleFeedbackPrompt`
    and are the only article path still touching n8n. `ARTICLE_POSTER_THEMES` is deleted —
    the shared palette rotation supersedes it. Neither n8n mode writes a `scenePath`, so
    poster copy/scene feedback stay `html`-only.
  - `startSocialPostJob` (both social categories) now runs reference selection → copy
    → build image prompt **in the API** (`@dgipr/content-engine`), and the thin
    `social-post-v2-api` workflow (5 nodes) only EDITS the chosen image with the API-built
    prompt (see the 2026-07-24 milestone in AGENTS.md — supersedes the older "workflow
    classifies/copies" notes). Sequence: `resolveSocialReference` (pin → CMO →
    **`resolveSocialReferenceByInformation`**)
    → `generatePosterCopy` (gpt-5.6-luna,
    env `OPENAI_COPY_MODEL`; applies `lockSchemeNames` so a scheme name stays full/verbatim) →
    `buildPosterPrompt` → `renderSocialPosterViaN8n(id, imageUrl, prompt)`.
    **Reference selection is INFORMATION-FIRST** (2026-07-28,
    `references/select-by-information.ts`): the raw note is compared against EVERY enabled
    master of the brand across ALL types, using the informational descriptions cached on
    `reference_images.layout_spec` (`contentSummary` = what that poster is about,
    `layoutSummary` = how it arranges information), and the winning reference's own `subtype`
    resolves the poster TYPE — the CMO path's shape generalised to the DGIPR library. So the
    note is never classified into a type first, and `point_count`/`wants_photo` are no longer
    predicted at all: they were forecasts that constrained the pool *before* a reference had
    been looked at. Tone/mood/colour are explicitly NOT criteria (that is `rank-master.ts`'s
    different job); the ranker also returns the run's Marathi `referenceTitle`, which the
    retired classifier used to produce. It runs on `POSTER_COPY_MODEL` at medium effort —
    it inherits the classifier's tier because it is now the decisive routing call. A master
    with no `layout_spec` is invisible to it, so one is warmed per run (as before) and
    `analyze:references` is the backfill. `SOCIAL_REFERENCE_MODE=classify` restores the old
    classify→score-within-type flow (`socialReferenceMode()` in `runner.ts`, beside the
    `ARTICLE_POSTER_MODE` precedent); `listSocialTypes`, `classifyPosterType` and
    `selectMaster`'s `MasterNeed` scoring are kept alive for it. `step` is set
    directly at each stage (`classify`/`copy`/`image`) — the old n8n Ping nodes fired after the
    response and never reached the UI. `design_mode: 'fresh'` calls `generateImage` directly
    (no master). The API stamps `poster-logo.png` (top-right) + `poster-footer.png` (bottom) in
    code (`overlayTwitterChrome`) on every returned PNG — initial and image-feedback alike.
    The **caption is written by the API** (`generateSocialCaption`), **opt-in** — a social run
    is poster-only unless `generateCaption` was set, produced AFTER the poster row-write so a
    caption failure never costs the paid render. A run that skipped it gets one later via
    `startGenerateCaptionJob`.
    **The कॅप्शन lane inverts that: `row.outputType === 'article'` means NO poster at all** and
    the caption is the run's entire output — one `generateSocialCaption` call, no classify, no
    master, no n8n, no image spend. `outputType: 'article'` now reads the same on BOTH lanes
    ("this run renders no poster"); the article pipeline has always read it that way. It is
    taken off the **row**, not a job option like `generateCaption`, because a re-run cannot
    infer it: a null `posterPath` cannot distinguish "never wanted a poster" from "the render
    failed", so an option would be lost on the first retry — and `detail.outputType` is already
    forwarded by both retry paths. Caption-only is **terminal for posters** by design
    (`/generations/:id/poster` rejects social, `/poster/regenerate` needs a `posterPath`); the
    route to a poster is a fresh run from the same note via `NextActions`' cross-format fold.
    Publishing is refused (both X and the FB Page need the poster bytes/URL).
  - `startArticleFeedbackJob`, `startPosterFeedbackJob` (`copy` re-renders with the
    **cached** scene; `scene` regenerates the background image).
  - `startPosterImageFeedbackJob` (pixel feedback, both poster kinds): with marker
    annotations it draws numbered red boxes on the current poster
    (`annotateFeedbackRegions`), uploads `feedback-marked-v{n}-{ts}.png` (timestamped
    per attempt — the version counter only advances on success, so a failed round +
    resubmit would otherwise collide on the same path), turns marks +
    notes into one element-aware instruction via a `VISION_MODEL` vision pass
    (`interpretImageFeedback`, raw-notes fallback), and sends the marked URL +
    `marker_count` to n8n — whose feedback prompts branch on it (0 = legacy prompt
    byte-for-byte, so plain text feedback is unchanged). Web side:
    `PosterAnnotator` + `PosterImageFeedbackBox`. Deploy ordering is INVERTED for
    this feature: `pnpm n8n:push` first, API second (old workflow + new API can
    leave the red marker boxes in the output).
- DLO intake (meeting MP3s/PDFs/DOCX/TXT → reviewed Marathi text → normal generation):
  routes → `apps/api/src/routes/dlo.ts` (multipart with per-request `UPLOAD_FILE_MAX_BYTES`
  (**50 MiB**, `@dgipr/schemas`, shared with `/transcribe` and with the web pickers, which
  refuse an oversized file before the upload starts)/10-file
  limits + an 8 MiB `fieldSize` for the `documents` field; `/api/dlo/intakes` + `/:id`
  poll + `/:id/generate` + `/:id/files/:index/reextract`); job →
  `apps/api/src/jobs/dlo-runner.ts`
  (`startDloIntakeJob`: one Sarvam batch STT job for ALL audio, per-file doc
  extraction, per-file failures don't sink the intake);
  - **Audio transcripts are cached content-addressed** (2026-07-25, migration 0031). The
    transcribe phase hashes each MP3's bytes (`hashAudioContent`, SHA-256) and reads
    `audio_transcript_cache` (`getCachedTranscripts`) BEFORE Sarvam: a hit reuses the
    transcript, only misses go to `transcribeAudioFiles`, and a fresh transcript is written
    back (`putCachedTranscript`, best-effort). So re-uploading the SAME recording in any
    intake never re-transcribes. Server-side only — no client change; the MP3 is still
    archived to the private bucket. Only successful non-empty transcripts are cached, and a
    cache-read error (e.g. an un-applied 0031) degrades to "empty cache = transcribe all",
    so the optimization is disabled, never the intake. Cache access →
    `packages/database/src/stt-cache.ts`.
  - **Documents are read at the INPUT step, not by the job** (2026-07-25). `/dlo`'s
    document control is the shared `<DocumentIntake>` (one card per document, live mode),
    so attaching a scanned PDF shows the page picker immediately — the media room's
    behaviour — instead of after a form submit and a minutes-long job. Those documents
    reach `POST /dlo/intakes` as a `documents` JSON field (`DloPreReadDocumentSchema`:
    `jobId` + name + kind + the SELECTED pages with the officer's corrections) and the
    route stores each as an ordinary `files` entry with `status: 'done'` — which is why
    the review step, `assembleDloText`, lineage and `/:id/generate` needed NO changes.
    Two invariants: the job's extract phase **skips `status: 'done'` entries** (or a
    scanned PDF would be OCR'd a second time and the corrections lost) — and `'failed'`
    ones, which are the route's verdict rather than a state to retry — and the route
    archives the original by reading `getDocumentIntakeJob(jobId).data` **in process**
    rather than making the browser upload the same bytes twice. An expired ephemeral job
    (60-min TTL) yields an entry with no `storagePath`: the text still lands, only the
    re-read is lost, and `canReextract` on the detail payload is what hides that button.
    **Reading it there is OPTIONAL** (2026-07-26; default deferred on 2026-07-27): a scan can
    be OCR'd for minutes, so `/dlo`'s live page selection is handed over unread automatically
    (`allowDeferredRead` on `<DocumentIntake>` — /dlo only, being the one surface with a job
    downstream). The former **"न वाचता ही पृष्ठे वापरा"** button is gone; ticking pages is
    the handover, while **"निवडलेली पृष्ठे वाचा"** remains as the optional read-now action.
    The snapshot carries `pendingPages` and no `pages`, the create request sends the same
    field, the route stores a
    `status: 'pending'` entry carrying it, and the intake job's extract phase calls
    `extractPdfEntry(entry, entry.pendingPages)` instead of `probePdfEntry`. Same spend
    gate — the pages were still chosen before anything was billed — with the wait folded
    into प्रक्रिया, which the run was going to sit through anyway; the pages then show up at
    review as an ordinary read PDF. Here the archive is **load-bearing, not a
    convenience**: a deferred document carries no text at all, so an expired job means the
    route stores that file `failed` with an actionable Marathi message rather than dropping
    a whole source silently.
    MP3s are unchanged — a recording has no pages to pick, so it still travels as a file
    and is transcribed by the job. The `files` multipart path still accepts pdf/docx
    (back-compat); the web no longer uses it, so the job's probe/`needs-selection`
    machinery below is now reachable only through it.
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
- **Transcription (`/transcribe`) — recordings in, Marathi text out, nothing else.** The DLO
  intake job's transcribe phase as a product of its own: routes →
  `apps/api/src/routes/transcriptions.ts` (create/list/detail only — no review contract, no
  generation lineage, so there is nothing else to expose); job →
  `apps/api/src/jobs/transcription-runner.ts`; rows → `packages/database/src/transcriptions.ts`
  (migration 0037); shapes + `combineTranscripts` → `packages/schemas/src/transcription.ts`;
  web → `apps/web/app/transcribe/page.tsx` (ONE page — form, result in place, history list —
  because a transcript has no workspace to navigate to) + `TranscriptionForm`/`Result`/`List`
  + `useTranscription`/`useTranscriptionList`.
  Four things worth knowing. The recordings are ARCHIVED in the existing PRIVATE
  `dlo-uploads` bucket under a `transcriptions/{id}/…` prefix, so **0037 provisions no
  bucket**. It shares `audio_transcript_cache` (0031) with /dlo, so a recording transcribed
  on either surface is free and instant on the other — and the job shows cache hits before
  calling Sarvam, since an all-cached run needs no call at all. The list card's counters
  (`file_count`/`failed_count`/`char_count`) are **columns, not derived**: that is what lets
  the list query skip `files` and `combined_text`, which hold a whole meeting's transcript.
  And the transcript is rendered READ-ONLY — this page's contract is "the recording,
  verbatim"; correcting text before it becomes an article is /dlo's review step.
  Audio container rules are NOT redefined here: `AUDIO_FILE_ACCEPT`/`audioMimeForFileName`
  come from `schemas/src/dlo.ts`, so the picker can never offer a file the API refuses.
- **YouTube links as a source (both /dlo and /transcribe) — no downloader, by design.**
  ElevenLabs Scribe takes a **`source_url`** and fetches the media itself (its docs name
  YouTube explicitly; `source_url` supersedes the presigned-only `cloud_storage_url`), so a
  pasted link never becomes bytes on our side: no yt-dlp in the API image, no bot-check
  exposure, no archive object. **Check this before adding any downloader.** Link recognition
  + the probe shapes → `packages/schemas/src/youtube.ts` (`parseYouTubeVideoId` —
  `youtu.be`/no-scheme/`m.`/`music.`/`nocookie`/`/embed/`/`/shorts/`/`/live/`, strict
  11-char id; `canonicalYouTubeUrl`, which is what is STORED so a pasted `&t=` cannot ask
  the transcriber to start partway in); it lives in schemas because both sides run it and
  `apps/web` cannot import content-engine. Probe route → `apps/api/src/routes/youtube.ts`
  (`POST /api/youtube/probe`, public oEmbed — no key, no quota, title/channel/thumbnail and
  deliberately **no duration**, which would need a YouTube Data API key; a failed probe
  answers **200 with the id alone** so a private/unlisted video still submits). The STT seam
  takes either shape (`intake/audio-input.ts`, a UNION not optional fields); `elevenlabs-stt.ts`
  swaps its multipart `file` field for `source_url`; **Sarvam cannot serve one**, so
  `transcribeAudio` fails those inputs individually with a Marathi message while the
  intake's uploaded recordings still deliver. Two consequences to keep: the 0031 transcript
  cache is keyed on the audio BYTES, so it does not apply (empty hash, skipped on read and
  write-back), and **no migration** was needed — `files` is jsonb on both tables, so
  `kind: 'youtube'` + `sourceUrl`/`sourceAuthor`/`sourceThumbnailUrl` were additive and
  everything from the review step onward treats such a source exactly like a recording.
  Both create routes re-derive the video id server-side rather than trusting the client.
  Web → `components/YouTubeLinkInput.tsx` (shared by both forms, the `AudioFilePicker`
  precedent). Free harness: `npx tsx packages/schemas/src/youtube.ts` (run it from
  `packages/content-engine`, which has tsx).
- Proof Read (ad-hoc grammar/name/style check of pasted Marathi/English text):
  route → `apps/api/src/routes/proofread.ts` (`POST /api/proofread`, synchronous,
  nothing stored; assembles the verified-glossary context); engine →
  `packages/content-engine/src/generation/proof-read.ts` (2 chat calls max —
  analysis + confirm-or-drop verify, skipped when clean; corrected text is a
  deterministic excerpt→suggestion patch with a digit-preservation guard, never a
  model rewrite; name fixes are glossary-gated; Marathi input gets one RAG style
  exemplar); schemas → `packages/schemas/src/proofread.ts`; web →
  `apps/web/app/proofread/page.tsx`.
  - **The corrected text HIGHLIGHTS what changed, and the patcher therefore lives in
    `@dgipr/schemas`** (`applyProofreadFixes` + `buildProofreadHighlights`), not in the
    engine — `proof-read.ts`'s `applyFixes` is a one-line delegation to it. The web must
    mark the patched spans inside that very string and `apps/web` cannot import
    content-engine, so a second copy would drift; this is the `combineIntakeSources`
    move. `applyProofreadFixes` returns the patched text **plus which run came from which
    fix**, tracked through a per-code-unit owner array, because the patch is a
    *cumulative global* `split/join`: one fix can own several runs, a later short fix can
    match text an earlier one INSERTED (and across its boundary), and a swallowed fix
    produces no run while still appearing in `issues` — so `issues.length` is NOT the
    mark count and "search the output for the suggestion" is wrong. Style advisories are
    not applied, so they are located by lookup and marked **only inside untouched runs**.
    `buildProofreadHighlights` returns **null** when its replay does not reproduce
    `correctedText` byte-for-byte; the page then renders plain text — the text is
    authoritative, the marks best-effort. Free harness:
    `tsx src/generation/proof-read.ts --check`. Web: the `CorrectedArticle` component in
    `page.tsx` (one `--ok-soft` tint + solid underline for corrections, `--warn-soft` +
    dotted for advisories, original wording in a viewport-anchored hover/tap popover, and
    a default-on हायलाइट toggle); CSS block sits under the `.issue-*` one it borrows its
    "background tints only, no strikethrough" rule from. Copy and .txt download still
    emit `result.correctedText` untouched.
- Explainer videos (`/video` — note → AI scene PLAN → per-scene Marathi script →
  TTS voiceover → REALISTIC start+end frame pair per scene → provider-interpolated
  VOICED MP4 + SRT. **2026-07-26: realistic live-action look, not illustration**, and
  every scene is TWO reviewed frames: a photoreal START frame from gpt-image plus an
  END frame **EDITED from it** (`editImage`, the poster-renderer's new
  `/v1/images/edits` call — editing, not fresh generation, is what keeps the pair in
  ONE shot so interpolation reads as motion, not a crossfade), and Veo animates
  first→last): routes → `apps/api/src/routes/video.ts` (create/poll/
  script-save/storyboard/still/animate/scene-animate; the two review gates are idle
  statuses `script_ready`/`storyboard_ready`, and every route that leaves a gate flips
  the row BEFORE its 202 — the storyboard route flips step `narrate`, its job's first
  phase; the still route takes `frame: 'start'|'end'` — a START redraw regenerates the
  PAIR since the end derives from the start, an END redraw is one edit call; the
  animate guard requires every scene's declared end frame to be rendered); jobs →
  `apps/api/src/jobs/video-runner.ts` (script job,
  storyboard job — whose TOP is the TTS voice phase `ensureNarrationAudio`:
  synthesize per scene, MEASURE the WAV, and past `VIDEO_NARRATION_FIT_SECONDS`
  **rewrite that line shorter** (`shorten-narration.ts`, ≤2 attempts) and
  re-synthesize. **Narration is never sped up to fit** — the clip cannot grow, so the
  text moves; `muxNarration`'s atempo is a backstop that warns when it fires. The
  rates are MEASURED, not guessed (16.5 chars/s, 2.3 words/s for `shubh` on
  bulbul:v3): the old 32/4.5 were ~2x too fast, so the old 280-char cap was really
  ~17s of speech in an 8s clip and the surplus was being **hard-trimmed** — words cut
  off scene ends. Re-run the calibration if the voice changes; never adjust by
  intuition. Coverage is TIERED here too: the planner/writer/shortener prompts all
  rank core point → citizen-actionable detail → the rest, and omitting a fact beats
  stating it vaguely (never-invent stays absolute; anything kept stays verbatim).
  **Every clip is a fixed 8s**
  (`VIDEO_INTERPOLATION_SECONDS`, schemas) — Veo rejects interpolation at 4/6s with
  INVALID_ARGUMENT, so the measured-window fit is RETIRED (the script writer fills
  ~7.2s of it, ~17 words/scene; `fitSceneDurationSeconds` survives in schemas as
  legacy/display, `VIDEO_NARRATION_CHARS_PER_SECOND` is unread). WINDOW-FREEZE rule
  unchanged: a scene with a current clip keeps its window (atempo absorbs drift, never
  invalidate a paid clip; `clipIsCurrent` checks `clipDurationSeconds` AND — the new
  lineage — `clipEndStillVersion` against `endStillVersion`, so an end-frame redraw
  invalidates the clip exactly like a start-frame redraw); per-scene TTS failure →
  silent render, never a stuck gate — then per-scene frame PAIRS; RESUME-AWARE animate
  job — each clip persisted the moment it lands, retry re-renders only missing
  scenes — and a per-scene re-animate that restitches without touching other clips;
  a legacy scene with no `endStillPath` animates first-frame-only, never blocked);
  engine → `packages/content-engine/src/video/*` (`plan-video-scenes.ts` — the
  planner picks scene count (2-8) + Marathi `beat` + live-action `shotHint`,
  citizen-first tiering; it no longer picks durations; `generate-video-script.ts`
  JSON+repair writing narration + `visual_brief` + `end_visual_brief` (the SAME
  shot's end state — same place/people/light, by rule) AGAINST the plan, one bounded
  coverage round, and a per-scene `key_point` — the short Marathi line burned on
  screen, gated by a deterministic digit guard (`keyPointOf`: every digit run must
  occur in the note, Devanagari and Latin compared in one script, failure DROPS the
  line rather than failing the run); `video-prompts.ts` — **`SETTING_RULE`
  (Maharashtra, India; Indian people, clothing, streets and offices) hard-appended to
  ALL THREE prompts in code**, which is the fix for a pipeline that had never named a
  country and returned a blonde Western woman: an instructed rule can be lost by the
  model authoring the brief, a code-appended one cannot. REALISM_RULE (photoreal
  live-action) in both frame prompts, `buildEndFramePrompt` is an images/EDITS
  instruction ("same location, same people, a few seconds later") that also says
  *remove any writing already visible*; every prompt HARD-FORBIDS on-screen text
  (Devanagari garbling) and TALKING/lip movement (Veo's worst artifact; close-ups and
  expressive faces are now allowed — `photorealistic faces`/`close-up face` came OUT
  of `VEO_NEGATIVE_PROMPT`, anti-cartoon/CGI and `Western setting` terms went in).
  **`NO_TEXT_RULE` is phrased POSITIVELY and stands as its own final block** — a bare
  "no text" contradicts a scene containing forms or a door plate, so the model painted
  them and filled them with gibberish (a real render read `मरी रूटूम`); it now says
  signboards are plain painted panels, forms and files are blank sheets, screens are
  off. `buildKeyframePrompt`'s 4th arg emits `WORLD_REFERENCE_RULE` when an earlier
  scene's frame is attached; `buildClipMotionPrompt` +
  `CLIP_NEGATIVE_PROMPT` are provider-neutral (renamed off `buildVeoMotionPrompt` /
  `VEO_NEGATIVE_PROMPT`), and two helpers exist purely because **Kling has no
  negative-prompt field and caps prompt length**: `buildAvoidClause` restates the
  list as an instruction the prompt body can carry, and `fitClipPrompt` trims to a
  budget in an order that NEVER touches `SETTING_RULE`/`NO_TALKING_MOTION_RULE`/
  `NO_TEXT_RULE` — those sit last, exactly where a naive tail truncation would eat
  them, so there is no blind `.slice()` in it (drop order: avoid clause → style
  paragraph toward a floor → end brief → open brief → style dropped; overshoot +
  warn beats mutilating a rule, since 2500 is Kling's *recommendation* and 3072 its
  hard cap). Free: `tsx src/video/video-prompts.ts`;
  **`clip-provider.ts` — the model-swap seam**: the runner calls neutral
  `renderClip({startFramePng, endFramePng?, …})` dispatched on
  `VIDEO_CLIP_PROVIDER` (default `veo`, **deployed as `kling`**), and
  `clipProviderApiKeyEnv()` is what lets the animate route name the RIGHT key —
  frames are already rendered by animate time, so a Kling-clips box needs no
  `GEMINI_API_KEY` for that gate (it still needs one for the FRAMES). Free:
  `tsx src/video/clip-provider.ts`;
  **`kling-client.ts` — Kling 3.0 on the OFFICIAL `api-singapore.klingai.com`**
  (model-specific endpoint `POST /image-to-video/kling-3.0`, poll
  `GET /tasks?task_ids=`), over `http/kling-request.ts`. Five things to know before
  touching it: auth is a **plain API key** (`KLING_API_KEY`, `Authorization:
Bearer`) — the AK/SK JWT in Kling's docs is legacy-only and 3.0 is not on it; **a
  200 with `code !== 0` is a failure**, which `klingFetch` owns by returning the
  envelope's `data` so no caller re-implements the check; **`multi_shot` defaults to
  `true`** and is sent `false` explicitly (a single-shot interpolation prompt would
  otherwise come back as a montage — the loudest rung on its downgrade ladder);
  there is **no `aspect_ratio` field**, so the FRAMES decide the output shape and
  the client fails free when start/end disagree; and `settings.audio: 'off'` +
  `settings.resolution` (`KLING_RESOLUTION`, **pinned `720p`**; unset ⇒ tier-driven,
  fast/lite 720p, standard 1080p — resolution is Kling's price axis, 6 credits/s at
  720p vs 8 at 1080p). Frames travel as **q92 JPEG base64** (two inline PNGs would be
  a ~10 MB body per clip); the raw-vs-`data:`-URI encoding is the one genuine unknown
  and is LEARNED per model. Free: `tsx src/video/kling-client.ts --check`; paid:
  `tsx --env-file=../../.env src/video/kling-client.ts <start.png> [end.png]`;
  **`frame-provider.ts` — the same seam for the
  FRAMES** (`renderFrame({prompt, aspect, sourceFramePng?, referenceFramePng?})` on
  `VIDEO_IMAGE_PROVIDER`, default **`gemini`** = Nano Banana
  (`gemini-3-pro-image-preview`) via `gemini-image-client.ts`, `openai` = gpt-image via
  poster-renderer); it takes an
  **aspect, not a pixel size**, which is what lets the Gemini path skip
  `cropToAspect` entirely (native `imageConfig.aspectRatio`) while the OpenAI path
  still renders 3:2 and crops. ONE `:generateContent` call serves both frames —
  text-only generates the START, text+image EDITS it into the END.
  **`referenceFramePng` is scene 1's approved frame, attached to scenes 2..N**
  (`loadWorldReference` in the runner) so the video reads as one production — the
  `style` paragraph alone let four scenes come back as four unrelated worlds. On the
  **gemini** path it is passed ONLY on a fresh generation, NEVER beside
  `sourceFramePng`: two inline images plus "edit this" is ambiguous, and the client
  throws rather than send both. The **openai** path carries it in both cases —
  `editImage` now takes several buffers and posts them as gpt-image's `image[]`,
  whose FIRST entry is the canvas and the rest context (a single image still posts
  the old scalar `image` field, so nothing else changed shape); a fresh frame with a
  reference goes through `/v1/images/edits` with the reference as the canvas, which
  is exactly what `WORLD_REFERENCE_RULE` is worded for. So the two providers differ
  in cost and look, not capability, and `VIDEO_IMAGE_PROVIDER=openai` is a real
  one-line switch. Best-effort everywhere;
  `veo-client.ts` raw-REST long-running-op client
  over `http/gemini-request.ts`, model ids env-overridable `VEO_MODEL_*`, key
  `GEMINI_API_KEY`; **per-model params are LEARNED, not declared** — `negativePrompt`
  as before; `lastFrame` twice over: the field's JSON shape is learned
  (bytesBase64Encoded first, docs' inlineData on a 400 naming the field, cached per
  model) and a model rejecting the field outright (the lite preview) is cached and
  rendered start-frame-only with a warning, never failed — which is why `lite` is
  gone from the web tier picker but kept in the schema for legacy rows; and
  **`generateAudio: false` + `resolution`** (`VEO_RESOLUTION`, default 1080p — free,
  Veo bills per second not per pixel). **Veo renders SILENT on purpose**: the
  voiceover is Sarvam's and the mux discarded Veo's track anyway, so generating it
  only bought cost, latency and Google's separate **audio** safety filter — which
  fails the whole clip after the full render wait ("an issue with the audio for your
  prompt"). If that error ever returns, check this flag first; assembly →
  `packages/poster-renderer/src/video/assemble.ts` (ffmpeg-static, `-an`
  yuv420p+faststart, `FFMPEG_PATH`, `wavDurationSeconds`) — which now also **burns in
  the on-screen Marathi key points**: `assembleSilentVideo(clips, overlays?)` chains a
  `scale2ref` + `overlay=0:0:enable='between(t,s,e)'` pair per scene into its EXISTING
  encode (one pass, not two; byte-for-byte the old behaviour when omitted), before
  `muxNarration`, which copies the video stream and needed no change. **The `scale2ref`
  is load-bearing and was a real silent bug**: `CAPTION_FRAME_SIZE` typesets at a fixed
  1080p reference, so at Kling's 720p a 1920x1080 overlay composited at `0:0` put the
  lower-third panel below the bottom edge and the key point VANISHED with no ffmpeg
  error (measured: 0.00% panel pixels vs 14.7% after the fix). It resolves `w=iw:h=ih`
  against the REFERENCE input, so no footage size is written down and it is a no-op at
  1080p. `video:preview:captions --720p` is the regression test and asserts the panel is
  on-frame rather than asking you to look. The PNGs are transparent full-frame
  overlays typeset by **Chromium** (`video/caption-overlay.ts` → `renderHtmlToPng`'s new
  `transparent` option → `omitBackground`) — the poster doctrine, so no image or video
  model ever renders Devanagari and `NO_TEXT_RULE` stays absolute. Windows come from
  `sceneTimings`, the same function the SRT uses, so caption/cue/footage cannot
  disagree; a scene with an empty `keyPoint` gets no overlay (also how an officer turns
  it off). Rendering is best-effort per scene — the clips are already paid for.
  rows/bucket →
  `packages/database/src/video-projects.ts` + the PUBLIC `videos` bucket (migration
  0026; scenes are jsonb — `endVisualBrief`/`endStillPath`/`endStillVersion`/
  `clipEndStillVersion`/`keyPoint` joined `beat`/`shotHint`/etc WITHOUT migration);
  shared tier
  pricing + `buildSrt` + `VIDEO_KEY_POINT_MAX_CHARS`/`VIDEO_STYLE_MAX_CHARS` →
  `packages/schemas/src/video.ts` (web must not import
  content-engine). **`style` is officer-editable at gate 1**
  (`UpdateVideoScriptRequestSchema.style`, no migration — the column exists); changing
  it skips the script route's keep-frames branch and returns every scene to `pending`,
  since it feeds every frame prompt. `keyPoint` is deliberately NOT in that staleness
  test — it is burned on at stitch time and no frame is rendered from it. One active
  project at a time (DB-backed 409). Spend is 8s×scenes×`VIDEO_TIER_PRICE_PER_SECOND_USD`,
  and that table is **per-deployment truth** — it is now FLAT at Kling 720p's ~$0.10/s
  (tier changes nothing while `KLING_RESOLUTION` is pinned, and showing a fake tier
  differential to the officer approving gate 2 would be worse than showing none). The
  number is CONFIGURED, not discovered: `kling-client` logs Kling's returned `billing[]`
  on every success, which is the calibration signal — reconcile once and edit the
  constant. Restore standard 0.40 / fast 0.15 / lite 0.08 alongside
  `VIDEO_CLIP_PROVIDER=veo`. **Switching provider or resolution changes the frame SIZE of
  new clips**, so re-animate ALL scenes of any project you then touch or the stitch
  concatenates mixed-size clips. Harnesses: `video:preview:assemble` (free),
  `video:preview:captions [--vertical] [--720p]` (free — renders the caption overlays and
  burns them onto light/dark stub clips, asserting the panel is on-frame; the loop for
  tuning `caption-overlay.ts`, the decisive Devanagari-conjunct check, and the 720p
  regression test), `tsx src/video/video-prompts.ts` (free — asserts the
  setting/no-writing/no-talking rules reach all three prompts, plus the avoid clause and
  the trim order), `tsx src/video/clip-provider.ts` (free — dispatch + which API key each
  provider's gate names), `tsx src/video/kling-client.ts --check` (free — resolution
  mapping and every pre-flight guard),
  `tsx src/video/generate-video-script.ts --check` (free — the key-point digit guard),
  `tsx --env-file=../../.env src/video/plan-video-scenes.ts --file=note.txt
  [short|long]` (cents), `tsx --env-file=../../.env
  src/video/generate-video-script.ts --file=note.txt [short|long]` (cents),
  `tsx --env-file=../../.env src/video/kling-client.ts <start.png> [end.png]`
  (~$0.80 at 720p — run FIRST to prove the base64 frame encoding on a live model,
  and to read the real `billing[]`),
  `tsx --env-file=../../.env src/video/veo-client.ts <start.png> [end.png]` (two
  PNGs force the 8s interpolation window, ~$1.20 fast — the veo-path equivalent,
  proving the lastFrame shape). No n8n anywhere on this path.
- **Department usage analytics (`/analytics`) — how much the department uses the platform.**
  One read-only endpoint serves the landing page AND all six drill-downs, which is what makes a
  card's number and its feature page's number impossible to disagree: route →
  `apps/api/src/routes/analytics.ts` (`GET /api/analytics?range=7d|30d|90d|all`); aggregation →
  `apps/api/src/jobs/analytics.ts`; lean windowed reads → `packages/database/src/analytics.ts`;
  events → `packages/database/src/usage-events.ts` (migration 0043); shapes + the INR rate + the
  reporting timezone → `packages/schemas/src/analytics.ts`; web → `apps/web/app/analytics/page.tsx`
  + `analytics/[feature]/page.tsx` + `Analytics*` components + `lib/analytics.ts`/`useAnalytics.ts`.
  Six things worth knowing before changing it. **There is no auth**, so every figure is
  DEPARTMENT-WIDE per feature and nothing counts individuals — `dgipr.dlo.mine` is ordering, never
  identity. The क्रिएटिव्ह आणि सोशल / लेख-बातमी split is `dlo_intake_id`, not category, so
  `news`/`scheme` appear under both by design. **No query may select a text column** (`note`,
  `article`, `combined_text`, `files`, `scenes`); the four metrics that need a text column to be
  non-null use a head-only COUNT, and every list PAGES because PostgREST silently caps at 1000
  rows. All day boundaries are `Asia/Kolkata` and windows are half-open with `to` = start of
  tomorrow. A feature whose spend is not metered to a row reports `costInr: null`, never ₹0.
  And **`usage_events` writes are fire-and-forget** — a logging failure must never fail an
  officer's run (verified live against a database without 0043), which is also why an un-applied
  0043 costs only the three event-backed cards. The payload carries machine keys only; every
  Marathi label is in `apps/web/lib/strings.ts`.
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
- Social captions (the caption is `generations.article`) — **written by the API, opt-in,
  and separable from the poster.** The engine is
  `packages/content-engine/src/generation/generate-caption.ts` (`generateSocialCaption`;
  the retired n8n `Build Caption Request` node's house style ported verbatim — 📍 place
  line, inline hashtags only, `@MahaDGIPR` last, note as sole fact source — with X's 280
  stated as a rule only for `twitter`). Three ways in, all on `SocialPostView`:
  at creation (`generateCaption` on `POST /generations`, default **false**, toggle under
  the format cards); on demand for a poster-only run
  (`POST /api/generations/:id/caption/generate` → `startGenerateCaptionJob`, guarded on
  completed + no existing caption); or typed by hand (`PUT …/caption`, whose "no caption
  yet" 409 now only fires on an unfinished run, so a first caption can be typed).
  `startGenerateCaptionJob` inserts **no** revision row — nothing was revised, and an
  extra row would advance `nextVersion()` and misnumber the next poster.
- Caption editing on a social run: two paths on
  the same detail-page card (`SocialPostView`) — a **hand edit** (the caption is a
  read-only `.social-caption` block until "कॅप्शन बदला" swaps in a textarea;
  `PUT /api/generations/:id/caption`, synchronous, no model call) and an **AI
  revision** (`POST /api/generations/:id/caption/feedback` → `startCaptionFeedbackJob` →
  `reviseCaption` in `packages/content-engine/src/generation/revise-caption.ts`; one
  chat call + one repair, note-as-sole-fact-source guardrails, numerals re-scriptable
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
- **Person → designation (पदनाम) — the first time the name dictionary reaches the ARTICLE.**
  A recording says `देवेंद्र फडणवीस`; the published article must say `मुख्यमंत्री देवेंद्र फडणवीस`.
  Data: `glossary_terms.designation` (0032, person rows only, holds the MARATHI title) +
  `generations.name_designations` (0033, the pairs approved for one run, insert-only,
  omitted-unless-present). The title's English/Hindi are NOT stored on the person — they come
  from that title's own `designation`-typed glossary row, which is why **`translate-article.ts`
  needed no change at all**: English's `LOCKED TERMS` table already locks
  `मुख्यमंत्री → Chief Minister` (seeded in 0010) and Hindi deliberately translates
  `designation` rows (जिल्हाधिकारी → जिलाधिकारी) while freezing `person` rows. Insert the
  designation into the Marathi article and both translations follow.
  Review before generating: `POST /api/designations/prepare` →
  `prepareDesignations` in `apps/api/src/jobs/translation-terms.ts`, which shares its merge
  (`extractGlossaryCandidates` ∪ `findGlossaryTermsInText`) with the pre-translation name check
  — one detector, two questions. Web → `apps/web/components/DesignationReview.tsx` (datalist of
  known titles, per-row **"यापुढेही हेच वापरा"** write-back), shown in `/dlo`'s middle step beside
  `PointerList` and as a submit-time gate on the media room that **auto-skips when the text
  names nobody**. Write-back → `apps/api/src/jobs/designation-writeback.ts` (patches the person
  row in place via `setPersonDesignation` — never `upsertGlossaryTerm`, which would clobber a
  reviewed English spelling — and ensures the TITLE exists as its own row, the step that makes
  English translation work).
  Enforcement is instructed **and** structural, the repo's usual pair. Prompt: a
  `<DESIGNATIONS>` block + `DESIGNATION_TASK_RULE` in `category-prompt.ts` (first mention in
  full, later mentions bare). **The load-bearing part: `DESIGNATION_ALLOWED_RULE` must reach
  every checker and revision prompt** — `findUnsupportedClaims` treats a पदनाम absent from the
  note as an unsupported claim, and an approved designation is by definition absent from the
  note, so without it the pipeline inserts the designation and then pays a repair call to strip
  it. That is why it appears in `verify-coverage.ts`, `buildCoverageRevisionMessages`, and all
  three revise-article builders. Guarantee: `applyDesignations`
  (`content-engine/src/generation/apply-designations.ts`) — first exact occurrence only,
  honorific-aware (inserts BEFORE `श्री.`), replaces a *different* known title rather than
  duplicating it, never touches digits — **plus, since 2026-07-28, EVERY standalone mention of the
  approved name's SURNAME** (`असल्याचे सांगत फडणवीस यांनी` → `… मुख्यमंत्री फडणवीस यांनी`), which is also
  what rescues an article that only ever has the surname. Whole-word only, so an inflected
  `फडणवीसांनी` is left alone, and a surname TWO approved people share is disabled for both — that
  ambiguity is the review card's question, not this pass's. Which person a bare surname is comes
  from `resolveSurnameDesignations` (`translation-terms.ts`): the dictionary's full-name rows are
  indexed by last word, a person whose FULL name is already in the text is skipped (their own row
  covers it), and when several share the surname exactly one of their stored titles must occur in
  the text or nothing is proposed. The pair it produces names the **surname**, never the
  dictionary's first name — adding an approved title is not licence to add a name.
  It runs **after `generateFactCheck`** in both `generateArticle` and `reviseArticle`, so the
  traceability appendix cannot emit a false `(टिपणीत आधार नाही)` for the officer's own title.
  The media room's `articleProvided` branch applies it to the pasted article too. Unapplied
  pairs are REPORTED (`designationWarnings`, in-process registry beside `translateWarnings`,
  surfaced on `ArticleView`), never fatal. Free harness:
  `tsx src/generation/apply-designations.ts`.
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
- **Shared document intake (pdf/docx/txt) — the layer every upload surface sits on.**
  Engine dispatcher → `packages/content-engine/src/intake/document.ts`
  (`documentKindOf` / `probeDocument` / `extractDocument`; PDFs delegate to `pdf-pages.ts`
  unchanged, DOCX to `docx.ts`, TXT to the new `text-file.ts` — which deliberately does NOT
  run `unwrapSoftLineBreaks`, that being a fix for PDF line-wrapping, not for authored
  text). The property the whole stack rests on: **a non-PDF always returns its pages at
  PROBE time** (reading it was local and free), so the page-selection step disappears for
  txt/docx with no branch in the UI — there is nothing to choose because nothing is being
  bought. Shared shapes → `packages/schemas/src/document.ts` (`DocumentDetail`,
  `DocumentPage`, `ExtractDocumentRequest`, …; `translate-document.ts` IMPORTS these rather
  than redefining them, and the index exports `document.js` first, so each name has one
  definition). Generic ephemeral service → `apps/api/src/jobs/document-intake.ts` +
  `apps/api/src/routes/documents.ts` (`POST /api/documents` probes only, `GET /:id?text=1`,
  `POST /:id/extract`, `POST /:id/reextract`; in-memory, 60-min TTL, bytes held for the
  job's life). Web → `apps/web/components/DocumentPages.tsx` (**the** page list:
  text-layer/OCR badge, per-page editor, OCR-override confirm — used by all four surfaces),
  `components/PageRangeSelector.tsx` (**the** page picker — see below),
  `components/DocumentIntake.tsx` (the whole ephemeral upload→pick→review flow, for surfaces
  that just want a string — in two modes: **handoff** (`onText`, the default) commits only
  when "हा मजकूर वापरा" is pressed, right for a surface whose one box the file REPLACES
  (/translate, /proofread); **live** (`onTextChange`) streams the current text as it changes
  and hides the button, for a surface that keeps the file BESIDE its own box (the media
  room), where an unpressed button silently discarded the whole upload),
  `lib/useDocumentIntake.ts`,
  `lib/documentSelection.ts`. Neither `DocumentPages` nor `PageRangeSelector` holds selection
  state, on purpose — the surfaces disagree about how to store one (/translate tracks pages
  it WANTS, /dlo tracks keys the officer EXCLUDED across several files), so they ask a
  predicate and report events.
  **Page selection is a RANGE FIELD, not a row of checkboxes** (`PageRangeSelector`): a
  checkbox per page is unusable at the 20-50 pages a real scanned booklet has. The field
  takes "1-5, 8, 10-12" (Devanagari digits accepted) and sits above a grid of numbered chips,
  animated open by transitioning the grid's own `0fr → 1fr` height so it fits any page count
  with no magic max-height. **`collapsible={false}` on the pre-read picker** (2026-07-26): there
  the grid IS the control the user came for, so it is always open and the toggle is not rendered
  at all; above an already-read document's text rows it stays foldable (`defaultExpanded`),
  being a shortcut over a list already on screen. `parsePageRanges`/`formatPageRanges` in
  `lib/documentSelection.ts` are the pure two-way conversion. The load-bearing trick: a typed
  range is applied by **toggling only the pages that differ** from the current selection,
  never by setting a set — that is what keeps one component compatible with both a "wanted"
  and an "excluded" model, since every parent's `onToggle` is a functional update.
  A document that has NOT been read shows the selector alone (its text does not exist yet);
  a read one shows the selector folded above the editable rows. `showSelectAll={false}`
  (/dlo, whose card header is already the file's select-all) and `showRangeSelector={false}`
  are the escape hatches. `PageRangeSelector`'s input id comes from `useId()` — /dlo shows
  several pickers at once and a fixed id made every label focus the first one.
  Adopted by ALL FOUR surfaces inline — the "फाईलमधून मजकूर घ्या"
  fold is gone everywhere, so the capability looks identical on every page. **/dlo's
  DOCUMENTS now go through this service too** (2026-07-25 — see the DLO bullet above; that
  is also where `.txt` support came from), so `dlo-runner.ts` still owns intake job state
  but no longer reads documents on the normal path. `<DocumentIntake>`'s live mode reports
  a second `DocumentSnapshot` argument (jobId/fileName/kind/source/pageCount + the selected,
  edited pages) for a caller that needs to describe the file rather than just hold its text;
  `title`/`hint`/`onRemove` are the other /dlo-driven additions.
  Harness: `tsx --env-file=../../.env src/intake/document.ts <file> [--probe] [--pages=2,5]`.
- **PDF text extraction (every surface that takes a PDF — the shared intake and DLO).**
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
- **`/translate` has ONE flow — there is no PDF mode.** A file (pdf/docx/txt) is read by the
  shared `<DocumentIntake>` and its text lands in the SAME box the user could have pasted
  into; from there it is the pasted-text path exactly, synchronous, name check and all
  (`apps/web/app/translate/page.tsx`). `TRANSLATE_TEXT_MAX_CHARS` is therefore 60,000, not
  10,000 — a whole document has to fit — and `translateArticle` already chunks internally, so
  the cap bounds how LONG one synchronous request runs, not whether it works. The intake is
  given that cap as `maxChars`, which is what makes page selection the way to trim an
  over-long booklet.
  The **dead** per-page/per-language document path (background job, `selecting` status, AI
  page instruction, separate English/Hindi page-by-page results) still exists server-side and
  is deliberately left intact but UNUSED: `apps/api/src/jobs/translate-document.ts`, the
  `/translate/documents*` routes in `apps/api/src/routes/translate.ts`,
  `packages/content-engine/src/generation/translate-document.ts`,
  `interpret-document-instruction.ts`, `packages/schemas/src/translate-document.ts` (whose
  shared shapes ARE still imported by `document.ts`). Its web half
  (`TranslateDocumentPanel.tsx`, `useTranslateDocument.ts`) is deleted. Restore from git if
  per-page translation is ever wanted back; do not assume the routes are live. Harness (still
  works): `tsx --env-file=../../.env src/generation/interpret-document-instruction.ts "<सूचना>"`.
- **An article poster whose news has a NAMED SUBJECT says only that name.**
  `generation/resolve-poster-subject.ts` (was `resolve-scheme-subject.ts`) decides, per RUN and
  per CONTENT — not per category, and no longer only for schemes: a scheme, campaign, mission,
  **award**, **service/model**, portal, fund or project all qualify (`SUBJECT_KIND`). There is
  **no pre-filter** — the old `mentionsScheme` token gate is deleted, because no token list
  covers पुरस्कार or ‘भारत टॅक्सी’ and it was silently returning `null` before spending a token;
  one `POSTER_COPY_MODEL` call per article poster is nothing beside the image render it guards.
  The model only **nominates** and must cite a verbatim `evidence` sentence; then
  `validatePosterSubject` is the **deterministic verdict** — quotes/edge punctuation stripped
  (‘भारत टॅक्सी’ → भारत टॅक्सी), ≥2 words, and the name accountable in **note ∪ article** via
  `validateDeclaredSchemeNames`'s inflection tolerance (योजना → योजनेच्या) or via `lockSchemeNames`
  expanding a truncation against verified glossary rows (a repair that only ever LENGTHENS toward
  the source), plus a lenient `isProminent` backstop that rejects a name occurring ONCE and late
  in a long note (the shape of a passing mention). Unaccountable → `null` and the poster keeps its
  editorial headline. The prompt's `TEXT LOCK` block (`textLocked`, was `schemeLocked`) then says
  reproduce this exact string, **year included** — and deliberately does NOT call it a scheme, so
  an award name is not "corrected" into scheme-shaped wording. Accept rules to keep: a
  statement/announcement/launch ABOUT a named thing counts; an invitation for applications counts;
  a change to scheme A that also cites older scheme B picks **A**. The terra tier is deliberate —
  only the NAME is code-checked; the judgement is not, and it decides the poster's whole visible
  text. Harness: `tsx src/generation/resolve-poster-subject.ts` (free, validation half) or
  `--file=note.txt` for a live check (cents; always use `--file`, npx truncates multi-line argv
  on Windows).
- **The officer can override that text outright: `generations.poster_heading` (0029).** Typed on
  the media room (shown only for the पोस्टर output) or on `PosterPanel` after seeing the poster
  (`POST …/poster/regenerate { posterHeading }`, `''` clears it back to automatic). It wins over
  both the subject resolution — which is then not even called — and the editorial headline, and is
  reproduced through the same TEXT LOCK. It is PERSISTED (a job parameter would be lost on the
  first redo) and written by the regenerate job BEFORE the render. `insertGeneration` omits the
  column unless a heading was actually typed, so a database without 0029 loses only this feature
  rather than failing every create — the 0028 principle.
- **Article poster look = the SHARED palette rotation + its OWN landscape composition library.**
  `generation/article-poster-layouts.ts` holds 11 landscape archetypes (`art_`-prefixed ids;
  `coverage` values `panel`/`split`/`band`/`field`/`wedge`), each stating the **headline-only**
  rule and the reserved zones (top-left ~420x180 logo, bottom ~150px footer — keep in sync with
  `poster-renderer/src/article-chrome.ts` and web's `ARTICLE_RESERVED_ZONES`). Colours are NOT
  duplicated: `poster-palettes.ts` is shared verbatim. `poster-style.ts` resolves an id through
  BOTH libraries (`anyLayoutById`), and `listRecentPosterStyles(client, limit, categories)` is
  SCOPED per lane so a social coverage can't bar an article pick. Harnesses (free):
  `tsx src/generation/{article-poster-layouts,build-article-poster-prompt}.ts`.
- **Social poster look = TWO assigned rotations, not the model's taste.** A fresh (fully-AI)
  social poster gets a **colour palette** (`generation/poster-palettes.ts` — 18 entries, 3 per
  family across `cool|teal|green|purple|neutral|warm`, each with 4 exact **hex** values and a
  family-tinted light ground; only `warm` may be cream) and a **composition archetype**
  (`generation/poster-layouts.ts` — 11 archetypes with a `coverage` tag, a hard photo filter and
  a copyStyle filter). Both are picked per run by a seeded, recency-aware picker that drops
  recent FAMILIES/coverages first, then ids. `art-direction.ts` designs WITHIN both and chooses
  neither — with a palette assigned, `palette` is not even in its json_schema.
  **The one thing that must never regress:** `build-poster-prompt.ts` emits the assigned hexes as
  a `COLOUR SPECIFICATION` block whenever a palette is present. It used to emit the art director's
  paraphrase INSTEAD, which made the whole rotation nearly inert (see the 2026-07-24 diversity
  milestone in AGENTS.md). Colour is also stripped out of the master's `layoutSummary`
  (`generation/strip-colour-words.ts`) and out of the ranking criterion
  (`rankMasterByNote(..., { ignoreColour })`), because the master library is overwhelmingly
  saffron/maroon/cream and those were live leak channels.
  What a run was assigned + what it MEASURED is persisted as `generations.poster_style` (0028,
  shape + parser in `generation/poster-style.ts`); `listRecentPosterStyles` feeds the next run's
  avoid set, using the **measured** hue buckets as well as the assigned families — if the image
  model ignores the spec, avoiding intentions achieves nothing. Measurement is
  `measurePosterColours` (`packages/poster-renderer/src/poster-colours.ts`, **chroma not HSL
  saturation** — HSL rates a pale cream at 0.84 and would report a poster's background as its
  dominant colour), run on the RAW poster before chrome. A mismatch is logged, never retried.
  The style write is a SEPARATE best-effort update after the poster write, so a database missing
  0028 loses the rotation memory rather than the paid render. Harnesses (all free):
  `tsx src/generation/{poster-palettes,poster-layouts,poster-style,strip-colour-words,build-poster-prompt}.ts`;
  `pnpm --filter @dgipr/poster-renderer poster:preview:colours <poster.png|url> …` measures
  finished posters (accepts URLs, so a set of live posters can be checked for sameness).
- **Article generation has TWO pipelines, chosen by `ARTICLE_GENERATION_MODE` (default
  `simple`).** The flag is read in ONE place, `articleGenerationMode()` in
  `apps/api/src/jobs/runner.ts`, beside the `ARTICLE_POSTER_MODE` precedent.
  - `simple` (default) → `generation/generate-article-simple.ts`: **one style reference, one
    model call, one article**. `selectStyleReference` (≤1 embedding) → `chatComplete` on
    `ARTICLE_MODEL` → `applyDesignations`. No 5W1H call, no editorial brief, no tier audit, no
    sectioned drafting, no coverage-revision loop, no faithfulness repair, no traceability
    appendix. Steps are `retrieve → draft → done` — all existing `GenerationStepSchema` values,
    so no schema change. Returns `factCheck: null` always, and `fiveWOneH: null` unless the run
    carries approved /dlo pointers (**null, not an empty scaffold** — `[id]/page.tsx:168` gates
    the card on truthiness and an all-empty object renders six "टिपणीत नाही" rows). Since /dlo's
    Pointers step became a read-only summary, **no new run carries an inventory**, so in `simple`
    mode `fiveWOneH` is now null for every fresh run and the तपशील card renders only for legacy
    rows. `full` mode still populates it via `extractFiveWOneH`, so the card is mode-dependent.
  - `full` → `generation/generate-article.ts`, the multi-stage editorial pipeline, **byte-for-byte
    untouched** (`extract-5w1h.ts`, `editorial-brief.ts`, `verify-coverage.ts`,
    `polish-article.ts`, `news-exemplar.ts` all unchanged). Rollback is this one env line.
  - **The editorial specification** is `generation/simple-article-prompt.ts` — a system message
    of DGIPR rules plus a user message of filled INPUTS, versioned by
    `SIMPLE_ARTICLE_PROMPT_VERSION` and persisted per run. Every optional slot is OMITTED when
    empty rather than rendered blank, and the **dateline is rendered, not substituted** (a blind
    substitution emits `, दि.  :` or leaks a literal `{{location}}`). `location`/`date` are
    deliberately unsupplied today — nothing trusted collects them and no call infers them.
    Word targets come from `ARTICLE_WORD_TARGETS` in `@dgipr/schemas` (बातमी 350/250–450,
    योजना-लेख 600/450–750), stated as soft guidelines. Free harness:
    `tsx src/generation/simple-article-prompt.ts` (50 assertions).
  - **Style reference = 3 tiers** (`generation/select-style-reference.ts`): the officer's pasted
    article (`generations.style_reference`, 0035) → the closest Mahasamvad article **above
    `ARTICLE_STYLE_REFERENCE_MIN_SIMILARITY`** (default 0.35) → nothing. The floor is the fix for
    a retrieval path that had **no threshold at all** — `pickBestMatch` returns the argmax
    unconditionally, so an unrelated article became the exemplar whenever the corpus held nothing
    close, which is worse than no exemplar. **Calibrate it** with `retrieve:test` and
    `generations.style_reference_meta`; do not guess. The reference is passed WHOLE, not
    `slice(0, 1500)` — the spec asks how a piece concludes. `NEWS_STYLE_EXEMPLAR` is not used
    here (it is a fourth tier the hierarchy does not have). This function is the seam where the
    future approved-example tier slots in, matched on the SOURCE embedding. Free harness:
    `tsx src/generation/select-style-reference.ts`.
  - **What survives in BOTH modes and must not be removed:** `applyDesignations` (deterministic,
    zero calls, the only structural name guarantee), every officer-approved input
    (`selectedFacts`, `statements`, `excludedFacts`, `nameDesignations`), the note as sole
    factual authority, job status/step, cost metering, and every downstream feature.
  - **Feedback keeps the full machinery** (`revise-article.ts`), deliberately — it is the
    officer-in-the-loop path. Its one change: a `withFactCheck` parameter (default `true`) fed by
    `rowHasFactCheck(row)`, so a simple-mode article does not sprout a तथ्य-तपासणी fold — and buy
    an extra model pass — on its first feedback round.
  - Evaluation: `pnpm --filter @dgipr/content-engine article:compare -- --file=note.txt [news|scheme]
    [--effort=high]` runs BOTH pipelines on one note and prints wall-clock, chat calls, cost,
    length and — the number that matters — `findUnsupportedClaims` run as a **read-only judge**
    over each output. Simple mode drops the faithfulness *repair*, so that count is the evidence
    the removal is safe.
- Article gen / coverage / faithfulness / revisions (the `full` pipeline) →
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
- **Article → PDF export** (the finished article as an official A4 document): template →
  `packages/poster-renderer/src/article-pdf-template.ts` (letterhead + justified paragraphs
  + `A4_MARGIN`), orchestrator → `generate-article-pdf.ts`, Chromium → `renderHtmlToPdf` in
  `render-html.ts`; route → `GET /api/generations/:id/article.pdf?lang=mr|en|hi` in
  `apps/api/src/routes/generations.ts` (beside the `poster.png` proxy); web → the
  `articlePdfDownloadUrl` anchors in `ArticleView` and `/dlo`'s output step. Nothing is
  stored — the PDF is rendered on demand and streamed. Free harness: `pdf:preview`.
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

- Entry / create a generation (**Creative and Social**, formerly the media room — the
  sidebar's one English label: paste a finished article, upload a file, or
  **both** — the upload runs `DocumentIntake` in **live** mode, so the file's text is a
  SECOND source held beside the textarea (`docText`) and joined with it at submit
  (`combinedNote`), never pushed into it. That is what makes "either one or both" true with
  no extra click: the earlier append-on-button-press meant an upload nobody handed over was
  dropped and the submit answered `कृपया किमान २० अक्षरांची टिपणी लिहा`. A run consumes the
  document — `clearDocument()` drops the sessionStorage job id and remounts the card on BOTH
  submit paths, or navigating back would silently re-attach it to the next run.
  `काय तयार करायचे?` is a **two-level picker**: level 1 पोस्टर (default) / कॅप्शन, level 2
  लेख / ट्विटर / फेसबुक under पोस्टर and ट्विटर / फेसबुक under कॅप्शन. `category` is DERIVED
  from that pair — level-2 values ARE `Category` values, so there is no mapping table, and
  `'article'` is deliberately never a level-2 value (it would mean "the लेख poster" here and
  "no poster at all" in `outputType`). कॅप्शन sends `outputType: 'article'` and hides every
  poster question (विभाग, रचना-शैली, `ReferencePicker`, पोस्टरवरील मजकूर). The
  poster-**plus**-caption toggle survives under पोस्टर → ट्विटर/फेसबुक — dropping it would
  make that combination unreachable while `NextActions.CreateSocialBlock` still offered it.
  Busy gating: the पोस्टर level-1 card is never disabled (its children straddle both lanes),
  कॅप्शन is gated on `hasActiveSocialTask`, and the per-lane rule lives on the level-2 cards) →
  `apps/web/app/page.tsx`
- Generation detail (progress, article, poster, feedback) →
  `apps/web/app/generations/[id]/page.tsx`; history list →
  `apps/web/app/generations/page.tsx`
- Data layer → `apps/web/lib/api.ts`, `apps/web/lib/useGeneration.ts` (polling hook),
  `apps/web/lib/useGenerationThread.ts` (lineage rail; 5s poll only while a member runs)
- Usage analytics → `apps/web/app/analytics/page.tsx` + `analytics/[feature]/page.tsx` (see the
  analytics bullet above); sidebar entry `वापर विश्लेषण`, last in `NAV_LINKS`
- Marathi UI strings → `apps/web/lib/strings.ts`
- UI components → `apps/web/components/*` (`ArticleView`, `PosterPanel`,
  `ProgressSteps`, `FeedbackBox`, `CopyEditForm`, `HistoryCard`, `StatusChip`,
  `GenerationThread` — the runs-from-this-note rail above `NextActions`)
- DLO — **a list of work, not one workspace** (2026-07-27). `/dlo`
  (`apps/web/app/dlo/page.tsx`) is a conditional **सुरू असलेले काम** resume card
  (`DloResumeCard`) → the new-intake form (`DloIntakeForm`) → the shared list
  (`DloIntakeList`, split **तुमचे काम** / **इतर कामे**); each intake's workspace is
  `apps/web/app/dlo/[id]/page.tsx` → `DloWorkspace` (processing → per-source editable review →
  article). Modelled on `/video`. `PersistentAppContent.tsx` is **deleted** — the row is the
  state of record, which covers reload/crash/another machine as well as tab-switching, and
  unlike the singleton does not stop a second officer reaching the form. **The step is DERIVED
  from the row**, never stored. Review UI → `DloSourceReview` (one card per source, PDFs as a
  `/translate`-style page list) + `apps/web/lib/dloReview.ts` (source keys, assembly, per-file
  forgetting); polls → `useDloIntake` (one intake) and `useDloIntakeList` (the list, 5 s and
  only while one of THIS browser's runs is non-terminal).
  - **Resuming re-buys nothing** (0036). `dlo_intakes.review_state` holds the officer's
    corrections, unticked pages, style reference and the two PAID lookups (the pointer summary,
    one `gpt-5.6-sol` call per `POINTERS_REQUEST_CHUNK_CHARS` block; the prepared names).
    Autosaved on a 1200 ms debounce by `useDloReviewAutosave`, flushed and **awaited before
    generate** so the blob and the submitted `combinedText` cannot disagree. The guarantee that
    a resume does not re-fire the paid calls is `restoredFromSave`, a **ref** — both auto-fire
    effects run in the same commit as the seeding effect, where their `pointers === null`
    closure is still true, so a state-based guard would spend one render too late.
    Last-writer-wins, **warn-never-lock**: the PATCH returns the PREVIOUS writer (echoing our
    own could never detect anything). `category`/`heading` go to their real 0018 columns, not
    the blob, so they survive without 0036.
  - **`dgipr.dlo.mine` (localStorage, `lib/dloDraft.ts`) is ORDERING ONLY — never auth.** Every
    intake is visible and openable by anyone; the API never receives or filters on it. Same file
    holds the pre-submit sessionStorage draft and the module-scoped `pendingAudio` (a picked
    `File` cannot be serialized, so across a reload only its NAME survives, as a re-attach
    callout).
  - **`GET /api/dlo/intakes` must NEVER run the orphan reaper** — it would mass-fail every live
    intake the moment anyone opened `/dlo`. The detail route keeps it, and it is what makes the
    API a **single-process** service (two instances ⇒ B's poll kills A's job; the fix is a
    heartbeat + grace window across `dlo-runner.ts`/`runner.ts`/`video-runner.ts`, a named
    follow-up). `listGenerationsForDloIntakes` answers "already produced an article?" in one
    batched `.in()`; lineage stays one-way and an intake is never marked consumed.
  - Free harness: `tsx src/intake/dlo-review-state.ts` (in content-engine, which has tsx —
    the `proof-read.ts --check` split).

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
videos; new table, apply before the API deploy). `0028` —
`generations.poster_style` (jsonb: the colour palette + composition a social poster run was
assigned, and what its render measured; feeds the next run's avoid set). Additive + nullable, so
an older API is unaffected — and the runner writes it in a SEPARATE best-effort update after the
poster write, so an un-applied 0028 costs the rotation memory rather than a paid render.
`0029` — `generations.poster_heading` (text: the exact line an officer typed for an ARTICLE
poster; null = resolve it automatically). Additive + nullable, and `insertGeneration` omits the
column unless a heading was typed, so an un-applied 0029 disables only the override instead of
breaking every create — but apply it before the API deploy anyway.
`0032` — `glossary_terms.designation` (the Marathi पदनाम printed before a person's name; person
rows only, null = print it bare). `0033` — `generations.name_designations` (jsonb: the
`[{name, designation}]` pairs approved for one run). Both additive + nullable, and both written
omit-unless-present (`newTermToDbRow` / `insertGeneration`), so an un-applied migration disables
only the designation feature instead of failing every glossary add or every create — verified
live, the prepare route returns its names with `designation: ''` against a database with neither
applied. Apply before the API deploy anyway.
`0031` — `audio_transcript_cache` (new table: SHA-256 of an MP3's bytes → its Sarvam transcript,
so a re-uploaded recording is never re-transcribed on /dlo). Self-contained + additive; the
intake job treats a cache-read error as an empty cache, so an un-applied 0031 disables only the
optimization instead of breaking intake — apply it before the API deploy anyway.
`0035` — `generations.style_reference` (the article an officer pasted as the STYLE model for a
run; insert-only, because `startGenerationJob` re-reads everything from the row and a retry must
reproduce the same reference) + `generations.style_reference_meta` (jsonb: which tier actually
fired, at what similarity, under which prompt version — the calibration signal for the retrieval
floor AND the join key for the future approved-example loop; patchable, written after the article).
Both additive + nullable; `insertGeneration` omits `style_reference` unless one was pasted and the
meta write is a SEPARATE best-effort update after the article write, so an un-applied 0035 costs
the officer tier and the telemetry rather than a generated article (the 0028 principle). Apply
before the API deploy anyway.
`0041` — `generations.instructions` (text: the officer's free-text direction for ONE article —
emphasis, ordering, tone, what to keep short. An INSTRUCTION, never a factual source; the prompt
block says so and the note stays the sole authority). Insert-only for the same reason as
`style_reference`: `startGenerationJob` re-reads the row, so a retry must reproduce the same
article. Additive + nullable, and `insertGeneration` omits the column unless something was typed
— verified live, an un-applied 0041 fails only a run that carries instructions and leaves every
other create working. Typed on `/dlo`'s intake form (`AiInstructionsField`) and again at the
review step; the form's copy reaches the review step through the intake's `review_state` (0036)
blob, which the create route seeds as a separate best-effort update. Apply before the API deploy.
`0043` — `usage_events` (new table: which feature was used, what was done, when, plus size/count
integers — **never content**; there is no free-text column at all). It exists because /proofread,
ad-hoc /translate and export/download actions deliberately persist nothing, so without it three of
the analytics page's six cards would read as never used. Self-contained and additive; writes are
fire-and-forget and the aggregator treats a read failure as "not tracked", so an un-applied 0043
disables three cards rather than any feature — verified live, a poster download still returned 200
with the table absent. Apply before the API deploy anyway.
`0037` — `transcriptions` (new table: standalone recording → Marathi text runs behind
`/transcribe`). Self-contained and additive — nothing else reads it, and it provisions no
bucket (the recordings go into 0018's private `dlo-uploads` under a `transcriptions/` prefix),
so an un-applied 0037 disables only that page. Verified live: with the table absent the routes
are registered and every input guard still answers correctly; only the two queries 500.
`0036` — `dlo_intakes.review_state` (jsonb: the officer's review-step corrections, unticked pages,
style reference and the two PAID lookups — the pointer summary and the prepared names — so resuming
an intake re-buys nothing). Its own column rather than a write-back into `files`, because `files` is
rewritten wholesale by the extract/re-extract jobs and an autosave landing there would race them.
Additive + nullable; `insertDloIntake` never names the column, `updateDloIntake` writes it only when
the patch carries one, and the autosave is a SEPARATE route from create/extract/generate — so an
un-applied 0036 disables durable review state alone. **Verified live against a database without
it**: list, detail, create and generate all work and the PATCH is the only thing that fails. Apply
before the API deploy anyway.

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

Article-PDF preview (free — no API, no OpenAI; the loop for tuning
`src/article-pdf-template.ts`):
`pnpm --filter @dgipr/poster-renderer pdf:preview [article.txt] [--heading="…"]
[--lang=mr|en|hi] [--date=ISO] [--html] [--png]`. With no file it uses a built-in Marathi
sample loaded with the hard conjuncts, so it works on a fresh clone. `--html` writes the
raw document for a browser Ctrl+P (the fastest loop); `--png` rasterises page 1 on a box
with no PDF viewer, re-applying the same `A4_MARGIN` as padding so it cannot drift.

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
- **The article PDF is printed by Chromium, and that is not negotiable.** A browser-side PDF
  library (jsPDF, pdf-lib) places glyphs but runs no Indic shaper, so Marathi conjuncts come
  out decomposed and matras float off their consonants — the same failure the HTML poster
  path exists to avoid. `renderHtmlToPdf` (`render-html.ts`) therefore shares
  `launchChromium()` with the PNG renderer, and **the API image now ships Chromium**
  (`deploy/api.Dockerfile` — it deliberately did not before). A missing browser surfaces as
  `ChromiumUnavailableError` → a Marathi **503**, never a stack trace. Four more things to
  know: the route is **GET** so the web side is a plain `<a href>` (only the server can force
  a cross-origin download — the reason already documented on `poster.png`); the letterhead is
  an ordinary block in **normal flow**, which is what puts it on page 1 only — never
  `displayHeaderFooter`, whose separate render context does not inherit the `@font-face`; the
  guard is the **article text, not `row.status`** (the article is final long before the
  poster, so a `completed` check would break the main case); and `A4_MARGIN` is the single
  source shared by `page.pdf()`, the template's `@page` block and the harness's `--png`
  padding — keep it that way. **Expected, not a bug:** Chromium writes Marathi into the PDF's
  text layer in **visual order**, so `probePdf` may call an exported article `garbled` and
  copy-pasting Marathi out of it may reorder. The text is genuine vector text; nothing about
  print or appearance is affected, and there is no fix at the `page.pdf()` layer.
- **Article poster: GENERATED by the API, not edited from a master (default `fresh`).**
  `buildArticlePosterPrompt` (`content-engine/src/generation/build-article-poster-prompt.ts`)
  assembles the whole prompt and `generateImage(prompt, { size: '1536x1024' })` paints the
  **landscape** poster — one Marathi headline, no bullets/stats, deliberately simple and
  distinct from the Twitter posters. Block order is load-bearing and harness-asserted:
  `COLOUR SPECIFICATION` (the assigned hexes, **whenever a palette exists** — never the art
  director's paraphrase; that substitution is what made the social rotation inert) →
  `COLOUR_MANDATE` → `ART DIRECTION` → `COMPOSITION` (the assigned archetype, which OUTRANKS
  the master) → `RESERVED ZONES` → `STRUCTURE INSPIRATION` (the master's `layout_spec`
  summary run through `stripColourMentions`) → the headline (+ `TEXT LOCK` on a scheme run) →
  imagery. Article masters still need the `analyze:references` backfill: in fresh mode that
  spec supplies the structure hint and the real `hasPhotoZone`. This intentionally accepts
  image-model Devanagari for the single headline (verified acceptable), which is what the two
  redo buttons on `PosterPanel` exist for.
  The brand chrome is NOT painted by the model: the prompt declares the reserved zones
  (top-left ~420x180, bottom ~150px at 1536x1024, quiet background only) FIRST and repeats
  them as a final check, and forbids reflowing the headline upward into them — without that
  the model floated the headline under the stamped logo, which then clipped it.
  `overlayArticleChrome` (`packages/poster-renderer/src/article-chrome.ts`) stamps
  `assets/article-logo.png` (~342x122 at left 31 / top 13 — the official frame design's own
  22.3%-of-width proportion) + `assets/poster-footer.png` in code, on fresh renders and
  image-feedback re-renders alike. Zone numbers there, in `ARTICLE_RESERVED_ZONES` (web), and
  in `build-article-poster-prompt.ts` must stay in sync; tune for free with
  `poster:preview:chrome`. `ARTICLE_POSTER_MODE=n8n` restores the old master-edit behaviour
  (`buildArticlePosterPrompt` mode `onbrand` → the 5-node workflow); neither n8n mode produces
  a scene image, so poster feedback + manual copy-edit (which need `scenePath`) stay
  `html`-only.
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
  description.** A vision pass (`references/analyze-template.ts`, `VISION_MODEL`) runs once
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
  `retry-after` / `x-ratelimit-reset-*` headers. One article is 8-15 calls of ~5-8k
  tokens each — plus gpt-5.6 reasoning tokens, which count toward the same TPM budget — so
  on a 30k-TPM org concurrency > 1 reliably 429s; a `429 insufficient_quota`
  (billing, not rate) fails fast instead of backing off. Retry warnings in the log are the
  mechanism working, not a fault. `poster-renderer`'s image call and `sarvam-chat.ts` are not
  yet covered.
- **Every OpenAI text/vision call runs on gpt-5.6, in two env-configurable tiers**
  (`packages/content-engine/src/generation/openai-chat.ts`): `CHAT_MODEL`
  (`OPENAI_CHAT_MODEL`, default `gpt-5.6-terra`) is authoring + judgement and the default
  for any caller that doesn't name a model; `UTILITY_MODEL` (`OPENAI_UTILITY_MODEL`,
  `gpt-5.6-luna`) is mechanical work a deterministic step re-checks (rank-master's
  tie-break, page-instruction parsing, offline finetune prep); `VISION_MODEL`
  (`OPENAI_VISION_MODEL`, `gpt-5.6-terra`) is the image-input calls. `POSTER_COPY_MODEL`
  (`OPENAI_COPY_MODEL`) and `ANALYZE_MODEL` (`OPENAI_ANALYZE_MODEL`) stay as separate pins
  for the poster path and the must-be-vision-capable master analysis; `VIDEO_CHAT_MODEL`
  (`OPENAI_VIDEO_MODEL`, `gpt-5.6-sol`), **`ARTICLE_MODEL` (`OPENAI_ARTICLE_MODEL`,
  `gpt-5.6-sol`)** and `POINTERS_MODEL` (`OPENAI_POINTERS_MODEL`, `gpt-5.6-sol`) are pinned
  one step UP — the /video text calls, the simplified generator's single article call and
  /dlo's key-point summary are the judgement-heaviest Marathi work in the repo; in the
  article's case the brief, the coverage loop and the faithfulness repair were removed, so
  all of that judgement now happens inside that one call, and in the pointers' case one call
  must enumerate every distinct topic of a 60k-char multi-article document in order, with
  nothing downstream to correct it.
  `articleReasoningEffort()` (`OPENAI_ARTICLE_REASONING_EFFORT`, default `medium`) is its
  companion knob, and is not cosmetic: the specification's SILENT FINAL CHECK block is the
  only verification left on that path and it runs in the reasoning stage. Two consequences the
  whole codebase depends on: **`temperature` is rejected by gpt-5**, so the temperature-0
  determinism ~24 call sites passed is silently inert — the deterministic post-filters
  (proof-read's verbatim-excerpt/digit guards, `lock-scheme-names`, the translate name
  repair, the video `fact_index` grounding) are the real guard, and `reasoningEffort`
  (default `'medium'`) is the quality lever that replaced it; and **`max_completion_tokens`
  is shared between reasoning and the answer**, so `chatComplete` adds `REASONING_HEADROOM`
  on top of the caller's `maxTokens` — a caller's `maxTokens` still means "room for the
  answer", and an exhausted budget now reports `finish_reason: 'length'` in the error
  rather than a bare "no content". Image (`gpt-image-2`) and embeddings
  (`text-embedding-3-large`) are deliberately NOT on 5.6 — different model families, and
  changing the embedding model would invalidate every stored vector (0019's
  `halfvec(1024)`). Rollback is env-only: the pre-gpt-5 request body is preserved
  byte-for-byte, so `OPENAI_CHAT_MODEL=gpt-4o` restores the old behaviour exactly.
- **Env & secrets:** config comes from the root `.env` (see `.env.example`:
  Supabase + OpenAI, optional Sarvam). Never commit secrets.
- **Scraped output** under `packages/content-engine/data/` is gitignored — don't
  commit it or assume it's present.
