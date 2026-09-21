"""Phase 0.4, the half that needs the tokenizer: does the chat template carry
`{% generation %}` markers, and does it render byte-for-byte like the served one?

Run this on the TRAINING box (the one with the model weights), against the artifact
`pnpm --filter @dgipr/content-engine finetune:template` wrote from the live endpoint.

    python check_chat_template.py --artifact chat-template-probe.json

WHY IT IS SPLIT IN TWO. vLLM applies the chat template server-side, and a training script
applies its own. If they differ they differ at the token level, and nothing downstream
reveals it — the loss curve looks fine, the adapter loads, and the style simply does not
transfer. So the ids are captured from the SERVER by the TypeScript probe and re-derived
HERE from the tokenizer; only a byte-for-byte match proves the two agree.

WHAT ONLY THIS SIDE CAN ANSWER. `{% generation %}` markers are a property of the tokenizer's
`chat_template`, and no OpenAI-compatible endpoint exposes it. They decide whether TRL's
`assistant_only_loss=True` works or a response-template collator is needed instead.

WHAT THE SERVER ALREADY SETTLED, live on 2026-09-20 against `google/gemma-4-31B-it`:

  * The system role is KEPT as its own turn.
  * The template renders `<|turn>role\\n … <turn|>\\n`, NOT Gemma 2/3's
    `<start_of_turn>` / `<end_of_turn>`.
  * `add_generation_prompt` appends `<|turn>model\\n<|channel>thought\\n<channel|>` — an empty
    `thought` channel that a HISTORICAL assistant turn (`<|turn>model\\n{text}<turn|>\\n`) has
    no trace of. So the two prefixes DIFFER, and a training text built by rendering the whole
    conversation would teach the model to continue a prefix the server never sends. Build each
    training text from the generation prompt instead:

        prefix = tok.apply_chat_template(prompt_messages, tokenize=False,
                                         add_generation_prompt=True)
        text   = prefix + article + TURN_CLOSE
        # mask every token of `prefix`; train only on what follows.

    That also makes `{% generation %}` moot: with the prefix built explicitly, its length in
    tokens is known exactly and the mask needs no marker search at all. Check for the markers
    anyway — if they exist, `assistant_only_loss` is the simpler route AND a cross-check.

Exit code is 0 when every comparison matched, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_MODEL = "google/gemma-4-31B-it"


def load_tokenizer(model_id: str):
    try:
        from transformers import AutoTokenizer
    except ImportError:  # pragma: no cover - environment problem, not logic
        sys.exit(
            "transformers is not installed. On the training box:\n"
            "    pip install 'transformers>=4.45' 'trl>=0.12'"
        )
    return AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)


def report(label: str, ok: bool, detail: str = "") -> bool:
    print(f"{'ok  ' if ok else 'FAIL'} {label}{(' — ' + detail) if detail else ''}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--artifact",
        default="chat-template-probe.json",
        help="the JSON the TypeScript probe wrote from the live endpoint",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="tokenizer to load; defaults to the model id recorded in the artifact",
    )
    args = parser.parse_args()

    path = Path(args.artifact)
    if not path.exists():
        sys.exit(
            f"{path} not found. Produce it first, from a machine that can reach the endpoint:\n"
            "    pnpm --filter @dgipr/content-engine finetune:template\n"
            "It lands in packages/content-engine/data/finetune/distill/."
        )
    artifact = json.loads(path.read_text(encoding="utf-8"))
    model_id = args.model or artifact.get("model") or DEFAULT_MODEL
    print(f"artifact: {path}  (probed {artifact.get('probedAt')})")
    print(f"tokenizer: {model_id}\n")

    tok = load_tokenizer(model_id)
    passed = True

    # --- Q2: the markers ------------------------------------------------------------
    template = getattr(tok, "chat_template", None)
    if isinstance(template, dict):  # some tokenizers carry a dict of named templates
        template = template.get("default") or next(iter(template.values()), None)
    has_markers = isinstance(template, str) and "{% generation %}" in template
    print("=== Q2: {% generation %} markers ===")
    print(f"  present: {'YES' if has_markers else 'NO'}")
    if has_markers:
        print("  TRL `assistant_only_loss=True` is available.")
    else:
        print(
            "  Not available. Build the training text from the generation prompt and mask its\n"
            "  tokens by length, as the module docstring describes; that is exact and needs no\n"
            "  marker at all."
        )

    # `return_assistant_tokens_mask` is the capability the markers actually gate, so it is
    # exercised rather than inferred from the template string.
    try:
        probe = tok.apply_chat_template(
            [
                {"role": "user", "content": "U"},
                {"role": "assistant", "content": "A"},
            ],
            tokenize=True,
            return_dict=True,
            return_assistant_tokens_mask=True,
        )
        mask = probe.get("assistant_masks")
        usable = bool(mask) and any(mask)
        print(f"  return_assistant_tokens_mask usable: {'YES' if usable else 'NO'}")
    except Exception as error:  # noqa: BLE001 - any failure here means "not usable"
        print(f"  return_assistant_tokens_mask usable: NO ({type(error).__name__})")

    # --- the byte-for-byte comparison -----------------------------------------------
    print("\n=== train vs serve: token ids ===")
    for case in artifact.get("cases", []):
        name = case["name"]
        rendered = tok.apply_chat_template(
            case["messages"],
            tokenize=False,
            add_generation_prompt=case["addGenerationPrompt"],
        )
        ids = tok(rendered, add_special_tokens=False)["input_ids"]
        server_ids = case["tokens"]
        match = list(ids) == list(server_ids)
        passed &= report(
            f"{name}: {len(ids)} local vs {len(server_ids)} served",
            match,
            "" if match else "ids differ — the training script must NOT use this template",
        )
        if not match:
            first = next(
                (
                    i
                    for i, (a, b) in enumerate(zip(ids, server_ids))
                    if a != b
                ),
                min(len(ids), len(server_ids)),
            )
            print(f"     first difference at index {first}")
            print(f"     local : {list(ids)[max(0, first - 4):first + 4]}")
            print(f"     served: {list(server_ids)[max(0, first - 4):first + 4]}")
        expected = case.get("rendered")
        if expected is not None and rendered != expected:
            print("     NOTE: rendered strings also differ.")
            print(f"     local : {rendered!r}")
            print(f"     served: {expected!r}")

    # --- the markers the training script will actually use --------------------------
    markers = artifact.get("turnMarkers") or {}
    print("\n=== the prefix to train on ===")
    print(f"  history marker  : {markers.get('responseTemplate')!r}")
    print(f"  serving suffix  : {markers.get('servingSuffix')!r}")
    if markers.get("agree"):
        print("  They agree; either construction trains what the server serves.")
    else:
        print(
            "  They DIFFER. Use the serving suffix: build each example as\n"
            "      apply_chat_template(prompt_messages, add_generation_prompt=True) + article\n"
            "  and mask the prefix by its own token length."
        )

    print(f"\n{'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
