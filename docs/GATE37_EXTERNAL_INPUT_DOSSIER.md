# Gate 37 Minimum External Input Dossier & Reality Audit

Authoritative Release Program: AIRA Production Gate 37 (P0 OmniRoute → NVIDIA Failover)
Repository: `C:\Users\WORKSTATION\aira-ai`
Branch: `integration/aira-autonomous-omniroute`
PR: #123 (`https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/pull/123`)
Status: **BLOCKED / EXTERNAL_CREDENTIAL_REQUIRED** (All internal provider client policies, fallback logic, and circuit breaker patterns are ready; awaits live non-production OmniRoute and NVIDIA provider access for live fault-injection proof).

---

## 1. Executive Summary & Internal Audit

- **Internal Prerequisites Complete**:
  - Routing and fallback policies implemented in model router.
  - Failover circuit breaker behavior tested: primary errors and timeouts transition to fallback provider.
  - Zero-loop and no-privilege-escalation invariants verified in unit test suites.
- **External Boundary**:
  - Live failover proof requires active connection to both primary (OmniRoute) and secondary (NVIDIA NIM / OpenAI-compatible endpoint) providers to inject an outage/rate-limit error on the primary and observe automatic non-breaking failover in real-time.

---

## 2. Minimal External Input Specification

| Field | Authoritative Specification |
| :--- | :--- |
| **Exact Requirement** | Non-production OmniRoute endpoint/key and non-production NVIDIA API key. |
| **Why Required** | Gate 37 exit criteria require live fault injection to prove failover eligibility, absence of loops/bypasses, user notification fidelity, and telemetry recording under real network provider conditions. |
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Gate 37: "Prove eligibility, no bypass/loop, UX, logs and telemetry with primary outage/rate injection. Live non-production OmniRoute and NVIDIA provider access"). |
| **Exact Variables Required** | `OMNIROUTE_ENABLED=true`<br>`OMNIROUTE_BASE_URL=<endpoint>`<br>`OMNIROUTE_API_KEY=<key>`<br>`NVIDIA_API_KEY=<key>` |
| **Least Privilege Scope** | Sandbox / evaluation API keys with minimal rate limits and zero production billing risk. |
| **Non-Production Acceptable?** | **YES.** Strictly non-production / developer tier keys. |
| **Estimated Cost** | Negligible / Free trial quota. |
| **Reversible?** | **YES.** Keys can be rotated immediately after verification. |
| **Secret Status** | **SECRET.** Must be provided via environment variables, never committed to git. |
| **Minimum Next User Action** | Provide a test NVIDIA API key in addition to the non-production OmniRoute key when ready for live failover testing. |
| **What Antigravity Will Do Afterward** | Run live primary health check, inject forced 503/429 upstream error on primary, observe and verify automatic failover to NVIDIA, record logs/telemetry evidence, and mark Gate 37 COMPLETE. |
