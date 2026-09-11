# AIRA Release 4 — Phase 4 Agent Runtime Architecture & Reconnaissance

## 1. Executive Reconnaissance Matrix

| Subsystem Component | Implementation Location | State Classification | Current Capability & Architecture Description |
| :--- | :--- | :--- | :--- |
| **Frontend Agent UX** | `app/agents/page.tsx`, `app/runs/page.tsx` | `IMPLEMENTED` | Management UI for defining single agents, submitting run requests, and viewing run timelines |
| **API Boundary** | `app/api/agents/*`, `app/api/agents/runs/*` | `IMPLEMENTED` | Server-authoritative Next.js API routes with session authentication and user-scoped data access |
| **Prisma Models** | `prisma/schema.prisma` | `IMPLEMENTED` | Models: `AgentDefinition`, `AgentRun`, `AgentStep`, `AgentRunEvent`, `AgentToolApproval` |
| **Runtime Selection** | `lib/agent-runtime/registry.ts`, `selection.ts` | `IMPLEMENTED` | Unified registry supporting native AIRA single-agent executor with failover rules |
| **Platform Orchestrator** | `lib/agent-platform/orchestrator.ts` | `IMPLEMENTED` | Bounded execution loop with model reasoning, budget caps, step tracking, and claim recovery |
| **Tool Gateway** | `lib/tool-gateway/gateway.ts` | `IMPLEMENTED` | Risk-classified tool execution (`READ_ONLY`, `PRIVILEGED`, `DESTRUCTIVE`) with approval bounds |
| **Phase 3 Knowledge** | `lib/conversation-memory.ts` | `IMPLEMENTED` | Grounded context retrieval via 768-dim PGVector search with untrusted document boundaries |
| **Realtime Event Stream** | `lib/agents/run-events.ts` | `IMPLEMENTED` | SSE event stream for live client updates (`run.started`, `tool.requested`, `step.completed`) |
| **MCP Integration** | `lib/mcp/runtime.ts` | `IMPLEMENTED` | MCP bridge adapter with allowlist validation, token isolation, and response size limits |
| **Abuse & Budget Caps** | `lib/agent-platform/types.ts` | `IMPLEMENTED` | Server-enforced run budgets: max parallel runs (10), max tokens, max tool calls, max duration |

---

## 2. Runtime Framework Comparison Matrix

| Criteria | Native AIRA Executor | LangGraph | DeerFlow | AutoGPT |
| :--- | :--- | :--- | :--- | :--- |
| **Existing Code Integration** | `NATIVE (100%)` | Partial (requires extra adapter) | Partial | Legacy |
| **Persistence & DB Binding** | `DIRECT` (Prisma/Postgres) | Custom State Store | External | File-based |
| **Tool Gateway Integration** | `FIRST-CLASS` (`lib/tool-gateway`) | External wrapper | Custom | Custom |
| **Phase 3 RAG & Memory** | `NATIVE` (`lib/conversation-memory`) | Manual wiring | None | Basic |
| **Run Cancellation** | `DURABLE` (AbortSignal + DB state) | Interrupt-based | HTTP Cancel | Process kill |
| **Deployment Complexity** | `LOW` (Runs inside existing container/worker) | Medium | High | High |
| **Security & Isolation** | `HIGH` (Server-authoritative policy) | Medium | Medium | Low |
| **Maintainability & Testing** | `HIGH` (Full TypeScript strict typing) | Medium | Low | Low |

### Single-Agent Runtime Selection Decision

**SELECTED PRIMARY RUNTIME**: `NATIVE_AIRA_EXECUTOR`

**Rationale**:
1. Native AIRA Executor directly binds with our certified Phase 2 AIRA Route model router and Phase 3 Knowledge RAG retrieval pipeline without introducing redundant external dependencies.
2. It natively supports durable Postgres step/event persistence, timing-safe cancellation via `AbortSignal`, and strict server-authoritative Tool Gateway security bounds.
3. LangGraph, CrewAI, and external legacy runtimes (`DeerFlow`, `AutoGPT`) do not provide additional single-agent execution safety that outweigh the complexity of external daemon management.

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
                     │ (Worker Claim)
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
        │  FAILED     │  REVOKED    │   DENIED      │
        └───────────────────────────────────────────┘
```

---

## 4. Tenant Isolation & Security Boundaries

1. **User Identity Binding**: All AgentDefinitions, AgentRuns, AgentSteps, and AgentRunEvents strictly filter by `userId`.
2. **Cross-User Protection**: User B can never read, modify, execute, or cancel User A's Agent or Run.
3. **Tool Privileges**: LLMs cannot escalate their own permissions. Privileged or destructive tool calls require server-verified human approval records.
4. **Knowledge RAG Boundary**: All retrieved Knowledge context is wrapped in `<aira_untrusted_user_document source="...">` tag blocks to prevent document prompt injection.
5. **Secret Redaction**: Worker tokens, service-role keys, and connection strings are scrubbed before event publication or log output.

---

## 5. Verification Plan

1. **TypeScript & Typegen**: `next typegen && tsc --noEmit` — 0 errors.
2. **Unit & Integration Suite**: All agent platform tests (`agent-platform-*.test.ts`, `agent-run-*.test.ts`, `tool-approvals-contract.test.ts`) pass cleanly.
3. **Phase 4 E2E Ingestion & Run Verification**:
   - Single-agent task execution (`37 + 58 = 95`).
   - Knowledge-grounded agent retrieval (`Borealis reference number = 68421`).
   - Read-only tool execution (web/search).
   - Realtime event timeline streaming.
   - Run cancellation and timeout enforcement.
   - Cross-user tenant isolation (User B IDOR block).
