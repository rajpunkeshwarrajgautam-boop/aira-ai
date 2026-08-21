# AIRA Autonomous Agent Engine (AAE)

AAE is an **optional** long-running execution provider for AIRA's existing Agent Workspace. It does not replace research, DeerFlow, or AutoGPT. AIRA only routes work here when `AAE_AGENT_ENABLED=true`, the web adapter is fully configured, and `/health` passes.

## Security model

- AIRA authenticates to the runner with `AAE_INTERNAL_AUTH_TOKEN` -> runner `AAE_API_TOKEN`.
- Every job request carries AIRA's authenticated user id. This first production profile is deliberately **single-owner**: `AAE_ALLOWED_OWNER_ID` must match, so a shared filesystem can never cross AIRA user boundaries.
- The runner has OpenAI/network access but **no Docker socket** and no shell primitive.
- Shell commands are sent to a separate sandbox sidecar over an internal-only Docker network.
- The sandbox has the shared workspace, but **no OpenAI key, no AIRA token, and no external network route**.
- Both containers drop Linux capabilities and use `no-new-privileges`; the sandbox root filesystem is read-only.
- File tools resolve every path under `/workspace` before reading/writing.
- Job ids are idempotent. Re-submitting the same AIRA run id returns the existing job instead of creating duplicate paid work.

## API contract used by AIRA

- `GET /health`
- `POST /v1/jobs` `{ job_id, task, session_id? }` -> `202`
- `GET /v1/jobs/{job_id}`
- `POST /v1/jobs/{job_id}/cancel` -> `202`

Authenticated endpoints require `Authorization: Bearer <AAE_API_TOKEN>` and `X-Aira-Owner-User-Id`.

Statuses: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `TERMINATED`.

## Deploy

```bash
cd infra/aae-runner
cp .env.example .env
# Set OPENAI_API_KEY, AAE_API_TOKEN, AAE_SANDBOX_TOKEN and AAE_ALLOWED_OWNER_ID.
mkdir -p workspace
# Linux hosts: make the bind-mounted workspace writable by the non-root UID used by both containers.
sudo chown -R 10001:10001 workspace
docker compose -f compose.yml up -d --build
curl http://127.0.0.1:8000/health
```

The Compose file publishes the runner on loopback only (`127.0.0.1:8000`) for a host-local TLS reverse proxy. Expose **only the runner** through TLS/reverse proxy. Do not publish port 9000 and do not attach the sandbox to an egress-capable network.

## AIRA activation gate

Keep `AAE_AGENT_ENABLED=false` until all of these pass against the real host:

1. TLS health probe from the Vercel region.
2. Auth rejection with no/bad token.
3. One real job reaches `COMPLETED` and returns a bounded result.
4. A running shell command is cancelled and its process disappears.
5. A request carrying any user id other than `AAE_ALLOWED_OWNER_ID` is rejected with 403.
6. Runner restart converts abandoned `RUNNING` jobs to `FAILED` instead of reporting phantom progress.
7. Existing AIRA `pnpm run test`, lint/typecheck/build and production smoke tests are green.

AAE is intentionally not self-activating. Repository integration is not evidence of deployment or production readiness. The single-owner rule is a deliberate safety gate; do not broaden AAE to multiple AIRA users until every execution receives a genuinely isolated filesystem/sandbox.
