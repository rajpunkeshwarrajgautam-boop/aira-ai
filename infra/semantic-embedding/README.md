# AIRA FREE semantic-embedding runtime

AIRA's FREE semantic-memory tier uses Cloudflare Workers AI through its OpenAI-compatible embeddings endpoint.

## Runtime contract

- provider: `cloudflare`
- model: `@cf/baai/bge-base-en-v1.5`
- dimensions: 768
- server-only token: `AIRA_FREE_EMBEDDING_API_KEY`
- no FREE → PRO/OpenAI semantic fallback
- provider failure → lexical memory

Cloudflare OpenAI-compatible base URL:

`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`

Cloudflare currently includes 10,000 Workers AI neurons/day on the Free plan. If the allocation is exhausted, AIRA treats the provider 429 as a semantic rate-limit failure and remains on lexical memory.

A user-run test on 2026-08-24 verified a real Workers AI embedding call for `@cf/baai/bge-base-en-v1.5`: 768 finite values, observed latency 946 ms. The token and raw vector were not shared.

## Preview configuration

```text
SEMANTIC_MEMORY_ENABLED=true
AIRA_FREE_EMBEDDING_PROVIDER=cloudflare
AIRA_FREE_EMBEDDING_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AIRA_FREE_EMBEDDING_API_KEY=<dedicated Workers AI token>
AIRA_FREE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
AIRA_FREE_EMBEDDING_DIMENSIONS=768
```

Never commit the token or expose it through `NEXT_PUBLIC_`. Configure Preview first; Production remains disabled until the Preview gates below pass. After changing Preview environment values, environment scopes, or rotating a secret in Vercel, create a fresh Preview deployment before runtime testing so the new values are injected into the server runtime.

The included `scripts/verify_endpoint.py` can repeat the external API compatibility check without printing the token or vector.

## Production gate

Do not enable semantic memory in Production until Preview proves:

1. authenticated FREE memory write creates a `tier=free`, `provider=cloudflare`, BGE/768 vector row;
2. FREE semantic retrieval uses the same route;
3. FREE remains functional when the PRO semantic route is unusable;
4. controlled Cloudflare failure falls back to lexical recall with zero paid embedding attempts;
5. RLS/user isolation stays intact;
6. runtime logs contain no secrets or user content;
7. repository CI and the exact Preview deployment are green.
