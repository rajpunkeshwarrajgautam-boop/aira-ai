# GATE 29 LIVE BOUNDARY REALITY MATRIX

Authoritative Release Program: AIRA Production Gate 29 (P0 Autonomous Security Red Team)  
Snapshot: 2026-09-05  
Repository: `C:\Users\WORKSTATION\aira-ai`  
Branch: `integration/aira-autonomous-omniroute`  

## Executive Summary

Gate 29 is authoritatively defined in `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Line 53) as the **P0 Autonomous Security Red Team** gate. Its mandatory deliverable is to *"Complete the malicious file/site/MCP/connector/archive/MIME/filename/oversize/credential regression corpus."* Its authoritative blocking dependency is explicitly recorded as **None**.

A previous draft dossier conflated Gate 29's security regression corpus with future business connector integrations (Gate 20, Gate 76, Gate 78, Gate 80), incorrectly promising that providing Google Cloud OAuth credentials and Slack bot tokens would trigger live third-party network requests. An exhaustive reality audit of the repository reveals:
1. **Google OAuth**: The web app only implements Auth.js user sign-in (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) requesting standard OpenID profile and email scopes. It possesses no OAuth authorization code exchange endpoint for Gmail or Drive, no refresh-token encryption/storage mechanism, and no live Google API client library (`googleapis` is not a dependency).
2. **Slack Web API**: The repository contains an inbound webhook HMAC signature validator (`verifySlackSignature`), but zero outbound Slack Web API clients (`fetch("https://slack.com/api/...")`).
3. **Connector Adapters**: `lib/tool-gateway/connector-adapters.ts` implements deterministic security boundary adapters designed for Zod input validation, risk classification, durable approval fencing, `UNTRUSTED_EXTERNAL_CONTENT` tagging, provenance tracking, and adversarial sanitization. They now support an injected `ConnectorTransport` contract, but default to deterministic transports for Gate 29.
4. **Reticle**: Reticle is an external MCP server provided by the Antigravity IDE environment (`reticle_*`). The helper `lib/reticle/reticle-harness.ts` enforces origin and session boundaries, and has been corrected to prevent synthetic passes when live observed state is absent.

---

## Reality Matrix

| Requirement / Claim | Authoritative Master Specification | Current Claimed Behavior in Dossier | Actual Code Implementation in Repository | Real Transport? | External Input Consumed? | Evidence | Implementation Gap | Required Correction | Classification |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| **Gmail Security Corpus (G29-REQ-12)** | Complete malicious connector regression corpus (injection, HTML, Unicode, attachments, IDOR) | Run live OAuth code exchange and fetch real mailbox emails | Deterministic security boundary adapter with Zod validation, text sanitization, provenance tracking, and durable approval fence | NO (Deterministic stub via `GmailTransport`) | NO (Credentials not consumed by any network client) | `lib/tool-gateway/connector-adapters.ts:58`, `test/agent-connector-security.test.ts` | No OAuth exchange endpoint, token store, or `googleapis` client in `apps/web` | Clarify that Gate 29 requires deterministic adversarial corpus; live Gmail execution belongs to Gate 20 and Gate 76 | **FUTURE_GATE_ONLY** (for live transport); **SUPPORTED** (for Gate 29 security corpus) |
| **Slack Security Corpus (G29-REQ-12)** | Complete malicious connector regression corpus (markdown injection, impersonation, replay, IDOR) | Post live message to Slack workspace and fetch channel history via bot token | Deterministic security boundary adapter with Zod validation, HMAC-SHA256 signature verification, 300s replay defense, and approval fence | NO (Deterministic stub via `SlackTransport`) | NO (Bot token not used for HTTP requests) | `lib/tool-gateway/connector-adapters.ts:280`, `test/agent-connector-security.test.ts` | No `slack.com/api` client or workspace OAuth install flow | Clarify that Gate 29 requires deterministic adversarial corpus; live Slack execution belongs to Gate 20 and Gate 78 | **FUTURE_GATE_ONLY** (for live transport); **SUPPORTED** (for Gate 29 security corpus) |
| **Google Drive Security Corpus (G29-REQ-12)** | Complete malicious connector regression corpus (poisoned docs, MIME confusion, path traversal) | Retrieve real files and metadata from Google Drive | Deterministic security boundary adapter with filename sanitization, path traversal stripping, and approval fence | NO (Deterministic stub via `GoogleDriveTransport`) | NO (Credentials not consumed by any network client) | `lib/tool-gateway/connector-adapters.ts:440`, `test/agent-connector-security.test.ts` | No Drive API client or Drive OAuth scopes | Clarify that Gate 29 requires deterministic adversarial corpus; live Drive execution belongs to Gate 20 and Gate 80 | **FUTURE_GATE_ONLY** (for live transport); **SUPPORTED** (for Gate 29 security corpus) |
| **Google Redirect URI Claim** | Auth.js OpenID Connect sign-in | "Set redirect URI to `http://localhost:3000/api/auth/callback/google` to authorize Gmail and Drive" | Callback only handles NextAuth user authentication; does not request or persist Gmail/Drive scopes | NO | NO | `apps/web/auth.config.ts:25`, `apps/web/lib/oauth-env.ts:4` | Auth.js cannot be repurposed for connector API authorization without offline access & custom token persistence | Remove claim from dossier; connector OAuth must use separate dedicated endpoints | **UNSUPPORTED** |
| **Reticle Semantic Evaluation (G29-REQ-13)** | Live browser-tab semantic evaluation and policy validation | Live browser-tab attachment evaluated via `reticle-harness.ts` | `lib/reticle/reticle-harness.ts` verifies origin and session isolation; requires live observed state to prevent false positive passes | N/A (Client helper; live evaluation is driven via Reticle MCP server) | YES (Evaluates live tab when session is connected) | `lib/reticle/reticle-harness.ts`, `test/reticle-browser-eval.test.ts` | Next.js dev server must be running and tab open at `http://localhost:3000` for Reticle MCP | Drive evaluation using Antigravity's Reticle MCP server (`reticle_sessions`, `reticle_assert`) against live app | **PARTIALLY_SUPPORTED** (Harness complete; awaiting live tab attachment) |

---

## Credential Readiness Audit

```typescript
export const GATE29_CREDENTIAL_READINESS = {
  GOOGLE_READY_FOR_CREDENTIALS: false, // Apps/web lacks OAuth exchange & Google API client
  SLACK_READY_FOR_CREDENTIALS: false,  // Apps/web lacks Slack Web API client
  RETICLE_READY_FOR_LIVE_ACTION: true, // Reticle MCP server is available; requires running dev server + open browser tab
};
```
