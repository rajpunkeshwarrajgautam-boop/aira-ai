-- Cover graph relation foreign keys independently so FK maintenance and entity deletion
-- do not require scanning by composite user-scoped indexes.

begin;

create index if not exists "MemoryRelation_subjectEntityId_idx"
  on public."MemoryRelation" ("subjectEntityId");

create index if not exists "MemoryRelation_objectEntityId_idx"
  on public."MemoryRelation" ("objectEntityId");

commit;
