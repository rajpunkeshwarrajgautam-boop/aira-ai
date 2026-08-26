#!/usr/bin/env python3
"""Profile bounded Core source samples under the exact AIRA training tokenizer contract.

This is a non-training review operator. It streams exact pinned source revisions, normalizes
rows, applies the committed strict assistant-only Qwen3.5 training template with the exact
materialized Core tokenizer, and records truncation/supervision statistics. It emits no raw
source content and never changes source approvals.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

from audit_core_sources import iter_streaming_rows
from count_core_tokens import _as_int_list, _load_config, percentile
from prepare_core_dataset import DEFAULT_CATALOG, load_json, normalize_row, validate_catalog

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATERIALIZATION = ROOT / "model-lab/runs/materialized-core-base.json"
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/source-token-profile.json"
EXPECTED_REPO = "Qwen/Qwen3.5-9B-Base"
EXPECTED_REVISION = "68c46c4b3498877f3ef123c856ecfde50c39f404"


def _load_materialized_tokenizer_dir(path: Path) -> Path:
    evidence = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(evidence, dict) or evidence.get("status") != "MATERIALIZED":
        raise ValueError("Core base materialization evidence is missing/not MATERIALIZED")
    if evidence.get("repo_id") != EXPECTED_REPO:
        raise ValueError("unexpected materialized Core repo_id")
    if evidence.get("requested_revision") != EXPECTED_REVISION or evidence.get("resolved_revision") != EXPECTED_REVISION:
        raise ValueError("materialized tokenizer is not bound to the exact pinned Core revision")
    local_dir = Path(str(evidence.get("local_dir") or ""))
    if not local_dir.is_dir():
        raise FileNotFoundError(f"materialized Core directory is missing: {local_dir}")
    return local_dir


def _summarize_lengths(
    *,
    raw_lengths: list[int],
    raw_supervised: list[int],
    kept_supervised: list[int],
    max_length: int,
) -> dict[str, Any]:
    if not raw_lengths or len(raw_lengths) != len(raw_supervised) or len(raw_lengths) != len(kept_supervised):
        raise ValueError("token profile length vectors are empty/misaligned")
    rows = len(raw_lengths)
    truncated_rows = sum(length > max_length for length in raw_lengths)
    raw_tokens = sum(raw_lengths)
    kept_tokens = sum(min(length, max_length) for length in raw_lengths)
    raw_sup = sum(raw_supervised)
    kept_sup = sum(kept_supervised)
    dropped_sup = raw_sup - kept_sup
    return {
        "rows_profiled": rows,
        "max_length": max_length,
        "raw_tokens": raw_tokens,
        "kept_tokens": kept_tokens,
        "dropped_tokens": raw_tokens - kept_tokens,
        "raw_supervised_tokens": raw_sup,
        "kept_supervised_tokens": kept_sup,
        "dropped_supervised_tokens": dropped_sup,
        "supervised_retention_fraction": (kept_sup / raw_sup) if raw_sup else 0.0,
        "truncated_rows": truncated_rows,
        "truncated_row_fraction": truncated_rows / rows,
        "raw_length_p50": percentile(raw_lengths, 0.50),
        "raw_length_p95": percentile(raw_lengths, 0.95),
        "raw_length_max": max(raw_lengths),
        "raw_supervised_p50": percentile(raw_supervised, 0.50),
        "raw_supervised_p95": percentile(raw_supervised, 0.95),
        "kept_supervised_p50": percentile(kept_supervised, 0.50),
        "kept_supervised_p95": percentile(kept_supervised, 0.95),
    }


def profile_rows(
    *,
    source: dict[str, Any],
    rows: Iterable[tuple[str, dict[str, Any]]],
    tokenizer: Any,
    max_length: int,
    max_rows: int,
) -> dict[str, Any]:
    if max_rows <= 0:
        raise ValueError("max_rows must be positive")
    seen = 0
    normalized = 0
    rejected_schema = 0
    tokenization_errors = 0
    zero_supervision = 0
    zero_shifted_target_after_truncation = 0
    raw_lengths: list[int] = []
    raw_supervised: list[int] = []
    kept_supervised: list[int] = []

    for _split_name, row in rows:
        if seen >= max_rows:
            break
        seen += 1
        messages = normalize_row(row)
        if not messages:
            rejected_schema += 1
            continue
        normalized += 1
        try:
            encoded = tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=False,
                return_assistant_tokens_mask=True,
                return_dict=True,
            )
            input_ids = _as_int_list(encoded.get("input_ids"), "input_ids")
            mask = _as_int_list(encoded.get("assistant_masks"), "assistant_masks")
            if len(input_ids) != len(mask):
                raise ValueError("assistant mask length mismatch")
        except Exception:
            tokenization_errors += 1
            continue

        supervised = sum(bool(flag) for flag in mask)
        if supervised <= 0:
            zero_supervision += 1
            continue
        kept_mask = mask[:max_length]
        kept_sup = sum(bool(flag) for flag in kept_mask)
        if sum(bool(flag) for flag in kept_mask[1:]) <= 0:
            zero_shifted_target_after_truncation += 1

        raw_lengths.append(len(input_ids))
        raw_supervised.append(supervised)
        kept_supervised.append(kept_sup)

    if not raw_lengths:
        raise ValueError("no rows produced valid non-zero assistant supervision")
    summary = _summarize_lengths(
        raw_lengths=raw_lengths,
        raw_supervised=raw_supervised,
        kept_supervised=kept_supervised,
        max_length=max_length,
    )
    summary.update(
        {
            "source_id": source["id"],
            "repository": source["repository"],
            "revision": source["revision"],
            "audit_scope": "bounded_streaming_token_profile_only",
            "max_rows": max_rows,
            "seen": seen,
            "normalized": normalized,
            "rejected_schema": rejected_schema,
            "tokenization_errors": tokenization_errors,
            "zero_supervision_rows": zero_supervision,
            "zero_shifted_target_after_truncation": zero_shifted_target_after_truncation,
            "raw_content_emitted": False,
            "training_approval_changed": False,
        }
    )
    return summary


def self_test() -> dict[str, Any]:
    summary = _summarize_lengths(
        raw_lengths=[100, 3000, 2048],
        raw_supervised=[40, 2000, 1000],
        kept_supervised=[40, 1200, 1000],
        max_length=2048,
    )
    if summary["truncated_rows"] != 1:
        raise RuntimeError("token-profile self-test truncation count failed")
    if summary["dropped_tokens"] != 952 or summary["dropped_supervised_tokens"] != 800:
        raise RuntimeError("token-profile self-test dropped-token accounting failed")
    if not 0 < summary["supervised_retention_fraction"] < 1:
        raise RuntimeError("token-profile self-test retention fraction failed")
    return {
        "status": "PASS",
        "contract": "bounded-core-source-token-profile",
        "truncated_rows": summary["truncated_rows"],
        "dropped_tokens": summary["dropped_tokens"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--materialization", type=Path, default=DEFAULT_MATERIALIZATION)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--source", action="append", dest="source_ids")
    parser.add_argument("--max-rows", type=int, default=500)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0
    if args.max_rows <= 0:
        raise SystemExit("--max-rows must be positive")

    try:
        catalog = load_json(args.catalog)
        if not isinstance(catalog, dict):
            raise ValueError("catalog root must be an object")
        errors = validate_catalog(catalog)
        if errors:
            raise ValueError("invalid catalog: " + "; ".join(errors))
        local_dir = _load_materialized_tokenizer_dir(args.materialization)
        template, max_length = _load_config(args.config)

        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            str(local_dir),
            local_files_only=True,
            trust_remote_code=False,
        )
        tokenizer.chat_template = template

        sources: list[dict[str, Any]] = catalog["sources"]
        requested = set(args.source_ids or [])
        selected = [source for source in sources if not requested or source["id"] in requested]
        if requested:
            missing = sorted(requested - {source["id"] for source in selected})
            if missing:
                raise ValueError(f"unknown source ids: {missing}")

        reports: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        for source in selected:
            try:
                reports.append(
                    profile_rows(
                        source=source,
                        rows=iter_streaming_rows(source),
                        tokenizer=tokenizer,
                        max_length=max_length,
                        max_rows=args.max_rows,
                    )
                )
            except Exception as exc:
                failures.append({"source_id": source["id"], "error": str(exc)})

        result = {
            "schema_version": 1,
            "status": "PASS" if not failures else "PARTIAL",
            "purpose": "bounded tokenizer/truncation review evidence",
            "tokenizer_repo": EXPECTED_REPO,
            "tokenizer_revision": EXPECTED_REVISION,
            "max_length": max_length,
            "reports": reports,
            "failures": failures,
            "raw_content_emitted": False,
            "training_approval_changed": False,
            "limitations": [
                "bounded samples do not prove full-corpus token-length distribution",
                "right truncation statistics describe the committed 2048-token recipe only",
                "this operator does not approve sources or build training data",
            ],
        }
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    args.output.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(result, indent=2, sort_keys=True)
    args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if result["status"] == "PASS" else 3


if __name__ == "__main__":
    raise SystemExit(main())
