begin;

create type "AgentToolApprovalStatus" as enum (
  'PENDING',
  'APPROVED',
  'DENIED',
  'CANCELLED',
  'EXPIRED'
);

create table "AgentToolApproval" (
  "id" text not null,
  "runId" text not null,
  "approvalKey" text not null,
  "toolId" text not null,
  "permission" text not null,
  "mode" text not null,
  "summary" text not null,
  "request" jsonb,
  "status" "AgentToolApprovalStatus" not null default 'PENDING',
  "requestedAt" timestamp(3) not null default current_timestamp,
  "resolvedAt" timestamp(3),
  "resolverUserId" text,

  constraint "AgentToolApproval_pkey" primary key ("id")
);

alter table "AgentToolApproval" enable row level security;

drop policy if exists "deny_direct_data_api_access" on "AgentToolApproval";
create policy "deny_direct_data_api_access"
  on "AgentToolApproval"
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table "AgentToolApproval"
  from anon, authenticated, service_role;

create unique index "AgentToolApproval_runId_approvalKey_key"
  on "AgentToolApproval"("runId", "approvalKey");

create index "AgentToolApproval_runId_status_requestedAt_idx"
  on "AgentToolApproval"("runId", "status", "requestedAt");

create index "AgentToolApproval_resolverUserId_resolvedAt_idx"
  on "AgentToolApproval"("resolverUserId", "resolvedAt");

alter table "AgentToolApproval"
  add constraint "AgentToolApproval_runId_fkey"
  foreign key ("runId") references "AgentRun"("id")
  on delete cascade on update cascade;

notify pgrst, 'reload schema';

commit;
