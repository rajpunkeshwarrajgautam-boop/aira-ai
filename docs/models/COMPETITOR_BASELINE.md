# AIRA Competitor Baseline — 26 August 2026

This document defines the comparison set for the native-model program. It is a discovery snapshot, not an AIRA benchmark report. Public vendor scores are not copied into AIRA result columns because AIRA has not yet run the same frozen harness against these models.

## Current frontier reference set

| Lab | Current reference family/model | Why it belongs in the comparison set | AIRA-harness score |
| --- | --- | --- | --- |
| OpenAI | GPT-5.6 family (Sol / Terra / Luna) | Current OpenAI reasoning/general-purpose family; Sol is the flagship reference | NOT RUN |
| Anthropic | Claude Fable 5 / Claude Opus 5 | Current Anthropic frontier references for difficult knowledge/coding/agent work | NOT RUN |
| Google | Gemini 3.7 Flash plus current highest-capability Gemini offering at evaluation time | Current Google workhorse/frontier reference; refresh exact flagship before each frozen run | NOT RUN |
| xAI | Grok 4.6 | Current xAI reference for long-running agents, coding and knowledge work | NOT RUN |
| DeepSeek | DeepSeek-V4 family | Current DeepSeek frontier reference | NOT RUN |
| Alibaba/Qwen | strongest current Qwen 3.5/3.6/3.8 open-weight tier applicable to the parameter/cost class | Required open-weight peer family and candidate-base neighborhood | NOT RUN |
| Moonshot | Kimi K3 | Current Kimi flagship reference | NOT RUN |
| Z.ai | GLM-5.2 | Current GLM flagship reference | NOT RUN |
| Meta | strongest current commercially usable Llama/open family applicable at evaluation time | Required open-weight peer/reference | NOT RUN |
| Mistral | Mistral Large 3 plus the strongest current class-matched Mistral model | Open-weight frontier/reference family | NOT RUN |

## Core-class comparison

AIRA Core v0 currently selects `Qwen/Qwen3.5-9B-Base` as its research base candidate. Before promotion, the harness must compare at minimum:

1. the exact untouched base revision;
2. the tuned AIRA Core candidate;
3. the strongest current open-weight model in roughly the same 7B–10B / inference-cost class;
4. at least one stronger open-weight model to measure size-efficiency;
5. representative closed frontier models for a system-level reference ceiling.

The class-matched open peer must be re-discovered immediately before the frozen benchmark run; do not freeze a stale model name merely because it appears in this document.

## Comparison rules

- Same frozen prompts and scoring policy for all models.
- Record exact model/version/date; aliases are insufficient evidence.
- Record sampling parameters, tool availability, context treatment, latency, tokens and cost.
- Do not compare a raw AIRA model with a competitor that has browsing/tools and call the result a raw-model win. Maintain separate raw-model and system-level tracks.
- Do not use vendor-published benchmark numbers as substitutes for the AIRA frozen harness.
- Refresh this discovery snapshot before a release-candidate evaluation.

## Current claim state

AIRA Edge: `NOT_TESTED`  
AIRA Core: `NOT_TESTED`  
AIRA Pro: `NOT_TESTED`  
AIRA Ultra: `NOT_TESTED`  
AIRA Apex: `NOT_TESTED`
