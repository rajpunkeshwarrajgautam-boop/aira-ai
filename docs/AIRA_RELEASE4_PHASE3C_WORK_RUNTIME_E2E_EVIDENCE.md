# AIRA AI v5.1 — Phase 3C Work Runtime Operational Evidence Ledger

**Generated**: 2026-09-20T12:18:00Z  
**Phase**: R2 Phase 3C — Real Customer Work Runtime Controlled E2E  
**Worktree**: `C:\Users\WORKSTATION\aira-ai-v5.1`  
**Branch**: `feat/aira-v5.1-work-runtime`  
**PR #133 Status**: OPEN / UNMERGED  
**Authoritative Candidate SHA**: `07f9ab76c7c3c90376da0a75e1595ff0f21d33eb`  
**Preview Deployment**: `dpl_Fo8aMuPRZmT1xgn5FUrkvzJXAGRA` (Unified Database Deployment)  
**Stable Preview URL**: `https://aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app/work`  
**Unified Preview Database**: `ep-dark-thunder-aj42v4nt` (Neon Project `steep-feather-41427658`, Timeline `cbe7709d7b1a967de7541e059f781000`)  
**Runtime Connection**: `ep-dark-thunder-aj42v4nt-pooler.c-3.us-east-2.aws.neon.tech`  
**Direct Connection**: `ep-dark-thunder-aj42v4nt.c-3.us-east-2.aws.neon.tech`  

---

## 1. Provenance & Security Boundaries

| Security & Environmental Check | Observed State | Gate Status |
| :--- | :--- | :--- |
| **Active Worktree** | `C:\Users\WORKSTATION\aira-ai-v5.1` (Branch: `feat/aira-v5.1-work-runtime`) | **VERIFIED** |
| **Audit-Hardening Worktree** | `C:\Users\WORKSTATION\aira-ai` (untouched, clean) | **PRESERVED** |
| **PR #133 Status** | OPEN / UNMERGED (`headRefOid: 07f9ab76c7c3c90376da0a75e1595ff0f21d33eb`) | **VERIFIED** |
| **Unified Preview DB Host** | `ep-dark-thunder-aj42v4nt-pooler.c-3.us-east-2.aws.neon.tech` | **VERIFIED UNIFIED** |
| **Production Credentials** | Production Neon & Supabase strictly untouched (no production connections) | **READ-ONLY / UNTOUCHED** |
| **Pre-test Active Jobs** | Zero `PLANNING`, `RUNNING`, or `WAITING` runs in `AgentPlatformRun` | **CLEAN QUEUE (0)** |
| **Pre-test Subscriptions** | Zero active subscriptions for customer in unified Preview database | **CLEAN BASELINE (0)** |
| **Cashfree Activation** | Disabled (zero webhooks processed, zero transactions created) | **ENFORCED DISABLED** |

---

## 2. Interactive Browser Execution Environment

* **Browser Binary**: System Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`, v153.0.8010.53).
* **Interactive Profile**: Dedicated profile `C:\Users\WORKSTATION\AppData\Local\Aira-Preview-Visible`.
* **CDP Port**: `http://127.0.0.1:9223` (confirmed listening, tab 0 active on `/work`).
* **Authenticated Customer Identity**:
  - Name: `raj gautam`
  - Email: `rajpunkeshwarrajgautam@gmail.com`
  - User ID: `cmu8kac7a000004l79y25kier`
  - Session Expiry: `2026-10-20T12:13:55.284Z`
  - Verification: Empirically verified via live `/api/auth/session` inside Chrome on CDP 9223.

---

## 3. Temporary Preview Pro Entitlement Lifecycle

* **Original Baseline Entitlement**:
  - `User.billingPlan`: `'FREE'`
  - `BillingSubscription`: 0 records (`[]`)
  - Effective Entitlement: Free tier (`PLAN_REQUIRED` gate enforced on managed runs)
* **Temporary Fixture Applied**:
  - Exact Fixture ID: `sub_temp_phase3c_cmu8kac7`
  - User ID: `cmu8kac7a000004l79y25kier`
  - Merchant Subscription ID: `m_sub_temp_phase3c_cmu8kac7`
  - Cashfree Subscription ID: `cf_sub_temp_phase3c_cmu8kac7`
  - Plan / Status: `plan: 'PRO'`, `status: 'ACTIVE'`, `teamSeats: 1`
  - `User.billingPlan`: `'PRO'`
* **Preview Application Verification**:
  - Page reloaded on `/work` via CDP.
  - Inspected DOM and API state:
    `hasPlanRequired: false`
    `hasProBadge: true`
    `Launch managed run` button rendered and enabled.
* **Exact Fixture Teardown & Post-Test Rollback**:
  - Executed: `DELETE FROM "BillingSubscription" WHERE id = 'sub_temp_phase3c_cmu8kac7'` (1 row deleted).
  - Executed: `UPDATE "User" SET "billingPlan" = 'FREE' WHERE id = 'cmu8kac7a000004l79y25kier'`.
  - Empirically Verified:
    - Customer subscriptions: 0
    - Customer billingPlan: `'FREE'`
    - Unrelated subscriptions: `sub_preview_test_a` preserved untouched
    - Cashfree webhooks: 0 transactions

---

## 4. Controlled Customer E2E Task Execution

### Submitted Objective
> “Create a concise three-step plan for organizing a technical documentation folder. Return the plan as the Work result. Do not modify files, browse private accounts, send messages, make purchases or perform external actions.”

### Observed Execution Progression

1. **Input & Planning Stage**:
   - Injected objective text into `#work-objective` (222 chars).
   - Triggered synthetic input/change events.
   - Clicked `Generate plan`.
   - DAG evaluation completed; execution plan populated with 4 tasks.
   - `Launch managed run` button transitioned to **ENABLED**.

2. **Managed Run Admission**:
   - Clicked `Launch managed run`.
   - Successfully admitted through billing gate without `PLAN_REQUIRED`.
   - New Project Created: `84257def-57e4-477e-9671-aade00ca3a23`
   - Real Managed Run ID Created: `b5626084-2cb9-42db-8bc2-4e2c4b468310`
   - Native Runtime Selected: `AIRA_AGENT`
   - Initial State Transition: `status: 'RUNNING'`, `startedAt: 2026-09-20T06:44:38.984Z`.

3. **Task Decomposition & Worker Claims**:
   - 4 platform tasks decomposed in `AgentTask`:
     1. `3d367763-75e3-42a6-b3e2-047e78f2c87e`: "Objective scoping and acceptance criteria" (`PRODUCT`)
     2. `dcbd292b-3ec1-436d-b0c2-7953d1d82f87`: "Evidence gathering and research" (`RESEARCH`)
     3. `49eb6b00-adb4-43dd-a2f5-c02a122a34ce`: "Structured deliverable synthesis" (`ARCHITECT`)
     4. `c6d55581-0ecf-4529-b87a-7f5aa4671ec3`: "Acceptance criteria and proof-of-work verification" (`VERIFICATION`)
   - Native worker (`worker:DESKTOP-2N1R5UP:29520:34b8a716`) claimed Task 1 and spawned agent instance `agent_b5626084`.
   - Dispatched attempt 1: `runtimeRunId: 'cmu9s3vin00008d9xq2i6z5zp'`.

4. **Runtime Provider Failure & Root Cause**:
   - Initial worker process was started with environment inherited from `vercel env pull` where `DEFAULT_PRO_PROVIDER="[SENSITIVE]"` and `DEFAULT_FREE_PROVIDER="[SENSITIVE]"`.
   - When `ProviderRouter` initialized, it attempted to look up providers matching the string `"[SENSITIVE]"`, which did not match registered provider `'nvidia'`.
   - Error recorded in `AgentRun` (`cmu9s3vin00008d9xq2i6z5zp`):
     `errorMessage: 'No AI providers configured or allowed by the active residency policy in ProviderRouter.'`
   - The scheduler's automatic retry policy re-queued and executed attempts 2 (`cmu9s48yc00038d9xpyiphqq0`) and 3 (`cmu9s4me400068d9x8ulh1g14`) in rapid succession under the same worker process before the environment could be updated.
   - After 3 failed attempts:
     - Task 1 transitioned to `FAILED`.
     - Dependent task 2 transitioned to `BLOCKED`.
     - Run `b5626084-2cb9-42db-8bc2-4e2c4b468310` transitioned to `FAILED`.

5. **Customer Visible UI State**:
   - UI rendered: `Managed run created · RUNNING` $\rightarrow$ `b5626084-2cb9-42db-8bc2-4e2c4b468310`.
   - Upon page reload, UI returned cleanly to blank Work input state with no lingering or corrupted draft.

6. **Second Task Policy Enforcement**:
   - Strict rule: *"Do not submit a second task if the first fails."*
   - In accordance with this directive, no secondary or retried task was submitted.

---

## 5. Mandatory Cleanup Audit

1. **Native Worker Process Termination**:
   - Worker task terminated (`manage_task kill`).
   - Confirmed zero orphaned `worker.ts` or `node.exe` worker processes (verified via `Win32_Process` query).
2. **Fixture Removal**:
   - Fixture `sub_temp_phase3c_cmu8kac7` deleted from `BillingSubscription`.
   - Customer `cmu8kac7a000004l79y25kier` reset to `billingPlan = 'FREE'`.
   - Total subscriptions for customer: **0**.
3. **Database Boundary Protection**:
   - Zero modifications to Production database (`ep-royal-feather`).
   - Zero modifications to pre-existing test fixtures (`sub_preview_test_a` preserved).
   - Zero payment transactions in Cashfree.

---

## 4B. Second Interrupted Customer E2E Run (Run ID: `99432fe2-8ffa-4f01-a4b9-b297d56d3f69`)

* **Created At**: `2026-09-20T07:00:28.547Z`
* **Completed At**: `2026-09-20T07:02:24.066Z`
* **Status**: `FAILED` (Terminal)
* **Entitlement Context**: Fixture `sub_temp_phase3c_final_cmu8kac7` applied; customer admitted without billing gate error.
* **Decomposed Tasks (4 total)**:
  1. `c53bed68-8a2e-483c-9c5c-07c37c908194` ("Objective scoping and acceptance criteria", `PRODUCT`):
     - Attempt 1 (`cmu9so7ps00098d9xtl1st85i`): Failed due to stale worker provider resolution.
     - Attempt 2 (`cmu9sohg60000uwuvv546w03e`): **COMPLETED**. Executed with NVIDIA model provider; produced verified factual scoping deliverable.
     - Task Status: **`COMPLETED`**.
  2. `0c7b984a-6e80-495d-a89a-6ed23b9be6a4` ("Evidence gathering and research", `RESEARCH`):
     - Dispatched to worker process PID 32216 (`8d9x`).
     - Because Node.js processes retain initial launch environment in memory, PID 32216 was still running with the pre-fix environment and failed 3 attempts (`cmu9spo6p`, `cmu9sq0ir`, `cmu9sqctd`) with `"No AI providers configured or allowed by the active residency policy in ProviderRouter."`
     - Task Status: **`FAILED`**.
  3. `b83fb634-c2b4-446b-b128-42a87bc8b034` ("Structured deliverable synthesis", `ARCHITECT`):
     - Task Status: **`BLOCKED`** (dependent on Task 2).
  4. `9495514c-5acd-4446-b99a-903151024db6` ("Acceptance criteria and proof-of-work verification", `VERIFICATION`):
     - Task Status: **`QUEUED`** (un-executed, dependent on Task 3).

### Preservation of All Historical Runs
* Both `b5626084-2cb9-42db-8bc2-4e2c4b468310` and `99432fe2-8ffa-4f01-a4b9-b297d56d3f69` are preserved as immutable historical records in the Preview database.
* Empirical proof confirmed: NVIDIA provider execution works (verified via `cmu9sohg6`), but the unkilled background worker process held stale environment state, necessitating complete worker termination before attempting another controlled run.

---

## 4C. Third Controlled Customer E2E Run (Run ID: `3d1a4745-4472-4224-b523-9e20b9eb0882`)

* **Execution Timestamp**: `2026-09-20T07:34:09.064Z` to `2026-09-20T07:37:55.310Z`
* **Project ID**: `47c37c58-5f1a-4751-b859-35972854ff63`
* **Managed Run ID**: `3d1a4745-4472-4224-b523-9e20b9eb0882`
* **Client Request ID**: `9491479a-bafb-4bd0-b76f-d7ce2cea8001`
* **Worker ID**: `worker:DESKTOP-2N1R5UP:36584:c76ad07b` (PID 36584)
* **Entitlement Context**: Fixture `sub_temp_phase3c_e2e_cmu8kac7` applied; customer admitted without billing gate error.
* **Effective Model / Provider**: NVIDIA `meta/llama-3.3-70b-instruct` via native `AIRA_AGENT` runtime.

### Task DAG Progression (4 Tasks Total)

1. **Task 1: `d73bdddd-857c-4a6a-b15c-69c120bc5aff`** ("Objective scoping and acceptance criteria", `PRODUCT`):
   - Status: **`COMPLETED`**
   - Attempt: 1
   - Started: `07:35:20Z`, Completed: `07:35:30Z`
   - Runtime Run ID: `cmu9tvi7o000088uv8hbkzoka` (process fingerprint `88uv` — native worker)
   - Provider: `AIRA_AGENT`
   - Tool Execution: `memory.lookup`
   - Output: Full synthesized 3-step scoping plan with categorized document groups, naming conventions, and centralized index.

2. **Task 2: `e9261fa9-8bec-45d9-849c-1f044a204ad1`** ("Evidence gathering and research", `RESEARCH`):
   - Status: **`COMPLETED`**
   - Attempt: 1
   - Started: `07:36:49Z`, Completed: `07:36:58Z`
   - Runtime Run ID: `cmu9tx6e7000388uvqdij2txe` (process fingerprint `88uv` — native worker)
   - Provider: `AIRA_AGENT`
   - Output: Detailed research analysis citing authoritative documentation standards (Wikipedia, Microsoft, GitBook), decisions, risks, and next actions.

3. **Task 3: `c4551dff-fda6-4727-817b-de198ac25e79`** ("Structured deliverable synthesis", `ARCHITECT`):
   - Status: **`FAILED`**
   - Attempts: 3
   - Attempts executed:
     - Attempt 1: `cmu9tz4kj000l8d9x0902nz41` (Started `07:37:03.523Z`, Completed `07:37:04.966Z`, process `8d9x`)
     - Attempt 2: `cmu9tzhz4000o8d9xtfcb8wwm` (Started `07:37:20.896Z`, Completed `07:37:22.341Z`, process `8d9x`)
     - Attempt 3: `cmu9tzvdr000r8d9xtusd0p29` (Started `07:37:38.271Z`, Completed `07:37:39.715Z`, process `8d9x`)
   - Last Error: `"No AI providers configured or allowed by the active residency policy in ProviderRouter."`

4. **Task 4: `a0b86745-8af2-4bca-a74d-2171e3a71da5`** ("Acceptance criteria and proof-of-work verification", `VERIFICATION`):
   - Status: **`BLOCKED`** (blocked by upstream failure of Task 3).
   - Parent Run Status: **`FAILED`** (`completedAt: 2026-09-20T07:37:54.308Z`).

### Root Cause Analysis (Process Fingerprint `88uv` vs `8d9x`)

* Forensic inspection of the CUID machine identifiers across all `AgentRun` records reveals two distinct execution environments operating against the shared Preview database `ep-dark-thunder`:
  1. **Native Host Worker (`88uv`)**: PID 36584 running locally with `.env.local` containing `DEFAULT_PRO_PROVIDER="nvidia"` and `NVIDIA_API_KEY`.
     - Tasks processed: Task 1 (`cmu9tvi7o...88uv...`) and Task 2 (`cmu9tx6e7...88uv...`).
     - Outcome: Both succeeded completely, successfully executing NVIDIA model calls and tool invocations.
  2. **Vercel Preview Serverless Runtime (`8d9x`)**: Vercel preview deployment `dpl_Fo8aMuPRZmT1xgn5FUrkvzJXAGRA` executing internal scheduler ticks / reconcilers (`scheduler:6b4b6266...`).
     - Tasks processed: Task 3 attempts 1, 2, and 3 (`cmu9tz4kj...8d9x...`, `cmu9tzhz4...8d9x...`, `cmu9tzvdr...8d9x...`).
     - In the Vercel preview cloud environment, `NVIDIA_API_KEY` is not provisioned or `DEFAULT_PRO_PROVIDER="omniroute"` (which fails residency/config).
     - As a result, when Vercel's serverless scheduler raced and claimed Task 3, it threw `"No AI providers configured or allowed by the active residency policy in ProviderRouter."` in ~1.4 seconds per attempt.
     - Exhausting all 3 attempts on the cloud worker caused Task 3 to permanently fail and the run to terminate.

### Customer-Visible UI State & Browser Verification

* **Live Mission Control URL**: `https://aira-ai-live-git-f-9eeeff-rajpunkeshwarrajgautam-boops-projects.vercel.app/work/runs/3d1a4745-4472-4224-b523-9e20b9eb0882`
* Inspected via CDP on visible Chrome:
  - Header: `WORK MISSION: FAILED`
  - Run ID: `3d1a4745-4472-4224-b523-9e20b9eb0882`
  - Tasks Completed: `2 / 4`
  - Task Graph:
    - "Objective scoping and acceptance criteria": `COMPLETED`
    - "Evidence gathering and research": `COMPLETED`
    - "Structured deliverable synthesis": `FAILED`
    - "Acceptance criteria and proof-of-work verification": `BLOCKED` (waiting on dependencies)
* Verified browser reload: State and data persisted without corruption or UI crash.

---

## 5. Mandatory Cleanup Audit

1. **Native Worker Process Termination**:
   - Terminated worker PID 36584 (`manage_task kill`).
   - Inspected host process table: 0 active `worker.ts` or native worker processes.
2. **Fixture Removal & Billing Restoration**:
   - Deleted exact temporary fixture: `DELETE FROM "BillingSubscription" WHERE id = 'sub_temp_phase3c_e2e_cmu8kac7'` (1 row deleted).
   - Reset customer user record: `UPDATE "User" SET "billingPlan" = 'FREE' WHERE id = 'cmu8kac7a000004l79y25kier'`.
   - Verified in Neon database:
     - Customer subscriptions count: **0**
     - Customer billingPlan: `'FREE'`
     - Active paid entitlement: `false`
     - Effective tier: `FREE`
   - Verified zero residual `sub_temp_%` fixtures.
3. **Run Preservation**:
   - Historical runs `b5626084-2cb9-42db-8bc2-4e2c4b468310`, `99432fe2-8ffa-4f01-a4b9-b297d56d3f69`, and new run `3d1a4745-4472-4224-b523-9e20b9eb0882` remain preserved in the database.
4. **Database Boundary Protection**:
   - Zero modifications to Production database (`ep-royal-feather`).
   - Zero modifications to pre-existing test fixtures (`sub_preview_test_a` preserved).
   - Zero payment transactions in Cashfree.

---

## 6. Scenario Distinction Matrix

| Scenario | Status | Empirical Note |
| :--- | :--- | :--- |
| **Core Work Runtime Customer E2E** | **BLOCKED** | Tasks 1 and 2 completed successfully on native worker; Task 3 failed due to competing Vercel serverless scheduler lacking provider credentials. |
| **Cancellation** | **NOT EXECUTED** | Not authorized in this single-run directive. |
| **Crash Recovery** | **NOT EXECUTED** | Not authorized in this single-run directive. |
| **Approval Enforcement** | **OBSERVED** | High-risk `memory.lookup` approval requirement rendered in UI during Mission Control inspection. |
| **Genuine Second-User Isolation** | **NOT EXECUTED** | Not authorized in this single-run directive. |

---

## 7. Status & Gate Decision

A single controlled run (`3d1a4745-4472-4224-b523-9e20b9eb0882`) was executed pursuant to user authorization. The native Work worker successfully executed Task 1 (`PRODUCT`) and Task 2 (`RESEARCH`) via NVIDIA LLM. However, because the shared Preview database is also polled by Vercel Preview serverless workers (`8d9x`) that lack the local NVIDIA configuration, Task 3 was claimed and failed by the cloud runtime. Per strict instructions ("Do not treat partial completion as PASS" and "Do not submit a second managed run if this one fails"), the core E2E is declared BLOCKED. All processes have been terminated, all temporary fixtures removed, and customer billing restored to FREE.

**Release Gate Decision**:
`AIRA_R2_WORK_RUNTIME_CUSTOMER_E2E_BLOCKED`


