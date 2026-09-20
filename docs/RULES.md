# AIRA AI — Engineering Constitution and Development Guardrails

> **Document Type**: Authoritative Engineering Standards & Guardrails  
> **Status**: Active / Enforced Across All Agents & Developers  
> **Last Verified**: 2026-09-20  
> **Repository Root**: [c:/Users/WORKSTATION/aira-ai](file:///c:/Users/WORKSTATION/aira-ai)  
> **Related Documents**:
> - Product Requirements: [docs/PRD.md](file:///c:/Users/WORKSTATION/aira-ai/docs/PRD.md)
> - Technical Architecture: [docs/ARCHITECTURE.md](file:///c:/Users/WORKSTATION/aira-ai/docs/ARCHITECTURE.md)
> - Design System: [docs/DESIGN.md](file:///c:/Users/WORKSTATION/aira-ai/docs/DESIGN.md)
> - Task Ledger: [docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md)
> - Operational Memory: [docs/MEMORY.md](file:///c:/Users/WORKSTATION/aira-ai/docs/MEMORY.md)
> - Foundational Rulebooks: [AGENTS.md](file:///c:/Users/WORKSTATION/aira-ai/AGENTS.md) | [.agents/rules/router.md](file:///c:/Users/WORKSTATION/aira-ai/.agents/rules/router.md)

---

## 1. Rule Hierarchy & Authority

This document defines the binding development principles, security constraints, and operational guardrails for AIRA AI.

### 1.1 Authority Precedence Order
When instructions or documentation appear to diverge, the following order of precedence strictly applies:
1. **[AGENTS.md](file:///c:/Users/WORKSTATION/aira-ai/AGENTS.md)**: Master developer and agent instruction set, including RepoBrain CLI rules and Zen of Python principles.
2. **[.agents/rules/router.md](file:///c:/Users/WORKSTATION/aira-ai/.agents/rules/router.md)**: Authoritative routing specification, Minimum-Agent Principle, and security escalation policy.
3. **[PRODUCT.md](file:///c:/Users/WORKSTATION/aira-ai/PRODUCT.md) & [DESIGN.md](file:///c:/Users/WORKSTATION/aira-ai/DESIGN.md)**: Product definition, voice, and design identity.
4. **[docs/RULES.md](file:///c:/Users/WORKSTATION/aira-ai/docs/RULES.md)** (this document): Engineering constitution, code standards, and Definition of Done.
5. **Individual Workspace Skills (`.agents/skills/*`)**: Specific domain implementation guides.

*Rule on Conflict*: Never resolve ambiguity by silent override or guessing. If an unambiguous conflict between instructions exists, preserve working architecture, fail-closed security, and document the discrepancy for user review.

---

## 2. Core Engineering Principles

1. **Working Architecture Preservation**: Never refactor, rewrite, or replace established, working core systems without an explicit requirement and prior approval.
2. **Fail-Closed by Default**: Any subsystem that relies on external infrastructure, third-party credentials, or distributed services must refuse activation safely if prerequisites are unconfigured or unhealthy.
3. **Evidence Before Assertion**: No task, feature, or bugfix is complete merely because code has been written. Verifiable proof (passing automated test logs, HTTP response status, or clean browser console traces) is required before claiming completion.
4. **Separation of Concerns**: Keep frontend UI, runtime resilience, database migrations, and agent orchestration in isolated reviewable changesets. Never combine a visual styling update with an infrastructure refactor.

---

## 3. Code Organization & Monorepo Conventions

- **Monorepo Layout**:
  - `perplexity-clone/my-turborepo/apps/web/`: All web frontend and server route development belongs here.
  - `prisma/`: Database configuration and migration files.
  - `infra/`: Infrastructure deployment scripts and worker code.
  - `desktop-agent/`: Native Electron desktop companion.
- **Naming Conventions**:
  - Files and directories: `kebab-case` (e.g., `tool-gateway.ts`, `provider-health.ts`).
  - React components: `PascalCase` (e.g., `SearchBox.tsx`, `AnswerStream.tsx`).
  - TypeScript types and interfaces: `PascalCase` (e.g., `MissionInput`, `AgentRunState`).
  - Functions, constants, and variables: `camelCase` (e.g., `fetchGroundedAnswer`, `calculateQuota`).
- **Imports**: Group imports logically: (1) external libraries, (2) workspace packages (`@repo/ui`), (3) internal modules (`@/lib/...`), (4) relative styles.

---

## 4. TypeScript & Framework Standards

- **TypeScript Strictness**: Strict mode is enabled and enforced. The use of `any` is strictly prohibited unless interfacing with untyped third-party legacy signatures, and must be accompanied by an explanatory comment.
- **Next.js 16 App Router Conventions**:
  - Default to React Server Components (RSC).
  - Use `"use client"` only at the interactive leaf nodes that require React hooks (`useState`, `useEffect`) or browser event listeners.
  - Route Handlers must reside in `app/api/.../route.ts` and export standard HTTP method functions (`GET`, `POST`, `PATCH`, `DELETE`).
- **Validation**: All external inputs (request bodies, query parameters, webhook payloads, environment variables) must be validated using Zod schemas (`safeParse`).

---

## 5. Security & Trust Boundaries

### 5.1 Database Isolation & Supabase RLS
- **Scoping by User ID**: Every user-owned database read, update, or deletion must explicitly include `where: { userId }` or inherit ownership through parent records.
- **Mandatory RLS**: Every new table created in PostgreSQL must enable Row-Level Security and install the fail-closed policy:
  ```sql
  ALTER TABLE "TableName" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "deny_direct_data_api_access" ON "TableName"
    FOR ALL TO anon, authenticated USING (false);
  REVOKE ALL ON "TableName" FROM anon, authenticated, service_role;
  ```
  Direct data API calls from Supabase client libraries are forbidden in favor of authenticated server-side Prisma calls.

### 5.2 Secret & Credential Hygiene
- **Zero Secret Exposure**: API keys, internal tokens, database credentials, and signing secrets must NEVER appear in:
  - Client-side bundles or `NEXT_PUBLIC_` environment variables.
  - URL query parameters or route paths.
  - User-visible error messages or toast notifications.
  - Git commit history or pull request bodies.
  - Runtime logs or telemetry traces.
- **Internal Headers Only**: Internal tokens (such as `DEERFLOW_INTERNAL_TOKEN`) may only be transmitted via server-to-server request headers.

### 5.3 Prompt Injection Defense & Web Sanitization
- All third-party search results retrieved from Exa must be sanitized and enclosed in `<aira_untrusted_source_excerpt>` tags.
- Directives, instruction overrides, or role assignments embedded inside third-party web content must be treated as inert text.

### 5.4 Path Traversal Defense
- File downloads, artifact exports, and path-based tool executions must normalize paths and reject traversal attempts (`..`, dot-segments, null bytes).
- Paths must be validated against a strict pre-approved allowlist on the owning user's record.

---

## 6. AI Model & Agent Execution Guardrails

1. **Circuit-Breaker Fail-Closed Rule**: Provider failovers may only execute before user-visible tokens are emitted. Once streaming has commenced, provider switching is prohibited to prevent stream splicing.
2. **Human-in-the-Loop Tool Approvals**: Tools classified with `MEDIUM` or `HIGH` risk (e.g., executing code, modifying database state, sending external communications) must require an explicit `AgentToolApproval` in `PENDING` state before execution.
3. **Idempotent Dispatch**: All agent submissions must require a client-generated `clientRequestId` to prevent duplicate paid model runs during network retries.

---

## 7. Testing & Quality Assurance Standards

### 7.1 Mandatory Verification Flow
No development task is complete without satisfying the four-step verification chain:
1. **Unit / Contract Tests**: Automated tests written with Node.js test runner covering happy path and edge cases.
2. **Security Checks**: Authorization and IDOR checks verifying that users cannot access resources belonging to other users.
3. **Lint & Type Checks**: `turbo run lint` and `turbo run check-types` must pass with zero warnings and zero errors.
4. **Production Build**: `turbo run build` must complete cleanly.

### 7.2 Dependency Management Policy
- Always use `pnpm` with frozen lockfiles (`pnpm install --frozen-lockfile`).
- Production audits (`pnpm audit --prod`) must pass cleanly. Only reviewed and documented exceptions (such as `GHSA-ggr8-5vv4-36mx`) are permitted.

---

## 8. Definition of Done (DoD)

A task or feature in AIRA AI is considered **DONE** only when all of the following criteria are met:
- [ ] Implementation strictly matches requirements without adding speculative unrequested features.
- [ ] Code adheres to TypeScript strict mode, formatting conventions, and architectural boundaries.
- [ ] Security boundaries (RLS, user scoping, secret isolation, input sanitization) are preserved and tested.
- [ ] Automated tests have been executed and output shows 100% pass rate.
- [ ] `turbo run lint` exits 0 with zero warnings.
- [ ] `turbo run check-types` exits 0 with zero type errors.
- [ ] No regression introduced into production security headers, authentication flows, or quotas.
- [ ] Changes are documented in the task ledger ([docs/TASKS.md](file:///c:/Users/WORKSTATION/aira-ai/docs/TASKS.md)).
- [ ] Empirical evidence (test run output, CLI status) is recorded and referenced.
