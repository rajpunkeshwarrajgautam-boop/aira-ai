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

On 20 August 2026 the adapter's contract was checked directly against pinned revision
`a5acc25d`, fetched from upstream: routes, artifact path form, cancel parameters, every
token field, all six run statuses and all seven context flags match. The full comparison
is in `infra/deerflow-runner/README.md`. The integration is therefore contract-correct
against the pin; what is missing is a host to run it on.

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

Vercel environment variables were read directly on 21 August 2026 with an
authenticated `vercel env ls production` against `aira-ai-live`. Production carries
auth, database, Exa, OpenAI, NVIDIA, provider-default and Cashfree variables and
**no** DeerFlow, AutoGPT, foundation, sandbox or Supabase-storage variable. Both
adapters therefore remain fail-closed, and "configured: NO" above is measured rather
than inferred.

### Foundation control plane, knowledge worker and sandbox

| State | Status |
| --- | --- |
| integrated | YES — admission leases, provider circuit breaker, job queue, ingestion callback and sandbox client are merged |
| deployed | NO — no host exists |
| configured | NO — no foundation variable is set in Vercel Production |
| verified | PARTIAL — the contracts are verified, the deployment is not |
| production active | NO |

On 21 August 2026 the foundation services were run directly from this repository's
sources against a local Redis and verified end to end. The control plane refused an
unauthenticated enqueue, issued and released an admission lease, opened a provider
circuit after three transient failures, and accepted, served and acknowledged jobs
with the stream draining to zero. The knowledge worker claimed each job, downloaded
the object, extracted and chunked `text/plain`, `text/markdown`, `application/pdf`
and `.docx`, and posted the `knowledge.ingest` completion callback with contiguous
chunk ordinals and the worker token; an unreachable object produced the `failed`
callback with a useful error instead of a silent drop. The sandbox gateway refused an
unauthenticated caller, executed authenticated code correctly, enforced its
wall-clock timeout, `RLIMIT_AS` memory ceiling and process limit, and rejected
oversized payloads and unknown paths.

That is a contract verification, not a deployment. Supabase is ready — `KnowledgeAsset`
and `KnowledgeChunk` exist with RLS enabled, and the private `aira-knowledge` bucket
carries the matching MIME allowlist and 20 MB limit — but nothing consumes the queue
in production because no host runs the worker.

### Deployment path

`infra/aira-runtime/` is the single entry point that turns all of the above on:

```bash
sudo AIRA_NVIDIA_API_KEY=… AIRA_ACME_EMAIL=… bash infra/aira-runtime/bootstrap.sh
```

It composes the deployment implementations already in this repository, adds the one
piece that was missing — a TLS edge Vercel can reach — generates every secret once
into `/etc/aira/runtime.env`, runs `infra/aira-runtime/verify.sh` as an activation
gate, and writes a ready-to-apply Vercel environment. With no DNS credentials it
derives `sslip.io` hostnames from the host's public IPv4 address, so Let's Encrypt
still issues real certificates. It is idempotent: re-running preserves secrets, so a
configured Vercel project is never invalidated.

## External activation gates

These are the only genuine blockers. Each needs infrastructure that does not exist
yet; none of them can be resolved from inside the repository.

0. **A persistent Linux host.** The single blocker behind gates 1 and 2, and behind
   the foundation stack. `infra/aira-runtime/bootstrap.sh` deploys everything in one
   command once a host exists: roughly 4 GB of RAM covers the foundation stack, the
   sandbox and both AutoGPT runners, and about 8 GB adds DeerFlow. As of 21 August
   2026 no such host is reachable — the operator's machine has no SSH key, no OCI
   credential, no Cloudflare Tunnel and a stopped Docker Desktop, and a Claude Code
   session container cannot substitute for one.

1. **DeerFlow host.** A persistent Linux host, reachable from Vercel over TLS, with
   Docker Engine, the Compose plugin, a Postgres instance (not part of upstream's
   Compose), a dedicated DNS hostname, and a reviewed sandbox provider. Prefer the
   Kubernetes provisioner or another reviewed remote sandbox over the upstream
   Docker-socket mode, which gives the Gateway root-equivalent control of the host.
   Then run the provisioning script, pass both verification modes, complete the
   end-to-end tests in Preview, and only then configure Production.

   This cannot be satisfied from a Claude Code session container: those are ephemeral,
   have no public address, and reach the network only through an egress-filtered proxy
   that accepts no inbound connections. Activation needs a host the operator controls.
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
