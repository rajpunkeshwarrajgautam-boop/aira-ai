# AIRA Model Lab

This directory is the offline/model-operations boundary for AIRA-native model work. It is intentionally separate from the Next.js/Vercel request runtime.

## Scope

- Dataset provenance, linting and frozen evaluation inputs.
- Soup-driven SFT/preference experiments, regression gates, merge/export and local serving.
- Reproducible model cards and experiment evidence.
- No private chats, emails, files, memories, credentials or production database rows are training data by default.

## Pinned upstream

- Project: `MakazhanAlpamys/Soup`
- Package: `soup-cli`
- Verified upstream commit for this scaffold: `6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf`
- Version declared by that commit: `0.73.3`
- Python: `>=3.10,<3.13`

Use the commit pin in `requirements/soup-pin.txt`; do not replace it with a floating `main` dependency for reproducible runs.

## First target

`AIRA Core v0` uses `Qwen/Qwen3.5-9B-Base` as the first 7–9B-class candidate. This is a candidate selection, not a benchmark win or production release.

The small `sft-smoke.yaml` recipe uses `Qwen/Qwen3.5-0.8B` only to verify the end-to-end Soup environment before downloading/training the 9B candidate.

## Status vocabulary

Capability claims use only:

- `NOT_TESTED`
- `BASELINE`
- `IMPROVED`
- `CLASS_LEADING`
- `FRONTIER_COMPETITIVE`
- `FRONTIER_LEADING`

No state advances without reproducible evidence.

## Local AMD gate

The project workstation is an RX 9070 XT (gfx1201, 16 GiB). Current AMD/ROCm and bitsandbytes documentation indicates Windows support for gfx1201, but this repository has not yet run Soup training on that host. Therefore local AMD training remains `PARTIALLY_VERIFIED` until all of these pass in an isolated Python 3.12 environment:

1. ROCm-enabled PyTorch imports and sees the GPU.
2. `bitsandbytes` imports with the ROCm backend.
3. `soup doctor` reports a usable accelerator.
4. `soup train --config model-lab/soup/core/sft-smoke.yaml` completes.
5. The produced adapter loads and changes deterministic outputs versus the base.

Do not install nightly GPU stacks system-wide merely to make this gate pass.

## Normal workflow

```text
baseline -> failure analysis -> hypothesis -> data change -> Soup training -> eval -> regression gate -> keep/reject -> export -> OmniRoute discovery -> AIRA
```

See `docs/models/` for architecture, training, evaluation and deployment policy.