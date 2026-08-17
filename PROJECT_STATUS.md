# AiraAI project status

Production: https://aira-ai-live.vercel.app

Repository: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai

Desktop 1.0 release: https://github.com/rajpunkeshwarrajgautam-boop/aira-ai/releases/tag/aira-desktop-v1.0.0

## Completed and verified

- Perplexity-style research UI, Exa retrieval, citations, presets, quotas, analytics, conversations, history, and public share pages are deployed.
- Google/GitHub Auth.js uses the canonical production origin. Guest access to `/agents` and `/admin/analytics` redirects to sign-in with the correct callback path.
- NVIDIA answer generation is restored. A genuine production search returns HTTP 200, four Exa sources, streamed NVIDIA output, numbered citations, and a terminal completion event.
- The Supabase production project is healthy. The `AgentRun` migration is applied, all 15 public application tables have RLS enabled, and the security advisor has zero findings.
- The dual-host self-hosted AutoGPT implementation is merged in PR #34. It packages an Ubuntu VPS primary and Windows/Cloudflare Tunnel standby, authenticated runner adapters, health-based pre-submission failover, host-pinned polling, NVIDIA proxying, idempotency, and restricted Classic capabilities.
- AutoGPT runner contract tests, both Docker Compose deployment profiles, the authenticated adapter image build, application quality gates, and the production Vercel deployment pass.
- AIRA Desktop 1.0 is released for Windows with a validated NSIS installer, automatic-update manifest, policy tests, and a GitHub release workflow.
- Production is READY at commit `53774dab819617fb4e1a7d5f15f63fdad2df4c4b`.

## Remaining external activation gates

1. **Rotate the NVIDIA credential:** replace the credential that was shared outside the deployment secret store before installing either runner. Store the replacement only in Vercel and each host's local ignored `.env`; never commit or paste it into project documentation.
2. **Ubuntu VPS primary:** provide a VPS with a public IPv4 address, a DNS hostname pointing to it, and TCP ports 80/443 reachable. Run `infra/autogpt-runner/scripts/provision-vps.sh`, then retain the printed primary base URL and runner key.
3. **Windows standby:** create a Cloudflare Tunnel hostname targeting `http://adapter:8080`. Run `infra/autogpt-runner/scripts/setup-windows.ps1`, then retain the printed secondary base URL and runner key.
4. **Preview activation:** add both hosts' `AUTOGPT_* ` values to Vercel Preview while keeping `AUTOGPT_AGENT_ENABLED=false`. Verify authenticated health for both hosts, enable Preview, complete one Pro/Team task, stop the primary briefly, and confirm a new task fails over to Windows without duplicate submission.
5. **Production activation:** copy the verified host values to Production, set `AUTOGPT_AGENT_ENABLED=true`, deploy, and complete one production execution through persistence and quota accounting.
6. **Cashfree:** commercial activation remains intentionally deferred by the project owner.

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
