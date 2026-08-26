#!/usr/bin/env python3
"""Materialize a review-only ToolACE candidate in the canonical AIRA tool-call contract.

This operator is deliberately fail-closed. It preserves usable ToolACE tool schemas, rewrites
assistant bracket calls into a structured multi-call JSON envelope, and rejects rows whose
schema/calls cannot be converted deterministically. It also applies the exact pinned tokenizer
and committed Core response-only template so rows with no shifted assistant target at the
2048-token boundary are rejected during materialization rather than discovered later.

The output remains review-only. It never changes source approval and does not prove runtime
serving parity.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from analyze_toolace_format import extract_tool_list, parse_bracket_calls, sanitize_name
from audit_core_sources import iter_streaming_rows
from count_core_tokens import _as_int_list, _load_config
from materialize_toolace_context_candidate import (
    EXPECTED_REPO,
    EXPECTED_REVISION,
    TOOLACE_ID,
    assistant_bracket_call_count,
    with_top_level_system,
)
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
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/toolace-aira-review-candidate.jsonl"
DEFAULT_EVIDENCE = ROOT / "model-lab/data/core-v0/toolace-aira-review-candidate-evidence.json"
CONTRACT_TYPE = "tool_calls"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonicalize_tools(tools: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, str]]:
    """Return schema with canonical names plus exact/sanitized source-name lookup maps."""
    canonical_tools: list[dict[str, Any]] = []
    exact_map: dict[str, str] = {}
    sanitized_map: dict[str, str] = {}
    seen_canonical: set[str] = set()

    for tool in tools:
        raw_name = tool.get("name")
        if not isinstance(raw_name, str) or not raw_name.strip():
            raise ValueError("tool schema contains unnamed entry")
        raw_name = raw_name.strip()
        canonical = sanitize_name(raw_name)
        if not canonical:
            raise ValueError("tool name sanitizes to empty")
        if canonical in seen_canonical:
            raise ValueError("tool-name sanitization collision")
        seen_canonical.add(canonical)
        exact_map[raw_name] = canonical
        sanitized_map[canonical] = canonical
        item = copy.deepcopy(tool)
        item["name"] = canonical
        canonical_tools.append(item)

    if not canonical_tools:
        raise ValueError("row contains no usable tools")
    return canonical_tools, exact_map, sanitized_map


def resolve_call_name(raw_name: str, exact_map: dict[str, str], sanitized_map: dict[str, str]) -> tuple[str, str]:
    if raw_name in exact_map:
        return exact_map[raw_name], "exact"
    canonical = sanitize_name(raw_name)
    if canonical and canonical in sanitized_map:
        return sanitized_map[canonical], "sanitized"
    raise ValueError("assistant call references a tool absent from row schema")


def canonical_system(tools: list[dict[str, Any]]) -> str:
    encoded_tools = json.dumps(tools, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (
        "AIRA tool-use contract. Available tools are provided as JSON below. "
        "When one or more tools are required, respond with exactly one JSON object of the form "
        '{"type":"tool_calls","calls":[{"tool":"tool_name","args":{}}]}. '
        "The calls array may contain multiple calls. Do not use bracket-call syntax. "
        "After tool results are supplied, answer the user normally.\n"
        f"AVAILABLE_TOOLS_JSON={encoded_tools}"
    )


def transform_messages(messages: list[dict[str, str]]) -> tuple[list[dict[str, str]], Counter[str]]:
    system = next((m["content"] for m in messages if m.get("role") == "system"), "")
    tools, _ = extract_tool_list(system)
    canonical_tools, exact_map, sanitized_map = canonicalize_tools(tools)
    transformed: list[dict[str, str]] = [{"role": "system", "content": canonical_system(canonical_tools)}]
    counts: Counter[str] = Counter()

    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            continue
        if role == "assistant":
            bracket_count = assistant_bracket_call_count([message])
            looks_like_bracket_call = content.strip().startswith("[") and content.strip().endswith("]") and "(" in content
            if bracket_count > 0 or looks_like_bracket_call:
                calls, _ = parse_bracket_calls(content)
                canonical_calls: list[dict[str, Any]] = []
                for call in calls:
                    canonical_name, mode = resolve_call_name(call["name"], exact_map, sanitized_map)
                    counts[f"call_name_{mode}_match"] += 1
                    canonical_calls.append({"tool": canonical_name, "args": call["args"]})
                payload = {"type": CONTRACT_TYPE, "calls": canonical_calls}
                transformed.append(
                    {
                        "role": "assistant",
                        "content": json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    }
                )
                counts["assistant_tool_call_messages_normalized"] += 1
                counts["tool_calls_normalized"] += len(canonical_calls)
                counts["multi_call_messages_normalized"] += int(len(canonical_calls) > 1)
                continue
        transformed.append({"role": str(role), "content": str(content)})

    return transformed, counts


def has_shifted_target(tokenizer: Any, messages: list[dict[str, str]], max_length: int) -> tuple[bool, int, int]:
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
    if sum(bool(flag) for flag in mask) == 0:
        return False, len(input_ids), 0
    kept_mask = mask[:max_length]
    shifted = sum(bool(flag) for flag in kept_mask[1:])
    return shifted > 0, len(input_ids), shifted


def build_candidate(
    *,
    source: dict[str, Any],
    rows: Iterable[tuple[str, dict[str, Any]]],
    tokenizer: Any,
    max_length: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    declared = source.get("declared_examples")
    if not isinstance(declared, int) or isinstance(declared, bool) or declared <= 0:
        raise ValueError("ToolACE requires positive declared_examples")

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
            counts["rejected_schema_normalization"] += 1
            continue
        messages, _ = with_top_level_system(row, base_messages)
        counts["normalized"] += 1

        if contains_secret(messages):
            counts["rejected_secret"] += 1
            continue

        prompt_hash = sha256_text(first_user_prompt(messages))
        if prompt_hash in eval_hashes:
            counts["rejected_frozen_eval_exact"] += 1
            continue

        try:
            transformed, transform_counts = transform_messages(messages)
        except (ValueError, TypeError, json.JSONDecodeError):
            counts["rejected_tool_format"] += 1
            continue

        canonical = json.dumps(transformed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row_hash = sha256_text(canonical)
        if row_hash in seen_hashes:
            counts["rejected_exact_duplicate_after_normalization"] += 1
            continue

        try:
            target_ok, raw_tokens, shifted_targets = has_shifted_target(tokenizer, transformed, max_length)
        except (ValueError, TypeError):
            counts["rejected_tokenization_error"] += 1
            continue
        if not target_ok:
            counts["rejected_zero_shifted_target_after_truncation"] += 1
            continue

        seen_hashes.add(row_hash)
        counts.update(transform_counts)
        counts["accepted"] += 1
        counts["accepted_raw_tokens"] += raw_tokens
        counts["accepted_shifted_targets_kept"] += shifted_targets
        accepted.append(
            {
                "messages": transformed,
                "source_id": source["id"],
                "source_repository": source["repository"],
                "source_revision": source["revision"],
                "representation": "aira_tool_calls_json_v1",
                "row_hash": row_hash,
                "prompt_hash": prompt_hash,
            }
        )

    if counts["seen"] != declared:
        raise ValueError(f"full ToolACE coverage required: saw {counts['seen']} of {declared}")

    accepted.sort(key=lambda item: item["row_hash"])
    evidence = {
        "schema_version": 1,
        "status": "MATERIALIZED_REVIEW_ONLY_AIRA_NORMALIZED",
        "training_authorization": False,
        "approved_for_training": False,
        "source_id": source["id"],
        "repository": source["repository"],
        "revision": source["revision"],
        "declared_examples": declared,
        "full_declared_coverage": True,
        "representation": "aira_tool_calls_json_v1",
        "canonical_tool_call_contract": {
            "type": CONTRACT_TYPE,
            "shape": {"type": CONTRACT_TYPE, "calls": [{"tool": "tool_name", "args": {}}]},
            "multi_call_supported": True,
        },
        "max_length": max_length,
        "counts": dict(sorted(counts.items())),
        "filters": [
            "high_confidence_secret",
            "frozen_eval_exact_prompt_overlap",
            "unparseable_or_ambiguous_tool_schema_or_call",
            "exact_duplicate_after_normalization",
            "zero_shifted_target_after_truncation_at_2048",
        ],
        "tool_format_review": "NORMALIZED_CANDIDATE_PENDING_RUNTIME_PARITY",
        "raw_rejected_content_emitted": False,
        "next_gates": [
            "strict_full_candidate_token_accounting",
            "exact_and_near_overlap_contamination_check",
            "aira_runtime_tool_contract_parity",
        ],
    }
    return accepted, evidence


def self_test() -> dict[str, Any]:
    messages = [
        {
            "role": "system",
            "content": 'Instruction. Here is a list of functions [{"name":"A (legacy)","arguments":{}},{"name":"B","arguments":{}}]',
        },
        {"role": "user", "content": "Do both"},
        {"role": "assistant", "content": '[A(x=true), B(y=[1, 2])]'},
        {"role": "tool", "content": "{}"},
        {"role": "assistant", "content": "Done"},
    ]
    transformed, counts = transform_messages(messages)
    tool_message = transformed[2]
    payload = json.loads(tool_message["content"])
    if payload.get("type") != CONTRACT_TYPE or len(payload.get("calls", [])) != 2:
        raise RuntimeError("canonical multi-call payload self-test failed")
    if payload["calls"][0]["tool"] != "a" or payload["calls"][1]["tool"] != "b":
        raise RuntimeError("canonical tool-name self-test failed")
    if counts.get("call_name_sanitized_match") != 1 or counts.get("call_name_exact_match") != 1:
        raise RuntimeError("name resolution self-test failed")
    if "[A(" in transformed[0]["content"] or "[A(" in tool_message["content"]:
        raise RuntimeError("bracket syntax survived normalized representation")
    return {
        "status": "PASS",
        "contract": "toolace-aira-normalized-review-candidate",
        "multi_call_json": True,
        "sanitized_name_resolution": True,
        "training_authorization": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--model", help="Local tokenizer directory; remote downloads are intentionally unsupported")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0
    if not args.model or not Path(args.model).is_dir():
        parser.error("--model must point to the already-materialized local tokenizer/model directory")

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
            raise ValueError("ToolACE source is not bound to expected exact repository/revision")
        if source.get("core_v0_decision") != "candidate_filtered":
            raise ValueError("ToolACE must remain candidate_filtered during normalization review")
        if source.get("approved_for_training") is True:
            raise ValueError("normalization refuses an already-approved ToolACE source")

        template, max_length = _load_config(args.config)
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            args.model,
            local_files_only=True,
            trust_remote_code=False,
        )
        tokenizer.chat_template = template
        accepted, evidence = build_candidate(
            source=source,
            rows=iter_streaming_rows(source),
            tokenizer=tokenizer,
            max_length=max_length,
        )

        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8", newline="\n") as handle:
            for item in accepted:
                handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")
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
