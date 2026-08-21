# AIRA Autonomous Agent Engine integration

Status: **integrated on a feature branch; disabled by default; not deployed or production-active**.

AAE adds a third autonomous runtime behind AIRA's existing Agent Workspace controls. It does not replace the research path, DeerFlow, or AutoGPT.

## Provider order

When no provider is explicitly requested, AIRA preserves the existing order and appends AAE:

1. DeerFlow, when configured and healthy.
2. AutoGPT, when configured.
3. AAE, when configured, allowlisted for the signed-in user, and healthy.

The AAE provider can never become ready from repository code alone. `AAE_AGENT_ENABLED` defaults to `false`.

## First-rollout tenancy rule

The runner has a persistent code workspace. Until filesystem isolation exists per AIRA user, one runner is bound to exactly one AIRA user:

- Vercel/AIRA: `AAE_ALLOWED_USER_ID=<Auth.js user id>`
- Runner: `AAE_ALLOWED_OWNER_ID=<same id>`

Both layers enforce the binding. Do not place multiple user ids behind one runner/workspace.

## Remote contract

AIRA calls the runner with a server-only bearer token and `X-Aira-Owner-User-Id`.

- `GET /health`
- `POST /v1/jobs`
- `GET /v1/jobs/{job_id}`
- `POST /v1/jobs/{job_id}/cancel`

The AIRA `AgentRun.id` is the remote `job_id`. This makes submission idempotent: a retry after a lost response returns the same remote job instead of creating duplicate paid work.

## Security boundary

- The runner has OpenAI/network access but no Docker socket.
- Shell execution occurs in a separate sandbox sidecar.
- The sandbox has no OpenAI key, no AIRA backend token, and no external network route.
- File tools reject paths outside `/workspace`.
- Both containers drop Linux capabilities and set `no-new-privileges`.
- AIRA's existing auth, plan/quota enforcement, safety gateway, ownership checks, capacity lease, run reconciliation and no-store API responses remain in front of AAE.

## Activation gate

Do not set `AAE_AGENT_ENABLED=true` until a real host passes all of the following in Preview:

1. TLS `/health` succeeds from AIRA/Vercel.
2. Missing and invalid bearer tokens are rejected.
3. A mismatched AIRA owner id is rejected with 403.
4. One real objective reaches `COMPLETED` and polling returns the result.
5. A long-running shell command can be cancelled and the process disappears.
6. Runner restart does not leave phantom `RUNNING` jobs.
7. AIRA tests, lint, typecheck and build are green.
8. Existing research/auth/share/agent smoke tests are unchanged.

Only after those checks should Preview be enabled for the allowlisted owner. Production should remain off until Preview behavior is verified end-to-end.
