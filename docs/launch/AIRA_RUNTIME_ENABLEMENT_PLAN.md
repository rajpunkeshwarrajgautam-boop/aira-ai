# AIRA Runtime Enablement Plan

Status: launch-candidate planning only. No runtime infrastructure was provisioned and no production configuration was changed.

## Current truth

AIRA's web application is the control plane. Managed autonomous work requires a durable execution plane outside the Vercel request lifecycle. The current Preview has no autonomous runtime reporting `ready=true`, so Work execution, Build execution, and Swarms must remain truthfully gated.

Runtime priority defaults to `DEERFLOW,AUTOGPT,AGENT_SWARM`; selection is allowed only when a runtime reports ready.

## Options

### 1. Agent Swarm — recommended first deployment

**Fit:** Best fit for the current Ultimate Platform architecture. The adapter exposes the broadest current control contract: task graph, spawn-agent, events, artifacts, cancel, pause, resume, and steer.

**Required deployment settings**
- `AGENT_SWARM_ENABLED=true`
- `AGENT_SWARM_BASE_URL=<HTTPS execution service>`
- `AGENT_SWARM_API_TOKEN=<server-only bearer token>`
- optional model tier and timeout controls

**Execution host:** Dedicated durable Linux/Docker service is the intended topology. The workers must outlive frontend requests and retain durable task/worker state.

**Security boundary:** AIRA sends bounded authenticated HTTP requests. The bearer token must remain server-only; the execution endpoint must use HTTPS outside loopback. Worker compromise must not grant direct Vercel or production-database credentials.

**Cost:** $0 incremental software/hosting cost if deployed on an already-owned suitable Linux/Docker host. A cloud VPS would add provider-dependent infrastructure cost and therefore requires user approval before provisioning.

**Windows:** Development can be coordinated from Windows, but a dedicated Linux/Docker execution host is the lower-risk production topology.

### 2. DeerFlow — second choice

**Fit:** Good when a compatible DeerFlow SuperAgent Gateway already exists. It has live health verification and supports long-horizon agent execution/artifacts, but exposes fewer runtime controls than Agent Swarm.

**Required deployment settings**
- `DEERFLOW_AGENT_ENABLED=true`
- `DEERFLOW_API_BASE_URL=<HTTPS gateway>`
- `DEERFLOW_INTERNAL_AUTH_TOKEN=<server-only token>`
- optional model/thinking/plan/timeout settings

**Execution host:** External durable DeerFlow gateway/worker service.

**Security boundary:** HTTPS is required in production; credentials, query strings, and fragments are rejected in the configured base URL.

**Cost:** $0 incremental if an existing compatible self-hosted gateway is available; otherwise infrastructure/provider cost depends on the chosen host and requires approval.

### 3. AutoGPT — third choice

**Fit:** Supported fallback, but operationally heavier for a launch runtime because configuration is graph-specific and production requires two distinct runner targets.

**Required deployment settings**
- `AUTOGPT_AGENT_ENABLED=true`
- primary API URL/key
- graph ID, graph version, input node ID
- production: distinct secondary URL/key
- optionally the full AIRA foundation control-plane/sandbox stack when `AUTOGPT_REQUIRE_FOUNDATION_STACK=true`

**Execution host:** One or two external AutoGPT runner services; production code requires two distinct targets.

**Security/operations:** More credentials and deployment components than the other two options. This increases launch-time operational complexity and failover surface.

**Cost:** potentially $0 incremental with existing self-hosted runners; otherwise two production targets can increase infrastructure cost.

## Recommendation

Use **Agent Swarm** as the first real autonomous execution plane, initially Preview-only and last in routing priority. Keep Work/Build/Swarms capability-gated until a canary proves the runtime is actually ready.

Rollout sequence:
1. User supplies or approves a durable Linux/Docker execution host. Do not provision paid infrastructure implicitly.
2. Deploy Agent Swarm independently from Vercel with durable task/worker storage.
3. Generate a dedicated server-only bearer token outside chat.
4. Configure Preview-only `AGENT_SWARM_BASE_URL` and `AGENT_SWARM_API_TOKEN`; set `AGENT_SWARM_ENABLED=true` only in Preview.
5. Verify health from the AIRA server environment.
6. Run an explicit `provider=AGENT_SWARM` harmless canary.
7. Verify create/status/refresh/cancel, idempotency, quota behavior, task graph, and artifact persistence.
8. Only after the canary passes should runtime priority or Production configuration be considered.

## User action required

Choose one of these boundaries:
- provide/approve an **existing Linux/Docker host** for Preview Agent Swarm (preferred, no paid provisioning by AIRA), or
- explicitly authorize selection/provisioning of a paid execution host.

Do not send runtime tokens or credentials in chat. Configure them directly in the execution host/Vercel secret UI or authenticated CLI.
