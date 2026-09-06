begin;

create table "AgentRunEvent" (
  "id" text not null,
  "runId" text not null,
  "eventKey" text not null,
  "type" text not null,
  "status" "AgentRunStatus",
  "message" text not null,
  "metadata" jsonb,
  "createdAt" timestamp(3) not null default current_timestamp,

  constraint "AgentRunEvent_pkey" primary key ("id")
);

alter table "AgentRunEvent" enable row level security;

drop policy if exists "deny_direct_data_api_access" on "AgentRunEvent";
create policy "deny_direct_data_api_access"
  on "AgentRunEvent"
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table "AgentRunEvent"
  from anon, authenticated, service_role;

create unique index "AgentRunEvent_runId_eventKey_key"
  on "AgentRunEvent"("runId", "eventKey");

create index "AgentRunEvent_runId_createdAt_idx"
  on "AgentRunEvent"("runId", "createdAt");

alter table "AgentRunEvent"
  add constraint "AgentRunEvent_runId_fkey"
  foreign key ("runId") references "AgentRun"("id")
  on delete cascade on update cascade;

notify pgrst, 'reload schema';

commit;
