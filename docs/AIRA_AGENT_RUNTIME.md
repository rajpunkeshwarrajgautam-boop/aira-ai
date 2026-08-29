# AIRA Agent Runtime

This document describes implemented code on `feat/aira-production-agent-os`. It intentionally distinguishes runtime foundation from integration that is not yet live.

## Existing authoritative systems kept intact

AIRA already has:

- authenticated `AgentRun` ownership and quota enforcement
- DeerFlow and AutoGPT remote execution adapters
- immutable `AgentRunEvent` lifecycle persistence
- durable `RUN_STEP` projections
- restart/reconciliation checkpoints
- persisted human tool approvals
- one canonical Zod-validated ToolRegistry
- MCP tools registered through that same registry
- provider routing/fallback/circuit logic

The new runtime does not replace these systems.

## New AIRA-owned runtime contracts

Location: `perplexity-clone/my-turborepo/apps/web/lib/agent-runtime`

### Roles

- manager
- planner
- researcher
- coder
- browser_operator
- designer
- analyst
- verifier

### Task states

- pending
- ready
- running
- waiting_for_tool
- waiting_for_approval
- blocked
- verifying
- retrying
- completed
- failed
- cancelled

### Task graph

`TaskGraph` is a DAG of `RuntimeTask` objects with explicit dependencies. `validateTaskGraph` rejects:

- empty task IDs
- duplicate IDs
- missing dependencies
- self-dependencies
- cycles

`reconcileTaskReadiness` promotes tasks to ready only when all dependencies completed and marks downstream work blocked when a dependency failed/cancelled/blocked.

### Scheduler

`planSchedulerTick` is deterministic and side-effect free. It:

- reconciles dependency readiness
- enforces delegation depth
- enforces retry ceilings
- checks global execution budgets
- honors maximum concurrent agents
- selects ready/retrying work by priority then stable plan order
- returns the next graph plus explicit started/blocked/failed task IDs

The scheduler decides; a caller is responsible for durable persistence and actual dispatch.

### Execution budget

Default foundation limits are explicit rather than prompt-only:

- maximum concurrent agents
- maximum delegation depth
- retries per task
- tool calls
- tokens
- estimated USD cost
- run duration
- repeated identical actions

`ExecutionMeter` maintains observed run usage. `AgentRuntimeBudgetError` stops execution when a configured ceiling is reached. `AgentRuntimeLoopError` blocks action fingerprints repeated beyond policy.

### Planner

`planObjective` uses the existing ProviderRouter by default and supports injected routers for deterministic tests.

Planner output is JSON-only and Zod-validated. The parser bounds:

- task count
- task IDs
- titles/descriptions
- dependencies
- role choices
- priorities

The plan is validated as a DAG. A final verifier is mandatory: if the model omits one, the parser appends an independent final verification task depending on leaf worker tasks. A verifier cannot be a dependency of worker work.

No model-provided text bypasses schema/graph validation.

### Verifier

`verifyOutcome` uses a separate verification prompt/router call and emits only:

- PASS
- FAIL
- NEEDS_HUMAN_APPROVAL

with a bounded summary, observable evidence, failures and repair instructions.

PASS with unresolved failures is rejected at parse time. The verifier is explicitly instructed not to treat worker claims as proof and not to invent test/deployment/browser evidence.

### Role policy

Before canonical tool execution, specialist roles receive least-privilege permission classes:

- manager/planner/researcher: READ
- coder: READ, WRITE, CODE_EXECUTION
- browser_operator: READ, BROWSER_ACTION
- designer: READ, BROWSER_ACTION
- analyst: READ, CODE_EXECUTION
- verifier: READ, BROWSER_ACTION

No role receives EXTERNAL_COMMUNICATION, ACCOUNT_MUTATION, DESTRUCTIVE or HIGH_IMPACT by default.

This is additive defense. The canonical ToolRegistry still performs final availability, schema and persisted-approval enforcement.

### Budgeted ToolRegistry wrapper

`BudgetedToolExecutor` does not create another tool implementation. It:

1. obtains the user-scoped public descriptor from the canonical ToolRegistry
2. checks role capability
3. confirms the tool has a real executable registration
4. applies run/action-loop budget metering
5. delegates to `globalToolRegistry.executeTool`

Therefore MCP, Zod validation and approval policy remain single-sourced.

### Run-step projection

Runtime tasks project into the existing durable `RUN_STEP` ledger with stable `agent-task:<id>` keys. This allows Run Center convergence without inventing a parallel UI-only activity store.

## Current integration boundary

The new Planner/DAG/Scheduler is not yet the production `/api/agents/runs` submission path. Existing DeerFlow/AutoGPT submission still maps one AIRA `AgentRun` to one opaque remote provider execution.

That limitation is intentional and truthful: the UI must not portray model-generated task cards as independently running specialist agents until AIRA actually dispatches those tasks.

## Next runtime integration

The safe integration sequence is:

1. persist the validated execution plan under the parent run
2. make child task state restart-safe
3. dispatch real specialists through explicit executor adapters
4. persist every transition/tool/approval result
5. use verifier FAIL to request bounded retry/replan
6. aggregate artifacts/usage/evidence into the parent completion result
7. expose those persisted states in Run Center

If remote DeerFlow/AutoGPT executions become child workers, parent/child identity and quota/economic semantics must be explicit rather than hidden in client request IDs.

## Validation history

- Commit `ecf042c30f3857c65ce48d917175ed100e624097`: DAG/scheduler foundation; CI #615 passed.
- Commit `c8f617266b9da80f5ea29cd9c33cca3f9faa3879`: planner/verifier/policy foundation; CI #616 exposed Node strip-only constructor parameter-property incompatibility.
- Commit `1c26e24ba2f4621e460ad99fbff1fc3c96076cc8`: compatibility fix; CI #617 validates audit, lint, typecheck, tests, build and all runtime/foundation jobs.
