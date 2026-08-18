begin;

create type "UserMemoryKind" as enum (
  'PROFILE',
  'PREFERENCE',
  'GOAL',
  'PROJECT',
  'DECISION',
  'CONSTRAINT',
  'RELATIONSHIP',
  'OTHER'
);

alter table "Conversation"
  add column "summary" text,
  add column "summaryUpdatedAt" timestamp(3),
  add column "summaryMessageCount" integer not null default 0;

create table "UserMemory" (
  "id" text not null,
  "userId" text not null,
  "memoryKey" text not null,
  "kind" "UserMemoryKind" not null default 'OTHER',
  "content" text not null,
  "keywords" text[] not null default array[]::text[],
  "importance" integer not null default 3,
  "confidence" double precision not null default 1,
  "pinned" boolean not null default false,
  "sourceConversationId" text,
  "sourceMessageId" text,
  "lastRecalledAt" timestamp(3),
  "recallCount" integer not null default 0,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,

  constraint "UserMemory_pkey" primary key ("id"),
  constraint "UserMemory_userId_fkey" foreign key ("userId") references "User"("id") on delete cascade on update cascade,
  constraint "UserMemory_sourceConversationId_fkey" foreign key ("sourceConversationId") references "Conversation"("id") on delete set null on update cascade,
  constraint "UserMemory_sourceMessageId_fkey" foreign key ("sourceMessageId") references "ConversationMessage"("id") on delete set null on update cascade,
  constraint "UserMemory_importance_check" check ("importance" between 1 and 5),
  constraint "UserMemory_confidence_check" check ("confidence" >= 0 and "confidence" <= 1)
);

create unique index "UserMemory_userId_memoryKey_key" on "UserMemory"("userId", "memoryKey");
create index "UserMemory_userId_updatedAt_idx" on "UserMemory"("userId", "updatedAt" desc);
create index "UserMemory_userId_kind_idx" on "UserMemory"("userId", "kind");
create index "UserMemory_userId_pinned_updatedAt_idx" on "UserMemory"("userId", "pinned" desc, "updatedAt" desc);

alter table "UserMemory" enable row level security;
drop policy if exists "deny_direct_data_api_access" on "UserMemory";
create policy "deny_direct_data_api_access" on "UserMemory"
  for all to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table "UserMemory" from anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
