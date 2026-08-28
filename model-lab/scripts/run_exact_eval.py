#!/usr/bin/env python3
"""Run a deterministic exact-match AIRA evaluation against an OpenAI-compatible endpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

from verify_openai_endpoint import (
    ProbeError,
    _MockHandler,
    extract_completion_text,
    normalize_base_url,
    request_json,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = ROOT / "model-lab/eval/data/core-v0-sanity.jsonl"


def canonical_answer(value: str) -> str:
    return " ".join(value.strip().split())


def prompt_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_cases(path: Path) -> list[dict[str, str]]:
    cases: list[dict[str, str]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ProbeError(f"{path}:{line_number} must be an object")
        prompt = value.get("prompt")
        expected = value.get("expected")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ProbeError(f"{path}:{line_number} prompt is required")
        if not isinstance(expected, str) or not expected.strip():
            raise ProbeError(f"{path}:{line_number} expected is required")
        cases.append({"prompt": prompt.strip(), "expected": expected.strip()})
    if not cases:
        raise ProbeError("evaluation dataset is empty")
    return cases


def evaluate(
    *,
    base_url: str,
    api_key: str,
    model: str,
    dataset: Path,
    timeout: float,
    max_completion_tokens: int,
) -> dict[str, Any]:
    normalized = normalize_base_url(base_url)
    cases = load_cases(dataset)
    rows = []
    passed = 0
    latencies = []
    for index, case in enumerate(cases, start=1):
        body, latency_ms = request_json(
            method="POST",
            url=f"{normalized}/chat/completions",
            api_key=api_key,
            timeout=timeout,
            payload={
                "model": model,
                "messages": [{"role": "user", "content": case["prompt"]}],
                "temperature": 0,
                "max_completion_tokens": max_completion_tokens,
                "stream": False,
            },
        )
        actual = canonical_answer(extract_completion_text(body))
        expected = canonical_answer(case["expected"])
        ok = actual == expected
        passed += int(ok)
        latencies.append(latency_ms)
        rows.append({
            "case": index,
            "prompt_sha256": prompt_hash(case["prompt"]),
            "expected": expected,
            "actual": actual,
            "pass": ok,
            "latency_ms": round(latency_ms, 2),
        })
    total = len(rows)
    accuracy = passed / total
    latencies_sorted = sorted(latencies)
    p50 = latencies_sorted[(total - 1) // 2]
    p95 = latencies_sorted[min(total - 1, max(0, int(total * 0.95) - 1))]
    return {
        "schema_version": 1,
        "status": "PASS" if passed == total else "FAIL",
        "model": model,
        "dataset": str(dataset),
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "temperature": 0,
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "accuracy": accuracy,
        "p50_latency_ms": round(p50, 2),
        "p95_latency_ms": round(p95, 2),
        "cases": rows,
    }


class _EvalMockHandler(_MockHandler):
    def do_POST(self) -> None:
        if not self._authorized():
            self.send_response(401)
            self.end_headers()
            return
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        prompt = payload.get("messages", [{}])[-1].get("content", "")
        content = "expected-value" if prompt == "self-test-prompt" else "unexpected"
        raw = json.dumps({
            "model": payload.get("model"),
            "choices": [{"message": {"role": "assistant", "content": content}}],
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def self_test() -> dict[str, Any]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _EvalMockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dataset = Path(tmp) / "eval.jsonl"
            dataset.write_text(
                json.dumps({"prompt": "self-test-prompt", "expected": "expected-value"}) + "\n",
                encoding="utf-8",
            )
            report = evaluate(
                base_url=f"http://127.0.0.1:{server.server_address[1]}",
                api_key="self-test-key",
                model="aira/core",
                dataset=dataset,
                timeout=5,
                max_completion_tokens=16,
            )
            if report["status"] != "PASS" or report["passed"] != 1:
                raise ProbeError("exact-eval self-test did not pass")
            return report
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url")
    parser.add_argument("--api-key-env", default="AIRA_INFERENCE_API_KEY")
    parser.add_argument("--model", default="aira/core")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--max-completion-tokens", type=int, default=64)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.self_test:
            report = self_test()
        else:
            if not args.base_url:
                raise ProbeError("--base-url is required outside --self-test")
            api_key = os.environ.get(args.api_key_env, "").strip()
            if not api_key:
                raise ProbeError(f"required API-key environment variable {args.api_key_env!r} is empty")
            report = evaluate(
                base_url=args.base_url,
                api_key=api_key,
                model=args.model,
                dataset=args.dataset,
                timeout=args.timeout,
                max_completion_tokens=args.max_completion_tokens,
            )
    except (ProbeError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2))
        return 2

    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["status"] == "PASS" else 3


if __name__ == "__main__":
    raise SystemExit(main())
