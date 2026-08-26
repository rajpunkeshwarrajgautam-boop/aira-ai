#!/usr/bin/env python3
"""Bounded/full non-training audit for exact pinned AIRA Core source revisions.

This operator is deliberately separate from prepare_core_dataset.py. It may inspect sources
that are still blocked for training, but it never flips approvals, writes training splits,
or emits raw prompts. Reports use redacted hashes/statistics only.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from prepare_core_dataset import (
    DEFAULT_CATALOG,
    SECRET_PATTERNS,
    canonical_text,
    first_user_prompt,
    frozen_prompt_hashes,
    load_json,
    normalize_row,
    sha256_text,
    validate_catalog,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/source-audit.json"
SECRET_PATTERN_NAMES = [
    "openai_style_token",
    "nvidia_api_token",
    "github_token",
    "private_key_header",
    "generic_secret_assignment",
]
MAX_SECRET_EVIDENCE = 20


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


def _secret_evidence(messages: list[dict[str, str]], row_hash: str) -> list[dict[str, Any]]:
    """Return redacted evidence for matched secret patterns without emitting matched text."""
    evidence: list[dict[str, Any]] = []
    for message_index, message in enumerate(messages):
        content = message["content"]
        for pattern_index, pattern in enumerate(SECRET_PATTERNS):
            for match in pattern.finditer(content):
                matched = match.group(0)
                evidence.append(
                    {
                        "row_sha256": row_hash,
                        "message_index": message_index,
                        "role": message["role"],
                        "pattern": SECRET_PATTERN_NAMES[pattern_index],
                        "match_sha256": sha256_text(matched),
                        "match_length": len(matched),
                    }
                )
                if len(evidence) >= MAX_SECRET_EVIDENCE:
                    return evidence
    return evidence


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
    secret_hits: list[dict[str, Any]] = []

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

        canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row_hash = sha256_text(canonical)
        row_secret_hits = _secret_evidence(messages, row_hash)
        if row_secret_hits:
            counts["high_confidence_secret_hit"] += 1
            secret_hits.extend(row_secret_hits[: max(0, MAX_SECRET_EVIDENCE - len(secret_hits))])

        prompt = canonical_text(first_user_prompt(messages))
        prompt_hash = sha256_text(prompt)
        if prompt_hash in eval_hashes:
            counts["frozen_eval_exact_prompt_overlap"] += 1

        if row_hash in seen_rows:
            counts["exact_duplicate"] += 1
        else:
            seen_rows.add(row_hash)

        if len(sample_row_hashes) < 20:
            sample_row_hashes.append(row_hash)
            sample_prompt_hashes.append(prompt_hash)

    normalized = counts["normalized"]
    declared_examples = source.get("declared_examples")
    if isinstance(declared_examples, bool) or not isinstance(declared_examples, int) or declared_examples <= 0:
        declared_examples = None
    seen = counts["seen"]
    full_declared_coverage = declared_examples is not None and seen >= declared_examples
    coverage_fraction = min(1.0, seen / declared_examples) if declared_examples else None

    return {
        "source_id": source["id"],
        "repository": source["repository"],
        "revision": source["revision"],
        "declared_license": source.get("license"),
        "declared_examples": declared_examples,
        "approved_for_training_before_audit": source.get("approved_for_training") is True,
        "audit_scope": "full_declared_source" if full_declared_coverage else "bounded_streaming_sample_only",
        "max_rows": max_rows,
        "counts": dict(sorted(counts.items())),
        "roles": dict(sorted(roles.items())),
        "message_chars": {
            "mean": round(sum(message_chars) / len(message_chars), 2) if message_chars else 0.0,
            "max": max(message_chars) if message_chars else 0,
        },
        "normalization_rate": (normalized / seen) if seen else 0.0,
        "declared_coverage_fraction": coverage_fraction,
        "full_declared_coverage": full_declared_coverage,
        "secret_hit_evidence": secret_hits,
        "secret_hit_evidence_truncated": counts.get("high_confidence_secret_hit", 0) > len(secret_hits),
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
        "declared_examples": 4,
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
        ("train", {"messages": [
            {"role": "user", "content": "Use api_key=ABCDEFGHIJKLMNOPQRSTUVWX for this synthetic example"},
            {"role": "assistant", "content": "Acknowledged"},
        ]}),
        ("train", {"garbage": True}),
    ]
    report = audit_rows(source, rows, max_rows=10)
    counts = report["counts"]
    if counts.get("seen") != 4 or counts.get("normalized") != 3:
        raise RuntimeError("source audit self-test counts are wrong")
    if counts.get("exact_duplicate") != 1:
        raise RuntimeError("source audit self-test did not detect exact duplicate")
    if counts.get("high_confidence_secret_hit") != 1:
        raise RuntimeError("source audit self-test did not detect secret-like row")
    hits = report.get("secret_hit_evidence")
    if not isinstance(hits, list) or not hits or hits[0].get("pattern") != "generic_secret_assignment":
        raise RuntimeError("source audit self-test did not classify redacted secret evidence")
    if report.get("full_declared_coverage") is not True or report.get("audit_scope") != "full_declared_source":
        raise RuntimeError("source audit self-test did not prove full declared coverage")
    rendered = json.dumps(report)
    if "ABCDEFGHIJKLMNOPQRSTUVWX" in rendered:
        raise RuntimeError("source audit leaked matched secret text")
    if report.get("training_approval_changed") is not False or report.get("raw_content_emitted") is not False:
        raise RuntimeError("source audit violated fail-closed evidence policy")
    return {
        "status": "PASS",
        "contract": "bounded-core-source-audit",
        "redacted_secret_evidence": True,
        "full_declared_coverage": True,
    }


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
        "schema_version": 3,
        "status": "PASS" if not failures else "PARTIAL",
        "purpose": "non-training source review evidence",
        "sources_requested": [source["id"] for source in selected],
        "sources_audited": [report["source_id"] for report in reports],
        "failures": failures,
        "reports": reports,
        "training_approval_changed": False,
        "limitations": [
            "declared-example coverage is bound to the catalog's pinned declared_examples value",
            "exact frozen-eval overlap does not detect all paraphrased/semantic contamination",
            "secret evidence is deliberately redacted and matched rows require filtering before approval",
            "license/provenance decisions require review of source documentation",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not failures else 3


if __name__ == "__main__":
    raise SystemExit(main())
