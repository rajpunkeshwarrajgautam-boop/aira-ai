# AIRA Core-v0 Data Source Review

Status: **FAIL CLOSED — no source is training-approved unless every required review gate is explicit and reproducible.**

## ToolACE — conditional filtered candidate

Source: `Team-ACE/ToolACE`

Exact revision: `e0db1bccf18d6d02cbb03b1ecb63fafb21525311`

License: Apache-2.0.

Provenance: synthetic tool-use/function-calling data generated through the documented ToolACE pipeline. The source remains reviewable only at the exact pinned revision.

### Source integrity evidence

A full declared-source audit covered **11,300 / 11,300** rows at the pinned revision. Every row normalized. The audit detected **7 rows** containing high-confidence `generic_secret_assignment` patterns, **18 exact duplicates** under the earlier message-only representation, and **0 frozen AIRA exact-prompt overlaps**. Secret evidence was hash-only/redacted.

### Candidate v1 — superseded for training

The first review candidate accepted **11,275** rows after secret filtering and exact deduplication. It passed the frozen exact/near-overlap contamination gate across all 11,275 prompts and retained **99.0488%** of assistant-supervised tokens at 2,048 tokens, with only **16** truncated rows.

However, v1 used the generic Core normalizer, which dropped ToolACE's top-level `system` field. That field carries the available function/tool definitions and composition instructions. Therefore v1's clean contamination and token evidence is preserved as historical review evidence but **cannot authorize training**.

### Candidate v2 — raw ToolACE system context preserved

The context-preserving materializer produced:

- 11,300 rows seen/normalized;
- top-level system/tool context preserved on all 11,300 rows;
- 11,288 rows accepted;
- 9 rows rejected by the high-confidence secret filter;
- 3 exact duplicates rejected under the context-preserving representation;
- 9,292 rows with assistant bracket-style tool calls;
- 10,012 assistant bracket-call messages;
- candidate SHA256 `5cdf46c1266e40b5458057d4ff35cfb4d6aa1f543aba07f1dcb4cbf2cf5736dd`.

Strict 2,048-token accounting on v2 **failed closed at line 9** because right truncation left no shifted assistant target. This proves that preserving the raw ToolACE system/tool block verbatim is also not an acceptable Core-v0 training representation.

A diagnostic-only scanner now measures the complete zero-target/truncation distribution without weakening the strict training counter. It emits hash-only failure evidence, never raw source content, never returns training authorization, and is covered by the model-lab CI self-test contract.

### Tool-format parity

Original ToolACE assistant calls use source-specific bracket syntax such as `[Function(arg=value)]`. AIRA runtime tools use different concrete IDs/contracts, and AIRA Desktop expects JSON tool decisions. More than 82% of ToolACE rows contain bracket-style assistant calls, so format normalization is a corpus-level requirement, not an edge-case cleanup.

Before ToolACE can be approved, the training representation must:

1. retain enough tool schema/context to make each call meaningful;
2. compact or select schemas so assistant targets survive the 2,048-token contract;
3. normalize source bracket calls into an explicit AIRA model-facing tool contract;
4. preserve tool-result association and multi-call semantics;
5. pass strict token accounting with zero shifted-target failures;
6. pass the frozen exact + word-trigram near-overlap contamination gate on the final representation;
7. pass explicit tool-format/serving parity review.

`approved_for_training` remains **false**.

## OpenR1-Math-220k — excluded from Core-v0

Source: `open-r1/OpenR1-Math-220k`

Exact revision: `dc748648036c1ed619b020e056dc4b603eb39817`

A 500-row exact-tokenizer profile under the committed 2,048-token recipe showed:

- 90.4% of rows truncated;
- only 30.6008% of assistant-supervised tokens retained;
- p50 raw length 5,082 tokens;
- p95 raw length 15,234 tokens.

Decision: **exclude from Core-v0**. Reconsider only for a deliberately long-context reasoning recipe.

## Hermes-3 — hold

License metadata is clear, but the source card does not yet provide enough component-level provenance for production training approval. Keep `approved_for_training=false`.

## Orca AgentInstruct 1M — hold

The corpus is synthetic and derived from public-web seeds with model-generated instructions. Keep blocked pending provenance, intended-use, and production/legal review.

## Current ordering

1. diagnose ToolACE v2 zero-target/truncation distribution;
2. design AIRA-specific tool-schema compaction and bracket-call normalization;
3. materialize final normalized ToolACE review candidate;
4. strict 2,048-token accounting;
5. exact + near-overlap contamination gate;
6. explicit ToolACE license/provenance/context/tool-format approvals;
7. deterministic Core train/validation/holdout build;
8. AIRA Core 9B QLoRA;
9. post-SFT evaluation against the frozen 2/6 base baseline.
