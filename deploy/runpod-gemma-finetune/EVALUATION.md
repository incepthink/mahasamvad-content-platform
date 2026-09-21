# Phase 5 — does the adapter actually write better DGIPR articles?

Phase 3 trained `dgipr-dlo-v1`; Phase 4 wired `GEMMA_DLO_MODEL` so the `/dlo` lane can address
it. Neither answers the only question that matters: **is the article better, and did anything
else get worse?** This phase answers it with three arms on the held-out split, and refuses to
ship on a "looks nicer to me".

Harness: [`packages/content-engine/src/finetune/eval-dlo-distillation.ts`](../../packages/content-engine/src/finetune/eval-dlo-distillation.ts)
(`pnpm --filter @dgipr/content-engine finetune:eval`).

## The three arms

| Arm       | What answers                                         | Cost                                  |
| --------- | ---------------------------------------------------- | ------------------------------------- |
| `base`    | the endpoint's stock model — today's behaviour       | one generation per item (GPU seconds) |
| `tuned`   | `GEMMA_DLO_MODEL`, i.e. the adapter                  | one generation per item (GPU seconds) |
| `teacher` | the captured target: the ceiling it was distilled to | nothing — read off the pair file      |

The teacher is never regenerated. The captured article IS what `gpt-5.6-sol` wrote for that
exact prompt, and it is also the style judge's reference — so its own style score is 5 **by
construction** and is recorded that way rather than paying a call to be told so.

## Running it

```bash
# free: offline assertions, no network, no dataset needed
npx tsx src/finetune/eval-dlo-distillation.ts --check

# free: reads the dataset, lists what the endpoint serves, prices the run, generates nothing
pnpm --filter @dgipr/content-engine finetune:eval

# before the adapter exists — banks the baseline the adapter will have to beat
pnpm --filter @dgipr/content-engine finetune:eval -- --run --arms=base,teacher

# the real three-arm measurement, once vLLM serves the adapter
pnpm --filter @dgipr/content-engine finetune:eval -- --run
```

On a dev machine behind Kaspersky, prefix with `NODE_OPTIONS=--use-system-ca` or every OpenAI
call dies as `TypeError: fetch failed` after five retries.

Useful flags: `--limit=N`, `--only=<id>`, `--path=text|image`, `--refresh` (pay again rather
than reuse the bank), `--out=<file>`, `--data=<dir>`.

**Spend is opt-in.** Without `--run` nothing is generated and nothing is graded — the capture's
discipline, one phase down. Generations and the two paid grades are banked under
`data/finetune/distill/eval-runs/`, so a crash, a rate limit or a re-read of the gates never
re-bills. The deterministic numeral metric is deliberately **not** banked: it is free, so
recomputing it every run is what stops a change to the rule leaving a stale number in a report
that otherwise looks current.

## Two refusals worth knowing about

**`GEMMA_DLO_MODEL` unset + `--arms` including `tuned` is refused outright.** Unset, that
variable falls back to the base (Phase 4's rollback), so the "tuned" arm would be a second base
run — and the report would show a perfect tie that reads as _the adapter changed nothing_.

**`--run` refuses an arm whose model the endpoint does not serve**, checked against
`/v1/models` before a single token is generated. Runpod's proxy answers an unloaded model with
a generic `500`, not vLLM's `404` (Phase 4's measured finding), and `500` is retryable — so
without this preflight a mistyped adapter name fails slowly and opaquely on every item.

## The three gates

All three are **relative to the base**, and the third one is relative by measurement rather
than by generosity.

| #   | Gate                                                         | Passes when                 |
| --- | ------------------------------------------------------------ | --------------------------- |
| 1   | Marathi style judge, 1-5 against the teacher's article       | `mean(tuned) >= mean(base)` |
| 2   | `findUnsupportedClaims` against the source information alone | `mean(tuned) <= mean(base)` |
| 3   | numerals the article states that the source does not contain | `rate(tuned) <= rate(base)` |

Gate 1 also prints the gap to the teacher and a per-item win/tie/loss count, because a mean of
integers over nine items is a direction and not a measurement; a tie passes the literal gate and
is reported as `tied`, never as an improvement.

Gate 2 is given the **`### SOURCE INFORMATION` section alone**, parsed back out of the captured
prompt — not the whole user turn. Handing it the turn would let the officer's own OFFICER
REQUEST count as factual support, which is exactly the hallucination the gate exists to catch.
The officer-approved designations are parsed back out too and passed as the allow-block, or
every approved पदनाम is counted as unsupported by construction.

**Gate 3 is precision, not recall**, and that direction is the design. Requiring every source
figure to reappear would penalise editorial selection, which this product treats as a feature
("completeness is tiered, not total"). The failure class the plan names is the other one:
`५०० कोटी` coming back as `४०० कोटी` — a number the article asserts and the source does not
have. It sits beside gate 2 rather than inside it because gate 2 is an LLM comparing two
Devanagari numerals, which is precisely the comparison a language model is worst at. Both
scripts are normalised to one, digit-group commas are removed on both sides, and enumeration
markers at the head of a line are stripped from the article (a numbered list is a style defect,
which gate 1 already scores; counting its markers as fabricated figures would be noise).

**Why gate 3 is not "zero".** Measured on the nine held-out targets, the **teacher itself**
states six numerals its own sources do not contain — 18.2 % of the ones it writes: a year it
supplied, a percentage it refined, a time it stated as `11.30`. An absolute bar the ceiling does
not clear says nothing about the adapter. What a bad adapter does is make the rate _worse than
the base's_, and that is what is gated. The teacher's own rate is printed beside the two arms as
the reference.

## The baseline, measured 2026-09-20

Nine held-out items, `--path=text`, `--arms=base,teacher`, $0.32 of OpenAI. Banked, so the
adapter is compared against these exact numbers rather than against a re-run.

| Arm       | Style (1-5) | Unsupported claims | Ungrounded numerals |
| --------- | ----------- | ------------------ | ------------------- |
| `base`    | **1.67**    | **10.78**          | **13/41 (31.7 %)**  |
| `teacher` | 5.00 *      | 3.67               | 6/33 (18.2 %)       |

\* by construction — the teacher's article is the judge's reference.

**Read the base articles before reading the scores.** All nine open in English:

```
To write in the style of the **DGIPR (Directorate General of Information …
Here is the article written in the official style of the **Directorate G…
Since you requested a **DGIPR (Directorate General of Information and Pu…
```

That is what 1.67/5 means concretely, and it reframes what the adapter has to do: the first
problem is not Marathi register, it is **output discipline** — the base model narrates the task
instead of emitting the article, sometimes appending a numbered English list explaining its own
choices. It also inflates the claim count, because those sentences genuinely assert things the
note does not contain.

So the bar is low and the headroom is large. If the tuned arm does not clear a 1.67 style mean,
something is wrong with the training run rather than with the ambition.

## When a gate fails

The run prints the diagnosis itself; this is the same ladder, for reference.

| Symptom                                          | Diagnosis and next move                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Style passes, numerals regress on `--path=image` | Adapter bleed into image-conditioned decoding. Lower the LoRA rank or the LR **before** reaching for multimodal training                                                       |
| Style passes, numerals regress on `--path=text`  | Not bleed — the vision tower is not involved at all. The adapter itself is writing numbers the source lacks. Lower the LR, and confirm the targets are raw teacher output      |
| Style fails on `--path=image`                    | Run `--path=text` as a control. Passing there means the style distilled and this is the train/serve mismatch the text-only decision risked — multimodal LoRA is the escalation |
| Style fails on `--path=text`                     | The distillation did not take. Check, in order: the loss mask (Phase 3 prints the decoded labels — only the article may be unmasked), template agreement, then the step count  |
| Faithfulness regresses                           | The adapter asserts more than the source supports — what repeated passes over a small set buy. Top up the capture before adding epochs                                         |
| All three pass                                   | Run the rollback A/B once deliberately (SERVING.md) before switching the lane on: same prompt, same endpoint, `GEMMA_DLO_MODEL` set and unset                                  |

## The image path, and why it currently cannot run

The plan holds out rows that "still have their source files" so the adapter can be measured on
the real image-conditioned path — the measurement the text-only training decision rests on.

**No held-out row can run it today, and that is a dataset fact rather than a harness problem.**
Phase 2 stratified on `intakeFileCount > 0`, which is true of any intake that carried _a file_ —
and across all 58 captured examples the file kinds are `audio` (6) and `youtube` (3) and nothing
else. Both are **transcribed at intake**, so by the time the article is written their content is
already characters in `### SOURCE INFORMATION`. There is nothing to show a vision model.

`--path=image` therefore reports every row as skipped, with the kinds it found, and refuses to
run. It refuses in three cases, all of which would otherwise produce a number that is not what
it claims to be:

- no `pdf`/`image`/`docx`/`txt` file on the intake — an unknown kind is **never coerced**;
  handing an `.m4a` to the PDF rasteriser fails into a warning `prepareGemmaSources` swallows,
  and the row then runs the text path while the report calls it the image path;
- the bytes cannot be read from the private bucket;
- the document's `=== स्रोत: NAME ===` block is not in the source, so its text cannot be taken
  out — attaching the file as pixels would feed the same source twice and flatter the result.

To unblock it, capture rows whose intakes carry real documents and rebuild. The split is a hash
of the group key, so a top-up only ever **adds** examples and moves none:

```bash
pnpm --filter @dgipr/content-engine finetune:capture -- --run --limit=N
pnpm --filter @dgipr/content-engine finetune:dataset -- --eval-fraction-files 0.4
```

The pool has them: 197 intakes carry a `pdf` and 37 an `image`. They simply were not among the
60 newest text-lane groups the first capture batch took.

## Cost and time

Per held-out item: one generation per gemma arm (~~25-50 s on a warm worker, billed as GPU
seconds — the gemma lane is in `UNBILLED_TEXT_PROVIDERS`, so no per-token figure is invented),
plus one style-judge call and one `findUnsupportedClaims` call per generated article on
`gpt-5.6-terra`. Measured: **~~$0.032 of OpenAI per arm-item**, so a nine-item two-arm baseline
is about **$0.30** and a full three-arm run about **$0.60**. Everything banks, so a re-read of
the gates after a rule change is free.

## Artifacts

| Path                                           | What                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `data/finetune/distill/eval-report-text.json`  | verdict, gates, diagnosis, and every arm's article per item         |
| `data/finetune/distill/eval-report-image.json` | the same for `--path=image`, once a held-out row can run it         |
| `data/finetune/distill/eval-runs/generations/` | banked model output, keyed `<path>-<arm>-<id>`                      |
| `data/finetune/distill/eval-runs/grades/`      | banked style score and unsupported claims (numerals are recomputed) |

All of it is under the gitignored data directory.
