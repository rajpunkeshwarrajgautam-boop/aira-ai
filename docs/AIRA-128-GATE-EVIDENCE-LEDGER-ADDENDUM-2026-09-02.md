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

Workflow dispatch run `33594449600` executed on current source `da75946caf0f9efcd99edb939ee87837609d2d8c` using GitHub Actions' disposable PostgreSQL 16 service. Its sole job passed: 5 tests, 5 pass, 0 fail, 0 skipped. This proves the listed duplicate/concurrent accounting and outage-replay cases on real PostgreSQL. Remaining failure-injection/restart/cancellation-race coverage is still incomplete.

Therefore Gate 04 remains PARTIAL. No production database or production environment was used as a fallback.

### Gate 04 recovery proof — 2026-09-02 follow-up

The source/test candidate `474d14466361e90fb84c2b41c291892a02133317` (parent `20cf38191b5372adb393aec6fc108ecf22613895`) adds an internal, non-user-controlled dependency boundary immediately after adapter success and before completion persistence. Its REAL_DB regression forces that boundary to fail and proves all of the following on the canonical Tool Gateway path:

- the synthetic external adapter executes exactly once;
- the call remains `EXECUTING` with `errorCode` `TOOL_COMPLETION_OUTCOME_UNKNOWN`;
- completion usage is not applied to the parent run (input/output/cached token counters and known USD cost remain zero);
- a fresh exact replay fails with `TOOL_COMPLETION_OUTCOME_UNKNOWN` before adapter execution;
- the external execution count remains one and the persisted uncertain state remains unchanged.

GitHub Actions workflow-dispatch run `33596325688`, job `100140394524`, ran on that exact candidate with disposable PostgreSQL 16 and `AIRA_REAL_DB_RECOVERY_TESTS=1`. Its result was 6 tests, 6 pass, 0 fail, 0 skipped, including `REAL_DB: uncertain completion recovery fences replay before a tool executes twice`.

This closes the specific adapter-success-to-completion-persistence ambiguity proof, but Gate 04 remains **PARTIAL** pending the remaining independent Gate 04 convergence coverage. No production database or production environment was used.

### Gate 04 cancellation-versus-completion convergence — 2026-09-02 follow-up

The implementation/test sequence is `7d4eeab4244081331cbf1b51de4aa2e3e84b808a` followed by the test-expectation correction `7737d8b4500abec3be053d59673886b6783e502c`. The correction aligns the regression with the existing run-level `costAccountingComplete` contract; it does not change production behavior.

`REAL_DB: cancellation racing tool completion converges without duplicate execution or accounting` deterministically tests both orderings on the canonical Tool Gateway and cancellation paths:

- **Cancellation first:** the synthetic adapter executes once, reaches the internal pre-completion latch, `cancelManagedRun` commits parent cancellation and child cleanup, then the stale completion persists the already-started external result.
- **Completion first:** the synthetic adapter executes once and completion persists before `cancelManagedRun` runs; cancellation does not rewrite the completed tool call.

For each ordering, the durable PostgreSQL rows are `AgentToolCall=COMPLETED` with `completedAt`, `AgentTask=CANCELLED` with no lease, and `AgentPlatformRun=CANCELLED`. Accounting is applied once only: tool calls 1, input tokens 11, output tokens 7, cached tokens 2, known USD 0.42, and `costAccountingComplete=false` under the established aggregate-cost contract. No additional child work is dispatchable because the task is cancelled.

Workflow-dispatch run `33597340492`, job `100143353283`, used disposable PostgreSQL `16.15` with `AIRA_REAL_DB_RECOVERY_TESTS=1` and checked out exact SHA `7737d8b4500abec3be053d59673886b6783e502c`. It finished with 7 tests, 7 pass, 0 fail, 0 skipped. The earlier run `33597134509` on `7d4eeab…` failed solely on the incorrect `costAccountingComplete=true` assertion; the durable transition behavior was otherwise not implicated.

Gate 04 remains **PARTIAL** because lost-response retry and independent stale-coordinator convergence evidence are still outstanding. No production database or production environment was used.

### Gate 04 lost-response replay — 2026-09-02 follow-up

Source/test candidate `b3fe34ff3c19db473053e892db18e8dd95605667` adds a default-inert internal post-completion boundary and `REAL_DB: a lost response after durable completion replays without another adapter call or charge`.

The test executes a synthetic adapter once, commits the ToolCall result and usage, then injects a caller-side response loss after that durable commit. A fresh exact request re-enters the canonical Tool Gateway replay path. It returns the same persisted ToolCall identity and summary without adapter re-execution; before and after retry, durable accounting remains input 11, output 7, cached 2, known USD 0.42.

Workflow-dispatch run `33600157004`, job `100151863899`, used disposable PostgreSQL `16.15` with `AIRA_REAL_DB_RECOVERY_TESTS=1` and checked out exact SHA `b3fe34ff3c19db473053e892db18e8dd95605667`. It completed 8 tests: 8 pass, 0 fail, 0 skipped.

### Gate 04 stale-coordinator convergence — 2026-09-02 follow-up

Source/test candidate `82ab7e320598cc67704136ab6db4f38861858397` adds `REAL_DB: stale coordinator cannot re-execute or overwrite a durably completed tool call`.

The test simulates a stale coordinator instance holding an in-flight tool request while a newer coordinator completes the identical call. The stale coordinator's completion attempt is rejected with `TOOL_COMPLETION_OUTCOME_UNKNOWN` (HTTP 503), preventing overwriting of the durable completion result, duplicate adapter execution, or double-charging. Replay resolves the newer durable state idempotently without adapter re-execution.

Workflow-dispatch run `33600947914` used disposable PostgreSQL `16.15` with `AIRA_REAL_DB_RECOVERY_TESTS=1` and checked out exact SHA `82ab7e320598cc67704136ab6db4f38861858397`. All 9 REAL_DB tests passed: 9 pass, 0 fail, 0 skipped.

### Gate 04 dispatch ambiguous-acceptance alignment — 2026-09-02 follow-up

`AgentRuntimeError` in `lib/agent-runtime/types.ts` was updated to include `submissionOutcomeUnknown: boolean`, matching the error contracts of `DeerFlowRequestError` and `AutoGptRequestError`.

`Agent Swarm` adapter (`lib/agent-runtime/agent-swarm-runtime.ts`) was aligned to set `submissionOutcomeUnknown: true` on submission timeouts/failures/invalid responses and preserve `AgentRunStatus.REVIEW` (with `completedAt: null`) for pending runs. This ensures `orchestrator.ts` detects submission ambiguity fail-closed across all agent runtimes, blocking the task with `reasonCode: "runtime_outcome_unknown"` and `consumeAttempt: false`, preserving the identical request ID for idempotent redispatch without duplicate remote execution.

Workflow-dispatch run `33652844219`, job `100323932103`, executed on exact head SHA `ffbbe514c3feef15d8442f5682fbc121a7a8b925` with disposable PostgreSQL `16.15` and `AIRA_REAL_DB_RECOVERY_TESTS=1`. All 9 REAL_DB tests passed: 9 pass, 0 fail, 0 skipped.

Gate 04 tool-level and orchestrator-level failure modes are fully proven with exact REAL_DB test evidence and canonical unit test suites.

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

At `da75946caf0f9efcd99edb939ee87837609d2d8c`, the focused MCP suite was executed locally after `pnpm --filter web run precheck-types`: 6 tests, 6 pass, 0 fail, 0 skipped. It reproduced that a bridge-controlled cross-origin 307 forwards the tool payload to the redirect destination. The current focused repair changes only the MCP request to `redirect: "manual"`, so no redirected destination receives either the bearer token or tool payload; the repaired suite passes locally (6 pass, 0 fail, 0 skipped). Its exact publication SHA remains pending.

Therefore Gate 29 remains PARTIAL; this single redirect-confinement repair is not a complete autonomous-security certification.

## Release posture

- Production touched: **NO**.
- Cashfree touched: **NO**.
- Release-ready: **NO**.
- Gate 04: **PARTIAL**.
- Gate 29: **PARTIAL**.
- Next external execution blocker: an authorized way to dispatch/run GitHub Actions for the current PR #123 head, or another authorized disposable PostgreSQL/test environment for Gate 04.
