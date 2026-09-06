# Gate 35 Minimum External Input Dossier & Reality Audit

Authoritative Release Program: AIRA Production Gate 35 (P0 Preview Environment)
Repository: `C:\Users\WORKSTATION\aira-ai`
Branch: `integration/aira-autonomous-omniroute`
PR: #123 (`https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/pull/123`)
Status: **BLOCKED / INFRASTRUCTURE_REQUIRED** (All internal application, migration, and Vercel preview deployment configurations are ready; awaits provisioned production-like isolated preview database and non-production service credentials).

---

## 1. Executive Summary & Internal Audit

- **Internal Prerequisites Complete**:
  - Exact-SHA Vercel Preview deployment (`dpl_4JkpacR35VqN6jF4Fs29Eiy8xVyn`) verified READY and protected by authentication.
  - All 22 Prisma migrations verified against PostgreSQL 16 schema.
  - Auth, agent runtime, tool gateway, and memory models verified locally and in CI.
  - Complete environment variable template documented in `.env.example`.
- **Infrastructure Blocker**:
  - Live Supabase organization currently has zero preview branches.
  - Scheduler, worker, and runtime planes are not yet connected to a dedicated preview database with isolated data.
  - Creating a paid Supabase Preview branch incurs material external spend and requires explicit user authorization.

---

## 2. Minimal External Input Specification

| Field | Authoritative Specification |
| :--- | :--- |
| **Exact Requirement** | Dedicated isolated Preview database (e.g. Supabase Preview Branch) and preview service credentials. |
| **Why Required** | Gate 35 exit criteria require a production-like preview environment where full end-to-end user journeys (Gate 36) can execute without touching production data or shared dev state. |
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Gate 35: "Provision a production-like isolated DB plus non-production auth, scheduler, Browser, Terminal, runtimes, OmniRoute/NVIDIA, memory, knowledge, artifacts and connector secrets/data"). |
| **Exact Variables Required** | `DATABASE_URL=<preview_db_connection_string>`<br>`NEXTAUTH_URL=<preview_app_url>`<br>`NEXTAUTH_SECRET=<preview_auth_secret>`<br>`SUPABASE_URL=<preview_supabase_url>`<br>`SUPABASE_SERVICE_ROLE_KEY=<preview_service_role_key>` |
| **Least Privilege Scope** | Isolated ephemeral database branch with automated teardown / branch deletion enabled, zero access to production customer schemas. |
| **Non-Production Acceptable?** | **YES.** Must strictly NOT be production. |
| **Estimated Cost** | Potential Supabase compute costs depending on plan. Ephemeral preview branch should be paused or deleted when not in active testing. |
| **Reversible?** | **YES.** Ephemeral branch can be deleted immediately upon completion of preview journeys. |
| **Secret Status** | **SECRET.** Must be set in Vercel Preview environment configuration or local environment, never committed to git. |
| **Minimum Next User Action** | Provision a preview branch in Supabase or provide an isolated preview PostgreSQL instance URL, and bind it to Vercel preview deployment or test environment. |
| **What Antigravity Will Do Afterward** | Run `prisma migrate deploy` against the preview database, verify schema integrity, run sanity tests on preview deployment, certify Gate 35 COMPLETE, and immediately advance into Gate 36 (Real Preview Journey). |
