#!/usr/bin/env python3
"""Fail-closed bitsandbytes NF4 forward/backward preflight for the AMD training host.

This intentionally exercises the exact class of 4-bit kernel the AIRA Core 9B
QLoRA recipe depends on before downloading the full model weights.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

DEFAULT_OUTPUT = Path("model-lab/runs/bnb-4bit-backend.json")


def validate_report(report: dict[str, Any]) -> None:
    if report.get("status") != "PASS":
        raise ValueError("report status is not PASS")
    if report.get("quant_type") != "nf4":
        raise ValueError("quant_type must be nf4")
    if report.get("device_name") != "AMD Radeon RX 9070 XT":
        raise ValueError("preflight did not run on the designated RX 9070 XT")
    for field in ("output_mean_abs", "input_grad_mean_abs"):
        value = report.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{field} must be numeric")
        if not math.isfinite(float(value)) or float(value) <= 0:
            raise ValueError(f"{field} must be finite and positive")


def self_test() -> dict[str, Any]:
    sample = {
        "status": "PASS",
        "quant_type": "nf4",
        "device_name": "AMD Radeon RX 9070 XT",
        "output_mean_abs": 0.25,
        "input_grad_mean_abs": 0.01,
    }
    validate_report(sample)
    return {"status": "PASS", "contract": "bnb-nf4-report"}


def run_probe() -> dict[str, Any]:
    import torch
    import bitsandbytes as bnb

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm/CUDA-compatible torch device is unavailable")
    if torch.cuda.device_count() != 1:
        raise RuntimeError(
            f"expected exactly one visible HIP device, found {torch.cuda.device_count()}; "
            "set HIP_VISIBLE_DEVICES=0 before running"
        )

    device_name = torch.cuda.get_device_name(0)
    if device_name != "AMD Radeon RX 9070 XT":
        raise RuntimeError(f"unexpected visible device: {device_name!r}")

    torch.manual_seed(3407)
    torch.cuda.manual_seed_all(3407)

    # Linear4bit quantizes its FP32 weight when transferred to the accelerator.
    layer = bnb.nn.Linear4bit(
        64,
        32,
        bias=False,
        compute_dtype=torch.bfloat16,
        compress_statistics=True,
        quant_type="nf4",
    )
    layer = layer.to("cuda")

    x = torch.randn(
        2,
        8,
        64,
        device="cuda",
        dtype=torch.bfloat16,
        requires_grad=True,
    )
    y = layer(x)
    if not torch.isfinite(y).all().item():
        raise RuntimeError("NF4 forward produced non-finite output")

    loss = y.float().square().mean()
    loss.backward()
    torch.cuda.synchronize()

    if x.grad is None:
        raise RuntimeError("NF4 backward produced no input gradient")
    if not torch.isfinite(x.grad).all().item():
        raise RuntimeError("NF4 backward produced non-finite input gradient")

    result = {
        "schema_version": 1,
        "status": "PASS",
        "device_name": device_name,
        "gcn_arch_name": getattr(torch.cuda.get_device_properties(0), "gcnArchName", None),
        "torch": torch.__version__,
        "torch_hip": torch.version.hip,
        "bitsandbytes": getattr(bnb, "__version__", "unknown"),
        "quant_type": "nf4",
        "compute_dtype": "bfloat16",
        "shape": {"batch": 2, "sequence": 8, "in_features": 64, "out_features": 32},
        "output_mean_abs": float(y.detach().float().abs().mean().item()),
        "input_grad_mean_abs": float(x.grad.detach().float().abs().mean().item()),
    }
    validate_report(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        result = self_test() if args.self_test else run_probe()
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
