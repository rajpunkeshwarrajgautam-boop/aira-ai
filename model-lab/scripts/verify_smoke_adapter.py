#!/usr/bin/env python3
"""Verify that the AIRA Core smoke adapter is real, loadable, finite, and active.

This check intentionally compares base logits with base+adapter logits on deterministic
text prompts. It is stronger than checking that a trainer process exited successfully.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

BASE_MODEL = "Qwen/Qwen3.5-0.8B"
DEFAULT_ADAPTER = Path("model-lab/artifacts/aira-core-smoke")
PROMPTS = [
    "Choose exactly one tool name: web_search, files_search, memory_search, or none. Find today's USD to INR exchange rate.",
    "Answer using only evidence. Evidence: deployment status is READY. Question: what was latency?",
    "Return only valid JSON with keys intent and confidence for: summarize this quarterly report.",
]


def adapter_weight_file(adapter_dir: Path) -> Path:
    for name in ("adapter_model.safetensors", "adapter_model.bin"):
        candidate = adapter_dir / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"no adapter weight file found in {adapter_dir}")


def inspect_safetensors(path: Path) -> dict[str, Any]:
    if path.suffix != ".safetensors":
        return {"format": path.suffix.lstrip("."), "stale_inner_keys": None, "finite": None, "nonzero": None}
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    parser.add_argument("--base", default=BASE_MODEL)
    parser.add_argument("--max-new-tokens", type=int, default=48)
    args = parser.parse_args()

    adapter_dir = Path(args.adapter)
    if not adapter_dir.is_dir():
        raise SystemExit(f"adapter directory does not exist: {adapter_dir}")
    config_path = adapter_dir / "adapter_config.json"
    if not config_path.is_file():
        raise SystemExit(f"adapter_config.json missing: {config_path}")

    weights = adapter_weight_file(adapter_dir)
    weight_check = inspect_safetensors(weights)
    if weight_check.get("stale_inner_keys"):
        raise SystemExit("adapter contains stale .inner. keys associated with the old Soup streaming-key bug")
    if weight_check.get("finite") is False:
        raise SystemExit("adapter contains non-finite tensors")
    if weight_check.get("nonzero") is False:
        raise SystemExit("adapter tensors are all zero")

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise SystemExit("ROCm/CUDA-compatible torch device is unavailable; do not treat CPU fallback as the AMD smoke gate")

    tokenizer = AutoTokenizer.from_pretrained(args.base, trust_remote_code=False)
    base = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype="auto",
        device_map={"": 0},
        trust_remote_code=False,
    )
    base.eval()

    def encoded(prompt: str) -> dict[str, torch.Tensor]:
        batch = tokenizer(prompt, return_tensors="pt")
        return {key: value.to(base.device) for key, value in batch.items()}

    base_logits: list[torch.Tensor] = []
    base_generations: list[str] = []
    with torch.inference_mode():
        for prompt in PROMPTS:
            batch = encoded(prompt)
            logits = base(**batch).logits[:, -1, :].float().cpu()
            base_logits.append(logits)
            generated = base.generate(
                **batch,
                do_sample=False,
                max_new_tokens=args.max_new_tokens,
                pad_token_id=tokenizer.eos_token_id,
            )
            base_generations.append(tokenizer.decode(generated[0][batch["input_ids"].shape[1]:], skip_special_tokens=True))

    tuned = PeftModel.from_pretrained(base, str(adapter_dir), is_trainable=False)
    tuned.eval()
    tuned_logits: list[torch.Tensor] = []
    tuned_generations: list[str] = []
    with torch.inference_mode():
        for prompt in PROMPTS:
            batch = encoded(prompt)
            logits = tuned(**batch).logits[:, -1, :].float().cpu()
            tuned_logits.append(logits)
            generated = tuned.generate(
                **batch,
                do_sample=False,
                max_new_tokens=args.max_new_tokens,
                pad_token_id=tokenizer.eos_token_id,
            )
            tuned_generations.append(tokenizer.decode(generated[0][batch["input_ids"].shape[1]:], skip_special_tokens=True))

    deltas = [float((after - before).abs().max().item()) for before, after in zip(base_logits, tuned_logits)]
    active = any(delta > 1e-7 and math.isfinite(delta) for delta in deltas)
    generation_changed = any(a != b for a, b in zip(base_generations, tuned_generations))

    result = {
        "schema_version": 1,
        "base": args.base,
        "adapter": str(adapter_dir),
        "weights": str(weights),
        "weight_check": weight_check,
        "max_abs_logit_deltas": deltas,
        "adapter_active": active,
        "deterministic_generation_changed": generation_changed,
        "base_outputs": base_generations,
        "tuned_outputs": tuned_generations,
        "status": "VERIFIED" if active else "FAILED",
    }

    out = Path("model-lab/runs/smoke-adapter-verification.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if active else 3


if __name__ == "__main__":
    raise SystemExit(main())
