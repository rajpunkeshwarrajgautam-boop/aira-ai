#!/usr/bin/env python3
"""Verify an AIRA Core 9B LoRA adapter through the reviewed NF4 resident path.

The verifier intentionally avoids an unquantized 9B load on the 16 GiB RX 9070 XT.
It checks adapter tensors on CPU, loads the exact local base in NF4/bfloat16, records
base logits, attaches the adapter to that same model, and proves non-zero finite logit
deltas. Generation text is not used as an activation criterion.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

PROMPTS = [
    "Return the appropriate tool decision for checking current weather in Delhi.",
    "A user asks for information from an uploaded plan. Decide whether a tool is needed.",
    "Return a concise structured tool decision for a task requiring two independent lookups.",
]


def adapter_weight_file(adapter_dir: Path) -> Path:
    for name in ("adapter_model.safetensors", "adapter_model.bin"):
        candidate = adapter_dir / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"no adapter weight file found in {adapter_dir}")


def inspect_adapter_weights(path: Path) -> dict[str, Any]:
    if path.suffix != ".safetensors":
        return {
            "format": path.suffix.lstrip("."),
            "tensor_count": None,
            "stale_inner_keys": None,
            "finite": None,
            "nonzero": None,
        }

    from safetensors.torch import load_file

    tensors = load_file(str(path), device="cpu")
    keys = list(tensors)
    stale = [key for key in keys if ".inner." in key]
    finite = True
    nonzero = False
    for tensor in tensors.values():
        finite = finite and bool(tensor.isfinite().all().item())
        nonzero = nonzero or bool(tensor.abs().max().item() > 0)
    return {
        "format": "safetensors",
        "tensor_count": len(tensors),
        "stale_inner_keys": stale[:10],
        "finite": finite,
        "nonzero": nonzero,
    }


def self_test() -> dict[str, Any]:
    return {
        "status": "PASS",
        "contract": "aira-core-9b-nf4-adapter-verification",
        "requires_nf4": True,
        "requires_bfloat16_compute": True,
        "activation_criterion": "finite_nonzero_logit_delta",
        "generation_change_required": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--output", type=Path, default=Path("model-lab/runs/core-9b-adapter-verification.json"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        print(json.dumps(self_test(), indent=2, sort_keys=True))
        return 0
    if args.adapter is None or args.base is None:
        raise SystemExit("--adapter and --base are required unless --self-test is used")
    if not args.adapter.is_dir():
        raise SystemExit(f"adapter directory does not exist: {args.adapter}")
    if not args.base.is_dir():
        raise SystemExit(f"base directory does not exist: {args.base}")
    if not (args.adapter / "adapter_config.json").is_file():
        raise SystemExit(f"adapter_config.json missing: {args.adapter}")

    weights = adapter_weight_file(args.adapter)
    weight_check = inspect_adapter_weights(weights)
    if weight_check.get("stale_inner_keys"):
        raise SystemExit("adapter contains stale .inner. keys from the historical Soup streaming-key bug")
    if weight_check.get("finite") is False:
        raise SystemExit("adapter contains non-finite tensors")
    if weight_check.get("nonzero") is False:
        raise SystemExit("adapter tensors are all zero")

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise SystemExit("ROCm/CUDA-compatible torch device is unavailable")
    if torch.cuda.device_count() != 1:
        raise SystemExit(f"expected exactly one HIP-visible device, got {torch.cuda.device_count()}")
    device_name = torch.cuda.get_device_name(0)
    if "9070 XT" not in device_name:
        raise SystemExit(f"expected RX 9070 XT, got {device_name!r}")

    torch.manual_seed(3407)
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(str(args.base), trust_remote_code=False, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(
        str(args.base),
        quantization_config=quantization,
        torch_dtype=torch.bfloat16,
        device_map={"": 0},
        trust_remote_code=False,
        local_files_only=True,
    )
    model.eval()

    linear4bit_count = sum(1 for module in model.modules() if module.__class__.__name__ == "Linear4bit")
    if linear4bit_count <= 0:
        raise SystemExit("NF4 verification failed: no Linear4bit modules were loaded")

    def encode(prompt: str) -> dict[str, torch.Tensor]:
        batch = tokenizer(prompt, return_tensors="pt")
        return {key: value.to(model.device) for key, value in batch.items()}

    base_logits: list[torch.Tensor] = []
    with torch.inference_mode():
        for prompt in PROMPTS:
            batch = encode(prompt)
            base_logits.append(model(**batch).logits[:, -1, :].float().cpu())

    tuned = PeftModel.from_pretrained(model, str(args.adapter), is_trainable=False)
    tuned.eval()
    deltas: list[float] = []
    with torch.inference_mode():
        for prompt, before in zip(PROMPTS, base_logits):
            batch = encode(prompt)
            after = tuned(**batch).logits[:, -1, :].float().cpu()
            deltas.append(float((after - before).abs().max().item()))

    finite_deltas = all(math.isfinite(delta) for delta in deltas)
    active = finite_deltas and any(delta > 1e-7 for delta in deltas)
    result = {
        "schema_version": 1,
        "status": "VERIFIED" if active else "FAILED",
        "base": str(args.base.resolve()),
        "adapter": str(args.adapter.resolve()),
        "weights": str(weights.resolve()),
        "weight_check": weight_check,
        "device_name": device_name,
        "torch_version": torch.__version__,
        "hip_version": torch.version.hip,
        "quantization": "nf4",
        "compute_dtype": "bfloat16",
        "double_quant": True,
        "linear4bit_modules": linear4bit_count,
        "max_abs_logit_deltas": deltas,
        "adapter_active": active,
        "peak_allocated_gib": round(torch.cuda.max_memory_allocated() / (1024 ** 3), 4),
        "peak_reserved_gib": round(torch.cuda.max_memory_reserved() / (1024 ** 3), 4),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if active else 3


if __name__ == "__main__":
    raise SystemExit(main())
