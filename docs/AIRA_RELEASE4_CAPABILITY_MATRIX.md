# AIRA Release 4 — Capability Matrix

| Capability / Subsystem | Phase | Preview Status | Architecture & Execution Summary |
| :--- | :--- | :--- | :--- |
| **AIRA Route & Model Failover** | Phase 2 | `WORKING_E2E_IN_PREVIEW` | Certified OmniRoute failover, non-leak headers, and model routing |
| **AIRA Knowledge RAG & Ingestion** | Phase 3 | `WORKING_E2E_IN_PREVIEW` | 768-dim PGVector search, 6-format document parser, worker token auth |
| **Agent Definition** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Authoritatively bound to execution path with user ownership and CRUD store |
| **Single-Agent Execution** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Single-agent execution via `AgentRuntime` registry (`DEERFLOW`) |
| **Tools Gateway** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Risk-classified tool gateway with `AgentDefinition` allowlist enforcement |
| **Knowledge Integration** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Certified Phase 3 PGVector search context injected into agent execution |
| **Memory Integration** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | User conversation & project memory context injected into agent execution |
| **MCP Bridge** | Phase 4 | `CONFIGURATION_BLOCKED` | MCP adapter implemented; external MCP servers optional |
| **Agent Run Cancellation** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Provider cancellation endpoint with terminal state (`TERMINATED`) |
| **Agent Run Timeout** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Bounded duration budget enforcement (`WORKFLOW_AGENT_TIMEOUT`) |
| **Agent Run Outputs** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Persisted step outputs and artifact references |
| **Agent Event Timeline** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Authenticated JSON polling timeline (`AUTHENTICATED_JSON_POLLING`) |
| **AIRA Browser** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Local Docker worker via Cloudflare Quick Tunnel certified E2E in Preview (workstation-dependent) |
| **Browser Sessions** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Authoritative session binding, per-user limits, and truthful lifecycle states |
| **Browser Actions** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Safe actions (navigate, inspect, scroll, hover, back, forward, wait) and approval-gated mutations |
| **Browser Screenshots** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Ephemeral, authenticated viewport screenshots with rate limits and no-store headers |
| **Agent → Browser** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Server-enforced AgentDefinition allowlist, auto-session binding, and untrusted content wrapper |
| **Human Takeover** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Mutual exclusion lease boundary preventing Agent/Human race conditions |
| **Browser Security** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Network & app dual-layer SSRF defense, redirect re-validation, sanitized diagnostics |
| **Browser Cancellation** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Remote window.stop() task abort, lease release, and truthful BROWSER_CANCELLED status |
| **Browser Timeout** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Reconciled client/worker timeout hierarchy preventing zombie background tasks |
| **Browser Rate Limiting** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Distributed PostgreSQL sliding window limiter active across serverless instances |
| **Local Docker Preview Runtime** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Local Docker + Cloudflare Quick Tunnel transport; zero cost, zero card, zero vendor lock-in |
| **Preview Runtime Availability** | Phase 5 | `PARTIAL` | Dependent on workstation being powered on with Docker & cloudflared running |
| **Railway Preview Runtime** | Phase 5 | `RAILWAY_FREE_NO_CARD_DEPLOYMENT_BLOCKED` | Container deployment requires credit card / paid billing; zero-card deployment blocked by Railway policy |
| **Render Preview Runtime** | Phase 5 | `RENDER_FREE_NO_CARD_DEPLOYMENT_BLOCKED` | Render container deployment requires credit card / paid billing; zero-card deployment blocked by Render policy |
| **Modal Preview Runtime** | Phase 5 | `MODAL_FREE_NO_CARD_DEPLOYMENT_BLOCKED` | Modal container deployment requires credit card / paid billing; always-warm min_containers=1 exceeds free credit ($39.71/mo vs $30.00) |
| **AIRA Work** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Managed autonomous execution layer with server-authoritative planning, budgets, and native mission control |
| **Work Planning** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Capability planner with effort depth, risk classification, and server-side sliding-window rate limits |
| **Work Projects** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | User-scoped durable project store with configuration and objective binding |
| **Work Runs** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Durable run state machine (QUEUED, PLANNING, RUNNING, APPROVAL_REQUIRED, COMPLETED, FAILED, CANCELLED, BLOCKED) |
| **Work Task Graph** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | 4-step managed DAG (Scoping, Investigation, Synthesis, Verification) without worktree dependencies |
| **Work Runtime** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Native `AIRA_AGENT` provider with dedicated `/api/agent-platform/runtime/status` health and capability probe |
| **Work Approvals** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Tenant-scoped, single-use, expiring approval records binding user, run, task, action, and risk class |
| **Work Cancellation** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Immediate cancellation fencing stopping active dispatch, cancelling runtime runs, and preventing late completion |
| **Work Recovery** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Atomic execution leases (`leaseOwner`, `leaseExpiresAt`) with automatic stale claim recovery |
| **Work Outputs** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Persisted `AgentArtifact` deliverable store linked to run, task, project, and user ownership |
| **Work Knowledge Integration** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Explicit project/task Knowledge binding consuming certified Phase 3 PGVector context without leakage |
| **Work Browser Integration** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Browser-assisted investigation via certified Phase 5 Tool Gateway with graceful offline degradation |
| **Work Cost Controls** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Strict server-side budget clamping (`resolveEffectiveWorkBudgets`) enforcing plan tier ceilings |
| **Work Security** | Phase 6 | `WORKING_E2E_IN_PREVIEW` | Strict tenant boundaries (404 on cross-user access), secret redaction, and killswitch support |
| **AIRA Teams / Swarms** | Phase 9 | `HIDDEN` | Swarm/multi-agent UI intentionally gated for Phase 9 |
