# AIRA Release 4 — Phase 4 Agent Runtime Architecture & Reconnaissance

## 1. System Separation & Reconnaissance Matrix

AIRA's repository contains three distinct execution architectures that must be kept separated:

1. **System A — Standalone AIRA Agents**: Located in `app/api/agents/*` and `lib/agent-runtime/*`. Serves standalone user-launched agent runs. Managed via the `AgentRuntime` registry supporting registered providers `DEERFLOW`, `AUTOGPT`, and `AGENT_SWARM`.
2. **System B — Managed Agent Platform**: Located in `lib/agent-platform/orchestrator.ts` and `lib/agent-platform/store.ts`. Handles multi-role tasks (`AgentPlatformRun`, `AgentTask`, `AgentInstance`) with task-claim recovery loops and tool approval gates.
3. **System C — Knowledge Ingestion**: Located in `infra/foundation/knowledge-worker` and `infra/foundation/control-plane`. Dedicated pipeline for document ingestion (`knowledge.ingest`) via Redis Streams.

### Subsystem Component Audit Table

| Subsystem Component | Implementation Location | State Classification | Architecture & Contract Description |
| :--- | :--- | :--- | :--- |
| **Frontend Agent UX** | `app/agents/page.tsx`, `app/runs/page.tsx` | `IMPLEMENTED` | Management UI for defining standalone agents, submitting run requests, and viewing run timelines |
| **API Boundary** | `app/api/agents/*`, `app/api/agents/runs/*` | `IMPLEMENTED` | Server-authoritative Next.js API routes with session authentication and user-scoped data access |
| **Prisma Models** | `prisma/schema.prisma` | `IMPLEMENTED` | Models: `AgentDefinition`, `AgentRun`, `AgentStep`, `AgentRunEvent`, `AgentToolApproval` |
| **Runtime Selection** | `lib/agent-runtime/registry.ts`, `selection.ts` | `IMPLEMENTED` | Unified registry supporting provider runtimes (`DEERFLOW`, `AUTOGPT`, `AGENT_SWARM`) with priority failover |
| **Platform Orchestrator** | `lib/agent-platform/orchestrator.ts` | `IMPLEMENTED` | Bounded execution loop with model reasoning, budget caps, step tracking, and claim recovery |
| **Tool Gateway** | `lib/tool-gateway/gateway.ts` | `IMPLEMENTED` | Risk-classified tool execution (`READ_ONLY`, `PRIVILEGED`, `DESTRUCTIVE`) with human approval bounds |
| **Phase 3 Knowledge** | `lib/conversation-memory.ts` | `IMPLEMENTED` | Grounded context retrieval via 768-dim PGVector search with untrusted document boundaries |
| **Event Transport** | `app/api/agents/runs/[runId]/events` | `IMPLEMENTED` | Authenticated JSON polling with `Cache-Control: no-store` header |
| **MCP Integration** | `lib/mcp/runtime.ts` | `IMPLEMENTED` | MCP bridge adapter with allowlist validation, token isolation, and response size limits |
| **Abuse & Budget Caps** | `lib/agent-platform/types.ts` | `IMPLEMENTED` | Server-enforced run budgets: max parallel runs (10), max tokens, max tool calls, max duration |

---

## 2. Runtime Framework Comparison Matrix

| Criteria | Native AIRA Orchestrator | DeerFlow 2.0 | AutoGPT | Agent Swarm |
| :--- | :--- | :--- | :--- | :--- |
| **Existing Code Integration** | Native (`lib/agent-platform`) | Provider Adapter | Provider Adapter | Provider Adapter |
| **Persistence & DB Binding** | Direct (Prisma/Postgres) | Provider-managed | Provider-managed | Provider-managed |
| **Tool Gateway Integration** | First-class (`lib/tool-gateway`) | Controlled Tool Bridge | Controlled Tool Bridge | Controlled Tool Bridge |
| **Phase 3 RAG & Memory** | Native (`lib/conversation-memory`) | External | External | External |
| **Run Cancellation** | Durable (`cancelRun` / HTTP abort) | Provider cancel endpoint | Process kill | Swarm cancel |
| **Deployment Complexity** | Low | Medium | High | High |
| **Security & Isolation** | High (Server-authoritative) | Medium | Medium | Medium |
| **Maintainability & Testing** | High (Full TypeScript strict typing) | Medium | Low | Low |

---

## 3. Authoritative Agent Run Lifecycle State Machine

```
              ┌─────────────┐
              │   CREATED   │
              └──────┬──────┘
                     │ (Enqueue)
                     ▼
              ┌─────────────┐
              │   QUEUED    │
              └──────┬──────┘
                     │ (Worker Claim / Provider Accept)
                     ▼
              ┌─────────────┐
              │  STARTING   │
              └──────┬──────┘
                     │ (Model Dispatch)
                     ▼
              ┌─────────────┐
     ┌───────►│   RUNNING   ├────────┐
     │        └──────┬──────┘        │
     │               │               │
     │ (Tool Done)   │ (Needs Approval / Tool Exec)
     │               ▼               │
     │        ┌─────────────┐        │
     └────────┤ WAITING_FOR │        │ (Cancel / Timeout / Error)
              │    TOOL     │        │
              └─────────────┘        │
                                     ▼
        ┌───────────────────────────────────────────┐
        │             TERMINAL STATES               │
        │  COMPLETED  │  CANCELLED  │   TIMED_OUT   │
        │  FAILED     │  TERMINATED │   DENIED      │
        └───────────────────────────────────────────┘
```

---

## 4. Tenant Isolation & Security Boundaries

1. **User Identity Binding**: All `AgentDefinition`, `AgentRun`, `AgentStep`, and `AgentRunEvent` rows strictly filter by `userId`.
2. **Cross-User Protection**: User B can never read, modify, execute, or cancel User A's Agent or Run.
3. **Tool Privileges**: LLMs cannot escalate their own permissions. Privileged or destructive tool calls require server-verified human approval records.
4. **Knowledge RAG Boundary**: All retrieved Knowledge context is wrapped in `<aira_untrusted_user_document source="...">` tag blocks to prevent document prompt injection.
5. **Secret Redaction**: Worker tokens, service-role keys, and connection strings are scrubbed before event publication or log output.

---

## 5. Verification & Test Evidence

1. **TypeScript & Typegen**: `next typegen && tsc --noEmit` — 0 errors.
2. **Unit & Integration Suite**: All agent platform tests (`agent-platform-*.test.ts`, `agent-run-*.test.ts`, `tool-approvals-contract.test.ts`) pass cleanly (530 tests pass).
3. **Event Transport Contract**: Authenticated JSON polling verified on `/api/agents/runs/[runId]/events`.
