begin;

alter table "AgentPlatformRun"
  add column if not exists "schedulerLeaseOwner" text,
  add column if not exists "schedulerLeaseExpiresAt" timestamp(3),
  add column if not exists "schedulerFailureCount" integer not null default 0,
  add column if not exists "nextSchedulerAttemptAt" timestamp(3),
  add column if not exists "toolCallsUsed" integer not null default 0,
  add column if not exists "inputTokensUsed" bigint not null default 0,
  add column if not exists "outputTokensUsed" bigint not null default 0,
  add column if not exists "cachedTokensUsed" bigint not null default 0,
  add column if not exists "knownCostUsd" numeric(14,6) not null default 0,
  add column if not exists "costAccountingComplete" boolean not null default false;

create index if not exists "AgentPlatformRun_scheduler_idx"
  on "AgentPlatformRun" ("status", "nextSchedulerAttemptAt", "schedulerLeaseExpiresAt", "updatedAt");

create table if not exists "AgentToolCall" (
  "id" text primary key,
  "clientRequestId" text not null,
  "userId" text not null references "User"("id") on delete cascade,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete set null,
  "agentId" text references "AgentInstance"("id") on delete set null,
  "tool" text not null,
  "action" text not null,
  "risk" text not null check ("risk" in ('LOW','MEDIUM','HIGH','PROTECTED')),
  "status" text not null default 'PENDING' check ("status" in ('PENDING','APPROVAL_REQUIRED','EXECUTING','COMPLETED','FAILED','DENIED','CANCELLED')),
  "approvalId" text references "AgentApproval"("id") on delete set null,
  "inputSummary" jsonb not null default '{}'::jsonb,
  "resultSummary" jsonb,
  "usage" jsonb not null default '{}'::jsonb,
  "errorCode" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3),
  unique ("userId", "clientRequestId")
);

create index if not exists "AgentToolCall_runId_createdAt_idx"
  on "AgentToolCall" ("runId", "createdAt" desc);
create index if not exists "AgentToolCall_taskId_status_idx"
  on "AgentToolCall" ("taskId", "status");

create table if not exists "AgentProjectMemory" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "memoryKey" text not null,
  "kind" text not null check ("kind" in ('GOAL','ARCHITECTURE','TECH_STACK','CONSTRAINT','ARTIFACT','DEPLOYMENT','BLOCKER','DECISION','VERIFICATION','OTHER')),
  "content" text not null,
  "source" text not null,
  "importance" integer not null default 3 check ("importance" between 1 and 5),
  "confidence" double precision not null default 1 check ("confidence" >= 0 and "confidence" <= 1),
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  unique ("projectId", "memoryKey")
);

create index if not exists "AgentProjectMemory_projectId_updatedAt_idx"
  on "AgentProjectMemory" ("projectId", "updatedAt" desc);
create index if not exists "AgentProjectMemory_userId_kind_idx"
  on "AgentProjectMemory" ("userId", "kind");

create table if not exists "AgentWorktree" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text not null references "AgentTask"("id") on delete cascade,
  "workspaceId" text not null,
  "branch" text not null,
  "baseRef" text not null,
  "status" text not null default 'CREATING' check ("status" in ('CREATING','READY','DIRTY','INTEGRATED','CONFLICT','FAILED','CLEANED')),
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  unique ("taskId"),
  unique ("workspaceId")
);

create index if not exists "AgentWorktree_runId_status_idx"
  on "AgentWorktree" ("runId", "status");

-- New autonomous-control tables are server owned. They are deliberately not
-- queryable through the Supabase Data API; AIRA's authenticated server routes
-- enforce ownership and action-level authorization.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['AgentToolCall','AgentProjectMemory','AgentWorktree']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    begin
      execute format('create policy "deny_direct_data_api_access" on public.%I for all to anon, authenticated using (false) with check (false)', table_name);
    exception when duplicate_object then
      null;
    end;
  end loop;
end
$$;

revoke all privileges on table "AgentToolCall", "AgentProjectMemory", "AgentWorktree"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
