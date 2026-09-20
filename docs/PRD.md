# AIRA AI — Product Requirements Document (PRD)

> **Document Type**: Authoritative Product Requirements Document  
> **Status**: Active / Production Baseline  
> **Last Verified**: 2026-09-20  
> **Repository Root**: [c:/Users/WORKSTATION/aira-ai](file:///c:/Users/WORKSTATION/aira-ai)  
> **Production URL**: [https://aira-ai-live.vercel.app](https://aira-ai-live.vercel.app)  
> **Related Documents**:
> - Technical Architecture: [docs/ARCHITECTURE.md](file:///c:/Users/WORKSTATION/aira-ai/docs/ARCHITECTURE.md)
> - Engineering Guardrails: [docs/RULES.md](file:///c:/Users/WORKSTATION/aira-ai/docs/RULES.md)
> - Design System & UX: [docs/DESIGN.md](file:///c:/Users/WORKSTATION/aira-ai/docs/DESIGN.md)
> - Task & Release Ledger: [docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md)
> - Context & Operational Memory: [docs/MEMORY.md](file:///c:/Users/WORKSTATION/aira-ai/docs/MEMORY.md)
> - Core Reference Context: [PRODUCT.md](file:///c:/Users/WORKSTATION/aira-ai/PRODUCT.md) | [PROJECT_STATUS.md](file:///c:/Users/WORKSTATION/aira-ai/PROJECT_STATUS.md)

---

## 1. Product Identity and Vision

### 1.1 Product Definition
AIRA AI is a unified research, execution, and intelligence workspace designed for power users, operators, founders, researchers, and technical practitioners who require a single instrument to ask grounded questions, perform deep investigative research, execute autonomous multi-step agent workflows, curate persistent memory, and produce verified, multi-format artifacts.

### 1.2 Core Product Philosophy
- **Operational Instrument, Not a Marketing Site**: AIRA AI prioritizes immediate utility, dense information hierarchy, low-latency execution, and honest system status over promotional marketing copy or decorative fluff.
- **Evidence-First Verification**: Every research synthesis must provide verifiable citation numbers backed by third-party sources. Every agentic output must pass through deterministic validation boundaries.
- **Fail-Closed Reliability**: Capabilities backed by unprovisioned or unverified external infrastructure (e.g., autonomous sandbox executors, payment gateways) must fail closed safely rather than presenting simulated or mock success.

---

## 2. Core User Problems & Market Need

1. **Context Fragmentation**: Users waste hours switching between web search engines, LLM chat wrappers, external research tools, code editors, and note-taking apps.
2. **Hallucination and Ungrounded Answers**: Standard LLM chat interfaces generate speculative assertions without traceable citations or source verifiability.
3. **Fragile Agent Autonomy**: Autonomous agents often loop endlessly, fail silently, execute arbitrary actions without human authorization, or lack reproducible artifact delivery.
4. **Ephemeral Memory & Context Loss**: Existing AI assistants lose user preferences, recurring constraints, project history, and architectural decisions across sessions.
5. **Opaque Provider Lock-In**: Users are tethered to single-provider model failures, arbitrary rate-limits, and silent prompt drift.

---

## 3. Target Users and Use Cases

| User Persona | Primary Workflow | Key Product Requirements |
| :--- | :--- | :--- |
| **Technical Operators & Engineers** | Deep technical research, code debugging, system architecture evaluation, automated routines | Strict code formatting, grounded technical citations, API rate transparency, keyboard-first navigation (Ctrl/Cmd + K) |
| **Founders & Executives** | Market intelligence, competitive audits, multi-format artifact creation (DOCX, XLSX, Markdown) | Executive summaries, verifiable source lineage, shareable public research links |
| **Researchers & Analysts** | Multi-query exploratory synthesis, source domain filtering, knowledge base cross-referencing | Academic & news domain ranking, persistent citation mapping, exportable datasets |
| **Autonomous Workflow Builders** | Custom agent configuration, scheduled cloud routines, tool approval oversight | Typed tool contracts, step-level run inspection, explicit human-in-the-loop approvals |

---

## 4. Product Positioning & Voice

- **Positioning**: A dense, calm, keyboard-accessible research and execution instrument. Competing directly in capability with Perplexity Pro, OpenAI Operator/Deep Research, and enterprise agent consoles, while emphasizing self-hosted sovereignty, multi-provider routing, and deterministic publication bounds.
- **Product Voice**: Precise, calm, operational, capable. Prefers direct labels, clear HTTP status mappings, and observable progress over hype or conversational filler.

---

## 5. Current Product Scope vs. Phased Evolution

The development of AIRA AI is structured across distinct evolutionary phases. Features must never be claimed as production-active until external runtime deployment and end-to-end verification gates pass.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Aira 1.0: Unified AI & Research Workspace [CURRENT PRODUCTION BASELINE] │
│ • Perplexity-grade search + Exa retrieval + numbered citations         │
│ • OmniRoute / NVIDIA / OpenAI multi-provider fallback                  │
│ • UserMemory & rolling conversation summaries                          │
│ • Auth.js (GitHub/Google) + Neon PostgreSQL RLS                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Aira 2.0: Autonomous Agent Execution OS [CURRENTLY INTEGRATED]         │
│ • DeerFlow 2.0 SuperAgent + AutoGPT dual-host fallback                 │
│ • Agent Run Center + step-level event streams + human approval gates   │
│ • Tool Gateway + universal deliverable contracts                       │
│ • Multi-format Durable Artifact Engine (MD, JSON, CSV, DOCX, XLSX)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Aira 3.0: Persistent Cognitive Employees [IN DEVELOPMENT / HARDENING]  │
│ • Durable UserAgents with versioning & instruction policies            │
│ • Automated cloud routines & DAG execution workflows                   │
│ • Tier-aware semantic memory (768d pgvector Nomic vs OpenAI)           │
│ • Federated business knowledge & connector directory                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Aira Business & Platform [ROADMAP / GATED]                             │
│ • Enterprise multi-tenant hierarchy (Organizations & Workspaces)       │
│ • Enterprise SAML / OIDC IdP integration                               │
│ • Third-party MCP server package registry & skill marketplace          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Functional Capabilities & Verification Status

### 6.1 Research & Grounded Search (Aira 1.0)
- **Status**: **PRODUCTION ACTIVE & VERIFIED**
- **Implementation**: [apps/web/app/api/search/route.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/api/search/route.ts)
- **Capabilities**:
  - Exa API neural search retrieval with configurable result counts.
  - Numbered, verifiable inline citations mapped to source URLs and domain authority.
  - Server-Sent Events (SSE) streaming answer synthesis with token-by-token emission.
  - Source sanitization with explicit `<aira_untrusted_source_excerpt>` tagging to prevent indirect prompt injection.
  - Anonymous daily search quota (enforced at 2 searches/day per IP/session; verified in `anonymous-search-quota-real-db.test.ts`).
  - Public research sharing via opaque tokens ([apps/web/app/share/[id]/page.tsx](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/share/%5Bid%5D/page.tsx)).

### 6.2 Model Routing & OmniRoute Gateway
- **Status**: **PRODUCTION ACTIVE & VERIFIED**
- **Implementation**: [apps/web/lib/routing/](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/routing/), [apps/web/lib/contracts/model-registry.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/contracts/model-registry.ts)
- **Capabilities**:
  - Multi-provider gateway supporting OmniRoute, NVIDIA NIM, and OpenAI.
  - Default Free tier provider: NVIDIA NIM (`nvidia/nemotron-3-nano-30b-a3b` with fallback to `meta/llama-3.3-70b-instruct`).
  - Default Pro tier provider: OmniRoute (`nvidia/openai/gpt-oss-20b`).
  - Circuit-breaker resilience facade: transient failures trigger isolated provider failover before any user-visible token is emitted. Provider switching after token emission is strictly prohibited to prevent answer corruption.

### 6.3 Persistent Memory & Context Management
- **Status**: **PRODUCTION ACTIVE (Lexical) / GATED (Semantic)**
- **Implementation**: [apps/web/lib/persistent-memory.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/persistent-memory.ts), [apps/web/lib/semantic-memory.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/semantic-memory.ts)
- **Capabilities**:
  - Lexical memory: CRUD operations for `UserMemory` models classified by kind (`PROFILE`, `PREFERENCE`, `GOAL`, `PROJECT`, `DECISION`, `CONSTRAINT`, `RELATIONSHIP`).
  - Scoped strictly by `userId` with full PostgreSQL RLS enforcement.
  - Context budget manager: calculates available token budget, injects top-ranked memories, and preserves newest conversation turns.
  - Tier-aware Semantic Memory (Gate 12): isolated 768-dimensional embeddings (`nomic-embed-text-v1.5` for FREE, `text-embedding-3-small` for PRO). Feature-gated via `SEMANTIC_MEMORY_ENABLED=false` pending dedicated production embedding host provisioning.

### 6.4 Autonomous Agent Platform (Aira 2.0)
- **Status**: **INTEGRATED & VERIFIED IN TEST SUITE / HOST DEPLOYMENT PENDING**
- **Implementation**: [apps/web/lib/agent-platform/](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/agent-platform/), [apps/web/lib/deerflow/](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/deerflow/), [apps/web/lib/autogpt/](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/autogpt/)
- **Capabilities**:
  - DeerFlow 2.0 SuperAgent adapter: long-horizon execution runtime with health probing, remote cancellation, and artifact proxying.
  - AutoGPT fallback adapter: dual-host health pre-submission failover (Ubuntu VPS primary, Windows standby).
  - Human-in-the-Loop Tool Approvals: `AgentToolApproval` records with status tracking (`PENDING`, `APPROVED`, `DENIED`, `CANCELLED`, `EXPIRED`) for high-risk operations.
  - Idempotent execution dispatch via client-generated `clientRequestId` preventing duplicate spend or execution loops.

### 6.5 Tool Gateway & Security Boundaries
- **Status**: **VERIFIED IN REPOSITORY**
- **Implementation**: [apps/web/lib/tool-gateway/gateway.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/tool-gateway/gateway.ts)
- **Capabilities**:
  - Authenticated gateway mediating all tool and connector executions.
  - Path traversal defense: artifact downloads and file tools strictly validate paths against allowlists with traversal and dot-segment rejection.
  - Separation of tokens: external credentials remain server-only and are never passed to the client browser.

### 6.6 Durable Artifact Engine
- **Status**: **PRODUCTION ACTIVE & VERIFIED**
- **Implementation**: [apps/web/lib/artifacts/](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/lib/artifacts/)
- **Capabilities**:
  - Multi-format generation supporting Markdown, JSON, CSV, DOCX, XLSX, and HTML.
  - Cryptographic checksums (`SHA-256`), size verification, and provenance tracking across artifact versions.
  - In-browser preview generator and secure authenticated download routes.

### 6.7 Billing, Subscriptions & Checkout
- **Status**: **INTENTIONALLY DEFERRED (Gate 42)**
- **Implementation**: [apps/web/app/api/billing/checkout/route.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/api/billing/checkout/route.ts), [apps/web/app/api/webhooks/cashfree/route.ts](file:///c:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/app/api/webhooks/cashfree/route.ts)
- **Policy**:
  - Cashfree PG integration exists and is covered by webhook signature tests.
  - Commercial checkout remains intentionally disabled by project leadership (`CASHFREE_CHECKOUT_ENABLED=false`).
  - Checkout UI must not claim commercial checkout is active until founder activation.

---

## 7. Non-Functional Requirements

### 7.1 Security & Access Control
- Every user table created in PostgreSQL must enable Row-Level Security (RLS) and explicitly deny direct Data API access (`deny_direct_data_api_access`).
- Production session cookies must be `__Secure-` prefixed, `HttpOnly`, and `SameSite=Lax`.
- Production security headers must enforce:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 7.2 Latency & Performance
- First token emission on standard search queries: `< 1200ms` under nominal provider response times.
- Client UI state transitions: `140–180ms` with zero elastic bounce.
- Zero client-side hydration drift between SSR and CSR rendering passes.

### 7.3 Data Protection & Privacy
- User conversation histories, research logs, and persistent memories must be completely isolated by `userId`.
- No sensitive user prompt, raw answer, memory content, or credential may be recorded in runtime logging or observability sinks.

---

## 8. Success Metrics & Current Observed Values

| Metric | Target | Currently Measured / Baseline | Verification Source |
| :--- | :--- | :--- | :--- |
| **Vercel Runtime Errors (24h)** | 0 | 0 errors | [PROJECT_STATUS.md](file:///c:/Users/WORKSTATION/aira-ai/PROJECT_STATUS.md#L36) |
| **Automated Test Suite Status** | 100% Pass | 100% Pass (all suites) | `pnpm run test` |
| **Production Advisory Audits** | 0 Unreviewed | 1 Scoped Exception (`GHSA-ggr8-5vv4-36mx` via Prisma) | `pnpm audit --prod` |
| **Security Header Compliance** | A+ Grade | Enforced on `aira-ai-live.vercel.app` | Vercel Deployment Audit |
| **Anonymous Daily Quota** | Exactly 2 | Enforced & Tested | `anonymous-search-quota-real-db.test.ts` |
| **Autonomous Gates Verified** | 128 / 128 | 112 Complete, 15 External Blocked, 1 Deferred | [docs/aira-ultimate/MASTER_LEDGER.md](file:///c:/Users/WORKSTATION/aira-ai/docs/aira-ultimate/MASTER_LEDGER.md) |
