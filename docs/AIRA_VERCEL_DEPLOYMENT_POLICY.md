# AIRA AI — Vercel Deployment Safety & Release Policy

## 1. Overview & Lessons from Release 4
In Release 4, reconciling `main` via Git push resulted in an unexpected automatic Vercel production deployment (`dpl_BgBXDSkW1Vj1SWbXpwJCiZtXjgFf`) because Vercel Git integration monitors `main` commits and immediately schedules builds. While the SHA was identical and zero regressions occurred, production releases must follow a deterministic, gated pipeline.

---

## 2. Standard Promotion Architecture

```
Feature Branch (feat/*)
         │
         ▼
Pull Request (PR)
         │
         ├──> GitHub Actions CI Gates (Lint, Typecheck, Test, Migration Bytes, Disposable DB)
         └──> Vercel Preview Deployment Generated
         │
         ▼
Preview Certification
  - Verify /api/health (200 OK)
  - Verify /api/ready (200 OK)
  - Verify /api/search (SSE streaming, real AI provider output)
  - Error hygiene verification (400 on malformed input, 0 HTTP 500)
         │
         ▼
CI-Owned Production Migration (if database changes are required)
  - Triggered via .github/workflows/production-migration.yml
  - Requires target_git_sha and explicit confirmation
  - Runs preflight (read-only) -> migrate deploy -> postflight
         │
         ▼
Production Deployment Promotion
  - Promote certified Preview deployment to Production via Vercel CLI / REST API,
    OR fast-forward merge PR to main after all gates PASS.
         │
         ▼
Live Production Verification
  - Verification suite against https://aira-ai-live.vercel.app
  - Final evidence generation and closure sign-off
```

---

## 3. Environment Variable Hygiene & Least Privilege
- **Runtime Environment**: Vercel production instances only require `DATABASE_URL` (Supavisor pooled transaction connection).
- **Migration Credentials**: `DIRECT_URL` (direct port 5432 session pooler connection) is used strictly by CI during migration execution.
- **Turborepo Alignment**: `DIRECT_URL` is declared in `turbo.json` `globalEnv` to prevent cache invalidation warnings during builds that inspect environment keys.
