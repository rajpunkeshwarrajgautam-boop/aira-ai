# AIRA Release 4 — Capability Matrix

| Capability / Subsystem | Phase | Preview Status | Architecture & Execution Summary |
| :--- | :--- | :--- | :--- |
| **AIRA Route & Model Failover** | Phase 2 | `WORKING_E2E_IN_PREVIEW` | Certified OmniRoute failover, non-leak headers, and model routing |
| **AIRA Knowledge RAG & Ingestion** | Phase 3 | `WORKING_E2E_IN_PREVIEW` | 768-dim PGVector search, 6-format document parser, worker token auth |
| **Agent Definition** | Phase 4 | `PARTIAL` | Saved `AgentDefinition` CRUD exists; execution path accepts objective/provider without direct binding |
| **Single-Agent Execution** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Single-agent execution via `AgentRuntime` registry (`DEERFLOW`) |
| **Tools Gateway** | Phase 4 | `PARTIAL` | Risk-classified tool gateway (`READ_ONLY`, `PRIVILEGED`) implemented; external bridge partial |
| **Knowledge Integration** | Phase 4 | `PARTIAL` | Phase 3 PGVector search context grounding certified; direct agent injection partial |
| **Memory Integration** | Phase 4 | `PARTIAL` | Conversation & project memory context binding implemented; direct agent buffer injection partial |
| **MCP Bridge** | Phase 4 | `CONFIGURATION_BLOCKED` | MCP adapter implemented; external MCP servers optional |
| **Agent Run Cancellation** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Provider cancellation endpoint with terminal state (`TERMINATED`) |
| **Agent Run Timeout** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Bounded duration budget enforcement (`WORKFLOW_AGENT_TIMEOUT`) |
| **Agent Run Outputs** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Persisted step outputs and artifact references |
| **Agent Event Timeline** | Phase 4 | `WORKING_E2E_IN_PREVIEW` | Authenticated JSON polling timeline (`AUTHENTICATED_JSON_POLLING`) |
| **AIRA Teams / Swarms** | Phase 9 | `HIDDEN` | Swarm/multi-agent UI intentionally gated for Phase 9 |
