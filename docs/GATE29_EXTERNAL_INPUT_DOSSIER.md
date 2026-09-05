# Gate 29 Minimum External Input Dossier & Reality Audit

Authoritative Release Program: AIRA Production Gate 29 (P0 Autonomous Security Red Team)
Repository: `C:\Users\WORKSTATION\aira-ai`
Branch: `integration/aira-autonomous-omniroute`
PR: #123 (`https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/pull/123`)
Status: **PARTIAL** (G29-REQ-12 is 100% satisfied internally via 32/32 passing adversarial corpus tests; G29-REQ-13 awaits live browser tab connection to Reticle).

---

## Executive Summary & Reality Alignment

Following a comprehensive reality audit against the codebase and the authoritative master ledger (`docs/AIRA-128-GATE-EVIDENCE-LEDGER.md`):

1. **G29-REQ-12 (Malicious Connector Corpus)** is **SATISFIED INTERNALLY**:
   - Gate 29 is the *P0 Autonomous Security Red Team* gate requiring a complete regression corpus across files, sites, MCP, and connectors.
   - The repository implements deterministic security boundary adapters (`lib/tool-gateway/connector-adapters.ts`) with Zod input validation, `UNTRUSTED_EXTERNAL_CONTENT` tagging, provenance tracking, HMAC-SHA256 signature verification, replay protection, and durable approval fencing.
   - All 32 authoritative attack classes (prompt injection, HTML hidden instructions, BiDi overrides, zero-width characters, null bytes, IDOR, prototype pollution, MIME confusion, SSRF queries, and tool escalation) are verified and passing in `test/agent-connector-security.test.ts`.
   - **Zero external credentials are required for Gate 29.**

2. **Reclassification of Third-Party Connector Credentials (Gates 20, 76, 78, 80)**:
   - Live OAuth code exchange, refresh token encryption/persistence, and outbound network API clients belong authoritatively to **Gate 20 (Business Connectors)**, **Gate 76 (Gmail Agent)**, **Gate 78 (Slack Agent)**, and **Gate 80 (Business File Connectors)**.
   - The application does not currently have Google OAuth exchange for Gmail/Drive scopes or a Slack Web API client.
   - Requesting Google or Slack credentials from the user at this stage would be premature and ineffective.

3. **G29-REQ-13 (Reticle Semantic Evaluation)** is the **ONLY External Boundary for Gate 29**:
   - Reticle is an external Antigravity MCP server (`reticle_*`).
   - The evaluation requires a live Chromium-based browser window open at `http://localhost:3000` connected to the Reticle daemon.

---

## Credential Readiness Assertion

| Component | Ready for Credentials? | Current Blocker / Implementation State | Correct Gate Assignment |
|:---|:---:|:---|:---|
| **Google Cloud (Gmail & Drive)** | **FALSE** | `apps/web` lacks OAuth exchange endpoints for connector scopes, token encryption storage, and live API transport clients (`googleapis`). | **Gate 20, Gate 76, Gate 80** |
| **Slack App (Bot Token & Web API)** | **FALSE** | `apps/web` implements inbound webhook HMAC verification, but lacks an outbound Slack Web API client. | **Gate 20, Gate 78** |
| **Reticle (Browser Tab Attachment)** | **TRUE** | Reticle MCP server is installed and active; requires running local dev server and open browser tab. | **Gate 29 (G29-REQ-13)** |

---

## Single Minimal External Input Required: Reticle Live Browser Tab Attachment

| Field | Authoritative Specification |
|:---|:---|
| **Requirement** | G29-REQ-13 (Reticle Semantic Evaluation with Live Browser Tab Attachment) |
| **Why It Cannot Be Completed Internally** | Reticle verifies the running web app from the inside via an embedded dev SDK. The Reticle daemon requires a live browser process displaying `http://localhost:3000`. |
| **Exact Resource Required** | A local Chromium browser window (Google Chrome or Microsoft Edge) running on the workstation desktop. |
| **Cost / Spend Involved** | **$0.00 (Completely Free).** |
| **Can It Be Closed Afterward?** | **YES.** Close the tab once the verification assertion produces `verified: "yes"`. |
| **Exact User Action Required** | 1. Start local dev server: `pnpm run dev`.<br>2. Open Google Chrome or Microsoft Edge to `http://localhost:3000/omniroute`.<br>3. Keep the browser window open and visible.<br>4. Notify Antigravity to trigger Reticle MCP evaluation. |
| **What Antigravity Will Do Immediately Afterward** | Invoke `reticle_sessions()`, confirm active tab attachment, run `reticle_act_and_wait` / `reticle_assert`, extract semantic DOM state, verify origin and session boundaries, and record the immutable evaluation evidence. |
