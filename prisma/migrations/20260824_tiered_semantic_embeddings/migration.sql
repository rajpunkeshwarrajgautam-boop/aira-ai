-- Additive tier-aware semantic indexes.
-- UserMemory and KnowledgeChunk remain canonical; these rows are derived and
-- may be regenerated when a user's current embedding tier/model changes.

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

create index if not exists "UserMemorySemanticEmbedding_userId_tier_idx"
  on public."UserMemorySemanticEmbedding" ("userId", tier);
create index if not exists "UserMemorySemanticEmbedding_free_hnsw_idx"
  on public."UserMemorySemanticEmbedding"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where tier = 'free';
create index if not exists "UserMemorySemanticEmbedding_pro_hnsw_idx"
  on public."UserMemorySemanticEmbedding"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where tier = 'pro';

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

create index if not exists "KnowledgeChunkSemanticEmbedding_userId_tier_idx"
  on public."KnowledgeChunkSemanticEmbedding" ("userId", tier);
create index if not exists "KnowledgeChunkSemanticEmbedding_free_hnsw_idx"
  on public."KnowledgeChunkSemanticEmbedding"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where tier = 'free';
create index if not exists "KnowledgeChunkSemanticEmbedding_pro_hnsw_idx"
  on public."KnowledgeChunkSemanticEmbedding"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where tier = 'pro';

alter table public."UserMemorySemanticEmbedding" enable row level security;
alter table public."KnowledgeChunkSemanticEmbedding" enable row level security;

drop policy if exists "deny_direct_data_api_access" on public."UserMemorySemanticEmbedding";
create policy "deny_direct_data_api_access" on public."UserMemorySemanticEmbedding"
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "deny_direct_data_api_access" on public."KnowledgeChunkSemanticEmbedding";
create policy "deny_direct_data_api_access" on public."KnowledgeChunkSemanticEmbedding"
  for all to anon, authenticated using (false) with check (false);

revoke all privileges on public."UserMemorySemanticEmbedding" from anon, authenticated, service_role;
revoke all privileges on public."KnowledgeChunkSemanticEmbedding" from anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
