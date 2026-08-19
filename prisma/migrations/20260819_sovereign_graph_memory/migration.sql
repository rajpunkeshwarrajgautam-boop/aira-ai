-- Additive graph-relational memory and consolidation candidates.
-- Existing UserMemory + UserMemoryEmbedding remain authoritative and continue to work
-- when graph memory is disabled or unavailable.

begin;

create table if not exists public."MemoryEntity" (
  id text primary key,
  "userId" text not null references public."User"(id) on delete cascade,
  "entityKey" text not null,
  "entityType" text not null,
  label text not null,
  "normalizedLabel" text not null,
  attributes jsonb,
  confidence double precision not null default 1 check (confidence >= 0 and confidence <= 1),
  "sourceMemoryId" text references public."UserMemory"(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("userId", "entityKey")
);

create index if not exists "MemoryEntity_userId_normalizedLabel_idx"
  on public."MemoryEntity" ("userId", "normalizedLabel");
create index if not exists "MemoryEntity_sourceMemoryId_idx"
  on public."MemoryEntity" ("sourceMemoryId");

create table if not exists public."MemoryRelation" (
  id text primary key,
  "userId" text not null references public."User"(id) on delete cascade,
  "subjectEntityId" text not null references public."MemoryEntity"(id) on delete cascade,
  predicate text not null,
  "objectEntityId" text not null references public."MemoryEntity"(id) on delete cascade,
  "evidenceMemoryId" text references public."UserMemory"(id) on delete set null,
  confidence double precision not null default 1 check (confidence >= 0 and confidence <= 1),
  status text not null default 'ACTIVE',
  "validFrom" timestamptz,
  "validTo" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  check ("subjectEntityId" <> "objectEntityId"),
  unique ("userId", "subjectEntityId", predicate, "objectEntityId")
);

create index if not exists "MemoryRelation_userId_subject_idx"
  on public."MemoryRelation" ("userId", "subjectEntityId");
create index if not exists "MemoryRelation_userId_object_idx"
  on public."MemoryRelation" ("userId", "objectEntityId");
create index if not exists "MemoryRelation_evidenceMemoryId_idx"
  on public."MemoryRelation" ("evidenceMemoryId");

create table if not exists public."MemoryConsolidation" (
  id text primary key,
  "userId" text not null references public."User"(id) on delete cascade,
  "consolidationKey" text not null,
  summary text not null,
  "evidenceMemoryIds" text[] not null default '{}',
  confidence double precision not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'CANDIDATE',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("userId", "consolidationKey")
);

create index if not exists "MemoryConsolidation_userId_updatedAt_idx"
  on public."MemoryConsolidation" ("userId", "updatedAt" desc);

alter table public."MemoryEntity" enable row level security;
alter table public."MemoryRelation" enable row level security;
alter table public."MemoryConsolidation" enable row level security;

create policy "deny_direct_data_api_access" on public."MemoryEntity"
  for all to anon, authenticated using (false) with check (false);
create policy "deny_direct_data_api_access" on public."MemoryRelation"
  for all to anon, authenticated using (false) with check (false);
create policy "deny_direct_data_api_access" on public."MemoryConsolidation"
  for all to anon, authenticated using (false) with check (false);

revoke all privileges on public."MemoryEntity" from anon, authenticated, service_role;
revoke all privileges on public."MemoryRelation" from anon, authenticated, service_role;
revoke all privileges on public."MemoryConsolidation" from anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
