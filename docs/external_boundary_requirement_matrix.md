# AIRA Gate 29 External Boundary Requirement Matrix

Authoritative Source Baseline:
- `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Gate 29 Line 53, Gate 20 Line 44, Gate 76 Line 100, Gate 78 Line 102, Gate 80 Line 104)
- `docs/AIRA-128-GATE-EVIDENCE-LEDGER-ADDENDUM-2026-09-02.md` (Lines 311–357)
- Gate 29 Master Specification: P0 Autonomous Security Red Team

---

## Requirement 1: G29-REQ-12 — Complete Malicious Corpus Across External Connectors

| Attribute | Specification Details |
|---|---|
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` Line 53 ("However, the complete malicious file/site/MCP/connector/archive/MIME/filename/oversize/credential regression corpus remains unfinished.") |
| **Exact Required Behavior** | Untrusted content received from external connectors (Gmail, Slack, Google Drive) must be bounded, sanitized, normalized, and labeled with `trust: "UNTRUSTED_EXTERNAL_CONTENT"`. It must never confer autonomous approval for tool calls, must never trigger unconfirmed durable memory mutations, must have token/credentials redacted from audit logs, and must fail closed against prompt injection (subject, body, attachments, threads, document text, filenames, MIME types). |
| **Required External Systems** | Google Workspace (Gmail API, Google Drive API v3), Slack Web API / Events API. |
| **Are External Credentials Truly Mandatory?** | **NO for internal preparation & deterministic adapter testing; YES only for live production-boundary execution.** Deterministic adapter tests with normalized adversarial fixtures provide rigorous coverage of all parsing, security boundaries, provenance, and policy fences without third-party API keys. |
| **Is Mock / Emulator Sufficient?** | **YES for internal code, adapter logic, policy enforcement, and red-team corpus validation.** Proves full software correctness before live credentials are provided. |
| **Is Live Service Access Explicitly Required?** | Only for the final live integration step of business connector gates (Gates 20, 76, 78, 80). For Gate 29 red team regression, deterministic adapter harnesses are primary. |
| **Are Non-Production Credentials Sufficient?** | **YES.** A disposable/free-tier developer Google Cloud project and a free Slack test workspace are 100% sufficient; zero paid infrastructure or production data required. |
| **Required Evidence** | Comprehensive deterministic test suite (`test/agent-connector-security.test.ts`) covering 25+ adversarial cases across Gmail, Slack, and Google Drive; zero unredacted secrets; zero tool escalation; verified risk classifications. |
| **Existing Implementation** | Tool Gateway core (`lib/tool-gateway/`), `policy.ts`, `adapters.ts`, `external-adapters.ts` (GitHub, Vercel, Supabase, MCP), `agent-redteam-security.test.ts` (15 tests). |
| **Missing Implementation** | Dedicated typed adapters for `gmail`, `slack`, and `google_drive`; risk policies in `policy.ts`; normalization layer for external connector payloads; comprehensive adversarial test suite. |
| **Missing Infrastructure** | Free-tier Google Cloud OAuth App (test credentials) and Slack Developer App (test workspace) for live execution. |
| **Remaining External Input** | Non-production OAuth client ID/secret for Google and Slack bot/signing secret for live verification. |

---

## Requirement 2: G29-REQ-13 — Reticle Semantic Evaluation with Live Browser-Tab Attachment

| Attribute | Specification Details |
|---|---|
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER-ADDENDUM-2026-09-02.md` Lines 338 & 355 ("Reticle semantic eval recorded as `BLOCKED — LOCAL RETICLE UI/TAB ATTACHMENT REQUIRED`") |
| **Exact Required Behavior** | Reticle MCP server must attach to a live headed browser tab running the AIRA application, extract internal semantic DOM and application state, and execute verifiable flow assertions (`reticle_act_and_wait` / `reticle_assert`) proving that real user journeys complete with verified state transitions rather than DOM-only heuristics. |
| **Required External Systems** | Local graphical desktop environment (Windows / Linux GUI), live Chromium-based browser (Chrome, Edge, or Playwright Chromium), Reticle MCP daemon (listening on port 4400). |
| **Are External Credentials Truly Mandatory?** | **NO.** Zero external credentials or cloud accounts are required. |
| **Is Mock / Emulator Sufficient?** | **NO for live headed browser proof; YES for testing the attachment harness, origin checks, and session isolation.** The gate specification explicitly requires a live browser tab attachment for end-to-end evaluation. |
| **Is Live Service Access Explicitly Required?** | Local web application instance (e.g. `http://localhost:3000`) and local Reticle bridge (port 4400). No cloud services required. |
| **Are Non-Production Credentials Sufficient?** | N/A — local development authentication / test mock user session is used. |
| **Required Evidence** | Reticle session connected via `reticle_sessions()`, semantic action and assertion output with `verified: "yes"` from `reticle_act_and_wait` or `reticle_assert`. |
| **Existing Implementation** | Reticle MCP server registered in Antigravity IDE (`.gemini/antigravity-ide/mcp/reticle/`), Playwright installed in repository, Browser Worker in `infra/browser-worker/`. |
| **Missing Implementation** | Automated Reticle attachment evaluation harness (`lib/reticle/reticle-harness.ts`, `test/reticle-browser-eval.test.ts`) validating tab selection, origin confinement, and session security. |
| **Missing Infrastructure** | Running local dev server (`pnpm run dev`) and an attached headed browser tab focused on the user's desktop screen. |
| **Remaining External Input** | One-time local human action: launching/focusing the local browser window at the development URL so Reticle hooks into the active session. |

---

## Conclusion & Boundary Classification

1. **G29-REQ-12 Internal Work**: Fully unblockable internally by building the typed connector adapters, normalization layers, policy rules, and 25+ case adversarial corpus.
2. **G29-REQ-13 Internal Work**: Fully unblockable internally by building the Reticle automation harness, tab origin validator, session isolation checks, and execution scripts.
3. **Gate 29 Operational Status**: Remains **`PARTIAL`** until live external inputs (non-production credentials and local desktop browser window) are activated.
