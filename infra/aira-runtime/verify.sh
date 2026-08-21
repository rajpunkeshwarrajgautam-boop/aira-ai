#!/usr/bin/env bash
#
# Activation gate for the AIRA runtime host.
#
#   sudo bash infra/aira-runtime/verify.sh
#
# Exits non-zero unless every Vercel-facing service is reachable over real TLS,
# refuses unauthenticated callers, answers its health contract, and keeps its
# private surfaces private. Nothing should be enabled in Vercel until this
# exits zero: pointing AIRA at a host that has not passed is exactly the state
# the repository's fail-closed defaults exist to prevent.

set -Eeuo pipefail

STATE_DIR=/etc/aira
ENV_FILE="$STATE_DIR/runtime.env"
RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ENV="$RUNTIME_DIR/.env"

[[ -r "$ENV_FILE" ]]   || { echo "Missing $ENV_FILE. Run bootstrap.sh first." >&2; exit 1; }
[[ -r "$RUNTIME_ENV" ]] || { echo "Missing $RUNTIME_ENV. Run bootstrap.sh first." >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; . "$RUNTIME_ENV"; set +a

PASS=0
FAIL=0
ok()   { printf '  \033[1;32mPASS\033[0m  %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[1;31mFAIL\033[0m  %s\n' "$*"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# status_of URL [header...] — HTTP status over real TLS, no -k anywhere, so a
# bad or self-signed certificate is a failure rather than a silent pass.
status_of() {
  local url="$1"; shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" "$url" 2>/dev/null || echo 000
}

expect() { # description url expected_status [curl args...]
  local desc="$1" url="$2" want="$3"; shift 3
  local got; got="$(status_of "$url" "$@")"
  [[ "$got" == "$want" ]] && ok "$desc (HTTP $got)" || bad "$desc — expected $want, got $got — $url"
}

head_ "TLS certificates"
# curl without -k verifies the chain against the system trust store, so any
# exit code other than a transport failure means the certificate was accepted.
for host in "$AIRA_CONTROL_HOST" "$AIRA_SANDBOX_HOST" "$AIRA_AUTOGPT_PRIMARY_HOST" "$AIRA_AUTOGPT_SECONDARY_HOST" "${AIRA_DEERFLOW_HOST:-}"; do
  [[ -n "$host" ]] || continue
  code=0
  curl -sS -o /dev/null --max-time 20 "https://$host/" >/dev/null 2>&1 || code=$?
  case "$code" in
    0)  ok  "valid publicly trusted certificate for $host" ;;
    60) bad "certificate for $host is not trusted by the system trust store" ;;
    *)  bad "could not complete a TLS request to $host (curl exit $code)" ;;
  esac
done

head_ "Foundation control plane"
expect "health endpoint answers" "https://$AIRA_CONTROL_HOST/healthz" 200
expect "admission refuses an unauthenticated caller" "https://$AIRA_CONTROL_HOST/v1/admit" 401 \
  -X POST -H 'Content-Type: application/json' -d '{"requestId":"verify","kind":"search"}'
expect "enqueue refuses an unauthenticated caller" "https://$AIRA_CONTROL_HOST/v1/jobs/enqueue" 401 \
  -X POST -H 'Content-Type: application/json' -d '{"type":"knowledge.ingest","payload":{}}'
expect "unmapped paths are refused at the edge" "https://$AIRA_CONTROL_HOST/metrics" 404
expect "the worker claim path is not published" "https://$AIRA_CONTROL_HOST/v1/jobs/claim" 404 \
  -X POST -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"knowledge.ingest","workerId":"probe"}'
expect "the worker ack path is not published" "https://$AIRA_CONTROL_HOST/v1/jobs/ack" 404 \
  -X POST -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"knowledge.ingest","jobId":"probe"}'

admit=$(curl -sS --max-time 20 -X POST "https://$AIRA_CONTROL_HOST/v1/admit" \
  -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"requestId":"verify-admit","kind":"agent"}' || true)
if grep -q '"allowed":true' <<<"$admit"; then
  ok "authenticated admission grants a lease"
  lease=$(jq -r '.data.leaseId' <<<"$admit")
  released=$(curl -sS --max-time 20 -X POST "https://$AIRA_CONTROL_HOST/v1/release" \
    -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"leaseId\":\"$lease\"}" || true)
  grep -q '"released":true' <<<"$released" && ok "lease release round-trips" || bad "lease release failed: $released"
else
  bad "authenticated admission failed: $admit"
fi

enq=$(curl -sS --max-time 20 -X POST "https://$AIRA_CONTROL_HOST/v1/jobs/enqueue" \
  -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"aira.verify.noop","payload":{"probe":true}}' || true)
grep -q '"jobId"' <<<"$enq" && ok "job enqueue accepted (/v1/jobs/enqueue)" || bad "enqueue failed: $enq"

head_ "Knowledge worker"
worker_cid="$(docker ps -qf name=knowledge-worker | head -1)"
if [[ -n "$worker_cid" ]]; then
  ok "knowledge-worker container is running"
  if docker logs --tail 200 "$worker_cid" 2>&1 | grep -qi 'traceback\|SystemExit'; then
    bad "knowledge-worker logged a fatal error — inspect: docker logs $worker_cid"
  else
    ok "knowledge-worker has no fatal errors in recent logs"
  fi
  # The worker claims over the internal Docker network, never through the edge,
  # so probe the claim path on loopback. This also drains the /v1/jobs/enqueue
  # probe job queued above so it does not accumulate across verify runs.
  claim=$(curl -sS --max-time 20 -X POST "http://127.0.0.1:$AIRA_CONTROL_PLANE_PORT/v1/jobs/claim" \
    -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
    -d '{"type":"aira.verify.noop","workerId":"verify-probe"}' || true)
  if grep -q '"ok":true' <<<"$claim"; then
    ok "job claim path answers on loopback"
    probe_job_id=$(jq -r '.data.job.id // empty' <<<"$claim")
    [[ -n "$probe_job_id" ]] && curl -sS -o /dev/null --max-time 20 \
      -X POST "http://127.0.0.1:$AIRA_CONTROL_PLANE_PORT/v1/jobs/ack" \
      -H "X-AIRA-Control-Token: $AIRA_CONTROL_PLANE_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"type\":\"aira.verify.noop\",\"jobId\":\"$probe_job_id\"}" || true
  else
    bad "job claim failed: $claim"
  fi
else
  bad "knowledge-worker container is not running"
fi

head_ "Python sandbox"
expect "gateway health answers" "https://$AIRA_SANDBOX_HOST/healthz" 200
expect "execution refuses an unauthenticated caller" "https://$AIRA_SANDBOX_HOST/v1/execute" 401 \
  -X POST -H 'Content-Type: application/json' -d '{"language":"python","code":"print(1)"}'
exec_out=$(curl -sS --max-time 30 -X POST "https://$AIRA_SANDBOX_HOST/v1/execute" \
  -H "X-AIRA-Sandbox-Token: $AIRA_SANDBOX_TOKEN" -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"print(sum(range(10)))"}' || true)
grep -q '"stdout":"45' <<<"$exec_out" && ok "authenticated execution returns the correct result" || bad "sandbox execution failed: $exec_out"
timeout_out=$(curl -sS --max-time 40 -X POST "https://$AIRA_SANDBOX_HOST/v1/execute" \
  -H "X-AIRA-Sandbox-Token: $AIRA_SANDBOX_TOKEN" -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"import time\ntime.sleep(60)"}' || true)
grep -q 'timed out' <<<"$timeout_out" && ok "wall-clock timeout is enforced" || bad "sandbox did not time out: $timeout_out"
net_out=$(curl -sS --max-time 30 -X POST "https://$AIRA_SANDBOX_HOST/v1/execute" \
  -H "X-AIRA-Sandbox-Token: $AIRA_SANDBOX_TOKEN" -H 'Content-Type: application/json' \
  -d '{"language":"python","code":"import socket\ns=socket.socket()\ns.settimeout(3)\ntry:\n    s.connect((\"1.1.1.1\",53))\n    print(\"EGRESS-REACHED\")\nexcept Exception as e:\n    print(\"EGRESS-BLOCKED\")"}' || true)
grep -q 'EGRESS-BLOCKED' <<<"$net_out" && ok "sandbox has no outbound network (internal-only network)" || bad "sandbox reached the network: $net_out"

head_ "AutoGPT runners"
expect "primary refuses an unauthenticated caller" "https://$AIRA_AUTOGPT_PRIMARY_HOST/external-api/v1/health" 401
expect "secondary refuses an unauthenticated caller" "https://$AIRA_AUTOGPT_SECONDARY_HOST/external-api/v1/health" 401
expect "primary health passes with its own key" "https://$AIRA_AUTOGPT_PRIMARY_HOST/external-api/v1/health" 200 \
  -H "X-API-Key: $AUTOGPT_PRIMARY_RUNNER_API_KEY"
expect "secondary health passes with its own key" "https://$AIRA_AUTOGPT_SECONDARY_HOST/external-api/v1/health" 200 \
  -H "X-API-Key: $AUTOGPT_SECONDARY_RUNNER_API_KEY"
expect "the primary key is rejected by the secondary (targets are independent)" \
  "https://$AIRA_AUTOGPT_SECONDARY_HOST/external-api/v1/health" 401 \
  -H "X-API-Key: $AUTOGPT_PRIMARY_RUNNER_API_KEY"
expect "the adapter's private NVIDIA surface is not published" \
  "https://$AIRA_AUTOGPT_PRIMARY_HOST/internal/v1/models" 404
[[ "$AIRA_AUTOGPT_PRIMARY_HOST" != "$AIRA_AUTOGPT_SECONDARY_HOST" ]] \
  && ok "primary and secondary base URLs are distinct" \
  || bad "primary and secondary base URLs are identical"

if [[ -n "${AIRA_DEERFLOW_HOST:-}" ]] && docker ps --format '{{.Names}}' | grep -q deer-flow; then
  head_ "DeerFlow"
  expect "health endpoint answers unauthenticated (as AIRA probes it)" "https://$AIRA_DEERFLOW_HOST/health" 200
  expect "threads API refuses an unauthenticated caller" "https://$AIRA_DEERFLOW_HOST/api/threads" 401 -X POST \
    -H 'Content-Type: application/json' -d '{}'
  expect "interactive API docs are not served" "https://$AIRA_DEERFLOW_HOST/docs" 404
  expect "the OpenAPI schema is not served" "https://$AIRA_DEERFLOW_HOST/openapi.json" 404
fi

head_ "Private ports are not publicly reachable"
public_ip="${AIRA_PUBLIC_IP:-$(curl -fsS --max-time 10 https://api.ipify.org || true)}"
if [[ -n "$public_ip" ]]; then
  for port in 8090 8091 8096 8097 2026 6379; do
    if timeout 5 bash -c "</dev/tcp/$public_ip/$port" 2>/dev/null; then
      bad "port $port is reachable on the public interface"
    else
      ok "port $port is not reachable on the public interface"
    fi
  done
else
  bad "could not determine the public IP to probe private ports"
fi

head_ "Restart policy"
missing_restart=$(
  for project in aira-foundation aira-autogpt-primary aira-autogpt-secondary aira-edge deer-flow; do
    docker ps --format '{{.Names}}' --filter "label=com.docker.compose.project=$project"
  done | sort -u | while read -r name; do
    [[ -n "$name" ]] || continue
    policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null)
    [[ "$policy" == "unless-stopped" || "$policy" == "always" ]] || echo "$name:$policy"
  done
)
[[ -z "$missing_restart" ]] && ok "every running container restarts automatically" \
  || bad "containers without a restart policy: $missing_restart"
systemctl is-enabled docker >/dev/null 2>&1 && ok "docker starts at boot" || bad "docker is not enabled at boot"

printf '\n\033[1m%s\033[0m\n' "Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || {
  echo "Do NOT enable these integrations in Vercel until every check passes." >&2
  exit 1
}
echo "Host is cleared for Vercel configuration."
