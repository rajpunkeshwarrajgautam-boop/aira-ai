#!/usr/bin/env python3
"""Fail-closed Qwen3.5 text-training contract preflight.

This gate is intentionally tokenizer-only: it never loads model weights. It proves that
AIRA's committed Soup training chat template produces a real Hugging Face assistant
mask and that Soup's response-only label builder consumes that exact mask rather than
falling back to incremental turn-delta supervision.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"
REQUIRED_TEMPLATE_MARKERS = ("{% generation %}", "{% endgeneration %}")
IGNORE_INDEX = -100


def _as_int_list(value: Any, field: str) -> list[int]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], list):
        value = value[0]
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field} is not a token sequence")
    result: list[int] = []
    for index, item in enumerate(value):
        if isinstance(item, bool):
            result.append(int(item))
            continue
        if not isinstance(item, int):
            raise ValueError(f"{field}[{index}] is not an integer: {item!r}")
        result.append(item)
    return result


def _template_contract(template: str) -> None:
    if not isinstance(template, str) or not template.strip():
        raise ValueError("data.chat_template must be a non-empty raw Jinja template")
    missing = [marker for marker in REQUIRED_TEMPLATE_MARKERS if marker not in template]
    if missing:
        raise ValueError(
            "training chat template is missing assistant-mask markers: " + ", ".join(missing)
        )
    for role in ("system", "user", "assistant"):
        if role not in template:
            raise ValueError(f"training chat template does not mention required role {role!r}")


def _load_training_config(path: Path) -> tuple[str, int]:
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError("PyYAML is required for the runtime masking preflight") from exc

    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
        raise ValueError("Soup config must contain a data mapping")
    data = raw["data"]
    if data.get("train_on_responses_only") is not True:
        raise ValueError("AIRA Core requires data.train_on_responses_only=true")
    max_length = data.get("max_length")
    if not isinstance(max_length, int) or isinstance(max_length, bool) or max_length <= 0:
        raise ValueError("data.max_length must be a positive integer")
    template = data.get("chat_template")
    _template_contract(template)
    return template, max_length


def _decode_selected(tokenizer: Any, input_ids: list[int], flags: list[int], keep: bool) -> str:
    selected = [token for token, flag in zip(input_ids, flags) if bool(flag) is keep]
    return tokenizer.decode(selected, skip_special_tokens=False)


def _self_test() -> dict[str, Any]:
    valid = (
        "{% for message in messages %}"
        "{% if message['role'] == 'system' %}system"
        "{% elif message['role'] == 'user' %}user"
        "{% elif message['role'] == 'assistant' %}assistant"
        "{% generation %}{{ message['content'] }}{% endgeneration %}"
        "{% endif %}{% endfor %}"
    )
    _template_contract(valid)
    try:
        _template_contract(valid.replace("{% generation %}", ""))
    except ValueError:
        pass
    else:
        raise RuntimeError("template contract accepted a template without generation marker")
    if _as_int_list([1, 0, True], "mask") != [1, 0, 1]:
        raise RuntimeError("integer-list normalization self-test failed")
    return {"status": "PASS", "strict_template_contract": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", help="Local tokenizer directory or Hugging Face model ID")
    parser.add_argument("--revision", help="Exact Hugging Face revision when --model is remote")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--allow-download",
        action="store_true",
        help="Allow tokenizer-only Hugging Face downloads. Model weights are never loaded.",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(_self_test(), indent=2, sort_keys=True))
        return 0
    if not args.model:
        parser.error("--model is required unless --self-test is used")
    if not args.config.is_file():
        raise SystemExit(f"config missing: {args.config}")

    try:
        template, max_length = _load_training_config(args.config)

        from transformers import AutoTokenizer
        from soup_cli.data.loss_mask import build_assistant_only_labels

        local_model = Path(args.model).is_dir()
        if not local_model and not args.revision:
            raise ValueError("remote model IDs require --revision with an exact pinned commit")

        tokenizer = AutoTokenizer.from_pretrained(
            args.model,
            revision=None if local_model else args.revision,
            local_files_only=local_model or not args.allow_download,
            trust_remote_code=False,
        )
        original_template = getattr(tokenizer, "chat_template", None) or ""
        tokenizer.chat_template = template

        sentinels = {
            "system": "AIRA_SYSTEM_SENTINEL_8d1f3a",
            "user_1": "AIRA_USER_SENTINEL_51c92e",
            "assistant_1": "AIRA_ASSISTANT_SENTINEL_760bd4",
            "user_2": "AIRA_USER_SENTINEL_2_29af65",
            "assistant_2": "AIRA_ASSISTANT_SENTINEL_2_c3e817",
        }
        messages = [
            {"role": "system", "content": sentinels["system"]},
            {"role": "user", "content": sentinels["user_1"]},
            {"role": "assistant", "content": sentinels["assistant_1"]},
            {"role": "user", "content": sentinels["user_2"]},
            {"role": "assistant", "content": sentinels["assistant_2"]},
        ]

        rendered = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=False,
            return_assistant_tokens_mask=True,
            return_dict=True,
        )
        input_ids = _as_int_list(rendered.get("input_ids"), "input_ids")
        assistant_mask = _as_int_list(rendered.get("assistant_masks"), "assistant_masks")
        if len(input_ids) != len(assistant_mask):
            raise ValueError("assistant mask length does not match input_ids")
        if not any(assistant_mask):
            raise ValueError("assistant mask is empty/all-zero")
        if all(assistant_mask):
            raise ValueError("assistant mask supervises every token")

        supervised_text = _decode_selected(tokenizer, input_ids, assistant_mask, True)
        masked_text = _decode_selected(tokenizer, input_ids, assistant_mask, False)
        for key in ("assistant_1", "assistant_2"):
            if sentinels[key] not in supervised_text:
                raise ValueError(f"assistant sentinel {key} is not fully supervised")
        for key in ("system", "user_1", "user_2"):
            if sentinels[key] in supervised_text:
                raise ValueError(f"non-assistant sentinel {key} leaked into supervised tokens")
            if sentinels[key] not in masked_text:
                raise ValueError(f"non-assistant sentinel {key} is not present in the masked surface")
        if "<|im_start|>assistant" in supervised_text or "<|im_end|>" in supervised_text:
            raise ValueError("assistant role/control tokens leaked into the supervised content mask")

        soup = build_assistant_only_labels(messages, tokenizer, max_length=max_length)
        soup_ids = _as_int_list(soup["input_ids"], "soup.input_ids")
        soup_labels = _as_int_list(soup["labels"], "soup.labels")
        expected_ids = input_ids[:max_length]
        expected_mask = assistant_mask[:max_length]
        expected_labels = [token if flag else IGNORE_INDEX for token, flag in zip(expected_ids, expected_mask)]
        if soup_ids != expected_ids:
            raise ValueError("Soup input_ids differ from the strict HF chat-template rendering")
        if soup_labels != expected_labels:
            raise ValueError(
                "Soup response-only labels differ from the strict assistant mask; refusing fallback masking"
            )
        supervised_tokens = sum(label != IGNORE_INDEX for label in soup_labels)
        if supervised_tokens <= 0:
            raise ValueError("strict Soup label surface has zero supervised tokens")

        result = {
            "schema_version": 1,
            "status": "PASS",
            "model": args.model,
            "requested_revision": None if local_model else args.revision,
            "config": str(args.config),
            "max_length": max_length,
            "train_on_responses_only": True,
            "original_template_has_generation_markers": all(
                marker in original_template for marker in REQUIRED_TEMPLATE_MARKERS
            ),
            "strict_template_has_generation_markers": True,
            "input_tokens": len(soup_ids),
            "supervised_tokens": supervised_tokens,
            "masked_tokens": len(soup_ids) - supervised_tokens,
            "assistant_content_only": True,
            "soup_strict_mask_match": True,
        }
    except (OSError, ValueError, RuntimeError, TypeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    rendered_result = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered_result + "\n", encoding="utf-8")
    print(rendered_result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
