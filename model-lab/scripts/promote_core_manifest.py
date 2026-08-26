#!/usr/bin/env python3
"""Create a reviewable AIRA Core training-manifest proposal only when evidence passes.

This script never edits the committed manifest in place. It emits a proposed manifest under
ignored model-lab/data/core-v0/ after source approvals, build hashes/counts, contamination
results and an explicit tokenizer-derived token count all pass.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "model-lab/data/sources/core-v0-candidates.json"
DEFAULT_BUILD = ROOT / "model-lab/data/core-v0/build-evidence.json"
DEFAULT_CONTAMINATION = ROOT / "model-lab/data/core-v0/contamination-report.json"
DEFAULT_MANIFEST = ROOT / "model-lab/data/manifests/core-v0.json"
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/core-v0.promoted-manifest.json"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} root must be an object")
    return value


def collect_blockers(
    *,
    catalog: dict[str, Any],
    build: dict[str, Any],
    contamination: dict[str, Any],
    manifest: dict[str, Any],
    token_count: int,
) -> list[str]:
    blockers: list[str] = []
    if manifest.get("id") != "aira-core-v0":
        blockers.append("committed manifest id must be aira-core-v0")
    if manifest.get("private_data") is not False:
        blockers.append("private_data must remain false")
    if manifest.get("training_allowed") is not False:
        blockers.append("committed pre-promotion manifest must still be fail-closed")
    if token_count <= 0:
        blockers.append("token_count must be a positive tokenizer-derived count")

    sources = catalog.get("sources")
    if not isinstance(sources, list) or not sources:
        blockers.append("source catalog is empty")
        return blockers
    by_id = {source.get("id"): source for source in sources if isinstance(source, dict) and isinstance(source.get("id"), str)}

    source_revisions = build.get("source_revisions")
    if not isinstance(source_revisions, dict) or not source_revisions:
        blockers.append("build evidence must contain non-empty source_revisions")
    else:
        for source_id, revision in sorted(source_revisions.items()):
            source = by_id.get(source_id)
            if not isinstance(source, dict):
                blockers.append(f"build source {source_id!r} is absent from catalog")
                continue
            if source.get("approved_for_training") is not True:
                blockers.append(f"source {source_id!r} is not approved_for_training")
            for review in ("license_review", "provenance_review", "contamination_review"):
                if source.get(review) != "approved":
                    blockers.append(f"source {source_id!r} requires {review}=approved")
            catalog_revision = source.get("revision")
            if not isinstance(catalog_revision, str) or not SHA40.fullmatch(catalog_revision):
                blockers.append(f"source {source_id!r} lacks an exact catalog revision")
            if revision != catalog_revision:
                blockers.append(f"source {source_id!r} build revision does not match catalog")

    total_examples = build.get("total_examples")
    if not isinstance(total_examples, int) or total_examples <= 0:
        blockers.append("build evidence total_examples must be positive")
    outputs = build.get("outputs")
    if not isinstance(outputs, dict):
        blockers.append("build evidence outputs must be an object")
    else:
        for split in ("train", "validation", "holdout"):
            entry = outputs.get(split)
            if not isinstance(entry, dict):
                blockers.append(f"build evidence missing {split} output")
                continue
            examples = entry.get("examples")
            digest = entry.get("sha256")
            if not isinstance(examples, int) or examples <= 0:
                blockers.append(f"{split} must contain at least one example")
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                blockers.append(f"{split} sha256 is missing or invalid")

    if build.get("exact_dedup") is not True:
        blockers.append("build evidence must assert exact_dedup=true")
    if build.get("frozen_eval_exact_prompt_overlap_removed") is not True:
        blockers.append("build evidence must assert frozen eval exact-overlap removal")
    if build.get("high_confidence_secret_filter") is not True:
        blockers.append("build evidence must assert high-confidence secret filtering")

    if contamination.get("status") != "PASS":
        blockers.append("contamination report status must be PASS")
    if contamination.get("exact_overlap_count") != 0:
        blockers.append("contamination report has exact overlaps")
    if contamination.get("semantic_overlap_count") != 0:
        blockers.append("contamination report has semantic overlaps")

    return blockers


def proposal(
    *,
    catalog: dict[str, Any],
    build: dict[str, Any],
    contamination: dict[str, Any],
    manifest: dict[str, Any],
    token_count: int,
    collection_date: str,
) -> dict[str, Any]:
    by_id = {source["id"]: source for source in catalog["sources"]}
    source_ids = sorted(build["source_revisions"])
    provenance = []
    for source_id in source_ids:
        source = by_id[source_id]
        provenance.append({
            "kind": "public_dataset",
            "reference": source["repository"],
            "revision": source["revision"],
            "notes": f"license={source['license']}; approved by model-lab source catalog",
        })
    dataset_hashes = {split: build["outputs"][split]["sha256"] for split in ("train", "validation", "holdout")}
    result = dict(manifest)
    result.update({
        "status": "candidate",
        "source": "AIRA Core v0 provenance-approved public/synthetic mixture",
        "version": "core-v0-candidate-1",
        "license": "MIXED_PER_SOURCE_APPROVED",
        "permitted_use": "Training allowed only for the exact source revisions and split hashes bound by this proposal and its reviewed evidence.",
        "collection_date": collection_date,
        "example_count": build["total_examples"],
        "token_count": token_count,
        "deduplication": "Exact normalized-message deduplication plus frozen-eval exact prompt removal; see build evidence and contamination report.",
        "training_allowed": True,
        "contamination_check": {
            "status": "pass",
            "method": contamination.get("method", "reviewed contamination gate"),
        },
        "provenance": provenance,
    })
    # Additional evidence is intentionally not embedded because the committed schema
    # disallows extra properties. Hashes remain in the ignored build evidence; print them
    # alongside the proposal so reviewers can bind the two artifacts.
    result["inclusion_rationale"] = (
        str(manifest.get("inclusion_rationale") or "")
        + " Exact split hashes: "
        + ", ".join(f"{name}={digest}" for name, digest in sorted(dataset_hashes.items()))
    ).strip()
    return result


def self_test() -> dict[str, Any]:
    catalog = {"sources": [{
        "id": "source",
        "repository": "org/source",
        "revision": "a" * 40,
        "license": "apache-2.0",
        "license_review": "approved",
        "provenance_review": "approved",
        "contamination_review": "approved",
        "approved_for_training": True,
    }]}
    build = {
        "source_revisions": {"source": "a" * 40},
        "total_examples": 3,
        "outputs": {split: {"examples": 1, "sha256": char * 64} for split, char in (("train", "b"), ("validation", "c"), ("holdout", "d"))},
        "exact_dedup": True,
        "frozen_eval_exact_prompt_overlap_removed": True,
        "high_confidence_secret_filter": True,
    }
    contamination = {"status": "PASS", "exact_overlap_count": 0, "semantic_overlap_count": 0, "method": "self-test"}
    manifest = {"id": "aira-core-v0", "private_data": False, "training_allowed": False, "inclusion_rationale": "self-test"}
    blockers = collect_blockers(catalog=catalog, build=build, contamination=contamination, manifest=manifest, token_count=42)
    if blockers:
        raise RuntimeError(f"promotion self-test unexpectedly blocked: {blockers}")
    proposed = proposal(catalog=catalog, build=build, contamination=contamination, manifest=manifest, token_count=42, collection_date="2026-08-26")
    if proposed.get("training_allowed") is not True or proposed.get("contamination_check", {}).get("status") != "pass":
        raise RuntimeError("promotion self-test produced invalid proposal")
    return {"status": "PASS", "proposal_training_allowed": True, "source_count": 1}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--build-evidence", type=Path, default=DEFAULT_BUILD)
    parser.add_argument("--contamination-report", type=Path, default=DEFAULT_CONTAMINATION)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--token-count", type=int, default=0)
    parser.add_argument("--collection-date", default=date.today().isoformat())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        report = self_test()
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    try:
        catalog = load(args.catalog)
        build = load(args.build_evidence)
        contamination = load(args.contamination_report)
        manifest = load(args.manifest)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "BLOCKED", "blockers": [str(exc)]}, indent=2))
        return 2

    blockers = collect_blockers(
        catalog=catalog,
        build=build,
        contamination=contamination,
        manifest=manifest,
        token_count=args.token_count,
    )
    if blockers:
        print(json.dumps({"status": "BLOCKED", "blockers": blockers}, indent=2, sort_keys=True))
        return 3

    promoted = proposal(
        catalog=catalog,
        build=build,
        contamination=contamination,
        manifest=manifest,
        token_count=args.token_count,
        collection_date=args.collection_date,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(promoted, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "PASS",
        "proposal": str(args.output),
        "example_count": promoted["example_count"],
        "token_count": promoted["token_count"],
        "source_count": len(promoted["provenance"]),
        "note": "Proposal generated only; committed manifest was not modified.",
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
