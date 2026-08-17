# AutoGPT integration runbook

Aira integrates through its authenticated AutoGPT runner adapter. It does not copy or redistribute code from `autogpt_platform/`: that directory uses the PolyForm Shield license and restricts competing products. The runner pins the MIT-licensed AutoGPT Classic implementation and keeps its Agent Protocol server private behind a compatibility API.

## Required AutoGPT setup

1. Provision `infra/autogpt-runner` on an Ubuntu VPS using `compose.yml` plus `compose.vps.yml`.
2. Provision the same package on Windows using `compose.yml` plus `compose.windows.yml` and a Cloudflare Tunnel.
3. Generate different runner API keys for the two hosts and keep them out of browsers, logs, and source control.
4. Use the fixed compatibility graph mapping:
   - graph ID: `aira-objective-runner`
   - graph version: `1`
   - input node ID: `objective`
   - input field: `value`

AutoGPT executes a graph with:

```text
POST {AUTOGPT_PRIMARY_API_BASE_URL}/graphs/{graph_id}/execute/{graph_version}
X-API-Key: <server-only key>
X-AIRA-Request-ID: <Aira AgentRun ID>
```

Aira polls results with:

```text
GET {SELECTED_AUTOGPT_API_BASE_URL}/graphs/{graph_id}/executions/{execution_id}/results
X-API-Key: <server-only key>
```

Before a new submission, Aira probes the VPS and then the Windows standby. It submits exactly once to the first healthy target. The stored remote execution reference pins all later result polls to the accepting host.

## Deployment order

1. Apply `prisma/migrations/20260811_add_agent_runs/migration.sql` to the Aira database.
2. Bring up the VPS primary and confirm its authenticated health endpoint.
3. Bring up the Windows standby and confirm its authenticated health endpoint.
4. Configure all `AUTOGPT_*` variables from `.env.example` in Vercel Preview.
5. Keep `AUTOGPT_AGENT_ENABLED=false` until both runner contracts are tested.
6. Enable the feature, deploy a Preview, and verify one Pro/Team task from submission through completion.
7. Stop the VPS adapter briefly and verify a new Preview task is accepted by the Windows runner.
8. Configure the same variables for Production and promote the verified Preview.

## Safety behavior

- All Aira routes authenticate the user and scope database queries by `userId`.
- Client request IDs prevent duplicate submissions inside Aira.
- Provider responses are capped at 1 MB; stored final output is capped at 128 KB.
- Node-level execution data is discarded; only final graph output is stored.
- Ambiguous submission failures never switch hosts, preventing a split-brain duplicate job.
- The runner also enforces the Aira run ID as an idempotency key on each host.
- Runner, internal, and NVIDIA keys are never returned to the client or stored in `AgentRun`.
- Remote cancellation is intentionally absent until AutoGPT exposes it in the External API.
- The AutoGPT Agent Protocol port is never published; only the authenticated adapter is internet-facing.
- Shell, Python execution, Git, filesystem, browser, and raw-fetch commands are disabled in the Classic runner.
- The Classic container has no direct internet route; NVIDIA access is brokered by the adapter.

## Verification checklist

- Free user receives `PLAN_REQUIRED` and no usage is consumed.
- Pro/Team submission decrements exactly one monthly run.
- A rejected submission refunds the reserved run.
- Duplicate `clientRequestId` values return the original local run.
- One user cannot load another user's run ID.
- Completed output renders in `/agents` and remains available after a reload.
- The API key never appears in browser network responses, logs, or committed files.
