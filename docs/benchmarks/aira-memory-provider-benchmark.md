# Aira memory-provider benchmark

Status: **in progress**. This benchmark branch is intentionally isolated from Production and from PR #152's runtime path.

## Goal

Compare AgentMemory and Mem0 as Aira's durable cross-chat memory backend. This benchmark does **not** replace Aira's native active-thread continuity. Same-chat references such as `it`, `this`, `the second one`, or `make them shorter` remain the responsibility of Aira Conversation Intelligence.

## Providers under test

### AgentMemory

Current PR #152 adapter. Aira communicates with the external AgentMemory REST service using a bearer secret, a deterministic HMAC-derived pseudonymous `agentId`, and an independently HMAC-derived project scope. The adapter fails closed when returned rows do not carry the expected tenant principal.

### Mem0

Benchmark-only adapter using the current Mem0 Platform REST API:

- `POST /v3/memories/add/`
- `POST /v3/memories/search/`
- `Authorization: Token <API key>`
- pseudonymous Aira identity sent as Mem0 `user_id`
- HMAC project scope stored in metadata and re-validated by Aira after retrieval

The Mem0 benchmark code is not imported by Aira's normal cognitive runtime and cannot become active without explicit benchmark environment variables.

## Aira-specific test matrix

1. Cross-chat durable recall.
2. Same-user continuity across a new session.
3. Cross-user leakage rejection.
4. Project/workspace isolation.
5. Correction handling: old fact then corrected fact.
6. Conflicting-memory handling.
7. Temporal/current-state retrieval.
8. 100+ stored-memory retrieval quality.
9. Semantic paraphrase recall.
10. Exact/keyword recall.
11. Irrelevant-memory suppression.
12. Private/no-memory routing (Aira policy; provider must not be called).
13. Credential/secret write filtering.
14. Provider outage and timeout behavior.
15. Write latency.
16. Recall latency.
17. Context characters/tokens returned to Aira.
18. Operational complexity and Vercel compatibility.

## Safety rules

- Production is never used as a benchmark target.
- Only synthetic benchmark memories are written.
- Raw Aira user IDs and raw project IDs are never sent to either external provider.
- Secret-like content is rejected before external memory writes.
- Aira re-validates tenant/project scope after retrieval instead of trusting provider filtering alone.
- Live tests are disabled unless `AIRA_MEMORY_PROVIDER_LIVE_BENCHMARK=true` is explicitly set.
- Mem0 benchmark access additionally requires `AIRA_MEM0_BENCHMARK_ENABLED=true` plus a dedicated API key and HMAC salt.
- AgentMemory live benchmarking requires the existing Preview-only AgentMemory URL, bearer secret, and entity salt.

## Current phase

Phase 1 creates the provider-neutral security contract and a gated live benchmark harness. CI can verify the contracts without any external credentials. Live retrieval quality and latency numbers are not considered measured until both dedicated benchmark services/credentials are configured and the gated live case runs successfully.

## Decision rule

Do not replace AgentMemory based on repository popularity, claimed benchmark numbers, or feature lists alone. Aira should choose a durable-memory provider only after the same synthetic dataset is run against both providers and the results show acceptable isolation, recall quality, correction behavior, latency, failure handling, and operating complexity.
