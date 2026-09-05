begin;

create table "McpServerPreference" (
  "id" text not null,
  "userId" text not null,
  "serverId" text not null,
  "enabled" boolean not null default true,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,

  constraint "McpServerPreference_pkey" primary key ("id")
);

alter table "McpServerPreference" enable row level security;

drop policy if exists "deny_direct_data_api_access" on "McpServerPreference";
create policy "deny_direct_data_api_access"
  on "McpServerPreference"
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table "McpServerPreference"
  from anon, authenticated, service_role;

create unique index "McpServerPreference_userId_serverId_key"
  on "McpServerPreference"("userId", "serverId");

create index "McpServerPreference_userId_updatedAt_idx"
  on "McpServerPreference"("userId", "updatedAt" desc);

alter table "McpServerPreference"
  add constraint "McpServerPreference_userId_fkey"
  foreign key ("userId") references "User"("id")
  on delete cascade on update cascade;

notify pgrst, 'reload schema';

commit;
