# AIRA Agent Platform — Current Architecture

## Scope

This document records the architecture that exists in AIRA before the autonomous agent operating-system expansion. It is intentionally factual: a capability is listed only when the repository already owns an implementation or adapter for it.

## Web control plane

AIRA's primary web application is a Next.js application. Authenticated agent runs are exposed through `/api/agents/runs` and persisted in the shared Prisma/PostgreSQL data model as user-owned `AgentRun` records.

Existing controls on agent submission include:

- authenticated user ownership,
- idempotent client request IDs,
- billing-plan and monthly-run enforcement,
- safety-policy admission,
- foundation control-plane capacity leasing,
- server-only runtime credentials,
- cached run state when a remote runtime temporarily cannot be reached.

## Existing autonomous runtimes

AIRA already integrates two external execution paths:

1. **DeerFlow** — preferred long-horizon runtime when configured and healthy. It supports submission, live reconciliation, artifact/result extraction and cancellation.
2. **AutoGPT** — established fallback runtime. It supports graph submission and live execution reconciliation.

The original API route selected these runtimes directly. The new `lib/agent-runtime` boundary introduced on `feat/aira-agent-runtime-foundation` moves that selection behind an AIRA-owned interface without changing the default order.

## Existing foundation services

The repository already includes infrastructure for a separate execution plane, including:

- a foundation control plane,
- sandbox and sandbox gateway services,
- admission/backpressure policy,
- AutoGPT runner infrastructure,
- DeerFlow runner infrastructure,
- an AIRA edge/runtime deployment profile,
- desktop-agent browser/computer/tool policy code.

These components mean the new platform must converge existing systems rather than create a second unrelated worker stack.

## Existing intelligence layers

AIRA already owns important layers that remain upstream of any worker runtime:

- provider-neutral model routing and resilience,
- request validation and runtime tracing,
- safety gateway,
- conversation memory,
- persistent user memory,
- semantic and graph-memory infrastructure,
- typed tool registries,
- web/research/citation tooling,
- agent run reconciliation.

## Persistence today

`AgentRun` is intentionally small and provider-neutral enough to represent a remote execution:

- user owner,
- client idempotency key,
- provider,
- remote execution ID,
- graph/runtime identifier,
- objective,
- normalized status,
- result/error,
- timestamps.

Stage 1 does not alter this schema. Task DAGs, worker instances, browser sessions, events and approvals require later additive migrations with independent rollback and authorization review.

## Change-isolation rule

The existing runtime architecture explicitly requires runtime/infrastructure changes, UI redesigns and unrelated database migrations to remain independently reviewable. The autonomous-platform work follows the same rule: foundation first, then swarm orchestration, then browser execution, then build UI, with verification between stages.
