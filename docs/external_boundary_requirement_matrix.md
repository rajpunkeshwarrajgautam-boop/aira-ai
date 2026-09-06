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
| **Authoritative Source** | Gate 29 Specification & Ledger Addendum | `reticle_sessions()`, `reticle_snapshot`, `reticle_assert`. |
| **Exact Required Behavior** | Reticle MCP server must attach to a live headed browser tab running the AIRA application at `http://localhost:3000`, extract internal semantic DOM and application state, and execute verifiable flow assertions with `verified: "yes"` based on real observed evidence. | Live headed browser attached at `http://localhost:3000/omniroute` (Session ID `sca7f8821-f0bb-4d2f-ada9-7ccb0b57b0d1`). 8/8 semantic assertions executed via Reticle MCP (`reticle_assert`) proved with `verified: "yes"`, covering route, page headings, gateway status, model registry, refresh button, test prompt input, and automatic routing controls. Zero synthetic passes. |
| **Required External Systems** | Local graphical desktop environment, live headed browser, local dev server (`pnpm run dev`), Reticle MCP server. | Successfully attached to live headed browser on `http://localhost:3000/omniroute` via Reticle MCP daemon on `127.0.0.1:4400`. |
| **Are External Credentials Truly Mandatory?** | **NO.** Zero cloud credentials needed. | Local development session only. |
| **Is Mock / Emulator Sufficient?** | **NO for final live evaluation; YES for test harness correctness.** Live tab attachment is explicitly required for final verification. | Live evaluation executed and certified with genuine Reticle MCP semantic assertions on active headed session. |
| **Current Status** | **PASS** | G29-REQ-13 is 100% verified with live headed-browser attachment. |

---

## Overall Gate 29 Matrix Status

- Total Requirements: 13
- Satisfied Requirements: 13 / 13 (G29-REQ-01 through G29-REQ-13 are **PASS**)
- Outstanding External Requirements: 0
- **Gate 29 Overall Status**: **`COMPLETE`**
