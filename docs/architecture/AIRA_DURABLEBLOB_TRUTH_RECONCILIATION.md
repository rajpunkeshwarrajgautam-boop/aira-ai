# AIRA AI — DurableBlob vs AgentArtifact Truth Reconciliation

**Document Status:** AUTHORITATIVE ARCHITECTURAL INVARIANT  
**Effective Branch:** `feat/aira-system-prompt-control-plane`  
**Certified Parent Baseline:** `ad5d53d09892cdf7fe43b69d03bf36d0507aaf69`  
**Date:** September 14, 2026  

---

## 1. Context & Purpose

Before beginning implementation of the System-Prompt Control Plane, this document reconciles the authoritative persistence layer for AIRA Work artifacts and establishes explicit architectural invariants regarding `DurableBlob` and `AgentArtifact`.

---

## 2. Reconciled Architectural Truths

### Truth 1: `AgentArtifact` is the Sole Canonical Work Artifact Store
- All Work runs, task deliverables, and agent-generated outputs are persisted exclusively in the PostgreSQL `"AgentArtifact"` table.
- Storage mechanics in `lib/agent-platform/store.ts`:
  - **Insertion:** `createRunArtifact(...)` inserts directly into `"AgentArtifact"`. Content is stored in the `metadata` JSONB column alongside cryptographic SHA-256 hashes (`contentHash`) and byte measurements (`sizeBytes`).
  - **Retrieval:** `getRunArtifact(userId, runId, artifactId)` performs a strict multi-tenant boundary check:
    ```sql
    select a."id", a."projectId", a."runId", a."taskId", a."kind", a."name", a."uri", a."metadata", a."createdAt"
    from "AgentArtifact" a
    join "AgentPlatformRun" r on r."id" = a."runId"
    where a."id" = ${artifactId} and a."runId" = ${runId} and r."userId" = ${userId}
    limit 1
    ```
  - **Listing & Deletion:** `listRunArtifacts(...)` and `deleteRunArtifact(...)` strictly target `"AgentArtifact"` with user-ownership joins on `"AgentPlatformRun"`.
- This architecture was empirically certified in Phase 6 (Gates 11–14) and recertified on candidate `ad5d53d09892cdf7fe43b69d03bf36d0507aaf69`.

### Truth 2: Work Runtime Does NOT Require `DurableBlob`
- An exhaustive scan of `perplexity-clone/my-turborepo/apps/web/lib/` and `apps/web/app/` reveals exactly **zero (0) references** to `DurableBlob`.
- The Work execution pipeline (planner, dispatch engine, task runners, tool execution sandbox, deliverable compilers) has no dependency on `DurableBlob`.
- No active runtime pathway imports, queries, or writes to `DurableBlob`.

### Truth 3: `DurableBlob` Exists Strictly as Unused Legacy Schema
- The `model DurableBlob` in `prisma/schema.prisma` (lines 615–623) and migration `20260907_truthmode_iv_integrity_repairs` was introduced during TruthMode IV integrity migrations to satisfy cold-start schema reflection probes.
- It exists solely as an inert legacy table schema in the database to prevent ORM introspection and reflection anomalies.
- It holds no authoritative operational data and has no consumers.

### Truth 4: Prohibition on Reintroducing `DurableBlob`
- `DurableBlob` MUST NOT be reintroduced as an authoritative Work dependency or artifact store.
- Any attempt to couple Work deliverables, file uploads, knowledge chunks, or agent outputs to `DurableBlob` is strictly prohibited.

### Truth 5: System-Prompt Control Plane Isolation
- All forthcoming system-prompt control-plane work (contracts, version managers, prompt policies, injection sanitization, provider portability) is decoupled from artifact storage.
- System-prompt workflows must not mutate, touch, or alter artifact persistence interfaces or schemas.
