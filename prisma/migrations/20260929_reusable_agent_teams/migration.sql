-- Reusable AIRA Agent Teams.
-- Additive only: durable team definitions/version history and immutable task launch snapshots.

CREATE TABLE IF NOT EXISTS "AgentTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "members" JSONB NOT NULL,
    "budgets" JSONB NOT NULL,
    "coordinatorPolicy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AgentTeam_userId_updatedAt_idx"
    ON "AgentTeam"("userId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentTeam_userId_status_idx"
    ON "AgentTeam"("userId", "status");

CREATE TABLE IF NOT EXISTS "AgentTeamVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL REFERENCES "AgentTeam"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTeamVersion_teamId_version_key" UNIQUE ("teamId", "version")
);

CREATE INDEX IF NOT EXISTS "AgentTeamVersion_teamId_idx"
    ON "AgentTeamVersion"("teamId");

ALTER TABLE "AgentTask"
    ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE "AgentTeam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentTeamVersion" ENABLE ROW LEVEL SECURITY;

do $$
begin
  begin
    create policy "deny_direct_data_api_access" on public."AgentTeam"
      for all to anon, authenticated using (false) with check (false);
  exception when duplicate_object then null;
  end;
  begin
    create policy "deny_direct_data_api_access" on public."AgentTeamVersion"
      for all to anon, authenticated using (false) with check (false);
  exception when duplicate_object then null;
  end;
end
$$;

revoke all privileges on table "AgentTeam", "AgentTeamVersion"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
