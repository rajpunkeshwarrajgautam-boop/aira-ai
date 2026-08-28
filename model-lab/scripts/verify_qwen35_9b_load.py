#!/usr/bin/env python3
"""Verify the exact AIRA Core 9B base can load and execute in NF4 on RX 9070 XT.

This is a model/runtime gate, not a quality benchmark. It consumes the exact local
snapshot recorded by materialize_hf_model.py, loads it with the same NF4/bfloat16
policy as the Core QLoRA recipe, asserts bitsandbytes 4-bit modules are actually
present, and performs a real forward pass on the designated isolated GPU.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATERIALIZATION = ROOT / "model-lab/runs/materialized-core-base.json"
DEFAULT_OUTPUT = ROOT / "model-lab/runs/qwen35-9b-nf4-load.json"
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


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} root must be an object")
    return value


def validate_report(report: dict[str, Any]) -> None:
    if report.get("status") != "PASS":
        raise ValueError("report status is not PASS")
    if report.get("repo_id") != EXPECTED_REPO:
        raise ValueError("unexpected repo_id")
    if report.get("base_revision") != EXPECTED_REVISION:
        raise ValueError("unexpected base revision")
    if report.get("device_name") != EXPECTED_GPU:
        raise ValueError("9B gate did not execute on the designated RX 9070 XT")
    if report.get("quant_type") != "nf4":
        raise ValueError("quant_type must be nf4")
    if not isinstance(report.get("linear4bit_modules"), int) or report["linear4bit_modules"] <= 0:
        raise ValueError("no bitsandbytes Linear4bit modules were found")
    for field in ("logits_mean_abs", "peak_allocated_gib", "peak_reserved_gib"):
        value = report.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{field} must be numeric")
        if not math.isfinite(float(value)) or float(value) <= 0:
            raise ValueError(f"{field} must be finite and positive")


def self_test() -> dict[str, Any]:
    sample = {
        "status": "PASS",
        "repo_id": EXPECTED_REPO,
        "base_revision": EXPECTED_REVISION,
        "device_name": EXPECTED_GPU,
        "quant_type": "nf4",
        "linear4bit_modules": 1,
        "logits_mean_abs": 0.2,
        "peak_allocated_gib": 5.0,
        "peak_reserved_gib": 5.5,
    }
    validate_report(sample)
    return {"status": "PASS", "contract": "qwen35-9b-nf4-load"}


def run_gate(materialization_path: Path) -> dict[str, Any]:
    evidence = load_json(materialization_path)
    if evidence.get("status") != "MATERIALIZED":
        raise ValueError("core-base materialization status is not MATERIALIZED")
    if evidence.get("repo_id") != EXPECTED_REPO:
        raise ValueError(f"expected {EXPECTED_REPO}, got {evidence.get('repo_id')!r}")
    if evidence.get("requested_revision") != EXPECTED_REVISION or evidence.get("resolved_revision") != EXPECTED_REVISION:
        raise ValueError("materialized Core base is not the exact pinned revision")

    local_dir = Path(str(evidence.get("local_dir") or ""))
    if not local_dir.is_dir():
        raise FileNotFoundError(f"materialized Core base directory is missing: {local_dir}")

    _expose_windows_hipinfo()

    import torch
    import bitsandbytes as bnb
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm/CUDA-compatible torch device is unavailable")
    if torch.cuda.device_count() != 1:
        raise RuntimeError(
            f"expected exactly one visible HIP device, found {torch.cuda.device_count()}; "
            "set HIP_VISIBLE_DEVICES=0 before running"
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

    tokenizer = AutoTokenizer.from_pretrained(
        str(local_dir),
        local_files_only=True,
        trust_remote_code=False,
    )
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
        raise RuntimeError("model loaded without any bitsandbytes Linear4bit modules")

    prompt = "AIRA Core runtime preflight: return the word READY."
    batch = tokenizer(prompt, return_tensors="pt")
    batch = {key: value.to("cuda") for key, value in batch.items()}

    with torch.inference_mode():
        output = model(**batch)
        logits = output.logits[:, -1, :]
        if not torch.isfinite(logits).all().item():
            raise RuntimeError("9B NF4 forward produced non-finite logits")
        next_token = int(torch.argmax(logits, dim=-1).item())
        torch.cuda.synchronize()

    peak_allocated = torch.cuda.max_memory_allocated(0) / (1024**3)
    peak_reserved = torch.cuda.max_memory_reserved(0) / (1024**3)
    props = torch.cuda.get_device_properties(0)

    result = {
        "schema_version": 1,
        "status": "PASS",
        "repo_id": EXPECTED_REPO,
        "base_revision": EXPECTED_REVISION,
        "model_class": type(model).__name__,
        "device_name": device_name,
        "gcn_arch_name": getattr(props, "gcnArchName", None),
        "torch": torch.__version__,
        "torch_hip": torch.version.hip,
        "bitsandbytes": getattr(bnb, "__version__", "unknown"),
        "quant_type": "nf4",
        "compute_dtype": "bfloat16",
        "double_quant": True,
        "linear4bit_modules": linear4bit_modules,
        "prompt_tokens": int(batch["input_ids"].shape[-1]),
        "vocab_logits": int(logits.shape[-1]),
        "next_token_id": next_token,
        "logits_mean_abs": float(logits.float().abs().mean().item()),
        "peak_allocated_gib": round(float(peak_allocated), 4),
        "peak_reserved_gib": round(float(peak_reserved), 4),
        "total_vram_gib": round(float(props.total_memory / (1024**3)), 4),
    }
    validate_report(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--materialization", type=Path, default=DEFAULT_MATERIALIZATION)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        result = self_test() if args.self_test else run_gate(args.materialization)
    except Exception as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, indent=2))
        return 2

    rendered = json.dumps(result, indent=2, sort_keys=True)
    if not args.self_test:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
