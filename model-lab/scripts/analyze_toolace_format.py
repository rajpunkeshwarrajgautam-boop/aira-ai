#!/usr/bin/env python3
"""Analyze ToolACE format convertibility without emitting raw source content.

This diagnostic is deliberately non-training. It inspects the exact pinned ToolACE source and
reports whether top-level tool schemas and assistant bracket calls can be deterministically
converted to an AIRA-facing structured tool-decision representation. The parser is intentionally
conservative and non-executing: JSON plus ast.literal_eval are allowed, arbitrary eval is not.
Raw prompts, schemas, arguments, tool results, and tool names are never emitted.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
import re
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
ANCHOR = "Here is a list of functions"
SAFE_BARE_VALUE_RE = re.compile(r"^[^\[\]{}(),=]+$")


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


def sanitize_name(name: str) -> str:
    """Deterministic comparison-only normalization for known ToolACE name defects."""
    value = name.strip().lower()
    value = re.sub(r"\([^)]*\)", "", value)
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    if value and value[0].isdigit():
        value = "tool_" + value
    return value


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
            if key and value:
                return key, value
            break
    raise ValueError("argument is not a top-level name=value assignment")


def parse_argument_value(text: str) -> tuple[Any, str]:
    raw = text.strip()
    lowered = raw.lower()
    if lowered == "true":
        return True, "json_keyword"
    if lowered == "false":
        return False, "json_keyword"
    if lowered == "null":
        return None, "json_keyword"
    try:
        return json.loads(raw), "json"
    except json.JSONDecodeError:
        pass
    try:
        value = ast.literal_eval(raw)
        if isinstance(value, tuple):
            value = list(value)
        if not isinstance(value, (str, int, float, bool, list, dict, type(None))):
            raise ValueError("unsupported literal type")
        return value, "python_literal"
    except (ValueError, SyntaxError):
        pass
    if SAFE_BARE_VALUE_RE.fullmatch(raw):
        return raw, "safe_bare_string"
    raise ValueError("argument value is not a safe literal or bare token")


def find_argument_open(text: str) -> int:
    stripped = text.rstrip()
    if not stripped.endswith(")"):
        raise ValueError("call must end with closing parenthesis")
    depth = 0
    quote: str | None = None
    escape = False
    for index in range(len(stripped) - 1, -1, -1):
        char = stripped[index]
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
        if char == ")":
            depth += 1
        elif char == "(":
            depth -= 1
            if depth == 0:
                return index
            if depth < 0:
                break
    raise ValueError("could not locate argument-list opening parenthesis")


def parse_one_call(text: str) -> tuple[dict[str, Any], Counter[str]]:
    open_index = find_argument_open(text)
    name = text[:open_index].strip()
    if not name:
        raise ValueError("empty tool name")
    inner = text[open_index + 1 : text.rstrip().rfind(")")].strip()
    args: dict[str, Any] = {}
    modes: Counter[str] = Counter()
    if inner:
        for raw_arg in split_top_level(inner):
            key, raw_value = split_assignment(raw_arg)
            if key in args:
                raise ValueError("duplicate argument name")
            value, mode = parse_argument_value(raw_value)
            args[key] = value
            modes[mode] += 1
    return {"name": name, "sanitized_name": sanitize_name(name), "args": args}, modes


def parse_bracket_calls(content: str) -> tuple[list[dict[str, Any]], Counter[str]]:
    stripped = content.strip()
    if not (stripped.startswith("[") and stripped.endswith("]")):
        raise ValueError("assistant tool call is not bracket-wrapped")
    inner = stripped[1:-1].strip()
    if not inner:
        raise ValueError("empty bracket call list")
    calls: list[dict[str, Any]] = []
    modes: Counter[str] = Counter()
    for part in split_top_level(inner):
        call, call_modes = parse_one_call(part)
        calls.append(call)
        modes.update(call_modes)
    if not calls:
        raise ValueError("no calls parsed")
    return calls, modes


def balanced_list_blocks(text: str) -> Iterable[str]:
    for start, char in enumerate(text):
        if char != "[":
            continue
        depth = 0
        quote: str | None = None
        escape = False
        for index in range(start, len(text)):
            ch = text[index]
            if quote is not None:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == quote:
                    quote = None
                continue
            if ch in {"'", '"'}:
                quote = ch
                continue
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    yield text[start : index + 1]
                    break
                if depth < 0:
                    break


def parse_tool_block(block: str) -> tuple[list[dict[str, Any]], str]:
    try:
        value = json.loads(block)
        mode = "json"
    except json.JSONDecodeError:
        try:
            value = ast.literal_eval(block)
            mode = "python_literal"
        except (ValueError, SyntaxError) as exc:
            raise ValueError("tool list is neither JSON nor a safe literal") from exc
    if not isinstance(value, list) or not value or not all(isinstance(item, dict) for item in value):
        raise ValueError("tool list is not a non-empty list of dicts")
    named = [item for item in value if isinstance(item.get("name"), str) and item.get("name", "").strip()]
    if not named:
        raise ValueError("tool list has no named tools")
    return value, mode


def extract_tool_list(system: str) -> tuple[list[dict[str, Any]], str]:
    start = system.find(ANCHOR)
    search_spaces = [system[start:]] if start >= 0 else []
    search_spaces.append(system)
    best: tuple[list[dict[str, Any]], str] | None = None
    for search_space in search_spaces:
        for block in balanced_list_blocks(search_space):
            try:
                parsed, mode = parse_tool_block(block)
            except ValueError:
                continue
            if best is None or len(parsed) > len(best[0]):
                best = (parsed, mode)
        if best is not None:
            return best
    raise ValueError("no parseable tool list found in ToolACE system context")


def analyze_rows(source: dict[str, Any], rows: Iterable[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    declared = source.get("declared_examples")
    if not isinstance(declared, int) or isinstance(declared, bool) or declared <= 0:
        raise ValueError("ToolACE requires positive declared_examples")

    counts: Counter[str] = Counter()
    calls_per_message: Counter[int] = Counter()
    argument_modes: Counter[str] = Counter()
    schema_modes: Counter[str] = Counter()
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
            tools, schema_mode = extract_tool_list(system)
            tool_names_exact = {
                str(tool["name"]).strip()
                for tool in tools
                if isinstance(tool.get("name"), str) and str(tool["name"]).strip()
            }
            tool_names_sanitized = {sanitize_name(name) for name in tool_names_exact if sanitize_name(name)}
            counts["schema_parse_success"] += 1
            schema_modes[schema_mode] += 1
            schema_sizes.append(len(tool_names_exact))
        except ValueError:
            counts["schema_parse_failure"] += 1
            record_failure(row, "schema_parse_failure")
            tool_names_exact = set()
            tool_names_sanitized = set()

        for index, message in enumerate(messages):
            if message["role"] != "assistant" or assistant_bracket_call_count([message]) == 0:
                continue
            counts["assistant_bracket_call_messages"] += 1
            try:
                calls, modes = parse_bracket_calls(message["content"])
            except (ValueError, SyntaxError):
                counts["call_parse_failure"] += 1
                record_failure(row, "call_parse_failure")
                continue
            counts["call_parse_success"] += 1
            counts["parsed_calls"] += len(calls)
            argument_modes.update(modes)
            calls_per_message[len(calls)] += 1
            counts["multi_call_messages"] += int(len(calls) > 1)
            for call in calls:
                raw_name = call["name"]
                sanitized_name = call["sanitized_name"]
                if raw_name in tool_names_exact:
                    counts["calls_exact_name_match"] += 1
                    counts["calls_present_in_row_schema"] += 1
                elif sanitized_name and sanitized_name in tool_names_sanitized:
                    counts["calls_sanitized_name_match"] += 1
                    counts["calls_present_in_row_schema"] += 1
                else:
                    counts["calls_missing_from_row_schema"] += 1
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
    parse_failures = counts["schema_parse_failure"] + counts["call_parse_failure"]
    result = {
        "schema_version": 2,
        "parser_revision": "balanced_safe_literal_sanitized_names_v2",
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
        "argument_parse_modes": dict(sorted(argument_modes.items())),
        "schema_parse_modes": dict(sorted(schema_modes.items())),
        "schema_tool_count_p50": percentile(schema_sizes, 0.50),
        "schema_tool_count_p95": percentile(schema_sizes, 0.95),
        "failure_evidence": failure_evidence,
        "failure_evidence_truncated": parse_failures > len(failure_evidence),
        "raw_content_emitted": False,
        "tool_names_emitted": False,
        "next_gate": "aira_tool_contract_normalizer_with_deterministic_rejections" if parse_failures == 0 else "classify_remaining_format_failures_before_normalization",
    }
    return result


def self_test() -> dict[str, Any]:
    source = {
        "id": TOOLACE_ID,
        "repository": EXPECTED_REPO,
        "revision": EXPECTED_REVISION,
        "declared_examples": 3,
    }
    rows = [
        (
            "train",
            {
                "system": 'Instruction. Here is a list of functions in JSON format that you can invoke. [{"name":"Weather API","arguments":{"properties":{"mode":{"enum":["now","week"]}}}}]',
                "conversations": [
                    {"from": "user", "value": "Weather?"},
                    {"from": "assistant", "value": '[Weather API(city="Delhi", mode=now)]'},
                    {"from": "tool", "value": '{"temp":31}'},
                    {"from": "assistant", "value": "31 C"},
                ],
            },
        ),
        (
            "train",
            {
                "system": "Instruction. Here is a list of functions [{'name':'A (legacy)','arguments':{}},{'name':'B','arguments':{}}]",
                "conversations": [
                    {"from": "user", "value": "Do both"},
                    {"from": "assistant", "value": '[A (legacy)(x=true), B(y=[1, 2])]'},
                    {"from": "tool", "value": '{}'},
                    {"from": "assistant", "value": "Done"},
                ],
            },
        ),
        (
            "train",
            {
                "system": 'Instruction. Tools: [{"name":"3D Lookup","arguments":{}}]',
                "conversations": [
                    {"from": "user", "value": "Lookup"},
                    {"from": "assistant", "value": '[3D Lookup(code="x")]'},
                ],
            },
        ),
    ]
    report = analyze_rows(source, rows)
    counts = report["counts"]
    if counts.get("schema_parse_success") != 3:
        raise RuntimeError("schema parser self-test failed")
    if counts.get("call_parse_success") != 3 or counts.get("parsed_calls") != 4:
        raise RuntimeError("bracket-call parser self-test failed")
    if counts.get("calls_missing_from_row_schema", 0) != 0:
        raise RuntimeError("tool/schema parity self-test failed")
    if counts.get("calls_sanitized_name_match", 0) < 1:
        raise RuntimeError("sanitized name matching self-test failed")
    if report["raw_content_emitted"] is not False or report["training_authorization"] is not False:
        raise RuntimeError("format analyzer violated fail-closed contract")
    return {
        "status": "PASS",
        "contract": "toolace-format-analysis-v2",
        "balanced_schema_parser": True,
        "safe_literal_parser": True,
        "sanitized_name_matching": True,
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
