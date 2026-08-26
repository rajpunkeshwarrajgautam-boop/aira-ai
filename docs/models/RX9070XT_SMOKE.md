# RX 9070 XT Soup execution gate

Status: `PARTIALLY_VERIFIED`

This runbook is the only path that may promote the workstation backend to `VERIFIED`. Vendor support matrices and successful imports are necessary but insufficient; the host must complete a real Soup training step and prove the resulting adapter changes base-model logits.

## Preconditions

- Windows 11 workstation with AMD Radeon RX 9070 XT (`gfx1201`).
- Python 3.12 available through the Windows Python launcher (`py -3.12`).
- Sufficient free disk space for the isolated environment, Qwen3.5-0.8B model cache, training artifacts and temporary files.
- Repository checked out on `feature/aira-model-family-soup` at the intended reviewed commit.

Do not install the model-training stack into the system Python environment.

## One-command gate

From the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\model-lab\scripts\windows\run-rx9070xt-smoke.ps1
```

Probe only, without training:

```powershell
powershell -ExecutionPolicy Bypass -File .\model-lab\scripts\windows\run-rx9070xt-smoke.ps1 -ProbeOnly
```

Reuse an already-created isolated environment:

```powershell
powershell -ExecutionPolicy Bypass -File .\model-lab\scripts\windows\run-rx9070xt-smoke.ps1 -SkipDependencyInstall
```

## What the operator does

1. Captures Windows/GPU/driver metadata into ignored `model-lab/runs/` evidence.
2. Creates `.venv-model-lab` with Python 3.12.
3. Installs AMD's gfx1201-targeted ROCm PyTorch wheels rather than a CUDA build.
4. Installs the exact Soup commit pinned by `model-lab/requirements/soup-pin.txt`.
5. Runs `verify_amd_backend.py`, including HIP, AMD device, bitsandbytes, Transformers, PEFT, TRL, datasets, accelerate and `soup doctor` checks.
6. Validates the smoke JSONL through Soup.
7. Hashes the smoke dataset and training config.
8. Runs the Qwen3.5-0.8B Soup SFT recipe.
9. Rejects an adapter with the historical stale `.inner.` key pattern, non-finite tensors or all-zero tensors.
10. Loads base and tuned models on the accelerator and requires a deterministic non-zero logit delta.
11. Writes an ignored machine-readable run record.

## Promotion rule

`LOCAL_AMD_TRAINING=VERIFIED` is allowed only if the script reaches:

```text
AIRA RX 9070 XT SOUP SMOKE = VERIFIED
```

A successful package installation or `soup doctor` result alone remains `PARTIALLY_VERIFIED`.

## Failure classification

Capture the first causal error and classify it as one of:

- ROCm/runtime
- PyTorch wheel/device
- bitsandbytes backend
- Transformers/Qwen architecture
- PEFT/TRL
- Soup
- dataset/config
- memory
- Windows loader/runtime

Repair the smallest causal defect and rerun the same gate. Do not replace AMD with CUDA assumptions and do not incur paid cloud compute without explicit approval.

## Evidence hygiene

`.venv-model-lab/`, `model-lab/runs/` and `model-lab/artifacts/` are ignored. Do not commit model weights, machine-specific caches, private data, tokens or provider credentials.
