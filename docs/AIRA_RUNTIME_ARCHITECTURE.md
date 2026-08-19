# AIRA Runtime Architecture

## Status

This document describes the architecture AIRA actually owns at the application and orchestration layers. It intentionally does not attribute foundation-model training, transformer internals, GPU cluster topology, provider-side batching, or KV-cache implementation to AIRA unless those systems are operated by AIRA itself.

The design principle is **layered ownership with explicit trust boundaries**: user input, retrieved web content, durable memory, tool outputs, model output, and publication each cross a separately defined boundary.

## 1. Request and access boundary

### Owned by AIRA

- Next.js API routes terminate application requests.
- Authentication and account state are handled before privileged conversation operations.
- Anonymous and authenticated search quotas are enforced separately.
- Zod schemas validate API payload shape.
- The runtime request guard normalizes line endings and Unicode composition and rejects non-text control characters without destructively rewriting legitimate code or user-authored markup.
- Every search request receives an AIRA request correlation ID for operational tracing.
- Search responses stream with Server-Sent Events (SSE).

### Deliberately not claimed

AIRA does not claim ownership of the hosting provider's global Anycast routing, L4/L7 edge fabric, TLS termination implementation, or physical network topology.

## 2. Context assembly and memory

### Owned by AIRA

- Recent conversation turns are loaded from the application database.
- Rolling conversation summaries preserve continuation context.
- Durable user memories are separately curated, ranked, and recalled.
- Relevant prior research can be injected as contextual state.
- An aggregate application-level context budget reserves space for durable memory and retains the newest conversation turns, clipping oversized blocks when necessary.
- Credentials and common secret patterns are excluded from durable memory curation.

The context budget is an application safety and reliability control. It is not a claim about the model provider's native token context length or GPU KV-cache behavior.

## 3. Retrieval and evidence boundary

### Owned by AIRA

- Search results are normalized, deduplicated, ranked, and source-numbered before model synthesis.
- Source-quality heuristics distinguish official, peer-reviewed, preprint, company, blog, aggregator, and unknown sources.
- Third-party excerpts are sanitized for unsafe control/format characters.
- Retrieved excerpts are wrapped in explicit `<aira_untrusted_source_excerpt>` boundaries before model submission.
- Instructions, role changes, tool requests, or citation directives inside retrieved pages are treated as untrusted data rather than executable instructions.
- Citation numbers are validated against the supplied evidence set.

This boundary is designed to reduce indirect prompt-injection risk while preserving legitimate source text for evidence use.

## 4. Model-provider routing and resilience

### Owned by AIRA

- A provider-neutral router selects configured model providers.
- The existing private structured-output and verifier recovery logic is preserved in a core router.
- A resilience facade adds provider health tracking and circuit breaking.
- Transient, quota, and configuration failures can fail over to an isolated fallback provider when no user-visible token has yet been emitted.
- A provider is never switched after partial user-visible output, preventing two unrelated model streams from being concatenated into one answer.
- Buffered private verifier/structured tasks may safely use provider fallback because nothing has been exposed to the user yet.

The current circuit-breaker state is process-local to a warm application instance. A globally coordinated health store is a future scaling option, not a current claim.

## 5. Answer verification and publication boundary

### Owned by AIRA

Substantive agentic answers can pass through:

1. planning / hypothesis generation,
2. independent retrieval,
3. synthesis,
4. private verifier/editor,
5. private publication-quality pass,
6. deterministic publication checks,
7. final fail-closed publication boundary.

Machine-checkable publication checks include citation validity, unsupported cited numbers, durable-state contradictions, and omission of directly relevant recalled assets.

The outer publication boundary re-validates private verifier output independently. If deterministic violations remain after safe sanitization, the result is rejected instead of knowingly publishing an invalid answer.

## 6. Persistence

### Owned by AIRA

- Conversation messages and metadata are persisted in the application database.
- Research history stores query/answer/citation relationships and share identifiers.
- Durable memories are scoped to the authenticated user.
- Memory curation is best-effort and cannot make an otherwise successful conversation turn disappear.

### Not yet implemented in this phase

Semantic vector memory is not being introduced as part of the runtime-resilience change. Adding embeddings/pgvector requires an isolated schema migration, indexing strategy, backfill plan, RLS verification, relevance evaluation, and rollback path.

## 7. Tools and agents

### Owned by AIRA today

- Tools are registered through a typed registry.
- Tool inputs are validated with Zod schemas.
- Existing tools include web search, citation formatting, memory lookup, and calculator capabilities.
- Agentic Deep Research and AutoGPT integration remain separately gated product/runtime paths.

### Not yet implemented in this phase

A general-purpose code-execution sandbox is not equivalent to calling an in-process tool. A production sandbox requires an isolated ephemeral worker boundary, resource/time/network limits, filesystem isolation, artifact controls, abuse monitoring, and explicit authorization policy. It must be implemented and security-reviewed independently.

## 8. Foundation-model infrastructure delegated to providers

Unless AIRA later operates its own model cluster, the following are provider-owned and must not be represented as AIRA infrastructure:

- tokenizer and embedding implementation,
- decoder-only transformer topology,
- attention kernels such as FlashAttention,
- GQA/MQA, RMSNorm, SwiGLU, RoPE, and model-layer design,
- H100/B200/TPU accelerator fleet,
- NVLink/NVSwitch/InfiniBand/RoCE topology,
- tensor/pipeline/data parallelism,
- continuous batching and provider-side scheduling,
- model-side KV-cache/PageAttention implementation,
- SFT, reward-model training, PPO, DPO, safety distillation, and other post-training methods.

AIRA consumes model inference as a dependency and adds its own orchestration, retrieval, memory, tools, resilience, and publication controls around that dependency.

## 9. Operational tracing

AIRA runtime traces use correlation IDs and stage timings. Logs must not intentionally include raw prompts, full answers, durable memory text, credentials, access tokens, API keys, or retrieved source excerpts.

The tracing layer is designed for diagnosing latency/failure stages without turning logs into a secondary store of sensitive conversation content.

## 10. Isolated future phases

The following upgrades should be developed as separate branches/PRs with independent validation:

1. **Semantic memory** — embeddings + pgvector (or equivalent), migration/backfill, RLS, hybrid lexical/vector ranking, quality evaluation and rollback.
2. **Multimodal input** — upload scanning, MIME validation, storage lifecycle, signed access, image/document parsers and model capability routing.
3. **Secure code execution** — ephemeral isolated workers, strict CPU/RAM/time/network/filesystem controls, explicit tool permissions and artifact mediation.
4. **Global provider health** — shared health/backpressure state if traffic volume makes per-instance circuits insufficient.
5. **Queue/backpressure layer** — only if measured traffic and provider capacity demonstrate a need.
6. **Self-hosted inference** — only if AIRA actually provisions and operates model-serving infrastructure; this would require a separate capacity, security, reliability and cost architecture.

## 11. Change-isolation rule

Runtime/infrastructure changes must not be mixed with visual redesigns or unrelated database migrations. Frontend, runtime resilience, vector memory, multimodal processing, sandbox execution, and self-hosted model infrastructure each require separate reviewable changesets.
