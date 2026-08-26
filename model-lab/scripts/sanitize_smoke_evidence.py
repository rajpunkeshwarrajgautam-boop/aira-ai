#!/usr/bin/env python3
"""Produce a shareable, secret/path-minimized RX 9070 XT smoke evidence record."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "model-lab/runs"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHA40 = re.compile(r"^[0-9a-f]{40}$")


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} root must be an object")
    return value


def latest_summary(runs: Path) -> Path:
    candidates = sorted(runs.glob("core-smoke-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError("no core-smoke-*.json run summary exists")
    return candidates[0]


def require_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be a boolean")
    return value


def require_sha(value: Any, field: str, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValueError(f"{field} is missing or invalid")
    return value


def require_logit_deltas(value: Any) -> list[float]:
    if not isinstance(value, list) or not value:
        raise ValueError("max_abs_logit_deltas must be a non-empty list")
    deltas: list[float] = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError(f"max_abs_logit_deltas[{index}] must be numeric")
        delta = float(item)
        if not math.isfinite(delta) or delta < 0:
            raise ValueError(f"max_abs_logit_deltas[{index}] must be finite and non-negative")
        deltas.append(delta)
    if not any(delta > 0 for delta in deltas):
        raise ValueError("max_abs_logit_deltas contains no positive adapter effect")
    return deltas


def build_sanitized(host: dict[str, Any], probe: dict[str, Any], run: dict[str, Any], adapter: dict[str, Any]) -> dict[str, Any]:
    if run.get("status") != "VERIFIED":
        raise ValueError("run status is not VERIFIED")
    if probe.get("status") != "PARTIALLY_VERIFIED":
        raise ValueError("backend probe did not reach PARTIALLY_VERIFIED before training")
    adapter_active = require_bool(adapter.get("adapter_active"), "adapter_active")
    if not adapter_active:
        raise ValueError("adapter verification says adapter_active=false")
    logit_deltas = require_logit_deltas(adapter.get("max_abs_logit_deltas"))

    return {
        "schema_version": 1,
        "evidence_type": "aira-rx9070xt-soup-smoke",
        "status": "VERIFIED",
        "captured_at_utc": run.get("ended_at_utc"),
        "os": {
            "caption": host.get("os_caption"),
            "version": host.get("os_version"),
        },
        "accelerator": {
            "gpu_name": host.get("gpu_name") or run.get("device_name"),
            "gpu_driver": host.get("gpu_driver"),
            "expected_arch": host.get("expected_arch"),
            "reported_arch": (probe.get("accelerator") or {}).get("gcn_arch_name"),
            "hip": run.get("hip"),
        },
        "software": {
            "torch": run.get("torch"),
            "bitsandbytes": run.get("bitsandbytes"),
            "soup_cli": run.get("soup_cli"),
            "soup_commit": require_sha(run.get("soup_commit"), "soup_commit", SHA40),
        },
        "run": {
            "run_id": run.get("run_id"),
            "base": run.get("base"),
            "base_revision": require_sha(run.get("base_revision"), "base_revision", SHA40),
            "seed": run.get("seed"),
            "dataset_sha256": require_sha(run.get("dataset_sha256"), "dataset_sha256", SHA256),
            "config_sha256": require_sha(run.get("config_sha256"), "config_sha256", SHA256),
            "runtime_config_sha256": require_sha(run.get("runtime_config_sha256"), "runtime_config_sha256", SHA256),
            "duration_seconds": run.get("duration_seconds"),
        },
        "adapter": {
            "adapter_active": adapter_active,
            "deterministic_generation_changed": require_bool(
                adapter.get("deterministic_generation_changed"), "deterministic_generation_changed"
            ),
            "max_abs_logit_deltas": logit_deltas,
            "max_logit_delta": max(logit_deltas),
        },
        "redactions": [
            "computer hostname omitted",
            "Python executable/local paths omitted",
            "Soup doctor text omitted",
            "model snapshot/output paths omitted",
            "credentials are never read by this sanitizer",
        ],
    }


def self_test() -> dict[str, Any]:
    host = {"os_caption": "Windows", "os_version": "test", "gpu_name": "AMD Radeon RX 9070 XT", "gpu_driver": "test", "expected_arch": "gfx1201"}
    probe = {"status": "PARTIALLY_VERIFIED", "accelerator": {"gcn_arch_name": "gfx1201"}}
    run = {
        "status": "VERIFIED", "ended_at_utc": "2026-08-26T00:00:00Z", "device_name": "AMD Radeon RX 9070 XT",
        "hip": "7.14", "torch": "2.12.0+rocm7.14.0", "bitsandbytes": "test", "soup_cli": "0.73.3",
        "soup_commit": "a" * 40, "run_id": "core-smoke-test", "base": "Qwen/Qwen3.5-0.8B",
        "base_revision": "b" * 40, "seed": 3407, "dataset_sha256": "c" * 64,
        "config_sha256": "d" * 64, "runtime_config_sha256": "e" * 64, "duration_seconds": 1.0,
    }
    adapter = {
        "adapter_active": True,
        "deterministic_generation_changed": False,
        "max_abs_logit_deltas": [0.1, 0.08, 0.09],
    }
    result = build_sanitized(host, probe, run, adapter)
    if result["adapter"]["max_logit_delta"] != 0.1:
        raise RuntimeError("sanitizer self-test lost max adapter logit delta")
    if "computer" in json.dumps(result).casefold() and "hostname omitted" not in json.dumps(result).casefold():
        raise RuntimeError("sanitizer self-test leaked host identity")
    return {"status": "PASS", "evidence_status": result["status"], "max_logit_delta": result["adapter"]["max_logit_delta"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs-dir", type=Path, default=RUNS)
    parser.add_argument("--run-summary", type=Path)
    parser.add_argument("--output", type=Path, default=RUNS / "sanitized-rx9070xt-smoke.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0

    try:
        run_path = args.run_summary or latest_summary(args.runs_dir)
        host = load(args.runs_dir / "windows-host.json")
        probe = load(args.runs_dir / "amd-backend-probe.json")
        run = load(run_path)
        adapter = load(args.runs_dir / "smoke-adapter-verification.json")
        result = build_sanitized(host, probe, run, adapter)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2))
        return 2

    rendered = json.dumps(result, indent=2, sort_keys=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
