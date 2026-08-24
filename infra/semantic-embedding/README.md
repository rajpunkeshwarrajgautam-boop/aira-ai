# AIRA FREE semantic-embedding runtime

AIRA's FREE semantic-memory tier uses Cloudflare Workers AI through its OpenAI-compatible embeddings endpoint.

## Contract

- FREE provider: `cloudflare`
- FREE model: `@cf/baai/bge-base-en-v1.5`
- dimensions: 768
- server-only credential: `AIRA_FREE_EMBEDDING_API_KEY`
- server-authoritative routing: FREE never reads PRO, legacy paid, or general OpenAI embedding credentials
- provider failure degrades to lexical memory; there is no FREE → PRO semantic fallback

Cloudflare documents an OpenAI-compatible base URL of:

`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`

Workers AI currently includes a 10,000-neuron daily free allocation. `@cf/baai/bge-base-en-v1.5` is priced at 6,058 neurons per million input tokens. When the free allocation is exhausted, Cloudflare returns HTTP 429; AIRA classifies that as a rate-limit failure and degrades to lexical memory instead of crossing to the paid semantic route.

A user-run operator verification on 2026-08-24 called the Workers AI OpenAI-compatible embeddings endpoint using the dedicated AIRA token and reported:

- model: `@cf/baai/bge-base-en-v1.5`
- vector length: 768
- all returned vector values finite
- observed request latency: 946 ms

The token and raw vector were not shared with the repository or ChatGPT. This proves provider compatibility only; it does not replace the required AIRA Preview write/query and failure-isolation tests.

## Preview configuration

Configure these values in Vercel **Preview only** first:

```text
SEMANTIC_MEMORY_ENABLED=true
AIRA_FREE_EMBEDDING_PROVIDER=cloudflare
AIRA_FREE_EMBEDDING_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AIRA_FREE_EMBEDDING_API_KEY=<dedicated Workers AI token>
AIRA_FREE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
AIRA_FREE_EMBEDDING_DIMENSIONS=768
```

Never commit the Account token. The account ID is not a secret, but keeping it in environment configuration avoids coupling source code to one Cloudflare account.

Do not use `NEXT_PUBLIC_` for any embedding credential. After changing Preview variables, redeploy the current PR head and verify that exact deployment before testing semantic runtime behavior.

## Endpoint verification

The included verifier tests the exact OpenAI-compatible route without printing the token or vector:

```bash
python infra/semantic-embedding/scripts/verify_endpoint.py \
  --base-url 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1' \
  --token '<dedicated Workers AI token>'
```

It requires HTTPS, verifies unauthenticated access is rejected, makes real embedding calls, requires exactly 768 finite values, and reports only safe latency/contract metadata.

## Production activation gate

Leave Production semantic memory disabled until Preview proves all of the following:

1. Vercel can call the Cloudflare OpenAI-compatible embeddings API;
2. an authenticated FREE memory write creates `UserMemorySemanticEmbedding` with `tier=free`, `provider=cloudflare`, model `@cf/baai/bge-base-en-v1.5`, 768 dimensions, and a non-null vector;
3. a semantically related FREE query uses the same route and retrieves only the current user's matching vector space;
4. FREE still works while the rich semantic route is deliberately unusable in Preview;
5. a controlled Cloudflare FREE-route failure degrades to lexical memory with zero PRO/OpenAI embedding attempts;
6. RLS and ownership remain intact;
7. runtime logs contain no token, memory text, document text, query text, user identity, or raw vector;
8. repository CI and the exact Preview deployment are green.

## Why OCI assets were removed

An earlier version of this rollout prepared an OCI A1 VM, Caddy, llama.cpp, and Nomic. The real Cloudflare Workers AI endpoint was subsequently verified and provides the required hosted 768-dimensional FREE embedding route without a VM, SSH, DNS, TLS, patching, or capacity-management burden. The OCI-specific Terraform/bootstrap assets are therefore intentionally retired from this PR instead of being merged as unused infrastructure.
