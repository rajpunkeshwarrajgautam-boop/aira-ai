# AIRA Model Evaluation Policy

Evaluation is the promotion mechanism for AIRA-native models. Training completion is not evidence of improvement.

## Two-suite design

1. **Public standardized suite** for comparability.
2. **Private contamination-resistant AIRA suite** for real product work: grounded research, citations, tool calls, repository coding, agent recovery, RAG, business tasks, English/Hindi/Hinglish and structured outputs.

Freeze and hash evaluation inputs before tuning against them.

## Required capability groups

- knowledge: MMLU-Pro or current successor;
- scientific reasoning: GPQA Diamond or current successor;
- mathematics: current AIME/competition-style sets;
- coding: LiveCodeBench plus repository-level engineering; SWE-bench Verified/current successor where operationally feasible;
- instruction following: IFEval plus AIRA constraint suites;
- tools: BFCL/current successor plus exact AIRA tool schemas;
- agents: multi-step execution, failure recovery and stopping correctness;
- long context: retrieval and multi-document reasoning;
- RAG/research: factuality, groundedness, citation precision/recall and freshness;
- hallucination: fabricated sources/APIs/repos and unsupported confidence;
- multilingual: English, Hindi and Hinglish;
- business: market, sales, product, financial and operating analysis.

## Frontier comparison protocol

For each frozen prompt, record the exact model/version, date, raw response, sampling settings, tools, token usage, latency and cost. Compare:

- untouched base;
- current AIRA candidate;
- strongest comparable open-weight model;
- representative current closed frontier models.

Subjective tasks use blind randomized pairwise evaluation, more than one judge, and a stratified human-review sample. A single LLM judge is never the sole promotion authority.

## Statistics

Use repeated runs where stochastic, bootstrap confidence intervals, benchmark variance and effect sizes. A numerically higher single run is not automatically a win.

## Evidence states

- `NOT_TESTED`: no qualifying evaluation.
- `BASELINE`: reproducible untouched-base results recorded.
- `IMPROVED`: target metrics improve materially without unacceptable regressions.
- `CLASS_LEADING`: reproducibly leads the agreed compute/parameter/cost peer group.
- `FRONTIER_COMPETITIVE`: statistically wins or ties the agreed frontier matrix broadly.
- `FRONTIER_LEADING`: independent/reproducible evidence supports broad frontier leadership.

A coding-only win cannot promote a model to broad `FRONTIER_LEADING`.

## AIRA scorecard

Do not hide weaknesses in one aggregate score. Maintain separate reasoning, coding, tool/agent, research/RAG, instruction, multilingual, latency, memory and cost-efficiency scores. A weighted AIRA Intelligence Index may be reported only alongside the component scores and its frozen weights.

## Regression gate

Every candidate compares against both its untouched base and the previous accepted AIRA release. Reject or investigate material regressions in tool calling, coding, structured output, instruction following, factuality or multilingual behavior even when the target task improves.

The committed `core-v0-gate.yaml` is a smoke contract only. It is insufficient for any capability claim.
