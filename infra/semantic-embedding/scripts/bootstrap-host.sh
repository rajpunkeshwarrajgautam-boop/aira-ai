#!/usr/bin/env bash
set -euo pipefail

: "${EMBEDDING_PUBLIC_HOST:?Set EMBEDDING_PUBLIC_HOST to the DNS hostname that resolves to this instance.}"
: "${AIRA_EMBEDDING_AUTH_TOKEN:?Set AIRA_EMBEDDING_AUTH_TOKEN to a dedicated random bearer token.}"

if [[ ! "$EMBEDDING_PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "EMBEDDING_PUBLIC_HOST contains unsupported characters." >&2
  exit 2
fi
if [[ ! "$AIRA_EMBEDDING_AUTH_TOKEN" =~ ^[A-Za-z0-9_-]{32,128}$ ]]; then
  echo "AIRA_EMBEDDING_AUTH_TOKEN must be 32-128 URL-safe characters (A-Z, a-z, 0-9, _ or -)." >&2
  exit 2
fi
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root, e.g. sudo env EMBEDDING_PUBLIC_HOST=... AIRA_EMBEDDING_AUTH_TOKEN=... bash $0" >&2
  exit 2
fi

LLAMA_CPP_COMMIT="${LLAMA_CPP_COMMIT:-b3c3b96a139d4ef1bdec926ac17aa040981cfc5d}"
MODEL_URL="${MODEL_URL:-https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf?download=true}"
MODEL_SHA256="${MODEL_SHA256:-3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7}"
INSTALL_ROOT=/opt/aira-semantic-embedding
MODEL_DIR="$INSTALL_ROOT/models"
MODEL_PATH="$MODEL_DIR/nomic-embed-text-v1.5.Q8_0.gguf"
SRC_DIR="$INSTALL_ROOT/llama.cpp"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential ca-certificates cmake curl debian-archive-keyring debian-keyring \
  git gnupg python3 apt-transport-https

# Install the official stable Caddy Debian/Ubuntu package.
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

if ! id airaembed >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_ROOT" --shell /usr/sbin/nologin airaembed
fi
install -d -o airaembed -g airaembed -m 0750 "$INSTALL_ROOT" "$MODEL_DIR"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  git clone --filter=blob:none https://github.com/ggml-org/llama.cpp.git "$SRC_DIR"
fi
git -C "$SRC_DIR" fetch --depth 1 origin "$LLAMA_CPP_COMMIT"
git -C "$SRC_DIR" checkout --detach "$LLAMA_CPP_COMMIT"
cmake -S "$SRC_DIR" -B "$SRC_DIR/build" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON
cmake --build "$SRC_DIR/build" --config Release -j"$(nproc)" --target llama-server

if [[ ! -f "$MODEL_PATH" ]] || ! echo "$MODEL_SHA256  $MODEL_PATH" | sha256sum --check --status; then
  tmp="$(mktemp "$MODEL_PATH.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  curl --fail --location --retry 3 --retry-delay 2 "$MODEL_URL" --output "$tmp"
  echo "$MODEL_SHA256  $tmp" | sha256sum --check
  chown airaembed:airaembed "$tmp"
  chmod 0640 "$tmp"
  mv "$tmp" "$MODEL_PATH"
  trap - EXIT
fi

echo "$MODEL_SHA256  $MODEL_PATH" | sha256sum --check
chown -R airaembed:airaembed "$INSTALL_ROOT"

cat >/etc/systemd/system/aira-semantic-embedding.service <<EOF
[Unit]
Description=AIRA FREE semantic embedding runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=airaembed
Group=airaembed
WorkingDirectory=$INSTALL_ROOT
ExecStart=$SRC_DIR/build/bin/llama-server \\
  --model $MODEL_PATH \\
  --alias nomic-embed-text-v1.5 \\
  --embedding \\
  --pooling mean \\
  --ctx-size 8192 \\
  --batch-size 8192 \\
  --ubatch-size 2048 \\
  --rope-scaling yarn \\
  --rope-freq-scale 0.75 \\
  --host 127.0.0.1 \\
  --port 8080
Restart=on-failure
RestartSec=3
TimeoutStartSec=180
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_ROOT
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF

# Keep the bearer token out of the Caddyfile and out of Terraform state. The
# token format above intentionally makes systemd EnvironmentFile parsing safe.
cat >/etc/aira-semantic-embedding.env <<EOF
EMBEDDING_PUBLIC_HOST=$EMBEDDING_PUBLIC_HOST
AIRA_EMBEDDING_AUTH_TOKEN=$AIRA_EMBEDDING_AUTH_TOKEN
EOF
chown root:caddy /etc/aira-semantic-embedding.env
chmod 0640 /etc/aira-semantic-embedding.env

install -d -m 0755 /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/aira-semantic-embedding.conf <<'EOF'
[Service]
EnvironmentFile=/etc/aira-semantic-embedding.env
EOF

cat >/etc/caddy/Caddyfile <<'EOF'
{$EMBEDDING_PUBLIC_HOST} {
  route {
    @authorized {
      path /v1/embeddings
      header Authorization "Bearer {$AIRA_EMBEDDING_AUTH_TOKEN}"
    }
    reverse_proxy @authorized 127.0.0.1:8080

    @embedding path /v1/embeddings
    respond @embedding 401
    respond 404
  }
}
EOF

systemctl daemon-reload
systemctl enable --now aira-semantic-embedding.service

# Verify the actual local OpenAI-compatible embedding contract before exposing
# it through Caddy. The vector itself is deliberately never printed.
for attempt in $(seq 1 60); do
  if python3 - <<'PY'
import json
import math
import urllib.request

body = json.dumps({
    "model": "nomic-embed-text-v1.5",
    "input": "search_query: AIRA semantic memory readiness probe",
    "encoding_format": "float",
}).encode()
request = urllib.request.Request(
    "http://127.0.0.1:8080/v1/embeddings",
    data=body,
    headers={"Content-Type": "application/json", "Authorization": "Bearer no-key"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.load(response)
    vector = payload["data"][0]["embedding"]
    assert len(vector) == 768
    assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector)
except Exception:
    raise SystemExit(1)
PY
  then
    break
  fi
  if [[ "$attempt" == 60 ]]; then
    journalctl -u aira-semantic-embedding.service --no-pager -n 100 >&2 || true
    echo "llama-server did not satisfy the 768-dimensional embeddings readiness contract." >&2
    exit 1
  fi
  sleep 2
done

caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
systemctl is-active --quiet aira-semantic-embedding.service
systemctl is-active --quiet caddy

printf 'AIRA FREE embedding host bootstrap complete.\n'
printf 'Host: %s\n' "$EMBEDDING_PUBLIC_HOST"
printf 'llama.cpp commit: %s\n' "$LLAMA_CPP_COMMIT"
printf 'Model SHA-256 verified: %s\n' "$MODEL_SHA256"
printf 'The bearer token and embedding vector were not printed.\n'
