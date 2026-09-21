"""QLoRA distillation of the DGIPR article teacher into google/gemma-4-31B-it.

Phase 3 of the distillation plan. Phase 1 captured teacher pairs, Phase 2 assembled them into
`train.jsonl` / `eval.jsonl` plus a `dataset-report.json`; this trains a text-only LoRA adapter
on them and writes the adapter alone — never a merged 62.5 GB checkpoint.

Run it on an on-demand A100/H100 80GB pod, not on serverless: training is a persistent process.

THE ONE THING THIS FILE EXISTS TO GET RIGHT: the tokens the model is trained to continue from
are the tokens vLLM will actually hand it at serving. Phase 0.4 measured the live endpoint and
found the two do NOT agree by default:

    completed conversation   ... <|turn>model\\n{article}<turn|>\\n
    what vLLM sends          ... <|turn>model\\n<|channel>thought\\n<channel|>

`add_generation_prompt=True` opens a `thought` channel that a completed conversation never
contains. So the obvious recipes are both wrong here:

  * TRL's `assistant_only_loss=True` renders the COMPLETED conversation. The model would be
    trained to write the article after `<|turn>model\\n` and then, in production, be asked to
    continue from seven tokens it had never seen in that position.
  * `DataCollatorForCompletionOnlyLM` with response template `<start_of_turn>model\\n` is the
    Gemma 2/3 marker. This template's is `<|turn>model\\n` — the surface strings changed even
    though the ids (105/106) did not — so the collator would find nothing and silently train on
    the whole sequence, prompt included.

Neither failure shows up in the loss curve. So the prompt/completion split is built here by
hand: the prompt half is `apply_chat_template(..., add_generation_prompt=True)`, byte-identical
to what the server builds, and the label mask covers the article and its turn-end token and
nothing else. `--turn-mode completed` is the rollback to the other rendering if a future
endpoint stops opening the channel.

Every marker is DERIVED from the tokenizer at run time (`derive_turn_ids`) and then checked
against what Phase 0.4 recorded from the server. A disagreement is refused, not warned about:
it is the train/serve divergence this whole exercise was built to detect, and it is invisible
downstream.

THE VISION TOWER IS NOT TRAINED. `resolve_target_modules` enumerates the live module tree and
keeps the seven projection names only where they sit under the language model. SigLIP uses the
same `q_proj`/`k_proj`/`v_proj`/`o_proj` names, so a plain suffix list — which is what almost
every QLoRA example passes — would adapt the image encoder too. That is what would change image
reading from today's behaviour, and what would stop vLLM loading the adapter beside the base.

OVERFLOW IS A DROP, NOT A TRUNCATION. Cutting an over-long example from the right removes the
end of the article AND its turn-end token, which teaches the model to stop mid-sentence without
stopping. Losing two examples is cheaper than corrupting two. `--on-overflow truncate` keeps the
whole article and cuts the MIDDLE of the source instead, for the case where dropping is worse.

FREE, NO GPU, NO NETWORK:   python train.py --self-test
TOKENIZER ONLY, NO GPU:     python train.py --prepare-only --data-dir <dir>

Heavy imports (torch, transformers, peft) are deliberately inside the functions that need them,
which is what lets the self-test run on a laptop.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

DEFAULT_BASE_MODEL = "google/gemma-4-31B-it"
DEFAULT_ADAPTER_NAME = "dgipr-dlo-v1"

# The seven projections a text LoRA adapts. Names only — where they are allowed to live is
# decided by resolve_target_modules, not by this tuple.
LM_PROJECTION_SUFFIXES = (
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
)

# Any module whose path contains one of these is not the language model, whatever it is called.
# Over-inclusive on purpose: a false exclusion costs a little capacity, a false inclusion
# retrains the image encoder.
NON_LANGUAGE_MARKERS = (
    "vision_tower",
    "vision_model",
    "vision_encoder",
    "visual",
    "multi_modal_projector",
    "mm_projector",
    "image_encoder",
    "image_tower",
    "audio_tower",
    "audio_encoder",
    "siglip",
    "patch_embed",
)

SENTINEL_USER = "ZZUSERZZ"
SENTINEL_ASSISTANT = "ZZASSISTANTZZ"


# --------------------------------------------------------------------------------------------
# Pure helpers. Everything below is exercised by --self-test with no model and no network.
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TurnIds:
    """The three token runs that frame an assistant turn, read off the live tokenizer."""

    header: tuple[int, ...]
    """`<|turn>model\\n` — what a COMPLETED conversation puts before the article."""

    serving_suffix: tuple[int, ...]
    """What `add_generation_prompt=True` appends. Longer than `header` on this template."""

    end_of_turn: tuple[int, ...]
    """What follows the article, trimmed to the first stop token."""

    end_of_turn_raw: tuple[int, ...]
    """Before trimming, so the manifest can record what the template really emits."""

    has_stop_token: bool
    """False means the model would never learn to stop. Warned about loudly."""


def find_subsequence(haystack: Sequence[int], needle: Sequence[int]) -> int:
    """Index of the first occurrence of `needle` in `haystack`, or -1."""
    if not needle or len(needle) > len(haystack):
        return -1
    first = needle[0]
    span = len(needle)
    for start in range(len(haystack) - span + 1):
        if haystack[start] != first:
            continue
        if list(haystack[start : start + span]) == list(needle):
            return start
    return -1


def trim_end_of_turn(
    end_of_turn: Sequence[int], stop_ids: Iterable[int]
) -> tuple[tuple[int, ...], bool]:
    """Cut the turn-end run after its first stop token.

    The template emits `<turn|>\\n` — the trailing newline is the separator BEFORE the next
    turn, not part of the answer. Generation halts at the stop token, so training on anything
    past it teaches a continuation that can never be sampled. Returns the run unchanged, and
    False, when no stop token is present at all: that is worth shouting about, because such an
    adapter runs to `max_tokens` on every request.
    """
    stops = set(stop_ids)
    for index, token in enumerate(end_of_turn):
        if token in stops:
            return tuple(end_of_turn[: index + 1]), True
    return tuple(end_of_turn), False


def chat_template_ids(
    tokenizer: Any,
    messages: Sequence[Mapping[str, str]],
    add_generation_prompt: bool,
) -> list[int]:
    """`apply_chat_template(tokenize=True)` as a flat list of ids, on transformers 4 OR 5.

    transformers 4.x returned the ids themselves. 5.x returns a BatchEncoding, so the obvious
    `list(...)` yields `['input_ids', 'attention_mask']` — the dict KEYS. Nothing downstream
    says "wrong container": every id comparison is then between two identical two-element
    lists of strings and passes, the assistant block comes out EMPTY, and the run dies in
    `derive_turn_ids` claiming the template transforms assistant content. Measured on
    transformers 5.17.0, 2026-09-20.

    `return_dict=False` asks for the flat shape on both majors; the unwrapping below is the
    belt to that braces, so a tokenizer that ignores the argument or adds a batch dimension
    still yields ids rather than nonsense. A shape this cannot reduce to ints RAISES — the
    one thing it must never do is return something that merely looks like a token list.
    """
    try:
        out = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=add_generation_prompt,
            return_dict=False,
        )
    except TypeError:
        # A tokenizer whose signature predates `return_dict`.
        out = tokenizer.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=add_generation_prompt
        )
    if hasattr(out, "input_ids"):
        out = out.input_ids
    elif isinstance(out, Mapping):
        out = out["input_ids"]
    values = list(out)
    if values and isinstance(values[0], (list, tuple)):
        if len(values) != 1:
            raise RuntimeError(
                f"apply_chat_template returned {len(values)} sequences for one conversation; "
                f"expected exactly one."
            )
        values = list(values[0])
    if not all(isinstance(value, int) and not isinstance(value, bool) for value in values):
        raise RuntimeError(
            "apply_chat_template did not yield token ids. Got "
            f"{type(out).__name__} containing {[type(v).__name__ for v in values[:3]]}. "
            f"This is the transformers 4->5 return-shape change; see chat_template_ids."
        )
    return values


def derive_turn_ids(tokenizer: Any) -> TurnIds:
    """Read the assistant-turn framing off the tokenizer instead of declaring it.

    Three renderings of the same one-user conversation are enough:

      no_gen  = the conversation, nothing appended
      gen     = the conversation + the generation prompt   -> the SERVING prefix
      done    = the conversation + a sentinel assistant turn

    `gen` and `done` must both start with `no_gen`; the difference is the framing. The sentinel
    is located inside `done`'s tail, which splits it into the header and the turn end.
    """
    base = [{"role": "user", "content": SENTINEL_USER}]

    def render(messages: list[dict[str, str]], add_generation_prompt: bool) -> list[int]:
        return chat_template_ids(tokenizer, messages, add_generation_prompt)

    no_gen = render(base, False)
    gen = render(base, True)
    done = render(base + [{"role": "assistant", "content": SENTINEL_ASSISTANT}], False)

    if gen[: len(no_gen)] != no_gen:
        raise RuntimeError(
            "The generation prompt is not an extension of the conversation: this template "
            "rewrites earlier turns, and a prompt/completion split cannot be built from it."
        )
    if done[: len(no_gen)] != no_gen:
        raise RuntimeError(
            "Adding an assistant turn rewrote the earlier turns. Same problem as above."
        )

    serving_suffix = tuple(gen[len(no_gen) :])
    block = done[len(no_gen) :]

    sentinel_ids = list(
        tokenizer(SENTINEL_ASSISTANT, add_special_tokens=False)["input_ids"]
    )
    at = find_subsequence(block, sentinel_ids)
    if at == -1:
        raise RuntimeError(
            "Could not locate the sentinel inside the rendered assistant turn. The template "
            "may be transforming assistant content (stripping, escaping or re-casing it)."
        )

    header = tuple(block[:at])
    raw_end = tuple(block[at + len(sentinel_ids) :])

    stop_ids: list[int] = []
    for candidate in (
        getattr(tokenizer, "eos_token_id", None),
        getattr(tokenizer, "pad_token_id", None),
    ):
        if isinstance(candidate, int):
            stop_ids.append(candidate)
        elif isinstance(candidate, (list, tuple)):
            stop_ids.extend(int(value) for value in candidate)
    # The turn-end token is usually not the tokenizer's eos on a chat template, so take the
    # template's own first marker too rather than relying on the tokenizer's metadata.
    extra = getattr(tokenizer, "chat_stop_token_ids", None)
    if isinstance(extra, (list, tuple)):
        stop_ids.extend(int(value) for value in extra)

    end_of_turn, has_stop = trim_end_of_turn(raw_end, stop_ids)
    if not has_stop and raw_end:
        # No declared stop token matched, but the template clearly ends the turn with
        # something. Treat its FIRST token as the stop: that is the marker vLLM matches on.
        end_of_turn, has_stop = (raw_end[:1], True)

    return TurnIds(
        header=header,
        serving_suffix=serving_suffix,
        end_of_turn=end_of_turn,
        end_of_turn_raw=raw_end,
        has_stop_token=has_stop,
    )


@dataclass(frozen=True)
class AssembledExample:
    input_ids: list[int]
    labels: list[int]
    prompt_tokens: int
    answer_tokens: int
    truncated: bool


def assemble_example(
    prompt_ids: Sequence[int],
    answer_ids: Sequence[int],
    end_of_turn: Sequence[int],
    max_seq_length: int,
    on_overflow: str,
) -> AssembledExample | None:
    """Join a prompt and an answer into one masked training sequence.

    The label mask is the whole point: -100 everywhere except the article and its turn-end
    token. Returns None when the example cannot be kept.
    """
    prompt = list(prompt_ids)
    answer = list(answer_ids) + list(end_of_turn)

    if not answer:
        return None

    total = len(prompt) + len(answer)
    truncated = False

    if total > max_seq_length:
        if on_overflow == "drop":
            return None
        if on_overflow != "truncate":
            raise ValueError(f"Unknown overflow policy {on_overflow!r}.")
        # The article is the target and is never cut. If it alone does not fit, nothing can
        # be salvaged.
        room = max_seq_length - len(answer)
        if room < 8:
            return None
        # Cut the MIDDLE of the prompt: the head carries <bos>, the system turn and the start
        # of the specification, the tail carries the officer's own blocks and the turn header.
        head = room // 2
        tail = room - head
        prompt = prompt[:head] + prompt[len(prompt) - tail :]
        truncated = True

    input_ids = prompt + answer
    labels = [-100] * len(prompt) + answer[:]
    return AssembledExample(
        input_ids=input_ids,
        labels=labels,
        prompt_tokens=len(prompt),
        answer_tokens=len(answer),
        truncated=truncated,
    )


@dataclass(frozen=True)
class Schedule:
    examples: int
    per_device_batch_size: int
    grad_accum: int
    epochs: float
    steps_per_epoch: int
    total_steps: int
    warmup_steps: int
    warnings: tuple[str, ...]


def compute_schedule(
    examples: int,
    per_device_batch_size: int,
    grad_accum: int,
    epochs: float,
    warmup_ratio: float,
    warmup_steps_override: int | None,
) -> Schedule:
    """Resolve the optimiser schedule and say so out loud when it is degenerate.

    With 49 training examples, batch 1 and accumulation 8 there are six optimiser steps an
    epoch. The plan's flat "10 warmup steps" would then be most of the run. Warmup is therefore
    a RATIO by default and the override is capped, with a warning rather than a silent clamp.
    """
    effective_batch = max(1, per_device_batch_size * grad_accum)
    steps_per_epoch = max(1, math.ceil(examples / effective_batch))
    total_steps = max(1, math.ceil(steps_per_epoch * epochs))

    warnings: list[str] = []
    # Warmup must leave at least one step past the ramp, or the learning rate never reaches
    # its peak and the cosine never decays. On a one-step run that ceiling is zero, and zero
    # warmup is the honest answer rather than a ramp that is the entire run.
    ceiling = max(0, total_steps - 1)
    requested = (
        max(1, round(total_steps * warmup_ratio))
        if warmup_steps_override is None
        else max(0, warmup_steps_override)
    )
    warmup = min(requested, ceiling)
    if warmup != requested:
        warnings.append(
            f"warmup ({requested}) would leave no steps after the ramp in a "
            f"{total_steps}-step run; reduced to {warmup}."
        )

    if total_steps < 20:
        warnings.append(
            f"only {total_steps} optimiser steps — too few for a stable style shift. Capture "
            f"more pairs (finetune:capture continues from the newest uncaptured row), or "
            f"lower --grad-accum."
        )
    if warmup / total_steps > 0.3:
        warnings.append(
            f"warmup is {warmup}/{total_steps} steps ({warmup / total_steps:.0%} of the run); "
            f"the learning rate barely reaches its peak."
        )

    return Schedule(
        examples=examples,
        per_device_batch_size=per_device_batch_size,
        grad_accum=grad_accum,
        epochs=epochs,
        steps_per_epoch=steps_per_epoch,
        total_steps=total_steps,
        warmup_steps=warmup,
        warnings=tuple(warnings),
    )


@dataclass(frozen=True)
class ModuleSelection:
    included: tuple[str, ...]
    excluded_non_language: tuple[str, ...]
    language_root: str | None

    @property
    def summary(self) -> str:
        root = self.language_root or "(no language_model subtree; marker exclusion only)"
        return (
            f"{len(self.included)} target modules under {root}; "
            f"{len(self.excluded_non_language)} projection modules excluded as non-language"
        )


def resolve_target_modules(
    module_names: Iterable[str],
    suffixes: Sequence[str] = LM_PROJECTION_SUFFIXES,
    markers: Sequence[str] = NON_LANGUAGE_MARKERS,
) -> ModuleSelection:
    """Pick the language model's projections out of a multimodal module tree.

    Two independent filters, because either alone is unsafe. The marker list catches an
    encoder named something this repo has not seen; requiring membership of a `language_model`
    subtree — when the checkpoint has one — catches an encoder named something the marker list
    has not seen. A pure-text checkpoint has no such subtree and falls back to markers.
    """
    names = list(module_names)
    wanted = set(suffixes)

    language_root: str | None = None
    for name in names:
        parts = name.split(".")
        for index, part in enumerate(parts):
            if part in ("language_model", "text_model"):
                candidate = ".".join(parts[: index + 1])
                if language_root is None or len(candidate) < len(language_root):
                    language_root = candidate
                break

    included: list[str] = []
    excluded: list[str] = []
    for name in names:
        if not name:
            continue
        if name.rsplit(".", 1)[-1] not in wanted:
            continue
        lowered = name.lower()
        if any(marker in lowered for marker in markers):
            excluded.append(name)
            continue
        if language_root is not None and not (
            name == language_root or name.startswith(language_root + ".")
        ):
            excluded.append(name)
            continue
        included.append(name)

    return ModuleSelection(
        included=tuple(included),
        excluded_non_language=tuple(excluded),
        language_root=language_root,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"{path.name}:{number} is not valid JSON: {error}") from error
            messages = row.get("messages")
            if not isinstance(messages, list) or len(messages) < 2:
                raise RuntimeError(f"{path.name}:{number} has no usable messages array.")
            if messages[-1].get("role") != "assistant":
                raise RuntimeError(
                    f"{path.name}:{number} does not end in an assistant turn; the target is "
                    f"whatever the last message is, so this would train on the wrong text."
                )
            for message in messages:
                if not isinstance(message.get("content"), str):
                    raise RuntimeError(f"{path.name}:{number} has a non-string message content.")
                if "\u0000" in message["content"]:
                    raise RuntimeError(
                        f"{path.name}:{number} carries a NUL — the source-file marker leaked "
                        f"into the dataset. Re-capture; do not train on this."
                    )
            rows.append(row)
    return rows


def manifest_ids_for(manifest: dict[str, Any] | None, split: str, count: int) -> list[str]:
    """Positional join of split-manifest.json onto a split's lines, for readable reporting."""
    if not manifest:
        return [f"{split}#{index + 1}" for index in range(count)]
    examples = [
        entry for entry in manifest.get("examples", []) if entry.get("split") == split
    ]
    if len(examples) != count:
        return [f"{split}#{index + 1}" for index in range(count)]
    return [str(entry.get("id") or f"{split}#{index + 1}") for index, entry in enumerate(examples)]


# --------------------------------------------------------------------------------------------
# Dataset construction
# --------------------------------------------------------------------------------------------


@dataclass
class BuiltSplit:
    name: str
    kept: list[AssembledExample] = field(default_factory=list)
    kept_ids: list[str] = field(default_factory=list)
    dropped_ids: list[str] = field(default_factory=list)
    truncated_ids: list[str] = field(default_factory=list)
    token_lengths: list[int] = field(default_factory=list)


def build_split(
    name: str,
    rows: Sequence[dict[str, Any]],
    ids: Sequence[str],
    tokenizer: Any,
    turns: TurnIds,
    max_seq_length: int,
    on_overflow: str,
    turn_mode: str,
) -> BuiltSplit:
    built = BuiltSplit(name=name)
    prefix = turns.serving_suffix if turn_mode == "serving" else turns.header

    for row, example_id in zip(rows, ids):
        messages = row["messages"]
        history = [
            {"role": message["role"], "content": message["content"]}
            for message in messages[:-1]
        ]
        answer_text = messages[-1]["content"]

        # The prompt is rendered WITHOUT the generation prompt and the chosen prefix appended
        # explicitly, so both turn modes go through one code path and the difference between
        # them is one variable rather than two renderings that could drift.
        history_ids = chat_template_ids(tokenizer, history, False)
        prompt_ids = history_ids + list(prefix)
        answer_ids = list(tokenizer(answer_text, add_special_tokens=False)["input_ids"])

        assembled = assemble_example(
            prompt_ids, answer_ids, turns.end_of_turn, max_seq_length, on_overflow
        )
        if assembled is None:
            built.dropped_ids.append(example_id)
            continue
        built.kept.append(assembled)
        built.kept_ids.append(example_id)
        built.token_lengths.append(len(assembled.input_ids))
        if assembled.truncated:
            built.truncated_ids.append(example_id)

    return built


def dump_label_mask(
    tokenizer: Any, example: AssembledExample, example_id: str, head_chars: int = 400
) -> None:
    """Print what the loss is actually computed over.

    The plan asks for this before every run and it is not optional here: training on the prompt
    as well as the answer is the most common silent SFT failure, and the loss curve looks
    normal while it happens.
    """
    unmasked = [
        token for token, label in zip(example.input_ids, example.labels) if label != -100
    ]
    masked = [
        token for token, label in zip(example.input_ids, example.labels) if label == -100
    ]
    print("")
    print(f"LOSS MASK — example {example_id}")
    print(f"  sequence {len(example.input_ids)} tokens: "
          f"{example.prompt_tokens} masked prompt + {example.answer_tokens} scored answer")
    masked_tail = tokenizer.decode(masked[-60:], skip_special_tokens=False)
    print("  last 60 MASKED tokens (must end in the assistant-turn prefix):")
    print(f"    {masked_tail!r}")
    scored_head = tokenizer.decode(unmasked[:120], skip_special_tokens=False)
    print("  first SCORED tokens (must be the article, nothing before it):")
    print(f"    {scored_head[:head_chars]!r}")
    scored_tail = tokenizer.decode(unmasked[-12:], skip_special_tokens=False)
    print("  last SCORED tokens (must end in the turn-end token):")
    print(f"    {scored_tail!r}")
    print("")


# --------------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------------


def load_tokenizer(base_model: str, revision: str | None) -> Any:
    from transformers import AutoTokenizer

    kwargs: dict[str, Any] = {"trust_remote_code": True}
    if revision:
        kwargs["revision"] = revision
    tokenizer = AutoTokenizer.from_pretrained(base_model, **kwargs)
    if tokenizer.chat_template is None:
        raise RuntimeError(
            f"{base_model} ships no chat template, so there is nothing to match the server "
            f"against. Point --base-model at the served checkpoint."
        )
    return tokenizer


def load_model(base_model: str, revision: str | None, skip_quant: Sequence[str]) -> Any:
    """Load the base in 4-bit NF4, trying the multimodal class first.

    The auto class is a LADDER rather than a declaration: the right one depends on how the
    checkpoint registers itself, and guessing wrong fails after the weights have downloaded.
    """
    import torch
    from transformers import BitsAndBytesConfig

    quantization_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
        llm_int8_skip_modules=list(skip_quant) or None,
    )

    kwargs: dict[str, Any] = {
        "quantization_config": quantization_config,
        "device_map": "auto",
        "dtype": torch.bfloat16,
        "trust_remote_code": True,
        "attn_implementation": "eager",
    }
    if revision:
        kwargs["revision"] = revision

    import transformers

    ladder = []
    for name in ("AutoModelForImageTextToText", "AutoModelForCausalLM", "AutoModel"):
        cls = getattr(transformers, name, None)
        if cls is not None:
            ladder.append((name, cls))

    errors: list[str] = []
    for name, cls in ladder:
        try:
            model = cls.from_pretrained(base_model, **kwargs)
        except Exception as error:  # noqa: BLE001 - the next rung is the recovery
            errors.append(f"{name}: {type(error).__name__}: {error}")
            continue
        print(f"[model] loaded with {name}")
        return model

    raise RuntimeError(
        "Could not load the base model with any auto class.\n  " + "\n  ".join(errors)
    )


# --------------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="QLoRA distillation of the DGIPR article teacher into Gemma.",
    )
    parser.add_argument("--data-dir", default="/workspace/distill",
                        help="Directory holding train.jsonl, eval.jsonl and dataset-report.json.")
    parser.add_argument("--output-dir", default=None,
                        help="Where the adapter is written. Default: <data-dir>/../adapters/<name>.")
    parser.add_argument("--adapter-name", default=DEFAULT_ADAPTER_NAME)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--revision", default=None, help="Pin the base model revision.")

    parser.add_argument("--max-seq-length", type=int, default=None,
                        help="Default: dataset-report.json's recommendation.")
    parser.add_argument("--on-overflow", choices=("drop", "truncate"), default="drop")
    parser.add_argument("--max-drop-fraction", type=float, default=0.2)
    parser.add_argument("--turn-mode", choices=("serving", "completed"), default="serving",
                        help="serving = train on the prefix vLLM actually sends (default).")

    parser.add_argument("--lora-r", type=int, default=32)
    parser.add_argument("--lora-alpha", type=int, default=64)
    parser.add_argument("--lora-dropout", type=float, default=0.05)

    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--warmup-steps", type=int, default=None)
    parser.add_argument("--seed", type=int, default=20260920)
    parser.add_argument("--skip-quant-modules", default="",
                        help="Comma-separated module names left unquantised.")

    parser.add_argument("--smoke", type=int, default=0,
                        help="Train on the first N examples only. The plan's 20-example run.")
    parser.add_argument("--prepare-only", action="store_true",
                        help="Tokenizer + dataset + mask dump, then stop. No GPU needed.")
    parser.add_argument("--dump-labels", type=int, default=1)
    parser.add_argument("--allow-template-mismatch", action="store_true",
                        help="Train even when the local template disagrees with the server probe.")
    parser.add_argument("--force", action="store_true",
                        help="Proceed past the drop-fraction guard.")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args(argv)


def check_template_agreement(
    tokenizer: Any, turns: TurnIds, report: dict[str, Any], allow_mismatch: bool
) -> dict[str, Any]:
    """Compare the local rendering with what Phase 0.4 measured from the live endpoint."""
    probe = (report or {}).get("chatTemplate") or {}
    markers = probe.get("turnMarkers") or {}
    expected_header = markers.get("responseTemplate")
    expected_serving = markers.get("servingSuffix")

    local_header = tokenizer.decode(list(turns.header), skip_special_tokens=False)
    local_serving = tokenizer.decode(list(turns.serving_suffix), skip_special_tokens=False)

    problems: list[str] = []
    if expected_header and local_header != expected_header:
        problems.append(
            f"assistant-turn header: server {expected_header!r} vs local {local_header!r}"
        )
    if expected_serving and local_serving != expected_serving:
        problems.append(
            f"serving suffix: server {expected_serving!r} vs local {local_serving!r}"
        )

    probe_model = probe.get("model")
    if probe_model and probe_model != getattr(tokenizer, "name_or_path", probe_model):
        problems.append(
            f"probe recorded model {probe_model!r}, tokenizer is "
            f"{getattr(tokenizer, 'name_or_path', '?')!r}"
        )

    print("")
    print("CHAT TEMPLATE")
    print(f"  assistant header : {local_header!r}")
    print(f"  serving suffix   : {local_serving!r}")
    print(f"  turn end (kept)  : "
          f"{tokenizer.decode(list(turns.end_of_turn), skip_special_tokens=False)!r}")
    if turns.end_of_turn_raw != turns.end_of_turn:
        print(f"  turn end (raw)   : "
              f"{tokenizer.decode(list(turns.end_of_turn_raw), skip_special_tokens=False)!r} "
              f"(trimmed after the stop token)")
    if local_header != local_serving:
        print("  NOTE: the serving prefix is LONGER than a completed turn's header. "
              "--turn-mode serving is what keeps training and serving aligned.")
    if not turns.has_stop_token:
        print("  WARNING: no stop token found in the turn end. The adapter will not learn to "
              "stop and every request will run to max_tokens.")

    if problems:
        message = "Local chat template disagrees with the server probe:\n  - " + "\n  - ".join(
            problems
        )
        if not allow_mismatch:
            raise RuntimeError(
                message
                + "\n\nThis is the train/serve divergence Phase 0.4 exists to catch. Re-run the "
                  "probe against the endpoint you will serve from, or pass "
                  "--allow-template-mismatch if you have decided the difference is harmless."
            )
        print("  WARNING (forced): " + message.replace("\n", "\n  "))

    return {
        "localHeader": local_header,
        "localServingSuffix": local_serving,
        "serverHeader": expected_header,
        "serverServingSuffix": expected_serving,
        "agrees": not problems,
        "forced": bool(problems and allow_mismatch),
    }


def main(argv: Sequence[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    args = parse_args(argv)
    if args.self_test:
        return run_self_test()

    data_dir = Path(args.data_dir).resolve()
    train_path = data_dir / "train.jsonl"
    eval_path = data_dir / "eval.jsonl"
    report_path = data_dir / "dataset-report.json"
    manifest_path = data_dir / "split-manifest.json"

    if not train_path.exists():
        raise SystemExit(
            f"No train.jsonl in {data_dir}. Build it with "
            f"`pnpm --filter @dgipr/content-engine finetune:dataset` and copy the distill "
            f"directory onto the pod's volume."
        )

    report: dict[str, Any] = {}
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        print(f"WARNING: no dataset-report.json in {data_dir}; the chat-template agreement "
              f"check and the recommended max_seq_length are both unavailable.")

    manifest: dict[str, Any] | None = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    max_seq_length = args.max_seq_length
    if max_seq_length is None:
        recommendation = (
            ((report.get("tokens") or {}).get("recommendation") or {}).get("maxSeqLength")
        )
        if not isinstance(recommendation, int):
            raise SystemExit(
                "No --max-seq-length given and dataset-report.json carries no recommendation. "
                "Phase 2 measures this with the real tokenizer; guessing it truncates the "
                "longest articles, which are the scheme ones."
            )
        max_seq_length = recommendation
        print(f"[dataset] max_seq_length {max_seq_length} (from dataset-report.json)")

    train_rows = read_jsonl(train_path)
    eval_rows = read_jsonl(eval_path) if eval_path.exists() else []
    train_ids = manifest_ids_for(manifest, "train", len(train_rows))
    eval_ids = manifest_ids_for(manifest, "eval", len(eval_rows))

    if args.smoke > 0:
        train_rows = train_rows[: args.smoke]
        train_ids = train_ids[: args.smoke]
        eval_rows = eval_rows[: max(1, args.smoke // 5)]
        eval_ids = eval_ids[: len(eval_rows)]
        print(f"[smoke] {len(train_rows)} train / {len(eval_rows)} eval examples")

    tokenizer = load_tokenizer(args.base_model, args.revision)
    turns = derive_turn_ids(tokenizer)
    template_check = check_template_agreement(
        tokenizer, turns, report, args.allow_template_mismatch
    )

    train_split = build_split(
        "train", train_rows, train_ids, tokenizer, turns, max_seq_length,
        args.on_overflow, args.turn_mode,
    )
    eval_split = build_split(
        "eval", eval_rows, eval_ids, tokenizer, turns, max_seq_length,
        args.on_overflow, args.turn_mode,
    )

    print("")
    print("DATASET")
    for split in (train_split, eval_split):
        lengths = sorted(split.token_lengths)
        p50 = lengths[len(lengths) // 2] if lengths else 0
        print(f"  {split.name}: {len(split.kept)} kept, {len(split.dropped_ids)} dropped, "
              f"{len(split.truncated_ids)} truncated; tokens p50 {p50} max "
              f"{lengths[-1] if lengths else 0}")
        if split.dropped_ids:
            print(f"    dropped over {max_seq_length} tokens: {', '.join(split.dropped_ids)}")
        if split.truncated_ids:
            print(f"    truncated (source middle cut, article intact): "
                  f"{', '.join(split.truncated_ids)}")

    if not train_split.kept:
        raise SystemExit("Every training example was dropped. Raise --max-seq-length.")

    dropped_fraction = len(train_split.dropped_ids) / max(1, len(train_rows))
    if dropped_fraction > args.max_drop_fraction and not args.force:
        raise SystemExit(
            f"{dropped_fraction:.0%} of the training set does not fit in {max_seq_length} "
            f"tokens (limit {args.max_drop_fraction:.0%}). Raise --max-seq-length, switch to "
            f"--on-overflow truncate, or pass --force."
        )

    for index in range(min(args.dump_labels, len(train_split.kept))):
        dump_label_mask(tokenizer, train_split.kept[index], train_split.kept_ids[index])

    schedule = compute_schedule(
        examples=len(train_split.kept),
        per_device_batch_size=args.batch_size,
        grad_accum=args.grad_accum,
        epochs=args.epochs,
        warmup_ratio=args.warmup_ratio,
        warmup_steps_override=args.warmup_steps,
    )
    print("SCHEDULE")
    print(f"  {schedule.examples} examples, batch {schedule.per_device_batch_size} x accum "
          f"{schedule.grad_accum} = {schedule.steps_per_epoch} steps/epoch")
    print(f"  {schedule.epochs} epochs -> {schedule.total_steps} optimiser steps, "
          f"{schedule.warmup_steps} warmup, lr {args.learning_rate} cosine")
    for warning in schedule.warnings:
        print(f"  WARNING: {warning}")

    if args.prepare_only:
        print("")
        print("PREPARE ONLY — no model was loaded and nothing was written.")
        return 0

    output_dir = Path(
        args.output_dir or (data_dir.parent / "adapters" / args.adapter_name)
    ).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    import inspect

    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from torch.utils.data import Dataset as TorchDataset
    from transformers import Trainer, TrainingArguments, set_seed

    set_seed(args.seed)

    class _Examples(TorchDataset):
        """A map-style dataset over the pre-tokenized examples.

        Trainer accepts a plain list today, but the wrapper costs five lines and removes any
        dependence on that staying true — and on `datasets` being installed at all.
        """

        def __init__(self, items: list[AssembledExample]) -> None:
            self.items = items

        def __len__(self) -> int:
            return len(self.items)

        def __getitem__(self, index: int) -> AssembledExample:
            return self.items[index]

    skip_quant = [part.strip() for part in args.skip_quant_modules.split(",") if part.strip()]
    model = load_model(args.base_model, args.revision, skip_quant)
    model.config.use_cache = False

    # Only linear layers are adaptable, and after 4-bit loading the projections are
    # `Linear4bit` rather than `Linear` — so match on the substring, which also covers
    # `Linear8bitLt` and any future wrapper. A container module that happened to share a
    # projection name would otherwise be handed to peft and fail there instead of here.
    linear_names = [
        name
        for name, module in model.named_modules()
        if "Linear" in type(module).__name__
    ]
    selection = resolve_target_modules(linear_names)
    print("")
    print("TARGET MODULES")
    print(f"  {len(linear_names)} linear modules in the tree")
    print(f"  {selection.summary}")
    if selection.included[:2]:
        print(f"  first: {selection.included[0]}")
        print(f"  last : {selection.included[-1]}")
    if selection.excluded_non_language[:1]:
        print(f"  excluded sample: {selection.excluded_non_language[0]}")
    if not selection.included:
        raise SystemExit(
            "No language-model projections matched. The checkpoint's module names differ from "
            "every name this script knows; print model.named_modules() and widen "
            "LM_PROJECTION_SUFFIXES rather than dropping the non-language filter."
        )
    leaked = [
        name for name in selection.included
        if any(marker in name.lower() for marker in NON_LANGUAGE_MARKERS)
    ]
    if leaked:
        raise SystemExit(f"Vision modules leaked into the target list: {leaked[:5]}")

    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=list(selection.included),
        modules_to_save=None,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        pad_id = tokenizer.eos_token_id
    if pad_id is None:
        pad_id = 0

    def collate(batch: list[AssembledExample]) -> dict[str, Any]:
        longest = max(len(item.input_ids) for item in batch)
        input_ids, labels, attention = [], [], []
        for item in batch:
            padding = longest - len(item.input_ids)
            input_ids.append(item.input_ids + [pad_id] * padding)
            labels.append(item.labels + [-100] * padding)
            attention.append([1] * len(item.input_ids) + [0] * padding)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
            "attention_mask": torch.tensor(attention, dtype=torch.long),
        }

    training_kwargs: dict[str, Any] = {
        "output_dir": str(output_dir / "checkpoints"),
        "num_train_epochs": args.epochs,
        "per_device_train_batch_size": args.batch_size,
        "per_device_eval_batch_size": args.batch_size,
        "gradient_accumulation_steps": args.grad_accum,
        "gradient_checkpointing": True,
        "gradient_checkpointing_kwargs": {"use_reentrant": False},
        "learning_rate": args.learning_rate,
        "lr_scheduler_type": "cosine",
        "warmup_steps": schedule.warmup_steps,
        "logging_steps": 1,
        "save_strategy": "epoch",
        "save_total_limit": 2,
        "bf16": True,
        "optim": "paged_adamw_8bit",
        "report_to": [],
        "seed": args.seed,
        "remove_unused_columns": False,
    }
    if eval_split.kept:
        # transformers renamed this argument; read the signature rather than pinning a version
        # or constructing a throwaway TrainingArguments to find out.
        accepted = inspect.signature(TrainingArguments.__init__).parameters
        key = "eval_strategy" if "eval_strategy" in accepted else "evaluation_strategy"
        training_kwargs[key] = "epoch"

    trainer = Trainer(
        model=model,
        args=TrainingArguments(**training_kwargs),
        train_dataset=_Examples(train_split.kept),
        eval_dataset=_Examples(eval_split.kept) if eval_split.kept else None,
        data_collator=collate,
    )

    result = trainer.train()
    metrics = dict(result.metrics or {})
    if eval_split.kept:
        metrics.update(trainer.evaluate())

    model.save_pretrained(str(output_dir))
    print("")
    print(f"Adapter written to {output_dir}")

    manifest_out = {
        "formatVersion": "dgipr-dlo-adapter-v1",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "adapterName": args.adapter_name,
        "baseModel": args.base_model,
        "revision": args.revision,
        "dataset": {
            "directory": str(data_dir),
            "trainSha256": sha256_file(train_path),
            "evalSha256": sha256_file(eval_path) if eval_path.exists() else None,
            "reportBuiltAt": report.get("builtAt"),
            "teachers": report.get("teachers"),
            "trainKept": len(train_split.kept),
            "trainDropped": train_split.dropped_ids,
            "trainTruncated": train_split.truncated_ids,
            "evalKept": len(eval_split.kept),
            "evalDropped": eval_split.dropped_ids,
            "smoke": args.smoke or None,
        },
        "chatTemplate": template_check,
        "turnMode": args.turn_mode,
        "maxSeqLength": max_seq_length,
        "onOverflow": args.on_overflow,
        "lora": {
            "r": args.lora_r,
            "alpha": args.lora_alpha,
            "dropout": args.lora_dropout,
            "targetModuleCount": len(selection.included),
            "languageRoot": selection.language_root,
            "excludedNonLanguage": len(selection.excluded_non_language),
        },
        "schedule": {
            "epochs": schedule.epochs,
            "batchSize": schedule.per_device_batch_size,
            "gradAccum": schedule.grad_accum,
            "stepsPerEpoch": schedule.steps_per_epoch,
            "totalSteps": schedule.total_steps,
            "warmupSteps": schedule.warmup_steps,
            "learningRate": args.learning_rate,
            "warnings": list(schedule.warnings),
        },
        "metrics": {key: value for key, value in metrics.items() if isinstance(value, (int, float))},
    }
    (output_dir / "training-manifest.json").write_text(
        json.dumps(manifest_out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Manifest written to {output_dir / 'training-manifest.json'}")
    print("")
    print("Serve it beside the base with:")
    print(f"  --enable-lora --max-lora-rank {args.lora_r} \\")
    print(f"  --lora-modules {args.adapter_name}={output_dir}")
    return 0


# --------------------------------------------------------------------------------------------
# Self-test. Free: no GPU, no network, no model.
# --------------------------------------------------------------------------------------------


class _FakeGemmaTokenizer:
    """Reproduces the ids Phase 0.4 measured off the live gemma-4 endpoint.

    Not a stand-in for "some chat template" — these are the real recorded ids, so a change to
    derive_turn_ids that would have mis-split the real model fails here too.
    """

    BOS = 2
    TURN_OPEN = 105
    TURN_CLOSE = 106
    NEWLINE = 107
    SPACE = 236743
    CHANNEL_OPEN = 100
    CHANNEL_CLOSE = 101
    THOUGHT = 45518
    ROLE = {"system": 9731, "user": 2364, "assistant": 4368}
    eos_token_id = 106
    pad_token_id = 0
    name_or_path = "google/gemma-4-31B-it"
    chat_template = "{# measured #}"

    _WORDS = {
        "ZZUSERZZ": [48976, 20791, 48976],
        "ZZSYSTEMZZ": [48976, 90846, 48976],
        "ZZASSISTANTZZ": [48976, 11020, 4169, 9071, 48976],
    }

    def _text_ids(self, text: str) -> list[int]:
        if text in self._WORDS:
            return list(self._WORDS[text])
        return [9000 + (ord(char) % 500) for char in text]

    def __call__(self, text: str, add_special_tokens: bool = True) -> dict[str, list[int]]:
        ids = self._text_ids(text)
        if add_special_tokens:
            ids = [self.BOS] + ids
        return {"input_ids": ids}

    def apply_chat_template(
        self,
        messages: list[dict[str, str]],
        tokenize: bool = True,
        add_generation_prompt: bool = False,
    ) -> list[int]:
        ids = [self.BOS]
        for message in messages:
            role = message["role"]
            ids += [self.TURN_OPEN, self.ROLE[role], self.NEWLINE]
            ids += self._text_ids(message["content"])
            if role == "system":
                ids.append(self.SPACE)
            ids += [self.TURN_CLOSE, self.NEWLINE]
        if add_generation_prompt:
            ids += [
                self.TURN_OPEN, self.ROLE["assistant"], self.NEWLINE,
                self.CHANNEL_OPEN, self.THOUGHT, self.NEWLINE, self.CHANNEL_CLOSE,
            ]
        return ids

    def decode(self, ids: Sequence[int], skip_special_tokens: bool = False) -> str:
        names = {
            self.BOS: "<bos>", self.TURN_OPEN: "<|turn>", self.TURN_CLOSE: "<turn|>",
            self.NEWLINE: "\n", self.SPACE: " ", self.CHANNEL_OPEN: "<|channel>",
            self.CHANNEL_CLOSE: "<channel|>", self.THOUGHT: "thought",
            self.ROLE["system"]: "system", self.ROLE["user"]: "user",
            self.ROLE["assistant"]: "model",
        }
        return "".join(names.get(token, "?") for token in ids)


def run_self_test() -> int:
    failures: list[str] = []

    def check(label: str, condition: bool) -> None:
        if condition:
            print(f"  ok   {label}")
        else:
            print(f"  FAIL {label}")
            failures.append(label)

    print("find_subsequence")
    check("finds a run", find_subsequence([1, 2, 3, 4], [3, 4]) == 2)
    check("absent is -1", find_subsequence([1, 2, 3], [3, 4]) == -1)
    check("empty needle is -1", find_subsequence([1, 2], []) == -1)
    check("first occurrence wins", find_subsequence([5, 1, 5, 1], [5, 1]) == 0)

    print("trim_end_of_turn")
    check("cuts after the stop", trim_end_of_turn([106, 107], {106}) == ((106,), True))
    check("keeps a lone stop", trim_end_of_turn([106], {106}) == ((106,), True))
    check("reports no stop", trim_end_of_turn([107], {106}) == ((107,), False))
    check("first stop, not last", trim_end_of_turn([106, 107, 106], {106}) == ((106,), True))

    print("chat_template_ids — the transformers 4/5 return-shape change")

    class _Shaped:
        """A tokenizer stand-in that returns `shape` from apply_chat_template."""

        def __init__(self, shape: Any, accepts_return_dict: bool = True) -> None:
            self.shape = shape
            self.accepts_return_dict = accepts_return_dict
            self.saw_return_dict = False

        def apply_chat_template(self, messages, tokenize=True,
                                add_generation_prompt=False, **kwargs):
            if "return_dict" in kwargs:
                if not self.accepts_return_dict:
                    raise TypeError("unexpected keyword argument 'return_dict'")
                self.saw_return_dict = True
            return self.shape

    class _Encoding(dict):
        """BatchEncoding is a Mapping that also exposes .input_ids."""

        @property
        def input_ids(self):
            return self["input_ids"]

    check(  # transformers 4.x
        "a flat list passes through",
        chat_template_ids(_Shaped([1, 2, 3]), [], False) == [1, 2, 3],
    )
    check(  # transformers 5.x — the shape that broke the real run
        "a BatchEncoding is unwrapped to its ids",
        chat_template_ids(_Encoding_tok := _Shaped(_Encoding(input_ids=[1, 2, 3],
                                                            attention_mask=[1, 1, 1])),
                          [], False) == [1, 2, 3],
    )
    check(
        "a plain dict is unwrapped too",
        chat_template_ids(_Shaped({"input_ids": [4, 5]}), [], False) == [4, 5],
    )
    check(
        "a batch dimension is unwrapped",
        chat_template_ids(_Shaped([[6, 7]]), [], False) == [6, 7],
    )
    check(
        "return_dict=False is asked for",
        _Encoding_tok.saw_return_dict,
    )
    check(
        "a tokenizer without return_dict still works",
        chat_template_ids(_Shaped([8, 9], accepts_return_dict=False), [], False) == [8, 9],
    )
    _raised = False
    try:  # the exact failure the real run hit: dict KEYS, which look like a token list
        chat_template_ids(_Shaped(["input_ids", "attention_mask"]), [], False)
    except RuntimeError:
        _raised = True
    check("a list of strings RAISES rather than passing as ids", _raised)
    _raised = False
    try:
        chat_template_ids(_Shaped([[1], [2]]), [], False)
    except RuntimeError:
        _raised = True
    check("more than one sequence RAISES", _raised)

    print("derive_turn_ids against the measured gemma-4 ids")
    tokenizer = _FakeGemmaTokenizer()
    turns = derive_turn_ids(tokenizer)
    check("header is <|turn>model\\n", turns.header == (105, 4368, 107))
    check(
        "serving suffix opens the thought channel",
        turns.serving_suffix == (105, 4368, 107, 100, 45518, 107, 101),
    )
    check("turn end trimmed to the stop token", turns.end_of_turn == (106,))
    check("raw turn end kept for the record", turns.end_of_turn_raw == (106, 107))
    check("a stop token was found", turns.has_stop_token)
    check(
        "serving differs from a completed turn — the whole reason for --turn-mode",
        turns.serving_suffix != turns.header,
    )
    check(
        "header decodes to the probe's responseTemplate",
        tokenizer.decode(list(turns.header)) == "<|turn>model\n",
    )
    check(
        "serving suffix decodes to the probe's servingSuffix",
        tokenizer.decode(list(turns.serving_suffix))
        == "<|turn>model\n<|channel>thought\n<channel|>",
    )

    print("assemble_example")
    assembled = assemble_example([1, 2, 3], [7, 8], [106], 16, "drop")
    assert assembled is not None
    check("prompt then answer", assembled.input_ids == [1, 2, 3, 7, 8, 106])
    check("prompt fully masked", assembled.labels[:3] == [-100, -100, -100])
    check("answer and stop scored", assembled.labels[3:] == [7, 8, 106])
    check("lengths line up", len(assembled.input_ids) == len(assembled.labels))
    check("counts reported", (assembled.prompt_tokens, assembled.answer_tokens) == (3, 3))
    check("not flagged truncated", assembled.truncated is False)
    check(
        "exactly at the limit is kept",
        assemble_example([1, 2, 3], [7, 8], [106], 6, "drop") is not None,
    )
    check(
        "one over the limit is dropped",
        assemble_example([1, 2, 3, 4], [7, 8], [106], 6, "drop") is None,
    )
    check("empty answer is dropped", assemble_example([1, 2], [], [], 16, "drop") is None)

    truncated = assemble_example(list(range(100)), [7, 8], [106], 20, "truncate")
    assert truncated is not None
    check("truncate keeps the whole answer", truncated.input_ids[-3:] == [7, 8, 106])
    check("truncate honours the window", len(truncated.input_ids) == 20)
    check("truncate keeps the prompt head", truncated.input_ids[0] == 0)
    check("truncate keeps the prompt tail", truncated.input_ids[16] == 99)
    check("truncate is flagged", truncated.truncated is True)
    check(
        "an answer that alone overflows is dropped even under truncate",
        assemble_example([1], list(range(50)), [106], 20, "truncate") is None,
    )
    check(
        "an answer is never cut to fit",
        all(
            assemble_example([1] * 500, list(range(n)), [106], 64, "truncate") is None
            or assemble_example([1] * 500, list(range(n)), [106], 64, "truncate").input_ids[-1]
            == 106
            for n in (10, 40, 70)
        ),
    )

    print("resolve_target_modules")
    tree = [
        "",
        "model",
        "model.vision_tower",
        "model.vision_tower.encoder.layers.0.self_attn.q_proj",
        "model.vision_tower.encoder.layers.0.self_attn.k_proj",
        "model.vision_tower.encoder.layers.0.mlp.up_proj",
        "model.multi_modal_projector.linear",
        "model.multi_modal_projector.mlp.down_proj",
        "model.language_model.layers.0.self_attn.q_proj",
        "model.language_model.layers.0.self_attn.k_proj",
        "model.language_model.layers.0.self_attn.v_proj",
        "model.language_model.layers.0.self_attn.o_proj",
        "model.language_model.layers.0.mlp.gate_proj",
        "model.language_model.layers.0.mlp.up_proj",
        "model.language_model.layers.0.mlp.down_proj",
        "model.language_model.norm",
        "lm_head",
    ]
    selection = resolve_target_modules(tree)
    check("seven projections kept", len(selection.included) == 7)
    check("language root found", selection.language_root == "model.language_model")
    check(
        "every kept module is under the language model",
        all(name.startswith("model.language_model.") for name in selection.included),
    )
    check(
        "no vision module survives",
        not any("vision" in name for name in selection.included),
    )
    check(
        "no projector module survives",
        not any("projector" in name for name in selection.included),
    )
    check("lm_head is not a target", "lm_head" not in selection.included)
    check("norms are not targets", not any(name.endswith("norm") for name in selection.included))
    check("exclusions counted", len(selection.excluded_non_language) == 4)

    plain = resolve_target_modules(
        ["model.layers.0.self_attn.q_proj", "model.layers.0.mlp.down_proj", "lm_head"]
    )
    check("a text-only checkpoint still matches", len(plain.included) == 2)
    check("and reports no language root", plain.language_root is None)

    odd = resolve_target_modules(
        [
            "model.language_model.layers.0.self_attn.q_proj",
            "model.SigLIPTower.layers.0.self_attn.q_proj",
        ]
    )
    check("marker matching is case-insensitive", len(odd.included) == 1)

    print("compute_schedule")
    schedule = compute_schedule(49, 1, 8, 3.0, 0.1, None)
    check("steps per epoch rounds up", schedule.steps_per_epoch == 7)
    check("total steps", schedule.total_steps == 21)
    check("warmup from the ratio", schedule.warmup_steps == 2)
    check("no degenerate warning at 21 steps", not any("too few" in w for w in schedule.warnings))

    tiny = compute_schedule(8, 1, 8, 3.0, 0.1, None)
    check("a tiny run warns", any("too few" in w for w in tiny.warnings))

    capped = compute_schedule(49, 1, 8, 3.0, 0.1, 10)
    check("an override is honoured when it fits", capped.warmup_steps == 10)
    check("but a long warmup warns", any("warmup is" in w for w in capped.warnings))

    over = compute_schedule(49, 1, 8, 3.0, 0.1, 50)
    check("an override longer than the run is capped", over.warmup_steps < over.total_steps)
    check("and says so", any("no steps after the ramp" in w for w in over.warnings))

    single = compute_schedule(4, 1, 8, 1.0, 0.1, 10)
    check("a one-step run takes zero warmup", (single.total_steps, single.warmup_steps) == (1, 0))

    check(
        "a ratio that rounds to zero still warms up",
        compute_schedule(100, 1, 8, 1.0, 0.0, None).warmup_steps == 1,
    )

    print("manifest_ids_for")
    fake_manifest = {
        "examples": [
            {"id": "a", "split": "train"},
            {"id": "b", "split": "eval"},
            {"id": "c", "split": "train"},
        ]
    }
    check("ids join by split order", manifest_ids_for(fake_manifest, "train", 2) == ["a", "c"])
    check(
        "a count mismatch falls back to line numbers",
        manifest_ids_for(fake_manifest, "train", 3) == ["train#1", "train#2", "train#3"],
    )
    check(
        "no manifest falls back too",
        manifest_ids_for(None, "eval", 2) == ["eval#1", "eval#2"],
    )

    print("build_split end to end on the fake tokenizer")
    rows = [
        {
            "messages": [
                {"role": "system", "content": "Write a DGIPR Maharashtra style article."},
                {"role": "user", "content": "SOURCE"},
                {"role": "assistant", "content": "ARTICLE"},
            ]
        }
    ]
    built = build_split("train", rows, ["x"], tokenizer, turns, 4096, "drop", "serving")
    check("one example kept", len(built.kept) == 1)
    example = built.kept[0]
    check(
        "the masked prompt ends in the SERVING prefix",
        example.input_ids[example.prompt_tokens - len(turns.serving_suffix) : example.prompt_tokens]
        == list(turns.serving_suffix),
    )
    check(
        "nothing before the answer is scored",
        set(example.labels[: example.prompt_tokens]) == {-100},
    )
    check("the answer ends in the stop token", example.input_ids[-1] == 106)
    check("the stop token is scored", example.labels[-1] == 106)

    completed = build_split("train", rows, ["x"], tokenizer, turns, 4096, "drop", "completed")
    completed_example = completed.kept[0]
    check(
        "completed mode ends in the short header instead",
        completed_example.input_ids[
            completed_example.prompt_tokens - len(turns.header) : completed_example.prompt_tokens
        ]
        == list(turns.header),
    )
    check(
        "the two turn modes really differ",
        completed_example.prompt_tokens != example.prompt_tokens,
    )

    print("read_jsonl guards")
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "bad.jsonl"
        path.write_text(
            json.dumps(
                {"messages": [{"role": "user", "content": "a"},
                              {"role": "user", "content": "b"}]}
            )
            + "\n",
            encoding="utf-8",
        )
        try:
            read_jsonl(path)
            check("a non-assistant last turn is refused", False)
        except RuntimeError:
            check("a non-assistant last turn is refused", True)

        path.write_text(
            json.dumps(
                {"messages": [{"role": "user", "content": "a\u0000b"},
                              {"role": "assistant", "content": "c"}]}
            )
            + "\n",
            encoding="utf-8",
        )
        try:
            read_jsonl(path)
            check("a NUL in the dataset is refused", False)
        except RuntimeError:
            check("a NUL in the dataset is refused", True)

        path.write_text(
            json.dumps(
                {"messages": [{"role": "user", "content": "a"},
                              {"role": "assistant", "content": "c"}]}
            )
            + "\n\n",
            encoding="utf-8",
        )
        check("a clean file reads", len(read_jsonl(path)) == 1)

    print("")
    if failures:
        print(f"{len(failures)} FAILED: {failures}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
