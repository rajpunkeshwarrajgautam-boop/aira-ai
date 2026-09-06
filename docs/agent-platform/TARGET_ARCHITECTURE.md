# AIRA Agent Platform — Target Architecture

## Design goal

AIRA remains the product and control plane. Execution engines are replaceable implementation details behind AIRA-owned contracts.

```text
AIRA Web / API
      |
Runtime Orchestrator
      |
+-----+--------------------+
| Context | Policy | DAG   |
+-----+--------------------+
      |
Manager / Lead Agent
      |
Specialist workers
      |
AIRA Tool Gateway
      |
Browser | Git | Terminal | Files | MCP | APIs
      |
Execution runtime adapters
      |
AIRA Native | DeerFlow | AutoGPT | Agent Swarm | future runtimes
```

## Control plane

The control plane owns:

- authentication and tenancy,
- projects and objectives,
- runtime selection,
- normalized run/task states,
- policy and approvals,
- model-tier routing,
- memory retrieval,
- event streaming,
- audit logs,
- cost/resource budgets,
- artifact metadata,
- user steering.

The web request path must not pretend to be a persistent worker.

## Execution plane

The execution plane owns long-running or privileged work:

- repository workspaces,
- terminal processes,
- builds and tests,
- browser sessions,
- code editing,
- isolated worker lifecycles,
- external tool execution.

Execution workers may be hosted by Agent Swarm, AIRA-native worker infrastructure, E2B-compatible sandboxes or future providers. AIRA communicates with them through the `AgentRuntime` boundary and typed events.

## Runtime priority

The initial compatibility order is:

1. DeerFlow
2. AutoGPT
3. Agent Swarm

This intentionally preserves production behavior. `AIRA_AGENT_RUNTIME_PRIORITY` may explicitly alter the order after a runtime is deployed and verified.

Agent Swarm is disabled by default and requires explicit configuration.

## Staged expansion

### Stage 1 — runtime foundation

- provider-neutral runtime interface,
- legacy adapters,
- Agent Swarm adapter,
- deterministic selection,
- existing run API migration,
- no schema migration.

### Stage 2 — swarm task model

Add user-owned project/task/worker/event tables, DAG scheduling, leases, retries, steering and failure recovery. These are additive migrations.

### Stage 3 — developer workers

Add isolated worktrees/sandboxes, Git mediation, terminal policy, artifact collection and integration gates.

### Stage 4 — browser runtime

Add isolated browser sessions, domain/action scopes, screenshots, DOM/accessibility/network/console observations and human takeover.

### Stage 5 — Build workspace

Add `/build` only after the execution surfaces are real. UI states must derive from durable backend state, never simulation.

### Stage 6+ — memory, skills, deployment and hardening

Add project/procedural memory, reusable skills, production deployment agents, verification evidence, observability and workload testing.

## Compatibility principle

Every new capability must be additive. A runtime may advertise only operations it genuinely supports. AIRA must fail closed for unsupported operations and must distinguish implemented, tested, deployed and production-verified states.
