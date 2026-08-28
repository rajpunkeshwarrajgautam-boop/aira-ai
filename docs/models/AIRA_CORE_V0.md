# AIRA Core v0

## Status

- Tier: Core
- Release state: `experiment`
- Evidence state: `NOT_TESTED`
- Candidate base: `Qwen/Qwen3.5-9B-Base`
- Production deployment: NO
- OmniRoute availability: NO CLAIM; requires live discovery of `aira/core`
- Soup pin: `MakazhanAlpamys/Soup@6c13c44f5eb6bef67bbd39d83ec7269ac3c31dbf` (`soup-cli` 0.73.3)

## Why this candidate

The 9B Qwen3.5 base is sized appropriately for the first serious Core experiment, is intended for downstream fine-tuning/PEFT, and is inside Soup's explicitly handled Qwen3.5 text-only architecture path at the pinned release. This makes it a strong research candidate, not a predetermined winner.

## Target behavior

Core v0 focuses on:

- reliable instruction/constraint following;
- grounded research and evidence discipline;
- correct AIRA tool selection and arguments;
- repository-level coding/debugging;
- structured outputs;
- RAG behavior and insufficient-evidence detection;
- English, Hindi and Hinglish;
- low hallucination/citation-fabrication rates.

## Current artifacts

- `model-lab/soup/core/sft.yaml`: real 9B candidate recipe; intentionally blocked by missing reviewed train data.
- `model-lab/soup/core/sft-smoke.yaml`: 0.8B environment/pipeline smoke recipe only.
- `model-lab/data/manifests/core-v0.json`: provenance contract, currently `training_allowed=false`.
- `model-lab/eval/configs/core-v0-gate.yaml`: minimal exact smoke gate; not sufficient for model-quality claims.

## Exit gates

Core v0 can move from experiment to candidate only after:

1. the pinned Soup environment passes `soup doctor`;
2. the smoke adapter trains, loads and demonstrably changes deterministic behavior;
3. the real Core dataset manifest is fully populated and `training_allowed=true` after license/provenance/contamination review;
4. the untouched base has a frozen baseline;
5. the 9B SFT run completes with retained run evidence;
6. target metrics improve materially without unacceptable regressions;
7. serving is verified on a persistent inference runtime;
8. OmniRoute discovers the exact `aira/core` model ID and inference/streaming pass;
9. AIRA normal tests/build remain green.

## Explicit non-claims

No benchmark has been run against the Core candidate in this repository. No tuned 9B checkpoint exists from this iteration. No claim of class-leading or frontier capability is valid yet.
