-- TruthMode IV: Integrity repairs for durable UserAgent connectors/shares, BYTEA blob storage, and persisted workflow approvals

ALTER TABLE "UserAgent" ADD COLUMN IF NOT EXISTS "connectors" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserAgent" ADD COLUMN IF NOT EXISTS "shares" JSONB DEFAULT '[]'::JSONB;

ALTER TABLE "UserAgentVersion" ADD COLUMN IF NOT EXISTS "connectors" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserAgentVersion" ADD COLUMN IF NOT EXISTS "shares" JSONB DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS "DurableBlob" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AutomationApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "runId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "parametersHash" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "AutomationApproval_userId_status_idx" ON "AutomationApproval"("userId", "status");
CREATE INDEX IF NOT EXISTS "AutomationApproval_runId_nodeId_idx" ON "AutomationApproval"("runId", "nodeId");

-- Row Level Security and privilege lockdown
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'DurableBlob',
    'AutomationApproval'
  ]
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

revoke all privileges on table
  "DurableBlob",
  "AutomationApproval"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
