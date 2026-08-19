-- Additive semantic-memory and uploaded-knowledge storage for the AIRA foundation plane.
-- Existing UserMemory and conversation tables remain authoritative and continue to work
-- when semantic retrieval is disabled or unavailable.

begin;

create extension if not exists vector with schema extensions;

create table if not exists public."UserMemoryEmbedding" (
  "memoryId" text primary key references public."UserMemory"(id) on delete cascade,
  "userId" text not null references public."User"(id) on delete cascade,
  model text not null,
  dimensions integer not null check (dimensions = 1536),
  embedding extensions.vector(1536) not null,
  "contentHash" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "UserMemoryEmbedding_userId_idx"
  on public."UserMemoryEmbedding" ("userId");
create index if not exists "UserMemoryEmbedding_embedding_hnsw_idx"
  on public."UserMemoryEmbedding"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create table if not exists public."KnowledgeAsset" (
  id text primary key,
  "userId" text not null references public."User"(id) on delete cascade,
  filename text not null,
  "mimeType" text not null,
  "sizeBytes" bigint not null check ("sizeBytes" >= 0),
  sha256 text not null,
  "storageKey" text not null,
  status text not null default 'QUEUED',
  "errorMessage" text,
  metadata jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "KnowledgeAsset_userId_createdAt_idx"
  on public."KnowledgeAsset" ("userId", "createdAt" desc);
create index if not exists "KnowledgeAsset_userId_sha256_idx"
  on public."KnowledgeAsset" ("userId", sha256);

create table if not exists public."KnowledgeChunk" (
  id text primary key,
  "assetId" text not null references public."KnowledgeAsset"(id) on delete cascade,
  "userId" text not null references public."User"(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  content text not null,
  model text,
  dimensions integer check (dimensions is null or dimensions = 1536),
  embedding extensions.vector(1536),
  metadata jsonb,
  "createdAt" timestamptz not null default now(),
  unique ("assetId", ordinal)
);

create index if not exists "KnowledgeChunk_userId_assetId_idx"
  on public."KnowledgeChunk" ("userId", "assetId");
create index if not exists "KnowledgeChunk_embedding_hnsw_idx"
  on public."KnowledgeChunk"
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

alter table public."UserMemoryEmbedding" enable row level security;
alter table public."KnowledgeAsset" enable row level security;
alter table public."KnowledgeChunk" enable row level security;

drop policy if exists "deny_direct_data_api_access" on public."UserMemoryEmbedding";
create policy "deny_direct_data_api_access" on public."UserMemoryEmbedding"
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "deny_direct_data_api_access" on public."KnowledgeAsset";
create policy "deny_direct_data_api_access" on public."KnowledgeAsset"
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "deny_direct_data_api_access" on public."KnowledgeChunk";
create policy "deny_direct_data_api_access" on public."KnowledgeChunk"
  for all to anon, authenticated using (false) with check (false);

revoke all privileges on public."UserMemoryEmbedding" from anon, authenticated, service_role;
revoke all privileges on public."KnowledgeAsset" from anon, authenticated, service_role;
revoke all privileges on public."KnowledgeChunk" from anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
