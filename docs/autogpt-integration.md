# AutoGPT integration runbook

Aira integrates with AutoGPT through the supported External API. It does not copy or redistribute code from `autogpt_platform/`: that directory uses the PolyForm Shield license and restricts competing products. The External API boundary keeps Aira independently maintainable.

## Required AutoGPT setup

1. Build or select one AutoGPT graph with a single text objective input.
2. Record the graph ID, graph version, input node ID, and input field name (`value` by default).
3. Create a server API key with only these permissions:
   - `EXECUTE_GRAPH`
   - `READ_GRAPH`
4. Keep the key out of the browser and source control.

AutoGPT executes a graph with:

```text
POST {AUTOGPT_API_BASE_URL}/graphs/{graph_id}/execute/{graph_version}
X-API-Key: <server-only key>
```

Aira polls results with:

```text
GET {AUTOGPT_API_BASE_URL}/graphs/{graph_id}/executions/{execution_id}/results
X-API-Key: <server-only key>
```

## Deployment order

1. Apply `prisma/migrations/20260811_add_agent_runs/migration.sql` to the Aira database.
2. Configure all `AUTOGPT_*` variables from `.env.example` in Vercel Preview.
3. Keep `AUTOGPT_AGENT_ENABLED=false` until the graph input is tested.
4. Enable the feature, deploy a Preview, and verify one Pro/Team task from submission through completion.
5. Configure the same variables for Production and promote the verified Preview.

## Safety behavior

- All Aira routes authenticate the user and scope database queries by `userId`.
- Client request IDs prevent duplicate submissions inside Aira.
- Provider responses are capped at 1 MB; stored final output is capped at 128 KB.
- Node-level execution data is discarded; only final graph output is stored.
- Ambiguous network failures are not retried automatically because AutoGPT's execution endpoint does not currently accept an idempotency key.
- The AutoGPT key is never returned to the client or stored in `AgentRun`.
- Remote cancellation is intentionally absent until AutoGPT exposes it in the External API.

## Verification checklist

- Free user receives `PLAN_REQUIRED` and no usage is consumed.
- Pro/Team submission decrements exactly one monthly run.
- A rejected submission refunds the reserved run.
- Duplicate `clientRequestId` values return the original local run.
- One user cannot load another user's run ID.
- Completed output renders in `/agents` and remains available after a reload.
- The API key never appears in browser network responses, logs, or committed files.
