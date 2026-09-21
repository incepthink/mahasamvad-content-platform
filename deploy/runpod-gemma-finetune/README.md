# Distilling the DGIPR article teacher into Gemma — training

Phase 3 of the distillation plan. Phase 1 captured teacher pairs, Phase 2 assembled them; this
turns them into a **text-only LoRA adapter** for `google/gemma-4-31B-it` that Phase 4 serves
beside the base on the existing Runpod endpoint.

What it produces is an adapter directory — roughly 200-400 MB of `adapter_model.safetensors`
plus `adapter_config.json` — never a merged 62.5 GB checkpoint. That is what makes the A/B in
Phase 5 free: one endpoint, both models, chosen by the request's `model` field.

## Hardware and cost

|           |                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| GPU       | One A100 80GB or H100 80GB, **on-demand pod**                                                                    |
| Why a pod | Training is a persistent process with persistent optimiser state. A serverless worker is killed between requests |
| Storage   | A network volume for the dataset, the HF cache (~63 GB of weights) and the output adapter                        |
| Time      | Well under an hour on the current 49-example set; 1-2 hours if the pool is topped up                             |
| Cost      | Under $5                                                                                                         |

## Before renting anything

Both of these are free and neither needs a GPU.

```bash
# 67 offline assertions: the turn-marker derivation against the ids Phase 0.4 measured off the
# live endpoint, the label mask, the vision-tower exclusion, the overflow policy, the schedule.
python train.py --self-test

# Tokenizer + dataset + template agreement + loss-mask dump, then stop. Needs HF access for
# the tokenizer, nothing else. Run this against the real dataset before you rent a GPU.
python train.py --prepare-only --data-dir packages/content-engine/data/finetune/distill
```

`--prepare-only` is the one that catches the expensive mistakes: a template that no longer
matches the server, a `max_seq_length` that drops half the set, a schedule with three
optimiser steps in it.

`check_chat_template.py` in this directory is Phase 0.4's other half, and it is worth running
once on the training box alongside the above:

```bash
python check_chat_template.py --artifact /workspace/distill/chat-template-probe.json
```

It answers the `{% generation %}` question — whether TRL's `assistant_only_loss` is even
available on this tokenizer. `train.py` does not depend on the answer (it masks by hand for
the reason in the next section), so treat it as a cross-check rather than a gate.

## Getting the dataset onto the pod

`packages/content-engine/data/` is gitignored, so the dataset is not in the repo and never
should be — it is officer material. Build it locally and copy the directory up:

```bash
pnpm --filter @dgipr/content-engine finetune:dataset
# then, from the repo root:
scp -r -P <pod-ssh-port> packages/content-engine/data/finetune/distill \
    root@<pod-host>:/workspace/distill
```

The training script reads `train.jsonl`, `eval.jsonl`, `dataset-report.json` and (optionally,
for readable reporting) `split-manifest.json` from that one directory.

## Running it

```bash
# 1. The plan's 20-example smoke run: proves the whole path end to end and produces a loadable
#    adapter. Minutes, pennies.
python train.py --data-dir /workspace/distill --smoke 20 \
                --output-dir /workspace/adapters/smoke

# 2. The real run.
python train.py --data-dir /workspace/distill \
                --output-dir /workspace/adapters/dgipr-dlo-v1
```

Both print a `training-manifest.json` next to the adapter recording the dataset hashes, the
resolved template, the target-module count, the schedule and the final metrics — so a later
"which data produced this adapter?" has an answer.

## What the run prints, and what to actually look at

**The loss mask.** Printed before training starts, for one example, and not skippable. This is
the check the plan asks for, and training on the prompt as well as the answer is the most
common silent SFT failure — the loss curve looks completely normal while it happens.

```
LOSS MASK — example d444c678-…
  sequence 1393 tokens: 612 masked prompt + 781 scored answer
  last 60 MASKED tokens (must end in the assistant-turn prefix):
    '…<|turn>model\n<|channel>thought\n<channel|>'
  first SCORED tokens (must be the article, nothing before it):
    '# शीर्षक…'
  last SCORED tokens (must end in the turn-end token):
    '…<turn|>'
```

If the masked tail does not end in the serving prefix, or the scored head contains any part of
the source, stop. Nothing downstream will tell you.

**The schedule, and expect a warning here today.** The current set is 49 train / 9 eval, and at
`max_seq_length 8192` **two training examples are dropped as over-long** — both happen to be in
the train split, so eval keeps all 9. That leaves 47 examples: 6 steps an epoch at accumulation
8, **18 optimiser steps** over 3 epochs, which trips

```
WARNING: only 18 optimiser steps — too few for a stable style shift.
```

That warning is accurate, not noise. Two ways out, in order of value:

1. **Top up the capture.** 233 text-lane groups remain uncaptured. `finetune:capture --run`
   continues from the newest uncaptured row, never re-bills a captured one, and the Phase 2
   split is stable under additions — rebuilding after a top-up only ever _adds_ training
   examples and moves none. At ~$0.04 an article this is cheap.
2. **`--grad-accum 4`**, which gives 36 steps and no warning, at the cost of a noisier gradient.

Do not simply raise `--epochs` on 47 examples: more passes over the same small set buys
memorisation, not style.

**The target modules.** `N target modules under model.language_model`. If that line names no
language root, or the excluded count is zero on a multimodal checkpoint, the vision filter did
not engage — read the next section.

## Configuration as built

| Setting          | Value                                          | Why                                                                                    |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Quantisation     | 4-bit NF4, double-quant, bf16 compute          | 62.5 GB → ~18-19 GB, leaving the rest for adapters, activations and context            |
| LoRA             | r=32, alpha=64, dropout 0.05                   | Enough for a style shift, small enough to serve                                        |
| Targets          | The seven projections, **language model only** | See below                                                                              |
| Loss             | Assistant tokens only, hand-masked             | See below                                                                              |
| `max_seq_length` | From `dataset-report.json` (**8192** today)    | Measured with the real tokenizer in Phase 2; guessing it truncates the scheme articles |

One reconciliation note, so nobody chases it: a sequence here is **3 tokens longer** than the
length Phase 2 recorded for the same example. Phase 2 measured a completed conversation
(`…<|turn>model\n` + article + `<turn|>\n`); this trains on the serving prefix and trims past
the stop token (`…<|turn>model\n<|channel>thought\n<channel|>` + article + `<turn|>`). The
difference is +7−3+1−2. It matters to nothing at these margins, but the two numbers will not
be identical.

| Overflow | **Drop**, not truncate | See below |
| Packing | Off | One article per sequence; packing blends unrelated documents |
| Epochs / LR | 3 / 1e-4 cosine, 10% warmup | |
| Batch | 1 × accum 8, gradient checkpointing on | |
| Optimiser | `paged_adamw_8bit` | |
| Output | Adapter only, no merge | |

### Three deviations from the plan, each for a measured reason

**1. The loss mask is built by hand, not by TRL.** The plan offered `assistant_only_loss=True`
or `DataCollatorForCompletionOnlyLM` with response template `<start_of_turn>model\n`. Phase 0.4
measured the live endpoint and both turn out to be wrong for this template:

```
a completed conversation renders   … <|turn>model\n{article}<turn|>\n
what vLLM actually sends           … <|turn>model\n<|channel>thought\n<channel|>
```

`assistant_only_loss` trains on the first, and production serves the second — seven tokens the
model was never trained to continue from. And `<start_of_turn>model\n` is the **Gemma 2/3**
marker; this template's surface strings changed (the ids 105/106 did not), so the collator
would match nothing and silently train on the prompt as well as the answer.

So the prompt half is `apply_chat_template(…, add_generation_prompt=True)` — byte-identical to
what the server builds — and the labels cover the article and its turn-end token, nothing else.
`--turn-mode completed` is the rollback if a future endpoint stops opening the channel.

Every marker is derived from the tokenizer at run time and then **checked against what Phase
0.4 recorded from the server**. A disagreement stops the run. It is exactly the train/serve
divergence that probe exists to catch, it is invisible everywhere downstream, and
`--allow-template-mismatch` is the deliberate override.

**2. The vision tower is excluded by module path, not by suffix.** SigLIP uses the same
`q_proj`/`k_proj`/`v_proj`/`o_proj` names as the language model, so the suffix list almost every
QLoRA example passes would adapt the image encoder too — which is what would change image
reading from today's behaviour, and what would stop vLLM loading the adapter beside the base.
`resolve_target_modules` enumerates the live module tree and applies two independent filters: a
marker list (`vision_tower`, `multi_modal_projector`, `siglip`, …) and, when the checkpoint has
a `language_model` subtree, required membership of it. Either alone is unsafe; a leak past both
raises rather than trains.

**3. An over-long example is dropped, not truncated.** Cutting from the right removes the end of
the article _and_ its turn-end token, which teaches the model to stop mid-sentence without
stopping — a worse signal than no example at all. At 8192 tokens the Phase 2 report says this
costs 2 of 58. `--on-overflow truncate` is available and cuts the **middle of the source**,
never the article; the run refuses outright if more than 20% of the set would be dropped
(`--max-drop-fraction`, `--force`).

## Handing off to Phase 4

**[SERVING.md](SERVING.md)** in this directory is the runbook: the vLLM flags, the free
preflight that proves the endpoint serves both models, the one env line that switches the
lane, the rollback, and the merge contingency if this build rejects LoRA on Gemma 4.

In short:

```
--enable-lora --max-lora-rank 32 \
--lora-modules dgipr-dlo-v1=/runpod-volume/adapters/dgipr-dlo-v1
```

then `GEMMA_DLO_MODEL=dgipr-dlo-v1`. The `--max-lora-rank` must be at least `--lora-r`; if you
change one, change both. Name the adapter for its version and never overwrite it — a retrain
publishes `-v2` beside it, or the A/B this whole design exists to make free stops being
repeatable.

## Troubleshooting

| Symptom                                             | Cause and fix                                                                                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `does not recognize this architecture`              | `transformers` is too old for gemma-4. Bump the pin in `requirements.txt` first — it is the likeliest cause and the cheapest fix                                                              |
| `Could not load the base model with any auto class` | All three rungs of the loader failed; the printed per-class errors say why. Usually the same version problem                                                                                  |
| Local chat template disagrees with the server probe | Re-run Phase 0.4's probe against the endpoint you will actually serve from. Do not reach for `--allow-template-mismatch` until you know what changed                                          |
| `No language-model projections matched`             | The checkpoint's module names differ from every name the script knows. Print `model.named_modules()` and widen `LM_PROJECTION_SUFFIXES` — never drop the non-language filter to make it match |
| `Vision modules leaked into the target list`        | A vision path got past both filters. Add its marker to `NON_LANGUAGE_MARKERS`                                                                                                                 |
| `WARNING: no stop token found in the turn end`      | The adapter would never learn to stop and every request would run to `max_tokens`. Do not train through this                                                                                  |
| `N% of the training set does not fit`               | Raise `--max-seq-length` (the report's bucket table shows what each window keeps) or switch to `--on-overflow truncate`                                                                       |
| OOM at the first step                               | Raise `--grad-accum` and leave `--batch-size 1`; if it persists, lower `--max-seq-length` and accept the drops                                                                                |
| `paged_adamw_8bit` unavailable                      | bitsandbytes did not find CUDA. It is Linux + CUDA only — this does not run on the dev box                                                                                                    |

## Building the image

Optional: RunPod's own PyTorch pod template plus `pip install -r requirements.txt` works just
as well, and is faster to get going.

```bash
docker build --platform=linux/amd64 -t USER/dgipr-gemma-finetune:v1.0.0 .
docker push USER/dgipr-gemma-finetune:v1.0.0
```

The build runs `--self-test`, so an image that cannot pass it fails before it is ever rented.
