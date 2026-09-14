# AIRA Release 4 — Public Launch Readiness Ledger

**Authoritative Cross-Phase Production Readiness & Launch Dependency Ledger**  
**Repository:** `rajpunkeshwarrajgautam-boop/aira-ai`  
**Branch:** `feat/aira-release-4-runtime-activation`  
**Last Updated:** 2026-09-13  
**Policy:** From Phase 6 onward, every phase maintains two separate statuses:
1. **Feature Certification** (e.g. `WORKING_E2E_IN_PREVIEW`, `PARTIAL`, `CONFIGURATION_BLOCKED`, `INFRASTRUCTURE_BLOCKED`, `HIDDEN`)
2. **Public Launch Readiness** (e.g. `PRODUCTION_READY`, `PREVIEW_ONLY`, `LAUNCH_BLOCKER`, `PRODUCTION_CONFIGURATION_REQUIRED`, `PRODUCTION_INFRASTRUCTURE_REQUIRED`)

---

## 1. Subsystem Capability & Launch Readiness Matrix

| Subsystem / Feature | Preview Feature Status | Public Launch Readiness | Production Dependency | Launch Blocker? | Required Remediation | Owner / System | Last Verified SHA |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AIRA Route** | `WORKING_E2E_IN_PREVIEW` | `PRODUCTION_CONFIGURATION_REQUIRED` | Production provider API keys, failover, quota ceilings, timeouts | No (config only) | Verify production keys for NVIDIA NIM, OpenAI, and OmniRoute gateway failover in Vercel Production. | OmniRoute Gateway / Model Routing | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Knowledge** | `WORKING_E2E_IN_PREVIEW` | `PRODUCTION_INFRASTRUCTURE_REQUIRED` | Ingestion worker hosting, storage durability, embedding quotas | Yes (worker hosting) | Host dedicated Redis Stream knowledge worker (`infra/foundation/knowledge-worker`) on 24/7 container platform. | Knowledge Worker / Supabase Vector | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Agents** | `WORKING_E2E_IN_PREVIEW` | `PRODUCTION_CONFIGURATION_REQUIRED` | Production runtime provider (`DEERFLOW`), Tool Gateway secrets | No (config only) | Configure production DeerFlow runtime API token and tool gateway credentials in Vercel Production. | Agent Platform / Runtime Registry | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Browser** | `WORKING_E2E_IN_PREVIEW` | `PRODUCTION_INFRASTRUCTURE_REQUIRED` | Workstation Docker + Quick Tunnel must be replaced by always-on hosted worker | Yes (infra hosting) | Provision 24/7 remote containerized FastAPI + Playwright browser worker with HTTPS endpoint; set `AIRA_BROWSER_RUNTIME_URL` and `AIRA_BROWSER_RUNTIME_TOKEN`. | Browser Worker / Playwright | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Work** | `WORKING_E2E_IN_PREVIEW` | `PRODUCTION_CONFIGURATION_REQUIRED` | Managed runtime provider, distributed rate limiting, server quotas | No (depends on Phase 4/5) | Bind server-authoritative budgets, mission control UI, dedicated runtime probe, deliverable store. | Agent Platform / Work Orchestrator | `e34c461a19fe0b02bc65f0a0fab75051eaa7efb6` |
| **AIRA Builder** | `PARTIAL` | `LAUNCH_BLOCKER` | Isolated container sandboxes, filesystem isolation, code-gen execution | Yes | Phase 7 scope — isolated sandbox execution environment required before public build capability. | Sandbox Architecture / Phase 7 | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Automations**| `PARTIAL` | `LAUNCH_BLOCKER` | Durable queue worker, cron scheduling, failure notifications | Yes | Phase 8 scope — background queue infrastructure required for unattended recurring workflows. | Automation Engine / Phase 8 | `1debb0f0618684f7db6eb1a1ef47e85108164509` |
| **AIRA Teams** | `HIDDEN` | `LAUNCH_BLOCKER` | Multi-agent swarms, complex orchestration | Yes | Phase 9 scope — intentionally gated until single-agent and managed execution are mature. | Swarm Architecture / Phase 9 | `1debb0f0618684f7db6eb1a1ef47e85108164509` |

---

## 2. Production Infrastructure & Operational Readiness

| Operational Domain | Status | Production Requirement / Dependency | Remediation Plan |
| :--- | :--- | :--- | :--- |
| **Authentication** | `PRODUCTION_READY` | Auth.js v5 with Google & GitHub OAuth, session cookies | Production OAuth app credentials configured in Vercel Production. |
| **Database** | `PRODUCTION_READY` | Supabase PostgreSQL 17.6 with Supavisor transaction pooling | Enforce `sslmode=verify-full` on all production connection strings (`DATABASE_URL` and `DIRECT_URL`); execute migrations on direct port only during scheduled cutover windows. |
| **Storage** | `PRODUCTION_READY` | Supabase Storage bucket / AgentArtifact PostgreSQL table | Canonical artifact persistence via `AgentArtifact`; verify S3/Supabase storage bucket policies for external media assets. |
| **Workers** | `PRODUCTION_INFRASTRUCTURE_REQUIRED` | Knowledge worker & Browser worker | Container deployment on hosted provider (Fly.io, Render, or dedicated VM). |
| **Queues** | `PRODUCTION_INFRASTRUCTURE_REQUIRED` | Redis stream (`aira:jobs:knowledge.ingest`) | Upstash Redis or managed Valkey instance in production region. |
| **Provider APIs** | `PRODUCTION_CONFIGURATION_REQUIRED` | OpenAI, NVIDIA NIM (`meta/llama-3.2-11b-vision-instruct`), Exa search | Add funded production API keys with rate-limit monitors; verified active default model. |
| **Observability** | `PRODUCTION_CONFIGURATION_REQUIRED` | Structured JSON logs, latency tracking, error taxonomy | Configure log aggregation (Vercel Log Drains / Datadog / Axiom). |
| **Rate Limits** | `PRODUCTION_READY` | PostgreSQL distributed advisory lock + sliding window events | Authoritative Postgres rate limiters verified in Phase 5. |
| **Abuse Controls** | `PRODUCTION_READY` | Server-authoritative budgets, prompt length limits, tool allowlists | Enforce client input validation and server quota checks. |
| **Privacy** | `PRODUCTION_READY` | Redaction of tokens, cookies, passwords in logs and events | Redaction utilities verified across tool gateway and agent platform. |
| **Backups** | `PRODUCTION_READY` | Supabase automated daily backups and WAL point-in-time recovery | Point-in-time recovery enabled on primary production instance. |
| **Migrations** | `PRODUCTION_READY` | Prisma additive migrations | Strictly non-destructive, reviewable additive SQL migrations. |
| **Cost Controls** | `PRODUCTION_READY` | Per-plan monthly quota, per-run cost ceiling, hard max tokens | Strict server-side entitlement checks before execution dispatch. |
| **Secrets** | `PRODUCTION_READY` | Zero secrets in repo; Vercel encrypted environment variables | Server-only env variables; client bundles audited for leakage. |
| **Incident Recovery** | `PRODUCTION_READY` | Graceful capability degradation, typed error taxonomy | Detailed error codes (`WORK_RUNTIME_UNAVAILABLE`, etc.) without stack leaks. |
| **Production Hosting**| `PRODUCTION_READY` | Vercel Edge & Serverless platform | Primary production deployment `dpl_8XH4S9CpGmEg781J4htovF1w863S` stable. |
| **Production Env** | `PRODUCTION_READY` | Production environment variables isolated from preview | Explicit environment flags (`AIRA_WORK_RUNTIME_ENABLED`). |
| **Rollback** | `PRODUCTION_READY` | Vercel instant deployment rollback + Prisma down-migrations | Rollback deployment `dpl_8XH4S9CpGmEg781J4htovF1w863S` recorded. |

---

## 3. Phase 6 AIRA Work Specific Launch Requirements

1. **Feature Status Target**: `AIRA_WORK_WORKING_E2E_IN_PREVIEW`
2. **Public Launch Readiness Target**: `PRODUCTION_CONFIGURATION_REQUIRED`
3. **Execution Model**:
   - Server-authoritative capability planning (`POST /api/agent-platform/plan`)
   - Server-enforced budgets (`maxCostUsd`, `maxDurationMinutes`, `maxTokens`)
   - Dedicated runtime status endpoint (`GET /api/agent-platform/runtime/status`)
   - Work-native mission control UI at `/work` and `/work/runs/[runId]` without `/build` coupling
   - Multi-step managed tasks with persisted deliverables and acceptance verification
   - Idempotent launch via `clientRequestId` and distributed lease locking
   - Cross-user tenant isolation (User B receives 404 on User A's projects/runs/tasks/artifacts)
   - Zero synthetic completion without persisted evidence

---

## 4. Gate 17: Production PostgreSQL TLS / SSL Hardening Specification

### 4.1 Topology & Scope
- **Provider**: Supabase PostgreSQL 17.6
- **Current Preview State**: Isolated non-production cluster (`127.0.0.1:5432/aira_gate29_local`), loopback transport without external network transit.
- **Current Production State**: Primary hosted Supabase cluster (`aws-1-ap-south-1.pooler.supabase.com` / `aws-0-us-west-1.pooler.supabase.com`) multiplexed via Supavisor pooler.
- **Driver Stack**: Next.js Serverless runtime utilizes `@prisma/adapter-pg` backed by `pg.Pool` (`pg` v8.20.0). Prisma CLI executes migrations via direct PostgreSQL connection.

### 4.2 Security Vulnerability & Driver Semantics Audit
1. **Warning Root Cause**: When `sslmode=require` is passed to node-postgres (`pg` v8.20.0), `pg-connection-string` currently aliases `require` to `verify-full` in memory, but emits an active deprecation warning:
   ```
   SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
   In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.
   ```
2. **Standard `libpq` Risk**: Under standard `libpq` semantics, `sslmode=require` only requests an encrypted connection without verifying the server's certificate or hostname, creating exposure to Man-in-the-Middle (MITM) attacks and silent certificate spoofing.
3. **Remediation Strategy**: **OPTION A — VERIFY-FULL**. Explicitly configuring `sslmode=verify-full` enforces complete X.509 certificate validation and SNI hostname verification against Node.js's trusted root CA store while eliminating driver deprecation warnings. Because Supabase endpoints use standard public CA certificates, `sslmode=verify-full` succeeds natively without requiring custom CA bundles.

### 4.3 Production Connection String Configuration
Prior to public launch, the production environment variables in Vercel must be formatted as follows (using redacted placeholders):

```bash
# 1. Next.js Serverless Application Runtime (Supavisor Transaction Pooler, Port 6543)
DATABASE_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[POOLER_HOST]:6543/postgres?sslmode=verify-full"

# 2. Prisma DDL Migration Runner (Direct / Session Pooler, Port 5432)
DIRECT_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[POOLER_HOST]:5432/postgres?sslmode=verify-full"
```

### 4.4 Operational Protocol
- **Performed By**: Production DevOps Engineer / Security Operator.
- **Timing**: During scheduled public release cutover window (Gate 24), strictly isolated from preview testing.
- **Verification Procedure**:
  1. Inspect runtime connection in Node: `new pg.Client({ connectionString: process.env.DATABASE_URL })` must resolve `client.ssl: {}` with zero warning output.
  2. Test migration readiness: `npx prisma db execute --stdin` executes successfully over `DIRECT_URL`.
  3. Verify health probe: `GET https://aira-ai-live.vercel.app/api/health` or `/api/auth/csrf` succeeds with HTTP 200.
- **Rollback Procedure**: If certificate verification fails due to unexpected upstream DNS or intermediate proxy changes, temporarily revert `sslmode` to `require` while investigating the certificate chain, ensuring zero unmonitored production downtime.
