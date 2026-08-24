# AIRA semantic-memory tiers

Semantic memory is a derived retrieval index. `UserMemory` remains canonical and lexical recall must continue to work when semantic embeddings are disabled or unavailable.

## Product policy

- **FREE** → Cloudflare Workers AI, provider `cloudflare`, model `@cf/baai/bge-base-en-v1.5`, 768 dimensions.
- **PRO / TEAM** → richer dedicated semantic route, default OpenAI `text-embedding-3-small` requested at 768 dimensions.
- FREE never reads `AIRA_PRO_EMBEDDING_API_KEY`, legacy `AIRA_EMBEDDING_API_KEY`, or `OPENAI_API_KEY`.
- Either tier degrades to lexical memory on semantic-provider failure instead of crossing tiers.

Same dimension does not mean same vector space. Retrieval is filtered by the authenticated user's exact `tier + provider + model` before similarity ranking, so Cloudflare BGE vectors are never compared with OpenAI vectors.

## FREE Cloudflare configuration

Use the OpenAI-compatible Workers AI base URL:

`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`

Server-only variables:

```text
SEMANTIC_MEMORY_ENABLED=true
AIRA_FREE_EMBEDDING_PROVIDER=cloudflare
AIRA_FREE_EMBEDDING_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
AIRA_FREE_EMBEDDING_API_KEY=<dedicated Workers AI token>
AIRA_FREE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5
AIRA_FREE_EMBEDDING_DIMENSIONS=768
```

The token must never use a `NEXT_PUBLIC_` variable or be committed. Missing/invalid FREE configuration returns no semantic route, so callers remain on lexical memory.

Cloudflare currently includes 10,000 Workers AI neurons/day on the Free plan. Exhaustion returns a provider rate-limit failure; AIRA must remain on lexical fallback rather than crossing to the PRO route.

A user-run verification on 2026-08-24 confirmed the real OpenAI-compatible endpoint returned 768 finite values for `@cf/baai/bge-base-en-v1.5` with an observed latency of 946 ms. The token and vector were not shared.

## PRO / TEAM

Configure `AIRA_PRO_EMBEDDING_*`. `AIRA_PRO_EMBEDDING_API_KEY` stays separate from normal chat `OPENAI_API_KEY`. Legacy `AIRA_EMBEDDING_*` is only a temporary PRO/TEAM compatibility alias.

## Storage

Derived indexes:

- `UserMemorySemanticEmbedding`
- `KnowledgeChunkSemanticEmbedding`

Both use `vector(768)` and store tier/provider/model metadata. `UserMemory` remains canonical. Exact filtered vector scoring is used; there is no tier-only HNSW index.

## Production gate

Keep Production semantic memory disabled until Preview proves:

1. FREE write creates a `tier=free`, `provider=cloudflare`, BGE 768-dimensional row;
2. FREE semantic query uses the same route;
3. FREE works while the PRO semantic route is unusable;
4. controlled Cloudflare failure degrades to lexical memory with zero paid embedding attempts;
5. no secret/content leakage occurs;
6. CI and the exact Preview deployment are green.
