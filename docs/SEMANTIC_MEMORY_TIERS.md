# AIRA semantic-memory tiers

Semantic memory is a derived retrieval index. `UserMemory` remains canonical and normal lexical recall must continue to work when semantic embeddings are disabled or unavailable.

## Product policy

- **FREE** uses Cloudflare Workers AI with provider id `cloudflare` and model `@cf/baai/bge-base-en-v1.5`, which returns 768-dimensional embeddings. FREE never falls through to the PRO credential, the legacy `AIRA_EMBEDDING_*` credential, or `OPENAI_API_KEY`.
- **PRO / TEAM** use the richer dedicated embedding route. The default is OpenAI `text-embedding-3-small` with the response explicitly requested at 768 dimensions.
- If either tier's embedding route is unavailable, AIRA degrades to lexical memory rather than crossing tiers.

The FREE and PRO models do **not** share an embedding space even though both routes use 768-dimensional storage. AIRA stores tier/provider/model metadata and queries only rows matching the user's current server-side route. A plan upgrade/downgrade therefore never compares a FREE vector against a PRO query vector or vice versa.

## FREE Cloudflare Workers AI contract

Configure the FREE route with the OpenAI-compatible Workers AI base URL for the AIRA Cloudflare account:

`https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`

Server-only configuration:

- `AIRA_FREE_EMBEDDING_PROVIDER=cloudflare`
- `AIRA_FREE_EMBEDDING_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1`
- `AIRA_FREE_EMBEDDING_API_KEY=<dedicated Workers AI token>`
- `AIRA_FREE_EMBEDDING_MODEL=@cf/baai/bge-base-en-v1.5`
- `AIRA_FREE_EMBEDDING_DIMENSIONS=768`

The Workers AI token must remain server-only. Do not use a `NEXT_PUBLIC_` variable and do not commit it. FREE requires its dedicated Cloudflare credential; missing or invalid FREE configuration returns no semantic route and callers degrade to lexical memory. FREE never inherits the paid semantic credential.

Cloudflare currently includes 10,000 Workers AI neurons/day on the Free plan. If that allocation is exhausted, the provider returns a rate-limit failure and AIRA remains on lexical fallback rather than crossing into the PRO semantic route.

A user-run operator verification on 2026-08-24 confirmed the Workers AI OpenAI-compatible `/v1/embeddings` route returned exactly 768 finite values for `@cf/baai/bge-base-en-v1.5` with an observed latency of 946 ms. The token and raw vector were not shared. Runtime activation still requires Preview application-level verification before Production is enabled.

## PRO / TEAM contract

Configure the rich route with `AIRA_PRO_EMBEDDING_*`. `AIRA_PRO_EMBEDDING_API_KEY` is intentionally separate from the normal chat-generation `OPENAI_API_KEY`.

Legacy `AIRA_EMBEDDING_*` variables are accepted only as a temporary PRO/TEAM compatibility alias. The FREE route never reads them.

## Storage and model-space isolation

Tier-aware embeddings are stored in additive derived-index tables:

- `UserMemorySemanticEmbedding`
- `KnowledgeChunkSemanticEmbedding`

Both use 768-dimensional pgvector columns and include `tier`, `provider`, `model`, and content-hash metadata. Canonical memory/document rows are not deleted when embeddings fail.

The legacy 1536-dimensional embedding columns/tables remain untouched. New tier-aware code does not query them.

AIRA deliberately uses exact vector ordering after filtering the current user's exact `tier + provider + model` route. It does **not** maintain a tier-only HNSW index. Route metadata has normal B-tree indexes for filtering, and exact vector scoring is used until AIRA has a provider/model-specific ANN indexing strategy justified by real scale measurements.

## Rollout gate

Keep `SEMANTIC_MEMORY_ENABLED=false` in Production until all of the following are true:

1. the tier-aware migration is applied;
2. Preview is configured with the dedicated Workers AI FREE route;
3. an authenticated FREE Preview write creates a `tier=free`, `provider=cloudflare`, `model=@cf/baai/bge-base-en-v1.5` semantic row;
4. an authenticated FREE semantic query uses the same route;
5. Preview proves FREE still works while the PRO semantic route is unusable;
6. controlled FREE provider failure degrades to lexical memory with zero paid embedding attempts;
7. runtime logs contain no secrets or memory/document content;
8. CI and the exact Preview deployment are green.
