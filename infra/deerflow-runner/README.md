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
- Redis (included in upstream Compose)
- Postgres for concurrent production workloads
- TLS hostname dedicated to the Gateway/front door
- strong `DEER_FLOW_INTERNAL_AUTH_TOKEN`
- at least one configured LLM
- container-based sandboxing; prefer the Kubernetes provisioner for strong multi-user isolation
- firewall rules that do not expose raw Gateway/Redis/Postgres ports to the Internet

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

Do not set `DEERFLOW_AGENT_ENABLED=true` in AIRA until all of these pass:

```bash
# On DeerFlow host
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:2026/api/models

docker compose -p deer-flow -f /opt/aira/deer-flow/docker/docker-compose.yaml ps
```

Then verify from an external trusted machine through TLS:

```bash
curl -fsS https://deerflow.example.com/health
```

Finally enable the AIRA variables and run a real signed-in task from `/agents`. A successful activation requires:

- AIRA reports `DeerFlow 2.0 SuperAgent` as ready;
- the task reaches `COMPLETED`;
- the final answer is returned to AIRA;
- a task that writes `/mnt/user-data/outputs` surfaces artifact metadata;
- Stop Task interrupts a running DeerFlow job;
- another AIRA user cannot read or cancel the first user's task;
- a simulated DeerFlow outage makes AIRA fail closed or use the configured AutoGPT fallback;
- no DeerFlow token or model key appears in browser/network payloads.

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
