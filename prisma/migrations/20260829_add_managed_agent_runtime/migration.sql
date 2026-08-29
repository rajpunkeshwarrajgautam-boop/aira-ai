begin;

create table "AgentRunTask" (
  "id" text not null,
  "runId" text not null,
  "taskKey" text not null,
  "parentTaskKey" text,
  "title" text not null,
  "description" text,
  "role" text not null,
  "dependencies" text[] not null default array[]::text[],
  "requiredCapabilities" text[] not null default array[]::text[],
  "status" text not null,
  "priority" integer not null default 50,
  "attempt" integer not null default 0,
  "maxAttempts" integer,
  "delegationDepth" integer not null default 1,
  "blockedReason" text,
  "expectedOutput" text,
  "acceptanceCriteria" jsonb,
  "riskClass" text,
  "preferredModelClass" text,
  "result" jsonb,
  "evidence" jsonb,
  "artifactRefs" jsonb,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  constraint "AgentRunTask_pkey" primary key ("id")
);

create table "AgentRunMessage" (
  "id" text not null,
  "runId" text not null,
  "taskKey" text,
  "senderRole" text not null,
  "recipientRole" text,
  "messageType" text not null,
  "content" text not null,
  "artifactRefs" jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "AgentRunMessage_pkey" primary key ("id")
);

create table "AgentRunArtifact" (
  "id" text not null,
  "runId" text not null,
  "taskKey" text,
  "agentRole" text,
  "type" text not null,
  "name" text not null,
  "storageRef" text not null,
  "contentType" text,
  "sizeBytes" integer,
  "metadata" jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "AgentRunArtifact_pkey" primary key ("id")
);

alter table "AgentRunTask" enable row level security;
alter table "AgentRunMessage" enable row level security;
alter table "AgentRunArtifact" enable row level security;

drop policy if exists "deny_direct_data_api_access" on "AgentRunTask";
create policy "deny_direct_data_api_access"
  on "AgentRunTask"
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "deny_direct_data_api_access" on "AgentRunMessage";
create policy "deny_direct_data_api_access"
  on "AgentRunMessage"
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "deny_direct_data_api_access" on "AgentRunArtifact";
create policy "deny_direct_data_api_access"
  on "AgentRunArtifact"
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table "AgentRunTask" from anon, authenticated, service_role;
revoke all privileges on table "AgentRunMessage" from anon, authenticated, service_role;
revoke all privileges on table "AgentRunArtifact" from anon, authenticated, service_role;

create unique index "AgentRunTask_runId_taskKey_key"
  on "AgentRunTask"("runId", "taskKey");
create index "AgentRunTask_runId_status_priority_idx"
  on "AgentRunTask"("runId", "status", "priority" desc);
create index "AgentRunTask_runId_role_updatedAt_idx"
  on "AgentRunTask"("runId", "role", "updatedAt" desc);

create index "AgentRunMessage_runId_createdAt_idx"
  on "AgentRunMessage"("runId", "createdAt");
create index "AgentRunMessage_runId_taskKey_createdAt_idx"
  on "AgentRunMessage"("runId", "taskKey", "createdAt");

create index "AgentRunArtifact_runId_createdAt_idx"
  on "AgentRunArtifact"("runId", "createdAt");
create index "AgentRunArtifact_runId_taskKey_createdAt_idx"
  on "AgentRunArtifact"("runId", "taskKey", "createdAt");

alter table "AgentRunTask"
  add constraint "AgentRunTask_runId_fkey"
  foreign key ("runId") references "AgentRun"("id")
  on delete cascade on update cascade;

alter table "AgentRunMessage"
  add constraint "AgentRunMessage_runId_fkey"
  foreign key ("runId") references "AgentRun"("id")
  on delete cascade on update cascade;

alter table "AgentRunArtifact"
  add constraint "AgentRunArtifact_runId_fkey"
  foreign key ("runId") references "AgentRun"("id")
  on delete cascade on update cascade;

notify pgrst, 'reload schema';

commit;
