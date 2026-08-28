#!/usr/bin/env python3
"""Diagnostic-only token survival scan for an already materialized Core JSONL dataset.

Unlike count_core_tokens.py, this operator never authorizes training and does not fail on the
first row whose 2048-token right truncation removes every shifted assistant target. It scans
the complete file and reports aggregate failure counts/hashes so representation fixes can be
measured before rerunning the strict counter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from count_core_tokens import _as_int_list, _load_config, file_sha256, percentile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"
MAX_HASH_EVIDENCE = 20


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _self_test() -> dict[str, Any]:
    # Contract-only self-test: diagnostic evidence is hash-only and never a PASS authorization.
    sample = {"line": 9, "reason": "zero_shifted_target_after_truncation"}
    rendered = json.dumps(sample, sort_keys=True)
    digest = sha256_text(rendered)
    if len(digest) != 64:
        raise RuntimeError("diagnostic hash contract failed")
    return {
        "status": "PASS",
        "contract": "core-token-failure-diagnostic",
        "training_authorization": False,
        "hash_only_failure_evidence": True,
    }


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
        kept_total = 0
        raw_supervised = 0
        kept_supervised = 0
        truncated_rows = 0
        zero_supervision_rows = 0
        zero_shifted_target_rows = 0
        tokenization_errors = 0
        raw_lengths: list[int] = []
        kept_lengths: list[int] = []
        supervised_lengths: list[int] = []
        first_assistant_offsets: list[int] = []
        failure_hashes: list[dict[str, Any]] = []

        for line_number, raw_line in enumerate(args.dataset.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw_line.strip():
                continue
            rows += 1
            try:
                row = json.loads(raw_line)
                messages = row.get("messages") if isinstance(row, dict) else None
                if not isinstance(messages, list) or not messages:
                    raise ValueError("messages must be a non-empty list")
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
                    raise ValueError("assistant mask length mismatch")
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                tokenization_errors += 1
                if len(failure_hashes) < MAX_HASH_EVIDENCE:
                    failure_hashes.append({
                        "line": line_number,
                        "reason": "tokenization_or_schema_error",
                        "row_sha256": sha256_text(raw_line),
                        "error_sha256": sha256_text(str(exc)),
                    })
                continue

            supervised = sum(bool(flag) for flag in mask)
            if supervised == 0:
                zero_supervision_rows += 1
                if len(failure_hashes) < MAX_HASH_EVIDENCE:
                    failure_hashes.append({
                        "line": line_number,
                        "reason": "zero_supervision_before_truncation",
                        "row_sha256": sha256_text(raw_line),
                    })
                continue

            first_assistant = next((index for index, flag in enumerate(mask) if flag), len(mask))
            first_assistant_offsets.append(first_assistant)
            kept_ids = input_ids[:max_length]
            kept_mask = mask[:max_length]
            kept_sup = sum(bool(flag) for flag in kept_mask)
            shifted_kept_sup = sum(bool(flag) for flag in kept_mask[1:])
            if shifted_kept_sup == 0:
                zero_shifted_target_rows += 1
                if len(failure_hashes) < MAX_HASH_EVIDENCE:
                    failure_hashes.append({
                        "line": line_number,
                        "reason": "zero_shifted_target_after_truncation",
                        "row_sha256": sha256_text(raw_line),
                        "raw_tokens": len(input_ids),
                        "first_assistant_token_offset": first_assistant,
                    })

            raw_len = len(input_ids)
            kept_len = len(kept_ids)
            raw_total += raw_len
            kept_total += kept_len
            raw_supervised += supervised
            kept_supervised += kept_sup
            truncated_rows += int(raw_len > max_length)
            raw_lengths.append(raw_len)
            kept_lengths.append(kept_len)
            supervised_lengths.append(kept_sup)

        if rows == 0:
            raise ValueError("dataset contains no non-empty rows")

        result = {
            "schema_version": 1,
            "status": "RECORDED_DIAGNOSTIC",
            "training_authorization": False,
            "dataset": str(args.dataset),
            "dataset_sha256": file_sha256(args.dataset),
            "model": args.model,
            "requested_revision": None if local_model else args.revision,
            "config": str(args.config),
            "max_length": max_length,
            "rows": rows,
            "raw_tokens": raw_total,
            "kept_tokens": kept_total,
            "raw_supervised_tokens": raw_supervised,
            "kept_supervised_tokens": kept_supervised,
            "supervised_retention_fraction": (kept_supervised / raw_supervised) if raw_supervised else 0.0,
            "truncated_rows": truncated_rows,
            "truncated_row_fraction": truncated_rows / rows,
            "zero_supervision_rows": zero_supervision_rows,
            "zero_shifted_target_after_truncation": zero_shifted_target_rows,
            "zero_shifted_target_fraction": zero_shifted_target_rows / rows,
            "tokenization_errors": tokenization_errors,
            "raw_length_p50": percentile(raw_lengths, 0.50),
            "raw_length_p95": percentile(raw_lengths, 0.95),
            "kept_length_p50": percentile(kept_lengths, 0.50),
            "kept_length_p95": percentile(kept_lengths, 0.95),
            "supervised_length_p50": percentile(supervised_lengths, 0.50),
            "supervised_length_p95": percentile(supervised_lengths, 0.95),
            "first_assistant_token_offset_p50": percentile(first_assistant_offsets, 0.50),
            "first_assistant_token_offset_p95": percentile(first_assistant_offsets, 0.95),
            "failure_evidence": failure_hashes,
            "failure_evidence_truncated": (zero_supervision_rows + zero_shifted_target_rows + tokenization_errors) > len(failure_hashes),
            "raw_content_emitted": False,
            "next_gate": "tool_schema_compaction_and_tool_call_normalization",
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
