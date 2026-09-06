-- Complete the forward-compatible repair for the historical 20260824 order.
-- The existing tiered-semantic migration recreates tier-only HNSW indexes
-- after the historical exact-route migration. Reassert the intended invariant
-- after both historical migrations have executed.

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
