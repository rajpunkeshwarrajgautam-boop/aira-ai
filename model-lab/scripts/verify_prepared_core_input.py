#!/usr/bin/env python3
"""Verify a bound prepared Core training input without granting source approval."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path
from typing import Any

from prepare_core_dataset import (
    DEFAULT_CATALOG,
    PREPARED_CANDIDATE_KIND,
    contains_secret,
    file_sha256,
    first_user_prompt,
    frozen_prompt_hashes,
    load_json,
    load_prepared_candidate_rows,
    sha256_text,
    validate_catalog,
)


def verify_source(source: dict[str, Any], *, root: Path | None = None) -> dict[str, Any]:
    rows, evidence = load_prepared_candidate_rows(source, root or Path(__file__).resolve().parents[2])
    eval_hashes = frozen_prompt_hashes() if root is None else set()
    secret_rows = 0
    frozen_exact_rows = 0
    for row in rows:
        messages = row["messages"]
        secret_rows += int(contains_secret(messages))
        frozen_exact_rows += int(row["prompt_hash"] in eval_hashes)
    if secret_rows:
        raise ValueError(f"prepared input contains {secret_rows} secret-pattern rows")
    if frozen_exact_rows:
        raise ValueError(f"prepared input contains {frozen_exact_rows} frozen-eval exact prompt overlaps")
    return {
        "schema_version": 1,
        "status": "PASS",
        "training_authorization": False,
        "source_id": source["id"],
        "prepared_input": evidence,
        "secret_pattern_rows": secret_rows,
        "frozen_eval_exact_prompt_overlap_rows": frozen_exact_rows,
        "row_and_prompt_hashes_reverified": True,
        "next_gate": "deliberate_source_approval",
    }


def self_test() -> dict[str, Any]:
    messages = [
        {"role": "system", "content": "AIRA tool-use contract"},
        {"role": "user", "content": "Search"},
        {"role": "assistant", "content": '{"type":"tool_calls","calls":[{"tool":"search","args":{}}]}'},
    ]
    canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    row_hash = sha256_text(canonical)
    prompt_hash = sha256_text(first_user_prompt(messages))
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        path = root / "candidate.jsonl"
        item = {
            "messages": messages,
            "source_id": "fixture",
            "source_repository": "example/fixture",
            "source_revision": "a" * 40,
            "representation": "aira_tool_calls_json_v1",
            "row_hash": row_hash,
            "prompt_hash": prompt_hash,
        }
        path.write_text(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        source = {
            "id": "fixture",
            "repository": "example/fixture",
            "revision": "a" * 40,
            "training_input": {
                "kind": PREPARED_CANDIDATE_KIND,
                "path": "candidate.jsonl",
                "expected_sha256": file_sha256(path),
                "expected_examples": 1,
                "representation": "aira_tool_calls_json_v1",
            },
        }
        report = verify_source(source, root=root)
    report["contract"] = "prepared-core-input-verifier"
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source", default="toolace")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0

    try:
        catalog = load_json(args.catalog)
        if not isinstance(catalog, dict):
            raise ValueError("catalog root must be an object")
        errors = validate_catalog(catalog)
        if errors:
            raise ValueError("invalid catalog: " + "; ".join(errors))
        matches = [source for source in catalog["sources"] if source.get("id") == args.source]
        if len(matches) != 1:
            raise ValueError(f"catalog must contain exactly one source {args.source!r}")
        report = verify_source(matches[0])
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
