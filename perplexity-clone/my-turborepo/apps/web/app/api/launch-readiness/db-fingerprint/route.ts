import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  "AgentProject",
  "AgentRun",
  "AgentTask",
  "BrowserSession",
  "UserAgent",
  "UserAgentVersion",
  "AutomationRoutine",
  "AutomationRoutineRun",
  "DurableArtifact",
  "DurableArtifactVersion",
  "EnterpriseOrganization",
  "EnterpriseWorkspace",
  "EnterpriseMembership",
] as const;

const CANDIDATE_DATABASE_ENV_NAMES = [
  "DATABASE_URL",
  "PREVIEW_DATABASE_URL",
  "NEON_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

type TableRow = { table_name: string };
type DatabaseRow = { database_name: string; server_version: string };
type SystemRow = { system_identifier: string };
type MigrationRelationRow = { migration_relation: string | null };
type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function databaseProvider(hostname: string): "neon" | "supabase" | "other" {
  if (hostname.endsWith(".neon.tech")) return "neon";
  if (hostname.endsWith(".supabase.co") || hostname.includes("supabase")) return "supabase";
  return "other";
}

export async function GET(): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    return Response.json({ error: { code: "DATABASE_UNCONFIGURED", message: "Preview DATABASE_URL is not configured." } }, { status: 503 });
  }

  let hostname: string;
  try {
    hostname = new URL(rawDatabaseUrl).hostname.toLowerCase();
  } catch {
    return Response.json({ error: { code: "DATABASE_URL_INVALID", message: "Preview DATABASE_URL is invalid." } }, { status: 503 });
  }

  const [database] = await prisma.$queryRaw<DatabaseRow[]>`
    SELECT current_database() AS database_name, current_setting('server_version') AS server_version
  `;
  const [system] = await prisma.$queryRaw<SystemRow[]>`
    SELECT system_identifier::text AS system_identifier FROM pg_control_system()
  `;
  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'AgentProject', 'AgentRun', 'AgentTask', 'BrowserSession',
        'UserAgent', 'UserAgentVersion', 'AutomationRoutine', 'AutomationRoutineRun',
        'DurableArtifact', 'DurableArtifactVersion', 'EnterpriseOrganization',
        'EnterpriseWorkspace', 'EnterpriseMembership'
      )
    ORDER BY table_name
  `;
  const [migrationRelation] = await prisma.$queryRaw<MigrationRelationRow[]>`
    SELECT to_regclass('public."_prisma_migrations"')::text AS migration_relation
  `;

  let migrations: MigrationRow[] = [];
  if (migrationRelation?.migration_relation) {
    migrations = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
      LIMIT 40
    `;
  }

  const existingTables = new Set(tables.map((row) => row.table_name));
  const tableStatus = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, existingTables.has(table)]));
  const databaseEnvStatus = Object.fromEntries(
    CANDIDATE_DATABASE_ENV_NAMES.map((name) => [name, Boolean(process.env[name]?.trim())]),
  );

  return Response.json(
    {
      environment: process.env.VERCEL_ENV,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      database: {
        provider: databaseProvider(hostname),
        hostFingerprint: fingerprint(hostname),
        systemFingerprint: system?.system_identifier ? fingerprint(system.system_identifier) : null,
        name: database?.database_name ?? null,
        serverVersion: database?.server_version ?? null,
      },
      databaseEnvStatus,
      migrationTablePresent: Boolean(migrationRelation?.migration_relation),
      migrations: migrations.map((migration) => ({
        name: migration.migration_name,
        finished: Boolean(migration.finished_at),
        rolledBack: Boolean(migration.rolled_back_at),
      })),
      tables: tableStatus,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
