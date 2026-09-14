# AIRA Release 4 — Production Deployment & Operational Runbook

**Authoritative Production Deployment Sequence, Smoke Verification, & Rollback Procedures**  
**Repository:** `rajpunkeshwarrajgautam-boop/aira-ai`  
**Current Branch:** `feat/aira-release-4-runtime-activation`  
**Target Release:** Release 4 (Phases 1–6)  
**Strict Safety Rule:** DO NOT execute this runbook during Phase 6 preview certification. This runbook is the approved protocol for eventual public production cutover.

---

## 1. Pre-Deployment Verification Checklist

Before triggering production deployment:
1. [ ] **Git Working Tree**: Ensure `main` or release branch is clean and contains the certified certification commit SHA.
2. [ ] **Build Validation**: Ensure `npx tsc --noEmit` and `npm run build` pass with exit code 0.
3. [ ] **Test Coverage**: All unit, integration, route auth, and regression tests pass with 0 failures (`P0 = 0`, `P1 = 0`).
4. [ ] **Preview Verification**: Exact Vercel Preview deployment certified and confirmed with `READY` state.
5. [ ] **Zero Secret Leakage**: Audit commits with git secret scanning; no credentials committed.

---

## 2. Production Cutover Procedure (Step-by-Step)

### Step 1: Database Snapshot / Backup
1. Execute schema and data backup from primary Supabase host prior to applying migrations:
   ```bash
   # Create safe SQL dump before applying migrations
   pg_dump --clean --if-exists --no-owner --no-privileges -d "$DIRECT_URL" -f "pre-release-4-backup-$(date +%Y%m%d_%H%M%SZ).sql"
   ```
2. Verify WAL point-in-time recovery availability in Supabase Dashboard.

### Step 2: Additive Database Migrations
1. Run Prisma migrate deploy against the production database using direct connection with verified TLS:
   ```bash
   # Uses DIRECT_URL (port 5432 session pooler with sslmode=verify-full)
   npx prisma migrate deploy
   ```
2. Validate that all migrations applied cleanly:
   - `AgentPlatformRun` table and indexes
   - `AgentTask` table and leases
   - `AgentArtifact` table
   - `AgentApproval` table
   - `BrowserSession` table

### Step 3: Production Environment Variable Configuration
Verify in Vercel Production Environment:
- `AIRA_WORK_RUNTIME_ENABLED=true`
- `AIRA_AGENT_RUNTIME_PRIORITY=AIRA_AGENT,DEERFLOW,AUTOGPT`
- `DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[POOLER_HOST]:6543/postgres?sslmode=verify-full` (production pooled connection)
- `DIRECT_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[POOLER_HOST]:5432/postgres?sslmode=verify-full` (direct PostgreSQL connection for migrations)
- `AUTH_SECRET` (production 32-byte secret)
- `NVIDIA_NIM_API_KEY` (production funded key)
- `OPENAI_API_KEY` (production funded key)
- `AIRA_BROWSER_RUNTIME_URL` (hosted browser service HTTPS endpoint)
- `AIRA_BROWSER_RUNTIME_TOKEN` (shared authorization secret)

> [!IMPORTANT]
> Both `DATABASE_URL` and `DIRECT_URL` must explicitly specify `sslmode=verify-full`. This enforces full X.509 certificate chain validation and SNI hostname verification against Node.js root CAs, preventing MITM vulnerabilities and eliminating node-postgres (`pg` v8/v9) deprecation warnings.

### Step 4: Production Deployment
1. Deploy exact certified commit SHA to production:
   ```bash
   npx vercel --prod
   ```
2. Record deployment ID, immutable URL, and SHA.

### Step 5: Production Smoke Test
1. **Health Probes**:
   - `GET https://aira-ai-live.vercel.app/api/omniroute/status` -> 200 OK
   - `GET https://aira-ai-live.vercel.app/api/agent-platform/runtime/status` -> 200 OK (`ready: true`)
2. **Database TLS & Connectivity Verification**:
   - Verify Vercel deployment runtime logs show zero `SECURITY WARNING: The SSL modes 'prefer', 'require' ...` warnings from `pg-connection-string`.
   - Verify Prisma queries execute with `sslmode=verify-full` cleanly over Supavisor.
3. **Work Surface**:
   - Load `/work` in browser
   - Submit test objective: "Research route handlers"
   - Confirm server-side plan returns tasks, budget ceilings, and risk analysis
   - Launch managed run -> verify redirect to `/work/runs/[runId]`
   - Verify task graph, live events, deliverables, and acceptance verification
4. **Tenant Security**:
   - Log in as test User B -> attempt `GET /api/agent-platform/runs/[userA_runId]` -> must return 404.

---

## 3. Rollback Protocol

If any P0 defect, unhandled exception, or unexpected regression occurs post-cutover:

### Immediate Rollback (Zero Downtime)
1. Re-promote the known stable production deployment:
   ```bash
   # Re-alias production domain to known good deployment
   npx vercel rollback dpl_8XH4S9CpGmEg781J4htovF1w863S
   ```
2. If managed execution experiences unexpected failure without site degradation, activate the emergency killswitch in Vercel Production:
   ```bash
   npx vercel env add AIRA_WORK_RUNTIME_ENABLED production --value false --force
   npx vercel redeploy
   ```
3. If database changes caused incompatibilities:
   - Restore database state from pre-release SQL backup or Supabase point-in-time recovery.

---

## 4. Post-Launch Monitoring
1. Monitor Vercel error rate (target < 0.05%).
2. Track database connection pool saturation.
3. Monitor LLM provider token usage and rate limits.
4. Verify execution leases are cleanly released upon task completion.
