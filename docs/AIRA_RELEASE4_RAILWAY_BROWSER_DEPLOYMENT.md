# AIRA Release 4 — Phase 5 Railway Preview Browser Runtime Deployment & Portability Architecture

## 1. Architectural Statement: Portability & Zero Vendor Lock-in

**Declaration**: `RAILWAY_IS_REPLACEABLE_DEPLOYMENT_TARGET`  
**Vendor Lock-in**: `RAILWAY_PROVIDER_LOCK_IN = NONE`

AIRA does not contain any Railway SDK, Railway API clients, Railway-specific database fields, or Railway-specific orchestration logic. The AIRA Browser architecture strictly abstracts the remote Browser runtime through standard HTTPS environment variables:
- `AIRA_BROWSER_RUNTIME_ENABLED`: Controls activation of the remote browser client (`true` / `false`).
- `AIRA_BROWSER_RUNTIME_URL`: The public HTTPS endpoint of the browser worker service.
- `AIRA_BROWSER_RUNTIME_TOKEN`: Shared secret token validated via constant-time HMAC comparison (`timingSafeEqual` in TypeScript, `hmac.compare_digest` in Python).

The Browser runtime service (`infra/browser-worker`) is fully containerized with Microsoft Playwright and FastAPI and can be deployed interchangeably to:
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
- **Dynamic Port Support**: `PORT` environment variable override supported via:
  ```dockerfile
  CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port \"${PORT:-8080}\" --workers 1 --proxy-headers --no-server-header"]
  ```
  This guarantees seamless port routing across Railway (dynamic `$PORT`), Cloud Run (dynamic `$PORT`), Fly.io, or standard local Docker Compose (port 8080).
- **Health Check Path**: `/healthz`
  - Expected Status: `HTTP 200`
  - Expected Payload: `{"ok": true}` (Discloses zero tokens, process IDs, or system internals).
- **Session Affinity Model**: `SINGLE_REPLICA_IN_MEMORY`
  - Active Playwright `BrowserContext` instances are held in the worker process memory.
  - Exactly 1 replica is provisioned in Preview to ensure state consistency without complex distributed session affinity routers.

---

## 3. Platform & Entitlement Audit: Railway Free / No-Card Requirement

In accordance with AIRA Release 4 Absolute Governance Rules:
> *"If Railway requires: credit card / payment method / paid upgrade / paid resource / billing activation -> STOP immediately. Return: RAILWAY_FREE_NO_CARD_DEPLOYMENT_BLOCKED and explain the exact Railway requirement."*

### Entitlement Investigation Findings:
1. **CLI Status**: `@railway/cli` v5.54.0 was verified locally. Non-interactive inspection via `railway whoami` confirmed unauthenticated state.
2. **Billing Policy**: Railway's modern pricing architecture retired free tiers without payment verification. Railway enforces:
   - Mandatory credit/debit card on file for account verification prior to creating services or allocating container execution resources.
   - Restricted outbound internet access for unverified trial accounts, which would block Playwright from reaching public websites (`example.com`, `nextjs.org`).
   - Hobby Plan ($5/mo) requires a credit card.
3. **Audit Outcome**: Railway cannot be provisioned in an unauthenticated, zero-credit-card environment. In strict compliance with instructions, no credit card or paid billing was provisioned.
4. **Current Status**: `RAILWAY_FREE_NO_CARD_DEPLOYMENT_BLOCKED`

---

## 4. Universal Provider Migration Procedure

Because the AIRA Browser integration maintains zero vendor lock-in, migrating from Railway to another container runtime (Fly.io, Cloud Run, AWS ECS, self-hosted VM) follows this zero-downtime, zero-code-change procedure:

1. **Deploy Container Image**:
   Build and deploy `infra/browser-worker/Dockerfile` to the chosen container provider.
2. **Configure Provider Secrets**:
   Set `AIRA_BROWSER_RUNTIME_TOKEN` in the container provider's secret management.
3. **Verify Worker Health**:
   Send unauthenticated `GET /healthz` to confirm `HTTP 200 {"ok": true}`.
   Verify authenticated request rejection on `/v1/sessions` without valid token (`HTTP 401`).
4. **Update Vercel Configuration**:
   Update Vercel Preview environment variables:
   - `AIRA_BROWSER_RUNTIME_URL`: Set to new provider's HTTPS origin.
   - `AIRA_BROWSER_RUNTIME_TOKEN`: Set to matching shared secret.
5. **Drain Existing Sessions**:
   Existing in-flight sessions naturally expire after `ttlSeconds` (default 300s). Active sessions can finish or auto-reconcile on next interaction.
6. **Switch Traffic**:
   Deploy / redeploy Vercel Preview to pick up the new runtime URL.
7. **Decommission Old Host**:
   Retain old worker temporarily for rollback assurance; decommission after session drainage.
