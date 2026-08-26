#!/usr/bin/env python3
"""Bounded, non-training audit for exact pinned AIRA Core source revisions.

This operator is deliberately separate from prepare_core_dataset.py. It may inspect sources
that are still blocked for training, but it never flips approvals, writes training splits,
or emits raw prompts. It streams only a bounded sample and records hashes/statistics.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from prepare_core_dataset import (
    DEFAULT_CATALOG,
    canonical_text,
    contains_secret,
    first_user_prompt,
    frozen_prompt_hashes,
    load_json,
    normalize_row,
    sha256_text,
    validate_catalog,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/source-audit.json"


def iter_streaming_rows(source: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    from datasets import load_dataset

    repository = source["repository"]
    revision = source["revision"]
    config = source.get("config")
    split = source.get("split")
    args = (repository, config) if config else (repository,)
    kwargs: dict[str, Any] = {"revision": revision, "streaming": True}

    if split == "all_configured_splits":
        dataset = load_dataset(*args, **kwargs)
        if not hasattr(dataset, "items"):
            raise RuntimeError(f"{source['id']} expected a split mapping")
        for split_name, split_dataset in sorted(dataset.items()):
            for row in split_dataset:
                yield split_name, dict(row)
        return

    split_name = split or "train"
    dataset = load_dataset(*args, split=split_name, **kwargs)
    for row in dataset:
        yield split_name, dict(row)


def audit_rows(source: dict[str, Any], rows: Iterable[tuple[str, dict[str, Any]]], max_rows: int) -> dict[str, Any]:
    if max_rows <= 0:
        raise ValueError("max_rows must be positive")

    eval_hashes = frozen_prompt_hashes()
    counts: Counter[str] = Counter()
    roles: Counter[str] = Counter()
    seen_rows: set[str] = set()
    sample_row_hashes: list[str] = []
    sample_prompt_hashes: list[str] = []
    message_chars: list[int] = []

    for split_name, row in rows:
        if counts["seen"] >= max_rows:
            break
        counts["seen"] += 1
        counts[f"split_{split_name}"] += 1

        messages = normalize_row(row)
        if not messages:
            counts["rejected_schema"] += 1
            continue
        counts["normalized"] += 1
        for message in messages:
            roles[message["role"]] += 1
        message_chars.append(sum(len(message["content"]) for message in messages))

        if contains_secret(messages):
            counts["high_confidence_secret_hit"] += 1

        prompt = canonical_text(first_user_prompt(messages))
        prompt_hash = sha256_text(prompt)
        if prompt_hash in eval_hashes:
            counts["frozen_eval_exact_prompt_overlap"] += 1

        canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row_hash = sha256_text(canonical)
        if row_hash in seen_rows:
            counts["exact_duplicate"] += 1
        else:
            seen_rows.add(row_hash)

        if len(sample_row_hashes) < 20:
            sample_row_hashes.append(row_hash)
            sample_prompt_hashes.append(prompt_hash)

    normalized = counts["normalized"]
    return {
        "source_id": source["id"],
        "repository": source["repository"],
        "revision": source["revision"],
        "declared_license": source.get("license"),
        "approved_for_training_before_audit": source.get("approved_for_training") is True,
        "audit_scope": "bounded_streaming_sample_only",
        "max_rows": max_rows,
        "counts": dict(sorted(counts.items())),
        "roles": dict(sorted(roles.items())),
        "message_chars": {
            "mean": round(sum(message_chars) / len(message_chars), 2) if message_chars else 0.0,
            "max": max(message_chars) if message_chars else 0,
        },
        "normalization_rate": (normalized / counts["seen"]) if counts["seen"] else 0.0,
        "sample_row_hashes": sample_row_hashes,
        "sample_prompt_hashes": sample_prompt_hashes,
        "raw_content_emitted": False,
        "training_approval_changed": False,
    }


def self_test() -> dict[str, Any]:
    source = {
        "id": "self-test",
        "repository": "example/self-test",
        "revision": "a" * 40,
        "license": "apache-2.0",
        "approved_for_training": False,
    }
    rows = [
        ("train", {"messages": [
            {"role": "user", "content": "Alpha request"},
            {"role": "assistant", "content": "Alpha response"},
        ]}),
        ("train", {"messages": [
            {"role": "user", "content": "Alpha request"},
            {"role": "assistant", "content": "Alpha response"},
        ]}),
        ("train", {"garbage": True}),
    ]
    report = audit_rows(source, rows, max_rows=3)
    counts = report["counts"]
    if counts.get("seen") != 3 or counts.get("normalized") != 2:
        raise RuntimeError("bounded audit self-test counts are wrong")
    if counts.get("exact_duplicate") != 1:
        raise RuntimeError("bounded audit self-test did not detect exact duplicate")
    if report.get("training_approval_changed") is not False or report.get("raw_content_emitted") is not False:
        raise RuntimeError("bounded audit violated fail-closed evidence policy")
    return {"status": "PASS", "contract": "bounded-core-source-audit"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
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

    catalog = load_json(args.catalog)
    if not isinstance(catalog, dict):
        raise SystemExit("catalog root must be an object")
    errors = validate_catalog(catalog)
    if errors:
        raise SystemExit("invalid catalog: " + "; ".join(errors))

    sources: list[dict[str, Any]] = catalog["sources"]
    requested = set(args.source_ids or [])
    selected = [source for source in sources if not requested or source["id"] in requested]
    if requested:
        missing = sorted(requested - {source["id"] for source in selected})
        if missing:
            raise SystemExit(f"unknown source ids: {missing}")

    reports: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for source in selected:
        try:
            reports.append(audit_rows(source, iter_streaming_rows(source), args.max_rows))
        except Exception as exc:
            failures.append({"source_id": source["id"], "error": str(exc)})

    result = {
        "schema_version": 1,
        "status": "PASS" if not failures else "PARTIAL",
        "purpose": "bounded non-training review evidence",
        "sources_requested": [source["id"] for source in selected],
        "sources_audited": [report["source_id"] for report in reports],
        "failures": failures,
        "reports": reports,
        "training_approval_changed": False,
        "limitations": [
            "bounded samples do not prove full-corpus cleanliness",
            "exact frozen-eval overlap does not detect paraphrased/semantic contamination",
            "license/provenance decisions require human review of source documentation",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not failures else 3


if __name__ == "__main__":
    raise SystemExit(main())
