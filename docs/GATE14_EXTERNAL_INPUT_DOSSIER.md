# Gate 14 Minimum External Input Dossier & Reality Audit

Authoritative Release Program: AIRA Production Gate 14 (P0 Live OmniRoute)
Repository: `C:\Users\WORKSTATION\aira-ai`
Branch: `integration/aira-autonomous-omniroute`
PR: #123 (`https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/pull/123`)
Status: **COMPLETE / PASS** (Certified on official pinned container `ghcr.io/diegosouzapw/omniroute:3.8.50` on `127.0.0.1:20128`; dedicated client key validated; live models discovered (534 models); live inference and SSE chunked streaming verified; 429, 500, timeout, malformed, oversized responses verified fail-closed; 29/29 tests PASS. Evidence in `Gate14_Final_Evidence_20260905_160721Z.zip`).

---

## 1. Executive Summary & Internal Audit

- **Internal Prerequisites Complete**:
  - Client implementation audited in `apps/web/src/services/omniroute/` (`config.ts`, `gateway.ts`, `routing.ts`).
  - Strict URL normalization and security validation implemented:
    - In development: plain HTTP allowed exclusively on loopback (`localhost`, `127.0.0.1`, `::1`).
    - In production: HTTPS strictly enforced.
    - Query strings, URL fragments, and embedded credentials in `OMNIROUTE_BASE_URL` are strictly rejected.
    - Path normalized to `/v1` root.
  - Timeout bounded between 1,000ms and 120,000ms (default 45,000ms).
  - Model routing verified: supports `auto/balanced`, `auto/smart`, `auto/coding`, `auto/fast`, `auto/offline`; disables `auto/cheap`.
  - Fail-closed behavior: invalid responses, timeouts, upstream errors, and oversized responses fail closed with typed error codes (`OMNIROUTE_BAD_RESPONSE`, `OMNIROUTE_TIMEOUT`, `OMNIROUTE_UPSTREAM_ERROR`, `OMNIROUTE_RESPONSE_TOO_LARGE`).
  - Unit and integration contract suites:
    - `omniroute-security.test.ts` (26/26 PASS)
    - `omniroute-gateway.test.ts` (10/10 PASS)
    - `omniroute-config.test.ts` (8/8 PASS)
    - `omniroute-routing.test.ts` (5/5 PASS)
    - `omniroute-product-containment-contract.test.ts` (3/3 PASS)
- **Credential Readiness Assertion**:
  - `OMNIROUTE_READY_FOR_CREDENTIALS = true`

---

## 2. Minimal External Input Specification

| Field | Authoritative Specification |
| :--- | :--- |
| **Exact Requirement** | Live non-production OmniRoute gateway access for live health, auth, model discovery, and streaming verification. |
| **Why Required** | Gate 14 exit criteria require live end-to-end inference and model discovery against a reachable OmniRoute endpoint. |
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Gate 14: "Live non-production health, auth, models, inference, streaming, outage/rate/log/secret-isolation proof"). |
| **Exact Variables Required** | `OMNIROUTE_ENABLED=true`<br>`OMNIROUTE_BASE_URL=<endpoint_url>`<br>`OMNIROUTE_API_KEY=<api_key>`<br>`OMNIROUTE_MODEL=<model_name>` (optional, defaults to `auto`) |
| **Least Privilege Scope** | A test/staging or development OmniRoute instance with rate limiting enabled, zero production database access, and restricted model execution quota. |
| **Non-Production Acceptable?** | **YES.** A staging, preview, local container with upstream mock, or test tenant key is fully acceptable and preferred. |
| **Estimated Cost** | Negligible / Free (test inference token cost). |
| **Reversible?** | **YES.** Endpoint and API key can be revoked or rotated immediately after verification. |
| **Secret Status** | **SECRET.** Must not be committed to Git or printed in cleartext chat output; should be placed in `.env.local` or environment variables. |
| **Minimum Next User Action** | Provide or configure a non-production `OMNIROUTE_BASE_URL` and `OMNIROUTE_API_KEY` in `.env.local` or environment variables for the live test session. |
| **What Antigravity Will Do Afterward** | Immediately verify `/health`, `/v1/models` discovery, execute structured inference, verify response streaming, test outage/rate-limiting handling, record immutable evidence, and mark Gate 14 COMPLETE. |
