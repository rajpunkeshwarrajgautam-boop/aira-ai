#!/usr/bin/env python3
"""Count exact AIRA Core total/supervised/truncated tokens under the training contract.

The script loads only the tokenizer, applies the committed strict training template, and
writes reviewable evidence. It refuses rows with an empty assistant mask or any config
that is not response-only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * q
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return ordered[low]
    return int(round(ordered[low] + (ordered[high] - ordered[low]) * (index - low)))


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
        elif isinstance(item, int):
            result.append(item)
        else:
            raise ValueError(f"{field}[{index}] is not an integer: {item!r}")
    return result


def _load_config(path: Path) -> tuple[str, int]:
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError("PyYAML is required for token accounting") from exc
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
        raise ValueError("Soup config must contain a data mapping")
    data = raw["data"]
    if data.get("train_on_responses_only") is not True:
        raise ValueError("AIRA Core token accounting requires train_on_responses_only=true")
    template = data.get("chat_template")
    if not isinstance(template, str) or "{% generation %}" not in template or "{% endgeneration %}" not in template:
        raise ValueError("AIRA Core config is missing the strict assistant-generation training template")
    max_length = data.get("max_length")
    if not isinstance(max_length, int) or isinstance(max_length, bool) or max_length <= 0:
        raise ValueError("data.max_length must be a positive integer")
    return template, max_length


def _self_test() -> dict[str, Any]:
    values = [10, 20, 30, 40]
    if percentile(values, 0.5) != 25:
        raise RuntimeError("p50 self-test failed")
    if percentile([7], 0.95) != 7:
        raise RuntimeError("single-value percentile self-test failed")
    return {"status": "PASS", "p50": percentile(values, 0.5), "p95": percentile(values, 0.95)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path)
    parser.add_argument("--model", help="Local tokenizer directory or Hugging Face model ID")
    parser.add_argument("--revision", help="Exact pinned revision for a remote model ID")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(_self_test(), indent=2, sort_keys=True))
        return 0
    if not args.dataset or not args.dataset.is_file():
        parser.error("--dataset must point to an existing JSONL file")
    if not args.model:
        parser.error("--model is required")

    try:
        template, max_length = _load_config(args.config)
        from transformers import AutoTokenizer

        local_model = Path(args.model).is_dir()
        if not local_model and not args.revision:
            raise ValueError("remote model IDs require --revision with an exact pinned commit")
        tokenizer = AutoTokenizer.from_pretrained(
            args.model,
            revision=None if local_model else args.revision,
            local_files_only=local_model or not args.allow_download,
            trust_remote_code=False,
        )
        tokenizer.chat_template = template

        rows = 0
        raw_total = 0
        raw_supervised = 0
        kept_total = 0
        kept_supervised = 0
        truncated_rows = 0
        zero_supervision_rows = 0
        raw_lengths: list[int] = []
        kept_lengths: list[int] = []
        supervised_lengths: list[int] = []

        for line_number, raw_line in enumerate(args.dataset.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw_line.strip():
                continue
            row = json.loads(raw_line)
            messages = row.get("messages") if isinstance(row, dict) else None
            if not isinstance(messages, list) or not messages:
                raise ValueError(f"line {line_number}: messages must be a non-empty list")
            encoded = tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=False,
                return_assistant_tokens_mask=True,
                return_dict=True,
            )
            input_ids = _as_int_list(encoded.get("input_ids"), f"line {line_number} input_ids")
            mask = _as_int_list(encoded.get("assistant_masks"), f"line {line_number} assistant_masks")
            if len(input_ids) != len(mask):
                raise ValueError(f"line {line_number}: assistant mask length mismatch")
            supervised = sum(bool(flag) for flag in mask)
            if supervised == 0:
                zero_supervision_rows += 1
                raise ValueError(f"line {line_number}: zero assistant-supervised tokens")

            kept_ids = input_ids[:max_length]
            kept_mask = mask[:max_length]
            kept_sup = sum(bool(flag) for flag in kept_mask[1:])
            if kept_sup == 0:
                raise ValueError(
                    f"line {line_number}: truncation at max_length={max_length} leaves no shifted causal target"
                )

            rows += 1
            raw_len = len(input_ids)
            kept_len = len(kept_ids)
            raw_total += raw_len
            raw_supervised += supervised
            kept_total += kept_len
            kept_supervised += sum(bool(flag) for flag in kept_mask)
            truncated_rows += int(raw_len > max_length)
            raw_lengths.append(raw_len)
            kept_lengths.append(kept_len)
            supervised_lengths.append(sum(bool(flag) for flag in kept_mask))

        if rows == 0:
            raise ValueError("dataset contains no non-empty rows")

        result = {
            "schema_version": 1,
            "status": "PASS",
            "dataset": str(args.dataset),
            "dataset_sha256": file_sha256(args.dataset),
            "model": args.model,
            "requested_revision": None if local_model else args.revision,
            "config": str(args.config),
            "max_length": max_length,
            "rows": rows,
            "raw_tokens": raw_total,
            "raw_supervised_tokens": raw_supervised,
            "kept_tokens": kept_total,
            "kept_supervised_tokens": kept_supervised,
            "masked_kept_tokens": kept_total - kept_supervised,
            "truncated_rows": truncated_rows,
            "truncated_row_fraction": truncated_rows / rows,
            "zero_supervision_rows": zero_supervision_rows,
            "raw_length_p50": percentile(raw_lengths, 0.50),
            "raw_length_p95": percentile(raw_lengths, 0.95),
            "kept_length_p50": percentile(kept_lengths, 0.50),
            "kept_length_p95": percentile(kept_lengths, 0.95),
            "supervised_length_p50": percentile(supervised_lengths, 0.50),
            "supervised_length_p95": percentile(supervised_lengths, 0.95),
        }
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    rendered = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
