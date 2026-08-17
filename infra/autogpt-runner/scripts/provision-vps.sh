#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo ./scripts/provision-vps.sh"
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "This installer supports Ubuntu VPS hosts only."
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This installer supports Ubuntu only; detected ${ID:-unknown}."
  exit 1
fi

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${RUNNER_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

read -r -p "VPS runner hostname (for example autogpt-primary.example.com): " runner_domain
read -r -s -p "NVIDIA API key: " nvidia_api_key
echo

if [[ -z "${runner_domain}" || -z "${nvidia_api_key}" ]]; then
  echo "A hostname and NVIDIA API key are required."
  exit 1
fi

runner_api_key="$(openssl rand -hex 32)"
internal_token="sk-$(openssl rand -hex 32)"

umask 077
{
  echo "RUNNER_API_KEY=${runner_api_key}"
  echo "AUTOGPT_INTERNAL_TOKEN=${internal_token}"
  echo "NVIDIA_API_KEY=${nvidia_api_key}"
  echo "AIRA_GRAPH_ID=aira-objective-runner"
  echo "AIRA_GRAPH_VERSION=1"
  echo "AUTOGPT_MAX_STEPS=12"
  echo "AUTOGPT_MAX_CONCURRENT_RUNS=1"
  echo "AUTOGPT_UPSTREAM_TIMEOUT_SECONDS=180"
  echo "NVIDIA_API_URL=https://integrate.api.nvidia.com/v1"
  echo "NVIDIA_SMART_MODEL=nvidia/nemotron-3-nano-30b-a3b"
  echo "NVIDIA_FAST_MODEL=nvidia/nemotron-3-nano-30b-a3b"
  echo "NVIDIA_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5"
  echo "AUTOGPT_COMMIT=601093ddfe23a3d58a9c8f4a208bd49b203ee612"
  echo "RUNNER_DOMAIN=${runner_domain}"
  echo "CLOUDFLARE_TUNNEL_TOKEN="
} > .env

docker compose -f compose.yml -f compose.vps.yml up -d --build

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
fi

echo
echo "VPS runner started. Configure these Vercel values:"
echo "AUTOGPT_PRIMARY_API_BASE_URL=https://${runner_domain}/external-api/v1"
echo "AUTOGPT_PRIMARY_API_KEY=${runner_api_key}"
echo
echo "Health check:"
echo "curl -H 'X-API-Key: ${runner_api_key}' https://${runner_domain}/external-api/v1/health"
