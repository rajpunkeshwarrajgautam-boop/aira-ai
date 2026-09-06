begin;

create table "AgentProject" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "name" text not null,
  "objective" text not null,
  "status" text not null default 'ACTIVE' check ("status" in ('ACTIVE','ARCHIVED')),
  "config" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

create table "AgentPlatformRun" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "userId" text not null references "User"("id") on delete cascade,
  "status" text not null default 'PLANNING' check ("status" in ('PLANNING','RUNNING','WAITING','BLOCKED','APPROVAL_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  "runtime" text,
  "managerRole" text not null default 'AIRA_MANAGER',
  "budgets" jsonb not null default '{}'::jsonb,
  "summary" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3)
);

create table "AgentTask" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "title" text not null,
  "objective" text not null,
  "status" text not null default 'QUEUED' check ("status" in ('QUEUED','READY','CLAIMED','RUNNING','WAITING','BLOCKED','APPROVAL_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  "priority" integer not null default 50,
  "agentRole" text not null,
  "modelTier" text not null default 'balanced',
  "dependencies" jsonb not null default '[]'::jsonb,
  "inputArtifacts" jsonb not null default '[]'::jsonb,
  "outputArtifacts" jsonb not null default '[]'::jsonb,
  "runtimeRunId" text references "AgentRun"("id") on delete set null,
  "attempt" integer not null default 0,
  "maxAttempts" integer not null default 2,
  "leaseOwner" text,
  "leaseExpiresAt" timestamp(3),
  "heartbeatAt" timestamp(3),
  "lastError" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3)
);

create table "AgentInstance" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "role" text not null,
  "objective" text not null,
  "status" text not null default 'IDLE' check ("status" in ('IDLE','WORKING','WAITING','PAUSED','STOPPED','FAILED')),
  "modelTier" text not null default 'balanced',
  "capabilities" jsonb not null default '[]'::jsonb,
  "allowedTools" jsonb not null default '[]'::jsonb,
  "workspace" text,
  "currentTaskId" text references "AgentTask"("id") on delete set null,
  "budgets" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

create table "AgentMessage" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete cascade,
  "agentId" text references "AgentInstance"("id") on delete set null,
  "kind" text not null check ("kind" in ('INSTRUCTION','PROGRESS','BLOCKER','HANDOFF','RESULT','STEERING')),
  "body" jsonb not null,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "AgentEvent" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete cascade,
  "agentId" text references "AgentInstance"("id") on delete set null,
  "type" text not null,
  "payload" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "AgentArtifact" (
  "id" text primary key,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete set null,
  "kind" text not null,
  "name" text not null,
  "uri" text not null,
  "metadata" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "AgentApproval" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "projectId" text not null references "AgentProject"("id") on delete cascade,
  "runId" text not null references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete cascade,
  "action" text not null,
  "risk" text not null check ("risk" in ('LOW','MEDIUM','HIGH','PROTECTED')),
  "status" text not null default 'PENDING' check ("status" in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  "context" jsonb not null default '{}'::jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,
  "resolvedAt" timestamp(3)
);

create table "BrowserSession" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "projectId" text references "AgentProject"("id") on delete cascade,
  "runId" text references "AgentPlatformRun"("id") on delete cascade,
  "taskId" text references "AgentTask"("id") on delete set null,
  "mode" text not null default 'OBSERVE' check ("mode" in ('OBSERVE','ASSISTED','AUTONOMOUS')),
  "status" text not null default 'CREATING' check ("status" in ('CREATING','ACTIVE','HUMAN_CONTROL','PAUSED','ENDED','FAILED','EXPIRED')),
  "allowedDomains" jsonb not null default '[]'::jsonb,
  "permissions" jsonb not null default '[]'::jsonb,
  "remoteSessionId" text,
  "currentUrl" text,
  "lastScreenshotUri" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp,
  "expiresAt" timestamp(3) not null
);

create table "BrowserAction" (
  "id" text primary key,
  "sessionId" text not null references "BrowserSession"("id") on delete cascade,
  "agentId" text references "AgentInstance"("id") on delete set null,
  "source" text not null default 'AGENT' check ("source" in ('AGENT','HUMAN','SYSTEM')),
  "action" text not null,
  "target" text,
  "result" jsonb,
  "risk" text not null default 'LOW' check ("risk" in ('LOW','MEDIUM','HIGH','PROTECTED')),
  "approvalId" text references "AgentApproval"("id") on delete set null,
  "screenshotUri" text,
  "createdAt" timestamp(3) not null default current_timestamp
);

create table "AgentSkill" (
  "id" text primary key,
  "userId" text references "User"("id") on delete cascade,
  "name" text not null,
  "description" text not null,
  "instructions" text not null,
  "requiredTools" jsonb not null default '[]'::jsonb,
  "preferredAgentRole" text,
  "inputSchema" jsonb not null default '{}'::jsonb,
  "outputSchema" jsonb not null default '{}'::jsonb,
  "permissions" jsonb not null default '[]'::jsonb,
  "builtin" boolean not null default false,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null default current_timestamp
);

create index "AgentProject_userId_updatedAt_idx" on "AgentProject"("userId", "updatedAt" desc);
create index "AgentPlatformRun_userId_createdAt_idx" on "AgentPlatformRun"("userId", "createdAt" desc);
create index "AgentPlatformRun_projectId_status_idx" on "AgentPlatformRun"("projectId", "status");
create index "AgentTask_runId_status_priority_idx" on "AgentTask"("runId", "status", "priority" desc);
create index "AgentTask_lease_idx" on "AgentTask"("status", "leaseExpiresAt");
create index "AgentEvent_runId_createdAt_idx" on "AgentEvent"("runId", "createdAt");
create index "AgentApproval_userId_status_idx" on "AgentApproval"("userId", "status", "createdAt" desc);
create index "BrowserSession_userId_status_idx" on "BrowserSession"("userId", "status", "updatedAt" desc);
create index "BrowserAction_sessionId_createdAt_idx" on "BrowserAction"("sessionId", "createdAt");
create unique index "AgentSkill_builtin_name_key" on "AgentSkill"("name") where "builtin" = true;
create unique index "AgentSkill_user_name_key" on "AgentSkill"("userId", "name") where "userId" is not null;

-- These tables are server-owned. Keep them inaccessible through the Supabase Data API.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'AgentProject','AgentPlatformRun','AgentTask','AgentInstance','AgentMessage',
    'AgentEvent','AgentArtifact','AgentApproval','BrowserSession','BrowserAction','AgentSkill'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy "deny_direct_data_api_access" on public.%I for all to anon, authenticated using (false) with check (false)', table_name);
  end loop;
end
$$;

revoke all privileges on table
  "AgentProject", "AgentPlatformRun", "AgentTask", "AgentInstance", "AgentMessage",
  "AgentEvent", "AgentArtifact", "AgentApproval", "BrowserSession", "BrowserAction", "AgentSkill"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
