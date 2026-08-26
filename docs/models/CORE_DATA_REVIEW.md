# AIRA Core v0 source review

Date: 2026-08-26

This review is evidence for deciding what may enter the AIRA Core v0 training mixture. It does **not** approve any source for training by itself. The committed catalog remains fail-closed until license, provenance, contamination, schema, context-fit, and local-content checks pass for the exact pinned revision.

## Decision policy

A source can move to `approved_for_training=true` only when all applicable gates are explicitly approved for the exact pinned revision. Held/excluded sources cannot be training-approved. A `candidate_filtered` source must define deterministic filters and later prove that the filtered corpus passes contamination and context-fit review.

## Hermes-3

- Repository: `NousResearch/Hermes-3-Dataset`
- Pinned revision: `b1fddbdcae4e6714889365d1e6ce266a45289cc9`
- License: Apache-2.0
- Decision: `HOLD — provenance insufficient`

The card remains too sparse to establish component-level provenance. No training approval.

## ToolACE

- Repository: `Team-ACE/ToolACE`
- Pinned revision: `e0db1bccf18d6d02cbb03b1ecb63fafb21525311`
- License: Apache-2.0
- Declared examples: 11,300
- Pinned data SHA256: `ba12c083fca7e8da48c67ad5b895e495447da7c66e39a2e19742c082e6cb537e`
- Candidate value: function calling and multi-step tool use

The accompanying ToolACE work documents an automatic agentic synthetic-data pipeline with self-evolution API synthesis, multi-agent dialog generation, and dual-layer verification. The released Hugging Face data is tagged synthetic tool data.

### Bounded content audit (500 rows)

- 500/500 normalized
- one high-confidence secret-like row
- redacted classification: `generic_secret_assignment`
- hit occurred in an assistant message
- no raw matched value was emitted

### Exact 9B tokenizer/context profile (500 rows, max_length=2048)

- raw tokens: 475,991
- kept tokens: 463,451
- truncated rows: 16/500 = 3.2%
- raw supervised tokens: 276,750
- kept supervised tokens: 268,206
- supervised retention: 96.9127%
- zero shifted-target rows after truncation: 0
- tokenization errors: 0

### Full declared source audit (11,300 rows)

- audit scope: `full_declared_source`
- declared coverage: 11,300/11,300 = 100%
- normalization: 11,300/11,300 = 100%
- exact duplicate rows: 18
- high-confidence secret-like rows: 7
- all recorded secret-like matches are `generic_secret_assignment`
- the redacted evidence covers 7 unique row hashes; some rows contain repeated matches
- frozen AIRA exact-prompt overlap count: 0
- raw source content and matched secret text were not emitted

The seven secret-bearing rows and all exact duplicates are disallowed from the candidate corpus. Because duplicate and secret filters may overlap, the final accepted candidate count must be measured by deterministic materialization rather than estimated from the aggregate counts.

### Decision

`CANDIDATE_FILTERED`

ToolACE has strong Core-v0 context fit and full declared-source audit coverage, but direct inclusion remains forbidden. The next review-only operator, `materialize_filtered_core_candidate.py`, streams the exact pinned source and applies the same fail-closed filters used by the real builder:

1. reject high-confidence secret-pattern rows;
2. reject exact duplicates;
3. reject frozen-eval exact-prompt overlaps;
4. write a review-only candidate JSONL and build evidence;
5. keep `approved_for_training=false`;
6. require the existing exact + word-trigram near-overlap contamination gate before approval.

## OpenR1-Math-220k

- Repository: `open-r1/OpenR1-Math-220k`
- Pinned revision: `dc748648036c1ed619b020e056dc4b603eb39817`
- License: Apache-2.0
- Selected config/split: `default` / `train`

The dataset card documents NuminaMath 1.5 problems with multiple DeepSeek R1 reasoning traces and verification. The upstream generation process deliberately allows very long reasoning trajectories.

### Exact 9B tokenizer/context profile (500 rows, max_length=2048)

- raw tokens: 3,159,694
- kept tokens: 1,002,200
- truncated rows: 452/500 = 90.4%
- raw supervised tokens: 3,107,512
- kept supervised tokens: 950,922
- supervised retention: 30.6008%
- raw length p50: 5,082 tokens
- raw length p95: 15,234 tokens
- raw length max: 20,079 tokens
- zero shifted-target rows after truncation: 0
- tokenization errors: 0

### Decision

`EXCLUDE_CONTEXT_MISMATCH` for Core-v0.

The 2,048-token Core-v0 recipe would discard roughly 69.4% of assistant-supervised tokens in the bounded sample and truncate 90.4% of rows. Raw inclusion would train primarily on chopped reasoning traces. Reconsider OpenR1 only for a deliberately long-context reasoning recipe with its own contamination and reasoning-target policy.

`approved_for_training` remains `false`.

## Orca AgentInstruct 1M

- Repository: `microsoft/orca-agentinstruct-1M-v1`
- Pinned revision: `a85c5999fb80d333b50c1104dbd770725c545bbe`
- License: CDLA-Permissive-2.0
- Decision: `HOLD — production-use/provenance review required`

The public-web seed provenance is not enumerated at the granularity needed for this production-oriented training decision. No training approval.

## Current Core-v0 mixture decision

No source is training-approved yet.

- Hermes-3: `hold`
- ToolACE: `candidate_filtered`
- OpenR1-Math-220k: `exclude_context_mismatch`
- Orca AgentInstruct 1M: `hold`

The next executable gate is **review-only filtered ToolACE materialization**, followed by the existing exact + near-overlap contamination gate and exact token accounting. Only after those pass may ToolACE's review fields be deliberately promoted; the production dataset builder remains blocked until then.
