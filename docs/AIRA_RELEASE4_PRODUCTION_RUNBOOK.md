# AIRA Release 4 — Production Deployment & Operational Runbook

**Authoritative Production Deployment Sequence, Smoke Verification, & Rollback Procedures**  
**Repository:** `rajpunkeshwarrajgautam-boop/aira-ai`  
**Current Branch:** `feat/aira-release-4-runtime-activation`  
**Target Release:** Release 4 (Phases 1–6)  
**Certified Application Product Candidate:** `1b2f09e9a09f4bef1a9764a802230faf2f7b528e`  
**Certified Preview Deployment:** `dpl_H8mQvnPxM7cMGo38jjQfVHhsVBbS`  
**Strict Safety Rule:** DO NOT execute this runbook during Phase 6 preview certification. This runbook is the approved protocol for eventual public production cutover. Cutover is authorized ONLY after the user explicitly issues the command: `MAKE IT LIVE`.

---

## 1. Pre-Deployment Verification Checklist (14 Launch Prerequisites)

Before triggering production deployment, all 14 prerequisites must be satisfied:
1. [ ] **Production PostgreSQL TLS Configuration**: Apply `sslmode=verify-full` to both `DATABASE_URL` and `DIRECT_URL`.
2. [ ] **Production Environment Variables**: Verify all production variables are set (`AIRA_WORK_RUNTIME_ENABLED=true`, `AUTH_SECRET`, etc.).
3. [ ] **Production Provider Credentials**: Verify active funded keys for NVIDIA NIM, OpenAI, and Exa.
4. [ ] **Production Supabase Connection**: Verify pooled (6543) and direct (5432) connectivity with valid TLS certificates.
5. [ ] **Approved Production Migration Procedure**: Run `npx prisma migrate deploy` via direct port if schema changes are required.
6. [ ] **Deploy / Promote Exact Certified Candidate**: Deploy exact SHA `1b2f09e9a09f4bef1a9764a802230faf2f7b528e` to production.
7. [ ] **Execute Production Smoke Tests**: Validate `/api/omniroute/status` and `/api/agent-platform/runtime/status`.
8. [ ] **Inspect Production Logs**: Ensure clean log window after smoke run.
9. [ ] **Confirm No Dead NVIDIA Model**: Confirm `nvidia/nemotron-3-nano-30b-a3b` is not attempted; verify `meta/llama-3.2-11b-vision-instruct` default.
10. [ ] **Confirm No DurableBlob Errors**: Verify zero references to missing `DurableBlob` table.
11. [ ] **Confirm No Unexpected 500s**: Verify zero 500 status codes.
12. [ ] **Confirm Auth & Tenant Isolation**: Verify User B receives 404 on User A resources.
13. [ ] **Confirm Work Path**: Verify end-to-end plan -> project -> run -> tick execution on `/work`.
14. [ ] **Confirm Rollback Path**: Verify instant rollback to `dpl_8XH4S9CpGmEg781J4htovF1w863S` is primed and ready.

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
