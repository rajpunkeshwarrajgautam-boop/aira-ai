# Persistent agent-run reconciler

AIRA's Next.js application already exposes the protected, bounded endpoint:

`POST /api/internal/agents/reconcile`

That endpoint refreshes existing `QUEUED`, `RUNNING`, and `REVIEW` runs only. It does not submit new AutoGPT or DeerFlow work. This directory packages the missing persistent Linux caller without adding a second scheduler or provider execution path.

## Install

First deploy the existing runtime host with `bootstrap.sh`. Then install the reconciler on that same host:

```bash
sudo AIRA_APP_BASE_URL=https://aira-ai-live.vercel.app \
  bash infra/aira-runtime/install-reconciler.sh
```

The installer:

- creates the unprivileged `aira-reconciler` service account if needed;
- generates one 256-bit `AIRA_AGENT_RECONCILER_TOKEN` and reuses it on later runs;
- stores the token only in `/etc/aira/reconciler.env` and `/etc/aira/vercel.production.env`, both mode 600;
- installs the worker at `/usr/local/lib/aira/reconciler-worker.sh`;
- installs and enables `aira-reconciler.service`;
- never prints the token.

Apply the updated Vercel handoff file with the existing helper, then redeploy AIRA:

```bash
sudo bash infra/aira-runtime/set-vercel-env.sh /etc/aira/vercel.production.env
```

Until Vercel has the matching token, the worker will receive an authorization failure and back off. Once the deployment contains the token, it recovers automatically; no remote run is resubmitted.

## Worker semantics

The worker is intentionally small:

- single-flight per host using `flock`;
- POSTs only to `/api/internal/agents/reconcile`;
- default interval 30 seconds;
- bounded random jitter;
- bounded exponential backoff after transport/HTTP failures;
- request timeout;
- graceful SIGTERM/SIGINT handling;
- bearer token passed to curl through a mode-600 config file rather than process arguments;
- response body discarded because the endpoint exposes aggregate state only;
- no direct AutoGPT/DeerFlow calls and no run creation.

Optional host-side tuning:

```text
AIRA_RECONCILE_INTERVAL_SECONDS=30
AIRA_RECONCILE_JITTER_SECONDS=10
AIRA_RECONCILE_REQUEST_TIMEOUT_SECONDS=20
AIRA_RECONCILE_MAX_BACKOFF_SECONDS=300
```

## Verify

```bash
systemctl status aira-reconciler --no-pager
journalctl -u aira-reconciler -n 100 --no-pager
```

A healthy pass logs only the HTTP success status. Logs must not contain tokens, user IDs, run IDs, provider request bodies, or provider credentials.

A one-shot diagnostic is also available:

```bash
sudo -u aira-reconciler \
  env $(cat /etc/aira/reconciler.env | xargs) \
  /usr/local/lib/aira/reconciler-worker.sh --once
```

For routine operations prefer `systemctl`/`journalctl`; do not copy the environment file into shell history or support transcripts.

## Rollback

Disable only the host caller:

```bash
sudo systemctl disable --now aira-reconciler
```

Removing or disabling the worker does not alter `AgentRun` rows and does not cancel provider work. AIRA's interactive status refresh paths remain available.
