-- Tier-aware semantic embeddings can change provider/model over time.
-- A tier-only ANN index would contain vectors from incompatible model spaces
-- during a rollout or plan/model transition. Use exact user+route scans until
-- AIRA has a provider/model-specific ANN indexing strategy.

begin;

drop index if exists public."UserMemorySemanticEmbedding_free_hnsw_idx";
drop index if exists public."UserMemorySemanticEmbedding_pro_hnsw_idx";
drop index if exists public."KnowledgeChunkSemanticEmbedding_free_hnsw_idx";
drop index if exists public."KnowledgeChunkSemanticEmbedding_pro_hnsw_idx";

create index if not exists "UserMemorySemanticEmbedding_route_idx"
  on public."UserMemorySemanticEmbedding" ("userId", tier, provider, model);

create index if not exists "KnowledgeChunkSemanticEmbedding_route_idx"
  on public."KnowledgeChunkSemanticEmbedding" ("userId", tier, provider, model);

commit;
