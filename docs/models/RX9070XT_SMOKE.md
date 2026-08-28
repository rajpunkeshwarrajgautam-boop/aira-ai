# RX 9070 XT Soup execution gate

Status: `PARTIALLY_VERIFIED`

This runbook is the only path that may promote the workstation backend to `VERIFIED`. Vendor support matrices and successful imports are necessary but insufficient; the host must complete a real Soup training step and prove the resulting adapter changes base-model logits.

## Pinned inputs

- Soup commit: `6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf` (`soup-cli 0.73.3`).
- Smoke model: `Qwen/Qwen3.5-0.8B`.
- Smoke model revision: `2fc06364715b967f1860aea9cf38778875588b17`.
- Core candidate: `Qwen/Qwen3.5-9B-Base`.
- Core candidate revision: `68c46c4b3498877f3ef123c856ecfde50c39f404`.

The operator resolves the requested Hub revision, refuses a mismatched resolved SHA, downloads that exact snapshot into the ignored model cache, and generates an ignored runtime Soup YAML pointing at the local immutable snapshot. A moving Hugging Face `main` therefore cannot silently change the experiment weights.

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
6. Resolves and materializes the exact reviewed Qwen3.5-0.8B Hub revision.
7. Generates a runtime Soup config whose `base:` points at that immutable local snapshot.
8. Validates the smoke JSONL through Soup.
9. Hashes the smoke dataset, committed recipe and generated runtime config.
10. Runs the Qwen3.5-0.8B Soup SFT recipe.
11. Rejects an adapter with the historical stale `.inner.` key pattern, non-finite tensors or all-zero tensors.
12. Loads base and tuned models on the accelerator and requires a deterministic non-zero logit delta.
13. Writes an ignored machine-readable run record including the exact resolved base revision.

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

`.venv-model-lab/`, `model-lab/cache/`, `model-lab/runs/` and `model-lab/artifacts/` are ignored. Do not commit model weights, machine-specific caches, private data, tokens or provider credentials.
