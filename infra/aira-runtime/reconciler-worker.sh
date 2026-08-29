#!/usr/bin/env bash
# Persistent, bounded caller for AIRA's existing-run reconciliation endpoint.
# This process never creates an AgentRun and never talks to AutoGPT/DeerFlow
# directly; the authenticated AIRA endpoint remains the only reconciliation
# control plane.

set -Eeuo pipefail

log()  { printf '[aira-reconciler] %s\n' "$*"; }
warn() { printf '[aira-reconciler] WARN: %s\n' "$*" >&2; }
die()  { printf '[aira-reconciler] ERROR: %s\n' "$*" >&2; exit 2; }

ONCE=0
if [[ "${1:-}" == "--once" ]]; then
  ONCE=1
  shift
fi
[[ $# -eq 0 ]] || die "Usage: reconciler-worker.sh [--once]"

: "${AIRA_APP_BASE_URL:?AIRA_APP_BASE_URL is required}"
: "${AIRA_AGENT_RECONCILER_TOKEN:?AIRA_AGENT_RECONCILER_TOKEN is required}"

INTERVAL_SECONDS="${AIRA_RECONCILE_INTERVAL_SECONDS:-30}"
JITTER_SECONDS="${AIRA_RECONCILE_JITTER_SECONDS:-10}"
REQUEST_TIMEOUT_SECONDS="${AIRA_RECONCILE_REQUEST_TIMEOUT_SECONDS:-20}"
MAX_BACKOFF_SECONDS="${AIRA_RECONCILE_MAX_BACKOFF_SECONDS:-300}"
RUNTIME_ROOT="${RUNTIME_DIRECTORY:-/run/aira-reconciler}"

require_uint_in_range() {
  local name="$1" value="$2" min="$3" max="$4"
  [[ "$value" =~ ^[0-9]+$ ]] || die "$name must be an integer"
  (( value >= min && value <= max )) || die "$name must be between $min and $max"
}

require_uint_in_range AIRA_RECONCILE_INTERVAL_SECONDS "$INTERVAL_SECONDS" 5 3600
require_uint_in_range AIRA_RECONCILE_JITTER_SECONDS "$JITTER_SECONDS" 0 300
require_uint_in_range AIRA_RECONCILE_REQUEST_TIMEOUT_SECONDS "$REQUEST_TIMEOUT_SECONDS" 2 120
require_uint_in_range AIRA_RECONCILE_MAX_BACKOFF_SECONDS "$MAX_BACKOFF_SECONDS" 10 3600

base_url="${AIRA_APP_BASE_URL%/}"
if [[ "$base_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
  :
elif [[ "${AIRA_RECONCILER_ALLOW_HTTP_LOOPBACK:-false}" == "true" && "$base_url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$ ]]; then
  :
else
  die "AIRA_APP_BASE_URL must be an HTTPS origin without credentials, query, fragment or path"
fi
endpoint="$base_url/api/internal/agents/reconcile"

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v flock >/dev/null 2>&1 || die "flock is required"

umask 077
mkdir -p "$RUNTIME_ROOT"
chmod 0700 "$RUNTIME_ROOT"

# Single-flight per host. If a second service instance starts, it exits instead
# of creating overlapping reconciliation loops.
exec 9>"$RUNTIME_ROOT/reconciler.lock"
if ! flock -n 9; then
  die "another reconciler worker already holds the host lock"
fi

curl_config="$RUNTIME_ROOT/curl.conf"
cleanup() {
  rm -f "$curl_config"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

# Keep the bearer token out of curl's argv/process listing. The config file
# lives in systemd's private mode-0700 RuntimeDirectory and is removed on exit.
cat > "$curl_config" <<EOF
silent
show-error
request = "POST"
header = "Authorization: Bearer $AIRA_AGENT_RECONCILER_TOKEN"
header = "Content-Type: application/json"
output = "/dev/null"
write-out = "%{http_code}"
connect-timeout = "5"
max-time = "$REQUEST_TIMEOUT_SECONDS"
EOF
chmod 0600 "$curl_config"

failure_count=0

next_delay() {
  local base exponent candidate jitter
  if (( failure_count == 0 )); then
    base=$INTERVAL_SECONDS
  else
    exponent=$failure_count
    (( exponent > 5 )) && exponent=5
    candidate=$(( INTERVAL_SECONDS * (1 << exponent) ))
    (( candidate > MAX_BACKOFF_SECONDS )) && candidate=$MAX_BACKOFF_SECONDS
    base=$candidate
  fi

  jitter=0
  if (( JITTER_SECONDS > 0 )); then
    jitter=$(( RANDOM % (JITTER_SECONDS + 1) ))
  fi
  printf '%s' $(( base + jitter ))
}

run_once() {
  local http_code curl_status
  set +e
  http_code="$(curl --config "$curl_config" "$endpoint")"
  curl_status=$?
  set -e

  if (( curl_status != 0 )); then
    warn "request transport failed (curl exit $curl_status)"
    return 1
  fi

  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    log "reconciliation pass succeeded (HTTP $http_code)"
    return 0
  fi

  # The endpoint returns only aggregate state. We intentionally discard the
  # body and never log a token, run id, user id, or provider payload.
  warn "reconciliation pass failed (HTTP ${http_code:-000})"
  return 1
}

while true; do
  if run_once; then
    failure_count=0
    [[ "$ONCE" -eq 1 ]] && exit 0
  else
    failure_count=$(( failure_count + 1 ))
    [[ "$ONCE" -eq 1 ]] && exit 1
  fi

  delay="$(next_delay)"
  log "next pass in ${delay}s"
  sleep "$delay" &
  wait $! || true
done
