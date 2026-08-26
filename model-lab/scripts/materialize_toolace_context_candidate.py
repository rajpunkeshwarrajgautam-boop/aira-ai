#!/usr/bin/env python3
"""Materialize a review-only ToolACE candidate with source system/tool context preserved.

The earlier generic Core normalizer intentionally handled message arrays only. ToolACE stores
its function-composition instruction and tool definitions in a top-level `system` field, so
using only `conversations` drops information required to interpret assistant tool calls.

This operator is fail-closed and ToolACE-specific. It:
- requires the exact pinned ToolACE source and candidate_filtered decision;
- prepends the non-empty top-level system field when the conversation has no system turn;
- rejects high-confidence secret-pattern rows, exact duplicates, and frozen-eval exact prompts;
- records source-format statistics without rewriting ToolACE bracket-call syntax;
- writes review-only JSONL/evidence and never changes training approval.

The output is NOT training-approved. Tool-call syntax normalization/parity remains a separate
gate after context-fit and contamination are re-measured on this corrected representation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from audit_core_sources import iter_streaming_rows
from prepare_core_dataset import (
    DEFAULT_CATALOG,
    contains_secret,
    first_user_prompt,
    frozen_prompt_hashes,
    load_json,
    normalize_row,
    sha256_text,
    validate_catalog,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/toolace-context-review-candidate.jsonl"
DEFAULT_EVIDENCE = ROOT / "model-lab/data/core-v0/toolace-context-review-candidate-evidence.json"
TOOLACE_ID = "toolace"
EXPECTED_REPO = "Team-ACE/ToolACE"
EXPECTED_REVISION = "e0db1bccf18d6d02cbb03b1ecb63fafb21525311"
BRACKET_CALL_RE = re.compile(r"^\s*\[[\s\S]*?\([\s\S]*?\)[\s\S]*?\]\s*$")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def with_top_level_system(row: dict[str, Any], messages: list[dict[str, str]]) -> tuple[list[dict[str, str]], bool]:
    """Preserve ToolACE top-level system/tool definitions without duplicating system turns."""
    if any(message.get("role") == "system" for message in messages):
        return messages, False
    system = row.get("system")
    if not isinstance(system, str) or not system.strip():
        return messages, False
    return [{"role": "system", "content": system.strip()}, *messages], True


def assistant_bracket_call_count(messages: list[dict[str, str]]) -> int:
    return sum(
        1
        for message in messages
        if message.get("role") == "assistant" and BRACKET_CALL_RE.fullmatch(message.get("content", ""))
    )


def build_candidate(
    *,
    source: dict[str, Any],
    rows: Iterable[tuple[str, dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    declared = source.get("declared_examples")
    if isinstance(declared, bool) or not isinstance(declared, int) or declared <= 0:
        raise ValueError("ToolACE requires a positive declared_examples value")

    eval_hashes = frozen_prompt_hashes()
    seen_hashes: set[str] = set()
    accepted: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()

    for split_name, row in rows:
        if counts["seen"] >= declared:
            break
        counts["seen"] += 1
        counts[f"split_{split_name}"] += 1

        base_messages = normalize_row(row)
        if not base_messages:
            counts["rejected_schema"] += 1
            continue
        messages, system_added = with_top_level_system(row, base_messages)
        counts["normalized"] += 1
        counts["system_context_preserved"] += int(system_added or any(m["role"] == "system" for m in messages))
        bracket_calls = assistant_bracket_call_count(messages)
        counts["assistant_bracket_tool_call_messages"] += bracket_calls
        counts["rows_with_assistant_bracket_tool_calls"] += int(bracket_calls > 0)

        if contains_secret(messages):
            counts["rejected_secret"] += 1
            continue

        prompt_hash = sha256_text(first_user_prompt(messages))
        if prompt_hash in eval_hashes:
            counts["rejected_frozen_eval_exact"] += 1
            continue

        canonical = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row_hash = sha256_text(canonical)
        if row_hash in seen_hashes:
            counts["rejected_exact_duplicate"] += 1
            continue
        seen_hashes.add(row_hash)

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

    full_coverage = counts["seen"] == declared
    if not full_coverage:
        raise ValueError(f"ToolACE full coverage required: saw {counts['seen']} of {declared}")
    if counts["normalized"] != declared:
        raise ValueError(f"ToolACE normalization must cover every declared row: {counts['normalized']} of {declared}")
    if counts["system_context_preserved"] != declared:
        raise ValueError(
            "ToolACE representation gate failed: every declared row must preserve a system/tool-definition context"
        )
    if counts["rows_with_assistant_bracket_tool_calls"] <= 0:
        raise ValueError("ToolACE source-format probe found no assistant bracket tool calls")

    accepted.sort(key=lambda item: item["row_hash"])
    evidence = {
        "schema_version": 2,
        "status": "MATERIALIZED_REVIEW_ONLY_V2",
        "source_id": source["id"],
        "repository": source["repository"],
        "revision": source["revision"],
        "declared_examples": declared,
        "full_declared_coverage": True,
        "core_v0_decision": source.get("core_v0_decision"),
        "approved_for_training": False,
        "representation": "toolace_system_preserved_bracket_calls_unconverted",
        "tool_format_review": "PENDING_NORMALIZATION_PARITY",
        "counts": dict(sorted(counts.items())),
        "filters": [
            "high_confidence_secret",
            "exact_duplicate",
            "frozen_eval_exact_prompt_overlap",
        ],
        "raw_rejected_content_emitted": False,
        "next_gates": [
            "exact_and_near_overlap_contamination_check",
            "exact_token_accounting_with_system_context",
            "tool_call_syntax_normalization_and_serving_parity",
        ],
    }
    return accepted, evidence


def self_test() -> dict[str, Any]:
    source = {
        "id": TOOLACE_ID,
        "repository": EXPECTED_REPO,
        "revision": EXPECTED_REVISION,
        "declared_examples": 2,
        "core_v0_decision": "candidate_filtered",
        "approved_for_training": False,
    }
    rows = [
        (
            "train",
            {
                "system": "Available tools: [{\"name\":\"Weather API\"}]",
                "conversations": [
                    {"from": "user", "value": "Weather now?"},
                    {"from": "assistant", "value": "[Weather API(city=\"Delhi\")]"},
                    {"from": "tool", "value": "{\"temp\":31}"},
                    {"from": "assistant", "value": "31 C"},
                ],
            },
        ),
        (
            "train",
            {
                "system": "Available tools: [{\"name\":\"Quote API\"}]",
                "conversations": [
                    {"from": "user", "value": "Give a quote"},
                    {"from": "assistant", "value": "[Quote API(topic=\"focus\")]"},
                    {"from": "tool", "value": "{\"quote\":\"Focus\"}"},
                    {"from": "assistant", "value": "Focus"},
                ],
            },
        ),
    ]
    accepted, evidence = build_candidate(source=source, rows=rows)
    if len(accepted) != 2:
        raise RuntimeError("ToolACE context candidate self-test accepted count failed")
    if any(row["messages"][0]["role"] != "system" for row in accepted):
        raise RuntimeError("ToolACE context candidate self-test dropped top-level system context")
    if evidence["counts"].get("system_context_preserved") != 2:
        raise RuntimeError("ToolACE context candidate self-test system coverage failed")
    if evidence["counts"].get("rows_with_assistant_bracket_tool_calls") != 2:
        raise RuntimeError("ToolACE context candidate self-test format probe failed")
    return {
        "status": "PASS",
        "contract": "toolace-context-preserving-review-candidate",
        "system_context_preserved": True,
        "tool_format_review": "PENDING_NORMALIZATION_PARITY",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
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
        matches = [source for source in catalog["sources"] if source.get("id") == TOOLACE_ID]
        if len(matches) != 1:
            raise ValueError("catalog must contain exactly one ToolACE source")
        source = matches[0]
        if source.get("repository") != EXPECTED_REPO or source.get("revision") != EXPECTED_REVISION:
            raise ValueError("ToolACE source is not bound to the expected exact repository/revision")
        if source.get("core_v0_decision") != "candidate_filtered":
            raise ValueError("ToolACE must remain candidate_filtered during review materialization")
        if source.get("approved_for_training") is True:
            raise ValueError("ToolACE review materialization refuses an already-approved source")

        accepted, evidence = build_candidate(source=source, rows=iter_streaming_rows(source))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8", newline="\n") as handle:
            for row in accepted:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        evidence["output"] = str(args.output.relative_to(ROOT)) if args.output.is_relative_to(ROOT) else str(args.output)
        evidence["output_sha256"] = file_sha256(args.output)
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        rendered = json.dumps(evidence, indent=2, sort_keys=True)
        args.evidence.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        return 0
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
