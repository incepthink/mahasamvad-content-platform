# Error analysis, round 1: reviewing what the platform already produced

This is the first step of error analysis as Hamel Husain's evals FAQ describes it: read about
100 diverse, complete traces, and for each one write down the **first thing that went wrong**.
Failure categories come later, from those notes. They are not decided up front.

The product does not log full traces yet. Round 1 therefore uses **reconstructed traces**. For
each sampled run, the exporter takes what the database already holds and lays it out in time
order:

- what the officer supplied
- what the platform produced
- every feedback round
- what happened next (downloaded, published, retried)

Each trace is tagged `metadata.reconstructed = true` so it is never mixed up with instrumented
traces later.

## Running the export

You need:

- the database tunnel running (`pnpm db:tunnel`, see `docs/database-on-aws.md`)
- `BRAINTRUST_API_KEY` in the root `.env`, for upload only

The export is read-only: no database writes and no model calls. The only cost is Braintrust
storage.

```bash
# 1. Look first: writes JSON under packages/content-engine/data/evals/ (gitignored)
pnpm --filter @dgipr/content-engine evals:export-existing -- --dry-run --per-feature=3

# 2. Same pick, sent to Braintrust (re-running replaces traces, never duplicates them)
pnpm --filter @dgipr/content-engine evals:export-existing -- --upload --per-feature=3

# 3. The real round
pnpm --filter @dgipr/content-engine evals:export-existing -- --upload --per-feature=20
```

Options:

| Option                      | Meaning                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `--features=creative,dlo,…` | Only these features. Default: all of them.                                        |
| `--latest`                  | Take each feature's most recent runs instead of a mix across history.             |
| `--seed=round1`             | Fixes the pick. The same seed always picks the same runs.                         |
| `--project=<name>`          | Braintrust project. Default `mahasamvad-error-analysis`, or `BRAINTRUST_PROJECT`. |
| `--max-attachment-mb=50`    | Files larger than this are named in the trace but not uploaded.                   |

To check the trace builders and the sampler for free, with no database, run
`pnpm --filter @dgipr/content-engine evals:check`.

## What each feature contributes

| Feature (`metadata.feature`) | Source                                              | Notes                                               |
| ---------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `creative`                   | `generations` with no /dlo intake, plus revisions   | All format lanes (`metadata.lane`)                  |
| `dlo`                        | `dlo_intakes`, its generations, and their revisions | Machine text beside the officer's correction        |
| `transcribe`                 | `transcriptions`                                    | Each recording as audio, beside its transcript      |
| `translate`                  | `generations.article_english` / `article_hindi`     | **Stand-in.** Ad-hoc /translate runs are not stored |
| `references`                 | `reference_images.layout_spec`                      | The template, and its vision analysis               |
| `storyboard`                 | `new_video_conversations`, mode `storyboard`        | Each turn's answer and the pictures it generated    |
| `new-video`                  | `new_video_conversations`, mode `video`             | Each turn's video, or the provider's error          |
| `chat`                       | `chat_threads` + `chat_messages`                    | Attachments by name; images shown                   |

Not covered until instrumentation (Track B):

- **/proofread**, which stores nothing
- the **ad-hoc half of /translate**

### How the 20 per feature are picked

**Round 1 was uploaded with `--latest`**: each feature's 20 most recent finished runs, newest
first, with no mixing. This reviews what the platform produces now.

Without `--latest`, the pick is a seeded mix:

- About 25% failed runs, where failures exist.
- Runs with feedback rounds and runs without.
- Every lane of the feature.
- Short and long inputs.
- Runs spread across the whole history, not just the latest week.

Unfinished rows, such as an empty draft intake, are skipped.

### Caveats a reviewer will see in a trace

- A revision row stores only the **result** of the round. The text before the first feedback
  round is therefore not stored, and the trace says _"Earlier draft not stored"_. Nothing is
  filled in.
- A first poster after feedback is taken from its conventional path (`poster-v1.png`). If that
  object is gone, the trace says so instead of showing a picture.
- IP addresses, device ids and user agents are never exported.

## Viewing the data

- **Before upload:** every trace is a JSON file at
  `packages/content-engine/data/evals/<feature>/<row id>.json`. Open one in the editor. `spans`
  are in time order, and `notes` lists anything that was not stored.
- **In Braintrust:** go to braintrust.dev → org → project `mahasamvad-error-analysis` → **Logs**.
  Each row is one trace. Click a row to open the tree on the left: the root, then the officer
  input, the sources, each version and feedback round, and what happened next. Posters, slides
  and audio show inline as attachments.
- **To look at one feature,** filter with `metadata.feature = "dlo"` (or `creative`,
  `transcribe`, …), then save the filter as a view.
- **To find a specific run,** search by row id. The trace id is `<feature>:<row id>`, the same
  id the run has in the app (`/generations/<id>`, `/dlo/<id>`, …).
- **To count from the command line:** the BTQL endpoint `POST https://api.braintrust.dev/btql`
  with `measures: count(1) as rows | from: project_logs('<project id>')`.

## Review setup in Braintrust (once, in the UI)

1. Create the org and the project `mahasamvad-error-analysis`. Put the API key in `.env`.
2. Under **Configuration → Human review**, add exactly two fields:
   - **first failure**: free text
   - **pass / fail**: a binary choice

   Add nothing else in round 1. Categories come after open coding, not before it.

3. In **Logs**, save one view per feature, filtered on `metadata.feature = "<feature>"`.
   Optionally split each view by `metadata.lane`.
4. Add the traces to a review queue. The reviewer is one DGIPR editor who reads Marathi.

## The review loop

1. **Pilot.** The editor reviews 10 traces. Adjust the trace layout before they do the rest.
2. **Open coding.** For each trace, write the first thing that went wrong, in the editor's own
   words, and mark pass/fail. Stop at the first failure; later failures are often caused by it.
   Keep going until new traces stop producing new _kinds_ of failure.
3. **Axial coding.** Group the notes into failure categories, name each category, and count
   them.
4. **Decide per category**:
   - **Fix in code or prompt**, when the cause is clear and the fix is cheap.
   - **Build an automated evaluator**, only for failures that will recur and need watching: a
     code check where the failure is mechanical, an LLM judge where it is not.
5. **Track B.** Instrument the request path so that round 2 reviews real traces. That covers
   /proofread and the ad-hoc /translate runs as well.

## Track B: live traces (round 2 onward)

Every new job on a generation row now records a complete trace in a separate Braintrust project.
That covers the creative lanes, the /dlo article, and every follow-up on those rows: feedback
rounds, redos, recolours, marker and exact-text edits, caption work and translations. Track A's
reconstructed traces stay in their own project.

**Turning it on (API process only):**

```
BRAINTRUST_API_KEY=…
BRAINTRUST_TRACING=on
BRAINTRUST_TRACE_PROJECT=mahasamvad-traces-prod   # mahasamvad-traces-dev on a dev box
```

Tracing starts only in the API's `main()`. Harnesses, offline scripts and the /learn sandbox
(which never calls the API) produce no traces, even when they load the same `.env`.

**What one trace holds:**

- **Root span:** the officer's input (pictures and /dlo source files attached as files), the
  final output (poster, slides, clip or article), and metadata. The metadata covers `feature`,
  `task`, `lane`, `category`, status, error, cost and latency. It also records the settings that
  change behaviour (`ARTICLE_POSTER_MODE`, provider, prompt version, reference chosen, poster
  style or design brief) and the warnings the officer was shown. Every live trace is marked
  `reconstructed: false`.
- **One `step: …` span per pipeline step**, matching the `step` values the progress list shows.
- **Every model call** with its full prompt, response, model, tokens, latency and cost: all
  OpenAI-wire traffic (`openAiFetch`, which includes Gemma and Qwen) and gpt-image
  generate/edit.
- **Decisions**: poster subject, reference selection (item count and reason), poster and
  carousel design director, poster copy, marker interpreter, edit-assistant plan, style
  reference, thumbnail people, pointers, learned-preference extraction.
- **Guards**, showing input and output: `applyDesignations`, `fitArticleToLength`,
  `ensureArticleHeading`, `ensureArticleDateline`, `enforceCapacity`, `validatePosterSubject`,
  `lockSchemeNames`, `normalizeCarouselPlan`, the poster numeral OCR check and the Hindi name
  repair.

**Linking.** A row's first job gets a root id derived from the row (`live:generation:<id>`), so
no mapping table is needed. Every later job on the row is its own trace. Its metadata carries
`originalTraceRootId`, and the original trace gets a `follow-up job: …` span pointing back.
Officer actions logged to /activity (downloads, publish, retries, edits) are attached to the
original trace as `officer: …` spans. They carry action and status only: never an IP, device id
or user agent.

**Views:** filter on `metadata.reconstructed = false` and `metadata.feature`. The review fields
are the same as round 1.

**Not traced yet** (open these next, as the rollout extends):

- Jobs outside the `generations` table: the /dlo intake job (OCR/STT), /transcribe, /chat,
  /video, /new-video-workflow, /proofread and ad-hoc /translate.
- The decisions those surfaces run (designation preparation, pointers) when called from their
  own routes: they are wrapped, but they are a no-op outside a job trace.
- Model calls that do not go through `openAiFetch` or gpt-image: Gemini, Sarvam, ElevenLabs,
  Kling and Veo. The exception is the poster numeral OCR, which is traced.

**Free check:** `npx tsx src/tracing/job-trace.check.ts` (from `packages/content-engine`). It
asserts that requests and results are byte-identical with tracing off and on, that a job still
completes with Braintrust unreachable, and that the tree has the right shape.

