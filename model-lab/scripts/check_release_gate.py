#!/usr/bin/env python3
"""Evaluate AIRA model candidate evidence without inventing capability.

Exit codes:
  0: requested gate passes
  2: evidence is structurally invalid/incomplete
  3: release-candidate gate fails
  4: production gate fails
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MODEL_IDS = {"aira/edge", "aira/core", "aira/pro", "aira/ultra", "aira/apex"}
EVIDENCE_STATES = {
    "NOT_TESTED",
    "BASELINE",
    "IMPROVED",
    "CLASS_LEADING",
    "FRONTIER_COMPETITIVE",
    "FRONTIER_LEADING",
}


def validate(evidence: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = {
        "schema_version", "model_id", "release_state", "evidence_state", "base_model",
        "base_revision", "soup_commit", "training_run_id", "dataset_manifest_id",
        "dataset_hashes", "adapter_verified", "inference_verified", "evaluation_complete",
        "regression_gate_passed", "license_clear", "known_limitations", "serving",
    }
    missing = sorted(required - evidence.keys())
    if missing:
        errors.append(f"missing fields: {missing}")
        return errors
    if evidence["schema_version"] != 1:
        errors.append("schema_version must be 1")
    if evidence["model_id"] not in MODEL_IDS:
        errors.append("unsupported AIRA model_id")
    if evidence["evidence_state"] not in EVIDENCE_STATES:
        errors.append("invalid evidence_state")
    if not isinstance(evidence["soup_commit"], str) or not SHA40.fullmatch(evidence["soup_commit"]):
        errors.append("soup_commit must be an exact 40-character SHA")
    hashes = evidence["dataset_hashes"]
    if not isinstance(hashes, dict) or not hashes:
        errors.append("dataset_hashes must be non-empty")
    else:
        for name, value in hashes.items():
            if not isinstance(value, str) or not SHA256.fullmatch(value):
                errors.append(f"dataset hash {name!r} is not SHA-256")
    for key in ("adapter_verified", "inference_verified", "evaluation_complete", "regression_gate_passed", "license_clear"):
        if not isinstance(evidence[key], bool):
            errors.append(f"{key} must be boolean")
    if not isinstance(evidence["known_limitations"], list):
        errors.append("known_limitations must be a list")
    serving = evidence["serving"]
    required_serving = {
        "persistent", "authenticated", "health_verified", "streaming_verified",
        "omniroute_discovered", "rollback_ready",
    }
    if not isinstance(serving, dict):
        errors.append("serving must be an object")
    else:
        missing_serving = sorted(required_serving - serving.keys())
        if missing_serving:
            errors.append(f"serving missing fields: {missing_serving}")
        for key in required_serving & serving.keys():
            if not isinstance(serving[key], bool):
                errors.append(f"serving.{key} must be boolean")
    return errors


def release_candidate_failures(evidence: dict[str, Any]) -> list[str]:
    checks = {
        "adapter_verified": evidence["adapter_verified"],
        "inference_verified": evidence["inference_verified"],
        "evaluation_complete": evidence["evaluation_complete"],
        "regression_gate_passed": evidence["regression_gate_passed"],
        "license_clear": evidence["license_clear"],
    }
    if evidence["evidence_state"] in {"NOT_TESTED", "BASELINE"}:
        checks["evidence_state_at_least_improved"] = False
    return [name for name, ok in checks.items() if not ok]


def production_failures(evidence: dict[str, Any]) -> list[str]:
    failures = release_candidate_failures(evidence)
    serving = evidence["serving"]
    for key in (
        "persistent", "authenticated", "health_verified", "streaming_verified",
        "omniroute_discovered", "rollback_ready",
    ):
        if not serving[key]:
            failures.append(f"serving.{key}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--gate", choices=("release-candidate", "production"), default="release-candidate")
    args = parser.parse_args()

    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    if not isinstance(evidence, dict):
        print("INVALID: evidence root must be an object")
        return 2
    errors = validate(evidence)
    if errors:
        print(json.dumps({"gate": args.gate, "status": "INVALID", "errors": errors}, indent=2))
        return 2

    failures = release_candidate_failures(evidence) if args.gate == "release-candidate" else production_failures(evidence)
    status = "PASS" if not failures else "FAIL"
    print(json.dumps({
        "model_id": evidence["model_id"],
        "gate": args.gate,
        "status": status,
        "failed_checks": failures,
    }, indent=2))
    if not failures:
        return 0
    return 3 if args.gate == "release-candidate" else 4


if __name__ == "__main__":
    raise SystemExit(main())
