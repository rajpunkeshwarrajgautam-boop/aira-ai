#!/usr/bin/env python3
"""Fail-closed static parity gate for the AIRA Core tool_calls training/runtime contract."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OBSERVED_TOOLACE_MAX_CALLS = 12

FILES = {
    "types": Path("desktop-agent/src/main/types.ts"),
    "decision": Path("desktop-agent/src/main/decision-contract.ts"),
    "model": Path("desktop-agent/src/main/model.ts"),
    "agent": Path("desktop-agent/src/main/agent.ts"),
    "runtime": Path("desktop-agent/src/main/tool-call-runtime.ts"),
    "materializer": Path("model-lab/scripts/materialize_toolace_aira_candidate.py"),
}


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise ValueError(f"{label}: required contract marker missing: {needle}")


def verify(root: Path) -> dict[str, object]:
    contents: dict[str, str] = {}
    for key, relative in FILES.items():
        path = root / relative
        if not path.is_file():
            raise ValueError(f"missing parity file: {relative}")
        contents[key] = path.read_text(encoding="utf-8")

    require(contents["types"], "type: 'tool_calls'", "types")
    require(contents["types"], "calls: AgentToolCall[]", "types")

    require(contents["decision"], "enum: ['final', 'tool', 'tool_calls']", "decision schema")
    require(contents["decision"], "parsed.type === 'tool_calls'", "decision parser")
    require(contents["decision"], "decisionToolCalls", "decision adapter")
    match = re.search(r"MAX_TOOL_CALLS_PER_DECISION\s*=\s*(\d+)", contents["decision"])
    if not match:
        raise ValueError("decision contract does not declare MAX_TOOL_CALLS_PER_DECISION")
    runtime_max_calls = int(match.group(1))
    if runtime_max_calls < OBSERVED_TOOLACE_MAX_CALLS:
        raise ValueError(
            f"runtime batch limit {runtime_max_calls} is below observed ToolACE maximum {OBSERVED_TOOLACE_MAX_CALLS}"
        )
    if runtime_max_calls > 32:
        raise ValueError("runtime batch limit exceeds fail-closed review ceiling of 32")

    require(contents["model"], "AGENT_DECISION_SCHEMA", "model")
    if contents["model"].count("parseAgentDecision(") < 2:
        raise ValueError("model must parse both OpenAI-compatible and Ollama decisions through parseAgentDecision")

    require(contents["agent"], '{"type":"tool_calls"', "agent prompt")
    require(contents["agent"], "executeDecisionToolCalls", "agent runtime")
    require(contents["agent"], "executeTool(tool, args", "existing tool safety path")

    require(contents["runtime"], "decisionToolCalls(decision)", "batch runtime")
    require(contents["runtime"], "if (!ok) break", "batch failure stop")
    require(contents["runtime"], "catch (error)", "batch exception stop")

    require(contents["materializer"], 'CONTRACT_TYPE = "tool_calls"', "training materializer")
    require(contents["materializer"], '"multi_call_supported": True', "training materializer")

    return {
        "schema_version": 1,
        "status": "PASS",
        "training_authorization": False,
        "contract": "aira_tool_calls_json_v1",
        "observed_toolace_max_calls": OBSERVED_TOOLACE_MAX_CALLS,
        "runtime_max_calls": runtime_max_calls,
        "single_tool_backward_compatible": True,
        "multi_call_runtime_supported": True,
        "existing_execute_tool_path_preserved": True,
        "batch_stops_on_failure_or_denial": True,
    }


def self_test() -> dict[str, object]:
    fixtures = {
        FILES["types"]: "type AgentDecision = { type: 'tool_calls'; calls: AgentToolCall[] }\n",
        FILES["decision"]: (
            "const MAX_TOOL_CALLS_PER_DECISION = 16\n"
            "const x = { enum: ['final', 'tool', 'tool_calls'] }\n"
            "if (parsed.type === 'tool_calls') {}\n"
            "function decisionToolCalls() {}\n"
        ),
        FILES["model"]: "AGENT_DECISION_SCHEMA\nparseAgentDecision(a)\nparseAgentDecision(b)\n",
        FILES["agent"]: (
            "prompt = '{\"type\":\"tool_calls\"}'\n"
            "executeDecisionToolCalls(decision)\nexecuteTool(tool, args, context)\n"
        ),
        FILES["runtime"]: "decisionToolCalls(decision)\nif (!ok) break\ntry {} catch (error) {}\n",
        FILES["materializer"]: 'CONTRACT_TYPE = "tool_calls"\nevidence = {"multi_call_supported": True}\n',
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for relative, content in fixtures.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        report = verify(root)
    report["contract"] = "aira-tool-runtime-parity-self-test"
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        report = self_test() if args.self_test else verify(args.root.resolve())
    except (OSError, ValueError, TypeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
