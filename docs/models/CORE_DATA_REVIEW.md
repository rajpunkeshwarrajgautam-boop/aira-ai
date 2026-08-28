# AIRA Core v0 source review

Date: 2026-08-26

This review is evidence for deciding what may enter the AIRA Core v0 training mixture. It does **not** approve any source for training by itself. The committed catalog remains fail-closed until license, provenance, contamination, schema, context-fit, tool-format, and local-content checks pass for the exact pinned revision.

## Decision policy

A source can move to `approved_for_training=true` only when all applicable gates are explicitly approved for the exact pinned revision. Held/excluded sources cannot be training-approved. A `candidate_filtered` source must define deterministic filters and prove that its final normalized representation passes contamination, context-fit, and serving/tool-format parity review.

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

The accompanying ToolACE work documents an automatic agentic synthetic-data pipeline with self-evolution API synthesis, multi-agent dialog generation, and dual-layer verification. The released source embeds available tool definitions in a top-level system prompt and uses source-specific bracket notation for assistant tool calls.

### Full declared source audit

- 11,300 / 11,300 rows covered and normalized
- 7 secret-like rows detected in the generic message-only representation
- 18 exact duplicates in that representation
- 0 frozen AIRA exact-prompt overlaps
- raw secret/source content not emitted

### Candidate v1 — messages only — superseded

The first review materialization intentionally used the generic Core normalizer. It accepted 11,275 rows and passed exact + near-overlap contamination with 0 exact and 0 semantic hits. It also retained 99.05% of supervised tokens at 2,048 tokens.

However, v1 dropped ToolACE's top-level system/tool-definition context. Therefore its clean contamination/token evidence remains historical review evidence only and cannot authorize training.

### Candidate v2 — raw ToolACE system context preserved

The context-preserving materializer produced:

- 11,300 / 11,300 source rows normalized
- 11,300 / 11,300 rows with system/tool context preserved
- 11,288 accepted rows
- 9 secret-like rows rejected after including system context
- 3 exact duplicates rejected after including system context
- 9,292 rows with assistant bracket tool calls
- 10,012 assistant bracket-call messages
- candidate SHA256 `5cdf46c1266e40b5458057d4ff35cfb4d6aa1f543aba07f1dcb4cbf2cf5736dd`

Strict token accounting correctly failed because candidate line 9 loses every shifted assistant target under right truncation at 2,048 tokens.

### Complete v2 token diagnostic

A diagnostic-only full scan then measured all 11,288 rows without weakening the strict training gate:

- raw tokens: 8,420,091
- kept tokens: 8,368,673
- raw supervised tokens: 898,839
- kept supervised tokens: 867,272
- supervised retention: 96.4880%
- truncated rows: 117 / 11,288 = 1.0365%
- zero shifted-target rows after truncation: 27 / 11,288 = 0.2392%
- zero-supervision rows before truncation: 0
- tokenization errors: 0
- first assistant token offset p50: 597
- first assistant token offset p95: 1,176
- raw length p50: 668
- raw length p95: 1,445

This shows raw system/tool context is **not** a corpus-wide context-window mismatch. The 27 zero-target rows form a small deterministic rejection tail; wholesale schema compression is not justified by the measured context fit.

### Tool-format parity — still open

The dominant remaining problem is representation semantics, not context length:

- more than 82% of ToolACE source rows contain bracket-style assistant tool calls;
- the raw ToolACE system instruction teaches the same bracket-call convention;
- AIRA Desktop expects JSON tool decisions of the form `{"type":"tool","tool":"tool_name","args":{...}}`;
- the AIRA web runtime exposes runtime tool identifiers that do not exactly match the frozen model-router labels (`files_search` / `memory_search` versus `knowledge` / `memory_lookup`).

Therefore the final ToolACE representation must deterministically:

1. preserve the row's available tool definitions;
2. replace the source-specific bracket-call instruction with an AIRA canonical tool-decision instruction;
3. parse and convert assistant bracket calls without inventing tool names or arguments;
4. preserve tool-result and ordinary assistant turns;
5. reject any row that cannot be converted losslessly;
6. reject any row that loses every shifted assistant target at 2,048 tokens;
7. rerun exact token accounting and contamination on the final normalized representation;
8. prove serving/runtime parity before `tool_format_review=approved`.

`analyze_toolace_format.py` is the next non-training gate. It scans the exact pinned source and reports schema extraction success, bracket-call parser success, single/multi-call distribution, call-name membership in each row's tool schema, and immediate tool-result structure. It emits aggregate counts and hashes only.

### Current ToolACE decision

`CANDIDATE_FILTERED` — **not training-approved**.

The context window is acceptable after a small deterministic tail filter, but the source format must still be normalized to AIRA's canonical tool contract and proven equivalent at serving time.

## OpenR1-Math-220k

- Repository: `open-r1/OpenR1-Math-220k`
- Pinned revision: `dc748648036c1ed619b020e056dc4b603eb39817`
- License: Apache-2.0
- Decision: `EXCLUDE_CONTEXT_MISMATCH` for Core-v0

At max_length=2048, 90.4% of the bounded sample truncates and only 30.6008% of assistant-supervised tokens survive. Reconsider only for a deliberate long-context reasoning recipe.

## Orca AgentInstruct 1M

- Repository: `microsoft/orca-agentinstruct-1M-v1`
- Pinned revision: `a85c5999fb80d333b50c1104dbd770725c545bbe`
- License: CDLA-Permissive-2.0
- Decision: `HOLD — production-use/provenance review required`

The public-web seed provenance is not enumerated at the granularity needed for this production-oriented training decision. No training approval.

## Current Core-v0 mixture decision

No source is training-approved yet.

- Hermes-3: `hold`
- ToolACE: `candidate_filtered` — context fit is acceptable after a 27-row zero-target tail rejection; tool-format analysis/normalization/parity pending
- OpenR1-Math-220k: `exclude_context_mismatch`
- Orca AgentInstruct 1M: `hold`

The next executable gate is the full ToolACE source-format analyzer. QLoRA remains blocked until the final normalized candidate passes strict token accounting, contamination, and tool-format parity.
