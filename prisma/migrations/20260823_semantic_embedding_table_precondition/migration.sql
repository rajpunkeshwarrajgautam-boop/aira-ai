-- Forward-compatible repair for the historical 20260824 migration ordering.
--
-- `20260824_semantic_embedding_exact_route_scans` creates indexes on these
-- tables before `20260824_tiered_semantic_embeddings` historically creates
-- them. Do not rewrite either already-shipped migration. Materialize only the
-- table prerequisites here; the existing tiered migration remains responsible
-- for its RLS/policies/supporting indexes, and the later enforcement migration
-- restores the intended exact-route index strategy after that migration runs.

begin;

create extension if not exists vector with schema extensions;

create table if not exists public."UserMemorySemanticEmbedding" (
  "memoryId" text not null references public."UserMemory"(id) on delete cascade,
  "userId" text not null references public."User"(id) on delete cascade,
  tier text not null check (tier in ('free', 'pro')),
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions = 768),
  embedding extensions.vector(768) not null,
  "contentHash" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("memoryId", tier)
);

create table if not exists public."KnowledgeChunkSemanticEmbedding" (
  "chunkId" text not null references public."KnowledgeChunk"(id) on delete cascade,
  "userId" text not null references public."User"(id) on delete cascade,
  tier text not null check (tier in ('free', 'pro')),
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions = 768),
  embedding extensions.vector(768) not null,
  "contentHash" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("chunkId", tier)
);

commit;
