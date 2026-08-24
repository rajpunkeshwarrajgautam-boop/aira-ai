# AIRA semantic-memory tiers

Semantic memory is a derived retrieval index. `UserMemory` remains canonical and normal lexical recall must continue to work when semantic embeddings are disabled or unavailable.

## Product policy

- **FREE** uses a dedicated self-hosted/low-cost OpenAI-compatible embedding endpoint. The default model contract is `nomic-embed-text-v1.5` at its native 768 dimensions. FREE never falls through to the PRO credential or to `OPENAI_API_KEY`.
- **PRO / TEAM** use the richer dedicated embedding route. The default is OpenAI `text-embedding-3-small` with the response explicitly requested at 768 dimensions.
- If either tier's embedding route is unavailable, AIRA degrades to lexical memory rather than crossing tiers.

The two models do **not** share an embedding space even though both routes use 768-dimensional storage. AIRA stores tier/provider/model metadata and queries only rows matching the user's current server-side route. A plan upgrade/downgrade therefore never compares a FREE vector against a PRO query vector or vice versa.

## FREE endpoint topology

`AIRA_FREE_EMBEDDING_BASE_URL` must be reachable from the AIRA server process and expose an OpenAI-compatible `/v1/embeddings` API. `llama.cpp` supports an OpenAI-compatible embeddings route when an embedding-capable model is served in embedding mode.

A public Vercel deployment cannot reach a user's Windows `localhost` or `127.0.0.1`. A production FREE embedding service must therefore run on infrastructure reachable by Vercel, normally an AIRA-controlled HTTPS host/private gateway or another explicitly approved low-cost endpoint.

The FREE API key is optional for self-hosted endpoints that do not require authentication. If the service requires authentication, configure `AIRA_FREE_EMBEDDING_API_KEY` server-side.

## Nomic retrieval contract

`nomic-embed-text-v1.5` requires task prefixes for retrieval. AIRA emits:

- `search_document: ...` for memory/document vectors
- `search_query: ...` for retrieval queries

The model's native 768-dimensional representation is used; vectors are not padded, truncated, duplicated, or projected.

## PRO / TEAM contract

Configure the rich route with `AIRA_PRO_EMBEDDING_*`. `AIRA_PRO_EMBEDDING_API_KEY` is intentionally separate from the normal chat-generation `OPENAI_API_KEY`.

Legacy `AIRA_EMBEDDING_*` variables are accepted only as a temporary PRO/TEAM compatibility alias. The FREE route never reads them.

## Storage

Tier-aware embeddings are stored in additive derived-index tables:

- `UserMemorySemanticEmbedding`
- `KnowledgeChunkSemanticEmbedding`

Both use 768-dimensional pgvector columns and include `tier`, `provider`, `model`, and content-hash metadata. Canonical memory/document rows are not deleted when embeddings fail.

The legacy 1536-dimensional embedding columns/tables remain untouched by this migration. New tier-aware code does not query them.

## Rollout gate

Keep `SEMANTIC_MEMORY_ENABLED=false` in Production until all of the following are true:

1. the tier-aware migration is applied;
2. a real FREE embedding endpoint exists and is reachable from Production;
3. the FREE model contract is verified;
4. the PRO/TEAM embedding credential is configured if paid semantic memory will be enabled;
5. Preview proves FREE never consumes the PRO credential;
6. provider failure degrades to lexical memory;
7. runtime logs contain no secrets or memory/document content.
