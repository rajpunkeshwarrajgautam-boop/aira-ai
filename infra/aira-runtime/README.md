# AIRA runtime host

One command stands up AIRA's externally gated worker runtimes on one persistent
Linux host, puts a single TLS edge in front of them, and writes the exact
Vercel environment that points AIRA at what is now running.

```bash
sudo AIRA_NVIDIA_API_KEY=… AIRA_ACME_EMAIL=you@example.com \
  bash infra/aira-runtime/bootstrap.sh
```

This directory adds no new inference gateway. It composes the runtimes the
repository already defines — `infra/foundation`, `infra/autogpt-runner`,
`infra/deerflow-runner` — and supplies the two pieces that were missing: a TLS
edge Vercel can reach, and a single idempotent entry point that wires them
together with generated secrets. OmniRoute is an external inference gateway and
is configured separately through the `OMNIROUTE_*` variables documented below.

## What runs where

```
Vercel ── AIRA Next.js app ── HTTPS ── OmniRoute public gateway (separate deployment)
   │
   │  HTTPS, per-service token on every request
   ▼
Ubuntu host ── Caddy edge (the only listener on 80/443)
   ├─ control.<base>            → 127.0.0.1:8090   foundation control plane ─┬─ Redis (AOF, persistent volume)
   │                                                                        └─ knowledge worker (no published port)
   ├─ sandbox.<base>            → 127.0.0.1:8091   sandbox gateway → sandbox (internal-only network)
   ├─ deerflow.<base>           → 127.0.0.1:2026   DeerFlow Gateway (pinned a5acc25d)
   ├─ autogpt-primary.<base>    → 127.0.0.1:8096   AutoGPT runner, project aira-autogpt-primary
   └─ autogpt-secondary.<base>  → 127.0.0.1:8097   AutoGPT runner, project aira-autogpt-secondary

Supabase ── Postgres · knowledge tables · private bucket aira-knowledge
```

Every backend on the AIRA runtime host binds loopback only. The edge is the sole
public listener, and `verify.sh` proves the private ports stay unreachable from
the Internet. OmniRoute is intentionally separate because the Vercel app must
reach it through a stable public HTTPS origin; a PC-only `127.0.0.1` endpoint is
not reachable from Vercel.

### Hostnames without DNS credentials

With no `AIRA_RUNTIME_DOMAIN`, the bootstrap derives hostnames from the host's
public IPv4 address through `sslip.io`, which resolves
`<label>.<dashed-ip>.sslip.io` back to the encoded address. Let's Encrypt issues
real, publicly trusted certificates for those names, so production HTTPS works
with no DNS account at all. Set `AIRA_RUNTIME_DOMAIN=example.com` once real DNS
exists and re-run; the service hostnames become `control.example.com` and so on
and the generated Vercel file updates to match.

### The two AutoGPT targets

`lib/autogpt/config.ts` refuses to configure in production unless two targets
with distinct base URLs are present, and this bootstrap satisfies that
honestly: two separate Compose projects, two adapter containers, two AutoGPT
containers, two SQLite databases, two workspaces and two independent
`RUNNER_API_KEY` values. `verify.sh` asserts that the primary's key is rejected
by the secondary, so the pair cannot silently collapse into one target behind
two names.

**Stated plainly:** on a single host this gives process-level and
credential-level isolation, not host-level redundancy. If the host dies, both
targets die. The upgrade path is to run `bootstrap.sh` on a second host and
repoint `AUTOGPT_SECONDARY_*` at it; nothing else changes. That is the
configuration the repository's `.env.example` describes, and it remains the
right destination.

### Sandbox isolation

`compose.gvisor.yml` is the repository's intended isolation mode. The bootstrap
uses it automatically when `runsc` is registered with Docker. When it is not,
the bootstrap says so loudly rather than degrading in silence: the sandbox
still runs read-only, with all capabilities dropped, `no-new-privileges`, a
tmpfs-only writable path, an internal-only Docker network, a 32-process limit,
a memory cap and per-execution `RLIMIT_AS`/`RLIMIT_CPU`/`RLIMIT_NPROC` —
but without a syscall-filtering kernel. Install gVisor and re-run to reach the
intended level.

## Configuration matrix

Read from the code, not from documentation. "Where" is the file that decides
whether the feature is on.

### OmniRoute inference gateway — `src/services/omniroute/config.ts`

| Variable | Required | Effect |
| --- | --- | --- |
| `OMNIROUTE_ENABLED` | yes, `"true"` | Enables OmniRoute registration in AIRA's provider router. |
| `OMNIROUTE_BASE_URL` | yes | Public HTTPS gateway origin. AIRA normalizes it to the OpenAI-compatible `/v1` root. |
| `OMNIROUTE_API_KEY` | yes | Server-only bearer credential used for model discovery and inference. |
| `OMNIROUTE_MODEL` | no | Defaults to `auto`. Also supports OmniRoute routing profiles such as `auto/coding`, `auto/fast`, `auto/cheap`, `auto/smart`, and `auto/offline`. |
| `OMNIROUTE_TIMEOUT_MS` | no | Defaults to 45000 and is bounded by AIRA's gateway configuration. |
| `DEFAULT_PRO_PROVIDER` | recommended | Set to `omniroute`; the code also defaults to OmniRoute when this variable is absent. |
| `DEFAULT_FREE_PROVIDER` | no | Defaults to `nvidia` and remains AIRA's isolated fallback when configured. |

AIRA exposes authenticated `GET /api/omniroute/status`, `GET /api/omniroute/models`
and `POST /api/omniroute/test` routes plus the `/omniroute` control surface. The
API key never reaches the browser. Model discovery calls OmniRoute's
OpenAI-compatible `/v1/models`; normal AIRA generation keeps the existing
safety, publication, residency, provider-health and citation boundaries around
the OmniRoute provider.

For production, deploy OmniRoute to a persistent public host such as its
supported Fly.io configuration, then set the five `OMNIROUTE_*` variables in
Vercel. This repository deliberately does not provision OmniRoute inside the
AIRA runtime bootstrap because provider credentials, persistent OmniRoute data,
and its public lifecycle belong to the gateway deployment itself.

### Foundation control plane — `lib/foundation-control-plane.ts`

| Variable | Required | Effect |
| --- | --- | --- |
| `FOUNDATION_CONTROL_PLANE_ENABLED` | yes, `"true"` | Any other value makes admission a no-op that always allows. |
| `FOUNDATION_CONTROL_PLANE_REQUIRED` | no | `"true"` turns a control-plane outage into a request failure. Left `false` by the bootstrap so chat degrades to the configured provider path instead of going down with the control plane. |
| `AIRA_CONTROL_PLANE_URL` | yes | Base URL. Trailing slash stripped. |
| `AIRA_CONTROL_PLANE_TOKEN` | yes | Sent as `X-AIRA-Control-Token`. Compared with `hmac.compare_digest` server-side. |
| `AIRA_CONTROL_PLANE_TIMEOUT_MS` | no | Defaults to 1500. |

Endpoints AIRA calls: `POST /v1/admit`, `POST /v1/release`,
`GET /v1/providers/{id}/allowed`, `POST /v1/providers/{id}/outcome`,
`POST /v1/jobs/enqueue`. `enqueueFoundationJob` deliberately has no degraded
path — a knowledge upload fails rather than silently never being ingested.

### Knowledge ingestion — `app/api/knowledge/route.ts`, `lib/foundation-storage.ts`

| Variable | Required | Effect |
| --- | --- | --- |
| `MULTIMODAL_INGESTION_ENABLED` | yes, `"true"` | Gates both `GET` and `POST /api/knowledge`. |
| `SUPABASE_URL` *or* `NEXT_PUBLIC_SUPABASE_URL` | yes | Storage origin. Only the URL may carry `NEXT_PUBLIC_`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Never `NEXT_PUBLIC_`. |
| `AIRA_KNOWLEDGE_BUCKET` | no | Defaults to `aira-knowledge`. |
| `AIRA_KNOWLEDGE_WORKER_TOKEN` | yes | Callback credential, compared with `timingSafeEqual`. |
| `AUTH_URL` *or* `NEXTAUTH_URL` | yes | The callback URL is derived from it; a non-HTTPS value is refused in production. |
| `ADVANCED_MULTIMODAL_ENABLED`, `AIRA_MEDIA_BASE_URL`, `AIRA_MEDIA_API_KEY`, `AIRA_MEDIA_MODEL` | no | Audio and video only. |

Worker-side: `AIRA_CONTROL_PLANE_URL`, `AIRA_CONTROL_PLANE_TOKEN`,
`AIRA_KNOWLEDGE_WORKER_TOKEN`, and `AIRA_VISION_*` for image ingestion.

Flow: `POST /api/knowledge` → upload to Supabase Storage → sign a 1-hour URL →
`KnowledgeAsset` row → `enqueueFoundationJob("knowledge.ingest")` → worker
claims from the Redis stream → downloads → extracts → chunks → `POST` to
`/api/knowledge/callback` with `X-AIRA-Worker-Token` → `KnowledgeChunk` rows →
`UPLOADING → QUEUED → PROCESSING → READY`, or `FAILED` with the error.

### DeerFlow — `lib/deerflow/config.ts`

| Variable | Required | Effect |
| --- | --- | --- |
| `DEERFLOW_AGENT_ENABLED` | yes, `"true"` | |
| `DEERFLOW_API_BASE_URL` | yes | Must be HTTPS in production. Credentials, query and fragment are refused. |
| `DEERFLOW_INTERNAL_AUTH_TOKEN` | yes | Must equal DeerFlow's `DEER_FLOW_INTERNAL_AUTH_TOKEN`. |
| `DEERFLOW_MODEL_NAME` | no | |
| `DEERFLOW_THINKING_ENABLED` | no | Defaults false. |
| `DEERFLOW_PLAN_MODE` | no | **Defaults true** when unset. |
| `DEERFLOW_REQUEST_TIMEOUT_MS` | no | 15000, clamped to 2000–30000. |
| `DEERFLOW_HEALTH_TIMEOUT_MS` | no | 2500, clamped to 500–5000. |

Endpoints: `GET /health`, `POST /api/threads`, `POST|GET /api/threads/{id}/runs`,
`GET /api/threads/{id}/state`.

### AutoGPT — `lib/autogpt/config.ts`

| Variable | Required | Effect |
| --- | --- | --- |
| `AUTOGPT_AGENT_ENABLED` | yes, `"true"` | |
| `AUTOGPT_PRIMARY_API_BASE_URL` | yes | Falls back to `AUTOGPT_API_BASE_URL`. HTTPS required in production. |
| `AUTOGPT_PRIMARY_API_KEY` | yes | Falls back to `AUTOGPT_API_KEY`. Sent as `X-API-Key`. |
| `AUTOGPT_SECONDARY_API_BASE_URL` | yes in production | Must differ from the primary. |
| `AUTOGPT_SECONDARY_API_KEY` | yes in production | Set together with the URL or neither. |
| `AUTOGPT_GRAPH_ID` | yes | `aira-objective-runner` — the adapter's own identifier, validated against `AIRA_GRAPH_ID`. |
| `AUTOGPT_GRAPH_VERSION` | yes | `1`. |
| `AUTOGPT_INPUT_NODE_ID` | yes | `objective`. |
| `AUTOGPT_INPUT_FIELD` | no | Defaults `value`. |
| `AUTOGPT_REQUIRE_FOUNDATION_STACK` | no | When `"true"`, also requires `FOUNDATION_CONTROL_PLANE_ENABLED`, `AIRA_CONTROL_PLANE_URL`, `AIRA_CONTROL_PLANE_TOKEN`, `PYTHON_SANDBOX_ENABLED`, `AIRA_SANDBOX_URL` and `AIRA_SANDBOX_TOKEN`. |

The graph identifiers are not external AutoGPT Platform IDs. They are the
adapter's own contract in `infra/autogpt-runner/adapter/app.py`, defaulted in
`.env.example` and asserted by `infra/autogpt-runner/tests/test_adapter.py`.
There is no graph to create and nothing to guess.

Endpoints: `GET /external-api/v1/health`,
`POST /external-api/v1/graphs/{id}/execute/{version}`,
`GET /external-api/v1/graphs/{id}/executions/{execId}/results`.

### Sandbox — `.env.example`, `lib/autogpt/config.ts`

`PYTHON_SANDBOX_ENABLED=true`, `AIRA_SANDBOX_URL`, `AIRA_SANDBOX_TOKEN`
(sent as `X-AIRA-Sandbox-Token`).

## Runbook

```bash
# Deploy or re-deploy AIRA's worker/runtime host. Idempotent; existing secrets are preserved.
sudo AIRA_NVIDIA_API_KEY=… AIRA_ACME_EMAIL=you@example.com \
  bash infra/aira-runtime/bootstrap.sh

# Skip DeerFlow on a host under ~8 GB RAM.
sudo … bash infra/aira-runtime/bootstrap.sh --no-deerflow

# Re-run the activation gate at any time.
sudo bash infra/aira-runtime/verify.sh

# Apply the generated worker/runtime environment to Vercel, from a linked checkout.
bash infra/aira-runtime/set-vercel-env.sh /etc/aira/vercel.production.env
vercel --prod
```

OmniRoute variables are applied separately because the gateway is a separate
persistent deployment. At minimum AIRA needs `OMNIROUTE_ENABLED=true`, the
public `OMNIROUTE_BASE_URL`, the server-only `OMNIROUTE_API_KEY`, and an
`OMNIROUTE_MODEL` such as `auto`.

Logs:

```bash
docker compose -f infra/foundation/compose.yml logs -f control-plane knowledge-worker
docker compose -p aira-autogpt-primary   logs -f adapter
docker compose -p aira-autogpt-secondary logs -f adapter
docker compose -f infra/aira-runtime/compose.edge.yml logs -f edge
```

## Rollback

Every integration fails closed, so rollback is a Vercel change and takes effect
on the next deployment. Nothing needs to be torn down on the host first.

```bash
# Disable one integration
vercel env rm OMNIROUTE_ENABLED production --yes
vercel env rm DEERFLOW_AGENT_ENABLED production --yes
vercel env rm AUTOGPT_AGENT_ENABLED  production --yes
vercel env rm MULTIMODAL_INGESTION_ENABLED production --yes
vercel --prod
```

Removing `FOUNDATION_CONTROL_PLANE_ENABLED` returns admission to the normal
configured provider path. Because the bootstrap leaves
`FOUNDATION_CONTROL_PLANE_REQUIRED=false`, a control-plane outage already
degrades rather than failing user requests.

Stop the host side without losing state (Redis AOF, SQLite runner databases and
DeerFlow threads all live in named volumes):

```bash
docker compose -f infra/aira-runtime/compose.edge.yml down
docker compose -f infra/foundation/compose.yml down
docker compose -p aira-autogpt-primary   down
docker compose -p aira-autogpt-secondary down
```

Re-running `bootstrap.sh` restores everything with the same secrets, so Vercel
does not need reconfiguring for those worker runtimes.

## Secret handling

- Generated once into `/etc/aira/runtime.env`, mode 600, root only. Re-runs
  reuse it, so an already-configured Vercel project is never invalidated.
- `/etc/aira/vercel.production.env` (mode 600) is the only file containing the
  worker-runtime values in Vercel-ready form. `bootstrap.sh` does **not** print
  it unless `--print-secrets` is passed.
- OmniRoute's API key is managed by the OmniRoute deployment and Vercel; this
  bootstrap neither creates nor stores it.
- `set-vercel-env.sh` prints variable names and add/replace decisions only,
  never values, so its transcript is safe to paste.
- `.env`, `.env.*` and `/etc/aira` are outside the repository or covered by
  `.gitignore`; nothing generated here is commitable.
- The Supabase service-role key is never generated, echoed or stored by these
  scripts. Copy it straight from the Supabase dashboard into Vercel.
