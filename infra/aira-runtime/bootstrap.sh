#!/usr/bin/env bash
#
# AIRA runtime bootstrap — one command, one fresh Ubuntu host.
#
#   sudo AIRA_NVIDIA_API_KEY=... bash infra/aira-runtime/bootstrap.sh
#
# Brings up every externally gated AIRA runtime using the deployment
# implementations already in this repository, puts one TLS edge in front of
# them, and writes the exact Vercel environment variables that point AIRA at
# what is now running. It creates nothing that the repository does not already
# define: the foundation stack is infra/foundation/compose.yml, the AutoGPT
# runners are infra/autogpt-runner/compose.yml, DeerFlow is provisioned by
# infra/deerflow-runner/scripts/provision-vps.sh at its pinned revision.
#
# Re-running is safe. Secrets are generated once into /etc/aira/runtime.env and
# preserved on every later run, so a re-run never invalidates the values
# already configured in Vercel.
#
# Nothing here weakens an authentication, isolation or admission control. Every
# service keeps its own token; the edge only narrows the reachable paths.

set -Eeuo pipefail

STATE_DIR=/etc/aira
ENV_FILE="$STATE_DIR/runtime.env"
VERCEL_ENV_FILE="$STATE_DIR/vercel.production.env"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$REPO_ROOT/infra/aira-runtime"
FOUNDATION_DIR="$REPO_ROOT/infra/foundation"
AUTOGPT_DIR="$REPO_ROOT/infra/autogpt-runner"
DEERFLOW_SCRIPT="$REPO_ROOT/infra/deerflow-runner/scripts/provision-vps.sh"
DEERFLOW_INSTALL_ROOT="${DEERFLOW_INSTALL_ROOT:-/opt/aira/deer-flow}"
DEERFLOW_STATE_ROOT="${DEERFLOW_STATE_ROOT:-/var/lib/deer-flow}"

WITH_DEERFLOW=1
PRINT_SECRETS=0

log()  { printf '\033[1;36m[aira]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aira]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[aira] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: sudo bash infra/aira-runtime/bootstrap.sh [options]

Options:
  --no-deerflow      Skip DeerFlow. The foundation stack, both AutoGPT runners
                     and the sandbox still deploy. DeerFlow needs roughly 4 GB
                     of RAM on its own; skip it on a smaller host.
  --print-secrets    Also print generated secrets to this terminal. Off by
                     default: they are written to /etc/aira/vercel.production.env
                     (mode 600) instead, so they never reach a scrollback
                     buffer or a CI log.
  -h, --help         Show this message.

Required environment:
  AIRA_NVIDIA_API_KEY        NVIDIA API key for the AutoGPT runners' model
                             translation layer. Same key AIRA already uses.
  AIRA_ACME_EMAIL            Contact address for Let's Encrypt.

Optional environment:
  AIRA_RUNTIME_DOMAIN        Base domain for the runtime hostnames. When unset,
                             sslip.io hostnames derived from this host's public
                             IPv4 address are used, so TLS works with no DNS
                             credentials at all.
  AIRA_DEERFLOW_LLM_BASE_URL OpenAI-compatible endpoint DeerFlow reasons with.
  AIRA_DEERFLOW_LLM_API_KEY  Its key.
  AIRA_DEERFLOW_LLM_MODEL    Its model id.
  AIRA_PUBLIC_IP             Override public IPv4 detection.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deerflow)   WITH_DEERFLOW=0 ;;
    --print-secrets) PRINT_SECRETS=1 ;;
    -h|--help)       usage; exit 0 ;;
    *)               die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------- preflight ---

[[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash infra/aira-runtime/bootstrap.sh"
[[ -r /etc/os-release ]] || die "This bootstrap targets Ubuntu hosts."
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] || die "Ubuntu or Debian required; detected ${ID:-unknown}."

[[ -n "${AIRA_NVIDIA_API_KEY:-}" ]] || die "AIRA_NVIDIA_API_KEY is required (the AutoGPT runners refuse to start without it)."
[[ -n "${AIRA_ACME_EMAIL:-}" ]]    || die "AIRA_ACME_EMAIL is required for Let's Encrypt registration."

total_mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
free_disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
log "Host: $(uname -m), ${total_mem_mb} MB RAM, ${free_disk_gb} GB free on /"

required_mem=$([[ "$WITH_DEERFLOW" -eq 1 ]] && echo 7000 || echo 3000)
if (( total_mem_mb < required_mem )); then
  if [[ "$WITH_DEERFLOW" -eq 1 ]]; then
    die "DeerFlow plus both AutoGPT runners need about 8 GB of RAM; this host has ${total_mem_mb} MB. Re-run with --no-deerflow, or use a larger host."
  fi
  die "The foundation stack and both AutoGPT runners need about 4 GB of RAM; this host has ${total_mem_mb} MB."
fi
(( free_disk_gb >= 25 )) || die "At least 25 GB of free disk is required; ${free_disk_gb} GB available."

# ------------------------------------------------------------------- docker ---

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg openssl jq
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker already installed"
  command -v openssl >/dev/null || { apt-get update -y && apt-get install -y openssl; }
  command -v jq >/dev/null || { apt-get update -y && apt-get install -y jq; }
fi

docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
# Containers all declare restart: unless-stopped, so enabling the daemon at boot
# is what makes the whole stack survive a reboot.
systemctl enable --now docker >/dev/null 2>&1 || true

# ------------------------------------------------------------------ secrets ---

install -d -m 0700 "$STATE_DIR"

if [[ -f "$ENV_FILE" ]]; then
  log "Reusing existing secrets from $ENV_FILE (nothing already configured in Vercel is invalidated)"
else
  log "Generating runtime secrets"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Generated by infra/aira-runtime/bootstrap.sh. Mode 600. Never commit.
AIRA_CONTROL_PLANE_TOKEN=$(openssl rand -hex 32)
AIRA_KNOWLEDGE_WORKER_TOKEN=$(openssl rand -hex 32)
AIRA_SANDBOX_TOKEN=$(openssl rand -hex 32)
AUTOGPT_PRIMARY_RUNNER_API_KEY=$(openssl rand -hex 32)
AUTOGPT_PRIMARY_INTERNAL_TOKEN=sk-$(openssl rand -hex 32)
AUTOGPT_SECONDARY_RUNNER_API_KEY=$(openssl rand -hex 32)
AUTOGPT_SECONDARY_INTERNAL_TOKEN=sk-$(openssl rand -hex 32)
EOF
  chmod 0600 "$ENV_FILE"
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# ---------------------------------------------------------------- hostnames ---

if [[ -n "${AIRA_RUNTIME_DOMAIN:-}" ]]; then
  BASE_HOST="$AIRA_RUNTIME_DOMAIN"
  log "Using operator-supplied domain: $BASE_HOST"
  log "Point A records for control, sandbox, deerflow, autogpt-primary and autogpt-secondary at this host before continuing."
else
  PUBLIC_IP="${AIRA_PUBLIC_IP:-$(curl -fsS --max-time 10 https://api.ipify.org || true)}"
  [[ "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "Could not determine a public IPv4 address. Set AIRA_PUBLIC_IP or AIRA_RUNTIME_DOMAIN."
  # sslip.io resolves <label>.<dashed-ip>.sslip.io to the encoded address, so
  # Let's Encrypt can validate real certificates with no DNS account at all.
  BASE_HOST="${PUBLIC_IP//./-}.sslip.io"
  log "No domain supplied; using sslip.io hostnames under $BASE_HOST"
fi

AIRA_CONTROL_HOST="control.$BASE_HOST"
AIRA_SANDBOX_HOST="sandbox.$BASE_HOST"
AIRA_DEERFLOW_HOST="deerflow.$BASE_HOST"
AIRA_AUTOGPT_PRIMARY_HOST="autogpt-primary.$BASE_HOST"
AIRA_AUTOGPT_SECONDARY_HOST="autogpt-secondary.$BASE_HOST"
AIRA_CONTROL_PLANE_PORT=8090
AIRA_SANDBOX_PORT=8091
AIRA_AUTOGPT_PRIMARY_PORT=8096
AIRA_AUTOGPT_SECONDARY_PORT=8097
AIRA_DEERFLOW_PORT=2026

# ------------------------------------------------------- foundation stack -----

log "Starting foundation control plane, knowledge worker and sandbox"
umask 077
cat > "$FOUNDATION_DIR/.env" <<EOF
AIRA_CONTROL_PLANE_TOKEN=$AIRA_CONTROL_PLANE_TOKEN
AIRA_KNOWLEDGE_WORKER_TOKEN=$AIRA_KNOWLEDGE_WORKER_TOKEN
AIRA_SANDBOX_TOKEN=$AIRA_SANDBOX_TOKEN
AIRA_CONTROL_PLANE_PORT=$AIRA_CONTROL_PLANE_PORT
AIRA_SANDBOX_PORT=$AIRA_SANDBOX_PORT
AIRA_VISION_BASE_URL=${AIRA_VISION_BASE_URL:-}
AIRA_VISION_API_KEY=${AIRA_VISION_API_KEY:-}
AIRA_VISION_MODEL=${AIRA_VISION_MODEL:-}
# Compose interpolates every service before it filters by profile, so the
# gpu-profile inference service's required variables must resolve even though
# that profile is never selected here. These are inert placeholders and follow
# the same convention .github/workflows/ci.yml already uses. Replace them with
# real values only on a validated GPU host, and start that service explicitly
# with --profile gpu.
AIRA_INFERENCE_IMAGE=${AIRA_INFERENCE_IMAGE:-example.invalid/aira-inference:unused}
AIRA_INFERENCE_MODEL=${AIRA_INFERENCE_MODEL:-unused}
AIRA_INFERENCE_API_KEY=${AIRA_INFERENCE_API_KEY:-unused}
EOF
chmod 0600 "$FOUNDATION_DIR/.env"

compose_files=(-f "$FOUNDATION_DIR/compose.yml")
# gVisor is the repository's intended sandbox isolation mode. Use it when the
# runtime is actually registered; never silently degrade without saying so.
if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"'; then
  compose_files+=(-f "$FOUNDATION_DIR/compose.gvisor.yml")
  log "gVisor detected: sandbox will run under runsc"
else
  warn "gVisor (runsc) is not registered with Docker. The sandbox still runs read-only, with all capabilities dropped, no-new-privileges, an internal-only network and CPU/memory/PID limits, but WITHOUT a syscall-filtering kernel. Install gVisor and re-run to reach the repository's intended isolation level."
fi
docker compose "${compose_files[@]}" --project-directory "$FOUNDATION_DIR" up -d --build

# ---------------------------------------------------------- autogpt runners ---

start_autogpt_runner() { # project role api_key internal_token loopback_port
  local project="$1" role="$2" api_key="$3" internal_token="$4" port="$5"
  log "Starting AutoGPT runner: $project"
  umask 077
  cat > "$AUTOGPT_DIR/.env.$role" <<EOF
RUNNER_API_KEY=$api_key
AUTOGPT_INTERNAL_TOKEN=$internal_token
NVIDIA_API_KEY=$AIRA_NVIDIA_API_KEY
AIRA_GRAPH_ID=aira-objective-runner
AIRA_GRAPH_VERSION=1
AUTOGPT_MAX_STEPS=12
AUTOGPT_MAX_CONCURRENT_RUNS=1
AUTOGPT_UPSTREAM_TIMEOUT_SECONDS=180
NVIDIA_API_URL=https://integrate.api.nvidia.com/v1
NVIDIA_SMART_MODEL=nvidia/nemotron-3-nano-30b-a3b
NVIDIA_FAST_MODEL=nvidia/nemotron-3-nano-30b-a3b
NVIDIA_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
AUTOGPT_COMMIT=601093ddfe23a3d58a9c8f4a208bd49b203ee612
RUNNER_HOST_ROLE=$role
ADAPTER_LOOPBACK_PORT=$port
EOF
  chmod 0600 "$AUTOGPT_DIR/.env.$role"
  docker compose \
    -p "$project" \
    --env-file "$AUTOGPT_DIR/.env.$role" \
    -f "$AUTOGPT_DIR/compose.yml" \
    -f "$RUNTIME_DIR/compose.autogpt-loopback.yml" \
    --project-directory "$AUTOGPT_DIR" \
    up -d --build
}

start_autogpt_runner aira-autogpt-primary   primary   "$AUTOGPT_PRIMARY_RUNNER_API_KEY"   "$AUTOGPT_PRIMARY_INTERNAL_TOKEN"   "$AIRA_AUTOGPT_PRIMARY_PORT"
start_autogpt_runner aira-autogpt-secondary secondary "$AUTOGPT_SECONDARY_RUNNER_API_KEY" "$AUTOGPT_SECONDARY_INTERNAL_TOKEN" "$AIRA_AUTOGPT_SECONDARY_PORT"

# --------------------------------------------------------------- deerflow -----

if [[ "$WITH_DEERFLOW" -eq 1 ]]; then
  log "Provisioning DeerFlow at its pinned revision"
  bash "$DEERFLOW_SCRIPT"

  deerflow_env="$DEERFLOW_INSTALL_ROOT/.env"
  if [[ -n "${AIRA_DEERFLOW_LLM_BASE_URL:-}" && -n "${AIRA_DEERFLOW_LLM_API_KEY:-}" && -n "${AIRA_DEERFLOW_LLM_MODEL:-}" ]]; then
    # DeerFlow substitutes $VARIABLE references in config.yaml, so the key
    # itself stays in the mode-600 .env and never lands in config.yaml.
    grep -q '^AIRA_LLM_API_KEY=' "$deerflow_env" || {
      umask 077
      {
        echo "AIRA_LLM_API_KEY=$AIRA_DEERFLOW_LLM_API_KEY"
        echo "AIRA_LLM_BASE_URL=$AIRA_DEERFLOW_LLM_BASE_URL"
        echo "AIRA_LLM_MODEL=$AIRA_DEERFLOW_LLM_MODEL"
      } >> "$deerflow_env"
    }
    if ! grep -q 'AIRA_LLM_API_KEY' "$DEERFLOW_INSTALL_ROOT/config.yaml" 2>/dev/null; then
      umask 077
      cat > "$DEERFLOW_INSTALL_ROOT/config.yaml" <<'YAML'
# Written by infra/aira-runtime/bootstrap.sh. Secrets are environment-variable
# references, never literals, exactly as infra/deerflow-runner/README.md requires.
BASIC_MODEL:
  base_url: $AIRA_LLM_BASE_URL
  model: $AIRA_LLM_MODEL
  api_key: $AIRA_LLM_API_KEY
REASONING_MODEL:
  base_url: $AIRA_LLM_BASE_URL
  model: $AIRA_LLM_MODEL
  api_key: $AIRA_LLM_API_KEY
YAML
      chmod 0600 "$DEERFLOW_INSTALL_ROOT/config.yaml"
    fi
    log "Starting DeerFlow"
    ( cd "$DEERFLOW_INSTALL_ROOT" && make up )
  else
    warn "DeerFlow was provisioned but NOT started: it has no model configured. Set AIRA_DEERFLOW_LLM_BASE_URL, AIRA_DEERFLOW_LLM_API_KEY and AIRA_DEERFLOW_LLM_MODEL and re-run. AIRA will keep DEERFLOW_AGENT_ENABLED unset until then, which is the correct fail-closed state."
    WITH_DEERFLOW=0
  fi
fi

# ------------------------------------------------------------------- edge -----

log "Starting the TLS edge"
umask 077
cat > "$RUNTIME_DIR/.env" <<EOF
AIRA_ACME_EMAIL=$AIRA_ACME_EMAIL
AIRA_CONTROL_HOST=$AIRA_CONTROL_HOST
AIRA_SANDBOX_HOST=$AIRA_SANDBOX_HOST
AIRA_DEERFLOW_HOST=$AIRA_DEERFLOW_HOST
AIRA_AUTOGPT_PRIMARY_HOST=$AIRA_AUTOGPT_PRIMARY_HOST
AIRA_AUTOGPT_SECONDARY_HOST=$AIRA_AUTOGPT_SECONDARY_HOST
AIRA_CONTROL_PLANE_PORT=$AIRA_CONTROL_PLANE_PORT
AIRA_SANDBOX_PORT=$AIRA_SANDBOX_PORT
AIRA_DEERFLOW_PORT=$AIRA_DEERFLOW_PORT
AIRA_AUTOGPT_PRIMARY_PORT=$AIRA_AUTOGPT_PRIMARY_PORT
AIRA_AUTOGPT_SECONDARY_PORT=$AIRA_AUTOGPT_SECONDARY_PORT
EOF
chmod 0600 "$RUNTIME_DIR/.env"
docker compose --project-directory "$RUNTIME_DIR" -f "$RUNTIME_DIR/compose.edge.yml" up -d

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "Opening 80/443 on ufw (nothing else is exposed)"
  ufw allow 80/tcp  >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi

log "Waiting for certificate issuance"
sleep 25

# ---------------------------------------------------------- vercel env file ---

umask 077
{
  echo "# AIRA production environment for Vercel. Generated $(date -u +%FT%TZ). Mode 600."
  echo "# Apply with: bash infra/aira-runtime/set-vercel-env.sh $VERCEL_ENV_FILE"
  echo "FOUNDATION_CONTROL_PLANE_ENABLED=true"
  # REQUIRED=false keeps ordinary chat and search degrading to the local path if
  # the control plane is ever unreachable. Flip it to true only after the
  # control plane has demonstrated its own availability target.
  echo "FOUNDATION_CONTROL_PLANE_REQUIRED=false"
  echo "AIRA_CONTROL_PLANE_URL=https://$AIRA_CONTROL_HOST"
  echo "AIRA_CONTROL_PLANE_TOKEN=$AIRA_CONTROL_PLANE_TOKEN"
  echo "MULTIMODAL_INGESTION_ENABLED=true"
  echo "AIRA_KNOWLEDGE_BUCKET=aira-knowledge"
  echo "AIRA_KNOWLEDGE_WORKER_TOKEN=$AIRA_KNOWLEDGE_WORKER_TOKEN"
  echo "PYTHON_SANDBOX_ENABLED=true"
  echo "AIRA_SANDBOX_URL=https://$AIRA_SANDBOX_HOST"
  echo "AIRA_SANDBOX_TOKEN=$AIRA_SANDBOX_TOKEN"
  echo "AUTOGPT_AGENT_ENABLED=true"
  echo "AUTOGPT_REQUIRE_FOUNDATION_STACK=true"
  echo "AUTOGPT_PRIMARY_API_BASE_URL=https://$AIRA_AUTOGPT_PRIMARY_HOST/external-api/v1"
  echo "AUTOGPT_PRIMARY_API_KEY=$AUTOGPT_PRIMARY_RUNNER_API_KEY"
  echo "AUTOGPT_SECONDARY_API_BASE_URL=https://$AIRA_AUTOGPT_SECONDARY_HOST/external-api/v1"
  echo "AUTOGPT_SECONDARY_API_KEY=$AUTOGPT_SECONDARY_RUNNER_API_KEY"
  echo "AUTOGPT_GRAPH_ID=aira-objective-runner"
  echo "AUTOGPT_GRAPH_VERSION=1"
  echo "AUTOGPT_INPUT_NODE_ID=objective"
  echo "AUTOGPT_INPUT_FIELD=value"
  if [[ "$WITH_DEERFLOW" -eq 1 ]]; then
    echo "DEERFLOW_AGENT_ENABLED=true"
    echo "DEERFLOW_API_BASE_URL=https://$AIRA_DEERFLOW_HOST"
    echo "DEERFLOW_INTERNAL_AUTH_TOKEN=$(cat "$DEERFLOW_STATE_ROOT/.internal-auth-token")"
    echo "DEERFLOW_PLAN_MODE=true"
    echo "DEERFLOW_THINKING_ENABLED=false"
    [[ -n "${AIRA_DEERFLOW_LLM_MODEL:-}" ]] && echo "DEERFLOW_MODEL_NAME=$AIRA_DEERFLOW_LLM_MODEL"
  fi
  echo "# Supabase values are NOT generated here. Knowledge ingestion additionally"
  echo "# needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel; the"
  echo "# service-role key must be copied from the Supabase dashboard and must"
  echo "# never be given a NEXT_PUBLIC_ prefix."
} > "$VERCEL_ENV_FILE"
chmod 0600 "$VERCEL_ENV_FILE"

# --------------------------------------------------------------- verify -------

log "Running deployment verification"
set +e
bash "$RUNTIME_DIR/verify.sh"
verify_status=$?
set -e

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
AIRA runtime bootstrap finished.

  Control plane      https://$AIRA_CONTROL_HOST
  Sandbox gateway    https://$AIRA_SANDBOX_HOST
  AutoGPT primary    https://$AIRA_AUTOGPT_PRIMARY_HOST/external-api/v1
  AutoGPT secondary  https://$AIRA_AUTOGPT_SECONDARY_HOST/external-api/v1
$([[ "$WITH_DEERFLOW" -eq 1 ]] && echo "  DeerFlow           https://$AIRA_DEERFLOW_HOST" || echo "  DeerFlow           not started")

Secrets and the ready-to-apply Vercel environment are in:
  $VERCEL_ENV_FILE   (mode 600, root only)

Apply them to the linked Vercel project:
  bash infra/aira-runtime/set-vercel-env.sh $VERCEL_ENV_FILE

Then add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the Supabase
dashboard, redeploy production, and confirm /api/integrations/status.

Verification exit status: $verify_status
──────────────────────────────────────────────────────────────────────────────
EOF

if [[ "$PRINT_SECRETS" -eq 1 ]]; then
  echo
  echo "=== generated Vercel environment (secrets shown on request) ==="
  cat "$VERCEL_ENV_FILE"
fi

exit "$verify_status"
