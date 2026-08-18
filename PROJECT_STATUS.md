# AiraAI project status

Production: https://aira-ai-live.vercel.app

Repository: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai

Desktop 1.0 release: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/releases/tag/aira-desktop-v1.0.0

## Completed and verified

- Perplexity-style research UI, Exa retrieval, citations, presets, quotas, analytics, conversations, history, and public share pages are deployed.
- Google/GitHub Auth.js uses the canonical production origin. Guest access to `/agents` and `/admin/analytics` redirects to sign-in with the correct callback path.
- NVIDIA answer generation is restored and the replacement NVIDIA credential is installed in Vercel Production and Preview.
- The Supabase production project is healthy. The `AgentRun` migration is applied, all 15 public application tables have RLS enabled, and the security advisor has zero findings.
- The dual-host self-hosted AutoGPT implementation is merged. It packages an Ubuntu VPS primary and Windows/Cloudflare Tunnel standby, authenticated runner adapters, health-based pre-submission failover, host-pinned polling, NVIDIA proxying, idempotency, and restricted Classic capabilities.
- PR #36 fixes AutoGPT container startup, multi-step task completion, and swallowed provider-error handling. PR #37 fixes the VPS Caddy route ordering. PR #38 restricts the Windows Cloudflare Tunnel to `/external-api/*` so internal NVIDIA proxy routes remain private.
- GitHub CI is green after PR #39. CI run #69 passes both `quality` and `autogpt-runner`, including the adapter contract tests, both Docker Compose profiles, authenticated adapter image build, production dependency audit, lint, type-check, and application build.
- The production audit has one narrowly scoped temporary exception for `GHSA-ggr8-5vv4-36mx`: Prisma 7.9.1 currently pins `deepmerge-ts` 7.1.5 and no compatible patched 8.x stable release is available. All other production advisories still fail CI. Remove the exception as soon as upstream publishes a compatible patch.
- AIRA Desktop 1.0 is released for Windows with a validated NSIS installer, automatic-update manifest, policy tests, and a GitHub release workflow.
- Vercel Production is READY at commit `42fc63b76e293a09c91dd9575aef2b9fea02920d`.

## Remaining external activation gates

1. **Ubuntu VPS primary:** provide an Ubuntu VPS with a public IPv4 address, a DNS hostname pointing to it, and TCP ports 80/443 reachable. Run `infra/autogpt-runner/scripts/provision-vps.sh`, then retain the printed primary base URL and runner key.
2. **Windows standby:** create a Cloudflare Tunnel public hostname targeting `http://adapter:8080` with path `external-api/*`. Run `infra/autogpt-runner/scripts/setup-windows.ps1`, then retain the printed secondary base URL and runner key. Verify `/internal-ready` and `/internal/v1/models` both return 404 through the public hostname.
3. **Preview activation and failover test:** add both hosts' `AUTOGPT_*` values to Vercel Preview while keeping `AUTOGPT_AGENT_ENABLED=false`. Verify authenticated health for both hosts, enable Preview, complete one Pro/Team task, stop the VPS primary briefly, and confirm a new task fails over to Windows without duplicate submission.
4. **Production activation:** copy the verified host values to Production, set `AUTOGPT_AGENT_ENABLED=true`, deploy, and complete one production execution through persistence and quota accounting.
5. **Cashfree:** commercial activation remains intentionally deferred by the project owner.

## AutoGPT fixed mapping

```text
AUTOGPT_GRAPH_ID=aira-objective-runner
AUTOGPT_GRAPH_VERSION=1
AUTOGPT_INPUT_NODE_ID=objective
AUTOGPT_INPUT_FIELD=value
AUTOGPT_REQUEST_TIMEOUT_MS=15000
AUTOGPT_HEALTH_TIMEOUT_MS=2000
```

Aira probes the VPS and then the Windows standby before a new submission. It submits once to the first healthy target and pins later result polling to that host. Active work is not migrated between hosts, and remote cancellation remains unavailable until the upstream protocol exposes a reliable cancellation contract.
