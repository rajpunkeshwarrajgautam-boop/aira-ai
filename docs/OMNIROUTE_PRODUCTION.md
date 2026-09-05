# AIRA OmniRoute Production Runbook

## Purpose

OmniRoute is AIRA's universal inference gateway. AIRA remains responsible for user authentication, research retrieval, citations, memory policy, publication validation, safety, residency policy, provider health and gateway-level failover. OmniRoute is responsible for translating and routing inference requests across its configured model/provider/account fleet.

## Architecture

```text
User
  ↓
AIRA AI on Vercel
  ↓
AIRA ProviderRouter
  ├─ safety / publication / residency / circuit breaker
  ↓
Public HTTPS OmniRoute /v1
  ↓
OmniRoute provider + account + quota routing
  ↓
OpenAI / Anthropic / Gemini / NVIDIA / Groq / DeepSeek /
Kimi / GLM / MiniMax / other OmniRoute-supported backends
```

The production AIRA deployment must never point at `127.0.0.1`, `localhost`, a LAN address, or an unauthenticated tunnel. Vercel cannot reach a user's Windows loopback service.

## AIRA environment variables

Server-only values:

```dotenv
OMNIROUTE_ENABLED=true
OMNIROUTE_BASE_URL=https://<public-omniroute-host>/v1
OMNIROUTE_API_KEY=<endpoint-api-key>
OMNIROUTE_MODEL=auto
OMNIROUTE_TIMEOUT_MS=45000
DEFAULT_PRO_PROVIDER=omniroute
DEFAULT_FREE_PROVIDER=nvidia
```

Rules:

- Never prefix the API key with `NEXT_PUBLIC_`.
- Never commit the API key.
- Production gateway URLs must use HTTPS.
- URLs containing embedded credentials, query strings, fragments, or unexpected paths are rejected.
- AIRA normalizes either the gateway origin or `/v1` form to exactly one `/v1` API root.
- OmniRoute is disabled by default in `.env.example`.

## Local development

A local AIRA process may use an OmniRoute instance on loopback:

```dotenv
NODE_ENV=development
OMNIROUTE_ENABLED=true
OMNIROUTE_BASE_URL=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=<local-endpoint-key>
OMNIROUTE_MODEL=auto
OMNIROUTE_TIMEOUT_MS=45000
DEFAULT_PRO_PROVIDER=omniroute
```

Plain HTTP is accepted only for `localhost`, `127.0.0.1`, or IPv6 loopback outside production.

## Recommended production OmniRoute deployment

The upstream OmniRoute project includes Docker and Fly.io deployment support. A persistent public deployment is preferred over exposing a desktop machine.

Production requirements:

- HTTPS endpoint
- persistent volume mounted at `/data`
- `DATA_DIR=/data`
- strong `API_KEY_SECRET`
- strong `JWT_SECRET`
- strong `MACHINE_ID_SALT`
- strong `STORAGE_ENCRYPTION_KEY`
- production WebSocket bridge secret when required by the deployed OmniRoute version
- non-default administrator password
- `NEXT_PUBLIC_BASE_URL` set to the deployment's canonical HTTPS origin
- provider OAuth callbacks registered to the same canonical origin when OAuth providers are used

Do not reuse secrets from another application and do not leave the upstream default password in production.

### Windows deployment bootstrap

AIRA includes `infra/omniroute/deploy-fly.ps1`. It is designed to run from an operator's Windows PowerShell session after `flyctl` is installed. It:

- stops before changing anything if Fly.io authentication is missing
- resolves the latest published immutable OmniRoute GitHub release instead of deploying a moving branch
- clones that release into a temporary work directory
- creates/uses the requested Fly app
- creates a persistent `data` volume when needed
- generates fresh cryptographically secure application secrets locally
- sets a non-default administrator password
- deploys the selected immutable release
- verifies Fly status and the public HTTPS endpoint
- prints the generated administrator password once so it can be stored in a password manager

Run:

```powershell
flyctl auth login
.\infra\omniroute\deploy-fly.ps1 -AppName <globally-unique-fly-app-name> -Region sin
```

The deployment script is syntax-checked on a Windows GitHub Actions runner by the `OmniRoute Operator Contracts` workflow, which also rejects credential-shaped literals committed under `infra/omniroute`.

### Manual Fly.io operator sequence

If the bootstrap script cannot be used, authenticate with Fly.io, create a unique app, create a persistent volume named `data`, mount it at `/data`, generate fresh secrets, set `DATA_DIR=/data`, set the canonical `NEXT_PUBLIC_BASE_URL`, then deploy and verify:

```powershell
flyctl auth login
flyctl status -a <unique-omniroute-app-name>
flyctl logs --no-tail -a <unique-omniroute-app-name>
```

Verify the service responds over HTTPS and that restart/redeploy preserves both the database and server configuration under `/data`.

## Create the AIRA endpoint key

After the OmniRoute dashboard is secured:

1. Create a dedicated API key for AIRA rather than reusing the OmniRoute administrator password.
2. Give it only the scopes/connection permissions AIRA requires.
3. Store the value only in the AIRA Vercel project's encrypted environment variables.
4. Confirm the key can call `GET /v1/models` and `POST /v1/chat/completions`.
5. Rotate the key if it is ever exposed in logs, screenshots, chat, or source control.

## Vercel configuration

Project: `aira-ai-live`.

AIRA includes `infra/omniroute/set-aira-vercel-env.ps1` for Windows operators. It requires an authenticated Vercel CLI and a checkout linked to the existing `aira-ai-live` project. The endpoint key is entered through a secure prompt and is recreated as a Vercel **Sensitive** environment variable, so the helper never prints it.

Example for Preview validation:

```powershell
vercel login
vercel link
.\infra\omniroute\set-aira-vercel-env.ps1 -BaseUrl https://<your-omniroute-app>.fly.dev/v1 -Target preview
```

After Preview succeeds, apply the same dedicated endpoint key to Production:

```powershell
.\infra\omniroute\set-aira-vercel-env.ps1 -BaseUrl https://<your-omniroute-app>.fly.dev/v1 -Target production
```

The helper applies exactly:

- `OMNIROUTE_ENABLED=true`
- `OMNIROUTE_BASE_URL=https://<gateway>/v1`
- `OMNIROUTE_API_KEY=<secure prompt>` as a Vercel Sensitive variable
- `OMNIROUTE_MODEL=auto`
- `OMNIROUTE_TIMEOUT_MS=45000`
- `DEFAULT_PRO_PROVIDER=omniroute`
- `DEFAULT_FREE_PROVIDER=nvidia`

Redeploy after environment changes; existing deployments do not automatically receive newly added values.

A production deployment is considered connected only when the authenticated `/omniroute` workspace reports a successful server-side model-registry check. A green build alone does not prove live gateway connectivity.

## Routing modes

AIRA exposes these OmniRoute routing selections:

- `auto` — balanced routing
- `auto/smart` — quality-oriented routing
- `auto/coding` — coding-oriented routing
- `auto/fast` — latency-oriented routing
- `auto/cheap` — cost-oriented routing
- `auto/offline` — capacity/availability-oriented routing
- any exact model ID currently returned by the live `/v1/models` registry

The control-center selection is session-local unless AIRA later adds a reviewed user-setting persistence mechanism.

## Model comparison

The Compare workspace supports two or three independent targets. Multiple targets may use OmniRoute simultaneously, for example:

```text
Column A: OmniRoute / auto/smart
Column B: OmniRoute / auto/fast
Column C: OmniRoute / <one discovered model ID>
```

Fixed OmniRoute model selections are checked against the live registry before inference. One failed target does not invalidate other columns.

## Agent boundary

AIRA's in-app research orchestrator uses the same `ProviderRouter`, so its planning and generation calls inherit OmniRoute automatically. AutoGPT and DeerFlow remain independent execution runtimes with their existing persistence, cancellation, sandbox and runner boundaries; they are not rewritten merely to force them through OmniRoute.

## Failover responsibility boundary

### AIRA failover

AIRA handles gateway-level availability and policy:

- OmniRoute gateway unreachable
- gateway authentication/configuration failure
- provider circuit open
- active data-residency policy disallows a provider

The configured AIRA fallback is NVIDIA.

### OmniRoute failover

OmniRoute handles routing inside the gateway:

- model selection
- provider translation
- account selection
- provider/account quota
- routing-combo strategy
- internal fallback among eligible connections

The OpenAI SDK retry layer is disabled for OmniRoute in AIRA. This avoids multiplying OmniRoute's internal fallback with SDK retries and AIRA's own gateway fallback.

## Security model

- OmniRoute credentials are server-only.
- `/api/omniroute/status`, `/api/omniroute/models`, and `/api/omniroute/test` require an authenticated AIRA session.
- The live test endpoint is input/output safety checked, response-size bounded, model-selection validated, and rate-limited.
- Model-registry responses are size bounded and malformed entries are ignored or rejected safely.
- Upstream response bodies are not reflected to the browser on failures.
- The gateway URL is deployment configuration, never request-controlled user input.
- Production redirects during model discovery are rejected.
- Structured inference logs contain provider/model/latency/status metadata but not prompts or API keys.
- `OMNIROUTE_API_KEY` is written to Vercel as a Sensitive variable by the supplied Windows helper.

## Migration

Previous architecture:

```text
AIRA → direct local llama.cpp runtime
```

Current architecture:

```text
AIRA → OmniRoute → supported upstream or operator-managed inference backend
```

The legacy `/local-ai` web route remains only as a compatibility redirect to `/omniroute`. The previous browser bridge, direct local runtime APIs, local business workers and startup/test scripts are retired.

## Production verification

After AIRA has the real public gateway URL and endpoint key:

1. Redeploy AIRA Preview.
2. Sign in to the preview AIRA site.
3. Open `/omniroute`.
4. Confirm status is `Connected`.
5. Confirm the gateway hostname is correct.
6. Confirm real models load from `/v1/models`.
7. Test `auto`.
8. Test `auto/smart`.
9. Test `auto/coding`.
10. Test one exact discovered model.
11. Send a normal AIRA chat request and confirm streaming output.
12. Run a grounded research query and verify citations still pass publication checks.
13. Compare multiple OmniRoute modes/models.
14. Run an AIRA in-app research/agent workflow and confirm provider routing works.
15. Verify AutoGPT and DeerFlow runner flows remain unchanged and healthy.
16. Inspect browser network responses and server logs for accidental credentials.
17. Test desktop, tablet and mobile viewports.
18. Only after Preview succeeds, apply the same configuration to Production and redeploy.

## Troubleshooting

### `Disabled`

`OMNIROUTE_ENABLED` is not `true` in the active Vercel deployment environment.

### `Not configured`

The gateway URL/key is missing or the gateway URL failed validation. Check Vercel Production/Preview scoping and redeploy.

### `Unreachable`

AIRA has configuration but cannot complete the authenticated model-registry request. Check DNS, TLS, Fly machine health, endpoint-key permissions and OmniRoute logs.

### HTTP 401/403 from OmniRoute

Rotate or correct the dedicated AIRA endpoint key. Do not expose the key in a browser response while debugging.

### HTTP 429

Check OmniRoute connection/provider quota and routing policy. Avoid adding client retries; OmniRoute and AIRA already own the intended fallback layers.

### Timeout

Check gateway/provider latency and `OMNIROUTE_TIMEOUT_MS`. The accepted range is bounded by AIRA; increasing it should be a deliberate operational decision, not a substitute for fixing an unhealthy route.

### Model unavailable

Refresh `/omniroute`. Fixed model IDs must still exist in the current live registry. Prefer an automatic routing mode when providers/models change frequently.
