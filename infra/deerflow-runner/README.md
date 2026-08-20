# AIRA DeerFlow SuperAgent Runtime

AIRA uses ByteDance DeerFlow 2.0 as a **separate long-running execution plane**. The AIRA web app remains on Vercel; DeerFlow runs on a persistent Linux/Docker host and is called only from AIRA server routes.

## Upstream pin

Validated upstream repository:

- Repository: `bytedance/deer-flow`
- Revision: `a5acc25de6742b2166b3f41c97bd895822277b94`
- License: MIT

Pinning the revision prevents an unattended upstream change from altering AIRA's autonomous execution contract. Upgrade the pin only after API, sandbox, auth and end-to-end tests pass again.

## Architecture

```text
Browser
  |
  v
AIRA AI (Vercel / Auth.js / billing / safety / control-plane admission)
  |
  | HTTPS + X-DeerFlow-Internal-Token + X-DeerFlow-Owner-User-Id
  v
TLS front door on DeerFlow host
  |
  v
DeerFlow Gateway (FastAPI, :8001 internally)
  |-- Redis stream bridge
  |-- Postgres in multi-user production
  |-- skills / MCP / tools / memory
  `-- isolated sandbox runtime
```

Do **not** put the DeerFlow internal token in browser code, public environment variables, URLs, logs, or committed files.

## What AIRA integrates

The AIRA adapter uses DeerFlow's native Gateway API to:

1. create an owner-scoped thread;
2. submit a long-running background run;
3. enable plan mode / optional thinking / configured model selection;
4. poll run state without holding a Vercel request open;
5. map DeerFlow lifecycle states into AIRA `AgentRun` states;
6. return the final assistant result, token accounting and artifact metadata;
7. interrupt active DeerFlow runs through AIRA;
8. preserve AIRA auth, quota, safety and capacity gates in front of every task.

DeerFlow remains the execution engine for its subagents, skills, memory, MCP tools, filesystem tools and sandbox behavior. AIRA does not fork or duplicate that logic.

## Production prerequisites

Use a dedicated Linux host or cluster. DeerFlow's own production guide recommends containerized deployment and warns against SQLite for concurrent users. For a public multi-user AIRA deployment:

- Docker Engine + Docker Compose plugin
- persistent storage for `DEER_FLOW_HOME`
- Redis — included in upstream Compose as the `redis` service, publishing no host port
- Postgres for concurrent production workloads — **not** a Compose service; see
  "Postgres" below, because it must be provisioned and wired up separately
- TLS hostname dedicated to the Gateway/front door
- strong `DEER_FLOW_INTERNAL_AUTH_TOKEN`
- at least one configured LLM
- container-based sandboxing; prefer the Kubernetes provisioner for strong multi-user isolation
- firewall rules that do not expose raw Gateway/Redis/Postgres ports to the Internet

Upstream's production Compose publishes exactly one host port: nginx on
`${BIND_HOST:-127.0.0.1}:${PORT:-2026}`. The Gateway's own port 8001 is reachable only
inside the Compose network, and `redis` publishes nothing. Keep it that way and put the
TLS front door in front of nginx. A consequence worth knowing before debugging a
deployment: `curl http://127.0.0.1:8001/health` on the host fails even when the stack is
perfectly healthy. Probe `http://127.0.0.1:2026/health` instead, and read the Gateway's
own 8001 probe with `docker inspect --format '{{.State.Health.Status}}' deer-flow-gateway`.

### Postgres

`docker/docker-compose.yaml` contains `redis`, `nginx`, `frontend`, `gateway` and an
optional `provisioner` — there is no `postgres` service, and DeerFlow defaults to SQLite,
which upstream warns against for concurrent users. For multi-user AIRA production,
provision Postgres yourself (managed instance or a separate container), then:

1. put the connection URL in the DeerFlow `.env` as `DATABASE_URL` (never in `config.yaml`);
2. in `config.yaml`, set the `database` section to `backend: postgres` and reference the
   env var rather than a literal: `connection_string: $DATABASE_URL`;
3. build the Gateway image with the Postgres extra, via the `UV_EXTRAS` build arg the
   Compose file already forwards (for example `UV_EXTRAS=postgres`).

Restrict the database to the DeerFlow host; it must not be reachable from the Internet.

### API docs are exposed by default

`GATEWAY_ENABLE_DOCS` defaults to **`true`** upstream, `/docs`, `/redoc` and
`/openapi.json` are in the Gateway's unauthenticated path list, and nginx proxies all
three. That one variable is the only thing keeping the full API schema private, so
`GATEWAY_ENABLE_DOCS=false` is load-bearing rather than cosmetic. The bootstrap script
writes it, and both verification modes now assert it took effect.

### Sandbox: E2B, not the Docker socket

Upstream ships several sandbox providers. Use
`deerflow.community.e2b_sandbox:E2BSandboxProvider`, which exists at the pinned
revision and runs agent code off the host entirely. Do **not** use the
Docker-socket (DooD/aio) mode for public multi-user AIRA: it gives the Gateway
root-equivalent control of the host.

`config.production.example.yaml` in this directory carries the verified E2B block,
including Redis-backed ownership so the `replicas` concurrency cap holds across
workers and orphaned sandboxes are reconciled rather than leaked. The provider
reads `sandbox.api_key`, falling back to the `E2B_API_KEY` environment variable.

### Complete first-run setup before the host is reachable

Upstream binds nginx to loopback precisely because the agent can execute commands. Set
`BIND_HOST=0.0.0.0`, or open the TLS front door, only after first-run setup has been
completed and an owner account exists — otherwise the first party to reach the host can
claim it.

The upstream Docker-socket (DooD/AIO) mode gives the Gateway root-equivalent control of the Docker host. Do not use that mode for untrusted public multi-user traffic without accepting that risk. Prefer the Kubernetes provisioner or another reviewed remote sandbox provider.

## AIRA environment

Set these **server-only** variables in AIRA after the DeerFlow host passes verification:

```bash
DEERFLOW_AGENT_ENABLED=true
DEERFLOW_API_BASE_URL=https://deerflow.example.com
DEERFLOW_INTERNAL_AUTH_TOKEN=<same value as DEER_FLOW_INTERNAL_AUTH_TOKEN on DeerFlow>
DEERFLOW_MODEL_NAME=<optional model name from DeerFlow config.yaml>
DEERFLOW_THINKING_ENABLED=false
DEERFLOW_PLAN_MODE=true
DEERFLOW_REQUEST_TIMEOUT_MS=15000
DEERFLOW_HEALTH_TIMEOUT_MS=2500
```

`DEERFLOW_API_BASE_URL` must be HTTPS in production. AIRA probes `${DEERFLOW_API_BASE_URL}/health` before preferring DeerFlow for new jobs. If DeerFlow is unhealthy and the hardened AutoGPT fallback is configured, AIRA can fall back; otherwise new autonomous work fails closed.

## DeerFlow host environment

At minimum, DeerFlow itself needs its model-provider credentials and internal auth token. Example names only:

```bash
DEER_FLOW_INTERNAL_AUTH_TOKEN=<random high-entropy secret>
BETTER_AUTH_SECRET=<random high-entropy secret>
DEER_FLOW_HOME=/var/lib/deer-flow
GATEWAY_ENABLE_DOCS=false
```

Model credentials depend on `config.yaml`. Keep them only on the DeerFlow host. DeerFlow supports environment-variable substitution in `config.yaml`, so use `$VARIABLE_NAME` references instead of literal secrets.

## Provisioning the host

`terraform/` provisions the droplet, its firewall, and a managed PostgreSQL
cluster restricted to that droplet. See `terraform/README.md`. It has not been
applied against a live account — no DigitalOcean authorization has been granted —
so read `terraform plan` before the first apply.

### Expected monthly baseline

List prices for the default module variables, to confirm against DigitalOcean's
current pricing page before applying:

| Item | Spec | Approx. USD/month |
| --- | --- | --- |
| Droplet | `s-4vcpu-8gb`, blr1 | ~48 |
| Managed PostgreSQL | `db-s-1vcpu-1gb`, 1 node, blr1 | ~15 |
| Droplet backups (optional) | 20% of droplet | ~10 |
| **DigitalOcean subtotal** | | **~63–73** |

Usage-based, billed separately and not created by Terraform:

- **E2B sandboxes** — per sandbox-second. `replicas: 3` caps concurrency; the
  dominant cost driver is how long agent tasks run, not how many start.
- **Model provider** — per token, on whatever account supplies the credential.

There is no GPU, load balancer, or Kubernetes cluster in this design: the model
provider and the sandbox are both external services.

## Bootstrap

From a checked-out AIRA repository on the target Linux host:

```bash
sudo bash infra/deerflow-runner/scripts/provision-vps.sh
```

The script installs/validates host prerequisites, clones the pinned DeerFlow revision, creates persistent runtime directories, seeds configuration files, generates internal secrets if they do not already exist, and leaves the stack **disabled** if no reviewed model configuration exists.

Then configure the model, database and sandbox mode in:

```text
/opt/aira/deer-flow/config.yaml
```

The upstream production stack can then be built and started from `/opt/aira/deer-flow`:

```bash
make up
```

By default upstream nginx binds to loopback. Keep it that way and put a TLS reverse proxy in front of it rather than publishing port 2026 directly.

## Verification gate

Do not set `DEERFLOW_AGENT_ENABLED=true` in AIRA until all of these pass.

### 1. Infrastructure checks (one command)

`verify-deployment.sh` implements this gate so the result is reproducible rather
than a judgement call. Every check is a read; the script changes nothing and never
prints a secret value. It exits non-zero if any check fails.

On the DeerFlow host:

```bash
sudo bash infra/deerflow-runner/scripts/verify-deployment.sh --host
```

This confirms the checkout is at the validated pin, `config.yaml` holds no literal
API key, `.env` is mode 600 with docs disabled and a loopback bind, the internal
auth token meets the minimum length, the state root is mode 700, all Compose
services are running, and both the Gateway health and models endpoints answer.

From a trusted machine outside the host, through TLS:

```bash
bash infra/deerflow-runner/scripts/verify-deployment.sh --public https://deerflow.example.com
```

This confirms the base URL is a bare HTTPS origin AIRA will accept, public
`/health` answers, `/docs`, `/redoc` and `/openapi.json` are not served, an
unauthenticated caller cannot reach `/api/threads`, and ports 2026, 8001, 6379 and
5432 are not reachable from the Internet.

The script's own logic is covered by `--self-test`, which CI runs on every change
along with a check that `--host` still fails closed when no host is present.

### 2. End-to-end checks

Infrastructure checks are necessary but not sufficient. Enable the AIRA variables
in Preview first and run a real signed-in task from `/agents`. A successful
activation requires:

- AIRA reports `DeerFlow 2.0 SuperAgent` as ready;
- the task reaches `COMPLETED`;
- the final answer is returned to AIRA;
- a task that writes `/mnt/user-data/outputs` surfaces artifact metadata;
- Stop Task interrupts a running DeerFlow job;
- another AIRA user cannot read or cancel the first user's task;
- a simulated DeerFlow outage makes AIRA fail closed or use the configured AutoGPT fallback;
- no DeerFlow token or model key appears in browser/network payloads.

## Rollback

DeerFlow activation is a configuration change in AIRA, not a code change, so
rollback does not require a redeploy of the application code.

**Fastest rollback — stop routing work to DeerFlow.** Set
`DEERFLOW_AGENT_ENABLED=false` in the affected Vercel environment and redeploy
that environment. AIRA immediately stops selecting DeerFlow for new jobs. If the
hardened AutoGPT fallback is configured it takes new work; otherwise new
autonomous tasks fail closed with a clear message. This is safe at any time:
already-running DeerFlow work is never migrated to another provider, and runs
that can no longer be polled are closed by AIRA's stale-run reconciliation rather
than spinning in the workspace.

**Rolling back a bad host change.** The AIRA variables can keep pointing at the
host while you repair it, because AIRA probes `/health` before preferring
DeerFlow and will not select an unhealthy runtime. To restore the previous
container state:

```bash
cd /opt/aira/deer-flow
docker compose -p deer-flow -f docker/docker-compose.yaml down
git -C /opt/aira/deer-flow checkout --detach --force a5acc25de6742b2166b3f41c97bd895822277b94
make up
sudo bash infra/deerflow-runner/scripts/verify-deployment.sh --host
```

`DEER_FLOW_HOME` (`/var/lib/deer-flow` by default) holds thread state and is not
touched by `down` without `-v`. Do not pass `-v`: it destroys persisted threads
and artifacts.

**Rotating the internal token.** Set a new value in the host `.env` and in the
AIRA environment, then restart the stack and redeploy AIRA. Rotate in that order
so the window where the two disagree only causes health-check failures, which
fail closed, rather than unauthenticated acceptance.

## Verified contract conformance

Checked on 20 August 2026 by fetching pinned revision `a5acc25d` and reading the Gateway
source directly. `git ls-remote` confirmed the pin is a real, fetchable commit and is
currently upstream `HEAD`. Everything AIRA's adapter depends on is present and matches:

| AIRA adapter expects | Upstream at `a5acc25d` |
| --- | --- |
| `POST /api/threads` | `routers/threads.py`, `APIRouter(prefix="/api/threads")` |
| `POST /api/threads/{id}/runs` | `routers/thread_runs.py`, same prefix, returns `RunResponse` |
| `GET /api/threads/{id}/runs/{runId}` | present |
| `POST .../cancel?action=interrupt` | present; `action: Literal["interrupt","rollback"]`, default `interrupt` |
| `GET /api/threads/{id}/state` | present, returns `ThreadStateResponse` |
| `GET /api/threads/{id}/artifacts/{path}?download=true` | `routers/artifacts.py`, `APIRouter(prefix="/api")`, `{path:path}`, `download: bool = False` |
| artifact paths under `mnt/user-data/outputs/` | matches upstream's own `_EDITABLE_OUTPUTS_PREFIX` |
| `GET /health`, unauthenticated | present, and in the auth middleware's public prefix list |
| `X-DeerFlow-Internal-Token`, `X-DeerFlow-Owner-User-Id` | both in `gateway/internal_auth.py` |
| token fields on the run record | `total_input_tokens`, `total_output_tokens`, `total_tokens`, `llm_call_count`, `lead_agent_tokens`, `subagent_tokens`, `middleware_tokens`, `stop_reason` — all present, exactly named |
| statuses `pending`/`running`/`success`/`interrupted`/`error`/`timeout` | `RunStatus` declares exactly these six; AIRA's mapper covers all of them |
| context flags `non_interactive`, `disable_clarification`, `is_plan_mode`, `thinking_enabled`, `model_name`, `recursion_limit`, `if_not_exists` | all present in `gateway/services.py` |
| `multitask_strategy: "reject"` | upstream's own default on `RunResponse` |

Upstream additionally enforces ownership server-side: the artifact and cancel routes carry
`@require_permission(..., owner_check=True)`. That is defence in depth behind AIRA's own
ownership check, not a replacement for it.

Re-run this comparison whenever the pin moves; it is the cheapest way to catch a breaking
API change before it reaches a deployment.

## Upgrade procedure

1. Review upstream changes from the pinned commit to the candidate commit.
2. Re-check internal auth headers, thread/run routes, run statuses, artifact contract, sandbox behavior and deployment schema.
3. Test the candidate in a non-production DeerFlow host.
4. Run AIRA CI and Vercel Preview.
5. Run end-to-end submit/poll/cancel/artifact/ownership/failover tests.
6. Update the pin only after all gates pass.

## Status language

Repository integration code is not evidence that DeerFlow is running. Keep these states distinct:

- **integrated** — AIRA code can speak DeerFlow's API;
- **deployed** — a real DeerFlow host is running;
- **configured** — AIRA server secrets point to that host;
- **verified** — health + real task + ownership + cancellation + failure tests passed;
- **production active** — `DEERFLOW_AGENT_ENABLED=true` after verification.
