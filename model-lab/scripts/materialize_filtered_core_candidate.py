#!/usr/bin/env python3
"""Materialize a fail-closed filtered Core source candidate for review only.

This operator is deliberately NOT the production dataset builder. It may materialize only
catalog entries marked ``core_v0_decision=candidate_filtered`` while they remain
``approved_for_training=false``. It applies the same high-confidence secret, exact duplicate,
and frozen-eval exact-prompt filters used by the real builder, writes one review JSONL, and
records evidence. It never changes source approval or emits rejected raw content.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from prepare_core_dataset import (
    DEFAULT_CATALOG,
    OUTPUT_DIR,
    canonical_text,
    contains_secret,
    file_sha256,
    first_user_prompt,
    frozen_prompt_hashes,
    load_json,
    normalize_row,
    sha256_text,
    validate_catalog,
)
from audit_core_sources import iter_streaming_rows

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = OUTPUT_DIR / "review-candidate.jsonl"
DEFAULT_EVIDENCE = OUTPUT_DIR / "review-candidate-evidence.json"


def filter_rows(
    *,
    source: dict[str, Any],
    rows: Iterable[tuple[str, dict[str, Any]]],
    frozen_hashes: set[str],
    max_rows: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if source.get("core_v0_decision") != "candidate_filtered":
        raise ValueError("source must be core_v0_decision=candidate_filtered")
    if source.get("approved_for_training") is True:
        raise ValueError("review candidate operator refuses already-approved sources")

    declared = source.get("declared_examples")
    if not isinstance(declared, int) or isinstance(declared, bool) or declared <= 0:
        raise ValueError("candidate_filtered source requires positive declared_examples")
    if max_rows is not None and max_rows <= 0:
        raise ValueError("max_rows must be positive when supplied")

    counts: Counter[str] = Counter()
    seen_rows: set[str] = set()
    accepted: list[dict[str, Any]] = []

    for split_name, row in rows:
        if max_rows is not None and counts["seen"] >= max_rows:
            break
        counts["seen"] += 1
        counts[f"split_{split_name}"] += 1
        messages = normalize_row(row)
        if not messages:
            counts["rejected_schema"] += 1
            continue
        counts["normalized"] += 1

        if contains_secret(messages):
            counts["rejected_secret"] += 1
            continue

        prompt = canonical_text(first_user_prompt(messages))
        prompt_hash = sha256_text(prompt)
        if prompt_hash in frozen_hashes:
            counts["rejected_frozen_eval_exact"] += 1
            continue

        canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row_hash = sha256_text(canonical)
        if row_hash in seen_rows:
            counts["rejected_exact_duplicate"] += 1
            continue
        seen_rows.add(row_hash)

        accepted.append(
            {
                "messages": messages,
                "source_id": source["id"],
                "source_repository": source["repository"],
                "source_revision": source["revision"],
                "row_hash": row_hash,
                "prompt_hash": prompt_hash,
            }
        )
        counts["accepted"] += 1

    if max_rows is None or max_rows >= declared:
        if counts["seen"] != declared:
            raise ValueError(f"full candidate materialization expected {declared} rows, saw {counts['seen']}")
        counts["full_declared_coverage"] = 1
    else:
        counts["full_declared_coverage"] = 0

    accepted.sort(key=lambda item: item["row_hash"])
    return accepted, dict(sorted(counts.items()))


def self_test() -> dict[str, Any]:
    source = {
        "id": "self-test",
        "repository": "example/self-test",
        "revision": "a" * 40,
        "declared_examples": 4,
        "core_v0_decision": "candidate_filtered",
        "approved_for_training": False,
    }
    clean = {"messages": [{"role": "user", "content": "alpha"}, {"role": "assistant", "content": "one"}]}
    rows = [
        ("train", clean),
        ("train", clean),
        ("train", {"messages": [{"role": "user", "content": "beta"}, {"role": "assistant", "content": "api_key=ABCDEFGHIJKLMNOPQRSTUVWX"}]}),
        ("train", {"messages": [{"role": "user", "content": "frozen prompt"}, {"role": "assistant", "content": "three"}]}),
    ]
    frozen = {sha256_text(canonical_text("frozen prompt"))}
    accepted, counts = filter_rows(source=source, rows=rows, frozen_hashes=frozen)
    if len(accepted) != 1:
        raise RuntimeError("filtered candidate self-test accepted wrong number of rows")
    expected = {"accepted": 1, "rejected_exact_duplicate": 1, "rejected_secret": 1, "rejected_frozen_eval_exact": 1}
    for key, value in expected.items():
        if counts.get(key) != value:
            raise RuntimeError(f"filtered candidate self-test {key}={counts.get(key)!r}, expected {value}")
    if counts.get("full_declared_coverage") != 1:
        raise RuntimeError("filtered candidate self-test did not prove declared coverage")
    return {"status": "PASS", "contract": "filtered-core-review-candidate", "filters_fail_closed": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source", required=False)
    parser.add_argument("--max-rows", type=int)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0
    if not args.source:
        parser.error("--source is required unless --self-test is used")

    try:
        catalog = load_json(args.catalog)
        if not isinstance(catalog, dict):
            raise ValueError("catalog root must be an object")
        errors = validate_catalog(catalog)
        if errors:
            raise ValueError("invalid catalog: " + "; ".join(errors))
        selected = [source for source in catalog["sources"] if source.get("id") == args.source]
        if len(selected) != 1:
            raise ValueError(f"unknown/ambiguous source id: {args.source}")
        source = selected[0]
        accepted, counts = filter_rows(
            source=source,
            rows=iter_streaming_rows(source),
            frozen_hashes=frozen_prompt_hashes(),
            max_rows=args.max_rows,
        )

        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8", newline="\n") as handle:
            for row in accepted:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

        evidence = {
            "schema_version": 1,
            "status": "MATERIALIZED_REVIEW_ONLY",
            "source_id": source["id"],
            "repository": source["repository"],
            "revision": source["revision"],
            "declared_examples": source["declared_examples"],
            "core_v0_decision": source.get("core_v0_decision"),
            "approved_for_training": False,
            "counts": counts,
            "output": str(args.output.relative_to(ROOT)) if args.output.is_relative_to(ROOT) else str(args.output),
            "output_sha256": file_sha256(args.output),
            "raw_rejected_content_emitted": False,
            "filters": ["high_confidence_secret", "exact_duplicate", "frozen_eval_exact_prompt_overlap"],
            "next_gate": "exact_and_near_overlap_contamination_check",
        }
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
