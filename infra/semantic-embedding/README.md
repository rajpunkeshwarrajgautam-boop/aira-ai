# AIRA FREE semantic-embedding runtime

This directory contains the operator assets for the production-reachable FREE semantic-memory embedding service required by AIRA.

## Contract

- FREE semantic memory uses a dedicated self-hosted OpenAI-compatible endpoint.
- Default model: `nomic-embed-text-v1.5`.
- Vector dimensions: 768.
- Document/memory inputs use `search_document:`; retrieval queries use `search_query:`. AIRA adds these prefixes server-side.
- FREE never falls through to the PRO embedding credential, the legacy `AIRA_EMBEDDING_*` credential, or `OPENAI_API_KEY`.
- If the FREE embedding endpoint is unavailable, semantic enrichment degrades to lexical memory.
- Production AIRA on Vercel cannot reach a user's Windows `localhost` or `127.0.0.1`.

The server implementation is llama.cpp `llama-server`, pinned by commit in `scripts/bootstrap-host.sh`. llama.cpp exposes an OpenAI-compatible `POST /v1/embeddings` endpoint for embedding models. The selected Nomic GGUF is checksum-pinned in the same script.

## Production topology

```text
Vercel AIRA
  -> HTTPS + Bearer auth
  -> Caddy on OCI public IP/domain :443
  -> 127.0.0.1:8080
  -> llama-server --embedding --pooling mean
  -> nomic-embed-text-v1.5.Q8_0.gguf
```

Only ports 80/443 are public. SSH is restricted to operator CIDRs. llama-server binds to loopback and is never exposed directly.

## Oracle Always Free sizing

The OCI Terraform module is intentionally isolated from DeerFlow. It defaults to:

- `VM.Standard.A1.Flex`
- 1 OCPU
- 6 GB RAM
- 50 GB boot volume

Oracle's current Always Free documentation describes the Ampere A1 allowance as 1,500 OCPU-hours plus 9,000 GB-hours monthly, equivalent to 2 OCPUs / 12 GB RAM for an Always Free tenancy, with 200 GB total Always Free block storage. The defaults therefore consume half of the current A1 CPU/RAM allowance and the minimum practical boot volume. Existing tenancy usage must still be checked before apply.

Do not change this module to a billable shape to work around A1 capacity errors.

## 1. Provision the host

Prerequisites on the operator machine:

- Terraform >= 1.6
- a working OCI API configuration (`~/.oci/config` or supported `OCI_*` environment variables)
- an SSH public key
- a specific operator IPv4 CIDR such as `203.0.113.50/32`

```bash
cd infra/semantic-embedding/terraform-oci
cp terraform.tfvars.example terraform.tfvars
# Fill compartment_ocid, ssh_public_key and admin_ipv4_cidrs.
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
terraform output -raw public_ip
```

`terraform.tfvars` is gitignored and must never contain an OCI private API key.

## 2. Point a hostname at the public IP

Use an AIRA-controlled hostname such as `embed.example.com` with an A/AAAA record pointing to the instance. Caddy obtains and renews a public TLS certificate automatically once DNS is correct and ports 80/443 reach the host.

Do not use a local-only hostname or self-signed certificate for Vercel Production.

## 3. Bootstrap the host

Generate a dedicated random bearer token outside the repository. Never commit it.

Copy `scripts/bootstrap-host.sh` to the host, then run it as root with the hostname and token provided through environment variables:

```bash
sudo env \
  EMBEDDING_PUBLIC_HOST='embed.example.com' \
  AIRA_EMBEDDING_AUTH_TOKEN='<dedicated-secret>' \
  bash ./bootstrap-host.sh
```

The bootstrap script:

- installs build dependencies and the official Caddy package;
- builds llama.cpp from the pinned commit;
- downloads and SHA-256 verifies the Nomic Q8_0 GGUF;
- runs llama-server as an unprivileged systemd service bound to `127.0.0.1:8080`;
- configures Caddy HTTPS and exact bearer-header authentication;
- enables restart-on-failure and a health/readiness gate.

## 4. Verify the real endpoint

From a machine outside OCI:

```bash
python infra/semantic-embedding/scripts/verify_endpoint.py \
  --base-url https://embed.example.com/v1 \
  --token '<dedicated-secret>'
```

The verifier sends a real `POST /v1/embeddings`, checks the OpenAI-compatible response shape, verifies exactly 768 finite numeric elements, and never prints the vector or token.

## 5. Configure Vercel Preview first

The connected Vercel tool used by ChatGPT currently exposes deployments/logs but not project environment-variable mutation. Use the Vercel dashboard or authenticated Vercel CLI to configure Preview only:

```text
SEMANTIC_MEMORY_ENABLED=true
AIRA_FREE_EMBEDDING_PROVIDER=self-hosted
AIRA_FREE_EMBEDDING_BASE_URL=https://embed.example.com/v1
AIRA_FREE_EMBEDDING_API_KEY=<dedicated-secret>
AIRA_FREE_EMBEDDING_MODEL=nomic-embed-text-v1.5
AIRA_FREE_EMBEDDING_DIMENSIONS=768
```

Do not enable Production until Preview proves the complete FREE write/query path, controlled FREE-endpoint failure degrades to lexical memory, and no PRO/OpenAI embedding route is attempted.

PRO/TEAM remains separately configured with `AIRA_PRO_EMBEDDING_*`; do not reuse the normal generation `OPENAI_API_KEY`.

## 6. Rollout gate

Production activation requires all of the following:

- endpoint reachable from Vercel over valid HTTPS;
- bearer authentication enforced;
- real response vector length = 768;
- authenticated FREE Preview memory write creates `UserMemorySemanticEmbedding` with `tier=free`, the expected provider/model, and a non-null vector;
- semantic query uses the same FREE route;
- controlled FREE provider outage keeps lexical memory usable and produces zero paid embedding attempts;
- RLS/ownership remains intact;
- CI and Vercel Preview are green;
- no secret or memory/document content appears in runtime logs.

If any gate is missing, leave Production semantic memory disabled.