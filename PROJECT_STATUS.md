# AIRA AI project status

Last reconciled against the repository and the deployed application on 20 August 2026.

- Production: https://aira-ai-live.vercel.app
- Production commit: `82881013c05feff81792ed47ebce4d6a0364448a` (PR #68, "Production completion pass"), Vercel deployment `dpl_4YRrLc9wcyHjPqk4RpvF35L1XpyZ`, state READY
- Release record: [`docs/PRODUCTION_RELEASE_2026-08-20.md`](docs/PRODUCTION_RELEASE_2026-08-20.md)
- Repository: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai
- Desktop 1.0 release: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/releases/tag/aira-desktop-v1.0.0

This file states what is true, not what is built. Code existing in the repository is
never on its own evidence that a capability is running. For any externally hosted
runtime the five states below are tracked separately:

**integrated** (AIRA can speak the protocol) → **deployed** (a real host is running) →
**configured** (AIRA secrets point at it) → **verified** (health, a real task, ownership,
cancellation and failure tests passed) → **production active**.

## Verified working in production

- Perplexity-style research UI, Exa retrieval, citations, presets, quotas, analytics,
  conversations, history and public share pages.
- Google/GitHub Auth.js on the canonical production origin. Guest access to `/agents`
  and `/admin/analytics` redirects to sign-in with the correct callback path. Session
  cookies are `__Secure-` prefixed, `HttpOnly`, `SameSite=Lax`.
- Security response headers on production: HSTS with `includeSubDomains`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`
  denying camera, microphone and geolocation.
- Unauthenticated API access is refused. `/api/agents/runs` returns
  `401 UNAUTHENTICATED` with `Cache-Control: no-store` and no CORS grant.
- NVIDIA answer generation with the replacement credential installed in Vercel
  Production and Preview.
- AIRA Desktop 1.0 for Windows: validated NSIS installer, automatic-update manifest,
  policy tests and a GitHub release workflow.
- Vercel reported zero runtime errors across the 24 hours before this reconciliation.

## Verified in the repository

These are properties of the committed code, confirmed by reading it and by the
automated suite. They are not claims about external infrastructure.

- The web application has an automated test suite (`pnpm run test`) covering the
  DeerFlow artifact-path defense, the DeerFlow configuration contract, the DeerFlow
  client's error and submission-ambiguity behaviour, the ingress request guard, the
  publication safety gate, agent-run reconciliation bounds and the environment
  contract. It runs on Node's built-in test runner and adds no dependency.
- Every database migration that creates a table also enables row-level security,
  installs a `deny_direct_data_api_access` policy for `anon`/`authenticated`, and
  revokes privileges from `anon`, `authenticated` and `service_role`. The
  `20260815_lock_down_data_api` migration additionally sets `alter default privileges`
  so a table created by a future migration cannot become Data-API-reachable by
  default. Application code scopes every user-owned read and write by `userId`.
- The DeerFlow adapter fails closed. It refuses to activate without an explicit
  `DEERFLOW_AGENT_ENABLED=true`, a base URL and an internal token; it rejects a
  non-HTTPS base URL in production and any URL carrying credentials, a query or a
  fragment; and it never selects a runtime whose health probe fails.
- The internal DeerFlow token is sent only as a request header from server routes.
  It never appears in a URL, in browser-reachable configuration, or in an error
  message returned to a client.
- Artifact downloads are constrained twice: the requested path must normalize into
  the DeerFlow outputs directory with no traversal, empty or dot segments, and it
  must additionally appear in the artifact allowlist recorded on the owner's own
  completed `AgentRun` row.

## Integrated but not active

### DeerFlow 2.0 SuperAgent

| State | Status |
| --- | --- |
| integrated | YES — merged in PR #67, pinned to upstream `a5acc25de6742b2166b3f41c97bd895822277b94` |
| deployed | NO — no DeerFlow host exists |
| configured | NO |
| verified | NO |
| production active | NO |

The adapter, run lifecycle, health-gated routing, cancellation, artifact proxy and
Agent Workspace integration are merged and covered by tests. `DEERFLOW_AGENT_ENABLED`
defaults to `false`, so AIRA fails closed and no user-visible surface claims DeerFlow
is ready.

Provisioning is `infra/deerflow-runner/scripts/provision-vps.sh`; the activation gate
is `infra/deerflow-runner/scripts/verify-deployment.sh`, which must exit zero in both
`--host` and `--public` modes before `DEERFLOW_AGENT_ENABLED=true` is set anywhere.
Infrastructure checks are necessary but not sufficient: the end-to-end task, artifact,
cancellation and cross-user ownership tests in `infra/deerflow-runner/README.md` must
also pass.

### AutoGPT fallback

| State | Status |
| --- | --- |
| integrated | YES — dual-host adapter, health-based pre-submission failover, host-pinned polling, idempotency |
| deployed | NO — neither the Ubuntu VPS primary nor the Windows standby exists |
| configured | NO |
| verified | NO |
| production active | NO |

AutoGPT remains AIRA's fallback autonomous runtime and is intentionally retained.
When DeerFlow is healthy it is preferred; AutoGPT takes new work only when DeerFlow
is unavailable and AutoGPT itself is configured. Remote cancellation is still
unavailable for AutoGPT runs, and the API reports that honestly rather than
pretending a stop succeeded.

### Basis for the runtime statuses above

Vercel environment variables are not readable through the tooling used for this
reconciliation, so "configured" is reported from two facts that are checkable: no
DeerFlow or AutoGPT host has been provisioned, and both adapters fail closed without
one. If an operator has since set these variables in Vercel, update this file --
pointing AIRA at a host that has not passed the verification gate is exactly the
state these tables exist to prevent.

## External activation gates

These are the only genuine blockers. Each needs infrastructure that does not exist
yet; none of them can be resolved from inside the repository.

1. **DeerFlow host.** A persistent Linux host with Docker Engine, the Compose plugin,
   Redis, Postgres, a dedicated TLS hostname, and a reviewed sandbox provider. Prefer
   the Kubernetes provisioner or another reviewed remote sandbox over the upstream
   Docker-socket mode, which gives the Gateway root-equivalent control of the host.
   Then run the provisioning script, pass both verification modes, complete the
   end-to-end tests in Preview, and only then configure Production.
2. **AutoGPT hosts.** An Ubuntu VPS primary with a public IPv4 address and a DNS
   hostname, plus a Windows standby behind a Cloudflare Tunnel restricted to
   `external-api/*`. Verify authenticated health for both, then run a real
   primary-down failover drill before enabling.
3. **Cashfree.** Commercial activation remains intentionally deferred by the project
   owner. Checkout is not presented as working while it is disabled.

## Intentionally disabled

Every capability below is feature-gated off because the infrastructure it depends on
is not proven to exist. A default of `false` is enforced by an automated test, so
none of these can be silently switched on in `.env.example`.

`PYTHON_SANDBOX_ENABLED`, `SEMANTIC_MEMORY_ENABLED`, `GRAPH_MEMORY_ENABLED`,
`MEMORY_CONSOLIDATION_ENABLED`, `MULTIMODAL_INGESTION_ENABLED`,
`ADVANCED_MULTIMODAL_ENABLED`, `FOUNDATION_CONTROL_PLANE_ENABLED`,
`AIRA_SAFETY_GATEWAY_ENABLED`, `AIRA_TRAINING_EXECUTION_APPROVED`.

Offline model training is deliberately not a web feature flag. It runs only on an
approved GPU host for an explicitly reviewed run.

## Dependency audit exception

The production audit carries one narrowly scoped exception for `GHSA-ggr8-5vv4-36mx`:
Prisma 7.9.1 pins `deepmerge-ts` 7.1.5 through `@prisma/config`, and no compatible
patched 8.x stable release is available. Every other production advisory still fails
`pnpm audit --prod`. Remove the exception as soon as upstream publishes a compatible
patch.

## AutoGPT fixed mapping

```text
AUTOGPT_GRAPH_ID=aira-objective-runner
AUTOGPT_GRAPH_VERSION=1
AUTOGPT_INPUT_NODE_ID=objective
AUTOGPT_INPUT_FIELD=value
AUTOGPT_REQUEST_TIMEOUT_MS=15000
AUTOGPT_HEALTH_TIMEOUT_MS=2000
```

AIRA probes the VPS and then the Windows standby before a new submission. It submits
once to the first healthy target and pins later result polling to that host. Active
work is never migrated between hosts.
