-- Additive migration for AIRA Ultimate Platform durable entities (Phase 2-6)
-- Conforms to RLS and zero-destructive-changes policy.

CREATE TABLE IF NOT EXISTS "UserAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "modelPolicy" JSONB NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memoryPolicy" JSONB NOT NULL,
    "budget" JSONB NOT NULL,
    "riskPolicy" JSONB NOT NULL,
    "avatar" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "UserAgent_userId_updatedAt_idx" ON "UserAgent"("userId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "UserAgent_isPublic_idx" ON "UserAgent"("isPublic");

CREATE TABLE IF NOT EXISTS "UserAgentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL REFERENCES "UserAgent"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelPolicy" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserAgentVersion_agentId_version_key" UNIQUE ("agentId", "version")
);

CREATE INDEX IF NOT EXISTS "UserAgentVersion_agentId_idx" ON "UserAgentVersion"("agentId");

CREATE TABLE IF NOT EXISTS "InstallableSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manifest" JSONB NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "InstallableSkill_userId_workspaceId_idx" ON "InstallableSkill"("userId", "workspaceId");
CREATE INDEX IF NOT EXISTS "InstallableSkill_enabled_idx" ON "InstallableSkill"("enabled");

CREATE TABLE IF NOT EXISTS "AutomationRoutine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "triggerConfig" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "workflowDag" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AutomationRoutine_userId_status_idx" ON "AutomationRoutine"("userId", "status");

CREATE TABLE IF NOT EXISTS "AutomationRoutineVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL REFERENCES "AutomationRoutine"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "workflowDag" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRoutineVersion_routineId_version_key" UNIQUE ("routineId", "version")
);

CREATE INDEX IF NOT EXISTS "AutomationRoutineVersion_routineId_idx" ON "AutomationRoutineVersion"("routineId");

CREATE TABLE IF NOT EXISTS "AutomationRoutineRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL REFERENCES "AutomationRoutine"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "stepOutputs" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AutomationRoutineRun_routineId_startedAt_idx" ON "AutomationRoutineRun"("routineId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "AutomationRoutineRun_userId_status_idx" ON "AutomationRoutineRun"("userId", "status");
CREATE INDEX IF NOT EXISTS "AutomationRoutineRun_idempotencyKey_idx" ON "AutomationRoutineRun"("idempotencyKey");

CREATE TABLE IF NOT EXISTS "AutomationNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'routine',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AutomationNotification_userId_read_createdAt_idx" ON "AutomationNotification"("userId", "read", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "DurableArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DurableArtifact_userId_createdAt_idx" ON "DurableArtifact"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "DurableArtifact_isPublic_idx" ON "DurableArtifact"("isPublic");

CREATE TABLE IF NOT EXISTS "DurableArtifactVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "artifactId" TEXT NOT NULL REFERENCES "DurableArtifact"("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "storageUri" TEXT,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "validation" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DurableArtifactVersion_artifactId_version_key" UNIQUE ("artifactId", "version")
);

CREATE INDEX IF NOT EXISTS "DurableArtifactVersion_artifactId_idx" ON "DurableArtifactVersion"("artifactId");

CREATE TABLE IF NOT EXISTS "EnterpriseOrganization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "ssoConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "EnterpriseWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL REFERENCES "EnterpriseOrganization"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EnterpriseWorkspace_orgId_idx" ON "EnterpriseWorkspace"("orgId");

CREATE TABLE IF NOT EXISTS "EnterpriseMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL REFERENCES "EnterpriseOrganization"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnterpriseMembership_orgId_userId_key" UNIQUE ("orgId", "userId")
);

CREATE INDEX IF NOT EXISTS "EnterpriseMembership_userId_idx" ON "EnterpriseMembership"("userId");

-- Security hardening: RLS and privilege lockdown for durable ultimate platform entities
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'UserAgent',
    'UserAgentVersion',
    'InstallableSkill',
    'AutomationRoutine',
    'AutomationRoutineVersion',
    'AutomationRoutineRun',
    'AutomationNotification',
    'DurableArtifact',
    'DurableArtifactVersion',
    'EnterpriseOrganization',
    'EnterpriseWorkspace',
    'EnterpriseMembership'
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
  "UserAgent",
  "UserAgentVersion",
  "InstallableSkill",
  "AutomationRoutine",
  "AutomationRoutineVersion",
  "AutomationRoutineRun",
  "AutomationNotification",
  "DurableArtifact",
  "DurableArtifactVersion",
  "EnterpriseOrganization",
  "EnterpriseWorkspace",
  "EnterpriseMembership"
from anon, authenticated, service_role;

notify pgrst, 'reload schema';
