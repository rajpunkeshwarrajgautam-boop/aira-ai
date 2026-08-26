#!/usr/bin/env python3
"""Freeze an AIRA Core build only after exact split hashes, contamination and train token evidence pass."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BUILD = ROOT / "model-lab/data/core-v0/build-evidence.json"
DEFAULT_TOKENS = ROOT / "model-lab/data/core-v0/train-tokens.json"
DEFAULT_AGGREGATE = ROOT / "model-lab/data/core-v0/contamination-report.json"
DEFAULT_FREEZE = ROOT / "model-lab/data/core-v0/frozen-build-evidence.json"
SPLITS = ("train", "validation", "holdout")


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} root must be an object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(
    *,
    build: dict[str, Any],
    token_report: dict[str, Any],
    reports: dict[str, dict[str, Any]],
    root: Path = ROOT,
) -> tuple[dict[str, Any], dict[str, Any]]:
    outputs = build.get("outputs")
    if not isinstance(outputs, dict):
        raise RuntimeError("build evidence outputs must be an object")

    total_examples = 0
    total_scanned = 0
    split_evidence: dict[str, Any] = {}
    methods: set[str] = set()
    thresholds: set[float] = set()

    for split in SPLITS:
        entry = outputs.get(split)
        if not isinstance(entry, dict):
            raise RuntimeError(f"build evidence missing split {split}")
        path_value = entry.get("path")
        expected_hash = entry.get("sha256")
        examples = entry.get("examples")
        if not isinstance(path_value, str) or not isinstance(expected_hash, str) or not isinstance(examples, int):
            raise RuntimeError(f"invalid build evidence for split {split}")
        path = (root / path_value).resolve()
        if not path.is_file():
            raise RuntimeError(f"missing split file: {path}")
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise RuntimeError(f"{split} sha256 mismatch: expected {expected_hash}, got {actual_hash}")

        report = reports[split]
        if report.get("status") != "PASS":
            raise RuntimeError(f"{split} contamination status is not PASS")
        if report.get("exact_overlap_count") != 0 or report.get("semantic_overlap_count") != 0:
            raise RuntimeError(f"{split} contamination report contains overlaps")
        if report.get("training_prompts_scanned") != examples:
            raise RuntimeError(f"{split} contamination scan count does not match build examples")
        method = report.get("method")
        threshold = report.get("semantic_threshold")
        if isinstance(method, str):
            methods.add(method)
        if isinstance(threshold, (int, float)):
            thresholds.add(float(threshold))

        total_examples += examples
        total_scanned += examples
        split_evidence[split] = {
            "examples": examples,
            "sha256": expected_hash,
            "contamination_status": "PASS",
            "exact_overlap_count": 0,
            "semantic_overlap_count": 0,
        }

    if total_examples != build.get("total_examples"):
        raise RuntimeError("split example counts do not sum to build total_examples")
    if len(methods) > 1 or len(thresholds) > 1:
        raise RuntimeError("split contamination reports disagree on method or threshold")

    train = outputs["train"]
    if token_report.get("status") != "PASS":
        raise RuntimeError("train token report status is not PASS")
    if token_report.get("dataset_sha256") != train.get("sha256"):
        raise RuntimeError("train token report dataset_sha256 does not match frozen train split")
    if token_report.get("rows") != train.get("examples"):
        raise RuntimeError("train token report row count does not match frozen train split")
    if token_report.get("zero_supervision_rows") != 0:
        raise RuntimeError("train token report contains zero-supervision rows")
    kept_tokens = token_report.get("kept_tokens")
    kept_supervised = token_report.get("kept_supervised_tokens")
    if not isinstance(kept_tokens, int) or kept_tokens <= 0:
        raise RuntimeError("train token report kept_tokens must be positive")
    if not isinstance(kept_supervised, int) or kept_supervised <= 0:
        raise RuntimeError("train token report kept_supervised_tokens must be positive")

    method = next(iter(methods), "normalized exact hash + indexed word-trigram Jaccard")
    threshold = next(iter(thresholds), 0.85)
    aggregate = {
        "schema_version": 1,
        "status": "PASS",
        "method": method,
        "semantic_threshold": threshold,
        "exact_overlap_count": 0,
        "semantic_overlap_count": 0,
        "training_prompts_scanned": total_scanned,
        "splits": split_evidence,
    }
    frozen = {
        "schema_version": 1,
        "status": "FROZEN_READY_FOR_MANIFEST_PROPOSAL",
        "build_evidence_sha256": None,
        "catalog_sha256": build.get("catalog_sha256"),
        "frozen_eval_sha256": build.get("frozen_eval_sha256"),
        "total_examples": total_examples,
        "splits": split_evidence,
        "train_token_accounting": {
            "dataset_sha256": token_report.get("dataset_sha256"),
            "raw_tokens": token_report.get("raw_tokens"),
            "kept_tokens": kept_tokens,
            "raw_supervised_tokens": token_report.get("raw_supervised_tokens"),
            "kept_supervised_tokens": kept_supervised,
            "truncated_rows": token_report.get("truncated_rows"),
            "truncated_row_fraction": token_report.get("truncated_row_fraction"),
            "zero_supervision_rows": 0,
        },
        "manifest_token_count": kept_tokens,
        "training_execution": "NOT_STARTED",
    }
    return aggregate, frozen


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        outputs: dict[str, Any] = {}
        reports: dict[str, dict[str, Any]] = {}
        total = 0
        for idx, split in enumerate(SPLITS, start=1):
            path = root / f"{split}.jsonl"
            path.write_text("{}\n" * idx, encoding="utf-8")
            outputs[split] = {"path": path.name, "examples": idx, "sha256": sha256_file(path)}
            reports[split] = {
                "status": "PASS",
                "exact_overlap_count": 0,
                "semantic_overlap_count": 0,
                "training_prompts_scanned": idx,
                "method": "fixture",
                "semantic_threshold": 0.85,
            }
            total += idx
        build = {"outputs": outputs, "total_examples": total, "catalog_sha256": "a" * 64, "frozen_eval_sha256": "b" * 64}
        tokens = {
            "status": "PASS",
            "dataset_sha256": outputs["train"]["sha256"],
            "rows": outputs["train"]["examples"],
            "raw_tokens": 10,
            "kept_tokens": 9,
            "raw_supervised_tokens": 5,
            "kept_supervised_tokens": 4,
            "truncated_rows": 0,
            "truncated_row_fraction": 0.0,
            "zero_supervision_rows": 0,
        }
        aggregate, frozen = verify(build=build, token_report=tokens, reports=reports, root=root)
        if aggregate["status"] != "PASS" or frozen["manifest_token_count"] != 9:
            raise RuntimeError("freeze Core build self-test failed")
    return {
        "status": "PASS",
        "contract": "frozen-core-build",
        "exact_split_hashes_required": True,
        "all_split_contamination_required": True,
        "train_token_hash_binding_required": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-evidence", type=Path, default=DEFAULT_BUILD)
    parser.add_argument("--train-token-report", type=Path, default=DEFAULT_TOKENS)
    parser.add_argument("--contamination-dir", type=Path, default=ROOT / "model-lab/data/core-v0")
    parser.add_argument("--aggregate-output", type=Path, default=DEFAULT_AGGREGATE)
    parser.add_argument("--freeze-output", type=Path, default=DEFAULT_FREEZE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0

    try:
        build = load(args.build_evidence)
        tokens = load(args.train_token_report)
        reports = {split: load(args.contamination_dir / f"{split}-contamination.json") for split in SPLITS}
        aggregate, frozen = verify(build=build, token_report=tokens, reports=reports)
        frozen["build_evidence_sha256"] = sha256_file(args.build_evidence)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as exc:
        print(json.dumps({"status": "BLOCKED", "blockers": [str(exc)]}, indent=2, sort_keys=True))
        return 2

    args.aggregate_output.parent.mkdir(parents=True, exist_ok=True)
    args.aggregate_output.write_text(json.dumps(aggregate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.freeze_output.write_text(json.dumps(frozen, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "aggregate_contamination": str(args.aggregate_output),
        "frozen_build": str(args.freeze_output),
        "example_count": frozen["total_examples"],
        "manifest_token_count": frozen["manifest_token_count"],
        "next_gate": "core_manifest_proposal",
        "training_execution": "NOT_STARTED",
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
