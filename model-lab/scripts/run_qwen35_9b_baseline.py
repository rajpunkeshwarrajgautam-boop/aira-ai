#!/usr/bin/env python3
"""Record the untouched exact Qwen3.5-9B-Base NF4 baseline on the AIRA sanity suite.

This is a quality reference point, not a release gate. Poor exact-match accuracy is a
valid baseline result. The command fails only when the frozen dataset, exact model
materialization, RX 9070 XT runtime, quantized model load, or deterministic generation
contract is broken.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATERIALIZATION = ROOT / "model-lab/runs/materialized-core-base.json"
DEFAULT_DATASET = ROOT / "model-lab/eval/data/core-v0-sanity.jsonl"
DEFAULT_CONFIG = ROOT / "model-lab/soup/core/sft.yaml"
DEFAULT_OUTPUT = ROOT / "model-lab/eval/reports/core-v0-9b-base-local.json"
EXPECTED_REPO = "Qwen/Qwen3.5-9B-Base"
EXPECTED_REVISION = "68c46c4b3498877f3ef123c856ecfde50c39f404"
EXPECTED_GPU = "AMD Radeon RX 9070 XT"


def _expose_windows_hipinfo() -> None:
    if os.name != "nt":
        return
    scripts_dir = Path(sys.executable).resolve().parent
    hipinfo = scripts_dir / "hipInfo.exe"
    if hipinfo.is_file() and not (shutil.which("hipinfo.exe") or shutil.which("hipInfo.exe")):
        os.environ["PATH"] = str(scripts_dir) + os.pathsep + os.environ.get("PATH", "")


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} root must be an object")
    return value


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _canonical(value: str) -> str:
    return " ".join(value.strip().split())


def _load_cases(path: Path) -> list[dict[str, str]]:
    cases: list[dict[str, str]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not raw.strip():
            continue
        row = json.loads(raw)
        if not isinstance(row, dict):
            raise ValueError(f"{path}:{line_number} must be an object")
        prompt = row.get("prompt")
        expected = row.get("expected")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(f"{path}:{line_number} prompt is required")
        if not isinstance(expected, str) or not expected.strip():
            raise ValueError(f"{path}:{line_number} expected is required")
        cases.append({"prompt": prompt.strip(), "expected": expected.strip()})
    if not cases:
        raise ValueError("baseline dataset is empty")
    return cases


def _load_inference_template(path: Path) -> str:
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError("PyYAML is required for the baseline operator") from exc
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("data"), dict):
        raise ValueError("Core Soup config must contain data mapping")
    template = raw["data"].get("chat_template")
    if not isinstance(template, str) or not template.strip():
        raise ValueError("Core Soup config does not contain the strict training chat template")
    if "{% generation %}" not in template or "{% endgeneration %}" not in template:
        raise ValueError("Core chat template lacks strict assistant generation markers")
    return template


def validate_report(report: dict[str, Any]) -> None:
    if report.get("status") != "RECORDED":
        raise ValueError("baseline status must be RECORDED")
    if report.get("repo_id") != EXPECTED_REPO or report.get("base_revision") != EXPECTED_REVISION:
        raise ValueError("baseline is not bound to the exact pinned Core base")
    if report.get("device_name") != EXPECTED_GPU:
        raise ValueError("baseline did not run on the designated RX 9070 XT")
    total = report.get("total")
    passed = report.get("passed")
    if not isinstance(total, int) or total <= 0 or not isinstance(passed, int) or not (0 <= passed <= total):
        raise ValueError("invalid baseline case counts")
    accuracy = report.get("accuracy")
    if isinstance(accuracy, bool) or not isinstance(accuracy, (int, float)) or not 0.0 <= float(accuracy) <= 1.0:
        raise ValueError("invalid baseline accuracy")
    for field in ("peak_allocated_gib", "peak_reserved_gib"):
        value = report.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or float(value) <= 0:
            raise ValueError(f"{field} must be finite and positive")
    cases = report.get("cases")
    if not isinstance(cases, list) or len(cases) != total:
        raise ValueError("baseline cases are missing/incomplete")


def self_test() -> dict[str, Any]:
    sample = {
        "status": "RECORDED",
        "repo_id": EXPECTED_REPO,
        "base_revision": EXPECTED_REVISION,
        "device_name": EXPECTED_GPU,
        "total": 2,
        "passed": 1,
        "accuracy": 0.5,
        "peak_allocated_gib": 7.0,
        "peak_reserved_gib": 7.2,
        "cases": [{}, {}],
    }
    validate_report(sample)
    return {"status": "PASS", "contract": "qwen35-9b-frozen-baseline"}


def run_baseline(
    *,
    materialization_path: Path,
    dataset_path: Path,
    config_path: Path,
    max_new_tokens: int,
) -> dict[str, Any]:
    if max_new_tokens <= 0:
        raise ValueError("max_new_tokens must be positive")
    evidence = _load_json(materialization_path)
    if evidence.get("status") != "MATERIALIZED":
        raise ValueError("core-base materialization status is not MATERIALIZED")
    if evidence.get("repo_id") != EXPECTED_REPO:
        raise ValueError("unexpected materialized repo_id")
    if evidence.get("requested_revision") != EXPECTED_REVISION or evidence.get("resolved_revision") != EXPECTED_REVISION:
        raise ValueError("materialized Core base is not the exact pinned revision")
    local_dir = Path(str(evidence.get("local_dir") or ""))
    if not local_dir.is_dir():
        raise FileNotFoundError(f"materialized Core base directory is missing: {local_dir}")

    cases = _load_cases(dataset_path)
    inference_template = _load_inference_template(config_path)
    _expose_windows_hipinfo()

    import bitsandbytes as bnb
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm/CUDA-compatible torch device is unavailable")
    if torch.cuda.device_count() != 1:
        raise RuntimeError(
            f"expected exactly one visible HIP device, found {torch.cuda.device_count()}; set HIP_VISIBLE_DEVICES=0"
        )
    device_name = torch.cuda.get_device_name(0)
    if device_name != EXPECTED_GPU:
        raise RuntimeError(f"unexpected visible device: {device_name!r}")

    torch.manual_seed(3407)
    torch.cuda.manual_seed_all(3407)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats(0)

    quantization_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(str(local_dir), local_files_only=True, trust_remote_code=False)
    tokenizer.chat_template = inference_template
    model = AutoModelForCausalLM.from_pretrained(
        str(local_dir),
        local_files_only=True,
        trust_remote_code=False,
        device_map={"": 0},
        dtype=torch.bfloat16,
        quantization_config=quantization_config,
    )
    model.eval()

    linear4bit_modules = sum(1 for module in model.modules() if isinstance(module, bnb.nn.Linear4bit))
    if linear4bit_modules <= 0:
        raise RuntimeError("baseline model loaded without bitsandbytes Linear4bit modules")

    rows: list[dict[str, Any]] = []
    passed = 0
    latencies: list[float] = []
    for index, case in enumerate(cases, start=1):
        rendered = tokenizer.apply_chat_template(
            [{"role": "user", "content": case["prompt"]}],
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        )
        if hasattr(rendered, "to"):
            input_ids = rendered.to("cuda")
        else:
            input_ids = torch.tensor([rendered], dtype=torch.long, device="cuda")
        attention_mask = torch.ones_like(input_ids)

        torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            generated = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                do_sample=False,
                max_new_tokens=max_new_tokens,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
                use_cache=True,
            )
        torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - started) * 1000.0
        generated_ids = generated[0, input_ids.shape[-1] :]
        actual = _canonical(tokenizer.decode(generated_ids, skip_special_tokens=True))
        expected = _canonical(case["expected"])
        ok = actual == expected
        passed += int(ok)
        latencies.append(latency_ms)
        rows.append(
            {
                "case": index,
                "prompt_sha256": _prompt_hash(case["prompt"]),
                "expected": expected,
                "actual": actual,
                "exact_match": ok,
                "prompt_tokens": int(input_ids.shape[-1]),
                "generated_tokens": int(generated_ids.shape[-1]),
                "latency_ms": round(latency_ms, 2),
            }
        )

    total = len(rows)
    sorted_latencies = sorted(latencies)
    props = torch.cuda.get_device_properties(0)
    result = {
        "schema_version": 1,
        "status": "RECORDED",
        "evidence_type": "aira-core-frozen-base-baseline",
        "repo_id": EXPECTED_REPO,
        "base_revision": EXPECTED_REVISION,
        "dataset": str(dataset_path.relative_to(ROOT)) if dataset_path.is_relative_to(ROOT) else str(dataset_path),
        "dataset_sha256": _sha256(dataset_path),
        "device_name": device_name,
        "gcn_arch_name": getattr(props, "gcnArchName", None),
        "torch": torch.__version__,
        "torch_hip": torch.version.hip,
        "bitsandbytes": getattr(bnb, "__version__", "unknown"),
        "quant_type": "nf4",
        "compute_dtype": "bfloat16",
        "double_quant": True,
        "linear4bit_modules": linear4bit_modules,
        "seed": 3407,
        "decoding": "greedy",
        "max_new_tokens": max_new_tokens,
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "accuracy": passed / total,
        "all_exact_match": passed == total,
        "p50_latency_ms": round(sorted_latencies[(total - 1) // 2], 2),
        "p95_latency_ms": round(sorted_latencies[min(total - 1, max(0, int(total * 0.95) - 1))], 2),
        "peak_allocated_gib": round(float(torch.cuda.max_memory_allocated(0) / (1024**3)), 4),
        "peak_reserved_gib": round(float(torch.cuda.max_memory_reserved(0) / (1024**3)), 4),
        "total_vram_gib": round(float(props.total_memory / (1024**3)), 4),
        "cases": rows,
        "interpretation": "Untouched frozen-base reference only; low accuracy is not an infrastructure failure.",
    }
    validate_report(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--materialization", type=Path, default=DEFAULT_MATERIALIZATION)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--max-new-tokens", type=int, default=32)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        report = (
            self_test()
            if args.self_test
            else run_baseline(
                materialization_path=args.materialization,
                dataset_path=args.dataset,
                config_path=args.config,
                max_new_tokens=args.max_new_tokens,
            )
        )
    except (OSError, ValueError, RuntimeError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    rendered = json.dumps(report, indent=2, sort_keys=True)
    if not args.self_test:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
