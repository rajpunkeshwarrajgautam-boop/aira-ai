# AIRA v1 Product Specification

## Product promise

AIRA v1 is an AI workforce workspace that can research, reason, use authorized tools, operate supported computer/browser surfaces, coordinate specialist work, preserve durable context, verify outcomes and return evidence-backed results and artifacts.

AIRA v1 is not defined by chat parity. The differentiator is reliable execution with visibility, permission boundaries and recovery.

## Primary users

- founders and operators
- software/product teams
- agencies
- developers
- small businesses and AI-native teams

## Core product surfaces

### Workspace

- chat and saved conversations
- model/provider selection through server-owned routing policy
- file/knowledge context
- persistent memory
- global search
- model comparison
- settings/integrations
- Agent Run Center

### Agent roles

- Manager: owns objective and orchestration
- Planner: creates dependency-aware tasks
- Researcher: evidence/source work
- Analyst: structured/quantitative synthesis
- Designer: information architecture/UX inspection
- Coder: authorized repository/file/code work
- Browser Operator: semantic browser observation/action
- Verifier: independent acceptance check

## Runtime contract

Target execution flow:

`User objective -> Manager -> Planner -> validated DAG -> bounded scheduler -> specialist executors -> canonical tools/providers -> Verifier -> bounded repair/replan or final result`

The runtime must never manufacture agent progress. A task is shown as running/completed only from a real scheduler/executor state transition.

## Safety/reliability requirements

- deterministic graph validation
- configurable concurrency ceiling
- delegation-depth ceiling
- retry ceiling
- run-time ceiling
- token/tool-call/cost budgets where measurable
- repeated-action loop detection
- role-scoped tool permissions
- canonical tool schema validation
- approval enforcement for side effects/high impact
- immutable run/event history
- restart-safe execution state
- explicit cancellation and failure states
- independent verification before final completion when the workflow requires it

## Provider architecture

AIRA remains provider-agnostic. Existing provider routing, DeerFlow and AutoGPT adapters are preserved. Provider adapters are execution backends, not product-level managers. AIRA owns the objective, task graph, permissions, durable state and final verification.

## Desktop

Windows remains a first-class execution surface. AIRA Desktop provides local-first access to local/Ollama models and privileged local tools inside Electron security/approval boundaries. Desktop capability must be validated on a physical/VM Windows acceptance matrix before release claims are expanded.

## Flagship v1 workflow

`Build this business/app for me` is the flagship proof of the architecture:

1. research market/competitors
2. define product/ICP/value proposition/acceptance criteria
3. design information architecture and UI requirements
4. implement in an authorized workspace
5. run tests/build
6. inspect in browser
7. repair failures
8. deploy only when configured and authorized
9. verify the deployed outcome
10. return evidence, changed files, tests, screenshots, deployment/artifacts, limitations and usage

## Product telemetry

Primary metrics:

- meaningful task completion rate
- human interventions per completed task
- time to successful result
- estimated cost per successful result
- first completed agent run activation
- D1/D7 retention, later D30
- weekly completed agent runs
- verifier failure rate
- retry/replan rate
- tool/provider failure rate

## v1 non-goals

- a large public marketplace before reliability/retention
- autonomous destructive/account/financial actions without explicit authorization
- unlimited recursive agents
- fake browser/coder capabilities on surfaces where the execution runtime is unavailable
- vanity dashboards in place of execution evidence
- replacing working provider/tool/auth/persistence architecture merely for uniformity

## Definition of done for the product milestone

The milestone is complete only when one complex objective demonstrably produces a persisted plan, real specialist execution, authorized tool use, browser/coding activity where required, independent verification, bounded recovery and a durable completion report; the Windows installer also passes physical lifecycle acceptance. A green compile alone is insufficient.
