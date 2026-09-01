# AIRA Agent Runtime Contract

## Purpose

`lib/agent-runtime` is the stable boundary between AIRA's product/control plane and an autonomous execution engine.

The interface prevents API routes and UI code from depending directly on DeerFlow, AutoGPT, Agent Swarm or a future provider.

## Core contract

Every runtime declares:

- a stable runtime ID,
- capabilities,
- enabled/configured/readiness state,
- health inspection,
- run creation,
- run reconciliation.

Operations such as cancel, pause, resume, steering, events and artifacts are capability-gated. AIRA must not expose an operation merely because another runtime supports it.

## Normalized run state

Existing `AgentRunStatus` remains the public normalized state during Stage 1. Remote provider states are mapped into AIRA states by the adapter.

Agent Swarm mapping includes:

- backlog/unassigned/offered/reviewing/pending -> `QUEUED`,
- in_progress -> `RUNNING`,
- paused -> `REVIEW`,
- completed -> `COMPLETED`,
- failed -> `FAILED`,
- cancelled/superseded -> `TERMINATED`.

A later additive task schema may expose richer task-level states without mutating this compatibility contract.

## Runtime selection

Default priority deliberately preserves current behavior:

```text
DEERFLOW,AUTOGPT,AGENT_SWARM
```

The priority may be overridden by `AIRA_AGENT_RUNTIME_PRIORITY`. Invalid or duplicate entries are ignored and safe fallbacks are appended.

Explicit runtime requests fail closed when the runtime is missing, disabled or unavailable.

## Agent Swarm configuration

Agent Swarm remains opt-in:

- `AGENT_SWARM_ENABLED=true`
- `AGENT_SWARM_BASE_URL=https://...`
- `AGENT_SWARM_API_TOKEN=...`
- optional `AGENT_SWARM_MODEL_TIER=smol|regular|smart|ultra`
- optional `AGENT_SWARM_TIMEOUT_MS=...`

Production non-loopback connections require HTTPS. Credentials are sent as a bearer token and are never written into the local `AgentRun` record.

## Submission safety

AIRA retains its own idempotency key and creates a local pending run before remote submission. If a network failure leaves the remote submission outcome unknown, AIRA marks the local run failed and deliberately does not retry automatically, because a blind retry could create duplicate autonomous work.

Quota is refunded only when AIRA can determine that the remote submission was not accepted.

## Next extension

Stage 2 should introduce task-DAG primitives behind the same control plane rather than overloading `AgentRun` with worker/task details. Agent Swarm's task API can then implement task creation, dependencies, pause/resume, steering, worker allocation and event retrieval while AIRA-native runtimes implement the same logical contract independently.
