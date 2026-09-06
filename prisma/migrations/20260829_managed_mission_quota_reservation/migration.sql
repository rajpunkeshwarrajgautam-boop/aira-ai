begin;

create table if not exists "AgentManagedMissionQuotaReservation" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "clientRequestId" text not null,
  "periodStart" timestamp(3) not null,
  "createdAt" timestamp(3) not null default current_timestamp,
  unique ("userId", "clientRequestId")
);

create index if not exists "AgentManagedMissionQuotaReservation_period_idx"
  on "AgentManagedMissionQuotaReservation" ("periodStart", "createdAt");

-- Managed-mission quota reservations are an internal billing-control primitive.
-- They must never be writable or readable through the Supabase Data API.
alter table "AgentManagedMissionQuotaReservation" enable row level security;

do $$
begin
  begin
    create policy "deny_direct_data_api_access"
      on "AgentManagedMissionQuotaReservation"
      for all to anon, authenticated
      using (false) with check (false);
  exception when duplicate_object then
    null;
  end;
end
$$;

revoke all privileges on table "AgentManagedMissionQuotaReservation"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
