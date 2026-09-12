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
| **AIRA Browser** | Phase 5 | `AIRA_BROWSER_BLOCKED_BY_INFRASTRUCTURE` | Product implementation verified; awaiting authorized Preview container host deployment |
| **Browser Sessions** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Authoritative session binding, per-user limits, and truthful lifecycle states |
| **Browser Actions** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Safe actions (navigate, inspect, scroll, hover, back, forward, wait) and approval-gated mutations |
| **Browser Screenshots** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Ephemeral, authenticated viewport screenshots with rate limits and no-store headers |
| **Agent → Browser** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Server-enforced AgentDefinition allowlist, auto-session binding, and untrusted content wrapper |
| **Human Takeover** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Mutual exclusion lease boundary preventing Agent/Human race conditions |
| **Browser Security** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Network & app dual-layer SSRF defense, redirect re-validation, sanitized diagnostics |
| **Browser Cancellation** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Remote window.stop() task abort, lease release, and truthful BROWSER_CANCELLED status |
| **Browser Timeout** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Reconciled client/worker timeout hierarchy preventing zombie background tasks |
| **Browser Rate Limiting** | Phase 5 | `WORKING_E2E_IN_PREVIEW` | Distributed PostgreSQL sliding window limiter active across serverless instances |
| **AIRA Teams / Swarms** | Phase 9 | `HIDDEN` | Swarm/multi-agent UI intentionally gated for Phase 9 |
