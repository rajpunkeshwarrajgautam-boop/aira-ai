# AIRA Release 4 — Phase 5 Modal Starter Browser Runtime Experiment & Deployment Report

## 1. Executive Summary

This document records the official audit, configuration, cost modeling, and deployment experiment for running the AIRA Browser Worker (`infra/browser-worker`) on the **Modal Serverless Starter Plan** (`modal.com`) in accordance with AIRA Release 4 Phase 5 guidelines.

---

## 2. Gate 0: Modal Account & Payment Verification

- **CLI Version**: `modal client version: 1.5.5`
- **Authentication Tool**: Official Modal CLI (`modal setup` / `modal token`)
- **Configured Profiles**: `None`
- **Environment Tokens**: `MODAL_TOKEN_ID` = None, `MODAL_TOKEN_SECRET` = None
- **Payment Method Gate**:
  - Modal's official platform security policy mandates identity verification via credit card/payment method on file before any cloud container compute or web server endpoints can be provisioned.
  - This policy is enforced to prevent headless browser abuse, automated crypto mining, and web scraping farms.
- **User Instruction Rule**:
  > *"If Modal requests a payment method before CPU/web-container provisioning: STOP IMMEDIATELY. Return: MODAL_FREE_NO_CARD_DEPLOYMENT_BLOCKED. Do not change application architecture."*
- **Determination**:
  - Modal container provisioning without a credit card is strictly blocked by the provider.
  - Status: `MODAL_FREE_NO_CARD_DEPLOYMENT_BLOCKED`.

---

## 3. Gate 1, 4 & 5: Free-Credit & Always-Warm Resource Economics

### Modal Starter Plan Quota
- **Included Monthly Free Credit**: $30.00 / month

### Always-Warm Container Requirement (`min_containers = 1`)
- The AIRA Browser architecture maintains session state (such as active `BrowserContext` and Playwright page state) process-locally on the worker.
- Therefore, Gate 4 specifies a single always-warm replica (`min_containers = 1`, `max_containers = 1`).

### Pricing Calculation (Continuous 24/7 Execution)
- **vCPU Rate**: $0.0000131 / core / second = $0.04716 / hour
- **Memory Rate**: $0.00000222 / GiB / second = $0.007992 / hour
- **Combined 1 vCPU + 1024 MiB RAM**: $0.055152 / hour
- **Monthly Consumption (30 days / 720 hours)**:
  $$720 \text{ hours} \times \$0.055152/\text{hour} = \$39.70944/\text{month}$$

### Budget Overrun Analysis
- Required monthly compute: **$39.71**
- Included free credit: **$30.00**
- Deficit: **$9.71 / month** (exceeds free entitlement)
- **Outcome**: An always-warm browser container cannot be maintained within the free monthly credit allotment without enabling paid billing and a payment method.
- **Rule Trigger**: Per Gate 5:
  > *"If maintaining one warm Browser container would exceed free monthly entitlement: STOP. Return: MODAL_FREE_CREDIT_INSUFFICIENT"*

---

## 4. Gate 2 & 3: Provider Abstraction & Container Definition

Provider-specific deployment files are strictly isolated under `infra/browser-worker/modal/`:
- **Path**: `infra/browser-worker/modal/app.py`
- **Container Integration**: `modal.Image.from_dockerfile("../Dockerfile")`
- **Application Logic**: Reuses `FastAPI`, `Playwright Chromium`, and `server.py` unchanged.
- **Provider Lock-in**: `HOSTING_PROVIDER_LOCK_IN = NONE`. The core application depends solely on:
  - `AIRA_BROWSER_RUNTIME_ENABLED`
  - `AIRA_BROWSER_RUNTIME_URL`
  - `AIRA_BROWSER_RUNTIME_TOKEN`

---

## 5. Gate 7: Deterministic Mock-Injected Rate Limiter Test

- **Previous Gap**: Setting `NODE_ENV` / `VERCEL_ENV` did not guarantee a PostgreSQL failure if a live database happened to be reachable.
- **Resolution**: Implemented `setRateLimitDbClientForTesting(client)` hook in `apps/web/lib/browser-runtime/rate-limiter.ts`.
- **Test Implementation**: In `apps/web/test/browser-runtime-integration.test.ts`, injected a client whose `$transaction` method unconditionally rejects with `Simulated PostgreSQL connection failure`.
- **Assertion Verified**:
  ```ts
  assert.strictEqual(res.allowed, false);
  assert.strictEqual(res.error, "BROWSER_RATE_LIMIT_UNAVAILABLE");
  assert.strictEqual(res.retryAfter, 5);
  ```
- **Determinism**: Test unconditionally passes and validates fail-closed behavior regardless of local or live DB connectivity.

---

## 6. Vercel Preview Deployment Verification

- **Commit**: `9bfbd13cfbf8c687403573f38ead7eb630d3eac6`
- **Deployment ID**: `dpl_A8JFY8xKokYuqWMR4HH87YAKUmRs`
- **Preview URL**: `https://aira-ai-live-fk76850th-rajpunkeshwarrajgautam-boops-projects.vercel.app`
- **Status**: `● Ready`
- **Production Status**: `UNTOUCHED` (`https://aira-ai-live.vercel.app`)
