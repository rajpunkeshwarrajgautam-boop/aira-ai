# AIRA dual-host AutoGPT runner

This package runs a pinned, MIT-licensed AutoGPT Classic agent behind a small
compatibility API. AIRA treats the VPS as the primary target and a Windows PC
as the standby target for new submissions.

## Architecture

- `autogpt` is never published to the internet. It exposes Agent Protocol only
  on the private Docker network.
- `adapter` authenticates AIRA with `X-API-Key`, applies request-size and step
  limits, provides idempotent submission IDs, persists execution state in
  SQLite, and translates the existing graph API contract to Agent Protocol.
- The adapter maps AutoGPT's OpenAI model aliases to NVIDIA's OpenAI-compatible
  chat and embedding endpoints. The NVIDIA key is not placed in the AutoGPT
  container.
- Caddy terminates HTTPS on the VPS. Cloudflare Tunnel publishes the Windows
  standby without opening an inbound router port.
- Only `/external-api/*` is published on either host. Caddy enforces this with
  mutually exclusive `handle` blocks; the tunnel enforces it with the public
  hostname's path. The `/internal/v1/*` NVIDIA proxy stays private on both.

The self-hosted visual AutoGPT Platform is intentionally not included. Its
PolyForm Shield license prohibits using it to provide a competing product.
AutoGPT Classic is MIT licensed, but upstream marks it unsupported and warns
about known dependency vulnerabilities. The runner mitigates that risk by
pinning one revision, running as non-root, dropping Linux capabilities,
disabling shell, filesystem, Git, browser, and raw-fetch commands, and exposing
only the authenticated adapter. The AutoGPT container is attached only to an
internal Docker network; it has no direct internet route.

## VPS primary

Prerequisites:

1. An Ubuntu VPS with a public IPv4 address.
2. A DNS hostname whose A record points to that address.
3. TCP ports 80 and 443 reachable from the internet.

Run from this directory on the VPS:

```bash
chmod +x scripts/provision-vps.sh
sudo ./scripts/provision-vps.sh
```

The script installs Docker from Docker's official Ubuntu repository when
needed, prompts for the hostname and NVIDIA key, creates unique runner secrets,
starts the stack, and prints the two Vercel values for the primary.

## Windows standby

Create a Cloudflare Tunnel and add one public hostname:

- **Service URL:** `http://adapter:8080`
- **Path:** `external-api/*`

Setting the path is required, not optional. A Cloudflare ingress rule that
omits the path matches every path, which would publish the adapter's
`/internal/v1/*` NVIDIA proxy and `/internal-ready` to the internet. Those
routes are meant to be reachable only from the private Docker network, and the
VPS profile blocks them at Caddy. Setting the path keeps both hosts on the same
footing.

Copy the tunnel token, then run PowerShell as Administrator from this
directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
```

The script enables the WSL 2 prerequisites and installs Docker Desktop through
`winget` when needed. It pauses with an explicit restart instruction whenever a
reboot is required. It then prompts securely for the NVIDIA key and tunnel
token, creates different runner secrets, starts the standby stack, and prints
the Vercel secondary values.

## Vercel configuration

Configure Preview first:

```text
AUTOGPT_AGENT_ENABLED=false
AUTOGPT_PRIMARY_API_BASE_URL=https://<vps-host>/external-api/v1
AUTOGPT_PRIMARY_API_KEY=<vps-runner-key>
AUTOGPT_SECONDARY_API_BASE_URL=https://<windows-tunnel-host>/external-api/v1
AUTOGPT_SECONDARY_API_KEY=<windows-runner-key>
AUTOGPT_GRAPH_ID=aira-objective-runner
AUTOGPT_GRAPH_VERSION=1
AUTOGPT_INPUT_NODE_ID=objective
AUTOGPT_INPUT_FIELD=value
AUTOGPT_REQUEST_TIMEOUT_MS=15000
AUTOGPT_HEALTH_TIMEOUT_MS=2000
```

Redeploy Preview, check both `/health` endpoints, enable the feature, and run a
complete Pro or Team task. Only then copy the same target configuration to
Production and set `AUTOGPT_AGENT_ENABLED=true`.

The legacy `AUTOGPT_API_BASE_URL` and `AUTOGPT_API_KEY` variables remain
supported when only one host is configured.

## Failover behavior

- AIRA probes primary, then secondary, before submitting a new job.
- A submission is attempted exactly once on the selected healthy host.
- The stored execution reference identifies the accepting host, so later polls
  cannot accidentally read a similarly named job from the other host.
- An active job is not migrated if its host goes offline. It resumes polling
  when that same host returns.

## Local verification

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r adapter/requirements.txt
python -m unittest tests/test_adapter.py
docker compose -f compose.yml -f compose.vps.yml config
docker compose -f compose.yml -f compose.windows.yml config
```
