# AIRA AI — Production Rollback Runbook

## 1. When Rollback is Justified
A production rollback is justified under the following critical conditions:
1. **Critical P0 Outage**: Server error rate > 5% on core routes (`/`, `/api/search`, `/api/auth/*`).
2. **Authentication Blocker**: Users unable to log in, CSRF validation broken, or sessions dropping.
3. **Data Loss / Security Vulnerability**: High-risk defect detected post-deployment requiring immediate reversion.

A rollback is NOT justified for minor UI defects, non-critical tool degradations, or single-provider transient issues (handled automatically by provider failover).

---

## 2. Fast Application Rollback (Vercel Instant Promotion)
Vercel enables instantaneous zero-downtime rollback by reassigning the canonical production domain to the previously certified deployment.

### Step 1: Identify Last Certified Deployment
Check release evidence ledger or run provenance tool:
- Baseline Certified Deployment: `dpl_BgBXDSkW1Vj1SWbXpwJCiZtXjgFf` (Commit `44801dea78641fe7d657ec936393168671dff92f`)

### Step 2: Re-assign Production Alias
Execute via Vercel CLI:
```bash
vercel alias set dpl_BgBXDSkW1Vj1SWbXpwJCiZtXjgFf aira-ai-live.vercel.app
```
Or via Vercel REST API:
```bash
curl -X POST "https://api.vercel.com/v2/deployments/dpl_BgBXDSkW1Vj1SWbXpwJCiZtXjgFf/aliases" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alias": "aira-ai-live.vercel.app"}'
```

### Step 3: Verify Canonical Domain Health
```bash
curl -I https://aira-ai-live.vercel.app
curl https://aira-ai-live.vercel.app/api/health
```
Verify `x-vercel-id` reflects the rolled-back deployment.

---

## 3. Database Compatibility & Rollback Constraints
1. **Additive Forward-Compatibility**: All AIRA migrations are strictly additive (new tables, nullable columns, non-blocking indexes). Older application deployments remain fully functional against newer additive schemas.
2. **Forward-Fix Preference**: For database schema issues, forward-fix with a corrective migration is preferred over rolling back DDL, as dropping columns/tables risks data loss.
3. **Compensating Migration**: If a schema change must be reversed:
   - Never execute `DROP TABLE ... CASCADE` ad-hoc.
   - Author a safe compensating migration that cleans up orphaned state.
   - Apply via CI workflow `.github/workflows/production-migration.yml`.

---

## 4. Rollback Authorization
- Production rollback may be authorized by: Tech Lead, SRE Lead, or Incident Commander.
- Every rollback event must produce a post-incident review (PIR) and update the Release Evidence ledger.
