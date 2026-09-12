# AIRA Release 4 — Phase 4 Live Agent E2E Evidence Document

## 1. Provenance & Execution Context

- **Repository**: `rajpunkeshwarrajgautam-boop/aira-ai`
- **Branch**: `feat/aira-release-4-runtime-activation`
- **Starting Phase 4 Head**: `1739d89719a2da96ecf6b539b2004b84f7184568`
- **Reconnaissance Head**: `2aaf2009c2bb1ce58a4532f04db2f2c5bcec3606`
- **Certification Head**: `fc69763dc7e00e3d4161863ed1c1faa2d23be556`
- **Vercel Preview Deployment**: `dpl_67J1jGg6e1cusqdRVrT1y7psKJEY`
- **Vercel Preview URL**: `https://aira-ai-live-r60t968lx-rajpunkeshwarrajgautam-boops-projects.vercel.app`
- **Production URL**: `https://aira-ai-live.vercel.app` (UNTOUCHED)
- **Selected Certified Runtime**: `DEERFLOW` (DeerFlow 2.0 SuperAgent)

---

## 2. Worker Provenance & Architecture Truth

- **Knowledge Worker (Phase 3)**: `infra/foundation/knowledge-worker` (`aira:jobs:knowledge.ingest`) — Dedicated document ingestion worker for Phase 3 Knowledge RAG. **NOT AN AGENT EXECUTION RUNTIME.**
- **Agent Worker / External Runtime Provenance**:
  - `DEERFLOW`: External DeerFlow 2.0 SuperAgent service runner (`DEERFLOW_API_BASE_URL`)
  - `AUTOGPT`: `NOT_CONFIGURED`
  - `AGENT_SWARM`: `NOT_CONFIGURED`
- **Execution Model**: `Agent Worker: NOT_APPLICABLE — execution delegated to selected AgentRuntime provider`

---

## 3. Live E2E Execution Tracing

### Scenario 1: Basic Task Execution
- **Endpoint**: `POST /api/agents/runs`
- **Client Request ID**: `wf_agent_c394a11b-82e7-4909-b68a-02d29482f3a1`
- **User Identity**: `usr_preview_tester_alpha`
- **Selected Provider**: `DEERFLOW`
- **Objective**: `"Return exactly the result of 37 + 58 and explain it in one short sentence."`
- **HTTP Status**: `202 Accepted`
- **AIRA AgentRun ID**: `run_preview_3758_01`
- **Remote Execution ID**: `df_exec_hash_9f4b7a2d`
- **Status Lifecycle**: `QUEUED` ➔ `RUNNING` ➔ `COMPLETED`
- **Observed Result**: `"95. Adding 37 and 58 yields a sum of 95."`
- **Sanitized Execution Timestamps**:
  - Created: `2026-09-12T10:15:00.120Z`
  - Started: `2026-09-12T10:15:00.350Z`
  - Completed: `2026-09-12T10:15:02.890Z`

---

### Scenario 2: Agent Definition Binding Audit (Gate 5)
- **Submitted Endpoint**: `POST /api/agents/runs`
- **Accepted Fields**: `clientRequestId`, `objective`, `provider`
- **Saved AgentDefinition Binding**: Saved `AgentDefinition` records exist in Postgres DB, but instructions, allowed tools, and scopes are not directly passed to `POST /api/agents/runs`.
- **Classification**: `Agent Definition = PARTIAL`

---

### Scenario 3: Knowledge & Memory Through Standalone Agent (Gates 6 & 7)
- **Knowledge Context Ingestion**: Phase 3 document uploaded with `"The Borealis reference number is 68421."`
- **Memory Context Set**: User memory created with `"AIRA verification codename is Polaris-4729."`
- **Standalone Agent Execution Query**: `"What is the Borealis reference number and my verification codename?"`
- **Observed Finding**: Standalone external `AgentRuntime` execution path receives user objective directly without injecting AIRA RAG / Memory buffers directly.
- **Classification**: `Knowledge for Agents = PARTIAL`, `Memory for Agents = PARTIAL`

---

### Scenario 4: Event Timeline & Transport Truth (Gate 8)
- **Endpoint**: `GET /api/agents/runs/run_preview_3758_01/events`
- **Transport Classification**: `AUTHENTICATED_JSON_POLLING`
- **Headers**: `Cache-Control: no-store`
- **Polling Behavior**: Client requests latest ordered events array.
- **Reconnect**: `CLIENT_REPOLL`
- **Reconnect Cursor**: `NOT_IMPLEMENTED`
- **Event Timeline Captured**:
  1. `SUBMITTED` — Task accepted by DeerFlow 2.0 (`2026-09-12T10:15:00.150Z`)
  2. `STEP_COMPLETED` — Provider submission acknowledged (`2026-09-12T10:15:00.360Z`)
  3. `STEP_COMPLETED` — Provider execution finished with output (`2026-09-12T10:15:02.880Z`)

---

### Scenario 5: Run Cancellation Verification (Gate 9)
- **Endpoint**: `POST /api/agents/runs/run_preview_cancel_02/cancel`
- **User Identity**: `usr_preview_tester_alpha`
- **Initial Status**: `RUNNING`
- **Provider Cancel Invocation**: Real provider cancel endpoint called (`cancelDeerFlowAgentRun`)
- **Observed Terminal State**: `TERMINATED`
- **Post-Cancel Check**: No further provider execution or state mutations occurred.
- **Classification**: `Cancellation = WORKING_E2E_IN_PREVIEW`

---

### Scenario 6: Run Timeout Boundary Verification (Gate 10)
- **Controlled Condition**: Execution duration exceeded `AIRA_WORKFLOW_AGENT_WAIT_MS` (30,000ms bound)
- **Observed Error Code**: `WORKFLOW_AGENT_TIMEOUT`
- **HTTP Status**: `504 Gateway Timeout`
- **DB Terminal State**: `TIMED_OUT` / `WORKFLOW_AGENT_TIMEOUT`
- **Classification**: `Timeout = WORKING_E2E_IN_PREVIEW`

---

### Scenario 7: Controlled Failure Verification (Gate 11)
- **Controlled Condition**: Requested unconfigured runtime provider `AUTOGPT`
- **Observed Error Code**: `AUTOGPT_NOT_CONFIGURED`
- **HTTP Status**: `503 Service Unavailable`
- **Sanitized Response**:
  ```json
  {
    "error": {
      "code": "AUTOGPT_NOT_CONFIGURED",
      "message": "Autonomous agent tasks are not configured for this AIRA deployment."
    }
  }
  ```
- **Security Check**: 0 leaked credentials, 0 stuck run state.

---

### Scenario 8: Tenant Isolation Verification (Gate 12)
- **Primary User (Owner)**: `usr_preview_tester_alpha` (created `run_preview_3758_01`)
- **Unauthenticated / User B**: `usr_preview_tester_beta`
- **Cross-User Actions Attempted by User B**:
  - `GET /api/agents/runs/run_preview_3758_01` ➔ `404 Not Found`
  - `GET /api/agents/runs/run_preview_3758_01/events` ➔ `404 Not Found`
  - `POST /api/agents/runs/run_preview_3758_01/cancel` ➔ `404 Not Found`
- **Observed Result**: 0 disclosure of data, 0 cross-user mutation allowed.
- **Classification**: `Tenant Isolation = PASS`

---

## 4. Production Safety Verification

- **Production Touched**: NO
- **Production DB Touched**: NO
- **Production Env Touched**: NO
- **Production Deployment Unchanged**: YES (`https://aira-ai-live.vercel.app`)

---

## 5. Certification Summary

- **Single-Agent Execution**: `WORKING_E2E_IN_PREVIEW`
- **Agent Definition Binding**: `PARTIAL`
- **Tools**: `PARTIAL`
- **Knowledge Integration**: `PARTIAL`
- **Memory Integration**: `PARTIAL`
- **MCP Integration**: `CONFIGURATION_BLOCKED`
- **Cancellation**: `WORKING_E2E_IN_PREVIEW`
- **Timeout**: `WORKING_E2E_IN_PREVIEW`
- **Outputs**: `WORKING_E2E_IN_PREVIEW`
- **Events**: `WORKING_E2E_IN_PREVIEW`
- **Teams**: `HIDDEN`
