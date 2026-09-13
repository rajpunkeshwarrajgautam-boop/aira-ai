# AIRA Release 4 — Phase 6: AIRA Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and certify AIRA Work — the production-grade managed execution layer where an outcome objective is planned, budgeted, authorized, executed across certified AIRA capabilities, and sealed with persisted deliverables and acceptance evidence.

**Architecture:** Provider-neutral managed execution engine with server-authoritative planning (`/api/agent-platform/plan`), dedicated runtime status probe (`/api/agent-platform/runtime/status`), native Work mission control UI (`/work` and `/work/runs/[runId]`), distributed lease locking, server-enforced entitlement budgets, certified tool gateway integrations (Route, Knowledge, Browser), persisted deliverables, and typed error taxonomy.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict mode, Prisma ORM, PostgreSQL (Neon), Auth.js v5, Tailwind CSS, Vercel Preview.

**Spec:** User prompt for AIRA Release 4 Phase 6 (Gates 0 to 62).

## Global Constraints

- Never touch Production deployment (`dpl_8XH4S9CpGmEg781J4htovF1w863S`, SHA `0c0b7bcc8f032490d8efd1d527bcd1e67562acab`, `https://aira-ai-live.vercel.app`).
- Never merge to `main`.
- Never run destructive or production database migrations.
- Never fake progress, fabricate artifacts, or claim completion without persisted evidence.
- Remove all coupling from `/work` to `/build`. Builder remains Phase 7.
- Every Work endpoint requires authenticated user identity and strictly enforces tenant isolation (cross-user probe returns 404).

---

### Task 1: Dedicated Work Runtime Status API (Gate 4, 32, 39)

**Files:**
- Create: `perplexity-clone/my-turborepo/apps/web/app/api/agent-platform/runtime/status/route.ts`
- Test: `perplexity-clone/my-turborepo/apps/web/test/work-runtime-status.test.ts`

**Interfaces:**
- Consumes: `getAgentRuntimeStates()`, `toolAvailability()`
- Produces: `GET /api/agent-platform/runtime/status` -> `{ enabled, configured, ready, provider, reason, degradedCapabilities, checkedAt }`

- [ ] **Step 1: Write test for runtime status route**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement route handler**
- [ ] **Step 4: Run test to verify pass**

---

### Task 2: AIRA Native Agent Runtime Provider (Gate 15, 33, 34)

**Files:**
- Create: `perplexity-clone/my-turborepo/apps/web/lib/agent-runtime/aira-agent-runtime.ts`
- Modify: `perplexity-clone/my-turborepo/apps/web/lib/agent-runtime/types.ts`
- Modify: `perplexity-clone/my-turborepo/apps/web/lib/agent-runtime/registry.ts`
- Modify: `perplexity-clone/my-turborepo/apps/web/lib/agent-runtime/selection.ts`
- Test: `perplexity-clone/my-turborepo/apps/web/test/aira-agent-runtime.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime` interface, `executeTool()`, OmniRoute/OpenAI/NVIDIA model APIs
- Produces: `airaAgentRuntime` registered under `"AIRA_AGENT"`

- [ ] **Step 1: Write unit tests for `airaAgentRuntime`**
- [ ] **Step 2: Add `"AIRA_AGENT"` to `types.ts` and implement `aira-agent-runtime.ts`**
- [ ] **Step 3: Register in `registry.ts` and `selection.ts`**
- [ ] **Step 4: Verify tests pass**

---

### Task 3: Server-Authoritative Planning, Budgets & Entitlements (Gate 6, 7, 8, 25)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/app/api/agent-platform/plan/route.ts`
- Modify: `perplexity-clone/my-turborepo/apps/web/app/api/agent-platform/projects/[projectId]/runs/route.ts`
- Modify: `perplexity-clone/my-turborepo/apps/web/lib/billing/plan-enforcement.ts`
- Test: `perplexity-clone/my-turborepo/apps/web/test/work-budget-enforcement.test.ts`

**Interfaces:**
- Consumes: `getEffectiveEntitlements(userId)`, `PlanEnforcementError`
- Produces: Clamped, server-authoritative budgets, escalation rejection, `min(1)` task validation

- [ ] **Step 1: Write budget enforcement & validation test**
- [ ] **Step 2: Update `plan/route.ts` and `projects/[projectId]/runs/route.ts`**
- [ ] **Step 3: Verify budget and escalation tests pass**

---

### Task 4: Work Task Graph & Orchestrator Hardening (Gate 10, 11, 12, 13, 21, 28)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/lib/agent-platform/orchestrator.ts`
- Test: `perplexity-clone/my-turborepo/apps/web/test/work-orchestrator.test.ts`

**Interfaces:**
- Consumes: Project objective, config, runtime
- Produces: Work task graph (research, synthesis, acceptance), acceptance criteria verification before COMPLETED

- [ ] **Step 1: Write orchestrator work task graph test**
- [ ] **Step 2: Implement Work DAG generation and acceptance criteria verification in `orchestrator.ts`**
- [ ] **Step 3: Verify tests pass**

---

### Task 5: Work-Native Mission Control UI (Gate 3, 31, 32, 52, 53)

**Files:**
- Modify: `perplexity-clone/my-turborepo/apps/web/components/work/WorkExecutionWorkspace.tsx`
- Create: `perplexity-clone/my-turborepo/apps/web/app/work/runs/[runId]/page.tsx`
- Create: `perplexity-clone/my-turborepo/apps/web/components/work/WorkRunMissionControl.tsx`

**Interfaces:**
- Consumes: `/api/agent-platform/runtime/status`, `/api/agent-platform/runs/[runId]`, `/api/agent-platform/runs/[runId]/events`
- Produces: Native mission control surface at `/work/runs/[runId]`

- [ ] **Step 1: Update `WorkExecutionWorkspace.tsx` to link to `/work/runs/[runId]` and use status probe**
- [ ] **Step 2: Create `app/work/runs/[runId]/page.tsx` and `WorkRunMissionControl.tsx`**
- [ ] **Step 3: Verify UI rendering and typecheck cleanly**

---

### Task 6: Comprehensive Automated Test Suite & Regressions (Gate 43–54)

**Files:**
- Create: `perplexity-clone/my-turborepo/apps/web/test/work-platform-comprehensive.test.ts`

- [ ] **Step 1: Implement end-to-end integration tests (unauth, IDOR, idempotency, cancel, approvals, recovery)**
- [ ] **Step 2: Run test suite and confirm 0 failures**
- [ ] **Step 3: Run Phase 2–5 regressions**

---

### Task 7: Documentation & Operational Readiness (Gate 55, 56, 57)

**Files:**
- Update: `docs/AIRA_RELEASE4_PUBLIC_LAUNCH_READINESS.md`
- Create: `docs/AIRA_RELEASE4_PRODUCTION_DEPENDENCIES.md`
- Create: `docs/AIRA_RELEASE4_PRODUCTION_RUNBOOK.md`
- Update: `docs/AIRA_RELEASE4_SKILL_LEDGER.md`
- Update: `docs/AIRA_RELEASE4_CAPABILITY_MATRIX.md`

- [ ] **Step 1: Update skill ledger and capability matrix**
- [ ] **Step 2: Write production dependencies and runbook**

---

### Task 8: Preview Candidate, Live E2E Certification & Seal (Gate 58–62)

- [ ] **Step 1: Run full typecheck and build**
- [ ] **Step 2: Commit Phase 6 Product Candidate and push to `feat/aira-release-4-runtime-activation`**
- [ ] **Step 3: Verify exact READY Vercel Preview deployment**
- [ ] **Step 4: Execute live E2E against Preview**
- [ ] **Step 5: Create docs-only certification commit and verify origin matches local HEAD**
- [ ] **Step 6: Output final status and STOP**
