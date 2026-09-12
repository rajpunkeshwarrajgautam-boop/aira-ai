# AIRA Release 4 — Capability Matrix

| Capability / Subsystem | Phase | Preview Status | Architecture & Execution Summary |
| :--- | :--- | :--- | :--- |
| **AIRA Route & Model Failover** | Phase 2 | `WORKING_E2E_IN_PREVIEW` | Certified OmniRoute failover, non-leak headers, and model routing |
| **AIRA Knowledge RAG & Ingestion** | Phase 3 | `WORKING_E2E_IN_PREVIEW` | 768-dim PGVector search, 6-format document parser, worker token auth |
| **Agent Definition** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | CRUD management for user agents with `userId` ownership |
| **Single-Agent Execution** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Single-agent execution via `AgentRuntime` registry and orchestrator |
| **Tools Gateway** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Risk-classified tool execution (`READ_ONLY`, `PRIVILEGED`) |
| **Knowledge Integration** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Certified Phase 3 PGVector search context grounding |
| **Memory Integration** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Conversation & project memory context binding |
| **MCP Bridge** | Phase 4 | `CONFIGURATION_BLOCKED` | MCP adapter implemented; external MCP servers optional |
| **Agent Run Cancellation** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Provider cancellation endpoint with terminal state |
| **Agent Run Timeout** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Bounded duration budget enforcement |
| **Agent Run Outputs** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Persisted step outputs and artifact references |
| **Agent Event Timeline** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Authenticated JSON polling timeline (`/api/agents/runs/[runId]/events`) |
| **AIRA Teams / Swarms** | Phase 9 | `HIDDEN` | Swarm/multi-agent UI intentionally gated for Phase 9 |
