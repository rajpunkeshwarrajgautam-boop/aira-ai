# AIRA Core v0 source review

Date: 2026-08-26

This review is evidence for deciding what may enter the AIRA Core v0 training mixture. It does **not** approve any source for training by itself. The committed catalog remains fail-closed until license, provenance, contamination, schema, and local-content checks all pass for the exact pinned revision.

## Decision policy

A source can move to `approved_for_training=true` only when all of the following are true for the exact pinned revision:

1. license terms are reviewed and compatible with the intended AIRA training/release use;
2. origin/provenance is sufficiently documented to understand what the prompts and targets came from;
3. local bounded audit passes normalization/schema/secret/exact-eval checks;
4. full selected corpus passes the committed contamination gate before manifest promotion;
5. exact local file/split hashes and build evidence are recorded;
6. no review relies on a moving `main` revision.

## Source: Hermes-3

- Repository: `NousResearch/Hermes-3-Dataset`
- Pinned revision: `b1fddbdcae4e6714889365d1e6ce266a45289cc9`
- Declared license: Apache-2.0
- Approximate scale: 959k rows / 1.7 GB JSONL
- Candidate value: broad instruction following, coding, tool use, and general assistance.

### Review

The exact repository exposes the dataset and Apache-2.0 metadata, but the dataset card at the pinned/current revision is extremely sparse and does not provide enough component-level provenance to establish where the constituent prompts/answers originated or whether upstream datasets impose additional constraints.

### Decision

`HOLD — provenance insufficient`

Do not mark training-approved until upstream component provenance is documented and a bounded local audit succeeds.

## Source: ToolACE

- Repository: `Team-ACE/ToolACE`
- Pinned revision: `e0db1bccf18d6d02cbb03b1ecb63fafb21525311`
- Declared license: Apache-2.0
- Exact pinned data SHA256: `ba12c083fca7e8da48c67ad5b895e495447da7c66e39a2e19742c082e6cb537e`
- Approximate scale: 11.3k rows
- Candidate value: function calling and multi-step tool use.

### Review

The released corpus is explicitly synthetic tool-use data and is tied to the ToolACE work. The exact pinned README contains only license metadata, so provenance/process evidence must be bound to the accompanying paper/project evidence rather than inferred from the tiny README alone. The corpus contains synthetic APIs/tool outputs, so schema normalization and behavior-fit review are required before treating it as AIRA-native tool data.

### Decision

`CONDITIONAL — audit first`

License metadata is clear enough for continued evaluation, but keep `approved_for_training=false` until bounded schema/content audit and contamination review pass.

## Source: OpenR1-Math-220k

- Repository: `open-r1/OpenR1-Math-220k`
- Pinned revision: `dc748648036c1ed619b020e056dc4b603eb39817`
- Declared license: Apache-2.0
- Selected config/split: `default` / `train`
- Approximate selected scale: 93.7k problems
- Candidate value: mathematical reasoning and verifiable answer discipline.

### Review

The pinned dataset card documents a clear generation chain: problems originate from NuminaMath 1.5; DeepSeek R1 generates multiple reasoning traces; Math Verify validates most samples, with Llama-3.3-70B-Instruct judging a subset. This is materially stronger provenance than Hermes. However, NuminaMath aggregates competition/problem sources, so benchmark overlap and source-family contamination remain material release risks. Long chain-of-thought traces also require deliberate policy on whether AIRA should train on full hidden reasoning-style text versus concise answer behavior.

### Decision

`CONDITIONAL — provenance clear, contamination/policy review required`

Keep training approval false until source-family contamination and reasoning-target policy are resolved.

## Source: Orca AgentInstruct 1M

- Repository: `microsoft/orca-agentinstruct-1M-v1`
- Pinned revision: `a85c5999fb80d333b50c1104dbd770725c545bbe`
- Declared license: CDLA-Permissive-2.0
- Approximate scale: ~1M synthetic instruction pairs
- Candidate value: general instruction following, coding, reading comprehension, and creative work.

### Review

Microsoft documents this as fully synthetic prompt/response data generated through AgentInstruct using publicly available web text as seeds. The dataset card frames direct use around research/instruction-tuning experimentation, recommends additional validation for real-world tasks, and identifies synthetic-data inaccuracies/generalization limits. The seed-level public-web provenance is not enumerated at the granularity needed for a production training decision.

### Decision

`HOLD — production-use/provenance review required`

Do not train AIRA Core on this source yet. A permissive dataset license does not substitute for seed provenance, intended-use review, and contamination evidence.

## Current mixture decision

No source is approved for the real Core build yet.

The next executable step is a bounded, non-training local audit using `model-lab/scripts/audit_core_sources.py`. That operator streams only a limited number of rows from exact pinned revisions, records hashes/statistics instead of raw prompts, checks normalization, high-confidence secret patterns, exact duplicates, and exact collisions with the frozen AIRA sanity prompts. Passing the bounded audit is necessary but not sufficient for training approval.
