#!/usr/bin/env bash
set -Eeuo pipefail

DEERFLOW_REPO="https://github.com/bytedance/deer-flow.git"
DEERFLOW_PIN="a5acc25de6742b2166b3f41c97bd895822277b94"
INSTALL_ROOT="${DEERFLOW_INSTALL_ROOT:-/opt/aira/deer-flow}"
STATE_ROOT="${DEERFLOW_STATE_ROOT:-/var/lib/deer-flow}"
ENV_FILE="$INSTALL_ROOT/.env"

log() { printf '[aira-deerflow] %s\n' "$*"; }
die() { printf '[aira-deerflow] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID}" -ne 0 ]]; then
  die "Run as root (for example: sudo bash infra/deerflow-runner/scripts/provision-vps.sh)."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This bootstrap currently supports Debian/Ubuntu hosts with apt-get."
fi

export DEBIAN_FRONTEND=noninteractive
log "Installing host prerequisites"
apt-get update -y
apt-get install -y ca-certificates curl git openssl docker.io

if ! docker compose version >/dev/null 2>&1; then
  if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get install -y docker-compose-v2
  elif apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  else
    die "Docker Compose v2 is required but no apt package was found. Install the Docker Compose plugin, then rerun."
  fi
fi

systemctl enable --now docker
install -d -m 0755 "$(dirname "$INSTALL_ROOT")"
install -d -m 0700 "$STATE_ROOT"

if [[ -d "$INSTALL_ROOT/.git" ]]; then
  log "Refreshing existing DeerFlow checkout"
  git -C "$INSTALL_ROOT" remote set-url origin "$DEERFLOW_REPO"
  git -C "$INSTALL_ROOT" fetch --force --depth=1 origin "$DEERFLOW_PIN"
else
  if [[ -e "$INSTALL_ROOT" ]]; then
    die "$INSTALL_ROOT exists but is not a Git checkout. Move it aside or set DEERFLOW_INSTALL_ROOT."
  fi
  log "Cloning DeerFlow"
  git clone --filter=blob:none --no-checkout "$DEERFLOW_REPO" "$INSTALL_ROOT"
  git -C "$INSTALL_ROOT" fetch --force --depth=1 origin "$DEERFLOW_PIN"
fi

git -C "$INSTALL_ROOT" checkout --detach --force "$DEERFLOW_PIN"
actual_pin="$(git -C "$INSTALL_ROOT" rev-parse HEAD)"
[[ "$actual_pin" == "$DEERFLOW_PIN" ]] || die "Pinned checkout verification failed."
log "Pinned DeerFlow at $actual_pin"

if [[ ! -f "$INSTALL_ROOT/config.yaml" ]]; then
  cp "$INSTALL_ROOT/config.example.yaml" "$INSTALL_ROOT/config.yaml"
  chmod 0600 "$INSTALL_ROOT/config.yaml"
  log "Seeded config.yaml from upstream config.example.yaml"
fi

if [[ ! -f "$INSTALL_ROOT/extensions_config.json" ]]; then
  printf '{"mcpServers":{},"skills":{}}\n' > "$INSTALL_ROOT/extensions_config.json"
  chmod 0600 "$INSTALL_ROOT/extensions_config.json"
fi

if [[ ! -f "$INSTALL_ROOT/frontend/.env" ]]; then
  cp "$INSTALL_ROOT/frontend/.env.example" "$INSTALL_ROOT/frontend/.env"
  chmod 0600 "$INSTALL_ROOT/frontend/.env"
fi

internal_token="${DEER_FLOW_INTERNAL_AUTH_TOKEN:-}"
if [[ -z "$internal_token" && -f "$STATE_ROOT/.internal-auth-token" ]]; then
  internal_token="$(cat "$STATE_ROOT/.internal-auth-token")"
fi
if [[ -z "$internal_token" ]]; then
  internal_token="$(openssl rand -base64 48 | tr -d '\n')"
  umask 077
  printf '%s\n' "$internal_token" > "$STATE_ROOT/.internal-auth-token"
fi

better_auth_secret="${BETTER_AUTH_SECRET:-}"
if [[ -z "$better_auth_secret" && -f "$STATE_ROOT/.better-auth-secret" ]]; then
  better_auth_secret="$(cat "$STATE_ROOT/.better-auth-secret")"
fi
if [[ -z "$better_auth_secret" ]]; then
  better_auth_secret="$(openssl rand -base64 48 | tr -d '\n')"
  umask 077
  printf '%s\n' "$better_auth_secret" > "$STATE_ROOT/.better-auth-secret"
fi

# Preserve an operator-owned .env. For a new host, create only non-provider
# settings and secret references. Model/database/sandbox credentials still
# require explicit operator configuration before production activation.
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
DEER_FLOW_HOME=$STATE_ROOT
DEER_FLOW_CONFIG_PATH=$INSTALL_ROOT/config.yaml
DEER_FLOW_EXTENSIONS_CONFIG_PATH=$INSTALL_ROOT/extensions_config.json
DEER_FLOW_INTERNAL_AUTH_TOKEN=$internal_token
BETTER_AUTH_SECRET=$better_auth_secret
GATEWAY_ENABLE_DOCS=false
BIND_HOST=127.0.0.1
PORT=2026
GATEWAY_WORKERS=1
LANGSMITH_TRACING=false
EOF
  chmod 0600 "$ENV_FILE"
  log "Created protected DeerFlow .env"
else
  log "Existing .env preserved; no secrets were overwritten"
fi

# DeerFlow's deploy script expects its default in-repo state location unless
# DEER_FLOW_HOME is exported by the invoking shell. The Compose file itself
# reads .env, so validate the desired persistent host directory is present.
install -d -m 0700 "$STATE_ROOT/threads"

log "Validating Docker and pinned source"
docker version >/dev/null
docker compose version >/dev/null

cat <<EOF

AIRA DeerFlow bootstrap completed.

Pinned source : $DEERFLOW_PIN
Install root  : $INSTALL_ROOT
State root    : $STATE_ROOT
Config        : $INSTALL_ROOT/config.yaml
Secrets       : $ENV_FILE (mode 600)

IMPORTANT: the stack has NOT been declared production-ready by this script.
Before starting it, review config.yaml and configure:
  1. at least one real LLM model via environment-variable references,
  2. Postgres for concurrent production use,
  3. E2B or Kubernetes-provisioned sandboxing for public multi-user AIRA,
  4. a TLS reverse proxy in front of loopback-only port 2026.

Then start from the DeerFlow checkout:
  cd $INSTALL_ROOT
  make up

Local verification after startup:
  curl -fsS http://127.0.0.1:8001/health
  curl -fsS http://127.0.0.1:2026/api/models

To configure AIRA, copy the value stored in:
  $STATE_ROOT/.internal-auth-token
into Vercel as DEERFLOW_INTERNAL_AUTH_TOKEN. Never paste it into source control.
EOF
