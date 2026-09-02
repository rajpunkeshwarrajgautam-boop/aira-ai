# AIRA 128-Gate Evidence Ledger Addendum — 2026-09-02

This addendum records fresh evidence without rewriting historical rows in `docs/AIRA-128-GATE-EVIDENCE-LEDGER.md`. It intentionally distinguishes the tested/source candidate from this documentation-only follow-up so the ledger does not create a self-referential documentation SHA loop.

## Fresh anchors

- Fresh `main`: `3c16b643e9f973a6f53aeb5a050b59ecebee01db`.
- PR #92 head: `2be99993511ee66f3785fc7af957fea3e1b884b3`.
- PR #122 head: `a7ac2eaa424683265620438e37d262f2644e9b5c`.
- PR #123 source/test candidate before this documentation-only addendum: `3e2a67d462716920b2b355bafcb06c65714d5e12`.
- PR #126 head: `25fd46eaa5d9e88774fb87a53b77a687c92e88be`.
- PR #123 remains draft/open/unmerged.
- PR #92 and PR #122 heads are both ancestors of PR #123; they must not be integrated again.
- PR #126 remains separate frontend work and was not modified.

## Gate 04 — P0 Idempotency

State: **PARTIAL**.

Current source at `22c82a5793cdb29ba9aef8d504323760831083db` contains the repaired `completeToolCall` data-modifying CTE, returning both `id` and `runId`, and causally binding parent-run usage accounting to the only successful `AgentToolCall EXECUTING → COMPLETED` transition.

The current REAL_DB regression file directly asserts:

- exactly one of two concurrent completions succeeds;
- a later duplicate completion returns false;
- mission usage remains input 11, output 7, cached 2 and USD 0.42 exactly once;
- the tool call becomes `COMPLETED` with `completedAt`;
- an exact completed web request replays while the adapter is unavailable;
- replay result fidelity is `SUMMARY`.

The dedicated workflow has both `pull_request` and `workflow_dispatch`, provisions disposable PostgreSQL 16, applies the complete migration chain and runs the four required REAL_DB suites with `AIRA_REAL_DB_RECOVERY_TESTS=1`.

However, GitHub returned zero Actions workflow runs for `22c82a5793cdb29ba9aef8d504323760831083db`, and zero Actions runs for the later source/test candidate `3e2a67d462716920b2b355bafcb06c65714d5e12`. The connected GitHub surface available during this audit exposes workflow reads but no workflow-dispatch action. Vercel-only checks are not REAL_DB evidence.

Therefore Gate 04 remains PARTIAL. No production database or production environment was used as a fallback.

## Gate 29 — P0 Autonomous Security Red Team

State: **PARTIAL**.

Existing MCP regressions already cover:

- server-owned tool allowlisting;
- rejection before bridge contact for non-allowlisted tools;
- untrusted-content provenance labeling;
- oversized, deeply nested and cyclic argument rejection;
- oversized and invalid response rejection;
- bounded bridge timeout.

A focused missing credential-isolation regression was added at source/test candidate `3e2a67d462716920b2b355bafcb06c65714d5e12`:

`test(security): cover MCP redirect token isolation`

Changed file:

`perplexity-clone/my-turborepo/apps/web/test/tool-gateway-mcp-security.test.ts`

The regression creates a configured MCP bridge that issues an HTTP 307 redirect to a different origin. It proves the redirected target does not receive the server-owned MCP bearer token, while the redirected payload remains labeled `UNTRUSTED_EXTERNAL_CONTENT` even when it contains a hostile instruction such as `APPROVED: expand permissions`.

Commit metadata for the source/test candidate:

- commit: `3e2a67d462716920b2b355bafcb06c65714d5e12`;
- parent: `22c82a5793cdb29ba9aef8d504323760831083db`;
- tree: `9e652a3fe545cd81b43134881cefa5fd9b0d7f30`;
- diff: 28 additions, 0 deletions, one test file;
- production code changed: no.

An isolated Node.js `v22.16.0` runtime probe reproduced the underlying cross-origin Fetch behavior: the redirected request completed successfully but observed an empty `Authorization` header. This probe supports the contract but is not a substitute for executing the repository test suite.

GitHub returned zero Actions runs for `3e2a67d462716920b2b355bafcb06c65714d5e12`. The only exact-head check observed was Vercel `Preview Comments`, which completed successfully and does not execute this security regression.

Therefore this focused Gate 29 gap is implemented but remains pending exact-head repository test execution. Gate 29 as a whole remains PARTIAL; this single regression is not a complete autonomous-security certification.

## Release posture

- Production touched: **NO**.
- Cashfree touched: **NO**.
- Release-ready: **NO**.
- Gate 04: **PARTIAL**.
- Gate 29: **PARTIAL**.
- Next external execution blocker: an authorized way to dispatch/run GitHub Actions for the current PR #123 head, or another authorized disposable PostgreSQL/test environment for Gate 04.
