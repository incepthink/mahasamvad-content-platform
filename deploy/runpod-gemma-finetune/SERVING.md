# Serving the DGIPR adapter beside the base

Phase 4 of the distillation plan. Phase 3 produced a LoRA adapter directory; this puts it on
the **existing** gemma endpoint next to the stock base and switches the `/dlo` article lane
onto it with one environment line.

Nothing here is a second deployment. vLLM loads the adapter alongside the base and routes on
the request's `model` field, so both are reachable at the same URL — which is also what makes
the Phase 5 A/B free: two arms, one endpoint, no redeploy between them.

---

## 1. Put the adapter on the network volume

The endpoint's workers mount the volume at `/runpod-volume`. The adapter is a few hundred MB,
not the 62.5 GB base.

```bash
# on the training pod, where the volume is usually mounted at /workspace
mkdir -p /workspace/adapters
# (train.py already wrote it there if you passed --output-dir /workspace/adapters/dgipr-dlo-v1)
ls /workspace/adapters/dgipr-dlo-v1
#   adapter_config.json  adapter_model.safetensors  training-manifest.json  …
```

The name `dgipr-dlo-v1` is a **version**, not a label. Never overwrite it with a retrain —
publish `dgipr-dlo-v2` beside it. Two reasons: a request in flight during a swap would get
half of each, and an adapter you cannot go back to is an A/B you cannot repeat.

## 2. Add the vLLM flags to the endpoint

On the serverless endpoint's template, append to the start arguments:

```
--enable-lora --max-lora-rank 32 --lora-modules dgipr-dlo-v1=/runpod-volume/adapters/dgipr-dlo-v1
```

| Flag                           | Why this value                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--enable-lora`                | Off by default. Without it the `--lora-modules` entry is ignored and the endpoint still serves only the base — which looks exactly like the switch not working |
| `--max-lora-rank 32`           | Must be **≥ `--lora-r` from training**, which is 32. Below it vLLM refuses to load the adapter at start-up. If you change one, change both                     |
| `--lora-modules <name>=<path>` | `<name>` is what `GEMMA_DLO_MODEL` must equal, character for character. `<path>` is the directory, not the `.safetensors` file                                 |

Everything else — `MAX_MODEL_LEN=32768`, `GPU_MEMORY_UTILIZATION=0.95`, the worker count —
is unchanged. The adapter's memory cost is negligible next to 62.5 GB of base weights, so
none of the context-window arithmetic in `gemma-sources.ts` moves.

## 3. Verify the endpoint serves both — before touching `.env`

One GET, no spend, no weights woken:

```bash
pnpm --filter @dgipr/content-engine exec tsx \
  --env-file=../../.env src/generation/gemma-sources.ts --models
```

```
https://api.runpod.ai/v2/<id>/openai/v1/models serves 2 model(s):
  - google/gemma-4-31B-it
  - dgipr-dlo-v1

ok   base (GEMMA_MODEL): "google/gemma-4-31B-it"

ok   /dlo adapter (GEMMA_DLO_MODEL): "dgipr-dlo-v1"
```

**Do this check.** Measured against the live endpoint on 2026-09-20: Runpod's serverless
OpenAI proxy answers a request naming an unloaded model with a bare
`500 {"detail":"internal server error"}` — _not_ vLLM's own 404 naming the model. A 500 is
retryable, so a mistyped `GEMMA_DLO_MODEL` makes every `/dlo` article burn its retry ladder
and then fail behind a canned Marathi sentence, with nothing on screen naming the cause. The
API does diagnose it after the fact (it asks `/v1/models` on failure and rewrites the error to
name the variable), but that arrives minutes late, after an officer has already lost a run.

## 4. Switch the lane

```bash
GEMMA_DLO_MODEL=dgipr-dlo-v1
```

Restart the API. That is the whole code-side change.

**What it covers:** `/dlo`'s article call on _both_ of its paths — a notes-only intake, which
reaches gemma through `writeArticleDraft`, and one carrying uploaded documents, which reaches
it through `generateArticleFromSources`. The majority of `/dlo` runs, and the majority of what
the adapter was distilled from, are the first kind.

**What it deliberately does not cover:** everything else on the endpoint, most importantly the
name scan that reads people off the officer's pages (`extract-name-context.ts`). That is a
READING task whose entire contract is to copy sentences out verbatim and add nothing; the
adapter is tuned to WRITE. It stays on the base, by omission rather than by a flag, so it
cannot acquire the adapter by accident.

## 5. Confirm it took effect

The job log names the model that actually answered:

```
[source-article] news | provider=gemma model=dgipr-dlo-v1 effort=… | …
[simple-article] news | provider=gemma model=dgipr-dlo-v1 effort=… | …
```

With `GEMMA_DLO_MODEL` unset both lines read `model=google/gemma-4-31B-it`. That line is the
only place the switch is visible, which is why it now reports the resolved model rather than
the constant it used to print.

Usage rows are likewise recorded under the model that answered, so the adapter's traffic is
distinguishable from the base's in `/analytics` — the reason to serve them together at all.

## Rollback

Delete `GEMMA_DLO_MODEL` and restart the API. Nothing else changes: the adapter stays loaded
and costs nothing, the lane returns to the base, and the log line says so. This is the test
worth running once deliberately, not just reasoning about — it is the same lane, the same
prompt and the same endpoint, so a difference in the article is the adapter and nothing else.

## Contingency: the build rejects LoRA on Gemma 4 multimodal

If vLLM refuses to load the adapter at start-up — typically a rank, a target-module or an
architecture complaint in the worker log — merge it into the 16-bit base and publish that as
its own model id:

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM

base = AutoModelForCausalLM.from_pretrained('google/gemma-4-31B-it', torch_dtype='bfloat16')
merged = PeftModel.from_pretrained(base, '/workspace/adapters/dgipr-dlo-v1').merge_and_unload()
merged.save_pretrained('/runpod-volume/models/dgipr-dlo-v1-merged')
```

`GEMMA_DLO_MODEL` then names that id instead and **no code changes** — the lane asks for a
model by name and does not care how it was produced. What is lost is real, though: a 62.5 GB
deploy, a second set of weights to keep, and the free A/B, since base and tuned are no longer
one endpoint. Exhaust the cheap causes first (`--max-lora-rank` below `--lora-r`, a missing
`--enable-lora`, a path pointing at the file rather than the directory).

## Troubleshooting

| Symptom                                       | Cause and fix                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--models` lists only the base                | `--enable-lora` missing, or the endpoint template was edited without redeploying the workers                                                                                                                                                         |
| Every `/dlo` article fails after a long wait  | `GEMMA_DLO_MODEL` does not match the `--lora-modules` name. Run `--models`; the API's own error, once it arrives, names the variable                                                                                                                 |
| Worker fails to start after adding the flags  | Usually `--max-lora-rank` below the adapter's rank. It must be ≥ 32                                                                                                                                                                                  |
| Articles succeed but read exactly like before | Check the log line names the adapter. If it names the base, the API did not pick up the env change — restart it                                                                                                                                      |
| Non-`/dlo` articles changed too               | They should not have. The lane is threaded from the generator's `promptMode`; if an ordinary article reports the adapter, that thread is broken                                                                                                      |
| Image reading got worse                       | The adapter is text-only and the vision tower was excluded by module path at training time (Phase 3, deviation 2). If this is real, it is the escalation the plan's Phase 5 names — lower the rank or the LR before reaching for multimodal training |
