# Aira AI — Project Memory

> **Document Type**: High-Signal Operational Context & Agent Memory  
> **Status**: Active / Authoritative Context Baseline  
> **Last Verified**: 2026-09-20  
> **Repository Root**: [c:/Users/WORKSTATION/aira-ai](file:///c:/Users/WORKSTATION/aira-ai)  
> **Production URL**: [https://aira-ai-live.vercel.app](https://aira-ai-live.vercel.app)  
> **Related Documents**:
> - Product Requirements: [docs/PRD.md](file:///c:/Users/WORKSTATION/aira-ai/docs/PRD.md)
> - Technical Architecture: [docs/ARCHITECTURE.md](file:///c:/Users/WORKSTATION/aira-ai/docs/ARCHITECTURE.md)
> - Engineering Guardrails: [docs/RULES.md](file:///c:/Users/WORKSTATION/aira-ai/docs/RULES.md)
> - Design System: [docs/DESIGN.md](file:///c:/Users/WORKSTATION/aira-ai/docs/DESIGN.md)
> - Task Ledger: [docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md)

---

## Project Identity

AIRA AI is a unified research, execution, and cognitive intelligence workspace. It gives operators, power users, and researchers a single operational surface to ask grounded questions with verified citations, execute autonomous agent workflows, retain persistent memory, and produce structured, multi-format artifacts (DOCX, XLSX, Markdown, JSON).

It is an **operational instrument**, not a marketing website. It prioritizes information density, low latency, calm aesthetics, keyboard-first navigation (Ctrl/Cmd + K), and deterministic fail-closed security.

---

## Current State

- **Production Deployment**: Live on Vercel at `https://aira-ai-live.vercel.app` (Commit `82881013`, PR #68).
- **Active Development Branch**: `feat/aira-final-product-audit-hardening`.
- **Working Tree**: Clean.
- **Automated Test Suite**: 100% passing across 100+ unit, contract, and real-DB suites (`pnpm run test`).
- **Release Matrix**: 112 gates COMPLETE, 15 gates EXTERNAL_BLOCKED (requiring external host/credentials), 1 gate DEFERRED (Cashfree).

---

## Current Development Objective

Final hardening, visual QA, and regression prevention on `feat/aira-final-product-audit-hardening` ahead of public release:
1. Ensure work discovery callouts inside empty thread viewports render cleanly for logged-out visitors.
2. Confirm the model selector dropdown binds cleanly to backend model routing.
3. Validate that all security perimeters, quotas, and fail-closed gates remain strictly enforced.

---

## Verified Capabilities

1. **Grounded Neural Search**: Exa API integration, numbered citations, SSE streaming token synthesis, anonymous quota (2/day), and shareable public links.
2. **Multi-Provider AI Routing**: OmniRoute gateway (`nvidia/openai/gpt-oss-20b`) with circuit-breaker failover to NVIDIA NIM (`nvidia/nemotron-3-nano-30b-a3b`) and OpenAI.
3. **Persistent Lexical Memory**: Scoped by `userId` in PostgreSQL via Prisma with full Row-Level Security.
4. **Tool Gateway**: Authenticated execution boundary enforcing path traversal defense and credential isolation.
5. **Durable Artifact Engine**: Deterministic generation of Markdown, JSON, CSV, DOCX, and XLSX files with SHA-256 validation.
6. **Desktop Companion**: Electron / Vite application for native Windows execution.

---

## Important Architectural Decisions

- **ADR-001**: Universal mission, deliverable, and validation contracts in `lib/contracts/mission.ts`.
- **ADR-002**: All tool and connector operations must route through the authenticated Tool Gateway with risk levels (`LOW`, `MEDIUM`, `HIGH`) and human approval gates.
- **ADR-003**: Deterministic multi-format artifact engine with cryptographic lineage hashing.
- **ADR-004**: Versioned AI behavioral canaries and evaluation corpus preventing prompt drift.
- **ADR-005 (Fail-Closed Default)**: Any unprovisioned external runtime (DeerFlow, AutoGPT, Python Sandbox, Semantic Memory) must remain feature-gated `false` by default.

---

## Important File Locations

| Subsystem | Primary File Path | Purpose |
| :--- | :--- | :--- |
| **Search Route** | `apps/web/app/api/search/route.ts` | Exa retrieval, untrusted excerpt tagging, SSE stream |
| **Model Router** | `apps/web/lib/routing/` | OmniRoute / NVIDIA / OpenAI routing & circuit breaker |
| **Model Registry** | `apps/web/lib/contracts/model-registry.ts` | Model profiles, context windows, pricing metadata |
| **Tool Gateway** | `apps/web/lib/tool-gateway/gateway.ts` | Security boundary, risk scoring, path normalization |
| **Prisma Schema** | `prisma/schema.prisma` | Authoritative data model (RLS enforced) |
| **Agent Platform**| `apps/web/lib/agent-platform/` | Agent run coordination, lifecycle, and approvals |
| **Artifact Engine**| `apps/web/lib/artifacts/engine.ts` | Multi-format generator (MD, DOCX, XLSX, JSON) |
| **Master Shell** | `apps/web/components/AiraV2Frame.tsx` | Responsive layout (236px desktop rail, canvas) |
| **Primary Theme** | `apps/web/app/aira-v2.css` | Dark graphite surfaces (`#0b0d10`), brass (`#ceae56`) |

---

## Agent and Skill Infrastructure

AIRA AI uses a structured two-layer operator model:
1. **Global Agency Agents (`agency-*`)**: Specialist operator personas (e.g., `agency-agents-orchestrator`, `agency-frontend-developer`, `agency-security-architect`, `agency-reality-checker`).
2. **Local Workspace Skills (`.agents/skills/*`)**: Authoritative implementation toolkits (e.g., `aira-verification`, `nextjs-app-router`, `security-hardening`, `taste-skill`).

*Operating Policy*: Minimum-Agent Principle. Never spawn heavy orchestration for narrow tasks. Follow [.agents/rules/router.md](file:///c:/Users/WORKSTATION/aira-ai/.agents/rules/router.md).

---

## Active Tasks and Blockers

### Blockers Requiring External Action
1. **Persistent Linux Host**: Needed to host DeerFlow 2.0 SuperAgent and AutoGPT runners with TLS termination.
2. **OAuth App Credentials**: Needed for live Gmail, Calendar, Slack, and Notion connector activations.
3. **Windows Code Signing**: Needed for signed Electron desktop distribution.
4. **Cashfree Activation**: Intentionally deferred by founder policy decision.

---

## Production Release Constraints

- **Zero Secrets in Bundles**: No credentials in client bundles, URLs, error toasts, or git logs.
- **Fail-Closed Adapters**: `DEERFLOW_AGENT_ENABLED=false`, `SEMANTIC_MEMORY_ENABLED=false`, `CASHFREE_CHECKOUT_ENABLED=false` until live infrastructure is verified.
- **Strict Headers**: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` must be present on all responses.
- **Scoping by User ID**: Every database query on user tables must filter by `userId`.

---

## Authoritative Documentation Map

```text
docs/
├── PRD.md            <-- What we are building and why
├── ARCHITECTURE.md   <-- How the application actually works
├── RULES.md          <-- How development must be conducted
├── DESIGN.md         <-- How the product looks and behaves
├── TASKS.md          <-- What is complete, active, blocked, or pending
└── MEMORY.md         <-- What any new development session must inspect first
```

---

## Session Handoff Procedure

When starting a new development or agent session in this repository:

1. **Do Not Rely on Prior Conversation**: Always inspect the live repository and git state first.
2. **Check Git Status**: Run `git status -s` and `git log -n 3 --oneline` to establish the exact branch and working state.
3. **Inspect Active Tasks**: Read [docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md) to identify in-progress objectives and external blockers.
4. **Follow Engineering Guardrails**: Strictly adhere to [docs/RULES.md](file:///c:/Users/WORKSTATION/aira-ai/docs/RULES.md) and [AGENTS.md](file:///c:/Users/WORKSTATION/aira-ai/AGENTS.md).
5. **Verify Before Completion**: Run automated tests (`pnpm run test`) and type checks (`pnpm run check-types`) before asserting any task completion.

---

## Last Verified

**Date**: 2026-09-20  
**Verification Method**: Complete read-only audit of Git tree, Turborepo manifests, Prisma schema, Next.js app routes, and test suite.
