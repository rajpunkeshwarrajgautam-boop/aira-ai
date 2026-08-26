#!/usr/bin/env python3
"""Fail closed on AIRA Core-v0 source decision/approval contradictions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from prepare_core_dataset import DEFAULT_CATALOG, load_json

ALLOWED_DECISIONS = {"hold", "candidate_filtered", "exclude_context_mismatch", "include"}
TOOL_DOMAINS = {"tool_use", "function_calling", "agentic_execution"}


def validate(catalog: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    sources = catalog.get("sources")
    if not isinstance(sources, list):
        return ["catalog.sources must be a list"]

    for index, source in enumerate(sources):
        if not isinstance(source, dict):
            errors.append(f"sources[{index}] must be an object")
            continue
        source_id = str(source.get("id") or f"sources[{index}]")
        decision = source.get("core_v0_decision")
        approved = source.get("approved_for_training") is True
        context_fit = source.get("context_fit_review")
        domains_raw = source.get("domains")
        domains = {item for item in domains_raw if isinstance(item, str)} if isinstance(domains_raw, list) else set()
        is_tool_source = bool(domains & TOOL_DOMAINS)

        if decision not in ALLOWED_DECISIONS:
            errors.append(f"{source_id}: invalid/missing core_v0_decision={decision!r}")
            continue
        if approved and decision in {"hold", "exclude_context_mismatch"}:
            errors.append(f"{source_id}: decision {decision!r} cannot be training-approved")
        if approved and context_fit != "approved":
            errors.append(f"{source_id}: training approval requires context_fit_review='approved'")
        if approved and is_tool_source and source.get("tool_format_review") != "approved":
            errors.append(f"{source_id}: tool-source training approval requires tool_format_review='approved'")
        if decision == "candidate_filtered":
            filters = source.get("required_filters")
            if not isinstance(filters, list) or not filters or not all(isinstance(item, str) and item for item in filters):
                errors.append(f"{source_id}: candidate_filtered requires non-empty required_filters")
            if approved:
                fields = ["license_review", "provenance_review", "contamination_review", "context_fit_review"]
                if is_tool_source:
                    fields.append("tool_format_review")
                for field in fields:
                    if source.get(field) != "approved":
                        errors.append(f"{source_id}: filtered approval requires {field}='approved'")
        if decision == "exclude_context_mismatch" and context_fit not in {"failed_core_v0_2048", "failed"}:
            errors.append(f"{source_id}: context-mismatch exclusion must record failed context_fit_review")

    return errors


def self_test() -> dict[str, Any]:
    good = {
        "sources": [
            {
                "id": "filtered",
                "domains": ["tool_use"],
                "core_v0_decision": "candidate_filtered",
                "required_filters": ["reject_secret_rows"],
                "approved_for_training": False,
                "context_fit_review": "bounded_pass",
                "tool_format_review": "pending_normalization_parity",
            },
            {
                "id": "excluded",
                "domains": ["reasoning"],
                "core_v0_decision": "exclude_context_mismatch",
                "approved_for_training": False,
                "context_fit_review": "failed_core_v0_2048",
                "tool_format_review": "not_applicable",
            },
        ]
    }
    if validate(good):
        raise RuntimeError("valid source decision fixture was rejected")

    bad_excluded = json.loads(json.dumps(good))
    bad_excluded["sources"][1]["approved_for_training"] = True
    if not validate(bad_excluded):
        raise RuntimeError("excluded training source was not rejected")

    bad_tool = {
        "sources": [
            {
                "id": "tool-source",
                "domains": ["function_calling"],
                "core_v0_decision": "include",
                "approved_for_training": True,
                "license_review": "approved",
                "provenance_review": "approved",
                "contamination_review": "approved",
                "context_fit_review": "approved",
                "tool_format_review": "pending_normalization_parity",
            }
        ]
    }
    tool_errors = validate(bad_tool)
    if not any("tool_format_review='approved'" in item for item in tool_errors):
        raise RuntimeError("tool-source approval without tool-format parity was not rejected")

    return {
        "status": "PASS",
        "contract": "core-v0-source-decisions",
        "tool_format_approval_required": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0

    catalog = load_json(args.catalog)
    if not isinstance(catalog, dict):
        print(json.dumps({"status": "FAIL", "errors": ["catalog root must be an object"]}, indent=2))
        return 2
    errors = validate(catalog)
    result = {"status": "PASS" if not errors else "FAIL", "errors": errors}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
