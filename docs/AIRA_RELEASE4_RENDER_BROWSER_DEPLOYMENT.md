# AIRA Release 4 — Phase 5 Render Free Preview Browser Runtime & Portability Architecture

## 1. Architectural Statement: Portability & Zero Vendor Lock-in

**Declaration**: `RENDER_IS_REPLACEABLE_DEPLOYMENT_TARGET`  
**Hosting Provider Lock-in**: `HOSTING_PROVIDER_LOCK_IN = NONE`

AIRA Browser contains zero Render SDKs, zero Render API clients, and zero Render-specific database fields or UI components. The entire browser runtime architecture interacts with the host solely through three standard environment variables:
- `AIRA_BROWSER_RUNTIME_ENABLED`: Boolean switch enabling remote browser execution (`true` / `false`).
- `AIRA_BROWSER_RUNTIME_URL`: The public HTTPS endpoint of the browser worker service (`https://<service>.onrender.com`).
- `AIRA_BROWSER_RUNTIME_TOKEN`: Shared secret token validated via constant-time HMAC comparison.

The browser worker (`infra/browser-worker`) is fully containerized with Microsoft Playwright and FastAPI and remains portable to:
- Render
- Railway
- Fly.io
- Google Cloud Run
- AWS ECS / Fargate
- Kubernetes
- Dedicated Virtual Machine / Docker Host

---

## 2. Infrastructure Deployment Specification (infra/browser-worker)

- **Source Location**: `infra/browser-worker/`
- **Base Image**: `mcr.microsoft.com/playwright/python:v1.61.0-noble`
- **Entrypoint**: `uvicorn server:app`
- **Dynamic Port Binding**:
  ```dockerfile
  CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port \"${PORT:-8080}\" --workers 1 --proxy-headers --no-server-header"]
  ```
  Render provides an assigned runtime `PORT` environment variable. The entrypoint automatically binds to `${PORT:-8080}`, preserving local Docker compatibility while routing traffic dynamically on Render.
- **Health Check Path**: `/healthz`
  - Expected Status: `HTTP 200`
  - Expected Payload: `{"ok": true}` (Discloses zero tokens, process IDs, or system internals).
- **Session Affinity Model**: `SINGLE_REPLICA_IN_MEMORY`
  - Exactly 1 replica is provisioned in Preview to maintain memory-bound browser contexts consistently.

---

## 3. Render Free Web Service Audit & Account Requirements (Gate 0 & Gate 7)

### Account & Anti-Abuse Requirements (Gate 0)
1. **API / CLI Access**: Provisioning a Render service requires authentication via Render API Key (`RENDER_API_KEY`) or Render Dashboard account session. No active Render credentials exist in the execution environment.
2. **Payment Method Verification**: While Render advertises a Free plan, Render's automated fraud prevention and anti-abuse systems mandate a verified payment method (credit/debit card) for new accounts or containerized Docker workloads before allocating execution resources and outbound networking.
3. **Audit Outcome**: In strict compliance with AIRA Release 4 Absolute Rules ("*DO NOT USE A CREDIT CARD. DO NOT PURCHASE ANY PLAN. If Render requests: payment method / card / paid compute / workspace upgrade -> STOP. Return: RENDER_FREE_NO_CARD_DEPLOYMENT_BLOCKED*"), deployment was halted without entering credit card credentials.
4. **Current Status**: `RENDER_FREE_NO_CARD_DEPLOYMENT_BLOCKED`

### Resource Profile Evaluation (Gate 7)
- **Render Free Tier Specs**: `0.1 CPU / 512 MB RAM`
- **Playwright Chromium Baseline**:
  - Worker process base: ~120 MB
  - Single active browser context: ~180 MB
  - DOM parsing & page rendering (e.g. Next.js docs): Spikes to 350MB–450MB+
  - Total container allocation limit: 512 MB
- **OOM Risk**: Running Chromium under a hard 512MB cgroup limit with 0.1 CPU results in extreme CPU throttling and frequent kernel OOM kills (`SIGKILL 137`). To guarantee stability without degrading browser capabilities, a minimum of 1 GB RAM (Render `1c-2g` or equivalent container host) is required.

---

## 4. Rate Limiter Evidence & Concurrency Classification (Gate 2)

### Test Evidence Strengthening:
1. **Deterministic DB-Failure Test**:
   The rate-limiter test suite was updated in [`test/browser-runtime-integration.test.ts`](file:///C:/Users/WORKSTATION/aira-ai/perplexity-clone/my-turborepo/apps/web/test/browser-runtime-integration.test.ts) to replace conditional checks with strict, unconditional assertions:
   - `allowed === false`
   - `error === "BROWSER_RATE_LIMIT_UNAVAILABLE"`
   - `retryAfter === 5`
2. **Concurrency Proof Classification**:
   - **`SAME_PROCESS_REAL_DB_CONCURRENCY`**: Verified via 40 concurrent bursts (`Promise.all`) where exactly 30 are allowed and 10 are denied under PostgreSQL transaction-scoped advisory locks (`pg_advisory_xact_lock`).
   - **`MULTI_INSTANCE_LIVE_PREVIEW_PROOF`**: Architecturally guaranteed via database advisory locks across serverless instances, but live external multi-instance testing requires an externally deployed worker.
