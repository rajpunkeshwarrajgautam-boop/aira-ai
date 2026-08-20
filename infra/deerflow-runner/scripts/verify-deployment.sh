#!/usr/bin/env bash
#
# AIRA DeerFlow deployment verification.
#
# Implements the runbook gate in infra/deerflow-runner/README.md as one command,
# so "verified" is a reproducible result rather than a judgement call. It changes
# nothing: every check is a read. Run the host checks on the DeerFlow host, then
# the public checks from a trusted machine outside it.
#
#   sudo bash infra/deerflow-runner/scripts/verify-deployment.sh --host
#   bash infra/deerflow-runner/scripts/verify-deployment.sh --public https://deerflow.example.com
#   bash infra/deerflow-runner/scripts/verify-deployment.sh --self-test
#
# Exit status is 0 only when every executed check passed. No secret value is ever
# printed: the script reports whether a secret is present and well-formed, never
# what it is.

set -Eeuo pipefail

DEERFLOW_PIN="a5acc25de6742b2166b3f41c97bd895822277b94"
INSTALL_ROOT="${DEERFLOW_INSTALL_ROOT:-/opt/aira/deer-flow}"
STATE_ROOT="${DEERFLOW_STATE_ROOT:-/var/lib/deer-flow}"
# Upstream's production Compose publishes exactly one host port: nginx on
# ${BIND_HOST:-127.0.0.1}:${PORT:-2026}. The Gateway listens on 8001 inside the
# container network and is NOT published, so probing 127.0.0.1:8001 from the host
# fails even on a correctly deployed stack. Reach the Gateway through nginx, which
# proxies /health and /api/* to it. The Gateway's own 8001 probe still runs, as
# the container healthcheck, and is read below via `docker inspect`.
GATEWAY_HEALTH_URL="${DEERFLOW_GATEWAY_HEALTH_URL:-http://127.0.0.1:2026/health}"
GATEWAY_MODELS_URL="${DEERFLOW_GATEWAY_MODELS_URL:-http://127.0.0.1:2026/api/models}"
GATEWAY_DOCS_URL="${DEERFLOW_GATEWAY_DOCS_URL:-http://127.0.0.1:2026/docs}"
MIN_TOKEN_LENGTH=32

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() { printf '  [PASS] %s\n' "$*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf '  [FAIL] %s\n' "$*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }
skip() { printf '  [SKIP] %s\n' "$*"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
section() { printf '\n== %s ==\n' "$*"; }

usage() {
	cat <<'USAGE'
Usage:
  verify-deployment.sh --host                 Checks to run ON the DeerFlow host.
  verify-deployment.sh --public <base-url>    Checks to run from OUTSIDE, through TLS.
  verify-deployment.sh --self-test            Validates this script's own logic. No network.
  verify-deployment.sh --help
USAGE
}

# ---------------------------------------------------------------------------
# Pure helpers. Kept side-effect free so --self-test can exercise them without a
# DeerFlow host, which lets CI catch a regression in this script itself.
# ---------------------------------------------------------------------------

# A production AIRA base URL must be HTTPS and carry no credentials/query/fragment,
# mirroring the validation in the AIRA server-side DeerFlow config loader.
is_valid_public_base_url() {
	local url="$1"
	[[ "$url" =~ ^https://[A-Za-z0-9._~-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%/-]*)?$ ]]
}

# Secrets are judged by shape only. The value is never echoed.
is_strong_secret() {
	local value="$1"
	[[ ${#value} -ge $MIN_TOKEN_LENGTH ]]
}

# The gateway must not publish interactive API docs on a public deployment.
docs_are_disabled() {
	local status="$1"
	[[ "$status" == "404" || "$status" == "401" || "$status" == "403" ]]
}

# Prints exactly three digits. curl already emits 000 on a transport failure, so
# the fallback must only cover the case where curl printed nothing at all.
http_status() {
	local status
	status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null)" || true
	[[ "$status" =~ ^[0-9]{3}$ ]] && printf '%s' "$status" || printf '000'
}

require_command() {
	command -v "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Host checks
# ---------------------------------------------------------------------------

check_host() {
	section "Pinned source"
	if [[ -d "$INSTALL_ROOT/.git" ]]; then
		local actual
		actual="$(git -C "$INSTALL_ROOT" rev-parse HEAD 2>/dev/null || printf 'unknown')"
		if [[ "$actual" == "$DEERFLOW_PIN" ]]; then
			pass "DeerFlow checkout is at the validated pin ${DEERFLOW_PIN:0:12}"
		else
			fail "DeerFlow checkout is at ${actual:0:12}, expected ${DEERFLOW_PIN:0:12}"
		fi
	else
		fail "No DeerFlow checkout at $INSTALL_ROOT (run provision-vps.sh first)"
	fi

	section "Runtime configuration"
	if [[ -f "$INSTALL_ROOT/config.yaml" ]]; then
		pass "config.yaml is present"
		if grep -qE '^[^#]*\b(sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,})' "$INSTALL_ROOT/config.yaml"; then
			fail "config.yaml appears to contain a literal API key; use \$VARIABLE substitution instead"
		else
			pass "config.yaml contains no literal API key"
		fi
	else
		fail "config.yaml is missing"
	fi

	if [[ -f "$INSTALL_ROOT/.env" ]]; then
		local mode
		mode="$(stat -c '%a' "$INSTALL_ROOT/.env" 2>/dev/null || printf 'unknown')"
		[[ "$mode" == "600" ]] && pass ".env is mode 600" || fail ".env is mode $mode, expected 600"

		# shellcheck disable=SC2016
		if grep -q '^GATEWAY_ENABLE_DOCS=false' "$INSTALL_ROOT/.env"; then
			pass "Gateway API docs are disabled"
		else
			fail "GATEWAY_ENABLE_DOCS=false is not set in .env"
		fi
		if grep -q '^BIND_HOST=127.0.0.1' "$INSTALL_ROOT/.env"; then
			pass "Gateway binds to loopback (TLS front door required)"
		else
			fail "BIND_HOST=127.0.0.1 is not set; the Gateway may be directly exposed"
		fi

		local token
		token="$(grep '^DEER_FLOW_INTERNAL_AUTH_TOKEN=' "$INSTALL_ROOT/.env" | cut -d= -f2- || true)"
		if [[ -z "$token" ]]; then
			fail "DEER_FLOW_INTERNAL_AUTH_TOKEN is not set"
		elif is_strong_secret "$token"; then
			pass "Internal auth token is present and at least $MIN_TOKEN_LENGTH characters"
		else
			fail "Internal auth token is shorter than $MIN_TOKEN_LENGTH characters"
		fi
	else
		fail ".env is missing at $INSTALL_ROOT/.env"
	fi

	section "Persistent state"
	if [[ -d "$STATE_ROOT" ]]; then
		local mode
		mode="$(stat -c '%a' "$STATE_ROOT" 2>/dev/null || printf 'unknown')"
		[[ "$mode" == "700" ]] && pass "State root is mode 700" || fail "State root is mode $mode, expected 700"
	else
		fail "State root $STATE_ROOT does not exist"
	fi

	section "Containers"
	if require_command docker; then
		if docker compose -p deer-flow -f "$INSTALL_ROOT/docker/docker-compose.yaml" ps >/dev/null 2>&1; then
			pass "Compose project deer-flow is readable"
			local unhealthy
			unhealthy="$(docker compose -p deer-flow -f "$INSTALL_ROOT/docker/docker-compose.yaml" ps \
				--format '{{.Name}} {{.State}}' 2>/dev/null | grep -cvE ' (running|healthy)$' || true)"
			[[ "$unhealthy" == "0" ]] && pass "All Compose services are running" \
				|| fail "$unhealthy Compose service(s) are not running"
		else
			fail "Compose project deer-flow is not up"
		fi
	else
		skip "docker is not installed on this machine"
	fi

	section "Local gateway"
	local health_status models_status docs_status
	health_status="$(http_status "$GATEWAY_HEALTH_URL")"
	[[ "$health_status" == "200" ]] && pass "Gateway /health returns 200 through nginx" \
		|| fail "Gateway /health returned $health_status"
	models_status="$(http_status "$GATEWAY_MODELS_URL")"
	[[ "$models_status" == "200" ]] && pass "At least one model is configured (/api/models returns 200)" \
		|| fail "/api/models returned $models_status; configure a model provider"

	# GATEWAY_ENABLE_DOCS defaults to "true" upstream, and /docs, /redoc and
	# /openapi.json are unauthenticated AND proxied by nginx. That single variable
	# is the only thing keeping the API schema private, so confirm it took effect
	# here rather than discovering it from the public side.
	docs_status="$(http_status "$GATEWAY_DOCS_URL")"
	if docs_are_disabled "$docs_status"; then
		pass "Gateway docs are disabled locally (HTTP $docs_status)"
	else
		fail "Gateway /docs answered $docs_status; set GATEWAY_ENABLE_DOCS=false and restart"
	fi

	if require_command docker; then
		local gateway_health
		gateway_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
			deer-flow-gateway 2>/dev/null || printf 'unknown')"
		case "$gateway_health" in
			healthy) pass "Gateway container healthcheck reports healthy" ;;
			none) skip "Gateway container declares no healthcheck" ;;
			*) fail "Gateway container healthcheck reports '$gateway_health'" ;;
		esac
	fi
}

# ---------------------------------------------------------------------------
# Public checks
# ---------------------------------------------------------------------------

check_public() {
	local base="${1%/}"

	section "Public base URL"
	if is_valid_public_base_url "$base"; then
		pass "Base URL is HTTPS with no credentials, query or fragment"
	else
		fail "Base URL is not a bare HTTPS origin; AIRA will reject it in production"
		return
	fi

	section "TLS front door"
	local health_status
	health_status="$(http_status "$base/health")"
	[[ "$health_status" == "200" ]] && pass "Public /health returns 200 over TLS" \
		|| fail "Public /health returned $health_status"

	section "Exposure"
	for docs_path in /docs /redoc /openapi.json; do
		local status
		status="$(http_status "$base$docs_path")"
		if docs_are_disabled "$status"; then
			pass "$docs_path is not publicly served (HTTP $status)"
		else
			fail "$docs_path is publicly reachable (HTTP $status); set GATEWAY_ENABLE_DOCS=false"
		fi
	done

	# An unauthenticated caller must never be able to enumerate or create threads.
	local threads_status
	threads_status="$(http_status "$base/api/threads")"
	if [[ "$threads_status" == "401" || "$threads_status" == "403" || "$threads_status" == "404" ]]; then
		pass "/api/threads rejects unauthenticated callers (HTTP $threads_status)"
	else
		fail "/api/threads returned $threads_status without the internal token"
	fi

	section "Raw service ports"
	local host
	host="$(printf '%s' "$base" | sed -E 's#^https://##; s#[:/].*$##')"
	if require_command nc; then
		for port in 2026 8001 6379 5432; do
			if nc -z -w 3 "$host" "$port" >/dev/null 2>&1; then
				fail "Port $port is reachable from the public Internet; firewall it"
			else
				pass "Port $port is not publicly reachable"
			fi
		done
	else
		skip "nc is not installed; verify the firewall manually"
	fi
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

self_test() {
	section "URL validation"
	local url
	for url in \
		"https://deerflow.example.com" \
		"https://deerflow.example.com/gateway" \
		"https://deerflow.example.com:8443"
	do
		is_valid_public_base_url "$url" && pass "accepts $url" || fail "should accept $url"
	done
	for url in \
		"http://deerflow.example.com" \
		"https://user:pass@deerflow.example.com" \
		"https://deerflow.example.com?token=leak" \
		"https://deerflow.example.com#frag" \
		"ftp://deerflow.example.com" \
		"not-a-url"
	do
		is_valid_public_base_url "$url" && fail "should reject $url" || pass "rejects $url"
	done

	section "Secret shape"
	is_strong_secret "$(printf 'a%.0s' $(seq 1 $MIN_TOKEN_LENGTH))" \
		&& pass "accepts a $MIN_TOKEN_LENGTH-character secret" || fail "should accept a minimum-length secret"
	is_strong_secret "short" && fail "should reject a short secret" || pass "rejects a short secret"
	is_strong_secret "" && fail "should reject an empty secret" || pass "rejects an empty secret"

	section "Docs exposure classification"
	local status
	for status in 404 401 403; do
		docs_are_disabled "$status" && pass "treats HTTP $status as not exposed" || fail "HTTP $status misclassified"
	done
	for status in 200 301 500 000; do
		docs_are_disabled "$status" && fail "HTTP $status misclassified as safe" || pass "treats HTTP $status as exposed"
	done
}

main() {
	local mode="${1:-}"
	case "$mode" in
		--host) check_host ;;
		--public)
			[[ -n "${2:-}" ]] || { usage >&2; exit 2; }
			check_public "$2"
			;;
		--self-test) self_test ;;
		--help | -h) usage; exit 0 ;;
		*) usage >&2; exit 2 ;;
	esac

	section "Result"
	printf '  passed=%d failed=%d skipped=%d\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
	if [[ $FAIL_COUNT -gt 0 ]]; then
		printf '\nVERIFICATION FAILED. Do not set DEERFLOW_AGENT_ENABLED=true.\n' >&2
		exit 1
	fi
	printf '\nAll executed checks passed.\n'
	if [[ "$mode" != "--self-test" ]]; then
		printf 'This covers infrastructure only. Production activation still requires the\n'
		printf 'end-to-end task, artifact, cancellation and ownership-isolation tests in\n'
		printf 'infra/deerflow-runner/README.md.\n'
	fi
}

main "$@"
