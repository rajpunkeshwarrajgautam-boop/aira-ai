# AIRA Gate 29 External Boundary Requirement Matrix & Live Reality Audit

Authoritative Source Baseline:
- `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` (Gate 29 Line 53, Gate 20 Line 44, Gate 76 Line 100, Gate 78 Line 102, Gate 80 Line 104)
- `docs/AIRA-128-GATE-EVIDENCE-LEDGER-ADDENDUM-2026-09-02.md`
- Gate 29 Master Specification: P0 Autonomous Security Red Team

---

## Requirement 1: G29-REQ-12 — Complete Malicious Corpus Across External Connectors

| Attribute | Specification Details | Reality Audit & Current State |
|---|---|---|
| **Authoritative Source** | `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md` Line 53 ("However, the complete malicious file/site/MCP/connector/archive/MIME/filename/oversize/credential regression corpus remains unfinished. Blocking dependency: None.") | Complete adversarial corpus implemented and verified in `test/agent-connector-security.test.ts`. |
| **Exact Required Behavior** | Untrusted content received from external connectors (Gmail, Slack, Google Drive) must be bounded, sanitized, normalized, and labeled with `trust: "UNTRUSTED_EXTERNAL_CONTENT"`. It must never confer autonomous approval for tool calls, must never trigger unconfirmed durable memory mutations, must have token/credentials redacted from audit logs, and must fail closed against prompt injection (subject, body, attachments, threads, document text, filenames, MIME types, BiDi overrides, zero-width chars, IDOR, and prototype pollution). | 32/32 tests covering all 32 authoritative attack classes pass cleanly. |
| **Required External Systems** | None for Gate 29 security red team regression; third-party APIs (Google Workspace, Slack) belong to future business connector gates (Gates 20, 76, 78, 80). | Fully decoupled via `ConnectorTransport` interfaces (`GmailTransport`, `SlackTransport`, `GoogleDriveTransport`). |
| **Are External Credentials Truly Mandatory?** | **NO.** Gate 29 is a deterministic security red team validation of policy, parser, sanitization, and provenance defenses. | Third-party credentials belong to Gate 20 / 76 / 78 / 80. |
| **Is Mock / Emulator Sufficient?** | **YES.** Deterministic boundary adapters and transports satisfy 100% of Gate 29 requirements. | `agent-connector-security.test.ts` (32 tests pass). |
| **Is Live Service Access Explicitly Required?** | Only for future business connector gates (Gates 20, 76, 78, 80). Gate 29 does not require live third-party network access. | `GATE29_LIVE_BOUNDARY_REALITY_MATRIX.md`. |
| **Current Status** | **PASS** | G29-REQ-12 is 100% satisfied internally. |

---

## Requirement 2: G29-REQ-13 — Reticle Semantic Evaluation with Live Browser-Tab Attachment

| Attribute | Specification Details | Reality Audit & Current State |
|---|---|---|
| **Authoritative Source** | Gate 29 Specification & Ledger Addendum | `reticle_sessions()`, `reticle_act_and_wait`, `reticle_assert`. |
| **Exact Required Behavior** | Reticle MCP server must attach to a live headed browser tab running the AIRA application at `http://localhost:3000`, extract internal semantic DOM and application state, and execute verifiable flow assertions with `verified: "yes"` based on real observed evidence. | The harness `lib/reticle/reticle-harness.ts` enforces origin allowlists and session isolation, and rejects unevidenced passes with `verified: "unknown"` (7/7 tests pass in `test/reticle-browser-eval.test.ts`). |
| **Required External Systems** | Local graphical desktop environment, live Chromium browser, local dev server (`pnpm run dev`), Reticle MCP server. | The Reticle daemon is active via MCP; awaiting user browser tab connection. |
| **Are External Credentials Truly Mandatory?** | **NO.** Zero cloud credentials needed. | Local development session only. |
| **Is Mock / Emulator Sufficient?** | **NO for final live evaluation; YES for test harness correctness.** Live tab attachment is explicitly required for final verification. | Harness and regression proofs complete; live execution requires user browser window. |
| **Current Status** | **USER_ACTION_REQUIRED / BLOCKED_BY_LIVE_BROWSER_ATTACHMENT** | All internal prerequisites complete (0 internal blockers remaining). |

---

## Overall Gate 29 Matrix Status

- Total Requirements: 13
- Satisfied Requirements: 12 / 13 (G29-REQ-01 through G29-REQ-12 are **PASS**)
- Outstanding External Requirements: 1 (G29-REQ-13 awaiting live browser tab attachment via Reticle MCP)
- **Gate 29 Overall Status**: **`PARTIAL`**
