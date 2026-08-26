#!/usr/bin/env python3
"""Analyze ToolACE source-format convertibility without emitting raw source content.

This diagnostic is deliberately non-training. It inspects the exact pinned ToolACE source and
reports whether top-level tool schemas and assistant bracket calls can be deterministically
converted to an AIRA-facing structured tool-decision representation. Raw prompts, schemas,
arguments, tool results, and tool names are never emitted; only aggregate counts and hashes
for exceptional rows are recorded.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from audit_core_sources import iter_streaming_rows
from materialize_toolace_context_candidate import (
    EXPECTED_REPO,
    EXPECTED_REVISION,
    TOOLACE_ID,
    assistant_bracket_call_count,
    with_top_level_system,
)
from prepare_core_dataset import DEFAULT_CATALOG, load_json, normalize_row, validate_catalog

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "model-lab/data/core-v0/toolace-format-analysis.json"
MAX_FAILURE_EVIDENCE = 20


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    lo = math.floor(index)
    hi = math.ceil(index)
    if lo == hi:
        return ordered[lo]
    return int(round(ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)))


def split_top_level(text: str, delimiter: str = ",") -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    escape = False
    for index, char in enumerate(text):
        if quote is not None:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth < 0:
                raise ValueError("unbalanced closing delimiter")
        elif char == delimiter and depth == 0:
            parts.append(text[start:index].strip())
            start = index + 1
    if quote is not None or depth != 0:
        raise ValueError("unbalanced quote or delimiter")
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def split_assignment(text: str) -> tuple[str, str]:
    depth = 0
    quote: str | None = None
    escape = False
    for index, char in enumerate(text):
        if quote is not None:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "=" and depth == 0:
            key = text[:index].strip()
            value = text[index + 1 :].strip()
            if not key or not value:
                break
            return key, value
    raise ValueError("argument is not a top-level name=value assignment")


def literal_value(text: str) -> Any:
    """Parse only Python/JSON literal values; arbitrary expressions are forbidden."""
    replacements = {"true": "True", "false": "False", "null": "None"}
    candidate = replacements.get(text.strip().lower(), text.strip())
    value = ast.literal_eval(candidate)
    if not isinstance(value, (str, int, float, bool, list, dict, tuple, type(None))):
        raise ValueError("unsupported argument literal type")
    if isinstance(value, tuple):
        value = list(value)
    return value


def parse_one_call(text: str) -> dict[str, Any]:
    open_index = text.find("(")
    if open_index <= 0 or not text.rstrip().endswith(")"):
        raise ValueError("call must be name(...)")
    name = text[:open_index].strip()
    if not name:
        raise ValueError("empty tool name")
    inner = text[open_index + 1 : text.rfind(")")].strip()
    args: dict[str, Any] = {}
    if inner:
        for raw_arg in split_top_level(inner):
            key, raw_value = split_assignment(raw_arg)
            if key in args:
                raise ValueError("duplicate argument name")
            args[key] = literal_value(raw_value)
    return {"name": name, "args": args}


def parse_bracket_calls(content: str) -> list[dict[str, Any]]:
    stripped = content.strip()
    if not (stripped.startswith("[") and stripped.endswith("]")):
        raise ValueError("assistant tool call is not bracket-wrapped")
    inner = stripped[1:-1].strip()
    if not inner:
        raise ValueError("empty bracket call list")
    calls = [parse_one_call(part) for part in split_top_level(inner)]
    if not calls:
        raise ValueError("no calls parsed")
    return calls


def extract_tool_list(system: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    best: list[dict[str, Any]] | None = None
    for index, char in enumerate(system):
        if char != "[":
            continue
        try:
            value, _ = decoder.raw_decode(system[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            if all(isinstance(item.get("name"), str) and item.get("name", "").strip() for item in value):
                if best is None or len(value) > len(best):
                    best = value
    if best is None:
        raise ValueError("no JSON tool list found in ToolACE system context")
    return best


def analyze_rows(source: dict[str, Any], rows: Iterable[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    declared = source.get("declared_examples")
    if not isinstance(declared, int) or isinstance(declared, bool) or declared <= 0:
        raise ValueError("ToolACE requires positive declared_examples")

    counts: Counter[str] = Counter()
    calls_per_message: Counter[int] = Counter()
    schema_sizes: list[int] = []
    failure_evidence: list[dict[str, Any]] = []

    def record_failure(row: dict[str, Any], reason: str) -> None:
        if len(failure_evidence) >= MAX_FAILURE_EVIDENCE:
            return
        canonical = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        failure_evidence.append({"reason": reason, "row_sha256": sha256_text(canonical)})

    for _, row in rows:
        if counts["seen"] >= declared:
            break
        counts["seen"] += 1
        base_messages = normalize_row(row)
        if not base_messages:
            counts["normalization_failure"] += 1
            record_failure(row, "normalization_failure")
            continue
        messages, _ = with_top_level_system(row, base_messages)
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        try:
            tools = extract_tool_list(system)
            tool_names = {str(tool["name"]).strip() for tool in tools}
            counts["schema_parse_success"] += 1
            schema_sizes.append(len(tool_names))
        except ValueError:
            counts["schema_parse_failure"] += 1
            record_failure(row, "schema_parse_failure")
            tool_names = set()

        for index, message in enumerate(messages):
            if message["role"] != "assistant" or assistant_bracket_call_count([message]) == 0:
                continue
            counts["assistant_bracket_call_messages"] += 1
            try:
                calls = parse_bracket_calls(message["content"])
            except (ValueError, SyntaxError):
                counts["call_parse_failure"] += 1
                record_failure(row, "call_parse_failure")
                continue
            counts["call_parse_success"] += 1
            counts["parsed_calls"] += len(calls)
            calls_per_message[len(calls)] += 1
            counts["multi_call_messages"] += int(len(calls) > 1)
            unknown = sum(1 for call in calls if call["name"] not in tool_names)
            counts["calls_missing_from_row_schema"] += unknown
            counts["calls_present_in_row_schema"] += len(calls) - unknown
            following_tool_turns = 0
            for later in messages[index + 1 :]:
                if later["role"] != "tool":
                    break
                following_tool_turns += 1
            counts["call_messages_followed_by_tool_turn"] += int(following_tool_turns > 0)
            counts["call_messages_without_immediate_tool_turn"] += int(following_tool_turns == 0)
            counts["following_tool_turns"] += following_tool_turns

    if counts["seen"] != declared:
        raise ValueError(f"full ToolACE coverage required: saw {counts['seen']} of {declared}")

    call_messages = counts["assistant_bracket_call_messages"]
    parsed = counts["call_parse_success"]
    schema_success = counts["schema_parse_success"]
    result = {
        "schema_version": 1,
        "status": "RECORDED_DIAGNOSTIC",
        "training_authorization": False,
        "source_id": source["id"],
        "repository": source["repository"],
        "revision": source["revision"],
        "rows": counts["seen"],
        "counts": dict(sorted(counts.items())),
        "schema_parse_success_fraction": schema_success / counts["seen"] if counts["seen"] else 0.0,
        "call_parse_success_fraction": parsed / call_messages if call_messages else 0.0,
        "calls_per_message": {str(key): value for key, value in sorted(calls_per_message.items())},
        "schema_tool_count_p50": percentile(schema_sizes, 0.50),
        "schema_tool_count_p95": percentile(schema_sizes, 0.95),
        "failure_evidence": failure_evidence,
        "failure_evidence_truncated": (
            counts["normalization_failure"] + counts["schema_parse_failure"] + counts["call_parse_failure"]
        ) > len(failure_evidence),
        "raw_content_emitted": False,
        "tool_names_emitted": False,
        "next_gate": "aira_tool_contract_normalizer" if counts["call_parse_failure"] == 0 and counts["schema_parse_failure"] == 0 else "repair_format_parser_before_normalization",
    }
    return result


def self_test() -> dict[str, Any]:
    source = {
        "id": TOOLACE_ID,
        "repository": EXPECTED_REPO,
        "revision": EXPECTED_REVISION,
        "declared_examples": 2,
    }
    rows = [
        (
            "train",
            {
                "system": 'Instruction. Tools: [{"name":"Weather API","description":"x","parameters":{}}]',
                "conversations": [
                    {"from": "user", "value": "Weather?"},
                    {"from": "assistant", "value": '[Weather API(city="Delhi", days=2)]'},
                    {"from": "tool", "value": '{"temp":31}'},
                    {"from": "assistant", "value": "31 C"},
                ],
            },
        ),
        (
            "train",
            {
                "system": 'Instruction. Tools: [{"name":"A","parameters":{}},{"name":"B","parameters":{}}]',
                "conversations": [
                    {"from": "user", "value": "Do both"},
                    {"from": "assistant", "value": '[A(x=true), B(y=[1, 2])]'},
                    {"from": "tool", "value": '{}'},
                    {"from": "assistant", "value": "Done"},
                ],
            },
        ),
    ]
    report = analyze_rows(source, rows)
    counts = report["counts"]
    if counts.get("schema_parse_success") != 2:
        raise RuntimeError("schema parser self-test failed")
    if counts.get("call_parse_success") != 2 or counts.get("parsed_calls") != 3:
        raise RuntimeError("bracket-call parser self-test failed")
    if counts.get("calls_missing_from_row_schema", 0) != 0:
        raise RuntimeError("tool/schema parity self-test failed")
    if report["raw_content_emitted"] is not False or report["training_authorization"] is not False:
        raise RuntimeError("format analyzer violated fail-closed contract")
    return {
        "status": "PASS",
        "contract": "toolace-format-analysis",
        "schema_parser": True,
        "bracket_call_parser": True,
        "training_authorization": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
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
            raise ValueError("ToolACE source is not bound to expected exact repository/revision")
        if source.get("approved_for_training") is True:
            raise ValueError("format analysis refuses an already-approved ToolACE source")
        result = analyze_rows(source, iter_streaming_rows(source))
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    rendered = json.dumps(result, indent=2, sort_keys=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
