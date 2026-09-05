begin;

alter table "AgentPlatformRun" add column "clientRequestId" text;
update "AgentPlatformRun" set "clientRequestId" = "id" where "clientRequestId" is null;
alter table "AgentPlatformRun" alter column "clientRequestId" set not null;
create unique index "AgentPlatformRun_userId_clientRequestId_key"
  on "AgentPlatformRun"("userId", "clientRequestId");

commit;
